// ERP 对接：把一张报销单转成通用的结构化数据（JSON），可以下载交给 ERP 导入，
// 也可以直接 POST 到 ERP 的接口（或 n8n / Make / 自建中间件）。格式说明见 docs/erp-export.md。

const pad = n => String(n).padStart(2, '0');
const ymd = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const round2 = n => Math.round(n * 100) / 100;

// 「交通费=6601.01」每行一条 → { 交通费: '6601.01' }
export function parseCodes(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*([^=：:]+?)\s*[=：:]\s*(\S+)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export const DEFAULT_CODES = ['交通费=', '住宿差旅费=', '餐饮费=', '招待娱乐费=', '办公费=', '采购费=', '通讯水电费=', '培训费=', '礼品费=', '医疗费=', '其他费用='].join('\n');

// 「Authorization: Bearer xxx」每行一个请求头
export function parseHeaders(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const dataUrlParts = url => {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url || '');
  return m ? { mimeType: m[1], dataBase64: m[2] } : null;
};

/**
 * data：report.js 的 prepareReimbursement / buildReimbursementHtml 结果（rows、groups、total、cur、rates）
 * opts：{ period, person, org, employeeCode, costCenter, now, includeReceipts }
 */
export function buildErpPayload(data, opts) {
  const now = opts.now || Date.now();
  const times = data.rows.map(r => r.time);
  const d = new Date(now);
  const claimId = opts.claimId || `EXP-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${String(now).slice(-5)}`;
  return {
    schema: 'time-ledger.expense-claim/v1',
    claimId,
    createdAt: new Date(now).toISOString(),
    period: { label: opts.period, from: times.length ? ymd(Math.min(...times)) : null, to: times.length ? ymd(Math.max(...times)) : null },
    employee: { name: opts.person || '', code: opts.employeeCode || '' },
    organization: opts.org || '',
    costCenter: opts.costCenter || '',
    currency: data.cur,
    total: round2(data.total),
    exchangeRates: Object.fromEntries(Object.entries(data.rates || {}).map(([c, v]) => [c, Number(v.toFixed(6))])),
    summary: data.groups.map(g => ({ expenseItem: g.item, glAccount: g.code || '', count: g.n, amount: round2(g.amount) })),
    lines: data.rows.map(r => ({
      lineNo: r.no,
      date: ymd(r.time),
      expenseItem: r.item,
      glAccount: r.code || data.groups.find(g => g.item === r.item)?.code || '',
      category: r.category,
      description: r.activity || r.note || '',
      note: r.note && r.note !== r.activity ? r.note : '',
      paymentAccount: r.accountName || '',
      originalAmount: round2(r.amount),
      originalCurrency: r.currency || 'CNY',
      exchangeRate: (r.currency || 'CNY') === data.cur ? 1 : Number((r.converted / r.amount).toFixed(6)),
      amount: round2(r.converted),
      receipts: (r.photoUrls || []).map((url, k) => {
        const name = `receipt-${r.no}${r.photoUrls.length > 1 ? `-${k + 1}` : ''}.jpg`;
        const parts = dataUrlParts(url);
        return opts.includeReceipts && parts ? { fileName: name, ...parts } : { fileName: name };
      }),
      sourceId: r.id,
    })),
  };
}

// 每行一笔的凭证分录表（Excel 能打开），带科目代码，方便 ERP 批量导入
export function erpCsv(payload) {
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['单号', '行号', '日期', '员工', '员工编号', '成本中心', '报销科目', '科目代码', '事项', '付款账户', '原币', '原币金额', '汇率', '报销币种', '报销金额', '凭证文件'];
  const lines = payload.lines.map(l => [
    payload.claimId, l.lineNo, l.date, payload.employee.name, payload.employee.code, payload.costCenter, l.expenseItem, l.glAccount,
    l.description, l.paymentAccount, l.originalCurrency, l.originalAmount, l.exchangeRate, payload.currency, l.amount, l.receipts.map(x => x.fileName).join(' '),
  ]);
  return '﻿' + [head, ...lines].map(r => r.map(cell).join(',')).join('\r\n');
}

// 推送到 ERP：POST JSON；ERP 需要允许浏览器跨域（CORS），不允许时请走中间件
export async function pushToErp(url, headersText, payload) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...parseHeaders(headersText) }, body: JSON.stringify(payload) });
  } catch (e) {
    throw new Error('连不上 ERP 接口（可能是网络问题，或接口不允许浏览器跨域访问）');
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`ERP 返回 ${res.status}${text ? '：' + text.slice(0, 120) : ''}`);
  return text;
}
