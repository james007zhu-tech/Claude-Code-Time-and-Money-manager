// 设置页：电脑记录同步、提醒、语音、AI、备份
import * as db from './db.js';
import { catById, timeCatById } from './parser.js';
import { speechSupported, recorderSupported } from './voice.js';
import { AI_MODELS, aiTest } from './ai.js';
import { DEFAULT_APP_RULES } from './analytics.js';
import { $, store, settings, saveSettings, DEFAULT_SETTINGS, toast, download, dayKey, pad } from './ui.js';
import { dataChanged } from './sheet.js';

const notifyState = () => (!('Notification' in window) ? '不支持' : { granted: '已开启', denied: '已拒绝（去系统设置里打开）', default: '未开启' }[Notification.permission]);

$('#s-model').innerHTML = AI_MODELS.map(m => `<option value="${m.id}">${m.name}</option>`).join('');

export function renderSettings() {
  $('#s-remind').checked = settings.remindEnabled;
  $('#s-every').value = String(settings.remindEvery);
  $('#s-start').value = settings.remindStart;
  $('#s-end').value = settings.remindEnd;
  $('#s-audio').checked = settings.keepAudio;
  $('#s-speak').checked = settings.speakAnswers;
  $('#s-ai').checked = settings.aiEnabled;
  $('#s-key').value = settings.apiKey;
  $('#s-model').value = settings.model;
  $('#s-rules').value = settings.appRules;
  $('#s-notify-state').textContent = notifyState();
  $('#s-notify').hidden = !('Notification' in window) || Notification.permission !== 'default';
  $('#s-voice-state').textContent = [
    speechSupported() ? '✅ 支持语音转文字（需联网）' : '⚠️ 不支持语音转文字，可用输入法键盘上的话筒',
    recorderSupported() ? '✅ 支持保存录音' : '⚠️ 不支持保存录音',
    window.speechSynthesis ? '✅ 支持朗读' : '⚠️ 不支持朗读',
  ].join('；');
  const canPick = 'showDirectoryPicker' in window;
  $('#s-sync-folder').hidden = !canPick;
  db.kvGet('syncDir').then(h => {
    $('#s-sync-now').hidden = !h;
    const last = store.get('lastSyncAt', 0);
    $('#s-sync-state').textContent = h
      ? `同步文件夹：${h.name}${last ? `，上次同步 ${new Date(last).toLocaleString()}` : ''}。打开应用时自动读取。`
      : canPick ? '在电脑浏览器里可以选一个同步文件夹（例如 iCloud Drive / OneDrive 里的 TimeLedger），之后自动读取。' : '手机上：在「文件」App 里找到电脑记录器保存的文件，用「导入记录文件」导入。';
  });
}

const bind = (id, ev, fn) => $(id).addEventListener(ev, fn);
bind('#s-remind', 'change', async e => {
  settings.remindEnabled = e.target.checked;
  if (settings.remindEnabled) {
    store.set('lastNudgeAt', Date.now());
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission().catch(() => {});
  }
  saveSettings();
  renderSettings();
});
bind('#s-every', 'change', e => { settings.remindEvery = Number(e.target.value); saveSettings(); });
bind('#s-start', 'change', e => { settings.remindStart = e.target.value || DEFAULT_SETTINGS.remindStart; saveSettings(); });
bind('#s-end', 'change', e => { settings.remindEnd = e.target.value || DEFAULT_SETTINGS.remindEnd; saveSettings(); });
bind('#s-audio', 'change', e => { settings.keepAudio = e.target.checked; saveSettings(); });
bind('#s-speak', 'change', e => { settings.speakAnswers = e.target.checked; saveSettings(); });
bind('#s-notify', 'click', async () => { await Notification.requestPermission().catch(() => {}); renderSettings(); });
bind('#s-test', 'click', () => {
  toast('5 秒后提醒，可以先切到别的应用看看');
  import('./app.js').then(({ nudge }) => setTimeout(() => nudge('测试提醒', '提醒正常。做完事说一句就行'), 5000));
});
bind('#s-ai', 'change', e => { settings.aiEnabled = e.target.checked; saveSettings(); });
bind('#s-key', 'change', e => { settings.apiKey = e.target.value.trim(); saveSettings(); });
bind('#s-model', 'change', e => { settings.model = e.target.value; saveSettings(); });
bind('#s-ai-test', 'click', async () => {
  if (!settings.apiKey) { toast('先填 API Key'); return; }
  toast('连接中…');
  try {
    await aiTest({ apiKey: settings.apiKey, model: settings.model });
    toast('✅ 连接成功');
  } catch (e) {
    toast('连接失败：' + e.message);
  }
});
bind('#s-rules', 'change', e => { settings.appRules = e.target.value; saveSettings(); dataChanged(); });
bind('#s-rules-reset', 'click', () => { settings.appRules = DEFAULT_APP_RULES; saveSettings(); renderSettings(); });

