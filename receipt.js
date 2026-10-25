// 凭证识别：从小票 / 付款截图里读出金额、币种、日期时间、商家、用途和类别。
// 配置了 Claude 就用 AI 看图（准）；没有就在手机上做文字识别（OCR）再按规则解析（免费、离线可用但较粗）。
import { CATEGORIES, guessCategory, getDefaultCurrency } from './parser.js';
import { paymentHint } from './accounts.js';

// ---------- 规则解析（纯函数，便于测试） ----------

// 小票上常见的商家 / 品牌 → 类别（中文、英文、泰文）
const MERCHANT_KW = {
  food: ['starbucks', '星巴克', 'coffee', 'cafe', 'café', 'kfc', '肯德基', 'mcdonald', '麦当劳', 'burger', 'pizza', 'restaurant', '餐厅', '饭店', '酒楼', '面馆', 'bakery', 'mk ', 'sukiya', 'yayoi', 'swensen', 'luckin', '瑞幸', '喜茶', '奈雪', '蜜雪', 'ร้านอาหาร', 'กาแฟ', 'อาหาร', 'beverage', 'drink', 'food'],
  transport: ['grab', 'bolt', 'taxi', 'bts', 'mrt', 'airport rail', '滴滴', '出租', '加油', 'ptt', 'shell', 'esso', 'bangchak', 'caltex', '停车', 'parking', 'toll', 'แท็กซี่', 'น้ำมัน', '高铁', '12306', 'airasia', 'thai airways', '航空'],
  shopping: ['7-eleven', '7-11', 'seven eleven', 'family mart', 'familymart', 'lawson', 'big c', 'lotus', "lotus's", 'tops', 'makro', 'villa market', 'gourmet market', 'watsons', 'boots', 'central', 'uniqlo', 'ikea', '超市', '便利店', 'supermarket', 'mart', '沃尔玛', '永辉', '盒马', 'ร้านสะดวกซื้อ', 'ห้าง'],
  travel: ['hotel', 'resort', 'hostel', ' inn ', 'room charge', 'nights', 'check-in', 'check in', 'agoda', 'booking.com', 'airbnb', 'trip.com', '携程', '酒店', '宾馆', '民宿', '房费', 'โรงแรม', 'ห้องพัก'],
  health: ['pharmacy', 'hospital', 'clinic', '药房', '药店', '医院', '诊所', 'ร้านยา', 'โรงพยาบาล', 'คลินิก'],
  fun: ['cinema', 'major', 'sf cinema', '影城', '电影', 'massage', 'spa', '按摩', 'นวด', 'karaoke', 'ktv', 'bar ', 'pub'],
  home: ['电费', '水费', '燃气', '物业', 'ais', 'true move', 'dtac', '中国移动', '中国联通', '中国电信', 'การไฟฟ้า', 'การประปา'],
};

export function guessReceiptCategory(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  let best = null, score = 0;
  for (const [id, words] of Object.entries(MERCHANT_KW)) {
    const s = words.reduce((n, w) => n + (t.includes(w) ? w.length : 0), 0);
    if (s > score) { best = id; score = s; }
  }
  return best || guessCategory(t) || 'other';
}

// 数字：1,234.50 / 1 234,50（欧式）/ 1234
const NUM_RE = /(?<![\d.,])(\d{1,3}(?:[,，]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d])/g;
const toNum = s => parseFloat(String(s).replace(/[,，]/g, ''));

// 按优先级找「实付总额」的关键词；越靠前越可信
const TOTAL_KW = [
  /实付|实收|应付|实际支付|支付金额|付款金额|交易金额|消费金额|订单金额|grand\s*total|amount\s*paid|total\s*paid|net\s*total|amount\s*due|balance\s*due|ยอดสุทธิ|ยอดชำระ|รวมทั้งสิ้น|ยอดเงินสุทธิ/i,
  /合计|总计|总额|总价|小计后|total|รวมเงิน|ยอดรวม|รวม/i,
  /金额|amount|price|จำนวนเงิน|ราคา/i,
];
// 这些行的数字不是消费金额
const NOT_TOTAL = /找零|找赎|change|เงินทอน|เงินสด|现金|收到|\bcash\b|รับเงิน|subtotal|小计|折扣|discount|ส่วนลด|vat\s*\d|税率|tax\s*id|เลขประจำตัว|电话|tel|phone|โทร|卡号|card\s*no|no\.|单号|流水|订单号|invoice\s*no|เลขที่|积分|point/i;

