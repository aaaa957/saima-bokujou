#!/usr/bin/env node
'use strict';

// Run real page actions against an isolated DOM/storage, including a fresh
// JavaScript realm for every refresh. No simulation constants are modified.
const assert = require('node:assert/strict');
const { createPage } = require('./helpers/page-runtime');

let passed = 0, failed = 0;
function test(name, callback) {
  try { callback(); passed++; console.log('✅ ' + name); }
  catch (error) {
    failed++;
    const frames = String(error.stack).split('\n').filter((line) => /^\s+at /.test(line)).slice(0, 4).join('\n');
    console.error('❌ ' + name + '\n   ' + error.message.slice(0, 1200) + '\n' + frames);
  }
}
const codeId = (id) => JSON.stringify(id);
const selector = (className, raceId) => '.' + className + '[data-race="' + raceId + '"]';
const cardAt = (page, index = 0) => page.json('career.aiRaces[' + index + ']');
const pending = (page, id) => page.json('career.weekBets[' + codeId(id) + '] || null');
const funds = (page) => page.evaluate('bankroll');
const state = (page) => page.json('({career,careerStaff,bankroll,breedState})');
const durableState = (page) => page.json('({roster:career.roster,stock:career.breedingStock,stats:career.stats,' +
  'bankroll,weekBets:career.weekBets,watchedIds:career.watchedIds,settledIds:career.settledIds})');
const predict = (page, index = 0) => page.json('simulateRace(career.aiRaces[' + index + ']).race.order.map(h=>h.id)');
function place(page, card, type, ids, amount = 5) {
  page.set(selector('rr-bt', card.id), type, true);
  ids.forEach((id, index) => page.set(selector('rr-h' + (index + 1), card.id), id));
  page.set('betAmountSel', amount);
  page.click(selector('rr-bet', card.id));
}
function winningTicket(page, index = 0, type = '単勝', amount = 5) {
  const card = cardAt(page, index), order = predict(page, index);
  assert.ok(order.length >= 3, 'fixture race must finish with at least three horses');
  const need = page.evaluate('S.BET_NEED[' + codeId(type) + ']');
  place(page, card, type, order.slice(0, need), amount);
  const ticket = pending(page, card.id);
  assert.ok(ticket, 'valid ticket must be accepted');
  return { card, order, ticket };
}
function closeMoney(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-8, message + ': expected ' + expected + ', got ' + actual);
}

test('完整存档刷新恢复：日期、马群、种马库、赔率、情报、员工、注单和待入厩幼驹', () => {
  let page = createPage();
  page.evaluate('bankroll=10000; career.date={year:1970,week:35}; career.weekNum=120; genWeek();');
  page.click('btnModeBreed');
  for (let attempt = 0; attempt < 8 && !page.evaluate('breedState.foal && !breedState.foal.earlyDeath'); attempt++) {
    page.click('btnBreed');
  }
  assert.ok(page.evaluate('breedState.foal && !breedState.foal.earlyDeath'), 'deterministic breeding fixture must survive');
  page.click('btnModeCareer');
  const card = cardAt(page);
  place(page, card, '単勝', [card.field[0].id]);
  assert.ok(pending(page, card.id));
  page.click('btnSaveCareer');
  const expected = state(page);
  const parentRefs = page.evaluate('career.roster.filter(h=>career.breedingStock.includes(h.sireRec)).length');
  assert.ok(parentRefs > 0, 'fixture must contain shared pedigree references');
  page = page.refresh({ emitPagehide: false });
  assert.deepEqual(state(page), expected, 'boot must restore the full state without rerolling');
  assert.equal(page.evaluate('career.roster.filter(h=>career.breedingStock.includes(h.sireRec)).length'), parentRefs,
    'restored pedigree must still reference the existing breeding stock');
  assert.match(page.element('careerDate').textContent, /1970/);
  assert.ok(pending(page, card.id), 'stake remains pending after reload');
});

