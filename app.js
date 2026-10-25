import * as db from './db.js';
import { CATEGORIES, catById, parseExpense } from './parser.js';
import { VoiceCapture, speechSupported, recorderSupported } from './voice.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');

const fmtMoney = n => '¥' + (Number.isInteger(n) ? n : (n || 0).toFixed(2));
const fmtTime = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDur = min => min < 60 ? `${min}分钟` : `${Math.floor(min / 60)}小时${min % 60 ? (min % 60) + '分' : ''}`;
const fmtClock = ms => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const WEEK = '日一二三四五六';

// ---------- 本地设置 ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 隐私模式下可能不可用 */ } },
};
const DEFAULT_SETTINGS = { remindEnabled: false, remindEvery: 90, remindStart: '09:00', remindEnd: '22:00', keepAudio: true };
const settings = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
const saveSettings = () => store.set('settings', settings);

// ---------- 小工具 ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// 每个列表一组 objectURL，重新渲染时释放旧的
const urlPools = {};
function blobUrl(pool, blob) {
  const u = URL.createObjectURL(blob);
  (urlPools[pool] ??= []).push(u);
  return u;
}
function resetPool(pool) {
  (urlPools[pool] || []).forEach(u => URL.revokeObjectURL(u));
  urlPools[pool] = [];
}

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
  const w = img.width, h = img.height;
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob || file;
}

function monthRange({ y, m }) {
  return [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()];
}

// ---------- 视图切换 ----------
let currentView = 'home';
const now0 = new Date();
const curMonth = { y: now0.getFullYear(), m: now0.getMonth() };

function showView(name) {
  currentView = name;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('#view-title').textContent = $('#view-' + name).dataset.title;
  window.scrollTo(0, 0);
  refresh();
}

function refresh() {
  if (currentView === 'home') renderHome();
  else if (currentView === 'list') renderList();
  else if (currentView === 'stats') renderStats();
  else if (currentView === 'settings') renderSettings();
}

