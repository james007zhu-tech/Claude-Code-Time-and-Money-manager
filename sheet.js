// 记录编辑弹层 + 通用弹层 + 记录列表项
import * as db from './db.js';
import { CATEGORIES, INCOME_CATEGORIES, TIME_CATS, CURRENCIES, catById, timeCatById, currencyById, parseEntry, getDefaultCurrency } from './parser.js';
import { VoiceCapture, speechSupported } from './voice.js';
import { fmtMin, fmtRecMoney, accountType } from './analytics.js';
import { matchAccount, paymentHint } from './accounts.js';
import { $, $$, esc, uid, store, settings, aiConfig, toast, blobUrl, resetPool, toLocalInput, fmtTime } from './ui.js';
import { recognizeReceipt } from './receipt.js';
import { aiReceipt } from './ai.js';

export const dataChanged = () => document.dispatchEvent(new Event('data-changed'));

// ---------- 列表项 ----------
export function recItem(r, pool) {
  const isIn = r.direction === 'in';
  const isTransfer = r.direction === 'transfer';
  const c = isTransfer ? { icon: '🔁', name: '转账' } : r.amount != null ? catById(r.category) : timeCatById(r.timeCat);
  const icon = r.photos?.length ? `<img src="${blobUrl(pool, r.photos[0])}" alt="">` : `<span>${c.icon}</span>`;
  const meta = [fmtTime(r.time)];
  if (r.durationMin) meta.push('⏱ ' + fmtMin(r.durationMin));
  if (r.timeCat) meta.push(timeCatById(r.timeCat).short);
  if (r.amount != null && !isTransfer) meta.push(c.name);
  if (r.accountName && !isTransfer) meta.push(esc(r.accountName));
  if (r.company) meta.push('<span class="badge company">公司</span>');
  if (r.reimbursable) meta.push(r.reimbursed ? '<span class="badge done">已报销</span>' : r.reimbSubmittedAt ? '<span class="badge">已提交</span>' : '<span class="badge">待报销</span>');
  if (r.audio) meta.push('🔊');
  if (r.photos?.length > 1) meta.push(`📎${r.photos.length}`);
  const title = r.activity || r.note || c.name;
  const sub = r.activity && r.note && r.note !== r.activity ? `<div class="rec-note">${esc(r.note)}</div>` : '';
  return `<li class="rec" data-id="${r.id}">
    <div class="rec-icon">${icon}</div>
    <div class="rec-main"><div class="rec-title">${esc(title)}</div>${sub}<div class="rec-meta">${meta.join(' · ')}</div></div>
    <div class="rec-amount${isIn ? ' income' : ''}${r.reimbursable ? ' reimb' : ''}${isTransfer || r.company ? ' muted' : ''}">${r.amount != null ? (isTransfer ? '' : isIn ? '+' : '-') + fmtRecMoney(r) : ''}</div>
  </li>`;
}

document.addEventListener('click', async e => {
  const li = e.target.closest('.rec[data-id]');
  if (!li) return;
  const rec = await db.getRecord(li.dataset.id);
  if (rec) openSheet(rec);
});

// ---------- 记录编辑 ----------
const sheet = $('#sheet');
const actEl = $('#f-activity'), noteEl = $('#f-note'), amountEl = $('#f-amount'), timeEl = $('#f-time'), durEl = $('#f-duration');
let draft = null;
let voice = null;

export const sheetOpen = () => !sheet.hidden;

function renderCatChips() {
  const list = draft.direction === 'in' ? INCOME_CATEGORIES : CATEGORIES;
  const transfer = draft.direction === 'transfer';
  $('#f-cats').hidden = transfer;
  $('#f-cats').innerHTML = list.map(c => `<button class="chip${c.id === draft.category ? ' active' : ''}" data-cat="${c.id}">${c.icon} ${c.name}</button>`).join('');
  $$('#f-direction button').forEach(b => b.classList.toggle('active', b.dataset.dir === draft.direction));
  $('#f-transfer').hidden = !transfer;
  $('#f-account-label').textContent = { in: '收款账户', transfer: '转出账户' }[draft.direction] || '付款账户';
}

