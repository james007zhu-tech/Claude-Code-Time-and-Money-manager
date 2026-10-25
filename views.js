// 回顾（这几天/这几年干了什么）、时间管理（德鲁克）、财富管理（巴菲特）
import * as db from './db.js';
import { parseUtterance, parseRange, rangeOf, timeCatById, catById, TIME_CATS } from './parser.js';
import { VoiceCapture, speak, stopSpeaking } from './voice.js';
import { aiParse, aiAnswer } from './ai.js';
import {
  fmtMin, fmtHours, fmtMoney, summarizeTime, summarizeMoney, compileRules, diagnosis, localAnswer, dataDigest,
  ACCOUNT_TYPES, accountType, balanceSheet, netWorthSeries, healthCheck, futureValue, avgMonthlyOut,
} from './analytics.js';
import { $, esc, uid, store, settings, saveSettings, aiConfig, toast, resetPool, dayKey, dayLabel, barRow, chips } from './ui.js';
import { recItem, openDialog, dataChanged } from './sheet.js';

const DAY = 86400000;
const rules = () => compileRules(settings.appRules);

async function loadRange(range) {
  const [records, usage] = await Promise.all([db.recordsBetween(range.start - DAY, range.end), db.usageBetween(range.start, range.end)]);
  return { records, usage };
}

// ================= 回顾 =================
const REVIEW_RANGES = [['today', '今天'], ['yesterday', '昨天'], ['days3', '这几天'], ['week', '本周'], ['month', '本月'], ['year', '今年'], ['all', '全部']];
const keyRange = k => (k === 'days3' ? rangeOf('days', Date.now(), 3) : rangeOf(k));
let reviewKey = 'days3';
let reviewRange = keyRange(reviewKey);
let lastAnswer = null;

$('#review-ranges').addEventListener('click', e => {
  const b = e.target.closest('[data-range]');
  if (!b) return;
  reviewKey = b.dataset.range;
  reviewRange = keyRange(reviewKey);
  $('#review-answer').hidden = true;
  renderReview();
});

export async function renderReview() {
  // 提问得到的范围如果和某个按钮一样，就高亮那个按钮
  const same = REVIEW_RANGES.find(([k]) => { const r = keyRange(k); return r.start === reviewRange.start && r.end === reviewRange.end; });
  const active = reviewKey || same?.[0];
  $('#review-ranges').innerHTML = chips(REVIEW_RANGES, active, 'data-range') + (active ? '' : `<button class="chip active">${esc(reviewRange.label)}</button>`);
  const range = reviewRange;
  const { records, usage } = await loadRange(range);
  const inRange = records.filter(r => r.time >= range.start && r.time < range.end);
  const t = summarizeTime(records, usage, range, rules());
  const m = summarizeMoney(records, range);
  const catMax = Math.max(0, ...Object.values(t.byCat));
  const moneyMax = Math.max(0, ...Object.values(m.byCat));

  let html = `<div class="card">
    <h3>${esc(range.label)}概览</h3>
    <div class="kpis">
      <div class="kpi"><div class="muted">记录的时间</div><b>${t.recorded ? fmtHours(t.recorded) : '—'}</b></div>
      <div class="kpi"><div class="muted">电脑使用</div><b>${t.device.total ? fmtHours(t.device.total) : '—'}</b></div>
      <div class="kpi"><div class="muted">支出</div><b>${fmtMoney(m.out)}</b></div>
      <div class="kpi"><div class="muted">收入</div><b>${fmtMoney(m.in)}</b></div>
    </div>
    ${t.recorded ? `<h4>时间花在</h4>${Object.entries(t.byCat).sort((a, b) => b[1] - a[1]).map(([id, v]) => { const c = timeCatById(id); return barRow(`${c.icon} ${c.short}`, v, catMax, fmtHours(v), `${Math.round(v / t.recorded * 100)}%`); }).join('')}` : ''}
    ${t.titles.length ? `<h4>主要在做</h4><div class="tags">${t.titles.slice(0, 10).map(x => `<span class="tagpill">${esc(x.title)} <b>${fmtHours(x.min)}</b></span>`).join('')}</div>` : ''}
    ${m.out ? `<h4>钱花在</h4>${Object.entries(m.byCat).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, v]) => { const c = catById(id); return barRow(`${c.icon} ${c.name}`, v, moneyMax, fmtMoney(v)); }).join('')}` : ''}
  </div>`;

  resetPool('review');
  const spanDays = (Math.min(range.end, Date.now() + DAY) - Math.max(range.start, earliestOf(inRange, usage))) / DAY;
  if (!inRange.length && !usage.length) {
    html += '<div class="card empty">这段时间还没有记录</div>';
  } else if (spanDays <= 45) {
    html += timelineByDay(inRange, usage, range);
  } else {
    html += timelineByMonth(records, usage, range);
  }
  $('#review-body').innerHTML = html;
}

