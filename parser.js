// 本地理解一句中文：记一笔（时间 + 钱）、开始/结束一件事、更新账户余额、提问回顾。
// 不联网也能用；配置了 Claude 后由 ai.js 做更聪明的理解。

export const CATEGORIES = [
  { id: 'food', name: '餐饮', icon: '🍜', kw: ['吃', '饭', '餐', '早点', '夜宵', '宵夜', '外卖', '咖啡', '奶茶', '饮料', '水果', '零食', '火锅', '烧烤', '面条', '拉面', '米粉', '包子', '茶', '酒', '聚餐', '食堂', '买单', '美团', '饿了么', '喝'] },
  { id: 'transport', name: '交通', icon: '🚕', kw: ['打车', '滴滴', '出租', '地铁', '公交', '高铁', '火车', '机票', '飞机', '加油', '油费', '停车', '过路费', '高速', '单车', '车费', '车票', '网约车', '充电', '洗车'] },
  { id: 'shopping', name: '购物', icon: '🛍️', kw: ['买', '超市', '淘宝', '京东', '拼多多', '衣服', '裤子', '鞋', '日用', '商场', '网购', '便利店'] },
  { id: 'fun', name: '娱乐', icon: '🎮', kw: ['电影', '游戏', 'ktv', '唱歌', '旅游', '门票', '健身', '打球', '演唱会', '会员', '景点', '酒店'] },
  { id: 'home', name: '居家', icon: '🏠', kw: ['房租', '水费', '电费', '燃气', '物业', '话费', '宽带', '维修', '家具', '家电', '保洁', '快递'] },
  { id: 'health', name: '医疗', icon: '💊', kw: ['医院', '看病', '药', '挂号', '体检', '牙', '诊所'] },
  { id: 'study', name: '学习', icon: '📚', kw: ['书', '课', '培训', '学费', '考试', '文具', '打印'] },
  { id: 'social', name: '人情', icon: '🎁', kw: ['红包', '礼物', '请客', '份子', '送礼', '随礼', '礼金'] },
  { id: 'work', name: '工作', icon: '💼', kw: ['办公', '出差', '报销', '客户', '差旅', '会议'] },
  { id: 'invest', name: '投资', icon: '📈', kw: ['基金', '股票', '定投', '理财', '债券', '买入', '申购'] },
  { id: 'other', name: '其他', icon: '📝', kw: [] },
];

export const INCOME_CATEGORIES = [
  { id: 'salary', name: '工资', icon: '💰', kw: ['工资', '薪水', '薪资', '月薪'] },
  { id: 'bonus', name: '奖金', icon: '🏆', kw: ['奖金', '年终', '提成', '绩效'] },
  { id: 'invest_income', name: '投资收益', icon: '📈', kw: ['分红', '利息', '收益', '股息', '卖出'] },
  { id: 'side', name: '副业', icon: '🧰', kw: ['副业', '兼职', '稿费', '咨询费', '外快'] },
  { id: 'refund', name: '报销退款', icon: '↩️', kw: ['报销', '退款', '退回'] },
  { id: 'other_income', name: '其他收入', icon: '💵', kw: [] },
];

// 德鲁克：先记录时间，再分析，最后把可自由支配的时间整合成大块。
// kind=focus 的是「要事」，用来计算整块时间。
export const TIME_CATS = [
  { id: 'deep', name: '要事·深度工作', short: '要事', icon: '🎯', kind: 'focus', kw: ['写', '方案', '设计', '编程', '代码', '开发', '报告', '策划', '研究', '分析', '思考', '规划', '复盘', '创作', '写作'] },
  { id: 'meeting', name: '沟通会议', short: '沟通', icon: '💬', kind: 'collab', kw: ['开会', '会议', '沟通', '电话', '拜访', '客户', '面试', '谈', '约见', '汇报', '讨论', '见'] },
  { id: 'admin', name: '事务杂项', short: '杂务', icon: '📋', kind: 'admin', kw: ['邮件', '回复', '报销', '整理', '填表', '审批', '办事', '手续', '排队', '杂事'] },
  { id: 'learn', name: '学习成长', short: '学习', icon: '📚', kind: 'focus', kw: ['学习', '看书', '书', '读书', '上课', '课程', '培训', '练习', '背单词', '听课'] },
  { id: 'health', name: '运动健康', short: '健康', icon: '🏃', kind: 'life', kw: ['跑步', '健身', '运动', '游泳', '瑜伽', '散步', '打球', '医院', '看病', '体检', '睡觉', '午睡'] },
  { id: 'family', name: '家庭生活', short: '生活', icon: '🏠', kind: 'life', kw: ['家务', '做饭', '吃饭', '买菜', '超市', '陪', '孩子', '老婆', '老公', '父母', '家人', '接送', '带娃', '洗衣'] },
  { id: 'commute', name: '通勤路上', short: '路上', icon: '🚇', kind: 'life', kw: ['通勤', '路上', '打车', '地铁', '开车', '坐车', '高铁', '飞机', '出差路上'] },
  { id: 'leisure', name: '休闲娱乐', short: '休闲', icon: '🎮', kind: 'leisure', kw: ['刷', '抖音', '视频', '游戏', '电影', '电视', '追剧', '微博', '小红书', 'b站', '玩', '休息', '聊天'] },
  { id: 'other', name: '其他', short: '其他', icon: '⏱', kind: 'other', kw: [] },
];

