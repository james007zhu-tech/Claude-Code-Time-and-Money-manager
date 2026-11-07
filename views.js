// 回顾（这几天/这几年干了什么）、时间管理（德鲁克）、财富管理（巴菲特）
import * as db from './db.js';
import { parseUtterance, parseRange, rangeOf, timeCatById, catById, TIME_CATS, CURRENCIES, currencyById, getDefaultCurrency } from './parser.js';
import { VoiceCapture, speak, stopSpeaking } from './voice.js';
import { aiParse, aiAnswer } from './ai.js';
import {
  fmtMin, fmtHours, fmtMoney, fmtRecMoney, toBase, convert, baseCurrency, summarizeTime, summarizeMoney, compileRules, diagnosis, localAnswer, dataDigest,
  ACCOUNT_TYPES, accountType, balanceSheet, netWorthSeries, flowFor, healthCheck, futureValue, avgMonthlyOut,
} from './analytics.js';
import { $, esc, uid, store, settings, saveSettings, aiConfig, toast, resetPool, dayKey, dayLabel, barRow, chips, download } from './ui.js';
import { buildReimbursementHtml } from './report.js';
import { buildErpPayload, erpCsv, pushToErp, parseCodes } from './erp.js';
import { recItem, openDialog, dataChanged } from './sheet.js';
import { ACCOUNT_TEMPLATES } from './accounts.js';

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
      ${m.reimbPending || m.reimbDone ? `<div class="kpi"><div class="muted">待报销</div><b>${fmtMoney(m.reimbPending)}</b></div><div class="kpi"><div class="muted">已报销</div><b>${fmtMoney(m.reimbDone)}</b></div>` : ''}
    </div>
    ${currencyNote(m)}
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
  const data = { events: records, usage, rules: rules(), sheet: balanceSheet(accounts, balances, Date.now(), records) };
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
  const sheet = balanceSheet(accounts, balances, Date.now(), records);
  const series = netWorthSeries(accounts, balances, 12, Date.now(), records);
  const month = summarizeMoney(records, rangeOf('month'));
  const avgOut = avgMonthlyOut(records, 3) || month.out;
  const h = healthCheck({ monthIn: month.in, monthOut: month.out, avgOut, sheet });
  const sMax = Math.max(1, ...series.map(s => Math.abs(s.value)));
  const avgSave = Math.max(0, Math.round(estimateMonthlySaving(records)));
  const principal = Math.round(sheet.invest || 0);
  const allPending = records.filter(r => r.reimbursable && !r.reimbursed && r.amount != null).sort((a, b) => a.time - b.time);
  const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
  const check = (ok, text, tip) => `<div class="check ${ok == null ? 'na' : ok ? 'ok' : 'warn'}"><span>${ok == null ? '·' : ok ? '✅' : '⚠️'}</span><div><div>${text}</div><div class="muted small">${tip}</div></div></div>`;

  $('#wealth-body').innerHTML = `
  <div class="card networth">
    <div class="muted">净资产</div>
    <div class="big-number">${fmtMoney(sheet.net)}</div>
    <div class="muted small">资产 ${fmtMoney(sheet.assets)} · 负债 ${fmtMoney(sheet.liabilities)}</div>
    ${series.length > 1 ? `<div class="nw-bars">${series.map(s => `<div class="nw-bar" title="${s.label} ${fmtMoney(s.value)}"><i class="${s.value < 0 ? 'neg' : ''}" style="height:${Math.max(3, Math.abs(s.value) / sMax * 100)}%"></i><span>${s.label}</span></div>`).join('')}</div>` : ''}
    <p class="hint">个人账户合计，不含公司账户。说一句「微信余额3000」「房贷还欠80万」就能核对余额。</p>
  </div>

  ${accountsCard(sheet, accounts, month)}

  <div class="card">
    <h3>本月收支</h3>
    <div class="kpis">
      <div class="kpi"><div class="muted">收入</div><b>${fmtMoney(month.in)}</b></div>
      <div class="kpi"><div class="muted">支出</div><b>${fmtMoney(month.out)}</b></div>
      <div class="kpi"><div class="muted">结余</div><b>${fmtMoney(month.net)}</b></div>
      <div class="kpi"><div class="muted">储蓄率</div><b>${pct(h.savingsRate)}</b></div>
    </div>
    ${currencyNote(month)}
    <p class="hint">要报销的支出不算进自己的花费，报销款到账也不算收入。</p>
  </div>

  ${reimbCard(allPending)}

  <div class="card">
    <h3>财务体检</h3>
    ${check(h.savingsRate == null ? null : h.savingsRate >= 0.2, `储蓄率 ${pct(h.savingsRate)}`, '巴菲特：“不要储蓄花剩下的钱，而要花储蓄剩下的钱。”建议至少 20%。')}
    ${check(h.emergencyMonths == null ? null : h.emergencyMonths >= 6, `应急资金够 ${h.emergencyMonths == null ? '—' : h.emergencyMonths.toFixed(1)} 个月`, '现金和存款能覆盖 6 个月以上支出，才不会在坏时机被迫卖出资产。')}
    ${check(sheet.rows.length ? h.consumerDebt === 0 : null, `消费负债 ${fmtMoney(h.consumerDebt)}`, '信用卡、花呗等高息负债优先还清——巴菲特说过，用 18% 的利率借钱，谁也富不起来。')}
    ${check(h.debtRatio == null ? null : h.debtRatio < 0.5, `负债率 ${pct(h.debtRatio)}`, '远离过度杠杆：“只有退潮时，才知道谁在裸泳。”')}
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

// 账户列表：个人 / 公司分开；余额 = 最近核对的余额 + 之后的流水
function accountsCard(sheet, accounts, month) {
  const row = r => `<div class="acct-row" data-account="${r.account.id}">
    <span class="acct-icon">${r.type.icon}</span>
    <div class="grow"><div>${esc(r.account.name)}</div><div class="muted small">${[
      r.type.name,
      r.updated ? `${dayLabel(r.updated).split(' ')[0]}核对` : '未核对',
      r.flows ? `之后 ${r.flows} 笔流水` : '',
      r.currency !== baseCurrency() ? `≈${fmtMoney(r.value)}` : '',
    ].filter(Boolean).join(' · ')}</div></div>
    <b class="${r.type.liability || r.raw < 0 ? 'neg-text' : ''}">${r.type.liability ? '-' : ''}${fmtMoney(r.raw, r.currency)}</b>
  </div>`;
  const sort = (a, b) => (!!a.type.liability - !!b.type.liability) || b.value - a.value;
  const personal = sheet.rows.filter(r => !r.company).sort(sort);
  const company = sheet.rows.filter(r => r.company).sort(sort);
  const names = new Set(accounts.filter(a => !a.archived).map(a => a.name));
  const missing = ACCOUNT_TEMPLATES.filter(t => !names.has(t.name));
  return `<div class="card">
    <div class="card-head"><h3>个人账户</h3><button class="btn small" data-w="add-account">＋ 添加</button></div>
    ${personal.length ? personal.map(row).join('') : '<p class="muted">还没有账户。</p>'}
    ${missing.length ? `<button class="btn small full" data-w="add-templates">＋ 添加常用账户：${missing.map(t => esc(t.name)).join('、')}</button>` : ''}
    <p class="hint">记账时说「微信付的」「用现金」「刷公司卡」就记到对应账户；没说就用同币种最近用过的账户。点账户可以改名字、别名、币种，或核对余额。</p>
  </div>
  ${company.length ? `<div class="card">
    <h3>公司账户</h3>
    ${company.map(row).join('')}
    <p class="muted small">本月公司账户支出 ${fmtMoney(month.companyOut)}${month.companyIn ? `，收入 ${fmtMoney(month.companyIn)}` : ''}。公司账户的钱不算个人净资产，它付的钱也不算个人支出、不用报销。</p>
  </div>` : ''}`;
}

// 有多种币种时，说明是按汇率折算的，并列出原币金额
function currencyNote(m) {
  if (!m.multiCurrency && Object.keys(m.byCurrency)[0] === baseCurrency()) return '';
  const parts = Object.entries(m.byCurrency).map(([cur, c]) =>
    `${currencyById(cur).symbol} ${[c.out ? `支出 ${fmtMoney(c.out, cur)}` : '', c.in ? `收入 ${fmtMoney(c.in, cur)}` : ''].filter(Boolean).join('、')}`).filter(s => /支出|收入/.test(s));
  return parts.length ? `<p class="hint">按汇率折算成${currencyById(baseCurrency()).name}。原币：${parts.join('；')}</p>` : '';
}

function reimbCard(pending) {
  if (!pending.length) return '';
  const total = pending.reduce((s, r) => s + toBase(r.amount, r.currency), 0);
  return `<div class="card">
    <div class="card-head"><h3>待报销 ${fmtMoney(total)}</h3><button class="btn small" data-settle="all">全部已报</button></div>
    <button class="btn primary full" data-w="report">📄 生成报销单（A4，含凭证）</button>
    <p class="muted small">月底生成报销单交给公司；说「报销款到账 3000」会自动帮你核销。</p>
    ${pending.map(r => `<div class="act-row">
      <span class="grow">${esc(r.activity || r.note || catById(r.category).name)} <small class="muted">${dayLabel(r.time).split(' ')[0]}${r.photos?.length ? '' : ' · 无凭证'}</small>${r.reimbSubmittedAt ? ' <span class="badge done">已提交</span>' : ''}</span>
      <b>${fmtRecMoney(r)}</b>
      <button class="btn small ghost" data-settle="${r.id}">已报</button>
    </div>`).join('')}
  </div>`;
}

// ---------- 报销单 ----------
const REPORT_RANGES = [['pending', '所有待报销'], ['month', '本月'], ['lastMonth', '上个月']];
let lastReport = null;

export async function openReportDialog() {
  const all = (await db.allRecords()).filter(r => r.reimbursable && !r.reimbursed && r.amount != null);
  if (!all.length) { toast('没有待报销的支出'); return; }
  // 报销币种：上次选的；否则公司账户的币种；否则待报销里笔数最多的币种
  const byCur = {};
  for (const r of all) byCur[r.currency || 'CNY'] = (byCur[r.currency || 'CNY'] || 0) + 1;
  const companyAcc = (await db.all('accounts')).find(a => !a.archived && a.owner === 'company');
  const guessCur = settings.reportCurrency || companyAcc?.currency || Object.entries(byCur).sort((a, b) => b[1] - a[1])[0][0];
  openDialog('生成报销单', `
    <div class="field">
      <label>报销范围</label>
      <select class="input" name="range">${REPORT_RANGES.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <label class="switch-row"><span>包含已提交过的</span><input type="checkbox" name="submitted"></label>
      <label>排版</label>
      <select class="input" name="layout">
        <option value="category"${settings.reportLayout !== 'single' ? ' selected' : ''}>按科目分页（汇总页 + 每个科目单独几页：明细后跟凭证）</option>
        <option value="single"${settings.reportLayout === 'single' ? ' selected' : ''}>一页汇总（明细尽量一页，凭证另附）</option>
      </select>
      <label>报销币种（外币按汇率折算）</label>
      <select class="input" name="currency">${CURRENCIES.map(c => `<option value="${c.id}"${c.id === guessCur ? ' selected' : ''}>${c.symbol} ${c.name}</option>`).join('')}</select>
      <label>报销人</label><input class="input" name="person" value="${esc(settings.reportPerson || '')}" placeholder="你的名字">
      <label>单位 / 部门</label><input class="input" name="org" value="${esc(settings.reportOrg || '')}" placeholder="例如：某某（泰国）有限公司 · 市场部">
    </div>
    <p class="hint">按科目分页：第 1 页是汇总（各科目金额、在第几页、大写金额、签字栏），之后交通费、餐饮费……各自单独成页，先明细后凭证，凭证多就续页。</p>
  `, async el => {
    const val = n => el.querySelector(`[name=${n}]`);
    Object.assign(settings, { reportCurrency: val('currency').value, reportPerson: val('person').value.trim(), reportOrg: val('org').value.trim(), reportLayout: val('layout').value });
    saveSettings();
    const key = val('range').value;
    const range = key === 'pending' ? null : rangeOf(key);
    const items = all.filter(r => (!range || (r.time >= range.start && r.time < range.end)) && (val('submitted').checked || !r.reimbSubmittedAt));
    if (!items.length) throw new Error('这个范围里没有待报销的支出');
    const period = range ? periodLabel(range) : periodLabel({ start: Math.min(...items.map(r => r.time)), end: Math.max(...items.map(r => r.time)) + 1 });
    toast('正在排版…');
    await showReport(items, { currency: settings.reportCurrency, person: settings.reportPerson, org: settings.reportOrg, period, layout: settings.reportLayout, codes: parseCodes(settings.erpCodes) });
  }, { saveLabel: '生成' });
}

function periodLabel({ start, end }) {
  const a = new Date(start), b = new Date(end - 1);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getFullYear()}年${a.getMonth() + 1}月`;
  return `${dayKey(start)} 至 ${dayKey(end - 1)}`;
}

