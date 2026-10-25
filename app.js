import * as db from './db.js';
import { parseUtterance, parseDuration, timeCatById, guessTimeCat, getDefaultCurrency, CURRENCIES, currencyById } from './parser.js';
import { VoiceCapture, speechSupported } from './voice.js';
import { aiParse } from './ai.js';
import { fmtMin, fmtMoney, fmtRecMoney, toBase, convert, guessAccountType, summarizeTime, summarizeMoney, compileRules } from './analytics.js';
import { matchAccount, defaultAccountFor, isCompany } from './accounts.js';
import { $, $$, esc, uid, store, settings, saveSettings, aiConfig, toast, fmtClock, resetPool } from './ui.js';
import { openSheet, saveRecord, recItem, sheetOpen, dataChanged } from './sheet.js';
import { renderReview, renderTime, renderWealth, answerQuestion } from './views.js';
import { renderSettings, autoSync } from './settings.js';

// ---------- 页面切换 ----------
let currentView = 'home';
const renderers = { home: renderHome, review: renderReview, time: renderTime, wealth: renderWealth, settings: renderSettings };

export function showView(name) {
  currentView = name;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('#view-title').textContent = $('#view-' + name).dataset.title;
  window.scrollTo(0, 0);
  refresh();
}
const refresh = () => renderers[currentView]();

$$('.tabbar button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
document.addEventListener('data-changed', () => refresh());

// ---------- 首页：说一句 ----------
const EXAMPLES = ['开始写季度方案，预计两小时', '做完了，打车花了28', '和客户吃饭1200泰铢，要报销', '酒店120美元', '下午2点到4点和客户开会', '刷了一个小时抖音', '工资到账1万5', '报销款到账3000', '招行卡余额5万3', '这几天我干什么去了？'];
let heroVoice = null;

function renderExamples() {
  const recent = store.get('recentActivities', []);
  const cur = currencyById(getDefaultCurrency());
  $('#hero-examples').innerHTML =
    `<div class="cur-switch"><button class="chip" data-cycle-currency title="换一种默认币种">说「块」= ${cur.symbol} ${cur.name} ⇄</button></div>` +
    (recent.length && !getActivity() ? `<div class="chips">${recent.slice(0, 4).map(n => `<button class="chip" data-quick-start="${esc(n)}">▶ ${esc(n)}</button>`).join('')}</div>` : '') +
    `<p class="hint">可以这样说：${EXAMPLES.map(e => `「${e}」`).join(' ')}</p>`;
}
$('#hero-examples').addEventListener('click', e => {
  const b = e.target.closest('[data-quick-start]');
  if (b) startActivity(b.dataset.quickStart, guessTimeCat(b.dataset.quickStart), 0);
  if (e.target.closest('[data-cycle-currency]')) {
    // 人到了哪个国家就切到哪种货币；「元/人民币」「泰铢」「美元」这类明确说法不受影响
    const i = CURRENCIES.findIndex(c => c.id === settings.defaultCurrency);
    settings.defaultCurrency = CURRENCIES[(i + 1) % CURRENCIES.length].id;
    saveSettings();
    renderExamples();
    toast(`现在说「块」或只说数字，按${currencyById(settings.defaultCurrency).name}记`);
  }
});

function heroState(state, text) {
  $('#hero-mic').classList.toggle('recording', state === 'recording');
  $('#hero-mic').disabled = state === 'busy';
  $('#hero-hint').textContent = text || { idle: '点一下，说一句', recording: '正在听…说完再点一下', busy: '理解中…' }[state];
  if (state !== 'recording') $('#hero-live').hidden = true;
}

$('#hero-mic').addEventListener('click', async () => {
  if (heroVoice) {
    const v = heroVoice;
    heroVoice = null;
    heroState('busy', '处理中…');
    const { text, audio } = await v.stop();
    heroState('idle');
    if (text) await handleCommand(text, { audio });
    else if (audio) { toast('没识别出文字，已保留录音，补一句说明吧'); openSheet(null, { audio }); }
    else toast('没听清，再说一次');
    return;
  }
  heroVoice = new VoiceCapture({
    keepAudio: settings.keepAudio,
    onText: t => { const el = $('#hero-live'); el.hidden = false; el.textContent = t; },
    onError: msg => toast(msg),
  });
  try {
    await heroVoice.start();
    heroState('recording');
  } catch (e) {
    heroVoice = null;
    heroState('idle');
    toast('无法使用麦克风：' + (e.message || e.name) + '。可以直接打字');
  }
});

$('#hero-form').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('#hero-input').value.trim();
  if (!t) return;
  $('#hero-input').value = '';
  $('#hero-input').blur();
  handleCommand(t);
});

