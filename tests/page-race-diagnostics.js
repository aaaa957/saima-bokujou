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
check('实时情况分别跟随领跑与关注马，路段、余程与战术来自各马实际状态', () => {
  const page = createPage();
  page.click('btnModeSingle');
  page.set('cfgLength', '2000');page.set('cfgCourse', '中山');
  page.click('btnStart');
  page.evaluate(`(()=>{
    const snap = race.state(), focus = snap.horses.find(h=>h.id===playerId);
    const leader = snap.horses.find(h=>h.id!==playerId), geo = race.race.geo;
    focus.s = geo.boundaries.find(b=>b.kind==='bendStart').s+1;
    focus.gateOpen = focus.startSettled = true;
    focus.strategy = {mode:'follow',reason:'等待前方通道'};
    focus.stamina = 0;focus.stage = '失速';focus.v = 15;
    leader.s = snap.length-50;leader.gateOpen = leader.startSettled = true;
    leader.strategy = {mode:'attack',reason:'预算允许全力推进'};
    snap.leader = leader.id;snap.leaderProgress = 0.70;
    race.state = ()=>snap;lastUiTs = 0;
    document.getElementById('debugPanel').style.display = 'block';renderRace(1000);
  })()`);
  const html = page.element('raceSituation').innerHTML;
  assert.match(html, /领跑：/);assert.match(html, /关注：/);
  assert.match(html, /终直/);assert.match(html, /弯道/);
  assert.match(html, /跟跑/);assert.match(html, /全力推进/);assert.match(html, /剩余 50m/);
  assert.ok(html.includes(page.evaluate('race.state().horses.find(h=>h.id===playerId).name')));
  assert.match(page.element('playerInfo').innerHTML, /储备用尽/);
  assert.doesNotMatch(page.element('playerInfo').innerHTML, /乏力|失速|stage-/);
  assert.match(page.element('debugTable').innerHTML, /骑乘状态/);
  assert.match(page.element('debugTable').innerHTML, /0\.0%/);
  assert.doesNotMatch(page.element('debugTable').innerHTML, /阶段|失速/);
  assert.equal(page.evaluate('document.getElementById("phaseBar")'), null);
  page.evaluate('race.state().leaderProgress=0.01;lastUiTs=0;renderRace(2000);');
  assert.equal(page.element('raceSituation').innerHTML, html, '进度标签不改变实际状态');
});
check('起步提示、收力与低储备分别显示，未完成起步时不显示统一冲刺阶段', () => {
  const page = createPage();
  assert.equal(page.evaluate('tacticLabel({gateOpen:false,startSettled:false,strategy:{mode:"attack"}})'), '等待出闸');
  assert.equal(page.evaluate('tacticLabel({gateOpen:true,startSettled:false,strategy:{mode:"attack"}})'), '起步加速');
  assert.equal(page.evaluate('tacticLabel({gateOpen:true,startSettled:true,strategy:{mode:"recover"}})'), '收力调整');
  assert.equal(page.evaluate('tacticLabel({gateOpen:true,startSettled:true,strategy:{mode:"position"}})'), '抢位');
  assert.equal(page.evaluate('reserveStatus({stamina:1,staminaMax:100}).text'), '储备偏低');
  assert.equal(page.evaluate('reserveStatus({stamina:0,staminaMax:100}).text'), '储备用尽');
  assert.equal(page.evaluate('tacticLabel({place:1,gateOpen:true,startSettled:true})'), '已冲线');
  assert.equal(page.evaluate('tacticLabel({dnf:true})'), '已中止');
  assert.equal(page.evaluate('escapeHtml("<&\\\"\\\'马名>")'), '&lt;&amp;&quot;&#39;马名&gt;');
});
check('真实引擎出闸状态驱动画面，完成实际加速后切换骑乘状态', () => {
  const page = createPage();
  page.click('btnModeSingle');page.click('btnStart');
  page.evaluate('renderRace(1000);');
  assert.match(page.element('raceSituation').innerHTML, /等待出闸/);
  page.evaluate('for(let i=0;i<60;i++)race.step(1/60);lastUiTs=0;renderRace(2000);');
  assert.match(page.element('raceSituation').innerHTML, /起步加速/);
  page.evaluate('for(let i=0;i<1200;i++)race.step(1/60);lastUiTs=0;renderRace(3000);');
  const horse = page.json('race.state().horses.find(h=>h.id===playerId)');
  assert.equal(horse.gateOpen, true);assert.equal(horse.startSettled, true);
  assert.doesNotMatch(page.element('playerInfo').innerHTML, /准备起步|等待出闸|起步加速|undefined|NaN|Infinity/);
});
check('生涯观看使用真实参赛阵容，优先关注下注马且不残留单场马资料', () => {
  const page = createPage();
  page.click('btnModeSingle');
  const card = page.json('career.aiRaces.find(r=>r.field.length>=4)');
  const oldName = page.evaluate('field.find(h=>h.id===playerId).name');
  const focus = card.field[1];
  page.evaluate(`(()=>{
    const card = career.aiRaces.find(r=>r.id===${JSON.stringify(card.id)});
    career.weekBets[card.id] = {type:'単勝',ids:[card.field[1].id],amount:1,odds:2};
    document.getElementById('playerInfo').innerHTML = '上一场马资料';
    watchAiRace(card);document.getElementById('debugPanel').style.display = 'block';renderRace(1000);
  })()`);
  assert.ok(page.element('raceSituation').innerHTML.includes('关注：' + focus.name));
  assert.ok(page.element('playerInfo').innerHTML.includes(focus.name));
  assert.ok(!page.element('playerInfo').innerHTML.includes(oldName));
  assert.doesNotMatch(page.element('playerInfo').innerHTML, /上一场马资料|undefined|NaN/);
  assert.deepEqual(page.json('cam.lastView.mini.markers.filter(m=>m.r===3.5).map(m=>m.id)'), [focus.id]);
  const debug = page.element('debugTable').innerHTML;
  for (const horse of card.field) assert.ok(debug.includes(horse.name));
  assert.doesNotMatch(page.element('leaderboard').innerHTML, /undefined/);
  page.evaluate(`delete career.weekBets[${JSON.stringify(card.id)}];lastUiTs=0;renderRace(2000);`);
  const lead = page.json('race.state().horses.find(h=>h.id===race.state().leader)');
  assert.ok(page.element('raceSituation').innerHTML.includes('关注：' + lead.name));
});
check('官方场地、风速与骑乘计划编辑传入比赛，标签不被编辑器改写', () => {
  const page=createPage();
  page.click('btnModeSingle');
  page.set('cfgCourse','中山');page.set('cfgLength','2000');page.set('cfgWind','2');
  page.evaluate('updateCourseInfo();');
  assert.equal(page.element('cfgDir').value,'右回');
  assert.equal(page.element('cfgProfile').disabled,true);
  assert.match(page.element('courseInfo').textContent,/高差 5.3m/);
  const originalStyle=page.evaluate('field[0].style');
  page.evaluate('buildEditor();document.querySelectorAll(".ed").forEach(e=>{if(e.dataset.id!==field[0].id)return;if(e.dataset.k==="racePlan")e.value="跟随";if(e.dataset.k==="carriedWeight")e.value="59";if(e.dataset.k==="bodyMass")e.value="";});applyEditor();');
  assert.deepEqual(page.json('field[0].racePlan'),{position:0.45,risk:0.4,patience:0.7});
  assert.equal(page.evaluate('field[0].style'),originalStyle);
  assert.equal(page.evaluate('field[0].carriedWeight'),59);
  assert.equal(page.evaluate('field[0].bodyMass'),undefined);
  page.click('btnStart');
  assert.equal(page.evaluate('race.race.course'),'中山芝内A');
  assert.equal(page.evaluate('race.race.dir'),'右回');
  assert.equal(page.evaluate('race.race.wind'),2);
  assert.equal(page.evaluate('race.race.horses[0].carriedWeight'),59);
});
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
check('赛后分段、全力请求位置与余力表渲染，无缺失或非有限数字', () => {
  const html = single.element('raceDiagnostics').innerHTML;
  assert.match(html, /比赛分段/);
  assert.match(html, /骑乘与终点余力/);
  assert.match(html, /逐马分段/);
  assert.match(html, /首次全力推进请求/);
  assert.match(html, /骑手首次请求最大目标配速/);
  assert.doesNotMatch(html, /首次加力|未发动/);
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
  assert.equal(page.evaluate('race.race.course'), '東京芝A');
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
