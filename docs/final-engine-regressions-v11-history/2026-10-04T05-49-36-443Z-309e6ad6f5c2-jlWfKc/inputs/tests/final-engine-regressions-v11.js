#!/usr/bin/env node
'use strict';
// Preparation is read-only. --run requires the final normalized sim.js SHA256.
// Child suites run sequentially; this wrapper never runs calibration grids.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const engineFile = path.join(root, 'sim.js');
const mainReport = path.join(root, 'docs/final-engine-regressions-v11.json');
const mainMarkdown = path.join(root, 'docs/final-engine-regressions-v11.md');
const historyRoot = path.join(root, 'docs/final-engine-regressions-v11-history');
const rawHash = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceHash = value => rawHash(value.toString('utf8').replace(/\r\n/g, '\n'));
const relative = filename => path.relative(root, filename).replace(/\\/g, '/');
const suites = [
  {
    id: 'prediction-consistency', script: 'tests/prediction-consistency-v11.js',
    outputs: ['docs/prediction-consistency-v11.json', 'docs/prediction-consistency-v11.md'],
    minimumChecks: 12,
    scope: '12 fixed continuations and 3 paired factoring controls; 60 Hz state, work, energy and action transitions. Includes its existing 150-query microbenchmark; no field calibration.'
  },
  {
    id: 'rider-route-planning', script: 'tests/rider-route-planning.js', outputs: [],
    minimumChecks: 15,
    scope: 'Route geometry, lateral work, grade/wind, reserve recovery and instantaneous power; dense controlled references. Output is stdout only.'
  },
  {
    id: 'rider-planning', script: 'tests/rider-planning-v11.js',
    outputs: ['docs/rider-planning-v11.json'], minimumChecks: 5,
    scope: 'Position utility, unattainable catch, blocked lanes and exact action transitions; includes 2 complete 4-horse 1200 m races for style-label trajectory equivalence.'
  },
  {
    id: 'finalcoarse-focused', script: 'tests/follow-coarse-screen-focused-v11.js',
    outputs: ['docs/follow-coarse-screen-focused-v11.json', 'docs/follow-coarse-screen-focused-v11.json.source.js.gz', 'docs/follow-coarse-screen-focused-v11.json.candidate.js.gz'],
    minimumChecks: 10,
    scope: 'Coarse refusals skip fine work, fine refusals cannot commit, accepted catches require fine goals/energy; planning patch is idempotent and fixed controls remain exact. Stub gates are mechanism tests, not numerical calibration.'
  },
  {
    id: 'rank-focused', script: 'tests/rider-rank-clock-v11.js',
    outputs: ['docs/rider-rank-clock-v11.json', 'docs/rider-rank-clock-v11.json.source.js.gz'],
    minimumChecks: 6,
    scope: 'Same-candidate visible endpoints and clock for distant/moving rivals, own early finish, placed/crossing rivals and guarded hidden-state access.'
  },
  {
    id: 'controller-review', script: 'tests/rider-controller-review-v11.js',
    outputs: ['docs/rider-controller-review-v11.json'], minimumChecks: 10,
    scope: 'Visible motion prior, start-delay reuse, action continuation, viable routes, traffic veto separation and fine follow commitment.'
  },
  {
    id: 'sequence-safety-focused', script: 'tests/sequence-safety-override-focused-v11.js',
    outputs: ['docs/sequence-safety-override-focused-v11.json', 'docs/sequence-safety-override-focused-v11.json.source.js.gz', 'docs/sequence-safety-override-focused-v11.json.candidate.js.gz', 'docs/sequence-safety-override-focused-v11.json.script.js.gz'],
    minimumChecks: 10,
    scope: 'Actual safety tuple changes cancel unexecuted sequences; candidate/actual telemetry and attack labels agree. Unchanged commands preserve commitments and launch/withdraw state. Synthetic branch forecasts are not field numerical evidence.'
  }
];

function parseArgs(argv) {
  const result = { run: false, expectedSource: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') result.run = true;
    else if (argv[i] === '--plan') result.run = false;
    else if (argv[i] === '--expected-source') result.expectedSource = argv[++i];
    else throw Error('Unknown argument: ' + argv[i]);
  }
  if (result.expectedSource && !/^[0-9a-f]{64}$/.test(result.expectedSource)) {
    throw Error('--expected-source requires a lowercase 64-character SHA256.');
  }
  if (result.run && !result.expectedSource) throw Error('--run requires --expected-source <final sim.js SHA256>.');
  return result;
}