test('不合法组合票和未知马匹不扣钱、不覆盖已有合法注单，并给出提示', () => {
  const page = createPage(), card = cardAt(page);
  place(page, card, '単勝', [card.field[0].id]);
  const oldTicket = pending(page, card.id), oldFunds = funds(page);
  for (const type of ['馬連', '馬単', '三連複', '三連単']) {
    const need = page.evaluate('S.BET_NEED[' + codeId(type) + ']');
    place(page, card, type, Array(need).fill(card.field[0].id));
    assert.equal(funds(page), oldFunds, type + ' duplicate selection must not deduct');
    assert.deepEqual(pending(page, card.id), oldTicket, 'existing ticket must remain unchanged');
    assert.ok(page.element('betError').textContent.trim(), 'rejected selection must explain why');
  }
  place(page, card, '三連単', [card.field[0].id, card.field[1].id, card.field[1].id]);
  assert.equal(funds(page), oldFunds, 'duplicate third place must not deduct');
  assert.deepEqual(pending(page, card.id), oldTicket);
  place(page, card, '単勝', ['missing-horse']);
  assert.equal(funds(page), oldFunds, 'foreign horse ID must not deduct');
  assert.deepEqual(pending(page, card.id), oldTicket);
});

test('六种合法马券均可下注；下周自动结算命中、到账与统计；刷新不会重复派奖', () => {
  let page = createPage();
  page.evaluate('bankroll=500; saveCareer();');
  const initial = funds(page), stats = page.json('career.stats');
  const types = ['単勝', '複勝', '馬連', '馬単', '三連複', '三連単'];
  let stakes = 0, payouts = 0;
  types.forEach((type, index) => {
    const { ticket } = winningTicket(page, index, type, 2);
    assert.equal(ticket.type, type);
    assert.equal(ticket.amount, 2);
    assert.ok(ticket.odds > 0 && Number.isFinite(ticket.odds));
    stakes += ticket.amount; payouts += ticket.amount * ticket.odds;
    closeMoney(funds(page), initial - stakes, 'only accepted stake is deducted');
  });
  page.click('btnNextWeek');
  closeMoney(funds(page), initial - stakes + payouts - 1, 'payouts less one weekly living cost');
  assert.deepEqual(page.json('career.weekBets'), {});
  assert.equal(page.evaluate('career.stats.bets'), stats.bets + 6);
  assert.equal(page.evaluate('career.stats.hits'), stats.hits + 6);
  closeMoney(page.evaluate('career.stats.profit'), stats.profit + payouts - stakes, 'settlement profit');
  const expected = state(page);
  page = page.refresh({ emitPagehide: false });
  assert.deepEqual(state(page), expected);
  page = page.refresh();
  assert.deepEqual(state(page), expected, 'a second refresh must not replay payout');
});

test('合法改票只扣新金额；取消注单退回资金并在刷新后保持取消', () => {
  let page = createPage();
  const card = cardAt(page), initial = funds(page);
  place(page, card, '単勝', [card.field[0].id], 5);
  place(page, card, '馬連', [card.field[0].id, card.field[1].id], 3);
  assert.equal(funds(page), initial - 3, 'previous stake is refunded before the replacement');
  assert.equal(pending(page, card.id).amount, 3);
  assert.equal(pending(page, card.id).type, '馬連');
  page = page.refresh({ emitPagehide: false });
  assert.equal(funds(page), initial - 3);
  assert.equal(pending(page, card.id).amount, 3);
  page.click('btnBetCancelAll');
  assert.equal(funds(page), initial);
  assert.deepEqual(page.json('career.weekBets'), {});
  page = page.refresh({ emitPagehide: false });
  assert.equal(funds(page), initial);
  assert.deepEqual(page.json('career.weekBets'), {});
});