// ---------- 电脑记录同步 ----------
// 电脑记录器每天写一个 usage-<设备>-<日期>.json；完整备份也可以放进同一个文件夹，互相合并
export async function importJson(data) {
  if (data?.app === 'time-ledger-usage') {
    const device = String(data.device || 'computer');
    const sessions = (data.sessions || [])
      .filter(s => s.end > s.start && s.app)
      .map(s => ({ id: `${device}|${s.start}`, device, os: data.os || '', app: s.app, title: s.title || '', domain: s.domain || '', start: s.start, end: s.end, dayKey: `${device}|${data.date}` }));
    await db.replaceUsageDay(device, data.date, sessions);
    return { usage: sessions.length };
  }
  if (data?.app === 'voice-ledger' && Array.isArray(data.records)) {
    let n = 0;
    for (const r of data.records) {
      const cur = await db.getRecord(r.id);
      if (cur && (cur.updatedAt || 0) >= (r.updatedAt || 0)) continue;
      await db.putRecord({ ...r, photos: await Promise.all((r.photos || []).map(dataURLToBlob)), audio: r.audio ? await dataURLToBlob(r.audio) : null });
      n++;
    }
    for (const name of ['accounts', 'balances', 'decisions']) if (Array.isArray(data[name])) await db.putMany(name, data[name]);
    if (data.timeTags) store.set('timeTags', { ...data.timeTags, ...store.get('timeTags', {}) });
    return { records: n };
  }
  throw new Error('不认识的文件');
}

bind('#s-import-usage', 'click', () => $('#s-import-usage-file').click());
bind('#s-import-usage-file', 'change', async e => {
  const files = [...e.target.files];
  e.target.value = '';
  let usage = 0, records = 0, bad = 0;
  for (const f of files) {
    try {
      const r = await importJson(JSON.parse(await f.text()));
      usage += r.usage || 0; records += r.records || 0;
    } catch { bad++; }
  }
  toast(`导入了 ${usage} 段电脑使用记录${records ? `、${records} 条记录` : ''}${bad ? `，${bad} 个文件无法识别` : ''}`);
  dataChanged();
});

bind('#s-sync-folder', 'click', async () => {
  try {
    const dir = await window.showDirectoryPicker({ id: 'time-ledger', mode: 'read' });
    await db.kvSet('syncDir', dir);
    store.set('syncSeen', {});
    const n = await autoSync({ interactive: true });
    toast(`已选择「${dir.name}」，读取了 ${n} 个文件`);
    renderSettings();
    dataChanged();
  } catch (e) {
    if (e.name !== 'AbortError') toast('无法使用这个文件夹：' + e.message);
  }
});
bind('#s-sync-now', 'click', async () => {
  const n = await autoSync({ interactive: true });
  toast(n ? `读取了 ${n} 个新文件` : '没有新文件');
  renderSettings();
  dataChanged();
});

// 读取同步文件夹里有更新的文件，返回读取的文件数
export async function autoSync({ interactive = false } = {}) {
  let dir;
  try { dir = await db.kvGet('syncDir'); } catch { return 0; }
  if (!dir?.queryPermission) return 0;
  let perm = await dir.queryPermission({ mode: 'read' });
  if (perm !== 'granted' && interactive) perm = await dir.requestPermission({ mode: 'read' });
  if (perm !== 'granted') return 0;
  const seen = store.get('syncSeen', {});
  let n = 0;
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
    const file = await handle.getFile();
    if (seen[name] === file.lastModified) continue;
    try {
      await importJson(JSON.parse(await file.text()));
      seen[name] = file.lastModified;
      n++;
    } catch { /* 跳过不认识的文件 */ }
  }
  store.set('syncSeen', seen);
  store.set('lastSyncAt', Date.now());
  return n;
}

// ---------- 备份 ----------
const blobToDataURL = b => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});
const dataURLToBlob = async u => (await fetch(u)).blob();

bind('#s-csv', 'click', async () => {
  const recs = await db.allRecords();
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['开始时间', '做了什么', '说明', '用时(分钟)', '时间类别', '收支', '金额', '类别', '凭证张数', '有录音']];
  for (const r of recs) {
    const d = new Date(r.time);
    rows.push([
      `${dayKey(r.time)} ${pad(d.getHours())}:${pad(d.getMinutes())}`, r.activity, r.note, r.durationMin ?? '', r.timeCat ? timeCatById(r.timeCat).name : '',
      r.amount != null ? (r.direction === 'in' ? '收入' : '支出') : '', r.amount ?? '', r.amount != null ? catById(r.category).name : '',
      r.photos?.length || 0, r.audio ? '是' : '',
    ]);
  }
  download(`时间账本-${dayKey(Date.now())}.csv`, new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
});

bind('#s-backup', 'click', async () => {
  toast('正在打包…');
  const recs = await db.allRecords();
  const out = [];
  for (const r of recs) {
    out.push({ ...r, photos: await Promise.all((r.photos || []).map(blobToDataURL)), audio: r.audio ? await blobToDataURL(r.audio) : null });
  }
  const [accounts, balances, decisions] = await Promise.all([db.all('accounts'), db.all('balances'), db.all('decisions')]);
  const data = { app: 'voice-ledger', version: 2, exportedAt: Date.now(), records: out, accounts, balances, decisions, timeTags: store.get('timeTags', {}) };
  download(`时间账本备份-${dayKey(Date.now())}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
});

bind('#s-restore', 'click', () => $('#s-restore-file').click());
bind('#s-restore-file', 'change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const r = await importJson(JSON.parse(await file.text()));
    toast(r.records != null ? `导入了 ${r.records} 条新记录` : `导入了 ${r.usage} 段电脑使用记录`);
    dataChanged();
  } catch (err) {
    toast('导入失败：' + err.message);
  }
});

bind('#s-clear', 'click', async () => {
  if (!confirm('确定清空全部数据？建议先导出备份。')) return;
  if (!confirm('再确认一次：删除后无法恢复。')) return;
  await db.clearAll();
  toast('已清空');
  dataChanged();
});