// 一句话 → 动作
export async function understand(text) {
  const cfg = aiConfig();
  if (cfg) {
    try {
      return await aiParse(cfg, text, { activity: getActivity()?.name, accounts: (await activeAccounts()).map(a => a.name) });
    } catch (e) {
      toast('AI 暂时不可用，用本地理解：' + e.message);
    }
  }
  return parseUtterance(text);
}

async function handleCommand(text, { audio = null } = {}) {
  heroState('busy');
  let intent;
  try {
    intent = await understand(text);
  } finally {
    heroState('idle');
  }
  const extras = { audio, source: 'voice' };

  if (intent.type === 'question') {
    showView('review');
    answerQuestion(intent);
    return;
  }
  if (intent.type === 'start') {
    startActivity(intent.title, intent.timeCat, intent.planMin ?? parseDuration(text) ?? 0);
    return;
  }
  if (intent.type === 'finish') {
    if (intent.entry?.amount != null) Object.assign(intent.entry, await accountFieldsFor(text, intent.entry));
    await finishActivity(intent.entry, extras);
    return;
  }
  if (intent.type === 'balance' && intent.value != null) {
    await saveBalance(intent);
    return;
  }
  if (intent.type === 'transfer') {
    await saveTransfer(intent);
    return;
  }
  // 付款 / 收款账户：话里提到的优先，否则用同币种最近用过的
  if (intent.amount != null) Object.assign(intent, await accountFieldsFor(text, intent));
  // 记一笔：刚做完的事在等补充花费时，合并进去
  const followId = followUp?.id;
  if (followId && intent.amount != null && !intent.durationMin) {
    const rec = await db.getRecord(followId);
    if (rec) {
      Object.assign(rec, moneyFields(intent));
      rec.note = [rec.note, intent.note].filter(Boolean).join('，');
      if (audio) rec.audio = audio;
      await saveRecord(rec);
      followUp = null;
      toast(`「${rec.activity}」花了 ${fmtRecMoney(rec)}${rec.reimbursable ? '（待报销）' : ''}`, { label: '加凭证', run: () => openSheet(rec, { pickPhoto: 'gallery' }) });
      return;
    }
  }
  const rec = await saveRecord({
    activity: intent.title, note: intent.note || text, ...moneyFields(intent),
    timeCat: intent.timeCat, time: intent.start ?? Date.now(), durationMin: intent.durationMin, ...extras,
  });
  const what = [
    rec.durationMin ? fmtMin(rec.durationMin) : '',
    rec.amount != null ? (rec.direction === 'in' ? '+' : '') + fmtRecMoney(rec) : '',
    rec.reimbursable ? '待报销' : '',
    rec.accountName || '',
  ].filter(Boolean).join(' · ');
  // 报销款到账：顺手把待报销的记录标成已报销
  if (rec.direction === 'in' && rec.category === 'refund') {
    toast(`已记：报销款 ${fmtRecMoney(rec)}`, { label: '核销待报销', run: () => settleReimbursements(rec) });
    return;
  }
  toast(`已记：${rec.activity || rec.note}${what ? ' · ' + what : ''}`, { label: '修改', run: () => openSheet(rec) });
}

const moneyFields = i => ({
  amount: i.amount ?? null, currency: i.currency, direction: i.direction, category: i.category, reimbursable: !!i.reimbursable,
  accountId: i.accountId ?? null, accountName: i.accountName ?? '', company: !!i.company,
});