$$('.tabbar button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

function renderMonthNavs() {
  const label = `${curMonth.y}年${curMonth.m + 1}月`;
  $$('[data-month-nav]').forEach(el => {
    el.innerHTML = `<button class="btn ghost small" data-step="-1">‹</button><b>${label}</b><button class="btn ghost small" data-step="1">›</button>`;
  });
}
document.addEventListener('click', e => {
  const step = e.target.closest('[data-month-nav] [data-step]');
  if (!step) return;
  const d = new Date(curMonth.y, curMonth.m + Number(step.dataset.step), 1);
  curMonth.y = d.getFullYear();
  curMonth.m = d.getMonth();
  refresh();
});

// ---------- 记录列表项 ----------
function recItem(r, pool) {
  const c = catById(r.category);
  const icon = r.photos?.length
    ? `<img src="${blobUrl(pool, r.photos[0])}" alt="">`
    : `<span>${c.icon}</span>`;
  const meta = [c.name, fmtTime(r.time)];
  if (r.activity && r.note) meta.push(esc(r.activity));
  if (r.durationMin) meta.push('⏱ ' + fmtDur(r.durationMin));
  if (r.audio) meta.push('🔊');
  if (r.photos?.length > 1) meta.push(`📎${r.photos.length}`);
  return `<li class="rec" data-id="${r.id}">
    <div class="rec-icon">${icon}</div>
    <div class="rec-main"><div class="rec-title">${esc(r.note || r.activity || c.name)}</div><div class="rec-meta">${meta.join(' · ')}</div></div>
    <div class="rec-amount">${r.amount != null ? '-' + fmtMoney(r.amount) : '<span class="muted">—</span>'}</div>
  </li>`;
}

document.addEventListener('click', async e => {
  const li = e.target.closest('.rec[data-id]');
  if (!li) return;
  const rec = await db.getRecord(li.dataset.id);
  if (rec) openSheet(rec);
});

// ---------- 首页 ----------
async function renderHome() {
  renderActivity();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const recs = await db.recordsBetween(start.getTime(), start.getTime() + 86400000);
  resetPool('today');
  $('#today-total').textContent = fmtMoney(recs.reduce((s, r) => s + (r.amount || 0), 0));
  $('#today-count').textContent = recs.length;
  $('#today-list').innerHTML = recs.length
    ? recs.map(r => recItem(r, 'today')).join('')
    : '<li class="empty">今天还没记账。做完一件事，点上面的按钮记一笔。</li>';
}

// ---------- 正在做的事 ----------
const getActivity = () => store.get('activity', null);

function renderActivity() {
  const act = getActivity();
  const card = $('#activity-card');
  if (act) {
    card.innerHTML = `<div class="act-run">
      <div class="muted">正在做</div>
      <div class="act-name">${esc(act.name)}</div>
      <div class="act-clock" id="act-clock">${fmtClock(Date.now() - act.start)}</div>
      ${act.planMin ? `<div class="muted small">预计 ${fmtDur(act.planMin)}，到点提醒你</div>` : ''}
      <div class="btn-row">
        <button class="btn primary grow" data-act="finish">✅ 做完了，记一笔</button>
        <button class="btn ghost" data-act="cancel">放弃</button>
      </div>
    </div>`;
  } else {
    const recent = store.get('recentActivities', []);
    card.innerHTML = `<div class="act-idle">
      <div class="card-head"><span>接下来要做什么？</span></div>
      <div class="act-form">
        <input id="act-name" class="input" placeholder="例如：去超市采购、拜访客户" enterkeyhint="go">
        <select id="act-plan" class="input inline">
          <option value="0">不定时</option><option value="15">15分钟</option><option value="30">30分钟</option>
          <option value="60">1小时</option><option value="120">2小时</option><option value="240">4小时</option>
        </select>
      </div>
      ${recent.length ? `<div class="chips">${recent.map(n => `<button class="chip" data-recent="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
      <button class="btn grow full" data-act="start">▶ 开始</button>
      <p class="hint">做完点「做完了」，会马上让你拍凭证、说一句话；设了预计时长，到点还会提醒。</p>
    </div>`;
  }
}

function startActivity(name) {
  name = name.trim();
  if (!name) { toast('先写一下要做什么'); $('#act-name')?.focus(); return; }
  const planMin = Number($('#act-plan')?.value || 0);
  store.set('activity', { name, start: Date.now(), planMin, nudged: false });
  const recent = [name, ...store.get('recentActivities', []).filter(n => n !== name)].slice(0, 6);
  store.set('recentActivities', recent);
  ensureNotifyPermission();
  renderActivity();
}

function finishActivity() {
  const act = getActivity();
  if (!act) { openSheet(); return; }
  store.set('activity', null);
  renderActivity();
  openSheet(null, { activity: act.name, durationMin: Math.max(1, Math.round((Date.now() - act.start) / 60000)) });
}

$('#activity-card').addEventListener('click', e => {
  const recentBtn = e.target.closest('[data-recent]');
  if (recentBtn) { $('#act-name').value = recentBtn.dataset.recent; return; }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'start') startActivity($('#act-name').value);
  else if (act === 'finish') finishActivity();
  else if (act === 'cancel' && confirm('放弃这件事，不记录？')) { store.set('activity', null); renderActivity(); }
});
$('#activity-card').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'act-name') startActivity(e.target.value);
});

$('#btn-new').addEventListener('click', () => (getActivity() ? finishActivity() : openSheet()));

// ---------- 记一笔（弹层） ----------
const sheet = $('#sheet');
const noteEl = $('#f-note'), amountEl = $('#f-amount'), timeEl = $('#f-time'), actEl = $('#f-activity');
let draft = null;
let voice = null;

$('#f-cats').innerHTML = CATEGORIES.map(c => `<button class="chip" data-cat="${c.id}">${c.icon} ${c.name}</button>`).join('');