const earliestOf = (recs, usage) => Math.min(Date.now(), ...recs.map(r => r.time), ...usage.map(u => u.start));

function timelineByDay(recs, usage, range) {
  const days = new Map();
  const ensure = k => { if (!days.has(k)) days.set(k, { recs: [], usage: [] }); return days.get(k); };
  for (const r of recs) ensure(dayKey(r.time)).recs.push(r);
  for (const u of usage) if (u.start >= range.start) ensure(dayKey(u.start)).usage.push(u);
  return [...days.keys()].sort().reverse().map(k => {
    const d = days.get(k);
    const dayStart = new Date(k + 'T00:00').getTime();
    const dr = { start: dayStart, end: dayStart + DAY };
    const t = summarizeTime(d.recs, d.usage, dr, rules());
    const m = summarizeMoney(d.recs, dr);
    const head = [t.recorded ? `⏱ ${fmtHours(t.recorded)}` : '', t.device.total ? `💻 ${fmtHours(t.device.total)}` : '', m.out ? `-${fmtMoney(m.out)}` : '', m.in ? `+${fmtMoney(m.in)}` : ''].filter(Boolean).join(' · ');
    const apps = t.device.apps.slice(0, 4).map(a => `${esc(a.app)} ${fmtMin(a.min)}`).join('，');
    return `<div class="card day">
      <div class="card-head"><span>${dayLabel(dayStart)}</span><span>${head}</span></div>
      <ul class="rec-list">${d.recs.sort((a, b) => b.time - a.time).map(r => recItem(r, 'review')).join('')}</ul>
      ${apps ? `<div class="device-line">💻 ${apps}</div>` : ''}
    </div>`;
  }).join('');
}