function inputFiles() {
  const result = new Set([
    engineFile, __filename,
    path.join(root, 'tests/system-reality-v9.js'),
    path.join(root, 'tests/race-validation-v11.js'),
    path.join(root, 'tests/sequence-safety-override-v11.js'),
    ...suites.map(s => path.join(root, s.script))
  ]);
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(filename);
      else if (entry.isFile()) result.add(filename);
    }
  }
  collect(path.join(root, 'tests/fixtures'));
  return [...result].sort();
}

function manifestFor(files) {
  return Object.fromEntries(files.map(filename => {
    const bytes = fs.readFileSync(filename);
    return [relative(filename), { bytes: bytes.length, sha256: rawHash(bytes) }];
  }));
}

function archiveFile(filename, destinationRoot) {
  if (!fs.existsSync(filename)) return null;
  const bytes = fs.readFileSync(filename), destination = path.join(destinationRoot, relative(filename));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(filename, destination, fs.constants.COPYFILE_EXCL);
  if (rawHash(fs.readFileSync(destination)) !== rawHash(bytes)) throw Error('Archive verification failed: ' + relative(filename));
  return { path: relative(filename), archive: relative(destination), bytes: bytes.length, sha256: rawHash(bytes) };
}

function execute(args, logPrefix) {
  return new Promise(resolve => {
    const started = performance.now();
    const stdout = fs.createWriteStream(logPrefix + '.stdout.log', { flags: 'wx' });
    const stderr = fs.createWriteStream(logPrefix + '.stderr.log', { flags: 'wx' });
    // Cap only V8 heap, preserving the Node runtime selected by the caller.
    const child = spawn(process.execPath, ['--max-old-space-size=192', ...args], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let error = null;
    child.stdout.pipe(stdout); child.stderr.pipe(stderr);
    child.stdout.on('data', chunk => process.stdout.write(chunk));
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('error', e => { error = String(e.stack || e); });
    child.on('close', (code, signal) => {
      // Finish both file streams before their hashes and evidence are read.
      const finished = stream => new Promise(done => stream.closed ? done() : stream.once('close', done));
      Promise.all([finished(stdout), finished(stderr)]).then(() => resolve({
        exitCode: code, signal, spawnError: error,
        wallSeconds: (performance.now() - started) / 1000,
        stdout: relative(logPrefix + '.stdout.log'), stderr: relative(logPrefix + '.stderr.log')
      }));
    });
  });
}

function evidenceFor(suite, expectedSource, scriptHash) {
  const problems = [], require = (condition, message) => { if (!condition) problems.push(message); };
  if (!suite.outputs.length) return { problems };
  const filename = path.join(root, suite.outputs[0]);
  if (!fs.existsSync(filename)) return { problems: ['Suite did not produce a fresh JSON report.'] };
  let report;
  try { report = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (e) { return { problems: ['Invalid JSON report: ' + e.message] }; }
  let checks = 0, fields = {};
  if (suite.id === 'prediction-consistency') {
    require(report.engineHash === expectedSource && report.productionAtStartHash === expectedSource && report.productionEndHash === expectedSource, 'Prediction report must use the frozen production source throughout.');
    require(report.productionUsed === true && report.summary?.productionUnchanged === true, 'Prediction must run the current source without mutation.');
    require(report.testSourceHash === scriptHash, 'Prediction script hash mismatch.');
    require(report.failures?.length === 0 && report.summary?.allFineWithin1e7 === true, 'Prediction fine replay or property checks failed.');
    require(report.golden?.length === 3 && report.golden.every(x => x.exact === true), 'All 3 historical factoring controls are required.');
    require(report.properties?.length >= 4 && report.properties.every(x => x.status === 'passed'), 'Prediction properties incomplete or failed.');
    checks = report.rows?.length || 0;
    fields = { executions: report.executions, frames: report.frames, forecastQueries: report.forecastQueries, microbenchmarkQueries: report.microbenchmarkQueries, coefficientHash: report.coefficientHash, fineMaxAbsState: report.summary?.fineMaxAbsState };
  } else {
    require(report.sourceHash === expectedSource, 'Suite report source hash mismatch.');
    if (suite.id === 'rider-planning') {
      checks = report.cases?.length || 0;
      require(report.passed === checks && report.cases?.every(x => x.passed === true), 'Rider planning cases incomplete or failed.');
    } else if (suite.id === 'controller-review') {
      checks = report.cases?.length || 0;
      require(report.testHash === scriptHash, 'Controller script hash mismatch.');
      require(report.failed === 0 && report.passed === checks && report.cases?.every(x => x.passed === true), 'Controller review cases incomplete or failed.');
      require(report.productionSourceUnchanged === true, 'Controller report detected a production mutation.');
    } else {
      checks = report.checks?.length || 0;
      require(report.pass === true && report.failures?.length === 0 && report.checks?.every(x => x.pass === true), 'Focused checks incomplete or failed.');
      require(report.productionUnchanged === true, 'Focused report detected a production mutation.');
      if (['finalcoarse-focused', 'sequence-safety-focused'].includes(suite.id)) require(report.candidateHash === expectedSource, 'Focused patch must be idempotent on the final integrated production source.');
      if (['rank-focused', 'sequence-safety-focused'].includes(suite.id)) require(report.scriptHash === scriptHash, 'Focused script hash mismatch.');
      if (suite.id === 'sequence-safety-focused') require(report.actualStepCalls === 0, 'Safety branch tests must not be counted as actual race steps.');
    }
  }
  require(checks >= suite.minimumChecks, 'Too few checks: ' + checks + ' < ' + suite.minimumChecks + '.');
  return { problems, checks, report: relative(filename), reportSha256: rawHash(fs.readFileSync(filename)), ...fields };
}

function writeProgress(report, directory) {
  fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify(report, null, 2) + '\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2)), initialBytes = fs.readFileSync(engineFile), initialSource = sourceHash(initialBytes);
  if (args.expectedSource && args.expectedSource !== initialSource) throw Error('Final source mismatch: expected ' + args.expectedSource + ', current ' + initialSource + '. No tests or archives started.');
  if (!args.run) {
    console.log(JSON.stringify({ mode: 'plan-only', sourceHash: initialSource, sourceBytesHash: rawHash(initialBytes), sequential: true, heapLimitMB: 192,
      command: 'node tests/final-engine-regressions-v11.js --run --expected-source ' + initialSource,
      suites, excludes: ['calibration or validation grids', 'exploratory CPU/partial replays', 'market 4800-run suite', '44-page browser matrix'],
      note: 'Preparation only; no suites executed and no output reports overwritten. Use the final frozen source hash, which may differ from this planning hash.' }, null, 2));
    return;
  }

  fs.mkdirSync(historyRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = fs.mkdtempSync(path.join(historyRoot, stamp + '-' + initialSource.slice(0, 12) + '-'));
  const files = inputFiles(), inputs = manifestFor(files);
  const report = { startedAt: new Date().toISOString(), expectedSourceHash: args.expectedSource, sourceHash: initialSource,
    sourceBytesHash: rawHash(initialBytes), wrapperHash: sourceHash(fs.readFileSync(__filename)),
    node: { executable: process.execPath, version: process.version, heapLimitMB: 192 },
    history: relative(directory), execution: 'sequential child processes',
    scope: 'Mechanism regressions only. Includes the small controlled replays already present in each listed suite; no new calibration grid or realism acceptance claim.',
    inputs, previousOutputs: [], syntax: null, suites: [], pass: false };
  for (const filename of files) archiveFile(filename, path.join(directory, 'inputs'));
  fs.writeFileSync(path.join(directory, 'source.js.gz'), zlib.gzipSync(initialBytes));
  for (const filename of [mainReport, mainMarkdown]) {
    const archived = archiveFile(filename, path.join(directory, 'previous-wrapper'));
    if (archived) report.previousOutputs.push(archived);
  }
  writeProgress(report, directory);
  const unchanged = () => rawHash(fs.readFileSync(engineFile)) === report.sourceBytesHash && JSON.stringify(manifestFor(files)) === JSON.stringify(inputs);
  report.syntax = await execute(['--check', engineFile], path.join(directory, 'syntax'));
  report.syntax.pass = report.syntax.exitCode === 0 && unchanged();
  writeProgress(report, directory);

  for (const suite of suites) {
    if (!report.syntax.pass || !unchanged()) {
      report.suites.push({ id: suite.id, status: 'not-run', pass: false, reason: 'Syntax failed or frozen inputs changed; dependent execution stopped.' });
      continue;
    }
    const entry = { id: suite.id, script: suite.script, scriptHash: sourceHash(fs.readFileSync(path.join(root, suite.script))),
      scope: suite.scope, previousOutputs: [], producedOutputs: [], status: 'running' };
    for (const output of suite.outputs) {
      const filename = path.join(root, output), archived = archiveFile(filename, path.join(directory, suite.id, 'previous'));
      if (archived) {
        entry.previousOutputs.push(archived);
        // Verified copy first; removing only these named generated outputs makes
        // a crashed child incapable of presenting an earlier report as fresh.
        fs.unlinkSync(filename);
      }
    }
    report.suites.push(entry); writeProgress(report, directory);
    console.log('\nFINAL SUITE ' + suite.id + ' / ' + initialSource);
    Object.assign(entry, await execute([suite.script], path.join(directory, suite.id)));
    entry.inputsUnchanged = unchanged();
    entry.evidence = evidenceFor(suite, initialSource, entry.scriptHash);
    if (!suite.outputs.length) {
      const stdout = fs.readFileSync(path.join(root, entry.stdout), 'utf8');
      const match = stdout.match(/(?:^|\n)(\d+) rider route planning tests passed; (\d+) failed\./);
      entry.evidence.checks = match ? Number(match[1]) : 0;
      if (!match || Number(match[2]) !== 0 || Number(match[1]) < suite.minimumChecks) entry.evidence.problems.push('Route stdout is incomplete or contains failures.');
      entry.evidence.kind = 'stdout-only; source and scripts guarded by wrapper';
    }
    for (const output of suite.outputs) {
      const archived = archiveFile(path.join(root, output), path.join(directory, suite.id, 'produced'));
      if (archived) entry.producedOutputs.push(archived);
      else entry.evidence.problems.push('Required generated artifact missing: ' + output);
      if (archived && /\.(?:source|candidate)\.js\.gz$/.test(output)) {
        try {
          const snapshotHash = sourceHash(zlib.gunzipSync(fs.readFileSync(path.join(root, output))));
          if (snapshotHash !== initialSource) entry.evidence.problems.push('Generated source/candidate snapshot differs from the frozen engine: ' + output);
        } catch (error) { entry.evidence.problems.push('Invalid source/candidate gzip: ' + output + ': ' + error.message); }
      }
      if (archived && /\.script\.js\.gz$/.test(output)) {
        try {
          if (sourceHash(zlib.gunzipSync(fs.readFileSync(path.join(root, output)))) !== entry.scriptHash) entry.evidence.problems.push('Generated script snapshot hash mismatch: ' + output);
        } catch (error) { entry.evidence.problems.push('Invalid script gzip: ' + output + ': ' + error.message); }
      }
    }
    entry.pass = entry.exitCode === 0 && !entry.signal && !entry.spawnError && entry.inputsUnchanged && entry.evidence.problems.length === 0;
    entry.status = entry.pass ? 'passed' : 'failed';
    writeProgress(report, directory);
    // Ordinary assertion failures do not hide later independent results.
  }
  report.finishedAt = new Date().toISOString();
  report.productionEndHash = sourceHash(fs.readFileSync(engineFile));
  report.inputsUnchanged = unchanged();
  report.pass = report.syntax.pass && report.inputsUnchanged && report.suites.length === suites.length && report.suites.every(s => s.pass);
  writeProgress(report, directory);
  fs.writeFileSync(mainReport, JSON.stringify(report, null, 2) + '\n');
  const md = ['# v11 最终引擎机制回归', '', '执行源：`' + initialSource + '`。结果：**' + (report.pass ? 'PASS' : 'FAIL') + '**。', '',
    '所有入口按顺序执行；每项旧报告先验证归档，新报告和日志再保存至同一运行目录。失败、缺失报告和源码变化均保留，不能用旧结果补齐。', '',
    '|入口|结果|检查数|墙钟秒|', '|---|---|---:|---:|',
    ...report.suites.map(s => '|' + s.id + '|' + s.status + '|' + (s.evidence?.checks ?? '—') + '|' + (s.wallSeconds?.toFixed(3) ?? '—') + '|'), '',
    '此表验证预测、路线、规划和公开信息使用的机制。这里的小场控制回放、粗筛 stub 和微基准不构成赛场群体数值验收；最终群体测试另行记录。', '',
    '[完整结果](final-engine-regressions-v11.json) · [本次归档](' + relative(directory).replace(/^docs\//, '') + '/run.json)', '',
    '复现：`node tests/final-engine-regressions-v11.js --run --expected-source ' + initialSource + '`。', ''];
  fs.writeFileSync(mainMarkdown, md.join('\n'));
  console.log(JSON.stringify({ pass: report.pass, sourceHash: initialSource, productionEndHash: report.productionEndHash, inputsUnchanged: report.inputsUnchanged,
    history: report.history, suites: report.suites.map(s => ({ id: s.id, status: s.status, checks: s.evidence?.checks, problems: s.evidence?.problems })) }, null, 2));
  if (!report.pass) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