const activeAccounts = async () => (await db.all('accounts')).filter(a => !a.archived);

// 找出这笔钱走的是哪个账户；没明说币种时改用账户的币种；公司账户付的不用再报销
async function accountFieldsFor(text, intent) {
  const accounts = await activeAccounts();
  if (!accounts.length) return {};
  let acc = (intent.accountHint && matchAccount(intent.accountHint, accounts)) || matchAccount(text, accounts);
  if (!acc) {
    const recent = await db.recordsBetween(Date.now() - 90 * 86400000, Date.now() + 86400000);
    acc = defaultAccountFor(intent.currency || getDefaultCurrency(), accounts, recent);
  }
  if (!acc) return {};
  const out = { accountId: acc.id, accountName: acc.name, company: isCompany(acc) };
  if (!intent.currencyExplicit && acc.currency) out.currency = acc.currency;
  if (out.company) out.reimbursable = false;
  return out;
}

async function saveTransfer(t) {
  const accounts = await activeAccounts();
  const from = matchAccount(t.from, accounts), to = matchAccount(t.to, accounts);
  if (!from || !to) {
    toast(`没找到账户「${!from ? t.from : t.to}」，先在「财富 → 账户」里添加`);
    return;
  }
  const currency = t.currency || from.currency || getDefaultCurrency();
  const toCurrency = t.toCurrency || to.currency || currency;
  const toAmount = t.toAmount ?? (toCurrency !== currency ? Math.round(convert(t.amount, currency, toCurrency) * 100) / 100 : null);
  const rec = await saveRecord({
    direction: 'transfer', amount: t.amount, currency, accountId: from.id, accountName: from.name,
    toAccountId: to.id, toAccountName: to.name, toAmount, toCurrency,
    activity: `${from.name} → ${to.name}`, note: t.text || '', source: 'voice',
  });
  toast(`已转账：${from.name} → ${to.name} ${fmtRecMoney(rec)}${toAmount != null ? ` → ${fmtMoney(toAmount, toCurrency)}` : ''}`, { label: '修改', run: () => openSheet(rec) });
}

// 按时间从早到晚，把金额加起来不超过这笔报销款的待报销记录标成已报销
async function settleReimbursements(refund) {
  const budget = toBase(refund.amount, refund.currency) * 1.01;
  const pending = (await db.allRecords()).filter(r => r.reimbursable && !r.reimbursed && r.amount != null).sort((a, b) => a.time - b.time);
  let used = 0, n = 0;
  for (const r of pending) {
    const v = toBase(r.amount, r.currency);
    if (used + v > budget) break;
    used += v;
    await db.putRecord({ ...r, reimbursed: true, updatedAt: Date.now() });
    n++;
  }
  dataChanged();
  toast(n ? `已把 ${n} 笔标成已报销（${fmtMoney(used)}）` : '没有能对上的待报销记录，可以在记录里手动改');
}

async function saveBalance({ account, value, currency, currencyExplicit, liability, text }) {
  const accounts = await activeAccounts();
  let acc = accounts.find(a => a.name === account) || matchAccount(account, accounts) || matchAccount(text || '', accounts)
    || accounts.find(a => a.name.includes(account) || account.includes(a.name));
  if (!acc) {
    acc = { id: uid(), name: account, type: guessAccountType(account, liability), currency: currency || getDefaultCurrency(), owner: /公司|公户/.test(account) ? 'company' : 'personal', aliases: [], createdAt: Date.now() };
    await db.put('accounts', acc);
  }
  const b = { id: uid(), accountId: acc.id, value, time: Date.now() };
  await db.put('balances', b);
  dataChanged();
  toast(`${acc.name}：${fmtMoney(value, acc.currency || 'CNY')}`, { label: '撤销', run: async () => { await db.del('balances', b.id); dataChanged(); } });
}

// ---------- 正在做的事 ----------
const getActivity = () => store.get('activity', null);
let followUp = null; // 刚做完、等着补花费的记录 {id, name, durationMin}