// ---------- 账户选择 ----------
let sheetAccounts = [];
const accountOptions = (selected, blank) => `<option value="">${blank}</option>` +
  sheetAccounts.map(a => `<option value="${a.id}"${a.id === selected ? ' selected' : ''}>${esc(a.name)}（${currencyById(a.currency).symbol}${a.owner === 'company' ? ' · 公司' : ''}）</option>`).join('');

async function loadAccounts() {
  // 房贷这类负债不会用来付款，信用卡可以
  sheetAccounts = (await db.all('accounts')).filter(a => !a.archived && (!accountType(a.type).liability || a.type === 'credit'));
  renderAccounts();
}
function renderAccounts() {
  if (!draft) return;
  $('#f-account').innerHTML = accountOptions(draft.accountId, sheetAccounts.length ? '不指定' : '还没有账户（财富页添加）');
  $('#f-to-account').innerHTML = accountOptions(draft.toAccountId, '选择转入账户');
}
const accById = id => sheetAccounts.find(a => a.id === id) || null;

function setAccount(acc, { touched = false } = {}) {
  draft.accountId = acc?.id ?? null;
  if (touched) draft.accTouched = true;
  // 账户的币种和金额币种不一样时，没手动选过币种就跟着账户走
  if (acc && !draft.curTouched) $('#f-currency').value = acc.currency || 'CNY';
  if (acc?.owner === 'company' && draft.reimbursable) { draft.reimbursable = false; renderReimb(); }
  renderAccounts();
}
$('#f-account').addEventListener('change', e => setAccount(accById(e.target.value), { touched: true }));
$('#f-to-account').addEventListener('change', e => { draft.toAccountId = e.target.value || null; });
$('#f-currency').innerHTML = CURRENCIES.map(c => `<option value="${c.id}">${c.symbol} ${c.name}</option>`).join('');
function renderReimb() {
  const state = !draft.reimbursable ? 'no' : draft.reimbursed ? 'done' : 'pending';
  $$('#f-reimb button').forEach(b => b.classList.toggle('active', b.dataset.reimb === state));
  $('#f-reimb').hidden = draft.direction === 'in';
}
$('#f-reimb').addEventListener('click', e => {
  const b = e.target.closest('[data-reimb]');
  if (!b) return;
  draft.reimbursable = b.dataset.reimb !== 'no';
  draft.reimbursed = b.dataset.reimb === 'done';
  draft.reimbTouched = true;
  renderReimb();
});
$('#f-currency').addEventListener('change', () => { if (draft) draft.curTouched = true; });

function renderTimeCats() {
  $('#f-timecats').innerHTML = TIME_CATS.map(c => `<button class="chip${c.id === draft.timeCat ? ' active' : ''}" data-tcat="${c.id}">${c.icon} ${c.short}</button>`).join('');
}

