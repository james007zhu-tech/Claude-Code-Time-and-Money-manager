// 报销单：把待报销的支出排成 A4 单据，生成独立的 HTML，在手机 / 电脑上「打印 → 存为 PDF」或直接打印。
// 两种排版：
//   category（默认）：第 1 页是汇总（各科目金额、所在页码、大写金额、签字栏），之后每个科目单独成页：
//                    先是这个科目的明细，接着是它的凭证；凭证多就续页。交通费几页、餐饮费几页，一目了然。
//   single：汇总 + 明细尽量放一页，凭证另附粘贴页。
// 同时产出结构化数据（rows / groups），供导出 ERP 使用。

import { catById, currencyById } from './parser.js';

// 支出类别 → 报销科目
const EXPENSE_ITEM = {
  transport: '交通费', travel: '住宿差旅费', food: '餐饮费', work: '办公费', shopping: '采购费',
  home: '通讯水电费', study: '培训费', health: '医疗费', social: '礼品费', fun: '招待娱乐费',
  invest: '其他费用', other: '其他费用',
};
export const expenseItem = cat => EXPENSE_ITEM[cat] || '其他费用';
export const EXPENSE_ITEMS = [...new Set(Object.values(EXPENSE_ITEM))];

// 金额大写：12345.6 → 壹万贰仟叁佰肆拾伍元陆角
export function upperAmount(n) {
  const D = '零壹贰叁肆伍陆柒捌玖', U = ['', '拾', '佰', '仟'], B = ['', '万', '亿', '万亿'];
  const cents = Math.round(Math.abs(n) * 100);
  const int = Math.floor(cents / 100), jiao = Math.floor(cents / 10) % 10, fen = cents % 10;
  let s = '';
  if (int) {
    const str = String(int);
    let zero = false, groupHas = false;
    for (let i = 0; i < str.length; i++) {
      const d = +str[i], pos = str.length - 1 - i, u = pos % 4, b = Math.floor(pos / 4);
      if (d === 0) zero = true;
      else { if (zero) s += '零'; s += D[d] + U[u]; zero = false; groupHas = true; }
      // 每四位一组，组里有数字才写「万 / 亿」
      if (u === 0 && b > 0) { if (groupHas) s += B[b]; groupHas = false; }
    }
    s += '元';
  }
  if (!jiao && !fen) return (n < 0 ? '负' : '') + (s || '零元') + '整';
  if (jiao) s += D[jiao] + '角'; else if (int) s += '零';
  if (fen) s += D[fen] + '分';
  return (n < 0 ? '负' : '') + s;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const md = ms => { const d = new Date(ms); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const round2 = n => Math.round(n * 100) / 100;
const money = (n, cur) => `${currencyById(cur).symbol}${round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CN_NUM = '一二三四五六七八九十';
const cnIndex = i => (i < 10 ? CN_NUM[i] : `十${CN_NUM[i - 10] || ''}`);

/**
 * 整理报销数据：按科目分组（金额大的科目在前），组内按日期排，统一编号。
 * opts：{ currency 报销币种, convert(amount, from, to), codes {科目: 科目代码} }
 */
export function prepareReimbursement(items, opts) {
  const cur = opts.currency;
  const base = items.map(r => ({ ...r, item: expenseItem(r.category), converted: round2(opts.convert(r.amount, r.currency || 'CNY', cur)) }));
  const byItem = new Map();
  for (const r of base) {
    const g = byItem.get(r.item) || { item: r.item, code: opts.codes?.[r.item] || '', n: 0, amount: 0, rows: [] };
    g.n++; g.amount = round2(g.amount + r.converted); g.rows.push(r);
    byItem.set(r.item, g);
  }
  const groups = [...byItem.values()].sort((a, b) => b.amount - a.amount);
  let no = 0;
  const rows = [];
  for (const g of groups) {
    g.rows.sort((a, b) => a.time - b.time);
    for (const r of g.rows) { r.no = ++no; rows.push(r); }
    g.receipts = [];
    for (const r of g.rows) (r.photoUrls || []).forEach((url, k, all) => g.receipts.push({ url, label: all.length > 1 ? `${r.no}-${k + 1}` : `${r.no}`, r }));
  }
  const total = round2(rows.reduce((s, r) => s + r.converted, 0));
  const foreign = [...new Set(rows.map(r => r.currency || 'CNY'))].filter(c => c !== cur);
  const rates = Object.fromEntries(foreign.map(c => [c, opts.convert(1, c, cur)]));
  const rateNote = foreign.map(c => `1 ${currencyById(c).name} = ${rates[c].toFixed(4)} ${currencyById(cur).name}`).join('；');
  return { cur, rows, groups, total, rates, rateNote, receiptCount: groups.reduce((s, g) => s + g.receipts.length, 0) };
}

// ---------- 分页估算（毫米） ----------
const PAGE_H = 273;          // A4 297mm - 上下边距 12mm×2
const SECTION_HEAD = 20;     // 科目页抬头
const TABLE_HEAD = 9, ROW_H = 7.2, TABLE_SUM = 8;
const RECEIPT_ROW = 84;      // 一行两张凭证（图 66mm + 说明 + 间距）
const ROWS_PER_TABLE_PAGE = 28;

// 一个科目的分页：明细表（行多时分页），然后凭证接在后面，每页最多 6 张
export function planSection(rowCount, receiptCount) {
  const pages = [];
  for (let i = 0; i < rowCount; i += ROWS_PER_TABLE_PAGE) pages.push({ rows: [i, Math.min(rowCount, i + ROWS_PER_TABLE_PAGE)], receipts: [0, 0] });
  if (!pages.length) pages.push({ rows: [0, 0], receipts: [0, 0] });
  const last = pages[pages.length - 1];
  const lastRows = last.rows[1] - last.rows[0];
  const used = SECTION_HEAD + TABLE_HEAD + ROW_H * lastRows + (last === pages[pages.length - 1] ? TABLE_SUM : 0) + 6;
  let fit = Math.max(0, Math.floor((PAGE_H - used) / RECEIPT_ROW)) * 2;
  let r = Math.min(receiptCount, fit);
  last.receipts = [0, r];
  while (r < receiptCount) {
    const n = Math.min(6, receiptCount - r);
    pages.push({ rows: [0, 0], receipts: [r, r + n] });
    r += n;
  }
  return pages;
}

const CSS = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e9ebee; color: #111; font: 10pt/1.45 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans Thai", sans-serif; }
  .page { width: 210mm; height: 297mm; margin: 8mm auto; padding: 12mm; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.15); position: relative; overflow: hidden; }
  .page.flow { height: auto; min-height: 297mm; overflow: visible; }
  @media print { body { background: #fff; } .page { margin: 0; padding: 0; width: auto; height: 271mm; box-shadow: none; } .page.flow { height: auto; min-height: 0; } .page + .page { break-before: page; } }
  h1 { font-size: 18pt; text-align: center; margin: 0 0 1mm; letter-spacing: 6pt; }
  .org { text-align: center; color: #444; margin-bottom: 4mm; }
  .info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1mm 6mm; border-top: 1.5pt solid #111; border-bottom: .5pt solid #999; padding: 2mm 0; margin-bottom: 4mm; }
  .info span { color: #555; }
  h2 { font-size: 11pt; margin: 4mm 0 1.5mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: .5pt solid #888; padding: 1mm 1.5mm; vertical-align: top; }
  th { background: #f1f3f5; font-weight: 600; white-space: nowrap; }
  .c { text-align: center; white-space: nowrap; } .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .sub { color: #666; font-size: 8pt; }
  .miss { color: #c00; }
  .sum td { font-weight: 700; background: #fafafa; }
  .total-box { border: 1pt solid #111; padding: 3mm 4mm; margin-top: 4mm; display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; }
  .total-box .big { font-size: 18pt; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .note { color: #555; font-size: 8.5pt; margin-top: 2mm; }
  .sign { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-top: 10mm; }
  .sign div { border-top: .5pt solid #111; padding-top: 1mm; text-align: center; color: #444; }
  .details tr { break-inside: avoid; }
  .details.compact th, .details.compact td { padding: .5mm 1.2mm; font-size: 8.5pt; line-height: 1.3; }
  .details.compact .sub { display: none; }
  .compact-page h2 { margin: 2.5mm 0 1mm; } .compact-page .sign { margin-top: 4mm; } .compact-page .info { margin-bottom: 2mm; }
  .sec-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1.5pt solid #111; padding-bottom: 1.5mm; margin-bottom: 3mm; }
  .sec-head h2 { margin: 0; font-size: 14pt; }
  .sec-head .meta { color: #444; }
  .pno { position: absolute; right: 12mm; bottom: 6mm; font-size: 8pt; color: #777; }
  @media print { .pno { right: 0; bottom: 0; } }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 4mm; }
  .grid.inline { grid-template-columns: repeat(4, 1fr); gap: 3mm; }
  .rc { margin: 0; border: .5pt dashed #999; padding: 2mm; break-inside: avoid; }
  .ph { height: 66mm; display: flex; align-items: center; justify-content: center; background: #fafafa; }
  .grid.inline .ph { height: 42mm; }
  .ph img { max-width: 100%; max-height: 100%; object-fit: contain; }
  figcaption { font-size: 8pt; margin-top: 1mm; }
  .toolbar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; justify-content: center; padding: 8px; background: rgba(233,235,238,.95); }
  .toolbar button { font: inherit; font-size: 15px; padding: 8px 16px; border-radius: 10px; border: 0; background: #12a37b; color: #fff; }
  @media print { .toolbar { display: none; } }
  @media screen and (max-width: 800px) { .page { zoom: .5; } }
`;

function shell(title, body) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="toolbar"><button onclick="print()">打印 / 存为 PDF</button></div>
<script>if (window.top !== window) document.querySelector('.toolbar').remove();</script>
${body}
</body></html>`;
}

const infoBlock = (opts, data) => `
  <h1>费用报销单</h1>
  <div class="org">${opts.org ? esc(opts.org) : '&nbsp;'}</div>
  <div class="info">
    <div><span>报销人：</span>${esc(opts.person || '')}</div>
    <div><span>报销期间：</span>${esc(opts.period)}</div>
    <div><span>填单日期：</span>${ymd(opts.now || Date.now())}</div>
    <div><span>费用笔数：</span>${data.rows.length} 笔</div>
    <div><span>附凭证：</span>${data.receiptCount} 张</div>
    <div><span>报销币种：</span>${esc(currencyById(data.cur).name)}</div>
  </div>`;

const totalBlock = (data) => `
  <div class="total-box">
    <div><b>报销金额合计</b><div>大写：${upperAmount(data.total)}${data.cur === 'CNY' ? '' : `（${esc(currencyById(data.cur).name)}）`}</div></div>
    <div class="big">${money(data.total, data.cur)}</div>
  </div>
  ${data.rateNote ? `<div class="note">外币按汇率折算：${esc(data.rateNote)}</div>` : ''}`;

const SIGN = '<div class="sign"><div>报销人</div><div>部门负责人</div><div>财务审核</div><div>审批</div></div>';

const receiptCell = x => `<figure class="rc"><div class="ph"><img src="${x.url}" alt=""></div>
  <figcaption><b>凭证 ${esc(x.label)}</b> ${md(x.r.time)} ${esc(x.r.activity || x.r.note || '')} ${money(x.r.amount, x.r.currency || 'CNY')}</figcaption></figure>`;

const receiptRef = r => ((r.photoUrls || []).length ? (r.photoUrls.length > 1 ? `${r.no}-1~${r.photoUrls.length}` : r.no) : '<span class="miss">无</span>');
const what = r => `${esc(r.activity || r.note || catById(r.category).name)}${r.note && r.activity && r.note !== r.activity ? `<div class="sub">${esc(r.note)}</div>` : ''}`;

// ---------- 按科目分页 ----------
function buildByCategory(data, opts) {
  const { cur } = data;
  // 先排各科目的页，算出页码，再写第 1 页汇总
  let pageNo = 1;
  const sections = data.groups.map((g, gi) => {
    const plan = planSection(g.rows.length, g.receipts.length);
    const first = pageNo + 1;
    pageNo += plan.length;
    return { g, gi, plan, first, last: pageNo };
  });
  const totalPages = pageNo;
  const pno = n => `<div class="pno">${esc(opts.person || '')} · ${esc(opts.period)} · 第 ${n} / ${totalPages} 页</div>`;

  const summary = `<section class="page">
    ${infoBlock(opts, data)}
    <h2>一、费用汇总</h2>
    <table>
      <tr><th>序</th><th>报销科目</th>${data.groups.some(g => g.code) ? '<th>科目代码</th>' : ''}<th>笔数</th><th>凭证</th><th>金额</th><th>明细及凭证</th></tr>
      ${sections.map(({ g, gi, first, last }) => `<tr>
        <td class="c">${cnIndex(gi)}</td><td>${esc(g.item)}</td>${data.groups.some(x => x.code) ? `<td class="c">${esc(g.code)}</td>` : ''}
        <td class="c">${g.n}</td><td class="c">${g.receipts.length}</td><td class="r">${money(g.amount, cur)}</td>
        <td class="c">第 ${first}${last > first ? `–${last}` : ''} 页</td></tr>`).join('')}
      <tr class="sum"><td></td><td>合计</td>${data.groups.some(g => g.code) ? '<td></td>' : ''}<td class="c">${data.rows.length}</td><td class="c">${data.receiptCount}</td><td class="r">${money(data.total, cur)}</td><td></td></tr>
    </table>
    ${totalBlock(data)}
    ${data.rows.some(r => !(r.photoUrls || []).length) ? `<div class="note">有 ${data.rows.filter(r => !(r.photoUrls || []).length).length} 笔没有凭证，见各科目明细中标红「无」的行。</div>` : ''}
    <div class="note">明细和凭证按科目分页附后，凭证号与明细序号对应。</div>
    ${SIGN}
    ${pno(1)}
  </section>`;

  const pages = [];
  for (const { g, gi, plan, first } of sections) {
    plan.forEach((p, i) => {
      const cont = i > 0;
      const rows = g.rows.slice(p.rows[0], p.rows[1]);
      const isLastTable = p.rows[1] === g.rows.length && rows.length;
      pages.push(`<section class="page">
        <div class="sec-head"><h2>${cnIndex(gi)}、${esc(g.item)}${g.code ? ` <small>${esc(g.code)}</small>` : ''}${cont ? '（续）' : ''}</h2>
          <div class="meta">共 ${g.n} 笔 · 凭证 ${g.receipts.length} 张 · 小计 <b>${money(g.amount, cur)}</b></div></div>
        ${rows.length ? `<table class="details">
          <thead><tr><th>序号</th><th>日期</th><th>事项 / 用途</th><th>付款方式</th><th>原币金额</th><th>报销金额</th><th>凭证</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td class="c">${r.no}</td><td class="c">${md(r.time)}</td><td>${what(r)}</td><td>${esc(r.accountName || '')}</td>
            <td class="r">${(r.currency || 'CNY') === cur ? '' : money(r.amount, r.currency)}</td><td class="r">${money(r.converted, cur)}</td><td class="c">${receiptRef(r)}</td></tr>`).join('')}
          ${isLastTable ? `<tr class="sum"><td colspan="5">${esc(g.item)}小计</td><td class="r">${money(g.amount, cur)}</td><td></td></tr>` : ''}</tbody>
        </table>` : ''}
        ${p.receipts[1] > p.receipts[0] ? `<div class="grid">${g.receipts.slice(p.receipts[0], p.receipts[1]).map(receiptCell).join('')}</div>` : ''}
        ${pno(first + i)}
      </section>`);
    });
  }
  return { html: summary + pages.join(''), pages: totalPages };
}