const findById = list => id => list.find(c => c.id === id) || list[list.length - 1];
export const catById = id => (INCOME_CATEGORIES.some(c => c.id === id) ? findById(INCOME_CATEGORIES)(id) : findById(CATEGORIES)(id));
export const timeCatById = findById(TIME_CATS);

// ---------- 数字 ----------
const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 壹: 1, 幺: 1, 二: 2, 贰: 2, 两: 2, 俩: 2, 三: 3, 叁: 3, 仨: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9 };
const CN_UNIT = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };
const CN_CHARS = Object.keys(CN_DIGIT).join('') + Object.keys(CN_UNIT).join('') + '万';
// 128 / 28.5 / 5万3 / 1.5万 / 一百二十八
export const NUM = `(?:\\d+(?:\\.\\d+)?(?:[万千](?:[\\d一二三四五六七八九两](?![\\d.]))?)?|[${CN_CHARS}]+)`;
const YUAN = '(?:块钱|块|元钱|元|圆|快)';
const JIAO = '(?:毛钱|毛|角)';
const MEASURE = '个人次份张件杯瓶位天小斤盒包';

export function cnToNumber(str) {
  const mixed = /^(\d+(?:\.\d+)?)(万|千)?(.)?$/.exec(str);
  if (mixed) {
    const unit = mixed[2] === '万' ? 10000 : mixed[2] === '千' ? 1000 : 1;
    const tail = mixed[3] ? (/\d/.test(mixed[3]) ? Number(mixed[3]) : CN_DIGIT[mixed[3]] ?? 0) : 0;
    return parseFloat(mixed[1]) * unit + tail * unit / 10;
  }
  if (/^\d/.test(str)) return parseFloat(str);
  let total = 0, section = 0, digit = null, lastUnit = 1, sawZero = false;
  for (const ch of str) {
    if (ch in CN_DIGIT) {
      if (CN_DIGIT[ch] === 0) sawZero = true;
      digit = digit === null ? CN_DIGIT[ch] : digit * 10 + CN_DIGIT[ch];
    } else if (ch in CN_UNIT) {
      section += (digit ?? 1) * CN_UNIT[ch];
      lastUnit = CN_UNIT[ch];
      digit = null;
      sawZero = false;
    } else if (ch === '万') {
      total += (section + (digit ?? 0) || 1) * 10000;
      section = 0;
      digit = null;
      lastUnit = 10000;
      sawZero = false;
    }
  }
  if (digit !== null) {
    // 口语省略：「一百五」= 150，「一万二」= 12000
    section += !sawZero && lastUnit >= 100 && digit < 10 ? digit * lastUnit / 10 : digit;
  }
  return total + section;
}

const round2 = n => Math.round(n * 100) / 100;

