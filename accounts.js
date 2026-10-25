// 付款 / 收款账户：现金、个人泰铢银行卡、公司泰铢账户、微信、支付宝、人民币银行卡……
// 每笔收支记在一个账户上，账户余额 = 最近一次核对的余额 + 之后的流水。

// 常用账户模板（可在「财富 → 账户」里一键添加，名称和别名都能改）
export const ACCOUNT_TEMPLATES = [
  { key: 'cash_thb', name: '现金', type: 'cash', currency: 'THB', owner: 'personal', aliases: ['现金', '现钞', 'cash', 'เงินสด'] },
  { key: 'bank_thb', name: '个人泰铢卡', type: 'bank', currency: 'THB', owner: 'personal', aliases: ['泰铢卡', '泰国卡', '泰国银行', '个人卡', '我的卡', '个人账户', 'kbank', 'k plus', '开泰', 'scb', '汇商', 'bangkok bank', '盘谷', 'krungthai', '泰京', 'promptpay', 'พร้อมเพย์', 'กสิกร', 'ไทยพาณิชย์', 'กรุงเทพ'] },
  { key: 'company_thb', name: '公司泰铢账户', type: 'bank', currency: 'THB', owner: 'company', aliases: ['公司账户', '公司卡', '公司的卡', '公户', '公司账上', '公司转账', '公司银行'] },
  { key: 'wechat', name: '微信', type: 'wallet', currency: 'CNY', owner: 'personal', aliases: ['微信', '微信支付', '零钱', 'wechat', 'weixin'] },
  { key: 'alipay', name: '支付宝', type: 'wallet', currency: 'CNY', owner: 'personal', aliases: ['支付宝', 'alipay', '余额宝'] },
  { key: 'bank_cny', name: '人民币银行卡', type: 'bank', currency: 'CNY', owner: 'personal', aliases: ['人民币卡', '国内卡', '银行卡', '储蓄卡', '借记卡', '招行', '招商', '工行', '工商', '建行', '建设', '农行', '中行', '交行', '银联', 'unionpay'] },
];

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ');

// 每个账户能被叫出来的名字：名称 + 别名
export const accountWords = a => [a.name, ...(a.aliases || [])].map(norm).filter(w => w.length >= 2 || /[一-龥]/.test(w));

// 从一句话 / 凭证文字里找出提到的账户（取匹配最长的那个）
export function matchAccount(text, accounts) {
  const t = norm(text);
  let best = null, len = 0;
  for (const a of accounts) {
    if (a.archived) continue;
    for (const w of accountWords(a)) {
      if (w && t.includes(w) && w.length > len) { best = a; len = w.length; }
    }
  }
  return best;
}

// 凭证上的付款方式 → 账户别名里的关键词
export function paymentHint(text) {
  const t = norm(text);
  if (/微信支付|wechat\s*pay|微信/.test(t)) return '微信';
  if (/支付宝|alipay/.test(t)) return '支付宝';
  if (/现金|cash|เงินสด/.test(t)) return '现金';
  if (/promptpay|พร้อมเพย์|k\s*plus|kbank|กสิกร|scb|ไทยพาณิชย์|bangkok bank|กรุงเทพ|krungthai|กรุงไทย/.test(t)) return '泰铢卡';
  if (/银联|unionpay|储蓄卡|借记卡|信用卡|visa|master/.test(t)) return '银行卡';
  return null;
}

// 没说用哪个账户时：用同币种里最近用过的个人账户
export function defaultAccountFor(currency, accounts, records) {
  const ids = new Set(accounts.filter(a => !a.archived && a.owner !== 'company' && (a.currency || 'CNY') === currency).map(a => a.id));
  if (!ids.size) return null;
  const last = records.filter(r => r.accountId && ids.has(r.accountId)).sort((a, b) => b.time - a.time)[0];
  return accounts.find(a => a.id === (last?.accountId ?? [...ids][0])) || null;
}

export const isCompany = a => a?.owner === 'company';
