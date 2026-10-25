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