// 找出所有金额，返回 [{index, length, value}]
function findAmounts(src) {
  let rest = src;
  const found = [];
  const take = (re, toValue) => {
    rest = rest.replace(re, (m, ...args) => {
      const index = args[args.length - 2];
      const v = toValue(...args);
      if (v > 0 && Number.isFinite(v)) found.push({ index, length: m.length, value: round2(v) });
      return ' '.repeat(m.length);
    });
  };
  // 128块 / 28块5 / 三块五毛 / 十块钱
  take(new RegExp(`(${NUM})\\s*${YUAN}(?:\\s*(?:(${NUM})\\s*${JIAO}|([一二三四五六七八九两\\d])(?![\\d${CN_CHARS}${MEASURE}])))?`, 'g'),
    (a, jiao1, jiao2) => cnToNumber(a) + (jiao1 || jiao2 ? cnToNumber(jiao1 || jiao2) / 10 : 0));
  take(new RegExp(`(${NUM})\\s*${JIAO}`, 'g'), a => cnToNumber(a) / 10);
  take(/[¥￥]\s*(\d+(?:\.\d+)?)/g, a => parseFloat(a));
  take(/(\d+(?:\.\d+)?)\s*(?:rmb|人民币)/gi, a => parseFloat(a));
  if (!found.length) {
    // 没说「块/元」时，看「花了 35」「余额 5万3」之类
    take(new RegExp(`(?:花了|花费|付了|付款|支付|消费|一共|总共|共计|合计|总计|掏了|用了|余额|还剩|还有|到账|收到|进账|入账|赚了|市值|欠了|欠|发了|是)\\s*(${NUM})(?![${CN_CHARS}\\d]*\\s*(?:个|点|小时|分钟|天|号|月|年|岁|人|次))`, 'g'),
      a => cnToNumber(a));
  }
  return found.sort((a, b) => a.index - b.index);
}

export function parseAmount(text) {
  if (!text) return null;
  const src = String(text).replace(/(\d),(\d{3})/g, '$1$2');
  const found = findAmounts(src);
  if (!found.length) return null;
  // 说了「一共/总共」就以它为准，否则把几笔加起来
  const totalKw = /一共|总共|共计|合计|总计/g;
  let km;
  while ((km = totalKw.exec(src))) {
    const after = found.find(f => f.index >= km.index && f.index - (km.index + km[0].length) <= 4);
    if (after) return after.value;
  }
  return round2(found.reduce((s, f) => s + f.value, 0));
}

function bestByKeywords(list, text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  let best = null, bestScore = 0;
  for (const c of list) {
    let score = 0;
    for (const k of c.kw) if (t.includes(k)) score += k.length;
    if (score > bestScore) { best = c.id; bestScore = score; }
  }
  return best;
}
export const guessCategory = text => bestByKeywords(CATEGORIES, text);
export const guessIncomeCategory = text => bestByKeywords(INCOME_CATEGORIES, text) || 'other_income';
export const guessTimeCat = text => bestByKeywords(TIME_CATS, text);

export function parseExpense(text) {
  return { amount: parseAmount(text), category: guessCategory(text) };
}

// ---------- 时间 ----------
const CLOCK_NUM = '(?:\\d{1,2}|[零一二两三四五六七八九十]{1,3})';
const PERIOD = '(?:凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|半夜)?';
const CLOCK = `(${PERIOD})\\s*(${CLOCK_NUM})\\s*(?:点|时|:|：)\\s*(半|一刻|三刻|${CLOCK_NUM})?(?:分)?`;

function toHour(period, h) {
  if (/下午|傍晚|晚上|夜里/.test(period) && h < 12) return h + 12;
  if (period === '中午' && h < 6) return h + 12;
  if (/半夜/.test(period) && h === 12) return 0;
  return h;
}
// parts = [时段, 时, 分]
function clockMinutes([p, hs, ms], inheritPeriod) {
  const period = p || inheritPeriod || '';
  const h = cnToNumber(hs);
  const mm = !ms ? 0 : ms === '半' ? 30 : ms === '一刻' ? 15 : ms === '三刻' ? 45 : cnToNumber(ms);
  return { min: toHour(period, h) * 60 + mm, period };
}

export function parseDuration(text) {
  let total = 0, hit = false;
  const s = String(text);
  const re = new RegExp(`(${NUM}|半)\\s*(?:个)?\\s*(半)?\\s*(小时|钟头|分钟)(半)?`, 'g');
  let m;
  while ((m = re.exec(s))) {
    const n = m[1] === '半' ? 0.5 : cnToNumber(m[1]);
    const extra = m[2] || m[4] ? 0.5 : 0;
    total += m[3] === '分钟' ? n : (n + extra) * 60;
    hit = true;
  }
  return hit ? Math.round(total) : null;
}