test('落空票只计一次损失；重复赛后渲染和刷新不重复扣款或增加下注统计', () => {
  let page = createPage();
  const card = cardAt(page), initial = funds(page), stats = page.json('career.stats');
  const order = predict(page);
  assert.ok(order.length >= 3);
  place(page, card, '単勝', [order.at(-1)], 5);
  page.click(selector('rr-watch', card.id));
  page.click('btnSkip');
  assert.equal(funds(page), initial - 5);
  assert.equal(page.evaluate('career.stats.bets'), stats.bets + 1);
  assert.equal(page.evaluate('career.stats.hits'), stats.hits);
  assert.equal(page.evaluate('career.stats.profit'), stats.profit - 5);
  const expected = durableState(page);
  page.evaluate('showResult(); renderResult();');
  assert.deepEqual(durableState(page), expected);
  page = page.refresh({ emitPagehide: false });
  assert.deepEqual(durableState(page), expected);
});

test('观看与后台模拟同种子同结果；赛后重绘和刷新不重复更新战绩或结算', () => {
  let page = createPage();
  const initial = funds(page), stats = page.json('career.stats');
  const { card, order, ticket } = winningTicket(page);
  const startsBefore = page.json('Object.fromEntries(career.roster.map(h=>[h.id,h.starts]))');
  page.click(selector('rr-watch', card.id));
  assert.equal(page.evaluate('!!career.watchedIds[' + codeId(card.id) + ']'), false, 'watching is not completion');
  assert.equal(page.evaluate('!!career.settledIds[' + codeId(card.id) + ']'), false);
  page.click('btnSkip');
  assert.deepEqual(page.json('race.race.order.map(h=>h.id)'), order, 'watch and background use the same RNG seed');
  assert.equal(page.evaluate('!!career.watchedIds[' + codeId(card.id) + ']'), true);
  assert.equal(page.evaluate('!!career.settledIds[' + codeId(card.id) + ']'), true);
  closeMoney(funds(page), initial - ticket.amount + ticket.amount * ticket.odds, 'winning watched ticket pays once');
  assert.equal(page.evaluate('career.stats.bets'), stats.bets + 1);
  assert.equal(page.evaluate('career.stats.hits'), stats.hits + 1);
  for (const id of order) {
    assert.equal(page.evaluate('career.roster.find(h=>h.id===' + codeId(id) + ').starts'), startsBefore[id] + 1);
  }
  const expected = durableState(page);
  page.evaluate('renderResult(); showResult();');
  assert.deepEqual(durableState(page), expected, 'rendering result is idempotent');
  page = page.refresh({ emitPagehide: false });
  assert.deepEqual(durableState(page), expected, 'finished race is persisted immediately');
  assert.equal(page.evaluate('career.watchInfo'), null);
  const beforeWeek = funds(page);
  page.click('btnNextWeek');
  assert.equal(page.evaluate('career.stats.bets'), stats.bets + 1, 'advancing cannot settle the completed ticket again');
  closeMoney(funds(page), beforeWeek - 1, 'completed race pays nothing again next week');
});

test('观赛中切模式保留注单，停止旧动画，不提前标完成；下一周仍按原种子结算', () => {
  const page = createPage();
  const initial = funds(page), stats = page.json('career.stats');
  const { card, ticket } = winningTicket(page);
  page.click(selector('rr-watch', card.id));
  page.tick(100); page.tick(100);
  assert.equal(page.evaluate('race.race.finished'), false);
  page.click('btnModeBreed');
  assert.equal(page.evaluate('career.watchInfo'), null);
  assert.equal(page.evaluate('!!career.watchedIds[' + codeId(card.id) + ']'), false);
  assert.deepEqual(pending(page, card.id), ticket);
  const raceTime = page.evaluate('race.race.t');
  page.tick(500);
  assert.equal(page.evaluate('race.race.t'), raceTime, 'old RAF must stop after leaving observation');
  assert.equal(page.evaluate('state'), 'breeding');
  page.click('btnModeCareer');
  page.click('btnNextWeek');
  assert.equal(page.evaluate('career.stats.bets'), stats.bets + 1);
  assert.equal(page.evaluate('career.stats.hits'), stats.hits + 1);
  closeMoney(funds(page), initial - ticket.amount + ticket.amount * ticket.odds - 1, 'interrupted watch settles automatically');
});