// 凭证照片缩到适合打印的大小，转成 dataURL 嵌进单据
async function photoToDataUrl(blob, max = 1200) {
  try {
    const img = await createImageBitmap(blob);
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } catch {
    return new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
  }
}

async function showReport(items, opts) {
  const withPhotos = [];
  for (const r of items) withPhotos.push({ ...r, photoUrls: await Promise.all((r.photos || []).map(p => photoToDataUrl(p))) });
  const built = buildReimbursementHtml(withPhotos, { ...opts, convert });
  lastReport = { ...built, items, opts };
  const box = $('#report');
  $('#report-frame').srcdoc = built.html;
  $('#report-title').textContent = `报销单 · ${opts.period} · ${fmtMoney(built.total, opts.currency)} · ${built.pages} 页`;
  $('#report-push').hidden = !settings.erpUrl;
  box.hidden = false;
  document.body.classList.add('no-scroll');
  history.pushState({ report: true }, '');
}

function closeReport(fromPopState = false) {
  $('#report').hidden = true;
  document.body.classList.remove('no-scroll');
  if (!fromPopState && history.state?.report) history.back();
}
// 手机返回键关闭报销单预览
window.addEventListener('popstate', () => { if (!$('#report').hidden) closeReport(true); });

$('#report').addEventListener('click', async e => {
  const act = e.target.closest('[data-report]')?.dataset.report;
  if (!act || !lastReport) return;
  const { html, rows, opts, items } = lastReport;
  const name = `报销单-${opts.period}`;
  if (act === 'print') $('#report-frame').contentWindow.print();
  if (act === 'download') download(`${name}.html`, new Blob([html], { type: 'text/html' }));
  if (act === 'csv') {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['序号', '日期', '科目', '事项/用途', '说明', '付款方式', '原币', '原币金额', '报销币种', '报销金额', '凭证张数']];
    for (const r of rows) lines.push([r.no, dayKey(r.time), r.item, r.activity, r.note, r.accountName, currencyById(r.currency).name, r.amount, currencyById(opts.currency).name, Math.round(r.converted * 100) / 100, r.photoUrls.length]);
    download(`${name}-明细.csv`, new Blob(['﻿' + lines.map(l => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
  }
  if (act === 'erp-json' || act === 'erp-push') {
    const payload = buildErpPayload(lastReport, { ...opts, employeeCode: settings.employeeCode, costCenter: settings.costCenter, includeReceipts: settings.erpIncludeReceipts });
    if (act === 'erp-json') {
      download(`${name}-ERP.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      download(`${name}-ERP分录.csv`, new Blob([erpCsv(payload)], { type: 'text/csv' }));
      return;
    }
    toast('正在推送到 ERP…');
    try {
      await pushToErp(settings.erpUrl, settings.erpHeaders, payload);
      for (const r of items) await db.putRecord({ ...(await db.getRecord(r.id)), reimbSubmittedAt: Date.now(), erpClaimId: payload.claimId, updatedAt: Date.now() });
      toast(`已推送到 ERP（单号 ${payload.claimId}），这些支出已标为「已提交」`);
      dataChanged();
    } catch (e) {
      toast('推送失败：' + e.message);
    }
    return;
  }
  if (act === 'submitted') {
    for (const r of items) await db.putRecord({ ...(await db.getRecord(r.id)), reimbSubmittedAt: Date.now(), updatedAt: Date.now() });
    toast(`已把 ${items.length} 笔标成「已提交」；报销款到账后说一句就能核销`);
    dataChanged();
  }
  if (act === 'close') closeReport();
});

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
  if (w === 'report') return openReportDialog();
  if (w === 'add-templates') {
    const names = new Set((await db.all('accounts')).filter(a => !a.archived).map(a => a.name));
    const add = ACCOUNT_TEMPLATES.filter(t => !names.has(t.name));
    for (const t of add) {
      const { key, ...rest } = t;
      await db.put('accounts', { ...rest, id: uid(), createdAt: Date.now() });
    }
    toast(`已添加 ${add.length} 个账户。点账户可以核对余额、改名字和别名`);
    dataChanged();
    return;
  }
  if (w === 'add-decision') return decisionDialog(null);
  const acc = e.target.closest('[data-account]');
  if (acc) return accountDialog(await db.get('accounts', acc.dataset.account));
  const settle = e.target.closest('[data-settle]');
  if (settle) {
    const ids = settle.dataset.settle === 'all'
      ? (await db.allRecords()).filter(r => r.reimbursable && !r.reimbursed).map(r => r.id)
      : [settle.dataset.settle];
    if (settle.dataset.settle === 'all' && !confirm(`把 ${ids.length} 笔都标成已报销？`)) return;
    for (const id of ids) {
      const r = await db.getRecord(id);
      if (r) await db.putRecord({ ...r, reimbursed: true, updatedAt: Date.now() });
    }
    toast(`已标记 ${ids.length} 笔为已报销`);
    dataChanged();
  }
  const dec = e.target.closest('[data-decision]');
  if (dec) return decisionDialog(await db.get('decisions', dec.dataset.decision));
});

async function accountDialog(acc) {
  const [balances, records, accounts] = await Promise.all([db.all('balances'), db.allRecords(), db.all('accounts')]);
  const mine = acc ? balances.filter(b => b.accountId === acc.id).sort((a, b) => b.time - a.time) : [];
  const row = acc ? balanceSheet([acc], balances, Date.now(), records).rows[0] : null;
  const flows = acc ? records.filter(r => r.accountId === acc.id || r.toAccountId === acc.id).slice(0, 15) : [];
  const cur = acc?.currency || getDefaultCurrency();
  const body = openDialog(acc ? acc.name : '添加账户', `
    <div class="field">
      ${row ? `<div class="acct-balance"><span class="muted">现在余额</span><b>${fmtMoney(row.raw, cur)}</b></div>` : ''}
      <label>名称</label><input class="input" name="name" value="${esc(acc?.name || '')}" placeholder="例如：微信、开泰银行卡、公司泰铢账户、房贷">
      <label>别名（说话时可能怎么叫它，用逗号分开）</label>
      <input class="input" name="aliases" value="${esc((acc?.aliases || []).join('，'))}" placeholder="例如：开泰，K PLUS，泰国卡">
      <div class="grid2">
        <label>类型<select class="input" name="type">${ACCOUNT_TYPES.map(t => `<option value="${t.id}"${(acc?.type || 'bank') === t.id ? ' selected' : ''}>${t.icon} ${t.name}</option>`).join('')}</select></label>
        <label>币种<select class="input" name="currency">${CURRENCIES.map(c => `<option value="${c.id}"${cur === c.id ? ' selected' : ''}>${c.symbol} ${c.name}</option>`).join('')}</select></label>
      </div>
      <label>归属</label>
      <select class="input" name="owner">
        <option value="personal"${acc?.owner !== 'company' ? ' selected' : ''}>个人（算进我的净资产和支出）</option>
        <option value="company"${acc?.owner === 'company' ? ' selected' : ''}>公司（单独统计，不算个人）</option>
      </select>
      <label>核对余额${acc && accountType(acc.type).liability ? '（欠款）' : ''}</label>
      <input class="input" name="value" type="number" inputmode="decimal" placeholder="${row ? row.raw : '0'}">
      <small class="muted">对照银行 App / 钱包里的实际余额填，之后的收支会在这个数上自动加减；空着不改。</small>
    </div>
    ${flows.length ? `<div class="field"><label>最近流水</label>${flows.map(r => {
      const f = flowFor(r, acc);
      return `<div class="act-row"><span class="grow">${esc(r.activity || r.note || catById(r.category).name)} <small class="muted">${dayLabel(r.time).split(' ')[0]}</small></span><b class="${f < 0 ? '' : 'pos-text'}">${f > 0 ? '+' : ''}${fmtMoney(f, cur)}</b></div>`;
    }).join('')}</div>` : ''}
    ${mine.length ? `<div class="field"><label>核对记录</label>${mine.slice(0, 8).map(b => `<div class="act-row"><span class="grow">${dayLabel(b.time)}</span><b>${fmtMoney(b.value, cur)}</b></div>`).join('')}</div>` : ''}
    ${acc ? '<button class="btn danger full" data-archive>不再统计这个账户</button>' : ''}
  `, async el => {
    const val = n => el.querySelector(`[name=${n}]`).value.trim();
    const name = val('name');
    if (!name) throw new Error('写个名称');
    if (accounts.some(a => !a.archived && a.name === name && a.id !== acc?.id)) throw new Error('已经有同名账户了');
    const a = {
      ...(acc || { id: uid(), createdAt: Date.now() }), name, type: val('type'), currency: val('currency'), owner: val('owner'),
      aliases: val('aliases').split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean),
    };
    await db.put('accounts', a);
    // 改名或改归属后，同步更新这个账户上的记录
    if (acc && (acc.name !== a.name || (acc.owner === 'company') !== (a.owner === 'company'))) {
      for (const r of records) {
        if (r.accountId !== a.id && r.toAccountId !== a.id) continue;
        const next = { ...r };
        if (r.accountId === a.id) { next.accountName = a.name; if (r.direction !== 'transfer') next.company = a.owner === 'company'; }
        if (r.toAccountId === a.id) next.toAccountName = a.name;
        if (next.company) next.reimbursable = next.reimbursed = false;
        await db.putRecord(next);
      }
    }
    if (val('value') !== '') await db.put('balances', { id: uid(), accountId: a.id, value: Number(val('value')), time: Date.now() });
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