// ---------- 一页汇总 + 凭证粘贴页 ----------
function buildSingle(data, opts) {
  const { cur, rows } = data;
  const receipts = data.groups.flatMap(g => g.receipts);
  const inline = rows.length <= 10 && receipts.length <= 4;
  const compact = rows.length > 14;
  const detailPages = rows.length <= 26 ? 1 : 1 + Math.ceil((rows.length - 26) / 45);
  const receiptPages = [];
  if (!inline) for (let i = 0; i < receipts.length; i += 6) receiptPages.push(receipts.slice(i, i + 6));
  const html = `<section class="page flow${compact ? ' compact-page' : ''}">
    ${infoBlock(opts, data)}
    <h2>一、费用汇总</h2>
    <table>
      <tr><th>报销科目</th>${data.groups.some(g => g.code) ? '<th>科目代码</th>' : ''}<th>笔数</th><th>金额</th></tr>
      ${data.groups.map(g => `<tr><td>${esc(g.item)}</td>${data.groups.some(x => x.code) ? `<td class="c">${esc(g.code)}</td>` : ''}<td class="c">${g.n}</td><td class="r">${money(g.amount, cur)}</td></tr>`).join('')}
    </table>
    ${totalBlock(data)}
    <h2>二、费用明细</h2>
    <table class="details${compact ? ' compact' : ''}">
      <thead><tr><th>序号</th><th>日期</th><th>科目</th><th>事项 / 用途</th><th>付款方式</th><th>原币金额</th><th>报销金额</th><th>凭证</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="c">${r.no}</td><td class="c">${md(r.time)}</td><td>${esc(r.item)}</td><td>${what(r)}</td><td>${esc(r.accountName || '')}</td>
        <td class="r">${(r.currency || 'CNY') === cur ? '' : money(r.amount, r.currency)}</td><td class="r">${money(r.converted, cur)}</td><td class="c">${receiptRef(r)}</td></tr>`).join('')}
      <tr class="sum"><td colspan="6">合计</td><td class="r">${money(data.total, cur)}</td><td></td></tr></tbody>
    </table>
    ${inline && receipts.length ? `<h2>三、凭证</h2><div class="grid inline">${receipts.map(receiptCell).join('')}</div>` : ''}
    ${!inline && receipts.length ? `<div class="note">凭证见后附「凭证粘贴页」（共 ${receiptPages.length} 页），凭证号与明细序号对应。</div>` : ''}
    ${SIGN}
  </section>
  ${receiptPages.map((list, i) => `<section class="page">
    <h1 style="font-size:14pt;letter-spacing:2pt">凭证粘贴页</h1>
    <div class="org">${esc(opts.person || '')} · ${esc(opts.period)} · 第 ${i + 1} / ${receiptPages.length} 页</div>
    <div class="grid">${list.map(receiptCell).join('')}</div>
  </section>`).join('')}`;
  return { html, pages: detailPages + receiptPages.length, inline };
}

/**
 * items：待报销记录（photoUrls 为凭证图片的 dataURL）
 * opts：{ currency, convert, period, person, org, now, codes, layout: 'category' | 'single' }
 */
export function buildReimbursementHtml(items, opts) {
  const data = prepareReimbursement(items, opts);
  const built = (opts.layout === 'single' ? buildSingle : buildByCategory)(data, opts);
  return { ...data, ...built, html: shell(`费用报销单 ${opts.period}`, built.html) };
}
