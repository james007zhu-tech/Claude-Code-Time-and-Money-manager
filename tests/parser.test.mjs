import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cnToNumber, parseAmount, guessCategory } from '../parser.js';

test('中文数字', () => {
  const cases = { 五: 5, 十: 10, 十五: 15, 三十五: 35, 两百: 200, 一百五: 150, 一百零五: 105, 一千二: 1200, 一千二百三十: 1230, 一万二: 12000, 三万: 30000, '128': 128, '28.5': 28.5 };
  for (const [s, n] of Object.entries(cases)) assert.equal(cnToNumber(s), n, s);
});

test('识别金额', () => {
  const cases = {
    '和客户吃午饭花了128块': 128,
    '打车去公司二十八块五': 28.5,
    '买水三块五毛': 3.5,
    '停车费五毛': 0.5,
    '超市买菜 ¥56.8': 56.8,
    '咖啡35元': 35,
    '加油花了 300': 300,
    '房租 1,500 元': 1500,
    '打车20块，吃饭35块': 55,
    '早饭8块午饭25块一共33块': 33,
    '请了三个人吃饭200块两个人AA': 200,
    '一百五十块': 150,
    '今天开会讨论方案': null,
    '买了3个苹果': null,
  };
  for (const [s, n] of Object.entries(cases)) assert.equal(parseAmount(s), n, s);
});

test('猜类别', () => {
  assert.equal(guessCategory('和客户吃午饭'), 'food');
  assert.equal(guessCategory('滴滴打车回家'), 'transport');
  assert.equal(guessCategory('买咖啡'), 'food');
  assert.equal(guessCategory('去超市买洗衣液'), 'shopping');
  assert.equal(guessCategory('医院挂号'), 'health');
  assert.equal(guessCategory('随便说点什么'), null);
});

import { parseUtterance, parseDuration, parseTimeInfo, parseRange } from '../parser.js';

// 2026-10-25 15:00 本地时间
const NOW = new Date(2026, 9, 25, 15, 0).getTime();
const hm = ms => { const d = new Date(ms); return `${d.getDate()}日${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

test('混合数字', () => {
  assert.equal(cnToNumber('5万3'), 53000);
  assert.equal(cnToNumber('1.5万'), 15000);
  assert.equal(cnToNumber('2千'), 2000);
});

test('时长', () => {
  const cases = { 两个小时: 120, 一个半小时: 90, 半小时: 30, 半个小时: 30, '30分钟': 30, '1.5小时': 90, 两小时二十分钟: 140, 开会: null };
  for (const [s, n] of Object.entries(cases)) assert.equal(parseDuration(s), n, s);
});

test('时间段', () => {
  let t = parseTimeInfo('下午2点到4点开会', NOW);
  assert.equal(hm(t.start), '25日14:00'); assert.equal(t.durationMin, 120);
  t = parseTimeInfo('上午9点半到11点写方案', NOW);
  assert.equal(hm(t.start), '25日9:30'); assert.equal(t.durationMin, 90);
  t = parseTimeInfo('昨天晚上8点到10点陪孩子', NOW);
  assert.equal(hm(t.start), '24日20:00'); assert.equal(t.durationMin, 120);
  t = parseTimeInfo('10点到2点开会', NOW);
  assert.equal(t.durationMin, 240);
  t = parseTimeInfo('刷了一个小时抖音', NOW);
  assert.equal(hm(t.start), '25日14:00'); assert.equal(t.durationMin, 60);
  assert.equal(parseTimeInfo('午饭35块', NOW), null);
});

test('提问范围', () => {
  assert.equal(parseRange('这几天干什么去了', NOW).label, '这几天');
  assert.equal(parseRange('这几年都干了些啥', NOW).label, '全部');
  assert.equal(parseRange('最近三个月花了多少钱', NOW).label, '最近3个月');
  assert.equal(parseRange('上周', NOW).label, '上周');
  assert.equal(parseRange('随便', NOW).label, '最近7天');
});

test('整句意图', () => {
  let r = parseUtterance('这几天我干什么去了？', NOW);
  assert.equal(r.type, 'question'); assert.equal(r.focus, 'time');
  r = parseUtterance('这个月花了多少钱', NOW);
  assert.equal(r.type, 'question'); assert.equal(r.focus, 'money');

  r = parseUtterance('开始写季度方案', NOW);
  assert.equal(r.type, 'start'); assert.equal(r.title, '写季度方案'); assert.equal(r.timeCat, 'deep');

  r = parseUtterance('开始写季度方案，预计两小时', NOW);
  assert.equal(r.title, '写季度方案'); assert.equal(r.planMin, 120);

  r = parseUtterance('我的支付宝余额2万', NOW);
  assert.equal(r.type, 'balance'); assert.equal(r.account, '支付宝'); assert.equal(r.value, 20000);
  r = parseUtterance('信用卡欠了3500', NOW);
  assert.equal(r.type, 'balance'); assert.equal(r.liability, true); assert.equal(r.value, 3500);

  r = parseUtterance('做完了，打车花了28', NOW);
  assert.equal(r.type, 'finish'); assert.equal(r.entry.amount, 28); assert.equal(r.entry.category, 'transport');

  r = parseUtterance('工资到账1万5', NOW);
  assert.equal(r.type, 'entry'); assert.equal(r.direction, 'in'); assert.equal(r.amount, 15000); assert.equal(r.category, 'salary');

  r = parseUtterance('招行卡余额5万3', NOW);
  assert.equal(r.type, 'balance'); assert.equal(r.account, '招行卡'); assert.equal(r.value, 53000); assert.equal(r.liability, false);

  r = parseUtterance('房贷还欠80万', NOW);
  assert.equal(r.type, 'balance'); assert.equal(r.liability, true); assert.equal(r.value, 800000);

  r = parseUtterance('下午2点到4点和客户开会，打车来回60块', NOW);
  assert.equal(r.type, 'entry'); assert.equal(r.amount, 60); assert.equal(r.durationMin, 120); assert.equal(r.timeCat, 'meeting');
  assert.equal(hm(r.start), '25日14:00');

  r = parseUtterance('午饭35块', NOW);
  assert.equal(r.amount, 35); assert.equal(r.durationMin, null); assert.equal(r.direction, 'out');
});