// preset：{heading, activity|title, note, amount, direction, category, timeCat, start, durationMin, audio, photos, pickPhoto}
export function openSheet(rec = null, preset = {}) {
  const src = rec || preset;
  draft = {
    id: rec?.id ?? null,
    createdAt: rec?.createdAt ?? null,
    photos: [...(src.photos || [])],
    audio: src.audio || null,
    direction: src.direction || 'out',
    category: src.category ?? null,
    timeCat: src.timeCat ?? null,
    source: rec?.source || preset.source || 'manual',
    reimbursable: !!src.reimbursable,
    reimbursed: !!src.reimbursed,
    // 已有记录里填过的字段视为用户确认过，识别凭证时不覆盖；空着的仍然可以自动填
    reimbTouched: !!rec,
    curTouched: rec?.amount != null,
    amountTouched: rec?.amount != null,
    catTouched: rec?.category != null,
    tcatTouched: !!rec,
    durTouched: !!rec,
    timeTouched: !!rec || preset.time != null || preset.start != null,
    accountId: src.accountId ?? null,
    toAccountId: src.toAccountId ?? null,
    accTouched: !!src.accountId,
    // 时间输入框只到分钟；没改过时间就用精确时间，免得和同一分钟里核对的余额前后颠倒
    baseTime: src.time ?? src.start ?? null,
    openedAt: Date.now(),
  };
  $('#f-to-amount').value = src.toAmount ?? '';
  renderAccounts();
  loadAccounts();
  $('#sheet-title').textContent = rec ? '修改记录' : preset.heading || '记一笔';
  actEl.value = (rec ? rec.activity : preset.activity ?? preset.title) || '';
  noteEl.value = src.note || '';
  amountEl.value = src.amount ?? '';
  $('#f-currency').value = src.currency || getDefaultCurrency();
  timeEl.value = toLocalInput(src.time ?? src.start ?? Date.now());
  durEl.value = src.durationMin ?? '';
  $('#amount-auto').hidden = true;
  $('#btn-delete').hidden = !rec;
  $('#live-text').hidden = true;
  renderCatChips();
  renderReimb();
  renderTimeCats();
  renderPhotos();
  renderAudio();
  setReceiptStatus('');
  setMicState(false);
  sheet.hidden = false;
  document.body.classList.add('no-scroll');
  history.pushState({ sheet: true }, '');
  $('#banner').hidden = true;
  // pickPhoto：'camera' 拍照，'gallery' 从相册选（手机也会提供拍照选项）
  if (preset.pickPhoto) $(preset.pickPhoto === 'gallery' ? '#in-gallery' : '#in-camera').click();
}

const isDirty = () => draft && !draft.id && (draft.photos.length || draft.audio || noteEl.value.trim() || amountEl.value || actEl.value.trim());

async function closeSheet({ fromPopState = false } = {}) {
  if (voice) { await voice.stop().catch(() => {}); voice = null; }
  sheet.hidden = true;
  document.body.classList.remove('no-scroll');
  resetPool('sheet');
  draft = null;
  if (!fromPopState && history.state?.sheet) history.back();
}

window.addEventListener('popstate', () => {
  if (!$('#dialog').hidden) { closeDialog(true); return; }
  if (sheet.hidden) return;
  if (isDirty() && !confirm('这条还没保存，确定放弃？')) { history.pushState({ sheet: true }, ''); return; }
  closeSheet({ fromPopState: true });
});

function renderPhotos() {
  resetPool('sheet');
  $('#photo-list').innerHTML = draft.photos.map((p, i) =>
    `<div class="photo"><img src="${blobUrl('sheet', p)}" data-view-photo="${i}" alt="凭证"><button data-del-photo="${i}" aria-label="删除">×</button></div>`).join('');
  $('#btn-recognize').hidden = !draft.photos.length;
}

// ---------- 凭证识别 ----------
function setReceiptStatus(html, busy = false) {
  const el = $('#receipt-status');
  el.hidden = !html;
  el.innerHTML = html;
  el.classList.toggle('busy', busy);
}

async function recognizePhoto(blob) {
  const token = draft;
  setReceiptStatus('🔍 正在识别凭证…', true);
  try {
    const r = await recognizeReceipt(blob, { ai: aiConfig(), aiReceipt, onProgress: msg => draft === token && setReceiptStatus(`🔍 ${esc(msg)}`, true) });
    if (draft !== token) return;
    applyReceipt(r);
  } catch (e) {
    if (draft === token) setReceiptStatus(`⚠️ ${esc(e.message)}`);
  }
}