test('观赛中刷新回周界面、保留原赛程及注单；重看可正常结算且不丢失投注', () => {
  let page = createPage();
  const initial = funds(page), stats = page.json('career.stats');
  const { card, order, ticket } = winningTicket(page);
  page.click(selector('rr-watch', card.id));
  page.tick(100); page.tick(100);
  page = page.refresh();
  assert.equal(page.evaluate('career.watchInfo'), null);
  assert.equal(page.evaluate('state'), 'career');
  assert.equal(page.evaluate('!!career.watchedIds[' + codeId(card.id) + ']'), false);
  assert.deepEqual(cardAt(page), card, 'refresh must retain the field, odds, and RNG seed');
  assert.deepEqual(pending(page, card.id), ticket);
  page.click(selector('rr-watch', card.id));
  page.click('btnSkip');
  assert.deepEqual(page.json('race.race.order.map(h=>h.id)'), order);
  assert.equal(page.evaluate('career.stats.bets'), stats.bets + 1);
  assert.equal(page.evaluate('career.stats.hits'), stats.hits + 1);
  closeMoney(funds(page), initial - ticket.amount + ticket.amount * ticket.odds, 'refreshed observation pays once');
});

test('已开跑赛事封盘：切模式与刷新不能改票或撤销，其他未开跑票可取消，原票仍能自动结算', () => {
  let page = createPage();
  const initial = funds(page), stats = page.json('career.stats');
  const { card, ticket } = winningTicket(page);
  const other = cardAt(page, 1);
  place(page, other, '単勝', [other.field[0].id], 2);
  page.click(selector('rr-watch', card.id));
  page.tick(100); page.tick(100);
  assert.equal(page.evaluate('career.startedIds[' + codeId(card.id) + ']'), true);
  page.click('btnModeBreed'); page.click('btnModeCareer');
  assert.match(page.element('programList').innerHTML, /已开赛，停止下注/);
  assert.equal(page.evaluate('document.querySelector(' + codeId(selector('rr-bet', card.id)) + ')'), null);
  assert.equal(page.evaluate('betOnRace(' + codeId(card.id) + ')'), false, 'direct handler also rejects betting after start');
  assert.deepEqual(pending(page, card.id), ticket);
  assert.equal(funds(page), initial - ticket.amount - 2);
  page.click('btnBetCancelAll');
  assert.deepEqual(pending(page, card.id), ticket, 'cancel all cannot retract a started ticket');
  assert.equal(pending(page, other.id), null, 'cancel all still refunds an unstarted ticket');
  assert.equal(funds(page), initial - ticket.amount);
  page = page.refresh({ emitPagehide: false });
  assert.equal(page.evaluate('career.startedIds[' + codeId(card.id) + ']'), true, 'sealed status persists across reload');
  assert.deepEqual(pending(page, card.id), ticket);
  assert.equal(page.evaluate('betOnRace(' + codeId(card.id) + ')'), false);
  page.click('btnBetCancelAll');
  assert.deepEqual(pending(page, card.id), ticket);
  assert.equal(funds(page), initial - ticket.amount);
  page.click('btnNextWeek');
  assert.equal(page.evaluate('career.stats.bets'), stats.bets + 1);
  assert.equal(page.evaluate('career.stats.hits'), stats.hits + 1);
  closeMoney(funds(page), initial - ticket.amount + ticket.amount * ticket.odds - 1, 'sealed interrupted ticket still settles');
});

