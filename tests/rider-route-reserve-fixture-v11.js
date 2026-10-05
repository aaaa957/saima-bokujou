#!/usr/bin/env node
'use strict';
// Only finishPlan queries. Reuse the real route test setup, without executing
// any test body or race step; preserve the fixed-input premise failure too.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module'), { gzipSync } = require('node:zlib');
const { HASH } = require('./system-reality-v9'), { compileSource } = require('./race-validation-v11');
const { terminalReleaseFixture } = require('./fixtures/route-reserve-power-v11');
const root = path.resolve(__dirname, '..'), filename = path.join(root, 'sim.js');
const source = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
const routeFilename = path.join(__dirname, 'rider-route-planning.js');
const routeSource = fs.readFileSync(routeFilename, 'utf8');
const start = routeSource.indexOf("test('a settled gallop");
assert(start > 0); assert.equal(routeSource.split("const S = require('../sim.js');").length - 1, 1);
const setup = new Function('S', 'require', routeSource.slice(0, start).replace(/^#![^\r\n]*[\r\n]+/, '').replace("const S = require('../sim.js');", '') + '\nreturn {makeRace,at};');
const manifestPath = path.join(__dirname, 'fixtures/race-validation-v11-parameters/manifest-mechanical.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const variants = [{ name: 'current', parameters: {} }, ...manifest.variants.filter(v => /cost105$|cost110$/.test(v.name))];
assert.equal(variants.length, 3);
const report = { sourceHash: HASH(source), scriptHash: HASH(fs.readFileSync(__filename, 'utf8')),
  routeTestHash: HASH(routeSource), fixtureHash: HASH(fs.readFileSync(path.join(__dirname, 'fixtures/route-reserve-power-v11.js'), 'utf8')),
  declaredManifestHash: HASH(fs.readFileSync(manifestPath, 'utf8')), builtAt: new Date().toISOString(),
  scope: 'Only the terminal-release fixture at fixed v16, final100m. Current and predeclared cost105/110 parameters; no full race or actual physical steps. The old fixed-reserve premise failure is retained, not treated as an engine failure.',
  finishPlanQueries: 0, actualStepCalls: 0, rows: [], failures: [] };
for (const variant of variants) {
  const S = compileSource(source); Object.assign(S.RACE_F, variant.parameters);
  const { makeRace, at } = setup(S, createRequire(routeFilename));
  const makeState = reserve => {
    const r = makeRace({ length: 800 });
    r.step = () => { report.actualStepCalls++; throw Error('This focused fixture check cannot run actual physics.'); };
    const H = at(r, { s: 700, t: 10, v: 16, reserve });
    const finish = H.finishPlan; H.finishPlan = (...args) => { report.finishPlanQueries++; return finish(...args); };
    return H;
  };
  const oldH = makeState(140 / 2450), old = oldH.finishPlan(16), H = makeState(1);
  let fixture, forecast;
  const row = { variant: variant.name, parameters: variant.parameters, effectiveCoefficientHash: HASH(JSON.stringify(S.RACE_F)),
    oldFixedReserve: { reserve: oldH.stamina, required: old.required, peakPowerShortfall: old.peakPowerShortfall, feasible: old.feasible,
      totalEnergySufficient: old.required > 0 && old.required < oldH.stamina,
      terminalPowerLimited: old.peakPowerShortfall > 0, intendedPremisesHold: old.required > 0 && old.required < oldH.stamina && old.peakPowerShortfall > 0 && old.feasible === false } };
  try {
    fixture = terminalReleaseFixture(S, H, 16); forecast = H.finishPlan(16);
    assert.ok(forecast.required > 0 && forecast.required < H.stamina,
      'the final 100 metres must consume reserve without exhausting its total capacity');
    assert.ok(forecast.peakPowerShortfall > 0,
      'the depleted final reserve must expose its inadequate instantaneous power');
    assert.equal(forecast.feasible, false,
      'average reserve within a cell cannot authorize a pace the cell endpoint cannot sustain');
    row.pass = true;
  } catch (error) { row.pass = false; row.error = String(error.stack || error); report.failures.push(variant.name); }
  row.derived = { fixture, required: forecast?.required, peakPowerShortfall: forecast?.peakPowerShortfall, feasible: forecast?.feasible,
    endpoint: forecast?.endpoint, energyHeadroom: fixture ? H.stamina - (forecast?.required ?? NaN) : null };
  report.rows.push(row);
}
report.productionUnchanged = HASH(fs.readFileSync(filename, 'utf8')) === report.sourceHash;
report.pass = !report.failures.length && report.productionUnchanged && report.actualStepCalls === 0;
const out = path.join(root, 'docs/rider-route-reserve-fixture-v11.json');
if (fs.existsSync(out)) {
  const old = fs.readFileSync(out), history = path.join(root, 'docs/rider-route-reserve-fixture-v11-history');
  fs.mkdirSync(history, { recursive: true }); fs.writeFileSync(path.join(history, HASH(old.toString()) + '.json'), old);
}
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); fs.writeFileSync(out + '.source.js.gz', gzipSync(source));
fs.writeFileSync(out + '.route-test.js.gz', gzipSync(routeSource)); fs.writeFileSync(out + '.fixture.js.gz', gzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/route-reserve-power-v11.js'))));
console.log(JSON.stringify(report, null, 2)); if (!report.pass) process.exitCode = 1;
