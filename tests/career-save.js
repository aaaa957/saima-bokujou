#!/usr/bin/env node
/* Career persistence: real engine state, shared pedigrees, recovery, and failed writes. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('../sim.js');
const Save = require('../career-save.js');

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}
function makeSnapshot() {
  const rng = S.mulberry32(654321);
  const breedingStock = S.makeBaseBreedingStock(rng);
  const roster = S.makeRoster(rng, breedingStock);
  const staff = S.makeStaff(rng);
  const aiRaces = S.weekRaceSpecs(22).map((spec, idx) => S.makeScheduledRace(rng, roster, 1, idx, spec));
  const race = aiRaces[0], finished = aiRaces[1];
  const sire = breedingStock.find((h) => h.sex === '牡');
  const dam = breedingStock.find((h) => h.sex === '牝');
  let foal;
  for (let seed = 1; seed < 100; seed++) {
    foal = S.breedFoal(S.mulberry32(seed), sire, dam);
    if (!foal.earlyDeath) break;
  }
  return {
    career: {
      roster, breedingStock, date: { year: 1968, week: 22 }, weekNum: 1,
      aiRaces, weekBets: { [race.id]: { type: '単勝', ids: [race.field[0].id], amount: 5, odds: race.odds[race.field[0].id]['赔率'] } },
      startedIds: { [finished.id]: true }, watchedIds: { [finished.id]: true }, betTypes: { [race.id]: '単勝' },
      settledIds: { [finished.id]: { orderIds: finished.field.map((h) => h.id), result: '已完成', betText: null, intelLines: [], retireLines: [], betIds: [] } },
      watchInfo: null, recap: { results: ['某马胜出'], betLines: [], intelLines: [], retireLines: [], broke: false }, debug: false,
      intel: S.makeWeekIntel(aiRaces, staff, rng), stats: { bets: 2, hits: 1, profit: 8 },
    },
    careerStaff: staff,
    bankroll: 0,
    breedState: { sireId: sire.id, damId: dam.id, foal, foalName: '待入厩幼驹', foalSireId: sire.id, foalDamId: dam.id },
    raceCount: 3,
  };
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('✓ ' + name); }

test('完整生涯与未结算注单、已结算摘要、未入厩幼驹、零资金逐项往返', () => {
  const storage = memoryStorage(), snapshot = makeSnapshot();
  assert.strictEqual(Save.load(storage).status, 'missing');
  assert.strictEqual(Save.save(storage, snapshot).status, 'saved');
  const loaded = Save.load(storage);
  assert.strictEqual(loaded.status, 'ok');
  assert.deepStrictEqual(loaded.snapshot, snapshot);
  assert.strictEqual(loaded.snapshot.bankroll, 0);
  assert.strictEqual(loaded.snapshot.career.watchInfo, null);
  assert.strictEqual(loaded.snapshot.breedState.foalName, '待入厩幼驹');
  const horse = loaded.snapshot.career.roster[0];
  assert.strictEqual(horse.sireRec, loaded.snapshot.career.breedingStock.find((h) => h.id === horse.sireRec.id));
  assert.strictEqual(horse.damRec, loaded.snapshot.career.breedingStock.find((h) => h.id === horse.damRec.id));
});
test('深层祖先、共享引用、循环与undefined保持原样', () => {
  const storage = memoryStorage(), snapshot = makeSnapshot();
  const ancestor = snapshot.career.breedingStock[0];
  ancestor.sireRec = ancestor;
  snapshot.extraAncestor = ancestor;
  snapshot.optional = undefined;
  assert(Save.save(storage, snapshot).ok);
  const loaded = Save.load(storage).snapshot;
  assert.strictEqual(loaded.extraAncestor, loaded.career.breedingStock[0]);
  assert.strictEqual(loaded.extraAncestor.sireRec, loaded.extraAncestor);
  assert(Object.prototype.hasOwnProperty.call(loaded, 'optional'));
  assert.strictEqual(loaded.optional, undefined);
});
test('祖先链跨代共享不膨胀为指数复制', () => {
  const storage = memoryStorage(), snapshot = makeSnapshot();
  let ancestor = snapshot.career.breedingStock[0];
  for (let generation = 0; generation < 80; generation++) ancestor = { id: 'ancestor' + generation, sireRec: ancestor, damRec: ancestor };
  snapshot.career.roster[0].sireRec = ancestor;
  assert(Save.save(storage, snapshot).ok);
  assert(storage.getItem(Save.KEY).length < 1000000);
  let restored = Save.load(storage).snapshot.career.roster[0].sireRec;
  for (let generation = 0; generation < 80; generation++) { assert.strictEqual(restored.sireRec, restored.damRec); restored = restored.sireRec; }
});
test('上一份有效存档备份，坏主存档自动回退且恢复保存保留备份', () => {
  const storage = memoryStorage(), first = makeSnapshot();
  assert(Save.save(storage, first).ok);
  const previous = storage.getItem(Save.KEY);
  const next = makeSnapshot(); next.bankroll = 17;
  assert(Save.save(storage, next).ok);
  assert.strictEqual(storage.getItem(Save.BACKUP_KEY), previous);
  storage.setItem(Save.KEY, '{broken');
  const recovered = Save.load(storage);
  assert.strictEqual(recovered.status, 'recovered');
  assert.deepStrictEqual(recovered.snapshot, first);
  assert.strictEqual(storage.getItem(Save.KEY), '{broken');
  assert(Save.save(storage, recovered.snapshot).ok);
  assert.strictEqual(storage.getItem(Save.BACKUP_KEY), previous);
  assert.strictEqual(Save.load(storage).status, 'ok');
});
test('主键丢失也能恢复备份', () => {
  const storage = memoryStorage(), snapshot = makeSnapshot();
  Save.save(storage, snapshot); Save.save(storage, snapshot);
  storage.values.delete(Save.KEY);
  assert.strictEqual(Save.load(storage).status, 'recovered');
});
test('无效新快照不会写入或覆盖有效主存档和备份', () => {
  const storage = memoryStorage(), snapshot = makeSnapshot();
  Save.save(storage, snapshot); Save.save(storage, snapshot);
  const values = new Map(storage.values);
  const invalid = [
    (s) => { s.bankroll = NaN; },
    (s) => { s.bankroll = -1; },
    (s) => { s.career.date.week = 53; },
    (s) => { s.career.roster = {}; },
    (s) => { delete s.career.roster[0].stats['速度']; },
    (s) => { delete s.breedState.foal.stats['耐力']; },
    (s) => { s.careerStaff['牧场长']['相马眼'] = '未知'; },
    (s) => { s.career.weekBets.unknown = { type: '単勝', ids: ['unknown'], amount: 5, odds: 10 }; },
  ];
  for (const damage of invalid) {
    const damaged = makeSnapshot(); damage(damaged);
    assert.strictEqual(Save.save(storage, damaged).status, 'invalid');
    assert.deepStrictEqual(storage.values, values);
  }
  snapshot.extraFunction = () => {};
  assert.strictEqual(Save.save(storage, snapshot).status, 'invalid');
  assert.deepStrictEqual(storage.values, values);
});
test('六类合法马券均可恢复，券种所需匹数与引擎一致', () => {
  for (const type of S.BET_TYPES) {
    const storage = memoryStorage(), snapshot = makeSnapshot();
    const race = snapshot.career.aiRaces[0];
    snapshot.career.weekBets[race.id] = {
      type, ids: race.field.slice(0, S.BET_NEED[type]).map((h) => h.id), amount: 5, odds: 10,
    };
    assert(Save.save(storage, snapshot).ok, type);
    assert.deepStrictEqual(Save.load(storage).snapshot.career.weekBets, snapshot.career.weekBets);
  }
});
test('非法票、名次、观赛与结算不一致状态不能覆盖有效存档', () => {
  const storage = memoryStorage(), valid = makeSnapshot();
  Save.save(storage, valid); Save.save(storage, valid);
  const values = new Map(storage.values);
  const corruptions = [
    ['未知券种', (s, pending, settled) => { s.career.weekBets[pending.id].type = '未知'; }],
    ['三连券匹数不足', (s, pending) => { s.career.weekBets[pending.id].type = '三連複'; }],
    ['单胜匹数过多', (s, pending) => { s.career.weekBets[pending.id].ids.push(pending.field[1].id); }],
    ['三连复重复选择', (s, pending) => { const b = s.career.weekBets[pending.id]; b.type = '三連複'; b.ids = Array(3).fill(pending.field[0].id); }],
    ['马连重复选择', (s, pending) => { const b = s.career.weekBets[pending.id]; b.type = '馬連'; b.ids = Array(2).fill(pending.field[0].id); }],
    ['下注马匹不在赛事', (s, pending) => { s.career.weekBets[pending.id].ids = ['unknown']; }],
    ['已结算赛事仍有注单', (s, pending, settled) => { s.career.weekBets[settled.id] = { type: '単勝', ids: [settled.field[0].id], amount: 5, odds: 10 }; }],
    ['摘要指向不存在赛事', (s, pending, settled) => { s.career.settledIds.unknown = s.career.settledIds[settled.id]; s.career.watchedIds.unknown = true; }],
    ['名次含重复马匹', (s, pending, settled) => { s.career.settledIds[settled.id].orderIds = [settled.field[0].id, settled.field[0].id]; }],
    ['名次含非参赛马', (s, pending, settled) => { s.career.settledIds[settled.id].orderIds = ['unknown']; }],
    ['已观看但无结算摘要', (s, pending, settled) => { delete s.career.settledIds[settled.id]; }],
    ['已结算但缺少观赛标记', (s, pending, settled) => { delete s.career.watchedIds[settled.id]; }],
    ['已结算但观赛标记为false', (s, pending, settled) => { s.career.watchedIds[settled.id] = false; }],
    ['已开赛标记缺失', (s) => { delete s.career.startedIds; }],
    ['已开赛标记不是布尔值', (s, pending) => { s.career.startedIds[pending.id] = 1; }],
    ['已开赛标记不属于本周', (s) => { s.career.startedIds.unknown = true; }],
    ['已观看但缺少开赛标记', (s, pending, settled) => { delete s.career.startedIds[settled.id]; }],
    ['已观看但标记尚未开赛', (s, pending, settled) => { s.career.startedIds[settled.id] = false; }],
    ['摘要betText非文字', (s, pending, settled) => { s.career.settledIds[settled.id].betText = 1; }],
    ['摘要情报列表非文字', (s, pending, settled) => { s.career.settledIds[settled.id].intelLines = [{}]; }],
    ['摘要退役列表缺失', (s, pending, settled) => { delete s.career.settledIds[settled.id].retireLines; }],
    ['摘要注单马匹不存在', (s, pending, settled) => { s.career.settledIds[settled.id].betIds = ['unknown']; }],
    ['摘要注单马匹重复', (s, pending, settled) => { s.career.settledIds[settled.id].betIds = Array(2).fill(settled.field[0].id); }],
    ['摘要注单马匹列表缺失', (s, pending, settled) => { delete s.career.settledIds[settled.id].betIds; }],
    ['赛程编号重复', (s, pending) => { s.career.aiRaces.push(pending); }],
    ['参赛马重复', (s, pending) => { pending.field.push(pending.field[0]); }],
  ];
  for (const [name, corrupt] of corruptions) {
    const snapshot = makeSnapshot();
    corrupt(snapshot, snapshot.career.aiRaces[0], snapshot.career.aiRaces[1]);
    assert.strictEqual(Save.validateSnapshot(snapshot).status, 'invalid', name);
    assert.strictEqual(Save.save(storage, snapshot).status, 'invalid', name);
    assert.deepStrictEqual(storage.values, values, name + '：已有存档必须保留');
  }
});
test('观赛中断恢复保留封盘状态和待结算票，不标记已结算', () => {
  const storage = memoryStorage(), snapshot = makeSnapshot();
  const race = snapshot.career.aiRaces[0];
  snapshot.career.startedIds[race.id] = true;
  snapshot.career.watchedIds[race.id] = false;
  assert(Save.save(storage, snapshot).ok);
  const loaded = Save.load(storage).snapshot;
  assert.strictEqual(loaded.career.startedIds[race.id], true);
  assert.strictEqual(loaded.career.watchedIds[race.id], false);
  assert.strictEqual(loaded.career.settledIds[race.id], undefined);
  assert.deepStrictEqual(loaded.career.weekBets[race.id], snapshot.career.weekBets[race.id]);
  assert.strictEqual(loaded.bankroll, snapshot.bankroll);
});
test('幼驹父母独立于当前选择保存，缺失或身份错误时拒绝恢复快照', () => {
  const storage = memoryStorage(), valid = makeSnapshot();
  valid.breedState.sireId = valid.career.breedingStock.filter((h) => h.sex === '牡')[1].id;
  valid.breedState.damId = valid.career.breedingStock.filter((h) => h.sex === '牝')[1].id;
  assert(Save.save(storage, valid).ok);
  const loaded = Save.load(storage).snapshot;
  assert.notStrictEqual(loaded.breedState.foalSireId, loaded.breedState.sireId);
  assert.notStrictEqual(loaded.breedState.foalDamId, loaded.breedState.damId);
  const values = new Map(storage.values);
  for (const damage of [
    (s) => { delete s.breedState.foalSireId; },
    (s) => { s.breedState.foalDamId = 'missing'; },
    (s) => { s.breedState.foalSireId = s.breedState.foalDamId; },
    (s) => { s.breedState.foalDamId = s.breedState.foalSireId; },
  ]) {
    const snapshot = makeSnapshot(); damage(snapshot);
    assert.strictEqual(Save.save(storage, snapshot).status, 'invalid');
    assert.deepStrictEqual(storage.values, values);
  }
  const initial = makeSnapshot(); initial.breedState = { sireId: null, damId: null, foal: null };
  assert(Save.save(memoryStorage(), initial).ok);
});
test('合法校验和不能绕过恢复时对重复马券的schema校验', () => {
  const storage = memoryStorage(), snapshot = makeSnapshot();
  Save.save(storage, snapshot); Save.save(storage, snapshot);
  const envelope = JSON.parse(storage.getItem(Save.KEY));
  const betNode = envelope.payload.nodes.find((node) => node.type === 'object' && node.entries.some(([key, value]) => key === 'type' && value === '単勝') && node.entries.some(([key]) => key === 'amount'));
  betNode.entries.find(([key]) => key === 'type')[1] = '馬連';
  const idsNode = envelope.payload.nodes[betNode.entries.find(([key]) => key === 'ids')[1].r];
  idsNode.items.push(idsNode.items[0]);
  // Re-seal a deliberately malformed external envelope to exercise schema,
  // independently from the checksum-corruption test below.
  const payload = JSON.stringify(envelope.payload);
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) { hash ^= payload.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  envelope.checksum = (hash >>> 0).toString(16).padStart(8, '0');
  storage.setItem(Save.KEY, JSON.stringify(envelope));
  const recovered = Save.load(storage);
  assert.strictEqual(recovered.status, 'recovered');
  assert.deepStrictEqual(recovered.snapshot.career.weekBets, snapshot.career.weekBets);
  storage.values.delete(Save.BACKUP_KEY);
  assert.strictEqual(Save.load(storage).status, 'corrupt');
});
test('损坏存档无备份时保留原数据，不被新生涯自动覆盖', () => {
  const storage = memoryStorage(); storage.setItem(Save.KEY, '{}');
  assert.strictEqual(Save.load(storage).status, 'corrupt');
  assert.strictEqual(Save.save(storage, makeSnapshot()).status, 'corrupt');
  assert.strictEqual(storage.getItem(Save.KEY), '{}');
});
test('未来版本拒绝载入及覆盖，不回退旧备份伪装成功', () => {
  const storage = memoryStorage(), snapshot = makeSnapshot();
  Save.save(storage, snapshot); Save.save(storage, snapshot);
  const future = JSON.parse(storage.getItem(Save.KEY)); future.version = Save.VERSION + 1;
  const raw = JSON.stringify(future); storage.setItem(Save.KEY, raw);
  assert.strictEqual(Save.load(storage).status, 'unsupported');
  assert.strictEqual(Save.save(storage, snapshot).status, 'unsupported');
  assert.strictEqual(storage.getItem(Save.KEY), raw);
});
test('有限合法JSON的内容损坏也由校验和发现', () => {
  const storage = memoryStorage(); Save.save(storage, makeSnapshot());
  const envelope = JSON.parse(storage.getItem(Save.KEY));
  envelope.payload.nodes[0].entries.find(([key]) => key === 'bankroll')[1] = 999999;
  storage.setItem(Save.KEY, JSON.stringify(envelope));
  assert.strictEqual(Save.load(storage).status, 'corrupt');
});
test('localStorage不可用、读取拒绝均明确返回error', () => {
  for (const storage of [null, { getItem() { throw new Error('SecurityError'); }, setItem() {} }]) {
    assert.strictEqual(Save.load(storage).status, 'storage-error');
    const result = Save.save(storage, makeSnapshot());
    assert.strictEqual(result.status, 'storage-error'); assert(result.error.length > 0);
  }
});
test('备份写入额度失败不覆盖主存档', () => {
  const storage = memoryStorage(); Save.save(storage, makeSnapshot());
  const previous = storage.getItem(Save.KEY), originalSet = storage.setItem;
  storage.setItem = function (key, value) { if (key === Save.BACKUP_KEY) throw new Error('QuotaExceededError'); originalSet.call(this, key, value); };
  const snapshot = makeSnapshot(); snapshot.bankroll = 20;
  assert.strictEqual(Save.save(storage, snapshot).status, 'storage-error');
  assert.strictEqual(storage.getItem(Save.KEY), previous);
});
test('主键写入失败保留上一份有效主存档及备份', () => {
  const storage = memoryStorage(); Save.save(storage, makeSnapshot());
  const previous = storage.getItem(Save.KEY), originalSet = storage.setItem;
  storage.setItem = function (key, value) { if (key === Save.KEY) throw new Error('QuotaExceededError'); originalSet.call(this, key, value); };
  assert.strictEqual(Save.save(storage, makeSnapshot()).status, 'storage-error');
  assert.strictEqual(storage.getItem(Save.KEY), previous);
  assert.strictEqual(storage.getItem(Save.BACKUP_KEY), previous);
  assert(Save.load(storage).ok);
});
test('浏览器全局API可保存，并与Node格式互通', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../career-save.js'), 'utf8'), context);
  const storage = memoryStorage();
  assert(context.SaimaCareerSave.save(storage, makeSnapshot()).ok);
  assert(Save.load(storage).ok);
  assert.strictEqual(context.SaimaCareerSave.load(storage).status, 'ok');
});
console.log('\n' + passed + ' career save checks passed.');
