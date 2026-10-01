#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const S = require('../sim.js');

const HIDDEN_STATS = ['速度', '耐力', '爆发力', '出闸能力', '力量', '毅力', '智力'];
let checkedRaces = 0;

function raceOpts(race) {
  return { length: race.dist, surface: race.surface, state: race.state, dir: race.dir, profile: race.profile };
}

// Reuse the actual public noise draws so the comparison isolates the model
// and race conditions, rather than differences in the generator's RNG use.
function pricingRng(race) {
  let i = 0;
  return () => (race.odds[race.field[i++].id].parts.noise + 1) / 2;
}

function checkRace(label, race) {
  assert.ok(race.field.length > 0, label + ': fixture must contain entrants');
  let probabilitySum = 0;
  for (const h of race.field) {
    const quote = race.odds[h.id];
    assert.ok(quote && quote.parts, label + ': actual quote must come from the public market');
    assert.ok(Number.isFinite(quote['赔率']) && quote['赔率'] > 0, label + ': valid displayed odds');
    assert.ok(Number.isFinite(quote['概率']) && quote['概率'] > 0, label + ': market probability');
    probabilitySum += quote['概率'];
  }
  assert.ok(Math.abs(probabilitySum - 1) < 1e-12, label + ': probabilities sum to one');
  const expected = S.marketOddsAndPopularity(race.field, raceOpts(race), pricingRng(race)).byId;
  assert.deepEqual(race.odds, expected, label + ': actual generator prices the actual race conditions');

  const changed = JSON.parse(JSON.stringify(race.field));
  changed.forEach((h, i) => HIDDEN_STATS.forEach((stat) => { h.stats[stat] = i % 2 ? 1 : 115; }));
  const changedQuotes = S.marketOddsAndPopularity(changed, raceOpts(race), pricingRng(race)).byId;
  assert.deepEqual(changedQuotes, race.odds, label + ': hidden ability cannot change the market quote');
  checkedRaces++;
}

for (const seed of [186, 957, 20261001]) {
  const init = S.mulberry32(seed);
  const roster = S.makeRoster(init);
  const player = S.makeCareerHorse(init);
  const rng = S.mulberry32(seed ^ 0x51ab1);

  for (const progress of [{ starts: 0, wins: 0 }, { starts: 1, wins: 0 }, { starts: 20, wins: 5 }]) {
    const horse = { ...player, ...progress };
    S.raceOptionsFor(horse, rng).forEach((race) => checkRace('career/' + race.key, race));
    S.raceOptionsForRoster(horse, rng, roster, 8).forEach((race) => checkRace('roster career/' + race.key, race));
  }
  checkRace('featured', S.makeFeaturedRace(rng, 8));
  for (const week of [7, 8]) S.weekRaceSpecs(week).forEach((spec, idx) => {
    checkRace('scheduled/' + spec.key, S.makeScheduledRace(rng, roster, week, idx, spec));
  });
  for (const key of ['maiden', 'cond', 'g']) {
    checkRace('weekly AI/' + key, S.makeWeeklyAiRace(rng, roster, 8, key, key));
  }
}

// A property-access guard catches regressions even if a small ability change
// happens not to move the displayed odds after rounding.
const field = S.makeField(S.mulberry32(186), { n: 8 });
const opts = { length: 2000, surface: '泥地', state: '重', dir: '右回', profile: '中坂' };
const guarded = field.map((h) => ({
  ...h,
  stats: new Proxy(h.stats, {
    get(stats, key) {
      assert.ok(!HIDDEN_STATS.includes(key), 'market must not read hidden stat: ' + String(key));
      return stats[key];
    },
  }),
}));
const publicQuotes = S.marketOddsAndPopularity(field, opts, S.mulberry32(957)).byId;
assert.deepEqual(S.marketOddsAndPopularity(guarded, opts, S.mulberry32(957)).byId, publicQuotes);
assert.deepEqual(S.oddsAndPopularity(guarded, S.mulberry32(957), opts), publicQuotes,
  'legacy API keeps its map shape while using the public model');
assert.deepEqual(S.oddsAndPopularity(guarded, S.mulberry32(957)),
  S.marketOddsAndPopularity(field, undefined, S.mulberry32(957)).byId,
  'the original two-argument API remains compatible');

function scoreWithoutBias(horse, param) {
  const original = S.MARKET[param];
  try {
    S.MARKET[param] = 1;
    return S.marketEntryScore(horse, opts, () => 0.5).score;
  } finally {
    S.MARKET[param] = original;
  }
}
const popular = { ...field[0], form: { '出赛': 10, '胜利': 4, '前三': 7 } };
const newcomer = { ...field[0], form: { '出赛': 0, '胜利': 0, '前三': 0 } };
assert.ok(S.marketEntryScore(popular, opts, () => 0.5).score > scoreWithoutBias(popular, 'biasWinStreak'),
  'high win rate bias raises the public score');
assert.ok(S.marketEntryScore(newcomer, opts, () => 0.5).score < scoreWithoutBias(newcomer, 'biasUnraced'),
  'newcomer neglect lowers the public score');

console.log('PASS market integration: ' + checkedRaces + ' generated races, hidden-stat guard, legacy API, and bias directions');