function setCategory(id) {
  draft.category = id;
  $$('#f-cats .chip').forEach(b => b.classList.toggle('active', b.dataset.cat === id));
}

function openSheet(rec = null, preset = {}) {
  draft = {
    id: rec?.id ?? null,
    createdAt: rec?.createdAt ?? null,
    photos: [...(rec?.photos || [])],
    audio: rec?.audio || null,
    category: null,
    durationMin: rec?.durationMin ?? preset.durationMin ?? null,
    amountAuto: false,
    amountTouched: !!rec,
    catTouched: !!rec,
  };
  $('#sheet-title').textContent = rec ? '修改记录' : preset.activity ? `「${preset.activity}」做完了` : '记一笔';
  noteEl.value = rec?.note || '';
  amountEl.value = rec?.amount ?? '';
  timeEl.value = toLocalInput(rec?.time ?? Date.now());
  actEl.value = rec?.activity ?? preset.activity ?? '';
  $('#f-duration').hidden = !draft.durationMin;
  $('#f-duration').textContent = draft.durationMin ? '用时 ' + fmtDur(draft.durationMin) : '';
  $('#amount-auto').hidden = true;
  $('#btn-delete').hidden = !rec;
  $('#live-text').hidden = true;
  setCategory(rec?.category ?? null);
  renderPhotos();
  renderAudio();
  setMicState(false);
  sheet.hidden = false;
  document.body.classList.add('no-scroll');
  history.pushState({ sheet: true }, '');
  $('#banner').hidden = true;
}

const isDirty = () => !draft.id && (draft.photos.length || draft.audio || noteEl.value.trim() || amountEl.value);

async function closeSheet({ fromPopState = false } = {}) {
  if (voice) { await voice.stop().catch(() => {}); voice = null; }
  sheet.hidden = true;
  document.body.classList.remove('no-scroll');
  resetPool('sheet');
  draft = null;
  if (!fromPopState && history.state?.sheet) history.back();
  refresh();
}

function cancelSheet() {
  if (isDirty() && !confirm('这笔还没保存，确定放弃？')) return;
  closeSheet();
}

window.addEventListener('popstate', () => {
  if (sheet.hidden) return;
  // 手机返回键：有未保存内容时先确认
  if (isDirty() && !confirm('这笔还没保存，确定放弃？')) { history.pushState({ sheet: true }, ''); return; }
  closeSheet({ fromPopState: true });
});

function renderPhotos() {
  resetPool('sheet');
  $('#photo-list').innerHTML = draft.photos.map((p, i) =>
    `<div class="photo"><img src="${blobUrl('sheet', p)}" data-view-photo="${i}" alt="凭证"><button data-del-photo="${i}" aria-label="删除">×</button></div>`).join('');
}

function renderAudio() {
  const box = $('#audio-box');
  box.hidden = !draft.audio;
  if (draft.audio) $('#audio-preview').src = blobUrl('sheet', draft.audio);
}

$('#photo-list').addEventListener('click', e => {
  const del = e.target.closest('[data-del-photo]');
  if (del) { draft.photos.splice(Number(del.dataset.delPhoto), 1); renderPhotos(); return; }
  const img = e.target.closest('[data-view-photo]');
  if (img) openViewer(img.src);
});

$('#btn-camera').addEventListener('click', () => $('#in-camera').click());
$('#btn-gallery').addEventListener('click', () => $('#in-gallery').click());
for (const input of [$('#in-camera'), $('#in-gallery')]) {
  input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length || !draft) return;
    toast('处理图片…');
    for (const f of files) draft.photos.push(await compressImage(f));
    renderPhotos();
    toast(`已添加 ${files.length} 张凭证`);
  });
}

$('#btn-audio-del').addEventListener('click', () => { draft.audio = null; renderAudio(); });

