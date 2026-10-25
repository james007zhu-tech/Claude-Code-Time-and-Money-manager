// 报销单：把待报销的支出排成 A4 单据 —— 第一页是分类汇总 + 明细 + 签字栏，后面是凭证粘贴页。
// 生成的是一份独立的 HTML，在手机 / 电脑上「打印 → 存为 PDF」或直接打印。

import { catById, currencyById } from './parser.js';

// 支出类别 → 报销科目
const EXPENSE_ITEM = {
  transport: '交通费', travel: '住宿差旅费', food: '餐饮费', work: '办公费', shopping: '采购费',
  home: '通讯水电费', study: '培训费', health: '医疗费', social: '礼品费', fun: '招待娱乐费',
  invest: '其他费用', other: '其他费用',
};
export const expenseItem = cat => EXPENSE_ITEM[cat] || '其他费用';

// 金额大写：12345.6 → 壹万贰仟叁佰肆拾伍元陆角整
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
const money = (n, cur) => `${currencyById(cur).symbol}${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * items：待报销记录（含 photos 的 dataURL 数组 photoUrls）
 * opts：{ currency 报销币种, convert(amount, from, to), period 期间文字, person 报销人, org 单位/部门, now }
 * 返回 { html, total, byItem, pages }
 */
export function buildReimbursementHtml(items, opts) {
  const cur = opts.currency;
  const rows = [...items].sort((a, b) => a.time - b.time).map((r, i) => ({
    ...r,
    no: i + 1,
    item: expenseItem(r.category),
    converted: opts.convert(r.amount, r.currency || 'CNY', cur),
  }));
  const total = rows.reduce((s, r) => s + r.converted, 0);
  const byItem = new Map();
  for (const r of rows) {
    const g = byItem.get(r.item) || { item: r.item, n: 0, amount: 0 };
    g.n++; g.amount += r.converted;
    byItem.set(r.item, g);
  }
  const groups = [...byItem.values()].sort((a, b) => b.amount - a.amount);
  const foreign = [...new Set(rows.map(r => r.currency || 'CNY'))].filter(c => c !== cur);
  const rateNote = foreign.map(c => `1 ${currencyById(c).name} = ${opts.convert(1, c, cur).toFixed(4)} ${currencyById(cur).name}`).join('；');

  // 凭证：每张照片编号「凭证号-第几张」
  const receipts = [];
  for (const r of rows) (r.photoUrls || []).forEach((url, k, all) => receipts.push({ url, label: all.length > 1 ? `${r.no}-${k + 1}` : `${r.no}`, r }));
  const receiptCount = receipts.length;

  // 明细少、凭证少时整张单据放在一页；否则凭证另起页，每页 6 张
  const inline = rows.length <= 10 && receiptCount <= 4;
  // 明细多时用小一号字，一页大约能放 26 笔；再多就接到下一页（表头会重复）
  const compact = rows.length > 14;
  const detailPages = rows.length <= 26 ? 1 : 1 + Math.ceil((rows.length - 26) / 45);
  const perPage = 6;
  const receiptPages = [];
  if (!inline) for (let i = 0; i < receipts.length; i += perPage) receiptPages.push(receipts.slice(i, i + perPage));
  const pages = detailPages + receiptPages.length;

  const receiptCell = x => `<figure class="rc"><div class="ph"><img src="${x.url}" alt=""></div>
    <figcaption><b>凭证 ${esc(x.label)}</b> ${md(x.r.time)} ${esc(x.r.activity || x.r.note || '')} ${money(x.r.amount, x.r.currency || 'CNY')}</figcaption></figure>`;

  const detailRow = r => `<tr>
    <td class="c">${r.no}</td><td class="c">${md(r.time)}</td><td>${esc(r.item)}</td>
    <td>${esc(r.activity || r.note || catById(r.category).name)}${r.note && r.activity && r.note !== r.activity ? `<div class="sub">${esc(r.note)}</div>` : ''}</td>
    <td>${esc(r.accountName || '')}</td>
    <td class="r">${(r.currency || 'CNY') === cur ? '' : money(r.amount, r.currency)}</td>
    <td class="r">${money(r.converted, cur)}</td>
    <td class="c">${(r.photoUrls || []).length ? (r.photoUrls.length > 1 ? `${r.no}-1~${r.photoUrls.length}` : r.no) : '<span class="miss">无</span>'}</td>
  </tr>`;

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>费用报销单 ${esc(opts.period)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e9ebee; color: #111; font: 10pt/1.45 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans Thai", sans-serif; }
  .page { width: 210mm; min-height: 297mm; margin: 8mm auto; padding: 12mm; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.15); }
  @media print { body { background: #fff; } .page { margin: 0; padding: 0; width: auto; min-height: 0; box-shadow: none; } .page + .page { break-before: page; } }
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
  .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; align-items: start; }
  .total-box { border: 1pt solid #111; padding: 2.5mm 3mm; }
  .total-box .big { font-size: 16pt; font-weight: 700; font-variant-numeric: tabular-nums; }
  .note { color: #555; font-size: 8.5pt; margin-top: 2mm; }
  .sign { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-top: 8mm; }
  .sign div { border-top: .5pt solid #111; padding-top: 1mm; text-align: center; color: #444; }
  .details tr { break-inside: avoid; }
  .details.compact th, .details.compact td { padding: .5mm 1.2mm; font-size: 8.5pt; line-height: 1.3; }
  .details.compact .sub { display: none; }
  .compact-page h2 { margin: 2.5mm 0 1mm; }
  .compact-page .sign { margin-top: 4mm; }
  .compact-page .info { margin-bottom: 2mm; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .grid.inline { grid-template-columns: repeat(4, 1fr); gap: 3mm; }
  .rc { margin: 0; border: .5pt dashed #999; padding: 2mm; break-inside: avoid; }
  .ph { height: 66mm; display: flex; align-items: center; justify-content: center; background: #fafafa; }
  .grid.inline .ph { height: 42mm; }
  .ph img { max-width: 100%; max-height: 100%; object-fit: contain; }
  figcaption { font-size: 8pt; margin-top: 1mm; }
  .toolbar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; justify-content: center; padding: 8px; background: rgba(233,235,238,.95); }
  .toolbar button { font: inherit; font-size: 15px; padding: 8px 16px; border-radius: 10px; border: 0; background: #12a37b; color: #fff; }
  .toolbar button.ghost { background: #fff; color: #333; }
  @media print { .toolbar { display: none; } }
  @media screen and (max-width: 800px) { .page { zoom: .5; } }
</style></head><body>
<div class="toolbar"><button onclick="print()">打印 / 存为 PDF</button></div>
<script>if (window.top !== window) document.querySelector('.toolbar').remove();</script>

<section class="page${compact ? ' compact-page' : ''}">
  <h1>费用报销单</h1>
  ${opts.org ? `<div class="org">${esc(opts.org)}</div>` : '<div class="org">&nbsp;</div>'}
  <div class="info">
    <div><span>报销人：</span>${esc(opts.person || '')}</div>
    <div><span>报销期间：</span>${esc(opts.period)}</div>
    <div><span>填单日期：</span>${ymd(opts.now || Date.now())}</div>
    <div><span>费用笔数：</span>${rows.length} 笔</div>
    <div><span>附凭证：</span>${receiptCount} 张</div>
    <div><span>报销币种：</span>${esc(currencyById(cur).name)}</div>
  </div>

  <div class="summary">
    <div>
      <h2>一、费用汇总</h2>
      <table>
        <tr><th>报销科目</th><th>笔数</th><th>金额</th></tr>
        ${groups.map(g => `<tr><td>${esc(g.item)}</td><td class="c">${g.n}</td><td class="r">${money(g.amount, cur)}</td></tr>`).join('')}
        <tr class="sum"><td>合计</td><td class="c">${rows.length}</td><td class="r">${money(total, cur)}</td></tr>
      </table>
    </div>
    <div>
      <h2>报销金额</h2>
      <div class="total-box">
        <div class="big">${money(total, cur)}</div>
        <div>大写：${upperAmount(total)}${cur === 'CNY' ? '' : `（${esc(currencyById(cur).name)}）`}</div>
      </div>
      ${rateNote ? `<div class="note">外币按汇率折算：${esc(rateNote)}</div>` : ''}
    </div>
  </div>

  <h2>二、费用明细</h2>
  <table class="details${compact ? ' compact' : ''}">
    <thead><tr><th>序号</th><th>日期</th><th>科目</th><th>事项 / 用途</th><th>付款方式</th><th>原币金额</th><th>报销金额</th><th>凭证</th></tr></thead>
    <tbody>${rows.map(detailRow).join('')}
    <tr class="sum"><td colspan="6">合计</td><td class="r">${money(total, cur)}</td><td></td></tr></tbody>
  </table>

  ${inline && receipts.length ? `<h2>三、凭证</h2><div class="grid inline">${receipts.map(receiptCell).join('')}</div>` : ''}
  ${!inline && receipts.length ? `<div class="note">凭证见后附「凭证粘贴页」（共 ${receiptPages.length} 页），凭证号与明细序号对应。</div>` : ''}

  <div class="sign"><div>报销人</div><div>部门负责人</div><div>财务审核</div><div>审批</div></div>
</section>

${receiptPages.map((list, i) => `<section class="page">
  <h1 style="font-size:14pt;letter-spacing:2pt">凭证粘贴页</h1>
  <div class="org">${esc(opts.person || '')} · ${esc(opts.period)} · 第 ${i + 1} / ${receiptPages.length} 页</div>
  <div class="grid">${list.map(receiptCell).join('')}</div>
</section>`).join('')}
</body></html>`;

  return { html, total, groups, rows, pages, inline, receiptCount };
}