// 把识别结果填进还没手动改过的字段
function applyReceipt(r) {
  const filled = [];
  if (r.amount != null && !draft.amountTouched) {
    amountEl.value = r.amount;
    draft.direction = 'out';
    if (r.currency && !draft.curTouched) $('#f-currency').value = r.currency;
    filled.push(fmtRecMoney({ amount: r.amount, currency: $('#f-currency').value }));
  }
  if (r.time && !draft.timeTouched) {
    timeEl.value = toLocalInput(r.time);
    const d = new Date(r.time);
    filled.push(`${d.getMonth() + 1}月${d.getDate()}日 ${fmtTime(r.time)}`);
  }
  const purpose = r.purpose || r.merchant;
  if (purpose && !actEl.value.trim()) actEl.value = r.purpose && r.merchant ? `${r.merchant} ${r.purpose}` : purpose;
  if (r.merchant && !noteEl.value.trim()) noteEl.value = [r.merchant, r.purpose].filter(Boolean).join('：');
  if (r.category && !draft.catTouched) {
    draft.category = r.category;
    filled.push(catById(r.category).name);
  }
  // 付款方式（微信 / 支付宝 / 现金 / 银行卡）→ 账户
  const hint = r.payment || paymentHint(r.text || '');
  const acc = !draft.accTouched && hint ? matchAccount(hint, sheetAccounts) : null;
  if (acc) {
    const cur = $('#f-currency').value;
    setAccount(acc);
    $('#f-currency').value = cur;   // 凭证上的币种优先
    filled.push(acc.name);
  }
  renderCatChips();
  renderReimb();
  const by = r.source === 'ai' ? 'AI' : '手机识别';
  setReceiptStatus(r.amount == null && !r.merchant
    ? '没认出内容，可以手动填写'
    : `✅ 已识别（${by}）：${esc([purpose, ...filled].filter(Boolean).join(' · '))}<br><small class="muted">请核对一下，不对可以直接改</small>`);
}

$('#btn-recognize').addEventListener('click', () => {
  if (!draft?.photos.length) return;
  // 重新识别时覆盖之前自动填的值
  Object.assign(draft, { amountTouched: false, catTouched: false, timeTouched: false, curTouched: false });
  recognizePhoto(draft.photos[0]);
});
function renderAudio() {
  $('#audio-box').hidden = !draft.audio;
  if (draft.audio) $('#audio-preview').src = blobUrl('sheet', draft.audio);
}

$('#photo-list').addEventListener('click', e => {
  const del = e.target.closest('[data-del-photo]');
  if (del) { draft.photos.splice(Number(del.dataset.delPhoto), 1); renderPhotos(); return; }
  const img = e.target.closest('[data-view-photo]');
  if (img) { $('img', $('#viewer')).src = img.src; $('#viewer').hidden = false; }
});
$('#viewer').addEventListener('click', () => { $('#viewer').hidden = true; });

async function compressImage(file, max = 1600, quality = 0.8) {
  let img;
  try {
    img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return (await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))) || file;
}

$('#btn-camera').addEventListener('click', () => $('#in-camera').click());
$('#btn-gallery').addEventListener('click', () => $('#in-gallery').click());
for (const input of [$('#in-camera'), $('#in-gallery')]) {
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length || !draft) return;
    const first = draft.photos.length;
    for (const f of files) draft.photos.push(await compressImage(f));
    renderPhotos();
    // 还没填金额时自动识别第一张新凭证
    if (!amountEl.value.trim()) recognizePhoto(draft.photos[first]);
    else toast(`已添加 ${files.length} 张凭证`);
  });
}
$('#btn-audio-del').addEventListener('click', () => { draft.audio = null; renderAudio(); });

function setMicState(recording) {
  $('#btn-mic').classList.toggle('recording', recording);
  $('#mic-hint').textContent = recording ? '正在听…说完再点一下' : '点一下补充说明，说完再点一下';
}

async function stopVoice() {
  const v = voice;
  voice = null;
  $('#mic-hint').textContent = '处理中…';
  const { audio, text } = await v.stop();
  setMicState(false);
  if (!draft) return;
  if (audio) { draft.audio = audio; renderAudio(); }
  $('#live-text').hidden = true;
  if (text) {
    noteEl.value = noteEl.value.trim() ? noteEl.value.trim() + '，' + text : text;
    autoParse();
  } else {
    toast(speechSupported() ? '没听清，可以再说一次或直接打字' : '已保存录音；这个浏览器不能转文字');
  }
}