function timelineByMonth(records, usage, range) {
  const months = new Map();
  const first = new Date(Math.max(range.start, earliestOf(records, usage)));
  const cur = new Date(first.getFullYear(), first.getMonth(), 1);
  while (cur.getTime() < Math.min(range.end, Date.now() + DAY)) {
    const s = cur.getTime();
    cur.setMonth(cur.getMonth() + 1);
    months.set(s, { start: s, end: cur.getTime() });
  }
  const rows = [...months.values()].reverse().map(mr => {
    const t = summarizeTime(records, usage, mr, rules());
    const m = summarizeMoney(records, mr);
    if (!t.recorded && !t.device.total && !m.count) return '';
    const d = new Date(mr.start);
    return `<div class="month-row" data-month="${mr.start}">
      <div class="month-label">${d.getFullYear()}年${d.getMonth() + 1}月</div>
      <div class="month-main">
        <div>${t.titles.slice(0, 3).map(x => `${esc(x.title)}（${fmtHours(x.min)}）`).join('、') || '<span class="muted">没有事项记录</span>'}</div>
        <div class="muted small">${[t.recorded ? `⏱ ${fmtHours(t.recorded)}` : '', t.device.total ? `💻 ${fmtHours(t.device.total)}` : '', `支出 ${fmtMoney(m.out)}`, m.in ? `收入 ${fmtMoney(m.in)}` : ''].filter(Boolean).join(' · ')}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="card"><h3>按月</h3>${rows || '<p class="muted">没有记录</p>'}</div>`;
}

$('#review-body').addEventListener('click', e => {
  const row = e.target.closest('[data-month]');
  if (!row) return;
  const s = Number(row.dataset.month);
  const d = new Date(s);
  reviewKey = null;
  reviewRange = { start: s, end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(), label: `${d.getFullYear()}年${d.getMonth() + 1}月` };
  renderReview();
  window.scrollTo(0, 0);
});

// 回答提问
export async function answerQuestion(q) {
  reviewKey = null;
  reviewRange = q.range;
  const box = $('#review-answer');
  box.hidden = false;
  box.innerHTML = `<div class="q">问：${esc(q.text)}</div><div class="a">整理中…</div>`;
  await renderReview();
  const [records, usage, accounts, balances] = await Promise.all([db.allRecords(), db.usageBetween(q.range.start, q.range.end), db.all('accounts'), db.all('balances')]);
  const data = { events: records, usage, rules: rules(), sheet: balanceSheet(accounts, balances) };
  let answer = localAnswer(q, data);
  let by = '';
  const cfg = aiConfig();
  if (cfg) {
    box.innerHTML = `<div class="q">问：${esc(q.text)}</div><div class="a">${esc(answer)}</div><div class="muted small">AI 正在整理更完整的回答…</div>`;
    try {
      answer = await aiAnswer(cfg, q.text, dataDigest(q, data));
      by = 'Claude';
    } catch (e) {
      by = `本地统计（AI 不可用：${e.message}）`;
    }
  }
  lastAnswer = answer;
  box.innerHTML = `<div class="q">问：${esc(q.text)}</div><div class="a">${esc(answer).replace(/\n/g, '<br>')}</div>
    <div class="btn-row"><button class="btn small" data-speak>🔊 朗读</button><button class="btn small ghost" data-stop>⏹ 停止</button>${by ? `<span class="muted small">${esc(by)}</span>` : ''}</div>`;
  if (settings.speakAnswers) speak(answer);
}
$('#review-answer').addEventListener('click', e => {
  if (e.target.closest('[data-speak]')) speak(lastAnswer);
  if (e.target.closest('[data-stop]')) stopSpeaking();
});

async function askText(text) {
  let q = null;
  const cfg = aiConfig();
  if (cfg) { try { q = await aiParse(cfg, text); } catch { /* 用本地理解 */ } }
  q ??= parseUtterance(text);
  if (q.type !== 'question') q = { type: 'question', text, range: parseRange(text), focus: 'all' };
  answerQuestion(q);
}
$('#ask-form').addEventListener('submit', e => {
  e.preventDefault();
  const t = $('#ask-input').value.trim();
  if (!t) return;
  $('#ask-input').value = '';
  $('#ask-input').blur();
  askText(t);
});
let askVoice = null;
$('#ask-mic').addEventListener('click', async () => {
  if (askVoice) {
    const v = askVoice;
    askVoice = null;
    $('#ask-mic').classList.remove('recording');
    const { text } = await v.stop();
    if (text) askText(text); else toast('没听清，再问一次');
    return;
  }
  askVoice = new VoiceCapture({ keepAudio: false, onText: t => { $('#ask-input').value = t; }, onError: toast });
  try { await askVoice.start(); $('#ask-mic').classList.add('recording'); } catch (e) { askVoice = null; toast('无法使用麦克风：' + e.message); }
});

// ================= 时间管理（德鲁克） =================
const TIME_RANGES = [['week', '本周'], ['lastWeek', '上周'], ['days30', '最近30天'], ['month', '本月'], ['year', '今年']];
let timeKey = 'week';
$('#time-ranges').addEventListener('click', e => {
  const b = e.target.closest('[data-trange]');
  if (b) { timeKey = b.dataset.trange; renderTime(); }
});

export async function renderTime() {
  $('#time-ranges').innerHTML = chips(TIME_RANGES, timeKey, 'data-trange');
  const range = timeKey === 'days30' ? rangeOf('days', Date.now(), 30) : rangeOf(timeKey);
  const { records, usage } = await loadRange(range);
  const t = summarizeTime(records, usage, range, rules());
  const tags = store.get('timeTags', {});
  const days = Math.max(1, Math.round((Math.min(range.end, Date.now()) - range.start) / DAY));
  const weeks = days / 7;
  const focusIds = new Set(TIME_CATS.filter(c => c.kind === 'focus').map(c => c.id));
  const focusRecorded = Object.entries(t.byCat).filter(([id]) => focusIds.has(id)).reduce((s, [, v]) => s + v, 0);
  const catMax = Math.max(0, ...Object.values(t.byCat));
  const devMax = Math.max(0, ...Object.values(t.device.byCat));
  const diag = diagnosis(t.titles, tags, weeks);
  const f = t.focus;

  // 每天的专注时间
  const perDay = [];
  for (let s = range.start; s < Math.min(range.end, Date.now() + 1); s += DAY) {
    const blocks = f.blocks.filter(b => b.start >= s && b.start < s + DAY);
    perDay.push({ s, min: blocks.reduce((a, b) => a + (b.end - b.start) / 60000, 0) });
  }
  const dayMax = Math.max(60, ...perDay.map(d => d.min));

  $('#time-body').innerHTML = `
  <div class="card principle">
    <b>德鲁克：</b>“有效的管理者不是从任务开始，而是从时间开始。”<br>
    <span class="muted small">① 记录时间 → ② 诊断，砍掉不必做的、交出可委派的 → ③ 把腾出来的零碎时间整合成大块，用在要事上。</span>
  </div>

  <div class="card">
    <h3>① 记录：时间去哪了</h3>
    ${t.recorded ? `
      <p class="muted small">你记录了 <b>${fmtHours(t.recorded)}</b>，日均 ${fmtHours(t.recorded / days)}；其中要事和学习占 <b>${Math.round(focusRecorded / t.recorded * 100)}%</b>。</p>
      ${Object.entries(t.byCat).sort((a, b) => b[1] - a[1]).map(([id, v]) => { const c = timeCatById(id); return barRow(`${c.icon} ${c.short}`, v, catMax, fmtHours(v), `${Math.round(v / t.recorded * 100)}%`); }).join('')}`
    : '<p class="muted">还没有带时长的记录。说「开始…」「做完了」，或者「上午9点到11点写方案」。</p>'}
    ${t.device.total ? `
      <h4>电脑上（自动记录）共 ${fmtHours(t.device.total)}</h4>
      ${Object.entries(t.device.byCat).sort((a, b) => b[1] - a[1]).map(([id, v]) => { const c = timeCatById(id); return barRow(`${c.icon} ${c.short}`, v, devMax, fmtHours(v), `${Math.round(v / t.device.total * 100)}%`); }).join('')}
      <div class="app-list">${t.device.apps.slice(0, 10).map(a => `<div class="act-row"><span class="grow">${esc(a.app)} <small class="muted">${timeCatById(a.cat).short}</small></span><b>${fmtMin(a.min)}</b></div>`).join('')}</div>
      ${t.device.byCat.other ? '<p class="hint">「其他」里的软件可以在设置 → 软件归类规则里归类。</p>' : ''}`
    : '<p class="hint">在电脑上运行「电脑记录器」，可以自动记录每天在各个软件上花的时间（设置页下载）。</p>'}
  </div>

  <div class="card">
    <h3>② 诊断：哪些可以不做、交给别人</h3>
    <p class="muted small">对每一项问自己：完全不做会怎样？别人能做吗、能做得更好吗？我是不是在浪费别人的时间？</p>
    ${t.titles.length ? t.titles.slice(0, 15).map(x => `<div class="diag-row">
      <div class="grow"><div>${esc(x.title)}</div><div class="muted small">${fmtHours(x.min)} · ${x.n}次${x.money ? ' · ' + fmtMoney(x.money) : ''}</div></div>
      <div class="seg small" data-tag-title="${esc(x.title)}">
        ${[['keep', '我来做'], ['delegate', '可委派'], ['drop', '可不做']].map(([k, l]) => `<button data-tag="${k}" class="${tags[x.title] === k ? 'active' : ''}">${l}</button>`).join('')}
      </div>
    </div>`).join('') : '<p class="muted">有了记录之后，这里会列出最占时间的事。</p>'}
    ${diag.delegablePerWeek + diag.droppablePerWeek > 0 ? `<p class="callout">按这样调整，每周大约能腾出 <b>${fmtHours(diag.delegablePerWeek + diag.droppablePerWeek)}</b>（可委派 ${fmtHours(diag.delegablePerWeek)}，可不做 ${fmtHours(diag.droppablePerWeek)}）。</p>` : ''}
  </div>

  <div class="card">
    <h3>③ 整合：整块时间</h3>
    <div class="kpis">
      <div class="kpi"><div class="muted">专注总时长</div><b>${f.totalMin ? fmtHours(f.totalMin) : '—'}</b></div>
      <div class="kpi"><div class="muted">最长一块</div><b>${f.longestMin ? fmtMin(f.longestMin) : '—'}</b></div>
      <div class="kpi"><div class="muted">≥90分钟整块</div><b>${f.big} 次</b></div>
      <div class="kpi"><div class="muted">&lt;30分钟碎片</div><b>${f.fragments} 次</b></div>
    </div>
    <div class="daybars">${perDay.map(d => `<div class="daybar" title="${dayLabel(d.s)} ${fmtMin(d.min)}"><i style="height:${d.min ? Math.max(4, d.min / dayMax * 100) : 0}%"></i></div>`).join('')}</div>
    <div class="daybar-axis"><span>${dayLabel(range.start).split(' ')[0]}</span><span>每天的专注时间</span><span>${perDay.length > 1 ? dayLabel(perDay[perDay.length - 1].s).split(' ')[0] : ''}</span></div>
    <p class="callout">${f.big === 0
      ? '这段时间没有一块超过 90 分钟的专注时间。德鲁克认为，重要的工作需要整块时间，零碎的 15 分钟加起来也做不成。试着每天固定一段（比如上午 9–11 点）不开会、不看消息，只做最重要的一件事。'
      : `平均每 ${(days / f.big).toFixed(1)} 天有一次 90 分钟以上的整块专注。${f.fragments > f.big * 3 ? '碎片时间偏多，可以把小事集中到固定时段一起处理。' : '保持住，把它留给最重要的事。'}`}</p>
  </div>`;
}

$('#time-body').addEventListener('click', e => {
  const b = e.target.closest('[data-tag]');
  if (!b) return;
  const title = b.closest('[data-tag-title]').dataset.tagTitle;
  const tags = store.get('timeTags', {});
  tags[title] = tags[title] === b.dataset.tag ? undefined : b.dataset.tag;
  store.set('timeTags', tags);
  renderTime();
});

// ================= 财富管理（巴菲特） =================
export async function renderWealth() {
  const [accounts, balances, records, decisions] = await Promise.all([db.all('accounts'), db.all('balances'), db.allRecords(), db.all('decisions')]);
  const sheet = balanceSheet(accounts, balances);
  const series = netWorthSeries(accounts, balances, 12);
  const month = summarizeMoney(records, rangeOf('month'));
  const avgOut = avgMonthlyOut(records, 3) || month.out;
  const h = healthCheck({ monthIn: month.in, monthOut: month.out, avgOut, sheet });
  const sMax = Math.max(1, ...series.map(s => Math.abs(s.value)));
  const avgSave = Math.max(0, Math.round(estimateMonthlySaving(records)));
  const principal = Math.round(sheet.invest || 0);
  const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
  const check = (ok, text, tip) => `<div class="check ${ok == null ? 'na' : ok ? 'ok' : 'warn'}"><span>${ok == null ? '·' : ok ? '✅' : '⚠️'}</span><div><div>${text}</div><div class="muted small">${tip}</div></div></div>`;

  $('#wealth-body').innerHTML = `
  <div class="card networth">
    <div class="muted">净资产</div>
    <div class="big-number">${fmtMoney(sheet.net)}</div>
    <div class="muted small">资产 ${fmtMoney(sheet.assets)} · 负债 ${fmtMoney(sheet.liabilities)}</div>
    ${series.length > 1 ? `<div class="nw-bars">${series.map(s => `<div class="nw-bar" title="${s.label} ${fmtMoney(s.value)}"><i class="${s.value < 0 ? 'neg' : ''}" style="height:${Math.max(3, Math.abs(s.value) / sMax * 100)}%"></i><span>${s.label}</span></div>`).join('')}</div>` : ''}
    <p class="hint">说一句「招行卡余额5万3」「房贷还欠80万」「基金市值12万」就能更新。</p>
  </div>

  <div class="card">
    <h3>本月收支</h3>
    <div class="kpis">
      <div class="kpi"><div class="muted">收入</div><b>${fmtMoney(month.in)}</b></div>
      <div class="kpi"><div class="muted">支出</div><b>${fmtMoney(month.out)}</b></div>
      <div class="kpi"><div class="muted">结余</div><b>${fmtMoney(month.net)}</b></div>
      <div class="kpi"><div class="muted">储蓄率</div><b>${pct(h.savingsRate)}</b></div>
    </div>
  </div>

  <div class="card">
    <h3>财务体检</h3>
    ${check(h.savingsRate == null ? null : h.savingsRate >= 0.2, `储蓄率 ${pct(h.savingsRate)}`, '巴菲特：“不要储蓄花剩下的钱，而要花储蓄剩下的钱。”建议至少 20%。')}
    ${check(h.emergencyMonths == null ? null : h.emergencyMonths >= 6, `应急资金够 ${h.emergencyMonths == null ? '—' : h.emergencyMonths.toFixed(1)} 个月`, '现金和存款能覆盖 6 个月以上支出，才不会在坏时机被迫卖出资产。')}
    ${check(sheet.rows.length ? h.consumerDebt === 0 : null, `消费负债 ${fmtMoney(h.consumerDebt)}`, '信用卡、花呗等高息负债优先还清——巴菲特说过，用 18% 的利率借钱，谁也富不起来。')}
    ${check(h.debtRatio == null ? null : h.debtRatio < 0.5, `负债率 ${pct(h.debtRatio)}`, '远离过度杠杆：“只有退潮时，才知道谁在裸泳。”')}
  </div>

  <div class="card">
    <div class="card-head"><h3>账户</h3><button class="btn small" data-w="add-account">＋ 添加</button></div>
    ${sheet.rows.length ? sheet.rows.sort((a, b) => (!!a.type.liability - !!b.type.liability) || b.value - a.value).map(r => `<div class="acct-row" data-account="${r.account.id}">
      <span class="acct-icon">${r.type.icon}</span>
      <div class="grow"><div>${esc(r.account.name)}</div><div class="muted small">${r.type.name}${r.updated ? ' · ' + dayLabel(r.updated).split(' ')[0] + '更新' : ''}</div></div>
      <b class="${r.type.liability ? 'neg-text' : ''}">${r.type.liability ? '-' : ''}${fmtMoney(r.value)}</b>
    </div>`).join('') : '<p class="muted">还没有账户。说「支付宝余额2万」就会自动建一个。</p>'}
  </div>

  <div class="card">
    <h3>复利：时间是好生意的朋友</h3>
    <div class="grid3">
      <label>现有投资<input class="input" id="fv-p" type="number" inputmode="decimal" value="${principal}"></label>
      <label>每月投入<input class="input" id="fv-m" type="number" inputmode="decimal" value="${avgSave}"></label>
      <label>年化 %<input class="input" id="fv-r" type="number" inputmode="decimal" step="0.5" value="${settings.growthRate}"></label>
    </div>
    <div id="fv-out" class="fv"></div>
    <p class="hint">收益率只是假设，不代表任何承诺。巴菲特给普通人的建议：长期定投低成本的指数基金，不要频繁买卖。</p>
  </div>

  <div class="card">
    <div class="card-head"><h3>投资决策日记</h3><button class="btn small" data-w="add-decision">＋ 写一条</button></div>
    <p class="muted small">每次买卖前写下来：这是什么生意？为什么在我的能力圈内？价格比价值低多少（安全边际）？什么情况下卖？</p>
    ${decisions.sort((a, b) => b.time - a.time).map(d => {
      const margin = d.intrinsic && d.price ? (d.intrinsic - d.price) / d.intrinsic : null;
      return `<div class="decision" data-decision="${d.id}">
        <div class="card-head"><b>${esc(d.action)} · ${esc(d.asset)}</b><span class="muted small">${dayLabel(d.time).split(' ')[0]}</span></div>
        ${margin != null ? `<div class="small">价格 ${d.price} / 估值 ${d.intrinsic} · 安全边际 <b class="${margin < 0.25 ? 'neg-text' : ''}">${Math.round(margin * 100)}%</b>${margin < 0.25 ? '（不足 25%）' : ''}</div>` : ''}
        ${d.business ? `<div class="small"><span class="muted">生意：</span>${esc(d.business)}</div>` : ''}
        ${d.why ? `<div class="small"><span class="muted">能力圈：</span>${esc(d.why)}</div>` : ''}
        ${d.exit ? `<div class="small"><span class="muted">卖出条件：</span>${esc(d.exit)}</div>` : ''}
      </div>`;
    }).join('') || ''}
  </div>

  <details class="card principle">
    <summary><b>巴菲特的几条常识</b></summary>
    <ol class="small">
      <li>第一条：不要亏钱；第二条：记住第一条。</li>
      <li>只投资自己看得懂的生意（能力圈），看不懂就不碰。</li>
      <li>用 4 毛钱买 1 块钱的东西——价格远低于价值时才买（安全边际）。</li>
      <li>以合理价格买好公司，长期持有：“如果不想持有十年，就不要持有十分钟。”</li>
      <li>别人贪婪时恐惧，别人恐惧时贪婪。</li>
      <li>远离杠杆和高息负债；手里永远留足现金。</li>
      <li>对大多数人，定投低成本指数基金是最好的选择。</li>
      <li>最好的投资是投资自己。</li>
    </ol>
    <p class="hint">以上是公开的投资常识摘录，不构成任何投资建议。</p>
  </details>`;
  updateFV();
}

function estimateMonthlySaving(records) {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth() - 3, 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const m = summarizeMoney(records, { start, end });
  return m.in ? m.net / 3 : 0;
}

function updateFV() {
  const p = Number($('#fv-p')?.value) || 0, m = Number($('#fv-m')?.value) || 0, r = (Number($('#fv-r')?.value) || 0) / 100;
  const out = $('#fv-out');
  if (!out) return;
  out.innerHTML = [10, 20, 30].map(y => `<div class="kpi"><div class="muted">${y} 年后</div><b>${fmtMoney(futureValue(p, m, r, y))}</b><div class="muted small">投入 ${fmtMoney(p + m * 12 * y)}</div></div>`).join('');
}
$('#wealth-body').addEventListener('input', e => {
  if (!/^fv-/.test(e.target.id)) return;
  if (e.target.id === 'fv-r') { settings.growthRate = Number(e.target.value) || 0; saveSettings(); }
  updateFV();
});

$('#wealth-body').addEventListener('click', async e => {
  const w = e.target.closest('[data-w]')?.dataset.w;
  if (w === 'add-account') return accountDialog(null);
  if (w === 'add-decision') return decisionDialog(null);
  const acc = e.target.closest('[data-account]');
  if (acc) return accountDialog(await db.get('accounts', acc.dataset.account));
  const dec = e.target.closest('[data-decision]');
  if (dec) return decisionDialog(await db.get('decisions', dec.dataset.decision));
});

async function accountDialog(acc) {
  const balances = acc ? (await db.all('balances')).filter(b => b.accountId === acc.id).sort((a, b) => b.time - a.time) : [];
  const body = openDialog(acc ? acc.name : '添加账户', `
    <div class="field">
      <label>名称</label><input class="input" name="name" value="${esc(acc?.name || '')}" placeholder="例如：招行卡、支付宝、沪深300基金、房贷">
      <label>类型</label><select class="input" name="type">${ACCOUNT_TYPES.map(t => `<option value="${t.id}"${acc?.type === t.id ? ' selected' : ''}>${t.icon} ${t.name}</option>`).join('')}</select>
      <label>当前${acc && accountType(acc.type).liability ? '欠款' : '余额/市值'}（元）</label>
      <input class="input" name="value" type="number" inputmode="decimal" placeholder="${balances[0] ? balances[0].value : '0'}">
      <small class="muted">填了就新增一条今天的记录；空着不改。</small>
    </div>
    ${balances.length ? `<div class="field"><label>历史</label>${balances.slice(0, 12).map(b => `<div class="act-row"><span class="grow">${dayLabel(b.time)}</span><b>${fmtMoney(b.value)}</b></div>`).join('')}</div>` : ''}
    ${acc ? '<button class="btn danger full" data-archive>不再统计这个账户</button>' : ''}
  `, async el => {
    const name = el.querySelector('[name=name]').value.trim();
    if (!name) throw new Error('写个名称');
    const a = { ...(acc || { id: uid(), createdAt: Date.now() }), name, type: el.querySelector('[name=type]').value };
    await db.put('accounts', a);
    const v = el.querySelector('[name=value]').value.trim();
    if (v !== '') await db.put('balances', { id: uid(), accountId: a.id, value: Number(v), time: Date.now() });
  });
  body.querySelector('[data-archive]')?.addEventListener('click', async () => {
    if (!confirm('不再统计这个账户？（历史记录保留）')) return;
    await db.put('accounts', { ...acc, archived: true });
    $('#dialog-cancel').click();
    dataChanged();
  });
}

function decisionDialog(d) {
  const f = (name, label, ph, v = '') => `<label>${label}</label><textarea class="input" rows="2" name="${name}" placeholder="${ph}">${esc(v)}</textarea>`;
  const body = openDialog(d ? '投资决策' : '写一条投资决策', `
    <div class="field">
      <label>标的</label><input class="input" name="asset" value="${esc(d?.asset || '')}" placeholder="例如：沪深300指数基金、某某公司">
      <label>动作</label><select class="input" name="action">${['买入', '加仓', '持有观察', '减仓', '卖出'].map(a => `<option${d?.action === a ? ' selected' : ''}>${a}</option>`).join('')}</select>
      <div class="grid2">
        <label>价格<input class="input" name="price" type="number" inputmode="decimal" value="${d?.price ?? ''}"></label>
        <label>我估的内在价值<input class="input" name="intrinsic" type="number" inputmode="decimal" value="${d?.intrinsic ?? ''}"></label>
      </div>
      ${f('business', '这是一门什么生意？靠什么赚钱？', '用一两句话讲清楚', d?.business)}
      ${f('why', '为什么在我的能力圈内？', '我比别人多懂什么？', d?.why)}
      ${f('risk', '最坏会怎样？我能承受吗？', '', d?.risk)}
      ${f('exit', '什么情况下卖出？', '例如：生意变差了 / 价格远高于价值', d?.exit)}
      ${f('note', '其他', '', d?.note)}
    </div>
    ${d ? '<button class="btn danger full" data-del>删除</button>' : ''}
    <p class="hint">提示：说不清前两个问题，就先别买。</p>
  `, async el => {
    const val = n => el.querySelector(`[name=${n}]`).value.trim();
    if (!val('asset')) throw new Error('写一下标的');
    const num = n => (val(n) === '' ? null : Number(val(n)));
    await db.put('decisions', { ...(d || { id: uid(), time: Date.now() }), asset: val('asset'), action: val('action'), price: num('price'), intrinsic: num('intrinsic'), business: val('business'), why: val('why'), risk: val('risk'), exit: val('exit'), note: val('note') });
  });
  body.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!confirm('删除这条决策？')) return;
    await db.del('decisions', d.id);
    $('#dialog-cancel').click();
    dataChanged();
  });
}
