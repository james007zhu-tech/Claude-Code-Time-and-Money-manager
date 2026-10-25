// 从一句中文说明里识别金额和类别，例如「打车去公司花了二十八块五」→ 28.5 / 交通

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
  { id: 'other', name: '其他', icon: '📝', kw: [] },
];

export const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 壹: 1, 幺: 1, 二: 2, 贰: 2, 两: 2, 俩: 2, 三: 3, 叁: 3, 仨: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9 };
const CN_UNIT = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };
const CN_CHARS = Object.keys(CN_DIGIT).join('') + Object.keys(CN_UNIT).join('') + '万';
const NUM = `(?:\\d+(?:\\.\\d+)?|[${CN_CHARS}]+)`;
const YUAN = '(?:块钱|块|元钱|元|圆|快)';
const JIAO = '(?:毛钱|毛|角)';
// 「35块5」里的 5 是角；但「35块两个人」里的「两」不是
const MEASURE = '个人次份张件杯瓶位天小斤盒包';

// 中文数字转数值：十五→15，两百→200，一百五→150，一万二→12000
export function cnToNumber(str) {
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

export function parseAmount(text) {
  if (!text) return null;
  const src = String(text).replace(/(\d),(\d{3})/g, '$1$2');
  let rest = src;
  const found = [];
  const take = (re, toValue) => {
    rest = rest.replace(re, (m, ...args) => {
      const index = args[args.length - 2];
      const v = toValue(...args);
      if (v > 0 && Number.isFinite(v)) found.push({ index, value: round2(v) });
      return ' '.repeat(m.length);
    });
  };

  // 128块 / 28块5 / 三块五毛 / 十块钱
  take(new RegExp(`(${NUM})\\s*${YUAN}(?:\\s*(?:(${NUM})\\s*${JIAO}|([一二三四五六七八九两\\d])(?![\\d${CN_CHARS}${MEASURE}])))?`, 'g'),
    (a, jiao1, jiao2) => cnToNumber(a) + (jiao1 || jiao2 ? cnToNumber(jiao1 || jiao2) / 10 : 0));
  // 五毛
  take(new RegExp(`(${NUM})\\s*${JIAO}`, 'g'), a => cnToNumber(a) / 10);
  // ¥35 / 35rmb
  take(/[¥￥]\s*(\d+(?:\.\d+)?)/g, a => parseFloat(a));
  take(/(\d+(?:\.\d+)?)\s*(?:rmb|人民币)/gi, a => parseFloat(a));

  if (!found.length) {
    // 没有「块/元」时，看「花了 35」之类
    const m = new RegExp(`(?:花了|花费|付了|付款|支付|消费|一共|总共|共计|合计|总计|掏了|用了)\\s*(${NUM})`).exec(src);
    if (m) {
      const v = cnToNumber(m[1]);
      return v > 0 ? round2(v) : null;
    }
    return null;
  }

  // 说了「一共/总共」就以它为准，否则把几笔加起来
  const totalKw = /一共|总共|共计|合计|总计/g;
  let km;
  while ((km = totalKw.exec(src))) {
    const after = found.find(f => f.index >= km.index && f.index - (km.index + km[0].length) <= 4);
    if (after) return after.value;
  }
  return round2(found.reduce((s, f) => s + f.value, 0));
}

export function guessCategory(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  let best = null, bestScore = 0;
  for (const c of CATEGORIES) {
    let score = 0;
    for (const k of c.kw) if (t.includes(k)) score += k.length;
    if (score > bestScore) { best = c.id; bestScore = score; }
  }
  return best;
}

export function parseExpense(text) {
  return { amount: parseAmount(text), category: guessCategory(text) };
}
