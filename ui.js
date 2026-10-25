// 各页面共用的小工具和设置
import { DEFAULT_APP_RULES, DEFAULT_RATES, setFx } from './analytics.js';
import { setDefaultCurrency } from './parser.js';

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const pad = n => String(n).padStart(2, '0');
export const WEEK = '日一二三四五六';

export const fmtTime = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtClock = ms => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
export const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const dayLabel = ms => { const d = new Date(ms); return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[d.getDay()]}`; };

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 隐私模式下可能不可用 */ } },
};

export const DEFAULT_SETTINGS = {
  remindEnabled: false, remindEvery: 90, remindStart: '09:00', remindEnd: '22:00',
  keepAudio: true, speakAnswers: true,
  aiEnabled: false, apiKey: '', model: 'claude-opus-5-5',
  appRules: DEFAULT_APP_RULES,
  growthRate: 6,
  baseCurrency: 'CNY',      // 统计折算成哪种货币
  defaultCurrency: 'CNY',   // 说「块」或不带单位时指哪种货币（人在哪就设哪种）
  rates: DEFAULT_RATES,     // 1 单位外币 = 多少人民币
  ratesUpdatedAt: 0,
};
export const settings = { ...DEFAULT_SETTINGS, ...store.get('settings', {}) };
export function applyCurrencySettings() {
  setFx(settings.baseCurrency, settings.rates);
  setDefaultCurrency(settings.defaultCurrency);
}
applyCurrencySettings();
export const saveSettings = () => { store.set('settings', settings); applyCurrencySettings(); };
export const aiConfig = () => (settings.aiEnabled && settings.apiKey ? { apiKey: settings.apiKey, model: settings.model } : null);

let toastTimer;
export function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = esc(msg) + (action ? ` <button class="toast-action">${esc(action.label)}</button>` : '');
  if (action) $('.toast-action', el).onclick = () => { el.hidden = true; action.run(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 2400);
}

// 每个列表一组 objectURL，重新渲染时释放旧的
const urlPools = {};
export function blobUrl(pool, blob) {
  const u = URL.createObjectURL(blob);
  (urlPools[pool] ??= []).push(u);
  return u;
}
export function resetPool(pool) {
  (urlPools[pool] || []).forEach(u => URL.revokeObjectURL(u));
  urlPools[pool] = [];
}

export function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// 横向条形图的一行
export const barRow = (label, value, max, right, sub = '') => `<div class="bar-row">
  <span class="bar-label">${label}</span>
  <span class="bar"><i style="width:${max ? Math.max(2, value / max * 100) : 0}%"></i></span>
  <span class="bar-value">${right}${sub ? `<small>${sub}</small>` : ''}</span>
</div>`;

export const chips = (items, active, attr) => items.map(([k, label]) =>
  `<button class="chip${k === active ? ' active' : ''}" ${attr}="${esc(k)}">${esc(label)}</button>`).join('');