$('#btn-mic').addEventListener('click', async () => {
  if (voice) { await stopVoice(); return; }
  voice = new VoiceCapture({
    keepAudio: settings.keepAudio,
    onText: t => { const el = $('#live-text'); el.hidden = false; el.textContent = t; },
    onError: msg => toast(msg),
  });
  try {
    await voice.start();
    setMicState(true);
  } catch (e) {
    voice = null;
    setMicState(false);
    toast('无法使用麦克风：' + (e.message || e.name));
  }
});

// 根据说明自动填金额、类别、时长；用户手动改过的不覆盖
function autoParse() {
  const p = parseEntry(`${actEl.value} ${noteEl.value}`);
  if (!draft.amountTouched && p.amount != null) {
    amountEl.value = p.amount;
    $('#amount-auto').hidden = false;
    draft.direction = p.direction;
    if (!draft.curTouched && p.currency) $('#f-currency').value = p.currency;
  }
  if (!draft.reimbTouched && p.reimbursable) { draft.reimbursable = true; draft.reimbursed = false; }
  if (!draft.catTouched && p.category) draft.category = p.category;
  if (!draft.tcatTouched && p.timeCat) draft.timeCat = p.timeCat;
  if (!draft.durTouched && p.durationMin) durEl.value = p.durationMin;
  const acc = !draft.accTouched && matchAccount(`${actEl.value} ${noteEl.value}`, sheetAccounts);
  if (acc) {
    setAccount(acc);
    if (p.currencyExplicit && !draft.curTouched) $('#f-currency').value = p.currency;
  }
  renderCatChips();
  renderReimb();
  renderTimeCats();
}

let parseTimer;
for (const el of [noteEl, actEl]) el.addEventListener('input', () => { clearTimeout(parseTimer); parseTimer = setTimeout(autoParse, 400); });
amountEl.addEventListener('input', () => { draft.amountTouched = true; $('#amount-auto').hidden = true; });
durEl.addEventListener('input', () => { draft.durTouched = true; });
timeEl.addEventListener('input', () => { draft.timeTouched = true; });
$('#f-direction').addEventListener('click', e => {
  const b = e.target.closest('[data-dir]');
  if (!b) return;
  draft.direction = b.dataset.dir;
  draft.category = null;
  draft.catTouched = true;
  if (draft.direction !== 'out') draft.reimbursable = false;
  renderCatChips();
  renderReimb();
});
$('#f-cats').addEventListener('click', e => {
  const chip = e.target.closest('[data-cat]');
  if (!chip) return;
  draft.catTouched = true;
  draft.category = chip.dataset.cat;
  renderCatChips();
});
$('#f-timecats').addEventListener('click', e => {
  const chip = e.target.closest('[data-tcat]');
  if (!chip) return;
  draft.tcatTouched = true;
  draft.timeCat = draft.timeCat === chip.dataset.tcat ? null : chip.dataset.tcat;
  renderTimeCats();
});

$('#sheet-cancel').addEventListener('click', () => {
  if (isDirty() && !confirm('这条还没保存，确定放弃？')) return;
  closeSheet();
});
$('#btn-delete').addEventListener('click', async () => {
  if (!confirm('删除这条记录？')) return;
  await db.deleteRecord(draft.id);
  toast('已删除');
  await closeSheet();
  dataChanged();
});

