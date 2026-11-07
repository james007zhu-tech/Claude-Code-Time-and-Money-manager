import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upperAmount, buildReimbursementHtml, expenseItem } from '../report.js';

test('金额大写', () => {
  const cases = {
    0: '零元整', 8: '捌元整', 100: '壹佰元整', 1005: '壹仟零伍元整', 10000: '壹万元整',
    100500: '壹拾万零伍佰元整', 12345.67: '壹万贰仟叁佰肆拾伍元陆角柒分', 3766.4: '叁仟柒佰陆拾陆元肆角',
    100.05: '壹佰元零伍分', 0.5: '伍角', 100010000: '壹亿零壹万元整', 2000000: '贰佰万元整',
  };
  for (const [n, s] of Object.entries(cases)) assert.equal(upperAmount(Number(n)), s, n);
});

const convert = (a, from, to) => {
  const r = { CNY: 1, THB: 0.2, USD: 7 };
  return a * r[from] / r[to];
};
const rec = (i, o) => ({ id: 'r' + i, time: new Date(2026, 9, i, 10).getTime(), amount: 100, currency: 'THB', direction: 'out', reimbursable: true, category: 'transport', activity: `打车${i}`, note: '', photoUrls: [], ...o });

test('报销单：分类汇总、外币折算、凭证编号', () => {
  const items = [
    rec(3, { amount: 120, category: 'transport', photoUrls: ['data:a'] }),
    rec(1, { amount: 2000, category: 'travel', activity: '酒店两晚', photoUrls: ['data:b', 'data:c'] }),
    rec(5, { amount: 30, currency: 'USD', category: 'food', activity: '客户午餐' }),
    rec(7, { amount: 80, category: 'transport' }),
  ];
  const r = buildReimbursementHtml(items, { currency: 'THB', convert, period: '2026年10月', person: '张三', org: '某某有限公司', layout: 'single' });
  assert.equal(r.total, 120 + 2000 + 30 * 35 + 80);
  assert.deepEqual(r.groups.map(g => [g.item, g.n, g.amount]), [['住宿差旅费', 1, 2000], ['餐饮费', 1, 1050], ['交通费', 2, 200]]);
  assert.equal(r.rows[0].activity, '酒店两晚');     // 金额最大的科目在前，序号 1
  assert.equal(r.receiptCount, 3);
  assert.equal(r.inline, true);                    // 4 笔、3 张凭证：一页放下
  assert.equal(r.pages, 1);
  assert.match(r.html, /凭证 1-2/);
  assert.match(r.html, /1 美元 = 35\.0000 泰铢/);
  assert.match(r.html, /叁仟贰佰伍拾元整/);
});

test('报销单：凭证多时另起凭证页，每页 6 张', () => {
  const items = Array.from({ length: 14 }, (_, i) => rec(i + 1, { photoUrls: ['data:x'] }));
  const r = buildReimbursementHtml(items, { currency: 'THB', convert, period: '2026年10月', layout: 'single' });
  assert.equal(r.inline, false);
  assert.equal(r.pages, 1 + 3);
});

test('科目', () => {
  assert.equal(expenseItem('transport'), '交通费');
  assert.equal(expenseItem('nope'), '其他费用');
});

import { planSection } from '../report.js';

test('按科目分页：每个科目单独成页，凭证跟在明细后面', () => {
  // 3 笔明细 + 3 张凭证：一页放下（明细 + 一行半凭证）
  assert.deepEqual(planSection(3, 3), [{ rows: [0, 3], receipts: [0, 3] }]);
  // 3 笔明细 + 10 张凭证：第一页放 4 张，后面每页 6 张
  assert.deepEqual(planSection(3, 10).map(p => p.receipts), [[0, 4], [4, 10]]);
  // 明细超过一页（28 行）时分页，凭证接在最后
  assert.equal(planSection(40, 2).length, 2);
  // 没有凭证
  assert.deepEqual(planSection(5, 0), [{ rows: [0, 5], receipts: [0, 0] }]);
});

test('按科目分页：汇总页写明每个科目在第几页', () => {
  const items = [
    ...Array.from({ length: 4 }, (_, i) => rec(i + 1, { category: 'transport', photoUrls: ['data:t'] })),
    ...Array.from({ length: 9 }, (_, i) => rec(i + 5, { category: 'food', amount: 500, photoUrls: ['data:f'] })),
    rec(20, { category: 'work', amount: 50 }),
  ];
  const r = buildReimbursementHtml(items, { currency: 'THB', convert, period: '2026年10月', codes: { 交通费: '6601.01' } });
  assert.deepEqual(r.groups.map(g => g.item), ['餐饮费', '交通费', '办公费']);
  // 汇总 1 页 + 餐饮费 3 页（9 行明细后只放得下 2 张凭证，续页 6 张 + 1 张）+ 交通费 1 页 + 办公费 1 页
  assert.equal(r.pages, 6);
  assert.match(r.html, /餐饮费<\/td>[\s\S]*?第 2–4 页/);
  assert.match(r.html, /交通费<\/td>[\s\S]*?6601\.01[\s\S]*?第 5 页/);
  assert.match(r.html, /第 6 \/ 6 页/);
  assert.equal(r.rows[0].item, '餐饮费');   // 序号按科目连续编
});

import { buildErpPayload, erpCsv, parseCodes, parseHeaders } from '../erp.js';

test('ERP：结构化报销数据', () => {
  const items = [
    rec(3, { amount: 120, category: 'transport', photoUrls: ['data:image/jpeg;base64,QUJD'], accountName: '现金' }),
    rec(5, { amount: 30, currency: 'USD', category: 'food', activity: '客户午餐' }),
  ];
  const codes = parseCodes('交通费=6601.01\n餐饮费：6601.05\n乱写一行');
  assert.deepEqual(codes, { 交通费: '6601.01', 餐饮费: '6601.05' });
  const r = buildReimbursementHtml(items, { currency: 'THB', convert, period: '2026年10月', codes });
  const p = buildErpPayload(r, { period: '2026年10月', person: '张三', employeeCode: 'E001', costCenter: 'MKT', includeReceipts: true, now: Date.UTC(2026, 9, 31) });
  assert.equal(p.schema, 'time-ledger.expense-claim/v1');
  assert.equal(p.total, 1170);
  assert.deepEqual(p.summary, [{ expenseItem: '餐饮费', glAccount: '6601.05', count: 1, amount: 1050 }, { expenseItem: '交通费', glAccount: '6601.01', count: 1, amount: 120 }]);
  const usd = p.lines.find(l => l.originalCurrency === 'USD');
  assert.equal(usd.exchangeRate, 35); assert.equal(usd.amount, 1050); assert.equal(usd.glAccount, '6601.05');
  const thb = p.lines.find(l => l.expenseItem === '交通费');
  assert.deepEqual(thb.receipts, [{ fileName: 'receipt-2.jpg', mimeType: 'image/jpeg', dataBase64: 'QUJD' }]);
  assert.equal(thb.paymentAccount, '现金');
  const csv = erpCsv(p);
  assert.match(csv, /"6601\.01"/);
  assert.equal(csv.split('\r\n').length, 3);
  assert.deepEqual(parseHeaders('Authorization: Bearer abc\nX-Key: 1'), { Authorization: 'Bearer abc', 'X-Key': '1' });
});