function findTotal(lines) {
  for (const kw of TOTAL_KW) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!kw.test(line) || NOT_TOTAL.test(line)) continue;
      const nums = [...line.matchAll(NUM_RE)].map(m => toNum(m[1])).filter(n => n > 0 && n < 1e7);
      // 金额在关键词同一行，或者在下一行（截图常见排版）
      const next = !nums.length && lines[i + 1] ? [...lines[i + 1].matchAll(NUM_RE)].map(m => toNum(m[1])).filter(n => n > 0 && n < 1e7) : [];
      const pick = nums.length ? nums[nums.length - 1] : next[0];
      if (pick) return pick;
    }
  }
  // 没有关键词：取带两位小数或带币种符号的最大金额
  const cands = [];
  for (const line of lines) {
    if (NOT_TOTAL.test(line)) continue;
    for (const m of line.matchAll(/(?:[¥￥$฿]\s*)(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*\.\d{2})(?!\d)/g)) {
      const n = toNum(m[1] || m[2]);
      if (n > 0 && n < 1e7) cands.push(n);
    }
  }
  return cands.length ? Math.max(...cands) : null;
}

export function guessReceiptCurrency(text, fallback = getDefaultCurrency()) {
  const t = String(text);
  if (/฿|บาท|\bTHB\b|\bbaht\b/i.test(t)) return 'THB';
  if (/[¥￥]|人民币|\bRMB\b|\bCNY\b|元/.test(t)) return 'CNY';
  if (/US\$|\bUSD\b|\$/.test(t)) return 'USD';
  if (/[฀-๿]/.test(t)) return 'THB';      // 泰文小票
  if (/[一-龥]{4,}/.test(t)) return 'CNY';  // 中文小票
  return fallback;
}

// 年份：泰国小票常用佛历（2569 = 2026），两位数年份也可能是佛历（69 = 2569）
function fixYear(y, now) {
  const cur = new Date(now).getFullYear();
  if (y >= 2400) return y - 543;
  if (y < 100) {
    const ad = 2000 + y;
    if (ad <= cur + 1) return ad;
    const be = 2500 + y - 543;
    if (Math.abs(be - cur) <= 1) return be;
    return ad;
  }
  return y;
}

export function findReceiptDate(text, now = Date.now()) {
  const t = String(text);
  const ok = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null;
  let m;
  if ((m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(t))) return ok(fixYear(+m[1], now), +m[2], +m[3]);
  if ((m = /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(t))) return ok(fixYear(+m[1], now), +m[2], +m[3]);
  if ((m = /(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/.exec(t))) {
    let a = +m[1], b = +m[2];
    const y = fixYear(+m[3], now);
    // 默认 日/月/年（泰国、欧洲）；第二个数大于 12 时说明是 月/日/年（美国）
    if (b > 12 && a <= 12) [a, b] = [b, a];
    return ok(y, b, a);
  }
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  if ((m = /(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(\d{4})/i.exec(t))) return ok(fixYear(+m[3], now), MON[m[2].toLowerCase()], +m[1]);
  if ((m = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2}),?\s*(\d{4})/i.exec(t))) return ok(fixYear(+m[3], now), MON[m[1].toLowerCase()], +m[2]);
  if ((m = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(t))) return ok(new Date(now).getFullYear(), +m[1], +m[2]);
  return null;
}

export function findReceiptTime(text) {
  // 只认「:」分隔，避免把「23.00」这样的价格当成时间
  const m = /(?<![\d.])([01]?\d|2[0-3])[:：]([0-5]\d)(?:[:：][0-5]\d)?(?!\d)/.exec(String(text));
  return m ? { h: +m[1], min: +m[2] } : null;
}

