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
  const r = buildReimbursementHtml(items, { currency: 'THB', convert, period: '2026年10月', person: '张三', org: '某某有限公司' });
  assert.equal(r.total, 120 + 2000 + 30 * 35 + 80);
  assert.deepEqual(r.groups.map(g => [g.item, g.n, g.amount]), [['住宿差旅费', 1, 2000], ['餐饮费', 1, 1050], ['交通费', 2, 200]]);
  assert.equal(r.rows[0].activity, '酒店两晚');     // 按日期排序，序号 1
  assert.equal(r.receiptCount, 3);
  assert.equal(r.inline, true);                    // 4 笔、3 张凭证：一页放下
  assert.equal(r.pages, 1);
  assert.match(r.html, /凭证 1-2/);
  assert.match(r.html, /1 美元 = 35\.0000 泰铢/);
  assert.match(r.html, /叁仟贰佰伍拾元整/);
});

test('报销单：凭证多时另起凭证页，每页 6 张', () => {
  const items = Array.from({ length: 14 }, (_, i) => rec(i + 1, { photoUrls: ['data:x'] }));
  const r = buildReimbursementHtml(items, { currency: 'THB', convert, period: '2026年10月' });
  assert.equal(r.inline, false);
  assert.equal(r.pages, 1 + 3);
});

test('科目', () => {
  assert.equal(expenseItem('transport'), '交通费');
  assert.equal(expenseItem('nope'), '其他费用');
});