// 返回 {start, durationMin}；没提到时间返回 null
export function parseTimeInfo(text, now = Date.now()) {
  const s = String(text);
  const dayOffset = /大前天/.test(s) ? -3 : /前天/.test(s) ? -2 : /昨天|昨晚|昨日/.test(s) ? -1 : 0;
  const base = new Date(now);
  base.setDate(base.getDate() + dayOffset);
  const at = min => { const d = new Date(base); d.setHours(0, 0, 0, 0); return d.getTime() + min * 60000; };

  const range = new RegExp(`${CLOCK}\\s*(?:到|至|-|~|—|－)\\s*${CLOCK}`).exec(s);
  if (range) {
    const a = clockMinutes(range.slice(1, 4));
    let b = clockMinutes(range.slice(4, 7), a.period);
    let end = b.min;
    if (!range[4] && end <= a.min && end + 720 > a.min) end += 720; // 「10点到2点」= 10:00–14:00
    if (end <= a.min) end += 1440;
    return { start: at(a.min), durationMin: end - a.min };
  }
  const dur = parseDuration(s);
  const single = new RegExp(CLOCK).exec(s);
  if (single) {
    return { start: at(clockMinutes(single.slice(1, 4)).min), durationMin: dur };
  }
  if (dur) return { start: (dayOffset ? at(new Date(now).getHours() * 60 + new Date(now).getMinutes()) : now) - dur * 60000, durationMin: dur };
  if (dayOffset) return { start: at(12 * 60), durationMin: null };
  return null;
}

// ---------- 提问的时间范围 ----------
const DAY = 86400000;
function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

export function rangeOf(key, now = Date.now(), n = 1) {
  const today = startOfDay(now);
  const d = new Date(today);
  const dow = (d.getDay() + 6) % 7; // 周一为一周开始
  switch (key) {
    case 'today': return { start: today, end: today + DAY, label: '今天' };
    case 'yesterday': return { start: today - DAY, end: today, label: '昨天' };
    case 'beforeYesterday': return { start: today - 2 * DAY, end: today - DAY, label: '前天' };
    case 'days': return { start: today - (n - 1) * DAY, end: today + DAY, label: n === 3 ? '这几天' : `最近${n}天` };
    case 'week': return { start: today - dow * DAY, end: today + DAY, label: '本周' };
    case 'lastWeek': return { start: today - (dow + 7) * DAY, end: today - dow * DAY, label: '上周' };
    case 'month': return { start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: today + DAY, label: '本月' };
    case 'lastMonth': return { start: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), end: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), label: '上个月' };
    case 'months': return { start: new Date(d.getFullYear(), d.getMonth() - n + 1, 1).getTime(), end: today + DAY, label: `最近${n}个月` };
    case 'year': return { start: new Date(d.getFullYear(), 0, 1).getTime(), end: today + DAY, label: '今年' };
    case 'lastYear': return { start: new Date(d.getFullYear() - 1, 0, 1).getTime(), end: new Date(d.getFullYear(), 0, 1).getTime(), label: '去年' };
    case 'years': return { start: new Date(d.getFullYear() - n + 1, 0, 1).getTime(), end: today + DAY, label: `最近${n}年` };
    case 'all': return { start: 0, end: today + DAY, label: '全部' };
    default: return rangeOf('days', now, 7);
  }
}

export function parseRange(text, now = Date.now()) {
  const s = String(text);
  const n = new RegExp(`(?:最近|过去|近)\\s*(${NUM}|几)\\s*(?:个)?\\s*(天|周|星期|礼拜|月|年)`).exec(s);
  if (n) {
    const k = n[1] === '几' ? 3 : cnToNumber(n[1]);
    if (n[2] === '天') return rangeOf('days', now, k);
    if (/周|星期|礼拜/.test(n[2])) return { ...rangeOf('days', now, k * 7), label: `最近${k}周` };
    if (n[2] === '月') return rangeOf('months', now, k);
    return rangeOf('years', now, k);
  }
  const table = [
    [/这几年|这些年|这两年|这么多年|有史以来|以来|所有|全部|一直以来/, 'all'],
    [/去年/, 'lastYear'], [/今年|这一年/, 'year'],
    [/上个?月/, 'lastMonth'], [/这个月|本月|这月/, 'month'],
    [/上周|上个?星期|上个?礼拜/, 'lastWeek'], [/这周|本周|这个?星期|这个?礼拜|这一周/, 'week'],
    [/前天/, 'beforeYesterday'], [/昨天|昨晚/, 'yesterday'], [/今天|今日|今儿/, 'today'],
  ];
  for (const [re, key] of table) if (re.test(s)) return rangeOf(key, now);
  if (/这几天|这两天|最近几天|这些天|近来/.test(s)) return rangeOf('days', now, 3);
  return rangeOf('days', now, 7);
}

// ---------- 整句意图 ----------
const isQuestion = s => (/[?？]|吗|呢|多少|什么|哪些|哪儿|哪里|几个|怎么样|如何|啥/.test(s) && /干|做|花|用|时间|钱|收入|支出|忙|去哪|赚|存|资产|情况|进展/.test(s)) || /^(问一?下|查一?下|看看|统计|总结|回顾)/.test(s);