const NOISE_LINE = /^(receipt|tax\s*invoice|invoice|收据|发票|小票|购物小票|欢迎光临|welcome|thank|谢谢|ใบเสร็จ|ใบกำกับภาษี|copy|customer|cashier|收银|pos|date|time|日期|时间|tel|电话|vat|tax|no\.|单号|\*+|-+|=+)/i;

export function findMerchant(lines) {
  for (const raw of lines.slice(0, 6)) {
    const line = raw.replace(/[*#=_|~]+/g, ' ').trim();
    if (line.length < 2 || line.length > 40) continue;
    if (NOISE_LINE.test(line)) continue;
    const letters = (line.match(/[A-Za-z一-龥฀-๿]/g) || []).length;
    if (letters < Math.max(2, line.length * 0.5)) continue;
    return line;
  }
  return null;
}

// 读几行商品名当作「用途」
function findItems(lines) {
  const items = [];
  for (const line of lines) {
    if (items.length >= 3) break;
    if (NOISE_LINE.test(line) || NOT_TOTAL.test(line) || TOTAL_KW.some(k => k.test(line))) continue;
    // 「商品名 [数量] 价格」，商品名以文字开头，可以带数字（如 WATER 600ML）
    const m = /^([A-Za-z一-龥฀-๿].{0,24}?)\s+(?:x?\d{1,2}\s+)?[¥￥$฿]?\d[\d,]*\.\d{2}\s*$/.exec(line.trim());
    if (m) items.push(m[1].trim());
  }
  return items;
}

export function parseReceiptText(text, now = Date.now()) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const all = lines.join('\n');
  const merchant = findMerchant(lines);
  const items = findItems(lines);
  const date = findReceiptDate(all, now);
  const time = findReceiptTime(all);
  const amount = findTotal(lines);
  let at = null;
  if (date) at = new Date(date.y, date.m - 1, date.d, time?.h ?? 12, time?.min ?? 0).getTime();
  else if (time) { const d = new Date(now); d.setHours(time.h, time.min, 0, 0); at = d.getTime(); }
  return {
    merchant,
    purpose: items.length ? items.join('、') : null,
    amount,
    currency: amount != null ? guessReceiptCurrency(all) : null,
    time: at,
    category: guessReceiptCategory(`${merchant || ''}\n${all}`),
    payment: paymentHint(all),   // 微信 / 支付宝 / 现金 / 泰铢卡 / 银行卡
    source: 'ocr',
  };
}

// ---------- 识别入口 ----------

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let ocrWorker = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('文字识别组件下载失败，请联网后再试'));
    document.head.appendChild(s);
  });
}

// 本地 OCR：第一次要下载约十几 MB 的识别模型（中文 / 英文 / 泰文），之后会缓存
async function localOcr(blob, onProgress) {
  await loadScript(TESSERACT_URL);
  ocrWorker ??= window.Tesseract.createWorker(['chi_sim', 'eng', 'tha'], 1, {
    logger: m => m.status && onProgress?.(m.status === 'recognizing text' ? `识别中 ${Math.round(m.progress * 100)}%` : '准备识别组件…'),
  });
  const worker = await ocrWorker;
  const { data } = await worker.recognize(blob);
  return data.text;
}

// 返回 {merchant, purpose, amount, currency, time, category, source}；识别不出时抛错
export async function recognizeReceipt(blob, { ai = null, aiReceipt = null, onProgress } = {}) {
  if (ai && aiReceipt) {
    try {
      onProgress?.('AI 正在看凭证…');
      return { ...(await aiReceipt(ai, blob)), source: 'ai' };
    } catch (e) {
      onProgress?.('AI 不可用，改用手机识别…');
    }
  }
  const text = await localOcr(blob, onProgress);
  const r = parseReceiptText(text);
  if (r.amount == null && !r.merchant) throw new Error('没认出内容，可以拍清楚一点或手动填');
  return { ...r, text };
}

export const CATEGORY_IDS = CATEGORIES.map(c => c.id);
