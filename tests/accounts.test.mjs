import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_TEMPLATES, matchAccount, paymentHint, defaultAccountFor } from '../accounts.js';
import { balanceSheet, summarizeMoney, setFx } from '../analytics.js';
import { parseUtterance } from '../parser.js';

const accounts = ACCOUNT_TEMPLATES.map(({ key, ...t }) => ({ ...t, id: key }));
const byKey = k => accounts.find(a => a.id === k);

test('从话里找账户', () => {
  const cases = {
    '微信付了35块午饭': 'wechat',
    '支付宝买书58元': 'alipay',
    '打车60块用公司卡付的': 'company_thb',
    '公司账户付了房租2万泰铢': 'company_thb',
    '用现金买水果80': 'cash_thb',
    'K PLUS 转了500': 'bank_thb',
    '招行卡刷了300': 'bank_cny',
    '午饭35块': null,
  };
  for (const [s, k] of Object.entries(cases)) assert.equal(matchAccount(s, accounts)?.id ?? null, k, s);
});

test('凭证上的付款方式', () => {
  assert.equal(matchAccount(paymentHint('支付方式：微信支付'), accounts).id, 'wechat');
  assert.equal(matchAccount(paymentHint('Paid via PromptPay'), accounts).id, 'bank_thb');
  assert.equal(matchAccount(paymentHint('เงินสด 100.00'), accounts).id, 'cash_thb');
  assert.equal(paymentHint('合计 30'), null);
});

test('默认账户：同币种里最近用过的个人账户', () => {
  const records = [
    { accountId: 'alipay', time: 1 },
    { accountId: 'wechat', time: 5 },
    { accountId: 'company_thb', time: 9 },
  ];
  assert.equal(defaultAccountFor('CNY', accounts, records).id, 'wechat');
  assert.equal(defaultAccountFor('THB', accounts, records).id, 'cash_thb');   // 公司账户不当默认
  assert.equal(defaultAccountFor('USD', accounts, records), null);
});

test('账户余额 = 核对余额 + 之后流水；公司账户单独算', () => {
  setFx('CNY', { THB: 0.2, USD: 7 });
  const balances = [
    { accountId: 'wechat', value: 3000, time: 100 },
    { accountId: 'bank_thb', value: 50000, time: 100 },
    { accountId: 'company_thb', value: 200000, time: 100 },
    { accountId: 'bank_cny', value: 20000, time: 100 },
  ];
  const records = [
    { time: 50, amount: 999, currency: 'CNY', direction: 'out', accountId: 'wechat' },          // 核对之前，不算
    { time: 200, amount: 35, currency: 'CNY', direction: 'out', accountId: 'wechat' },
    { time: 210, amount: 1200, currency: 'THB', direction: 'out', accountId: 'bank_thb' },
    { time: 220, amount: 15000, currency: 'THB', direction: 'in', accountId: 'bank_thb' },
    { time: 230, amount: 5000, currency: 'THB', direction: 'out', accountId: 'company_thb', company: true },
    { time: 240, amount: 2000, currency: 'THB', direction: 'transfer', accountId: 'bank_thb', toAccountId: 'cash_thb' },
    // 换汇：人民币卡 1 万 → 泰铢卡 4.8 万泰铢
    { time: 250, amount: 10000, currency: 'CNY', direction: 'transfer', accountId: 'bank_cny', toAccountId: 'bank_thb', toAmount: 48000, toCurrency: 'THB' },
  ];
  const sheet = balanceSheet(accounts, balances, 1000, records);
  const raw = k => sheet.rows.find(r => r.account.id === k).raw;
  assert.equal(raw('wechat'), 2965);
  assert.equal(raw('bank_thb'), 50000 - 1200 + 15000 - 2000 + 48000);
  assert.equal(raw('cash_thb'), 2000);
  assert.equal(raw('company_thb'), 195000);
  assert.equal(raw('bank_cny'), 10000);
  // 个人净资产不含公司账户
  const personalBase = 2965 + 10000 + (109800 + 2000) * 0.2;
  assert.equal(Math.round(sheet.net), Math.round(personalBase));
  assert.equal(Math.round(sheet.company), 39000);

  const m = summarizeMoney(records, { start: 150, end: 1000 });
  assert.equal(m.out, 35 + 1200 * 0.2);      // 公司账户支出和转账都不算个人支出
  assert.equal(m.companyOut, 1000);
});

test('转账语音', () => {
  let r = parseUtterance('从支付宝转5000到微信');
  assert.equal(r.type, 'transfer'); assert.equal(r.from, '支付宝'); assert.equal(r.to, '微信'); assert.equal(r.amount, 5000);
  r = parseUtterance('从人民币银行卡换了1万到个人泰铢卡，换成4万8泰铢');
  assert.equal(r.type, 'transfer'); assert.equal(r.amount, 10000); assert.equal(r.toAmount, 48000); assert.equal(r.toCurrency, 'THB');
  r = parseUtterance('从个人泰铢卡取了2000现金');
  assert.equal(r.type, 'transfer'); assert.equal(r.to, '现金'); assert.equal(r.amount, 2000);
  r = parseUtterance('用现金买水果80');
  assert.equal(r.amount, 80); assert.equal(r.category, 'food'); assert.equal(r.title, '买水果');
  r = parseUtterance('打车60块用公司卡付的');
  assert.equal(r.type, 'entry'); assert.equal(r.title, '打车'); assert.equal(r.currencyExplicit, false);
});
