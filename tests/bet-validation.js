#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const S = require('../sim.js');

const field = ['a', 'b', 'c', 'd'];
const order = ['a', 'b', 'c', 'd'];
const cases = [
  { type: '単勝', ids: ['a'], miss: ['b'], odds: [4], quote: 4 },
  { type: '複勝', ids: ['c'], miss: ['d'], odds: [4], quote: 2.05 },
  { type: '馬連', ids: ['b', 'a'], miss: ['a', 'c'], odds: [4, 6], quote: 6.7 },
  { type: '馬単', ids: ['a', 'b'], miss: ['b', 'a'], odds: [4, 6], quote: 12 },
  { type: '三連複', ids: ['c', 'a', 'b'], miss: ['a', 'b', 'd'], odds: [4, 6, 8], quote: 13.4 },
  { type: '三連単', ids: ['a', 'b', 'c'], miss: ['b', 'a', 'c'], odds: [4, 6, 8], quote: 86.4 },
];

for (const bet of cases) {
  assert.equal(S.validBetSelection(bet.type, bet.ids, field), true, bet.type + ': legal field selection');
  assert.equal(S.validBetSelection(bet.type, bet.ids, new Set(field)), true, bet.type + ': Set field IDs');
  assert.equal(S.betTypeHit(bet.type, bet.ids, order), true, bet.type + ': legal winning ticket');
  assert.equal(S.betTypeHit(bet.type, bet.miss, order), false, bet.type + ': legal losing ticket');
  assert.ok(Math.abs(S.calcBetOdds(bet.type, bet.odds) - bet.quote) < 1e-12, bet.type + ': existing quote formula');

  const invalid = [[], new Array(bet.ids.length), bet.ids.concat('d'), bet.ids.slice(1), null, 'a',
    bet.ids.map((id, i) => i === 0 ? '' : id),
    bet.ids.map((id, i) => i === 0 ? '  ' : id),
    bet.ids.map((id, i) => i === 0 ? null : id),
    bet.ids.map((id, i) => i === 0 ? 0 : id)];
  if (bet.ids.length > 1) invalid.push(Array(bet.ids.length).fill('a'));
  for (const ids of invalid) {
    assert.equal(S.validBetSelection(bet.type, ids, field), false, bet.type + ': rejects malformed selection');
    assert.equal(S.betTypeHit(bet.type, ids, order), false, bet.type + ': malformed selection cannot win');
  }
  const foreign = bet.ids.map((id, i) => i === 0 ? 'foreign' : id);
  assert.equal(S.validBetSelection(bet.type, foreign, field), false, bet.type + ': rejects out-of-field ID');
  assert.equal(S.betTypeHit(bet.type, foreign, order), false, bet.type + ': unknown horse cannot win');

  for (const odds of [[], bet.odds.concat(5), bet.odds.slice(1), null, '4',
    bet.odds.map((value, i) => i === 0 ? 0 : value),
    bet.odds.map((value, i) => i === 0 ? -1 : value),
    bet.odds.map((value, i) => i === 0 ? NaN : value),
    bet.odds.map((value, i) => i === 0 ? Infinity : value),
    bet.odds.map((value, i) => i === 0 ? '4' : value)]) {
    assert.equal(S.calcBetOdds(bet.type, odds), null, bet.type + ': rejects malformed odds');
  }
}

// Before the fix these unordered tickets passed the membership-only hit check.
assert.equal(S.betTypeHit('馬連', ['a', 'a'], order), false);
assert.equal(S.betTypeHit('三連複', ['a', 'a', 'a'], order), false);
assert.equal(S.betTypeHit('三連複', ['a', 'b', 'b'], order), false);
for (const type of ['', 'unknown', 'toString', '__proto__', null, undefined]) {
  assert.equal(S.validBetSelection(type, ['a']), false, 'unsupported bet type');
  assert.equal(S.betTypeHit(type, ['a'], order), false, 'unsupported type cannot win');
  assert.equal(S.calcBetOdds(type, [4]), null, 'unsupported type cannot get a quote');
}
assert.equal(S.validBetSelection('単勝', ['a']), true, 'field restriction is optional');
assert.equal(S.validBetSelection('単勝', ['a'], []), false, 'empty field has no legal entrant');
assert.equal(S.validBetSelection('単勝', ['a'], null), false, 'malformed field restriction');
assert.equal(S.betTypeHit('単勝', ['a'], ['a', 'a']), false, 'malformed finishing order cannot pay');
assert.equal(S.betTypeHit('単勝', ['a'], ['a', , 'c']), false, 'sparse finishing order cannot pay');
assert.equal(S.betTypeHit('単勝', ['a'], null), false, 'missing finishing order cannot pay');
assert.equal(S.betTypeHit('複勝', ['a'], ['a']), true, 'available finishers remain valid in a partial result');
assert.equal(S.calcBetOdds('三連単', [1e308, 1e308, 1e308]), null, 'overflow cannot create infinite payout');
assert.equal(S.calcBetOdds('単勝', [0.5]), 1.1, 'existing legal quote floor');

console.log('PASS bet validation: all six legal ticket types, duplicate-ticket regression, field IDs, malformed quotes, and payout overflow');
