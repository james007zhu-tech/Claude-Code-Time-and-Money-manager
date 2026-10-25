// 可选：用 Claude 理解语音、回答「这几天干了什么」。
// 用户在设置里填自己的 API Key，只存在本机；不填就用 parser.js 的本地理解。
import { CATEGORIES, INCOME_CATEGORIES, TIME_CATS, CURRENCIES, currencyById, getDefaultCurrency } from './parser.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm';
export const AI_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5（最聪明）' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5（更快更省）' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5（最便宜）' },
];

let cached = { key: null, client: null };
async function getClient(apiKey) {
  if (cached.key === apiKey && cached.client) return cached.client;
  const { default: Anthropic } = await import(SDK_URL);
  cached = { key: apiKey, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) };
  return cached.client;
}

// user 可以是文字，也可以是内容块数组（例如图片 + 文字）
async function ask(cfg, { system, user, effort, schema, maxTokens = 16000 }) {
  const client = await getClient(cfg.apiKey);
  const params = {
    model: cfg.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
  };
  // Opus / Sonnet 支持服务端兜底：被安全策略拒绝时自动换模型重试
  const res = cfg.model.includes('haiku')
    ? await client.messages.create(params)
    : await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  if (res.stop_reason === 'refusal') throw new Error('Claude 拒绝了这个请求');
  if (res.stop_reason === 'max_tokens') throw new Error('回答太长被截断了');
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

const nullable = type => ({ type: [type, 'null'] });
const PARSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'title', 'note', 'amount', 'currency', 'reimbursable', 'direction', 'category', 'timeCat', 'start', 'durationMin', 'account', 'liability', 'rangeStart', 'rangeEnd', 'rangeLabel', 'focus'],
  properties: {
    type: { type: 'string', enum: ['entry', 'start', 'finish', 'balance', 'question'] },
    title: { type: 'string', description: '简短的事项名，如「写季度方案」「和客户吃饭」' },
    note: { type: 'string', description: '用户原话整理后的说明' },
    amount: { ...nullable('number'), description: '金额（原币种）；balance 时是余额' },
    currency: { ...nullable('string'), enum: CURRENCIES.map(c => c.id).concat([null]), description: '金额的币种；没有金额时为 null' },
    reimbursable: { type: 'boolean', description: '这笔支出是否要找公司报销' },
    direction: { type: 'string', enum: ['out', 'in'] },
    category: { ...nullable('string'), enum: [...CATEGORIES, ...INCOME_CATEGORIES].map(c => c.id).concat([null]) },
    timeCat: { ...nullable('string'), enum: TIME_CATS.map(c => c.id).concat([null]) },
    start: { ...nullable('string'), description: '开始时间，本地时间 YYYY-MM-DDTHH:mm；没提到时间为 null' },
    durationMin: nullable('number'),
    account: { ...nullable('string'), description: 'balance 时的账户名' },
    liability: { type: 'boolean', description: 'balance 时是否为负债（贷款、信用卡等）' },
    rangeStart: { ...nullable('string'), description: 'question 时的起始日期 YYYY-MM-DD' },
    rangeEnd: { ...nullable('string'), description: 'question 时的结束日期 YYYY-MM-DD（包含当天）' },
    rangeLabel: { ...nullable('string'), description: 'question 时范围的中文叫法，如「这几天」「今年」' },
    focus: { type: 'string', enum: ['time', 'money', 'all'] },
  },
};

const pad = n => String(n).padStart(2, '0');
const localStamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const WEEK = '日一二三四五六';

export async function aiParse(cfg, text, ctx = {}) {
  const now = new Date();
  const system = `你是一个「时间 + 金钱」记账助手，把用户说的一句中文整理成一条结构化记录。
类型：
- entry：记录做了什么、用了多久、花了或收到多少钱（三者可以只有一部分）
- start：开始做一件事（如「开始写方案」「现在去开会」）
- finish：一件事做完了（如「做完了」「搞定」，后面可能带花费，写进 amount 等字段）
- balance：报告某个账户的余额或负债（如「招行卡余额5万3」「房贷还欠80万」）
- question：在问过去的情况（如「这几天干什么去了」「今年存了多少钱」）
支出类别：${CATEGORIES.map(c => `${c.id}=${c.name}`).join('，')}
收入类别：${INCOME_CATEGORIES.map(c => `${c.id}=${c.name}`).join('，')}
时间类别：${TIME_CATS.map(c => `${c.id}=${c.name}`).join('，')}
币种：CNY=人民币（元、人民币、¥），THB=泰铢（泰铢、铢、฿），USD=美元（美元、美金、刀、$）。只说「块」或只说数字时，用默认币种 ${getDefaultCurrency()}（${currencyById(getDefaultCurrency()).name}）。
报销：用户说「要报销」「公司出」「公费」等，reimbursable 为 true；说「报销款到账」是收入（direction=in，category=refund），reimbursable 为 false。
「5万3」= 53000，「一个半小时」= 90 分钟。没说到的字段填 null（liability、reimbursable 填 false，direction 填 out，focus 填 all，title/note 填原话）。`;
  const user = `现在是 ${localStamp(now)}（星期${WEEK[now.getDay()]}）。${ctx.activity ? `用户正在做：「${ctx.activity}」。` : ''}\n用户说：${text}`;
  const json = JSON.parse(await ask(cfg, { system, user, effort: 'low', schema: PARSE_SCHEMA, maxTokens: 4000 }));
  return normalize(json, text);
}