function startActivity(name, timeCat, planMin) {
  name = (name || '').trim();
  if (!name) { toast('要开始做什么？'); return; }
  const prev = getActivity();
  if (prev) finishActivity(null, {}, { silent: true });
  store.set('activity', { name, timeCat: timeCat || guessTimeCat(name), start: Date.now(), planMin: planMin || 0, nudged: false });
  store.set('recentActivities', [name, ...store.get('recentActivities', []).filter(n => n !== name)].slice(0, 8));
  followUp = null;
  ensureNotifyPermission();
  toast(`开始「${name}」${planMin ? `，${fmtMin(planMin)}后提醒你` : ''}`, { label: '撤销', run: () => { store.set('activity', null); renderHome(); } });
  renderHome();
}

async function finishActivity(entry, extras = {}, { silent = false } = {}) {
  const act = getActivity();
  if (!act) {
    if (entry) {
      const rec = await saveRecord({ activity: entry.title, note: entry.note, ...moneyFields(entry), timeCat: entry.timeCat, ...extras });
      toast('已记录', { label: '修改', run: () => openSheet(rec) });
    } else if (!silent) {
      toast('现在没有在计时的事。可以说「开始…」');
    }
    return;
  }
  store.set('activity', null);
  const durationMin = Math.max(1, Math.round((Date.now() - act.start) / 60000));
  const rec = await saveRecord({
    activity: act.name, timeCat: act.timeCat, time: act.start, durationMin, source: 'timer',
    note: entry?.note && entry.note !== act.name ? entry.note : '',
    ...(entry ? moneyFields(entry) : {}), audio: extras.audio,
  });
  if (silent) return;
  if (rec.amount != null) {
    toast(`「${act.name}」${fmtMin(durationMin)} · ${fmtRecMoney(rec)}${rec.reimbursable ? '（待报销）' : ''}`, { label: '加凭证', run: () => openSheet(rec, { pickPhoto: 'gallery' }) });
  } else {
    followUp = { id: rec.id, name: act.name, durationMin };
  }
  renderHome();
}

function renderActivity() {
  const act = getActivity();
  const card = $('#activity-card');
  if (act) {
    const tc = timeCatById(act.timeCat);
    card.innerHTML = `<div class="act-run">
      <div class="muted">${tc.icon} 正在做</div>
      <div class="act-name">${esc(act.name)}</div>
      <div class="act-clock" id="act-clock">${fmtClock(Date.now() - act.start)}</div>
      ${act.planMin ? `<div class="muted small">预计 ${fmtMin(act.planMin)}，到点提醒你</div>` : ''}
      <div class="btn-row">
        <button class="btn primary grow" data-act="finish">✅ 做完了</button>
        <button class="btn ghost" data-act="cancel">放弃</button>
      </div>
      <p class="hint">也可以直接说「做完了，花了 xx 块」</p>
    </div>`;
  } else if (followUp) {
    card.innerHTML = `<div class="follow">
      <div><b>「${esc(followUp.name)}」做完了</b>，用时 ${fmtMin(followUp.durationMin)}，已记录。</div>
      <div class="muted">这件事花钱了吗？</div>
      <div class="btn-row">
        <button class="btn primary" data-act="photo">📷 拍凭证</button>
        <button class="btn" data-act="album">🖼️ 相册</button>
        <button class="btn" data-act="say">🎙️ 说花了多少</button>
        <button class="btn ghost" data-act="nomoney">没花钱</button>
      </div>
    </div>`;
  }
  card.hidden = !act && !followUp;
}

$('#activity-card').addEventListener('click', async e => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'finish') finishActivity(null);
  else if (act === 'cancel' && confirm('放弃这件事，不记录？')) { store.set('activity', null); renderHome(); }
  else if (act === 'photo' || act === 'album') {
    const rec = await db.getRecord(followUp.id);
    followUp = null;
    if (rec) openSheet(rec, { pickPhoto: act === 'album' ? 'gallery' : 'camera' });
    renderActivity();
  }
  else if (act === 'say') $('#hero-mic').click();
  else if (act === 'nomoney') { followUp = null; renderActivity(); }
});

