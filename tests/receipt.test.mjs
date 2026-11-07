import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptText, findReceiptDate } from '../receipt.js';

const NOW = new Date(2026, 9, 25, 15, 0).getTime();
const ymdhm = ms => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

test('中文超市小票', () => {
  const r = parseReceiptText(`永辉超市（望京店）
购物小票
单号：202610250012345
日期：2026-10-24 18:32:05
蒙牛纯牛奶 2 39.80
金龙鱼大米5kg 1 52.90
合计：92.70
优惠：-5.00
实付：87.70
现金 100.00
找零 12.30
电话：010-88886666`, NOW);
  assert.equal(r.merchant, '永辉超市（望京店）');
  assert.equal(r.amount, 87.7);
  assert.equal(r.currency, 'CNY');
  assert.equal(ymdhm(r.time), '2026-10-24 18:32');
  assert.equal(r.category, 'shopping');
});

test('泰国 7-Eleven 小票（佛历年份）', () => {
  const r = parseReceiptText(`7-ELEVEN
CP ALL PUBLIC COMPANY LIMITED
TAX ID 0107542000011
NESCAFE 23.00
LAY'S 30.00
WATER 600ML 7.00
ยอดรวม 60.00
เงินสด 100.00
เงินทอน 40.00
25/10/69 14:07`, NOW);
  assert.equal(r.amount, 60);
  assert.equal(r.currency, 'THB');
  assert.equal(ymdhm(r.time), '2026-10-25 14:07');
  assert.equal(r.category, 'shopping');
  assert.equal(r.merchant, '7-ELEVEN');
  assert.equal(r.purpose, "NESCAFE、LAY'S、WATER 600ML");
});

test('微信支付截图（金额在下一行）', () => {
  const r = parseReceiptText(`星巴克咖啡
支付金额
¥38.00
当前状态 支付成功
支付时间 2026年10月23日 09:15:44
商品 大杯拿铁`, NOW);
  assert.equal(r.amount, 38);
  assert.equal(r.currency, 'CNY');
  assert.equal(ymdhm(r.time), '2026-10-23 9:15');
  assert.equal(r.category, 'food');
});

test('英文酒店账单', () => {
  const r = parseReceiptText(`HOLIDAY INN EXPRESS BANGKOK
Room 1203  Oct 20, 2026
Room charge 2 nights 3,200.00
Service charge 320.00
VAT 7% 246.40
Grand Total THB 3,766.40
Paid by VISA`, NOW);
  assert.equal(r.amount, 3766.4);
  assert.equal(r.currency, 'THB');
  assert.equal(ymdhm(r.time).slice(0, 10), '2026-10-20');
  assert.equal(r.category, 'travel');
});

test('打车行程单', () => {
  const r = parseReceiptText(`Grab
Your ride receipt
24 Oct 2026, 21:40
Total ฿186
Paid with cash`, NOW);
  assert.equal(r.amount, 186);
  assert.equal(r.currency, 'THB');
  assert.equal(r.category, 'transport');
  assert.equal(ymdhm(r.time), '2026-10-24 21:40');
});

test('日期格式', () => {
  assert.deepEqual(findReceiptDate('2569-10-25', NOW), { y: 2026, m: 10, d: 25 });
  assert.deepEqual(findReceiptDate('10/25/2026', NOW), { y: 2026, m: 10, d: 25 });
  assert.deepEqual(findReceiptDate('05.10.2026', NOW), { y: 2026, m: 10, d: 5 });
  assert.equal(findReceiptDate('没有日期', NOW), null);
});
