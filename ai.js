// 可选：用 Claude 理解语音、回答「这几天干了什么」。
// 用户在设置里填自己的 API Key，只存在本机；不填就用 parser.js 的本地理解。
import { CATEGORIES, INCOME_CATEGORIES, TIME_CATS } from './parser.js';

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
  required: ['type', 'title', 'note', 'amount', 'direction', 'category', 'timeCat', 'start', 'durationMin', 'account', 'liability', 'rangeStart', 'rangeEnd', 'rangeLabel', 'focus'],
  properties: {
    type: { type: 'string', enum: ['entry', 'start', 'finish', 'balance', 'question'] },
    title: { type: 'string', description: '简短的事项名，如「写季度方案」「和客户吃饭」' },
    note: { type: 'string', description: '用户原话整理后的说明' },
    amount: { ...nullable('number'), description: '金额（元）；balance 时是余额' },
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
「5万3」= 53000，「一个半小时」= 90 分钟。没说到的字段填 null（liability 填 false，direction 填 out，focus 填 all，title/note 填原话）。`;
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
  if (j.type === 'balance') return { type: 'balance', account: j.account || j.title, value: j.amount, liability: j.liability, text };
  const entry = {
    title: j.title, note: j.note || text, amount: j.amount, direction: j.direction,
    category: j.amount == null ? null : j.category, timeCat: j.timeCat, start: ts(j.start), durationMin: j.durationMin,
  };
  if (j.type === 'finish') return { type: 'finish', entry: j.amount != null || j.note ? entry : null };
  return { type: 'entry', ...entry };
}

export async function aiAnswer(cfg, question, digest) {
  const system = `你是用户的私人时间与财富顾问。用户会问过去一段时间做了什么、时间花在哪、钱花在哪。
根据提供的数据回答，用口语化的中文，像向朋友汇报一样，先给总体结论，再说重点，控制在 200 字以内，不要用 Markdown 表格。
时间方面用德鲁克《卓有成效的管理者》的视角：时间花在要事上了吗？整块时间够不够？有哪些可以不做或交给别人？
钱方面用巴菲特的常识：花得值不值、有没有结余、有没有消费负债。只根据数据说话，数据里没有的不要编；数据不够时直说缺什么。
不要推荐具体的股票或基金。`;
  const user = `问题：${question}\n\n数据（JSON）：\n${JSON.stringify(digest)}`;
  return ask(cfg, { system, user, effort: 'medium' });
}

export async function aiTest(cfg) {
  return ask(cfg, { system: '只回答「好的」。', user: '测试', effort: 'low', maxTokens: 1000 });
}