$('#btn-new').addEventListener('click', () => openSheet());
$('#btn-photo').addEventListener('click', () => openSheet(null, { pickPhoto: 'camera', heading: '凭证记一笔' }));
$('#btn-album').addEventListener('click', () => openSheet(null, { pickPhoto: 'gallery', heading: '凭证记一笔' }));

// ---------- 首页：今天 ----------
async function renderHome() {
  renderActivity();
  renderExamples();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const range = { start: start.getTime(), end: start.getTime() + 86400000 };
  const [recs, usage] = await Promise.all([db.recordsBetween(range.start, range.end), db.usageBetween(range.start, range.end)]);
  const t = summarizeTime(recs, usage, range, compileRules(settings.appRules));
  const m = summarizeMoney(recs, range);
  const parts = [];
  if (t.recorded) parts.push(`⏱ ${fmtMin(t.recorded)}`);
  if (t.device.total) parts.push(`💻 ${fmtMin(t.device.total)}`);
  parts.push(`支出 <b>${fmtMoney(m.out)}</b>`);
  if (m.in) parts.push(`收入 <b>${fmtMoney(m.in)}</b>`);
  if (m.reimbPending) parts.push(`待报销 <b>${fmtMoney(m.reimbPending)}</b>`);
  $('#today-summary').innerHTML = parts.join(' · ');
  resetPool('today');
  $('#today-list').innerHTML = recs.length
    ? recs.map(r => recItem(r, 'today')).join('')
    : '<li class="empty">今天还没有记录。做完一件事，说一句就行。</li>';
}

setInterval(() => {
  const el = $('#act-clock');
  const act = getActivity();
  if (el && act) el.textContent = fmtClock(Date.now() - act.start);
}, 1000);

// ---------- 提醒 ----------
let swReg = null;
export async function ensureNotifyPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try { await Notification.requestPermission(); } catch { /* 部分浏览器要求用户手势 */ }
}

export function nudge(title, body, action = 'record') {
  $('#banner-title').textContent = title;
  $('#banner-body').textContent = body;
  $('#banner-go').textContent = action === 'finish' ? '做完了' : '说一句';
  $('#banner-go').dataset.action = action;
  if (!sheetOpen()) $('#banner').hidden = false;
  navigator.vibrate?.(200);
  if (!document.hidden) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    const opts = { body, tag: 'time-ledger', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { action } };
    try {
      if (swReg) swReg.showNotification(title, opts);
      else new Notification(title, opts);
    } catch { /* 安卓上只能通过 Service Worker 发通知 */ }
  }
}

$('#banner-go').addEventListener('click', () => { $('#banner').hidden = true; handleAction($('#banner-go').dataset.action); });
$('#banner-close').addEventListener('click', () => { $('#banner').hidden = true; });

function handleAction(action) {
  if (sheetOpen()) return;
  showView('home');
  if (action === 'finish' && getActivity()) finishActivity(null);
  else if (action === 'record') $('#hero-mic').click();
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
    nudge(`「${act.name}」做完了吗？`, '做完就说「做完了」，花了钱顺便拍下凭证', 'finish');
  }
  if (settings.remindEnabled && !act && inWindow(new Date())) {
    const last = Math.max(store.get('lastRecordAt', 0), store.get('lastNudgeAt', 0));
    if (now - last >= settings.remindEvery * 60000) {
      store.set('lastNudgeAt', now);
      nudge('刚才在做什么？', '说一句：做了什么、用了多久、花了多少');
    }
  }
}
setInterval(tick, 20000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  tick();
  autoSync().then(n => n && refresh());
  refresh();
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
  if (!speechSupported()) $('#hero-hint').textContent = '这个浏览器不能语音转文字，可用输入法的话筒打字';
  const action = new URLSearchParams(location.search).get('action');
  if (action) {
    history.replaceState(null, '', location.pathname);
    handleAction(action);
  }
  tick();
  if (await autoSync()) refresh();
})();
