// 记录编辑弹层 + 通用弹层 + 记录列表项
import * as db from './db.js';
import { CATEGORIES, INCOME_CATEGORIES, TIME_CATS, CURRENCIES, catById, timeCatById, parseEntry, getDefaultCurrency } from './parser.js';
import { VoiceCapture, speechSupported } from './voice.js';
import { fmtMin, fmtRecMoney } from './analytics.js';
import { $, $$, esc, uid, store, settings, toast, blobUrl, resetPool, toLocalInput, fmtTime } from './ui.js';

export const dataChanged = () => document.dispatchEvent(new Event('data-changed'));

// ---------- 列表项 ----------
export function recItem(r, pool) {
  const isIn = r.direction === 'in';
  const c = r.amount != null ? catById(r.category) : timeCatById(r.timeCat);
  const icon = r.photos?.length ? `<img src="${blobUrl(pool, r.photos[0])}" alt="">` : `<span>${c.icon}</span>`;
  const meta = [fmtTime(r.time)];
  if (r.durationMin) meta.push('⏱ ' + fmtMin(r.durationMin));
  if (r.timeCat) meta.push(timeCatById(r.timeCat).short);
  if (r.amount != null) meta.push(c.name);
  if (r.reimbursable) meta.push(r.reimbursed ? '<span class="badge done">已报销</span>' : '<span class="badge">待报销</span>');
  if (r.audio) meta.push('🔊');
  if (r.photos?.length > 1) meta.push(`📎${r.photos.length}`);
  const title = r.activity || r.note || c.name;
  const sub = r.activity && r.note && r.note !== r.activity ? `<div class="rec-note">${esc(r.note)}</div>` : '';
  return `<li class="rec" data-id="${r.id}">
    <div class="rec-icon">${icon}</div>
    <div class="rec-main"><div class="rec-title">${esc(title)}</div>${sub}<div class="rec-meta">${meta.join(' · ')}</div></div>
    <div class="rec-amount${isIn ? ' income' : ''}${r.reimbursable ? ' reimb' : ''}">${r.amount != null ? (isIn ? '+' : '-') + fmtRecMoney(r) : ''}</div>
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
  $('#f-cats').innerHTML = list.map(c => `<button class="chip${c.id === draft.category ? ' active' : ''}" data-cat="${c.id}">${c.icon} ${c.name}</button>`).join('');
  $$('#f-direction button').forEach(b => b.classList.toggle('active', b.dataset.dir === draft.direction));
}
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
    reimbTouched: !!rec,
    curTouched: !!rec,
    amountTouched: !!rec,
    catTouched: !!rec,
    tcatTouched: !!rec,
    durTouched: !!rec,
  };
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
  setMicState(false);
  sheet.hidden = false;
  document.body.classList.add('no-scroll');
  history.pushState({ sheet: true }, '');
  $('#banner').hidden = true;
  if (preset.pickPhoto) $('#in-camera').click();
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
}
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
    for (const f of files) draft.photos.push(await compressImage(f));
    renderPhotos();
    toast(`已添加 ${files.length} 张凭证`);
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
  renderCatChips();
  renderReimb();
  renderTimeCats();
}

let parseTimer;
for (const el of [noteEl, actEl]) el.addEventListener('input', () => { clearTimeout(parseTimer); parseTimer = setTimeout(autoParse, 400); });
amountEl.addEventListener('input', () => { draft.amountTouched = true; $('#amount-auto').hidden = true; });
durEl.addEventListener('input', () => { draft.durTouched = true; });
$('#f-direction').addEventListener('click', e => {
  const b = e.target.closest('[data-dir]');
  if (!b) return;
  draft.direction = b.dataset.dir;
  draft.category = null;
  draft.catTouched = true;
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
  const rec = {
    id: fields.id || uid(),
    time: fields.time ?? Date.now(),
    durationMin: fields.durationMin || null,
    activity: fields.activity || '',
    note: fields.note || '',
    amount: fields.amount ?? null,
    currency: fields.amount != null ? fields.currency || getDefaultCurrency() : null,
    // 要报销的支出：reimbursed 表示公司已经把钱报给你了
    reimbursable: fields.amount != null && fields.direction !== 'in' && !!fields.reimbursable,
    reimbursed: fields.amount != null && fields.direction !== 'in' && !!fields.reimbursable && !!fields.reimbursed,
    direction: fields.amount != null ? fields.direction || 'out' : 'out',
    category: fields.amount != null ? fields.category || (fields.direction === 'in' ? 'other_income' : 'other') : null,
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

$('#sheet-save').addEventListener('click', async () => {
  if (voice) await stopVoice();
  if (!draft) return;
  const raw = amountEl.value.trim();
  const amount = raw === '' ? null : Math.round(parseFloat(raw) * 100) / 100;
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) { toast('金额填得不对'); return; }
  const dur = durEl.value.trim() === '' ? null : Math.round(Number(durEl.value));
  if (dur != null && (!Number.isFinite(dur) || dur < 0)) { toast('时长填得不对'); return; }
  const fields = { ...draft, activity: actEl.value.trim(), note: noteEl.value.trim(), amount, currency: $('#f-currency').value, durationMin: dur, time: new Date(timeEl.value).getTime() || Date.now() };
  if (amount == null && !fields.note && !fields.activity && !draft.photos.length && !draft.audio && !dur) {
    toast('至少写点内容：做了什么、用时、金额或凭证');
    return;
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
