'use strict';
const assert = require('node:assert/strict');

// Construct an energy-sufficient but terminal-release-limited reserve state.
// The caller keeps its route, requested speed, oxygen and physiology unchanged.
// This derives a test input, not an engine correction or a feasibility margin.
function terminalReleaseFixture(S, H, requestedV) {
  H.stamina = H.staminaMax;
  const full = H.finishPlan(requestedV, 0, { trace: true });
  assert(full.feasible && full.finished, 'Full-reserve reference must sustain the requested final route.');
  const end = full.trace.at(-1);
  const requiredExcess = end ? Math.max(0, end.work - end.supply) : 0;
  assert(full.required > 0 && requiredExcess > 0, 'Final-route fixture must require reserve energy and terminal reserve power.');
  // Below reserveFade, remaining reserve releases proportionally. Leave half
  // the reserve that would supply the reference endpoint's excess power, after
  // adding the full-reserve route's entire energy demand.
  const terminalReleaseThreshold = requiredExcess / H.reservePower * H.staminaMax * S.RACE_F.reserveFade;
  const margin = terminalReleaseThreshold / 2;
  const reserve = full.required + margin;
  assert(Number.isFinite(reserve) && reserve < H.staminaMax, 'Constructed reserve must be finite and fit the actual capacity.');
  H.stamina = reserve;
  return { requestedV, need: full.required, requiredExcess, terminalReleaseThreshold, margin, reserve,
    capacity: H.staminaMax, reservePower: H.reservePower, reserveFade: S.RACE_F.reserveFade,
    fullReference: { seconds: full.seconds, required: full.required, peakPowerShortfall: full.peakPowerShortfall,
      endpoint: full.endpoint, terminalWork: end.work, terminalAerobicSupply: end.supply } };
}

module.exports = { terminalReleaseFixture };
