// 纯计算：时间分析（德鲁克）、财务分析（巴菲特）、回顾问答的本地回答。
import { TIME_CATS, timeCatById, catById, guessTimeCat, currencyById } from './parser.js';

const MIN = 60000;
const DAY = 86400000;
const round2 = n => Math.round(n * 100) / 100;

// ---------- 汇率：统计时都换算成本位币 ----------
// rates：1 单位外币 = 多少人民币
export const DEFAULT_RATES = { CNY: 1, THB: 0.2, USD: 7.1 };
let FX = { base: 'CNY', rates: DEFAULT_RATES };
export const setFx = (base, rates) => { FX = { base: currencyById(base).id, rates: { ...DEFAULT_RATES, ...rates, CNY: 1 } }; };
export const baseCurrency = () => FX.base;
export const toBase = (amount, currency) => (amount || 0) * (FX.rates[currency || 'CNY'] ?? 1) / (FX.rates[FX.base] ?? 1);

export const fmtMin = min => {
  min = Math.round(min);
  if (min < 60) return `${min}分钟`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}小时${m}分` : `${h}小时`;
};
export const fmtHours = min => (min >= 600 ? `${Math.round(min / 60)}小时` : fmtMin(min));
// 不传币种时按本位币显示
export const fmtMoney = (n, currency = FX.base) => {
  const v = round2(n || 0);
  const s = Math.abs(v) >= 10000 ? (Math.abs(v) / 10000).toFixed(Math.abs(v) >= 1e6 ? 0 : 2).replace(/\.?0+$/, '') + '万' : (Number.isInteger(v) ? String(Math.abs(v)) : Math.abs(v).toFixed(2));
  return (v < 0 ? '-' : '') + currencyById(currency).symbol + s;
};
// 记录自己的金额（原币种）
export const fmtRecMoney = e => fmtMoney(e.amount, e.currency || 'CNY');

// ---------- 时间 ----------

// 一条记录占用的时间段；没有时长的不算时间
export function eventSpan(e) {
  if (!e.durationMin) return null;
  return { start: e.time, end: e.time + e.durationMin * MIN };
}

function overlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

// 设备使用 → 时间类别，规则形如「code|xcode|终端 => deep」
export const DEFAULT_APP_RULES = [
  'code|cursor|xcode|intellij|idea|pycharm|webstorm|android studio|terminal|iterm|终端|word|excel|powerpoint|wps|pages|numbers|keynote|notion|obsidian|figma|sketch|photoshop|typora|docs.google|飞书文档 => deep',
  'wechat|微信|dingtalk|钉钉|飞书|lark|feishu|slack|teams|zoom|腾讯会议|wemeet|meeting|outlook|mail|邮件|foxmail|qq => meeting',
  'kindle|books|图书|coursera|udemy|得到|极客时间|网易公开课|anki|duolingo => learn',
  'bilibili|哔哩|youtube|抖音|douyin|tiktok|netflix|爱奇艺|iqiyi|优酷|腾讯视频|steam|game|游戏|weibo|微博|小红书|xiaohongshu|知乎|zhihu|twitter|x.com|instagram|reddit|taobao|淘宝|jd.com|京东|拼多多 => leisure',
  'finder|访达|explorer|文件资源管理器|system settings|系统设置|控制面板|calculator|计算器 => admin',
].join('\n');

export function compileRules(text) {
  return String(text || '').split('\n').map(line => {
    const m = /^(.+?)=>\s*(\w+)\s*$/.exec(line.trim());
    if (!m) return null;
    const words = m[1].split('|').map(w => w.trim().toLowerCase()).filter(Boolean);
    return words.length ? { words, cat: m[2] } : null;
  }).filter(Boolean);
}

export function classifyUsage(u, rules) {
  const hay = `${u.app} ${u.title || ''} ${u.domain || ''}`.toLowerCase();
  for (const r of rules) if (r.words.some(w => hay.includes(w))) return r.cat;
  return 'other';
}

// 汇总一个时间范围：自己记录的时间 + 设备使用时间（两者分开统计，避免重复）
export function summarizeTime(events, usage, range, rules = compileRules(DEFAULT_APP_RULES)) {
  const byCat = {}, byTitle = new Map();
  let recorded = 0;
  for (const e of events) {
    const sp = eventSpan(e);
    if (!sp) continue;
    const min = overlap(sp.start, sp.end, range.start, range.end) / MIN;
    if (!min) continue;
    const cat = e.timeCat || guessTimeCat(`${e.activity} ${e.note}`) || 'other';
    recorded += min;
    byCat[cat] = (byCat[cat] || 0) + min;
    const title = e.activity || e.note?.slice(0, 20) || timeCatById(cat).name;
    const t = byTitle.get(title) || { title, min: 0, n: 0, cat, money: 0 };
    t.min += min; t.n++; t.money += e.direction !== 'in' ? toBase(e.amount, e.currency) : 0;
    byTitle.set(title, t);
  }
  const device = { total: 0, byCat: {}, byApp: new Map(), byDevice: {} };
  for (const u of usage) {
    const min = overlap(u.start, u.end, range.start, range.end) / MIN;
    if (!min) continue;
    const cat = classifyUsage(u, rules);
    device.total += min;
    device.byCat[cat] = (device.byCat[cat] || 0) + min;
    device.byDevice[u.device] = (device.byDevice[u.device] || 0) + min;
    const a = device.byApp.get(u.app) || { app: u.app, min: 0, cat };
    a.min += min;
    device.byApp.set(u.app, a);
  }
  return {
    recorded,
    byCat,
    titles: [...byTitle.values()].sort((a, b) => b.min - a.min),
    device: { ...device, apps: [...device.byApp.values()].sort((a, b) => b.min - a.min) },
    focus: focusBlocks(events, usage, range, rules),
  };
}

// 德鲁克：「有效的管理者把可以自由支配的零碎时间集中起来，形成整块时间」
// 把「要事/学习」的记录和设备上的深度工作时段合并（间隔不超过 gapMin 视为连续），统计整块时间
export function focusBlocks(events, usage, range, rules, gapMin = 5) {
  const focusIds = new Set(TIME_CATS.filter(c => c.kind === 'focus').map(c => c.id));
  const spans = [];
  for (const e of events) {
    const sp = eventSpan(e);
    const cat = e.timeCat || guessTimeCat(`${e.activity} ${e.note}`);
    if (sp && focusIds.has(cat)) spans.push(sp);
  }
  for (const u of usage) if (focusIds.has(classifyUsage(u, rules))) spans.push({ start: u.start, end: u.end });
  const clipped = spans
    .map(s => ({ start: Math.max(s.start, range.start), end: Math.min(s.end, range.end) }))
    .filter(s => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const blocks = [];
  for (const s of clipped) {
    const last = blocks[blocks.length - 1];
    if (last && s.start - last.end <= gapMin * MIN) last.end = Math.max(last.end, s.end);
    else blocks.push({ ...s });
  }
  const mins = blocks.map(b => (b.end - b.start) / MIN);
  const days = Math.max(1, Math.round((Math.min(range.end, Date.now()) - range.start) / DAY));
  return {
    blocks,
    totalMin: mins.reduce((s, m) => s + m, 0),
    longestMin: Math.max(0, ...mins),
    big: mins.filter(m => m >= 90).length,
    medium: mins.filter(m => m >= 30 && m < 90).length,
    fragments: mins.filter(m => m < 30).length,
    days,
  };
}

// 时间诊断：把每项活动标成「必须我做 / 可委派 / 可不做」，算出能腾出来的时间
export function diagnosis(titles, tags, weeks) {
  let delegable = 0, droppable = 0;
  for (const t of titles) {
    if (tags[t.title] === 'delegate') delegable += t.min;
    if (tags[t.title] === 'drop') droppable += t.min;
  }
  const w = Math.max(weeks, 1 / 7);
  return { delegablePerWeek: delegable / w, droppablePerWeek: droppable / w };
}

// ---------- 钱 ----------
// 金额都换算成本位币。要报销的支出不算自己的花费，报销款到账也不算收入，单独统计。
export function summarizeMoney(events, range) {
  let out = 0, inc = 0, reimbPending = 0, reimbDone = 0, refundIn = 0;
  const byCat = {}, byIncome = {}, byCurrency = {};
  const list = [], pending = [];
  for (const e of events) {
    if (e.amount == null || e.time < range.start || e.time >= range.end) continue;
    list.push(e);
    const v = toBase(e.amount, e.currency);
    const cur = e.currency || 'CNY';
    const c = (byCurrency[cur] ??= { out: 0, in: 0 });
    if (e.direction === 'in') {
      c.in += e.amount;
      if (e.category === 'refund') { refundIn += v; continue; }
      inc += v; byIncome[e.category] = (byIncome[e.category] || 0) + v;
    } else {
      c.out += e.amount;
      if (e.reimbursable) {
        if (e.reimbursed) reimbDone += v; else { reimbPending += v; pending.push(e); }
        continue;
      }
      out += v; byCat[e.category] = (byCat[e.category] || 0) + v;
    }
  }
  const biggest = list.filter(e => e.direction !== 'in' && !e.reimbursable).sort((a, b) => toBase(b.amount, b.currency) - toBase(a.amount, a.currency)).slice(0, 5);
  return {
    out: round2(out), in: round2(inc), net: round2(inc - out), byCat, byIncome, biggest, count: list.length,
    byCurrency, multiCurrency: Object.keys(byCurrency).length > 1,
    reimbPending: round2(reimbPending), reimbDone: round2(reimbDone), refundIn: round2(refundIn), pending,
  };
}

// 资产负债：每个账户取 at 之前最新的余额
export const ACCOUNT_TYPES = [
  { id: 'cash', name: '现金/活期', icon: '💳', liquid: true },
  { id: 'deposit', name: '定期存款', icon: '🏦', liquid: true },
  { id: 'fund', name: '基金/指数', icon: '📊', invest: true },
  { id: 'stock', name: '股票', icon: '📈', invest: true },
  { id: 'bond', name: '债券/理财', icon: '🧾', invest: true },
  { id: 'insurance', name: '保险/公积金', icon: '🛡️' },
  { id: 'property', name: '房产/车', icon: '🏠' },
  { id: 'other_asset', name: '其他资产', icon: '📦' },
  { id: 'loan', name: '贷款', icon: '🏚️', liability: true },
  { id: 'credit', name: '信用卡/消费贷', icon: '💸', liability: true, consumer: true },
];
export const accountType = id => ACCOUNT_TYPES.find(t => t.id === id) || ACCOUNT_TYPES[7];

export function guessAccountType(name, liability) {
  if (liability) return /信用卡|花呗|白条|借呗|微粒贷|网贷|消费贷/.test(name) ? 'credit' : 'loan';
  if (/基金|指数|etf|定投/i.test(name)) return 'fund';
  if (/股票|股|证券|港股|美股/.test(name)) return 'stock';
  if (/理财|债/.test(name)) return 'bond';
  if (/定期|存单/.test(name)) return 'deposit';
  if (/房|车/.test(name)) return 'property';
  if (/保险|公积金|养老金|社保/.test(name)) return 'insurance';
  return 'cash';
}

export function balanceSheet(accounts, balances, at = Date.now()) {
  const latest = new Map();
  for (const b of balances) {
    if (b.time > at) continue;
    const cur = latest.get(b.accountId);
    if (!cur || b.time > cur.time) latest.set(b.accountId, b);
  }
  let assets = 0, liabilities = 0, liquid = 0, invest = 0, consumerDebt = 0;
  const rows = [];
  for (const a of accounts) {
    if (a.archived) continue;
    const b = latest.get(a.id);
    const raw = b?.value ?? 0;
    const v = toBase(raw, a.currency);
    const t = accountType(a.type);
    rows.push({ account: a, value: v, raw, currency: a.currency || 'CNY', updated: b?.time ?? null, type: t });
    if (t.liability) { liabilities += v; if (t.consumer) consumerDebt += v; }
    else { assets += v; if (t.liquid) liquid += v; if (t.invest) invest += v; }
  }
  return { assets, liabilities, net: assets - liabilities, liquid, invest, consumerDebt, rows };
}

// 每月末净资产（只在有余额记录之后才有值）
export function netWorthSeries(accounts, balances, months = 12, now = Date.now()) {
  if (!balances.length) return [];
  const first = Math.min(...balances.map(b => b.time));
  const d = new Date(now);
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const end = new Date(d.getFullYear(), d.getMonth() - i + 1, 1).getTime() - 1;
    if (end < first) continue;
    out.push({ label: `${new Date(end).getMonth() + 1}月`, value: balanceSheet(accounts, balances, Math.min(end, now)).net });
  }
  return out;
}

// 巴菲特式「财务体检」
export function healthCheck({ monthIn, monthOut, avgOut, sheet }) {
  const savingsRate = monthIn > 0 ? (monthIn - monthOut) / monthIn : null;
  const emergencyMonths = avgOut > 0 ? sheet.liquid / avgOut : null;
  const debtRatio = sheet.assets > 0 ? sheet.liabilities / sheet.assets : null;
  return { savingsRate, emergencyMonths, debtRatio, consumerDebt: sheet.consumerDebt };
}

// 复利：现有本金 + 每月投入，年化收益率 rate，年数 years
export function futureValue(principal, monthly, rate, years) {
  const r = rate / 12, n = years * 12;
  if (!r) return principal + monthly * n;
  return principal * (1 + r) ** n + monthly * (((1 + r) ** n - 1) / r);
}

// 某段时间按月平均支出
export function avgMonthlyOut(events, months = 3, now = Date.now()) {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth() - months, 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const firstEvent = Math.min(...events.filter(e => e.amount != null).map(e => e.time), end);
  const span = Math.max(1, Math.round((end - Math.max(start, firstEvent)) / (30 * DAY)));
  const out = events.filter(e => e.amount != null && e.direction !== 'in' && !e.reimbursable && e.time >= start && e.time < end).reduce((s, e) => s + toBase(e.amount, e.currency), 0);
  return out ? out / span : 0;
}

// ---------- 回顾问答（本地版） ----------
export function localAnswer(q, { events, usage, rules }) {
  const range = q.range;
  const days = Math.max(1, Math.round((Math.min(range.end, Date.now()) - Math.max(range.start, earliest(events, usage))) / DAY));
  const t = summarizeTime(events, usage, range, rules);
  const m = summarizeMoney(events, range);
  const parts = [];
  const head = range.label === '全部' ? '从开始记录到现在' : range.label;
  if (q.focus !== 'money') {
    if (!t.recorded && !t.device.total) {
      parts.push(`${head}还没有时间记录。`);
    } else {
      const cats = Object.entries(t.byCat).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([id, min]) => `${timeCatById(id).short}${fmtHours(min)}`).join('、');
      const tops = t.titles.slice(0, 5).map(x => `${x.title}（${fmtHours(x.min)}）`).join('、');
      if (t.recorded) parts.push(`${head}你记录了${fmtHours(t.recorded)}：${cats}。主要在做：${tops}。`);
      if (t.device.total) {
        const apps = t.device.apps.slice(0, 3).map(a => `${a.app}${fmtHours(a.min)}`).join('、');
        parts.push(`电脑上用了${fmtHours(t.device.total)}，最多的是${apps}。`);
      }
      if (t.focus.totalMin) parts.push(`整块专注时间${fmtHours(t.focus.totalMin)}，最长一次${fmtMin(t.focus.longestMin)}，90分钟以上的整块${t.focus.big}次。`);
    }
  }
  if (q.focus !== 'time') {
    if (!m.count) parts.push(`${q.focus === 'money' ? head : ''}没有收支记录。`);
    else {
      const cats = Object.entries(m.byCat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, v]) => `${catById(id).name}${fmtMoney(v)}`).join('、');
      let s = `${q.focus === 'money' ? head : ''}支出${fmtMoney(m.out)}${cats ? `（${cats}）` : ''}`;
      if (m.in) s += `，收入${fmtMoney(m.in)}，结余${fmtMoney(m.net)}`;
      if (days > 1) s += `，平均每天花${fmtMoney(m.out / days)}`;
      parts.push(s + '。');
      if (m.multiCurrency) {
        parts.push(`（按本位币折算；原币种：${Object.entries(m.byCurrency).filter(([, c]) => c.out).map(([cur, c]) => `${currencyById(cur).name}支出${fmtMoney(c.out, cur)}`).join('，')}）`);
      }
      if (m.biggest[0]) parts.push(`最大一笔是「${m.biggest[0].activity || m.biggest[0].note || catById(m.biggest[0].category).name}」${fmtRecMoney(m.biggest[0])}。`);
      if (m.reimbPending) parts.push(`另有待报销${fmtMoney(m.reimbPending)}（${m.pending.length}笔）还没报。`);
    }
  }
  return parts.join('');
}

function earliest(events, usage) {
  let min = Date.now();
  for (const e of events) if (e.time < min) min = e.time;
  for (const u of usage) if (u.start < min) min = u.start;
  return min;
}

// 给 AI 的数据摘要：聚合 + 关键明细，控制体积
export function dataDigest(q, { events, usage, rules, sheet }) {
  const range = q.range;
  const inRange = events.filter(e => e.time >= range.start && e.time < range.end).sort((a, b) => a.time - b.time);
  const t = summarizeTime(events, usage, range, rules);
  const m = summarizeMoney(events, range);
  const day = ms => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const lines = inRange.slice(-300).map(e => [
    day(e.time),
    e.activity || '',
    e.note || '',
    e.durationMin ? `用时${e.durationMin}分钟` : '',
    e.amount != null ? `${e.direction === 'in' ? '收入' : '支出'}${e.amount}${currencyById(e.currency).name}(${catById(e.category).name})${e.reimbursable ? (e.reimbursed ? '[已报销]' : '[待报销]') : ''}` : '',
  ].filter(Boolean).join(' | '));
  return {
    范围: range.label,
    记录的时间分钟_按类别: Object.fromEntries(Object.entries(t.byCat).map(([k, v]) => [timeCatById(k).name, Math.round(v)])),
    事项排行: t.titles.slice(0, 20).map(x => ({ 事项: x.title, 分钟: Math.round(x.min), 次数: x.n })),
    电脑使用分钟_按应用: t.device.apps.slice(0, 15).map(a => ({ 应用: a.app, 分钟: Math.round(a.min), 类别: timeCatById(a.cat).name })),
    整块专注: { 总分钟: Math.round(t.focus.totalMin), 最长分钟: Math.round(t.focus.longestMin), 九十分钟以上次数: t.focus.big },
    收支: {
      本位币: currencyById(FX.base).name, 说明: '金额已按汇率换算成本位币；要报销的支出不计入个人支出，报销款不计入收入',
      支出: m.out, 收入: m.in, 结余: m.net, 待报销: m.reimbPending, 已报销: m.reimbDone,
      支出按类别: Object.fromEntries(Object.entries(m.byCat).map(([k, v]) => [catById(k).name, round2(v)])),
      各币种原始金额: Object.fromEntries(Object.entries(m.byCurrency).map(([k, c]) => [currencyById(k).name, { 支出: round2(c.out), 收入: round2(c.in) }])),
    },
    当前净资产: sheet ? { 资产: sheet.assets, 负债: sheet.liabilities, 净资产: sheet.net } : null,
    明细: lines.length > 300 ? lines.slice(-300) : lines,
    明细说明: inRange.length > 300 ? `共${inRange.length}条，只列出最近300条` : `共${inRange.length}条`,
  };
}