function normalize(j, text) {
  const ts = s => (s ? new Date(s).getTime() || null : null);
  if (j.type === 'question') {
    const start = j.rangeStart ? new Date(j.rangeStart + 'T00:00').getTime() : Date.now() - 6 * 86400000;
    const end = j.rangeEnd ? new Date(j.rangeEnd + 'T00:00').getTime() + 86400000 : Date.now() + 86400000;
    return { type: 'question', text, focus: j.focus, range: { start, end, label: j.rangeLabel || '这段时间' } };
  }
  if (j.type === 'start') return { type: 'start', title: j.title, timeCat: j.timeCat };
  const currency = j.currency || getDefaultCurrency();
  if (j.type === 'balance') return { type: 'balance', account: j.account || j.title, value: j.amount, currency, liability: j.liability, text };
  const entry = {
    title: j.title, note: j.note || text, amount: j.amount, direction: j.direction,
    currency: j.amount == null ? null : currency, reimbursable: j.amount != null && j.direction !== 'in' && j.reimbursable,
    category: j.amount == null ? null : j.category, timeCat: j.timeCat, start: ts(j.start), durationMin: j.durationMin,
  };
  if (j.type === 'finish') return { type: 'finish', entry: j.amount != null || j.note ? entry : null };
  return { type: 'entry', ...entry };
}

export async function aiAnswer(cfg, question, digest) {
  const system = `你是用户的私人时间与财富顾问。用户会问过去一段时间做了什么、时间花在哪、钱花在哪。
根据提供的数据回答，用口语化的中文，像向朋友汇报一样，先给总体结论，再说重点，控制在 200 字以内，不要用 Markdown 表格。
时间方面用德鲁克《卓有成效的管理者》的视角：时间花在要事上了吗？整块时间够不够？有哪些可以不做或交给别人？
钱方面用巴菲特的常识：花得值不值、有没有结余、有没有消费负债。金额已折算成本位币；要报销的支出是公司的钱，不算个人花费，有待报销的要提醒用户去报。只根据数据说话，数据里没有的不要编；数据不够时直说缺什么。
不要推荐具体的股票或基金。`;
  const user = `问题：${question}\n\n数据（JSON）：\n${JSON.stringify(digest)}`;
  return ask(cfg, { system, user, effort: 'medium' });
}

// ---------- 看凭证 ----------
const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReceipt', 'merchant', 'purpose', 'amount', 'currency', 'date', 'time', 'category'],
  properties: {
    isReceipt: { type: 'boolean', description: '图片是不是消费凭证（小票、发票、付款截图、账单、行程单等）' },
    merchant: { ...nullable('string'), description: '商家 / 收款方名称' },
    purpose: { ...nullable('string'), description: '用途：买了什么或做了什么，简短中文，如「咖啡」「超市买菜」「两晚房费」；看不出就按商家类型推断' },
    amount: { ...nullable('number'), description: '实际支付的总金额（不是小计、不是找零、不是收到的现金）' },
    currency: { ...nullable('string'), enum: CURRENCIES.map(c => c.id).concat([null]) },
    date: { ...nullable('string'), description: '消费日期 YYYY-MM-DD（公历；佛历年份要减 543）' },
    time: { ...nullable('string'), description: '消费时间 HH:mm' },
    category: { type: 'string', enum: CATEGORIES.map(c => c.id) },
  },
};

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

export async function aiReceipt(cfg, blob) {
  const now = new Date();
  const system = `你帮用户从消费凭证图片里读出记账信息。凭证可能是中文、泰文或英文：超市小票、餐厅账单、发票、微信/支付宝/银行 App 付款截图、打车行程单、酒店账单等。
金额取实际支付的总额（实付、应付、Grand Total、ยอดสุทธิ、รวมทั้งสิ้น），不要取小计、折扣、找零、收到的现金。
币种：CNY=人民币，THB=泰铢，USD=美元；没写币种时按凭证的语言和国家判断。
泰国凭证常用佛历年份（2569 = 2026 年，两位数「69」也是 2569）。日期要换成公历。
即使凭证上没写用途，也要根据商家类型和商品推断 purpose 和 category。
支出类别：${CATEGORIES.map(c => `${c.id}=${c.name}`).join('，')}
看不清的字段填 null，不要编造。`;
  const user = [
    { type: 'image', source: { type: 'base64', media_type: blob.type || 'image/jpeg', data: await blobToBase64(blob) } },
    { type: 'text', text: `今天是 ${localStamp(now).slice(0, 10)}。请读出这张凭证的信息。` },
  ];
  const j = JSON.parse(await ask(cfg, { system, user, effort: 'low', schema: RECEIPT_SCHEMA, maxTokens: 4000 }));
  if (!j.isReceipt && j.amount == null) throw new Error('这张图看起来不是消费凭证');
  let time = null;
  if (j.date) time = new Date(`${j.date}T${j.time || '12:00'}`).getTime() || null;
  else if (j.time) { const d = new Date(); const [h, m] = j.time.split(':').map(Number); d.setHours(h, m, 0, 0); time = d.getTime(); }
  return { merchant: j.merchant, purpose: j.purpose, amount: j.amount, currency: j.amount == null ? null : j.currency || getDefaultCurrency(), time, category: j.category };
}

export async function aiTest(cfg) {
  return ask(cfg, { system: '只回答「好的」。', user: '测试', effort: 'low', maxTokens: 1000 });
}