// 记录的统一保存入口（语音自动保存也走这里）
export async function saveRecord(fields) {
  const money = fields.amount != null;
  const dir = money ? fields.direction || 'out' : 'out';
  const transfer = dir === 'transfer';
  const rec = {
    id: fields.id || uid(),
    time: fields.time ?? Date.now(),
    durationMin: fields.durationMin || null,
    activity: fields.activity || '',
    note: fields.note || '',
    amount: fields.amount ?? null,
    currency: money ? fields.currency || getDefaultCurrency() : null,
    // 付款 / 收款账户；公司账户的收支不算个人的
    accountId: money ? fields.accountId || null : null,
    accountName: money ? fields.accountName || '' : '',
    company: money && !!fields.company,
    // 转账：从 accountId 转到 toAccountId；换汇时 toAmount 是到账金额（toCurrency）
    toAccountId: transfer ? fields.toAccountId || null : null,
    toAccountName: transfer ? fields.toAccountName || '' : '',
    toAmount: transfer ? fields.toAmount ?? null : null,
    toCurrency: transfer ? fields.toCurrency || null : null,
    // 要报销的支出：reimbursed 表示公司已经把钱报给你了
    reimbursable: money && dir === 'out' && !fields.company && !!fields.reimbursable,
    reimbursed: money && dir === 'out' && !fields.company && !!fields.reimbursable && !!fields.reimbursed,
    direction: dir,
    category: money && !transfer ? fields.category || (dir === 'in' ? 'other_income' : 'other') : null,
    timeCat: fields.timeCat || null,
    photos: fields.photos || [],
    audio: fields.audio || null,
    source: fields.source || 'manual',
    createdAt: fields.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await db.putRecord(rec);
  store.set('lastRecordAt', Date.now());
  dataChanged();
  return rec;
}

function preciseTime() {
  const base = draft.baseTime ?? draft.openedAt;
  if (timeEl.value === toLocalInput(base)) return draft.baseTime ?? Date.now();
  return new Date(timeEl.value).getTime() || Date.now();
}

$('#sheet-save').addEventListener('click', async () => {
  if (voice) await stopVoice();
  if (!draft) return;
  const raw = amountEl.value.trim();
  const amount = raw === '' ? null : Math.round(parseFloat(raw) * 100) / 100;
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) { toast('金额填得不对'); return; }
  const dur = durEl.value.trim() === '' ? null : Math.round(Number(durEl.value));
  if (dur != null && (!Number.isFinite(dur) || dur < 0)) { toast('时长填得不对'); return; }
  const acc = accById(draft.accountId);
  const fields = {
    ...draft, activity: actEl.value.trim(), note: noteEl.value.trim(), amount, currency: $('#f-currency').value, durationMin: dur,
    time: preciseTime(),
    accountName: acc?.name || '', company: acc?.owner === 'company',
  };
  if (amount == null && !fields.note && !fields.activity && !draft.photos.length && !draft.audio && !dur) {
    toast('至少写点内容：做了什么、用时、金额或凭证');
    return;
  }
  if (draft.direction === 'transfer') {
    const to = accById(draft.toAccountId);
    if (amount == null || !acc || !to || acc === to) { toast('转账要填金额，并选好不同的转出、转入账户'); return; }
    const toRaw = $('#f-to-amount').value.trim();
    Object.assign(fields, { toAccountName: to.name, toCurrency: to.currency || 'CNY', toAmount: toRaw === '' ? null : Number(toRaw), company: false });
    if (!fields.activity) fields.activity = `${acc.name} → ${to.name}`;
  }
  const rec = await saveRecord(fields);
  toast(rec.amount != null ? `已记 ${rec.direction === 'in' ? '+' : ''}${fmtRecMoney(rec)}${rec.reimbursable && !rec.reimbursed ? '（待报销）' : ''}` : '已记录');
  closeSheet();
});

// ---------- 通用弹层 ----------
const dialog = $('#dialog');
let dialogSave = null;
export function openDialog(title, html, onSave, { saveLabel = '保存' } = {}) {
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = html;
  $('#dialog-save').textContent = saveLabel;
  dialogSave = onSave;
  dialog.hidden = false;
  document.body.classList.add('no-scroll');
  history.pushState({ dialog: true }, '');
  return $('#dialog-body');
}
function closeDialog(fromPopState = false) {
  dialog.hidden = true;
  dialogSave = null;
  document.body.classList.remove('no-scroll');
  if (!fromPopState && history.state?.dialog) history.back();
}
$('#dialog-cancel').addEventListener('click', () => closeDialog());
$('#dialog-save').addEventListener('click', async () => {
  if (!dialogSave) return;
  try {
    if ((await dialogSave($('#dialog-body'))) === false) return;
  } catch (e) {
    toast(e.message);
    return;
  }
  closeDialog();
  dataChanged();
});
