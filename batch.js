// 多笔核对：一口气说了好几笔、或一次拖进好几张凭证时，先列出来让你核对，再一起保存。
import * as db from './db.js';
import { CATEGORIES, INCOME_CATEGORIES, CURRENCIES, currencyById, getDefaultCurrency } from './parser.js';
import { fmtMin, fmtMoney, toBase, accountType } from './analytics.js';
import { $, esc, toast, blobUrl, resetPool, toLocalInput } from './ui.js';
import { openDialog, saveRecord } from './sheet.js';

let items = [];
let accounts = [];

const catOptions = it => (it.direction === 'in' ? INCOME_CATEGORIES : CATEGORIES)
  .map(c => `<option value="${c.id}"${c.id === it.category ? ' selected' : ''}>${c.icon} ${c.name}</option>`).join('');

function row(it, i) {
  const money = it.amount != null;
  const photo = it.photos?.[0] ? `<img class="batch-photo" src="${blobUrl('batch', it.photos[0])}" alt="凭证">` : '';
  return `<div class="batch-item${it.skip ? ' skipped' : ''}" data-i="${i}">
    <div class="batch-top">
      ${photo}
      <input class="input batch-title" data-f="title" value="${esc(it.title || '')}" placeholder="做了什么">
      <button class="link danger-text" data-skip>${it.skip ? '恢复' : '不记'}</button>
    </div>
    <div class="batch-row">
      <select class="input inline" data-f="direction">
        <option value="out"${it.direction !== 'in' ? ' selected' : ''}>支出</option><option value="in"${it.direction === 'in' ? ' selected' : ''}>收入</option>
      </select>
      <input class="input batch-amount" data-f="amount" type="number" inputmode="decimal" step="0.01" min="0" value="${it.amount ?? ''}" placeholder="金额">
      <select class="input inline" data-f="currency">${CURRENCIES.map(c => `<option value="${c.id}"${c.id === (it.currency || getDefaultCurrency()) ? ' selected' : ''}>${c.symbol}</option>`).join('')}</select>
    </div>
    <div class="batch-row">
      <select class="input" data-f="category"${money ? '' : ' disabled'}>${catOptions(it)}</select>
      <select class="input" data-f="accountId"${money ? '' : ' disabled'}>
        <option value="">账户不指定</option>${accounts.map(a => `<option value="${a.id}"${a.id === it.accountId ? ' selected' : ''}>${esc(a.name)}（${currencyById(a.currency).symbol}）</option>`).join('')}
      </select>
    </div>
    <div class="batch-row">
      <input class="input" data-f="time" type="datetime-local" value="${toLocalInput(it.start ?? it.time ?? Date.now())}">
      <input class="input batch-dur" data-f="durationMin" type="number" inputmode="numeric" min="0" value="${it.durationMin ?? ''}" placeholder="用时(分)">
      <label class="batch-reimb"><input type="checkbox" data-f="reimbursable"${it.reimbursable ? ' checked' : ''}${money && it.direction !== 'in' ? '' : ' disabled'}> 报销</label>
    </div>
    ${it.note && it.note !== it.title ? `<div class="muted small batch-note">${esc(it.note)}</div>` : ''}
    ${it.warn ? `<div class="small danger-text">${esc(it.warn)}</div>` : ''}
  </div>`;
}

function summary() {
  const live = items.filter(it => !it.skip);
  const out = live.filter(it => it.amount != null && it.direction !== 'in');
  const total = out.reduce((s, it) => s + toBase(it.amount, it.currency), 0);
  const reimb = out.filter(it => it.reimbursable).reduce((s, it) => s + toBase(it.amount, it.currency), 0);
  const mins = live.reduce((s, it) => s + (it.durationMin || 0), 0);
  return [`${live.length} 条`, out.length ? `支出 ${fmtMoney(total)}` : '', reimb ? `其中要报销 ${fmtMoney(reimb)}` : '', mins ? `用时 ${fmtMin(mins)}` : ''].filter(Boolean).join(' · ');
}

function render(body) {
  resetPool('batch');
  body.innerHTML = `<div class="batch-summary" id="batch-summary">${summary()}</div>
    ${items.map(row).join('')}
    <p class="hint">核对一下，不对的直接改；不想记的点「不记」。点右上角「全部保存」。</p>`;
}

/**
 * list：[{title, note, amount, currency, direction, category, timeCat, start, durationMin, reimbursable, accountId, photos, warn}]
 * extras：每条都带上的字段（source、audio 只挂在第一条）
 */
export async function openBatch(list, { heading = '核对这几笔', source = 'voice', audio = null } = {}) {
  accounts = (await db.all('accounts')).filter(a => !a.archived && (!accountType(a.type).liability || a.type === 'credit'));
  items = list.map(it => ({ ...it }));
  const body = openDialog(heading, '', async () => {
    const live = items.filter(it => !it.skip);
    if (!live.length) throw new Error('没有要保存的记录');
    let first = true;
    for (const it of live) {
      const acc = accounts.find(a => a.id === it.accountId);
      await saveRecord({
        activity: it.title, note: it.note && it.note !== it.title ? it.note : '',
        amount: it.amount, currency: it.currency || acc?.currency || getDefaultCurrency(), direction: it.direction, category: it.category,
        reimbursable: it.reimbursable, timeCat: it.timeCat, time: it.start ?? it.time ?? Date.now(), durationMin: it.durationMin,
        accountId: acc?.id, accountName: acc?.name || '', company: acc?.owner === 'company',
        photos: it.photos || [], audio: first ? audio : null, source,
      });
      first = false;
    }
    resetPool('batch');
    toast(`已保存 ${live.length} 条`);
  }, { saveLabel: '全部保存' });
  render(body);

  const onEdit = e => {
    const el = e.target.closest('[data-f]');
    const wrap = e.target.closest('[data-i]');
    if (!el || !wrap) return;
    const it = items[Number(wrap.dataset.i)];
    const f = el.dataset.f;
    if (f === 'amount') it.amount = el.value.trim() === '' ? null : Math.round(parseFloat(el.value) * 100) / 100;
    else if (f === 'durationMin') it.durationMin = el.value.trim() === '' ? null : Math.round(Number(el.value));
    else if (f === 'time') it.start = new Date(el.value).getTime() || it.start;
    else if (f === 'reimbursable') it.reimbursable = el.checked;
    else if (f === 'accountId') {
      it.accountId = el.value || null;
      const acc = accounts.find(a => a.id === it.accountId);
      if (acc && !it.currencyExplicit) it.currency = acc.currency;
      if (acc?.owner === 'company') it.reimbursable = false;
    } else it[f] = el.value;
    if (f === 'direction') { it.category = null; if (it.direction === 'in') it.reimbursable = false; }
    // 改收支方向或账户会影响别的控件，重画；其余只就地更新，免得打字丢焦点、或重画时吞掉下一次点击
    if (['direction', 'accountId'].includes(f)) { render(body); return; }
    const money = it.amount != null;
    wrap.querySelector('[data-f=category]').disabled = !money;
    wrap.querySelector('[data-f=accountId]').disabled = !money;
    wrap.querySelector('[data-f=reimbursable]').disabled = !money || it.direction === 'in';
    $('#batch-summary', body).textContent = summary();
  };
  body.oninput = onEdit;
  body.onchange = onEdit;
  body.onclick = e => {
    const skip = e.target.closest('[data-skip]');
    if (!skip) return;
    const it = items[Number(skip.closest('[data-i]').dataset.i)];
    it.skip = !it.skip;
    render(body);
  };
}
