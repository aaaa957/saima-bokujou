#!/usr/bin/env node
'use strict';

// Exercise the actual page and race engine, including saved scheduled races.
const assert = require('node:assert/strict');
const { createPage } = require('./helpers/page-runtime');

let passed = 0;
function check(name, callback) {
  callback();
  passed++;
  console.log('✅ ' + name);
}
function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-8, message + ': ' + actual + ' vs ' + expected);
}
function result(page) {
  return page.json('({course:race.race.course,order:race.race.order.map(h=>({id:h.id,time:h.time,' +
    'sectionals:h.sectionals,sprintAt:h.sprintAt,stats:h.statsSummary})),sectionals:race.race.sectionals})');
}

const single = createPage();
single.click('btnModeSingle');
single.set('cfgLength', '2000');
single.set('cfgCourse', '长直道');
single.set('cfgProfile', '急坂');
single.click('btnStart');
check('单场赛道选择传入比赛，画面使用同一赛道和真实终直位置', () => {
  assert.equal(single.evaluate('race.race.course'), '长直道');
  single.evaluate('for(let i=0;i<180;i++)race.step(1/30);renderRace(1000);');
  assert.equal(single.evaluate('sectionNameAt(race.race.length-1,race.race.geo)'), '终直');
  assert.ok(single.evaluate('race.race.geo.boundaries.length>0'));
  assert.ok(single.evaluate('Number.isFinite(cam.lastView.scale)&&Number.isFinite(cam.lastView.cy)'));
  const earlierStraight = single.evaluate('race.race.geo.boundaries.find(b=>b.kind==="bendEnd").s+1');
  assert.notEqual(single.evaluate('sectionNameAt(' + earlierStraight + ',race.race.geo)'), '终直');
});
single.click('btnSkip');
const completed = result(single);
check('赛后分段、发动时机与余力表渲染，无缺失或非有限数字', () => {
  const html = single.element('raceDiagnostics').innerHTML;
  assert.match(html, /比赛分段/);
  assert.match(html, /骑乘与终点余力/);
  assert.match(html, /逐马分段/);
  assert.doesNotMatch(html, /undefined|NaN|Infinity/);
  assert.equal((html.match(/<tbody>/g) || []).length, completed.order.length + 2);
  for (const horse of completed.order) {
    assert.ok(horse.sectionals.length === 10);
    for (const split of horse.sectionals) {
      assert.match(html, new RegExp(split.time.toFixed(2).replace('.', '\\.') + '秒'));
      assert.ok(Number.isFinite(split.stamina) && Number.isFinite(split.guts));
    }
    assert.ok(Number.isFinite(horse.stats.peakSpeed));
    assert.ok(Number.isFinite(horse.stats.draftSeconds));
    assert.ok(Number.isFinite(horse.stats.blockedSeconds));
    if (Number.isFinite(horse.sprintAt)) {
      assert.ok(html.includes('残' + Math.round(2000 - horse.sprintAt) + 'm'));
    }
  }
});
check('实际分段用时累计到各马完赛时间，领头分段累计到冠军时间', () => {
  assert.equal(completed.sectionals.length, 10);
  close(completed.sectionals.reduce((sum, section) => sum + section.split, 0),
    completed.order[0].time, 'leader sectionals');
  for (const horse of completed.order) {
    close(horse.sectionals.reduce((sum, section) => sum + section.split, 0), horse.time, horse.id);
  }
});

let career = createPage();
const card = career.json('career.aiRaces.find(r=>r.field.length>=4)');
assert.ok(card, 'fixture must have a scheduled field');
const selectCard = 'career.aiRaces.find(r=>r.id===' + JSON.stringify(card.id) + ')';
career.evaluate(selectCard + '.course="小回り";saveCareer();');
career = career.refresh({ emitPagehide: false });
check('存档刷新保留赛程布局，后台模拟与观看比赛使用同一布局和结果', () => {
  assert.equal(career.evaluate(selectCard + '.course'), '小回り');
  const expected = career.json('(()=>{const r=simulateRace(' + selectCard + ').race;return {' +
    'course:r.course,order:r.order.map(h=>({id:h.id,time:h.time,sectionals:h.sectionals,' +
    'sprintAt:h.sprintAt,stats:h.statsSummary})),sectionals:r.sectionals};})()');
  career.evaluate('watchAiRace(' + selectCard + ');');
  career.click('btnSkip');
  assert.deepEqual(result(career), expected);
  assert.doesNotMatch(career.element('raceDiagnostics').innerHTML, /undefined|NaN|Infinity/);
  assert.match(career.element('resultBanner').innerHTML, /小回り/);
});

check('旧赛程没有布局字段时按马场映射，观看与后台模拟一致', () => {
  const page = createPage();
  const scheduled = page.json('career.aiRaces.find(r=>r.field.length>=4)');
  const select = 'career.aiRaces.find(r=>r.id===' + JSON.stringify(scheduled.id) + ')';
  page.evaluate('delete ' + select + '.course;' + select + '.venue="東京";');
  const expected = page.json('simulateRace(' + select + ').race.order.map(h=>({id:h.id,time:h.time}))');
  page.evaluate('watchAiRace(' + select + ');');
  assert.equal(page.evaluate('race.race.course'), '长直道');
  page.click('btnSkip');
  assert.deepEqual(page.json('race.race.order.map(h=>({id:h.id,time:h.time}))'), expected);
});

check('非200米整倍数距离显示实际末段，分段累计到冠军时间', () => {
  const page = createPage();
  page.click('btnModeSingle');
  page.evaluate('mode="single";race=S.createRace(field,{length:2500,course:"标准",rng:S.mulberry32(957)});');
  page.click('btnSkip');
  const race = result(page), last = race.sectionals.at(-1);
  assert.equal(last.distance, 2500);
  assert.match(page.element('raceDiagnostics').innerHTML, /2500m/);
  close(race.sectionals.reduce((sum, section) => sum + section.split, 0), race.order[0].time,
    'partial leader sectionals');
});

check('多场模拟配对复跑结果一致，界面明确当前引擎而非旧版改进', () => {
  const page = createPage();
  page.click('btnModeMulti');
  page.set('mcTrials', '2');
  page.click('btnRunMC');
  for (let rounds = 0; page.evaluate('mc.running') && rounds < 100; rounds++) page.tick(100);
  assert.equal(page.evaluate('mc.running'), false);
  assert.deepEqual(page.json('mc.doc'), page.json('mc.balanced'));
  assert.deepEqual(page.json('mc.gapDoc'), page.json('mc.gapBal'));
  const html = page.element('mcStyleOut').innerHTML + page.element('mcGapOut').innerHTML;
  assert.match(html, /配对复跑/);
  assert.match(html, /配对统计一致/);
  assert.doesNotMatch(html, /文档原版|平衡修正|理想值|收敛/);
});

console.log('\n✅ 全部通过（' + passed + ' 组）');
