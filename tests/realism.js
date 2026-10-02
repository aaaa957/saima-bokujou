#!/usr/bin/env node
'use strict';

/* Compatibility entry point for the realism report. The acceptance logic lives
 * in race-calibration-v7.js so this command cannot silently use older rules.
 * Pre-race styles and real-world fourth-turn-position categories measure
 * different things. Neither equal style quotas nor distance-monotonic style
 * win rates are acceptance requirements.
 *
 * node tests/realism.js [races per distance] [legacy drama count]
 * Every distance and direction receives mixed-field and controlled-field runs.
 */
const { runValidation, printReport } = require('./race-calibration-v7.js');
const racesPerDistance = Math.max(1, Number(process.argv[2]) || 96);
const perCell = Math.max(1, Math.ceil(racesPerDistance / 48));
const report = runValidation({ perCell });
printReport(report);
console.log('Historical fourth-turn-position tables are descriptive context only;');
console.log('they are not causal targets for the pre-race strategy column above.');
if (process.argv[3]) console.log('The legacy drama count no longer creates a separate 2000 m sample.');
process.exitCode = report.passed ? 0 : 1;