test('幼驹刷新后可入厩，只入厩一次；再次刷新保留马匹和血统，刷新不重复扣种费', () => {
  let page = createPage();
  page.evaluate('bankroll=10000; saveCareer();');
  page.click('btnModeBreed');
  for (let attempt = 0; attempt < 8 && !page.evaluate('breedState.foal && !breedState.foal.earlyDeath'); attempt++) {
    page.click('btnBreed');
  }
  assert.ok(page.evaluate('breedState.foal && !breedState.foal.earlyDeath'));
  const originalParents = page.json('({sire:career.breedingStock.find(h=>h.id===breedState.foalSireId).name,' +
    'dam:career.breedingStock.find(h=>h.id===breedState.foalDamId).name})');
  const otherSire = page.evaluate('career.breedingStock.find(h=>h.sex==="牡" && h.id!==breedState.foalSireId).id');
  const otherDam = page.evaluate('career.breedingStock.find(h=>h.sex==="牝" && h.id!==breedState.foalDamId).id');
  page.set('sireSel', otherSire, true); page.set('damSel', otherDam, true);
  const foal = page.json('breedState'), chargedFunds = funds(page), beforeCount = page.evaluate('career.roster.length');
  page = page.refresh({ emitPagehide: false });
  assert.deepEqual(page.json('breedState'), foal);
  assert.equal(funds(page), chargedFunds, 'restoring must not repeat stud fee');
  page.click('btnModeBreed');
  assert.equal(page.element('btnFoalEnter').disabled, false, 'restored living foal can still enter');
  page.click('btnFoalEnter');
  assert.equal(page.evaluate('career.roster.length'), beforeCount + 1);
  const horse = page.json('career.roster.at(-1)');
  assert.equal(horse.name, foal.foalName);
  assert.equal(horse.age, 2);
  assert.equal(horse.sireName, originalParents.sire, 'changing selectors must not change the existing foal\'s sire');
  assert.equal(horse.damName, originalParents.dam, 'changing selectors must not change the existing foal\'s dam');
  assert.equal(page.evaluate('breedState.foal'), null);
  page.click('btnFoalEnter');
  assert.equal(page.evaluate('career.roster.length'), beforeCount + 1, 'second click does not duplicate foal');
  page = page.refresh({ emitPagehide: false });
  assert.deepEqual(page.json('career.roster.at(-1)'), horse);
  assert.equal(page.evaluate('breedState.foal'), null);
  assert.equal(funds(page), chargedFunds);
});

test('周推进与跨年后的日期、老化退役、新马和赛程可以完整恢复', () => {
  let page = createPage();
  page.evaluate('bankroll=500; career.date={year:1968,week:52}; career.weekNum=31; genWeek(); saveCareer();');
  const oldHorseIds = page.json('career.roster.map(h=>h.id)');
  const retiringIds = page.json('career.roster.filter(h=>h.age===5 && !h.retired).map(h=>h.id)');
  page.click('btnNextWeek');
  assert.deepEqual(page.json('career.date'), { year: 1969, week: 1 });
  assert.equal(page.evaluate('career.weekNum'), 32);
  assert.equal(funds(page), 499);
  assert.ok(page.evaluate('career.roster.some(h=>h.age===2 && !' + JSON.stringify(oldHorseIds) + '.includes(h.id))'),
    'new two-year-olds must join at rollover');
  for (const id of retiringIds) {
    assert.equal(page.evaluate('career.roster.find(h=>h.id===' + codeId(id) + ').retired'), true,
      'six-year-old fixture must retire');
  }
  const expected = state(page);
  page = page.refresh({ emitPagehide: false });
  assert.deepEqual(state(page), expected, 'rollover state and next week race cards restore exactly');
  page.click('btnNextWeek');
  assert.deepEqual(page.json('career.date'), { year: 1969, week: 2 });
  assert.equal(page.evaluate('career.weekNum'), 33);
  const next = state(page);
  page = page.refresh();
  assert.deepEqual(state(page), next);
});