function setMicState(recording) {
  $('#btn-mic').classList.toggle('recording', recording);
  $('#btn-mic').setAttribute('aria-label', recording ? '说完了' : '开始说话');
  $('#mic-hint').textContent = recording ? '正在听…说完再点一下' : '点一下开始说，说完再点一下';
}

async function stopVoice() {
  const v = voice;
  voice = null;
  setMicState(false);
  $('#mic-hint').textContent = '处理中…';
  const { audio, text } = await v.stop();
  setMicState(false);
  if (!draft) return;
  if (audio) { draft.audio = audio; renderAudio(); }
  $('#live-text').hidden = true;
  if (text) {
    noteEl.value = noteEl.value.trim() ? noteEl.value.trim() + '，' + text : text;
    autoParse();
  } else if (!speechSupported()) {
    toast('已保存录音。这个浏览器不能转文字，可以手动补一句说明');
  } else {
    toast('没听清，可以再说一次或直接打字');
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

// 根据说明自动填金额和类别；用户手动改过的不覆盖
function autoParse() {
  const { amount, category } = parseExpense(noteEl.value);
  if (!draft.amountTouched && amount != null) {
    amountEl.value = amount;
    draft.amountAuto = true;
    $('#amount-auto').hidden = false;
  }
  if (!draft.catTouched && category) setCategory(category);
}

let parseTimer;
noteEl.addEventListener('input', () => { clearTimeout(parseTimer); parseTimer = setTimeout(autoParse, 400); });
amountEl.addEventListener('input', () => { draft.amountTouched = true; $('#amount-auto').hidden = true; });
$('#f-cats').addEventListener('click', e => {
  const chip = e.target.closest('[data-cat]');
  if (!chip) return;
  draft.catTouched = true;
  setCategory(chip.dataset.cat);
});

$('#sheet-cancel').addEventListener('click', cancelSheet);
$('#sheet-save').addEventListener('click', saveSheet);
$('#btn-delete').addEventListener('click', async () => {
  if (!confirm('删除这笔记录？')) return;
  await db.deleteRecord(draft.id);
  toast('已删除');
  closeSheet();
});

async function saveSheet() {
  if (voice) await stopVoice();
  if (!draft) return;
  const raw = amountEl.value.trim();
  const amount = raw === '' ? null : Math.round(parseFloat(raw) * 100) / 100;
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) { toast('金额填得不对'); return; }
  const note = noteEl.value.trim();
  const activity = actEl.value.trim();
  if (amount == null && !note && !activity && !draft.photos.length && !draft.audio) {
    toast('至少录点内容：凭证、语音、说明或金额');
    return;
  }
  const time = new Date(timeEl.value).getTime() || Date.now();
  await db.putRecord({
    id: draft.id || uid(),
    time,
    amount,
    category: draft.category || 'other',
    note,
    activity,
    durationMin: draft.durationMin,
    photos: draft.photos,
    audio: draft.audio,
    createdAt: draft.createdAt || Date.now(),
    updatedAt: Date.now(),
  });
  store.set('lastRecordAt', Date.now());
  toast(amount != null ? `已记 ${fmtMoney(amount)}` : '已记录');
  closeSheet();
}

// ---------- 凭证大图 ----------
function openViewer(src) {
  const v = $('#viewer');
  $('img', v).src = src;
  v.hidden = false;
}
$('#viewer').addEventListener('click', () => { $('#viewer').hidden = true; });

// ---------- 账单 ----------
$('#search').addEventListener('input', () => renderList());

async function renderList() {
  renderMonthNavs();
  const q = $('#search').value.trim().toLowerCase();
  let recs = await db.recordsBetween(...monthRange(curMonth));
  if (q) recs = recs.filter(r => `${r.note} ${r.activity} ${catById(r.category).name}`.toLowerCase().includes(q));
  const total = recs.reduce((s, r) => s + (r.amount || 0), 0);
  $('#list-summary').innerHTML = `共 <b>${recs.length}</b> 笔，支出 <b>${fmtMoney(Math.round(total * 100) / 100)}</b>`;
  resetPool('list');
  if (!recs.length) {
    $('#list-days').innerHTML = `<div class="card empty">${q ? '没找到匹配的记录' : '这个月还没有记录'}</div>`;
    return;
  }
  const days = new Map();
  for (const r of recs) {
    const k = dayKey(r.time);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(r);
  }
  $('#list-days').innerHTML = [...days].map(([k, list]) => {
    const d = new Date(list[0].time);
    const sum = list.reduce((s, r) => s + (r.amount || 0), 0);
    return `<div class="card day">
      <div class="card-head"><span>${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}</span><span>${fmtMoney(Math.round(sum * 100) / 100)}</span></div>
      <ul class="rec-list">${list.map(r => recItem(r, 'list')).join('')}</ul>
    </div>`;
  }).join('');
}

// ---------- 统计 ----------
async function renderStats() {
  renderMonthNavs();
  const [start, end] = monthRange(curMonth);
  const recs = await db.recordsBetween(start, end);
  const spent = recs.filter(r => r.amount != null);
  const total = spent.reduce((s, r) => s + r.amount, 0);
  const minutes = recs.reduce((s, r) => s + (r.durationMin || 0), 0);
  const daysInMonth = new Date(curMonth.y, curMonth.m + 1, 0).getDate();
  const today = new Date();
  const isCurrent = today.getFullYear() === curMonth.y && today.getMonth() === curMonth.m;
  const daysPassed = isCurrent ? today.getDate() : daysInMonth;
  const r2 = n => Math.round(n * 100) / 100;

  if (!recs.length) { $('#stats').innerHTML = '<div class="card empty">这个月还没有记录</div>'; return; }

  const byCat = new Map();
  for (const r of spent) byCat.set(r.category, (byCat.get(r.category) || 0) + r.amount);
  const cats = [...byCat].sort((a, b) => b[1] - a[1]);
  const maxCat = cats[0]?.[1] || 1;

  const byDay = Array(daysInMonth).fill(0);
  for (const r of spent) byDay[new Date(r.time).getDate() - 1] += r.amount;
  const maxDay = Math.max(...byDay) || 1;

  const byAct = new Map();
  for (const r of recs) {
    if (!r.activity) continue;
    const a = byAct.get(r.activity) || { money: 0, min: 0, n: 0 };
    a.money += r.amount || 0; a.min += r.durationMin || 0; a.n++;
    byAct.set(r.activity, a);
  }
  const acts = [...byAct].sort((a, b) => b[1].money - a[1].money || b[1].min - a[1].min).slice(0, 8);

  $('#stats').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="muted">本月支出</div><b>${fmtMoney(r2(total))}</b></div>
      <div class="kpi"><div class="muted">日均</div><b>${fmtMoney(r2(total / daysPassed))}</b></div>
      <div class="kpi"><div class="muted">笔数</div><b>${recs.length}</b></div>
      <div class="kpi"><div class="muted">记录用时</div><b>${minutes ? fmtDur(minutes) : '—'}</b></div>
    </div>
    <div class="card">
      <h3>每日支出</h3>
      <div class="daybars">${byDay.map((v, i) => `<div class="daybar" title="${i + 1}日 ${fmtMoney(r2(v))}"><i style="height:${v ? Math.max(4, v / maxDay * 100) : 0}%"></i></div>`).join('')}</div>
      <div class="daybar-axis"><span>1日</span><span>${Math.ceil(daysInMonth / 2)}日</span><span>${daysInMonth}日</span></div>
    </div>
    <div class="card">
      <h3>按类别</h3>
      ${cats.length ? cats.map(([id, v]) => { const c = catById(id); return `<div class="bar-row">
        <span class="bar-label">${c.icon} ${c.name}</span>
        <span class="bar"><i style="width:${v / maxCat * 100}%"></i></span>
        <span class="bar-value">${fmtMoney(r2(v))}<small>${total ? Math.round(v / total * 100) : 0}%</small></span>
      </div>`; }).join('') : '<p class="muted">没有带金额的记录</p>'}
    </div>
    ${acts.length ? `<div class="card">
      <h3>按事项</h3>
      ${acts.map(([name, a]) => `<div class="act-row"><span class="grow">${esc(name)} <small class="muted">×${a.n}</small></span><span class="muted">${a.min ? fmtDur(a.min) : ''}</span><b>${a.money ? fmtMoney(r2(a.money)) : '—'}</b></div>`).join('')}
    </div>` : ''}`;
}

// ---------- 提醒 ----------
let swReg = null;
const notifyState = () => (!('Notification' in window) ? '不支持' : { granted: '已开启', denied: '已拒绝（去系统设置里打开）', default: '未开启' }[Notification.permission]);

async function ensureNotifyPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try { await Notification.requestPermission(); } catch { /* 部分浏览器要求用户手势 */ }
}

function nudge(title, body, action = 'record') {
  $('#banner-title').textContent = title;
  $('#banner-body').textContent = body;
  $('#banner-go').textContent = action === 'finish' ? '做完了' : '记一笔';
  $('#banner-go').dataset.action = action;
  if (sheet.hidden) $('#banner').hidden = false;
  navigator.vibrate?.(200);
  if (document.visibilityState === 'visible' && !document.hidden) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    const opts = { body, tag: 'voice-ledger', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { action } };
    try {
      if (swReg) swReg.showNotification(title, opts);
      else new Notification(title, opts);
    } catch { /* 安卓上只能通过 Service Worker 发通知 */ }
  }
}

$('#banner-go').addEventListener('click', () => { $('#banner').hidden = true; handleAction($('#banner-go').dataset.action); });
$('#banner-close').addEventListener('click', () => { $('#banner').hidden = true; });

function handleAction(action) {
  if (!sheet.hidden) return;
  if (action === 'finish' && getActivity()) finishActivity();
  else openSheet();
}

function inWindow(d) {
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const m = d.getHours() * 60 + d.getMinutes();
  const s = toMin(settings.remindStart), e = toMin(settings.remindEnd);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

function tick() {
  const now = Date.now();
  const act = getActivity();
  if (act?.planMin && !act.nudged && now - act.start >= act.planMin * 60000) {
    store.set('activity', { ...act, nudged: true });
    nudge(`「${act.name}」做完了吗？`, '做完就点「做完了」，拍凭证、说一句话', 'finish');
  }
  if (settings.remindEnabled && !act && inWindow(new Date())) {
    const last = Math.max(store.get('lastRecordAt', 0), store.get('lastNudgeAt', 0));
    if (now - last >= settings.remindEvery * 60000) {
      store.set('lastNudgeAt', now);
      nudge('刚做完什么事吗？', '花了钱就拍下凭证、说一句话，10 秒记好');
    }
  }
}
setInterval(tick, 20000);
setInterval(() => {
  const el = $('#act-clock');
  const act = getActivity();
  if (el && act) el.textContent = fmtClock(Date.now() - act.start);
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); refresh(); } });

// ---------- 设置 ----------
function renderSettings() {
  $('#s-remind').checked = settings.remindEnabled;
  $('#s-every').value = String(settings.remindEvery);
  $('#s-start').value = settings.remindStart;
  $('#s-end').value = settings.remindEnd;
  $('#s-audio').checked = settings.keepAudio;
  $('#s-notify-state').textContent = notifyState();
  $('#s-notify').hidden = !('Notification' in window) || Notification.permission !== 'default';
  const parts = [];
  parts.push(speechSupported() ? '✅ 支持语音转文字（需要联网）' : '⚠️ 这个浏览器不支持语音转文字，可用输入法键盘上的话筒代替');
  parts.push(recorderSupported() ? '✅ 支持保存录音' : '⚠️ 不支持保存录音');
  $('#s-voice-state').textContent = parts.join('；');
}

$('#s-remind').addEventListener('change', async e => {
  settings.remindEnabled = e.target.checked;
  if (settings.remindEnabled) { store.set('lastNudgeAt', Date.now()); await ensureNotifyPermission(); }
  saveSettings();
  renderSettings();
});
$('#s-every').addEventListener('change', e => { settings.remindEvery = Number(e.target.value); saveSettings(); });
$('#s-start').addEventListener('change', e => { settings.remindStart = e.target.value || DEFAULT_SETTINGS.remindStart; saveSettings(); });
$('#s-end').addEventListener('change', e => { settings.remindEnd = e.target.value || DEFAULT_SETTINGS.remindEnd; saveSettings(); });
$('#s-audio').addEventListener('change', e => { settings.keepAudio = e.target.checked; saveSettings(); });
$('#s-notify').addEventListener('click', async () => { await ensureNotifyPermission(); renderSettings(); });
$('#s-test').addEventListener('click', () => {
  toast('5 秒后提醒，可以先切到别的应用看看');
  setTimeout(() => nudge('测试提醒', '提醒正常。做完事记得记一笔'), 5000);
});

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

const blobToDataURL = b => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});
const dataURLToBlob = async u => (await fetch(u)).blob();
const stamp = () => dayKey(Date.now());

$('#s-csv').addEventListener('click', async () => {
  const recs = await db.allRecords();
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['时间', '金额', '类别', '说明', '关联事项', '用时(分钟)', '凭证张数', '有录音']];
  for (const r of recs) {
    const d = new Date(r.time);
    rows.push([`${dayKey(r.time)} ${pad(d.getHours())}:${pad(d.getMinutes())}`, r.amount ?? '', catById(r.category).name, r.note, r.activity, r.durationMin ?? '', r.photos?.length || 0, r.audio ? '是' : '']);
  }
  download(`语音记账-${stamp()}.csv`, new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
});

$('#s-backup').addEventListener('click', async () => {
  toast('正在打包…');
  const recs = await db.allRecords();
  const out = [];
  for (const r of recs) {
    out.push({
      ...r,
      photos: await Promise.all((r.photos || []).map(blobToDataURL)),
      audio: r.audio ? await blobToDataURL(r.audio) : null,
    });
  }
  download(`语音记账备份-${stamp()}.json`, new Blob([JSON.stringify({ app: 'voice-ledger', version: 1, records: out })], { type: 'application/json' }));
});

$('#s-restore').addEventListener('click', () => $('#s-restore-file').click());
$('#s-restore-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'voice-ledger' || !Array.isArray(data.records)) throw new Error('不是语音记账的备份文件');
    for (const r of data.records) {
      await db.putRecord({
        ...r,
        photos: await Promise.all((r.photos || []).map(dataURLToBlob)),
        audio: r.audio ? await dataURLToBlob(r.audio) : null,
      });
    }
    toast(`已导入 ${data.records.length} 笔`);
  } catch (err) {
    toast('导入失败：' + err.message);
  }
});

$('#s-clear').addEventListener('click', async () => {
  if (!confirm('确定清空全部记录？建议先导出备份。')) return;
  if (!confirm('再确认一次：删除后无法恢复。')) return;
  await db.clearAll();
  toast('已清空');
});

// ---------- 启动 ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => { swReg = reg; }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'nudge-action') handleAction(e.data.action);
  });
}

(async () => {
  if (!store.get('lastRecordAt', 0)) {
    const last = await db.latestRecord();
    if (last) store.set('lastRecordAt', last.updatedAt || last.time);
  }
  showView('home');
  const action = new URLSearchParams(location.search).get('action');
  if (action) {
    history.replaceState(null, '', location.pathname);
    handleAction(action);
  }
  tick();
})();