function cleanTitle(s) {
  return s
    .replace(/[，。,.！!？?、；;]+/g, ' ')
    .replace(/^(我|刚才|刚刚|今天|昨天|前天|上午|下午|晚上)+/g, '')
    .replace(/(花了|花费|付了|一共|总共|用了)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '')
    .trim()
    .slice(0, 30);
}

export function parseUtterance(text, now = Date.now()) {
  const raw = String(text || '').trim();
  const s = raw.replace(/(\d),(\d{3})/g, '$1$2');
  if (!s) return { type: 'empty' };

  if (isQuestion(s)) {
    const focus = /时间|干|做|忙|去哪/.test(s) ? (/花.*钱|钱|支出|收入|赚/.test(s) ? 'all' : 'time') : /花|钱|支出|收入|赚|消费|存|资产/.test(s) ? 'money' : 'all';
    return { type: 'question', text: raw, range: parseRange(s, now), focus };
  }

  const finish = /^(我)?(已经|刚)?(做完|干完|弄完|忙完|搞定|结束|完成|完事)(了|啦)?[，,。\s]*/.exec(s);
  if (finish) {
    const rest = s.slice(finish[0].length);
    return { type: 'finish', entry: rest ? parseEntry(rest, now) : null };
  }

  const start = /^(我)?(现在|马上|准备|开始|要开始|这就)+(去|要)?(开始)?(.{1,30})$/.exec(s);
  if (start && parseAmount(s) == null && !/了$/.test(s)) {
    // 「开始写方案，预计两小时」：时长是计划，不算标题
    const plan = new RegExp(`[，,\\s]*(?:预计|大概|计划|估计|要|用)?\\s*(?:${NUM}|半)\\s*(?:个)?\\s*半?\\s*(?:小时|钟头|分钟)半?(?:左右)?$`);
    const title = start[5].replace(plan, '');
    return { type: 'start', title: cleanTitle(title), timeCat: guessTimeCat(title), planMin: parseDuration(start[5]) || 0 };
  }

  const amount = parseAmount(s);
  const bal = /(余额|还剩|现在有|里有|账上|市值|总值|估值|还欠|欠款|欠了|房贷|车贷|信用卡|负债|贷款)/.exec(s);
  if (bal && amount != null && !/花|买|付/.test(s.replace(/支付宝/g, ''))) {
    const liability = /欠|贷|信用卡|负债/.test(s);
    let account = s.slice(0, bal.index).replace(/^(我的?|现在|目前)+/, '').replace(/(的|里|上|卡里)$/, '').trim();
    if (!account) account = liability ? s.match(/房贷|车贷|信用卡|贷款/)?.[0] || '负债' : '现金';
    if (/房贷|车贷/.test(bal[1]) && !/房贷|车贷/.test(account)) account = (account + bal[1]).trim();
    return { type: 'balance', account, value: amount, liability, text: raw };
  }

  return { type: 'entry', ...parseEntry(s, now) };
}

export function parseEntry(text, now = Date.now()) {
  const s = String(text);
  const amount = parseAmount(s);
  const income = amount != null && /(工资|薪水|薪资|收入|到账|收到|奖金|分红|利息|进账|赚了|入账|报销款|退款|发了|提成|稿费)/.test(s);
  const time = parseTimeInfo(s, now);
  return {
    title: cleanTitle(stripForTitle(s)),
    note: s.trim(),
    amount,
    direction: income ? 'in' : 'out',
    category: amount == null ? null : income ? guessIncomeCategory(s) : guessCategory(s) || 'other',
    timeCat: guessTimeCat(s),
    start: time?.start ?? null,
    durationMin: time?.durationMin ?? null,
  };
}

function stripForTitle(s) {
  let t = s;
  for (const f of findAmounts(t).reverse()) t = t.slice(0, f.index) + t.slice(f.index + f.length);
  t = t.replace(new RegExp(`${CLOCK}\\s*(?:到|至|-|~|—|－)\\s*${CLOCK}`, 'g'), ' ')
    .replace(new RegExp(`(${NUM}|半)\\s*(?:个)?\\s*(半)?\\s*(小时|钟头|分钟)(半)?`, 'g'), ' ')
    .replace(/(花了|花费|付了|一共|总共|用了|大概|左右|差不多)/g, ' ');
  return t.trim() || s;
}