test('单场首次进入生成八匹马；无生涯时刷新退回待结算下注；按下单赔率结算并且可重绘', () => {
  const defaultPage = createPage();
  defaultPage.click('btnModeSingle');
  assert.equal(defaultPage.evaluate('field.length'), 8);
  let page = createPage({ hash: '#single' });
  assert.equal(page.evaluate('career'), null, 'direct single entry does not need a career');
  assert.equal(page.evaluate('field.length'), 8);
  page.set('betHorse', page.evaluate('field[0].id'));
  page.set('betAmount', 5); page.click('btnBet');
  assert.equal(funds(page), 45);
  page = page.refresh({ emitPagehide: false });
  assert.equal(funds(page), 50, 'unplayed single bet is refunded even without a career save');
  assert.equal(page.evaluate('bet.horseId'), null);
  const target = page.evaluate(`(() => {
    const opts = Object.assign(singleRaceOptions(), {length:3200,surface:'泥地',
      styleCoefs:$('cfgCoef').value,rng:S.mulberry32(((seed^0x9e3779b9)+(raceCount+1)*7919)>>>0)});
    const expected = S.createRace(field, opts);
    let guard=0; while (!expected.race.finished && guard++<300000) expected.step(1/30);
    return expected.race.order[0].id;
  })()`);
  const price = page.evaluate('oddsMap[' + codeId(target) + ']["赔率"]');
  page.set('betHorse', target); page.set('betAmount', 5); page.click('btnBet');
  assert.equal(page.evaluate('bet.odds'), price);
  page.set('cfgLength', 3200, true); page.set('cfgSurface', '泥地', true);
  assert.equal(page.evaluate('bet.odds'), price, 'changing race configuration cannot reprice an accepted ticket');
  page.click('btnStart'); page.click('btnSkip');
  assert.equal(page.evaluate('race.race.order[0].id'), target);
  closeMoney(funds(page), 45 + 5 * price, 'single winner pays the accepted ticket price');
  assert.equal(page.evaluate('bet.horseId'), null);
  page.evaluate('renderResult(); showResult();');
  closeMoney(funds(page), 45 + 5 * price, 'single result redraw cannot pay twice');
  page = page.refresh();
  closeMoney(funds(page), 45 + 5 * price, 'completed single bankroll survives refresh');
  const horsePage = createPage({ hash: '#single', search: '?horse=1' });
  horsePage.tick(100);
  assert.equal(horsePage.evaluate('field.length'), 8, 'horse deep link with no career does not throw');
});

test('损坏或未来版本存档在页面启动和手动保存时保留原文，并显示恢复错误', () => {
  const key = 'saima-career-save';
  const corruptStorage = { [key]: 'not a valid save' };
  const corruptPage = createPage({ storage: corruptStorage });
  assert.equal(corruptStorage[key], 'not a valid save');
  assert.match(corruptPage.element('careerSaveStatus').textContent, /损坏|无法恢复/);
  corruptPage.click('btnSaveCareer');
  assert.equal(corruptStorage[key], 'not a valid save', 'manual save cannot erase a corrupt original');
  const valid = createPage();
  const future = JSON.parse(valid.storage[key]);
  future.version = 999;
  const futureRaw = JSON.stringify(future), futureStorage = { [key]: futureRaw };
  const futurePage = createPage({ storage: futureStorage });
  assert.equal(futureStorage[key], futureRaw);
  assert.match(futurePage.element('careerSaveStatus').textContent, /版本.*不受.*支持/);
  futurePage.click('btnSaveCareer');
  assert.equal(futureStorage[key], futureRaw, 'manual save cannot downgrade an unsupported save');
});

test('浏览器存储额度不足时仍可游玩，页面明确提示自动保存失败', () => {
  const storage = new Proxy({}, { set() { throw new Error('QuotaExceededError: storage quota full'); } });
  const page = createPage({ storage });
  assert.equal(page.evaluate('career.weekNum'), 1);
  assert.equal(page.evaluate('career.aiRaces.length'), 7);
  assert.match(page.element('careerSaveStatus').textContent, /存档失败.*quota/i);
  page.click('btnSaveCareer');
  assert.match(page.element('careerSaveStatus').textContent, /存档失败.*quota/i);
});

console.log('\n生涯流程：' + passed + ' 组通过，' + failed + ' 组失败');
process.exitCode = failed ? 1 : 0;
