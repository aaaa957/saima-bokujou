'use strict';
const assert = require('node:assert/strict');
const marker = 'const sequenceBeforeSafety=H.riderSequence';
const commitLine = '        H.statsSummary.committedSequences=(H.statsSummary.committedSequences||0)+1;\n';
const sequenceAnchor = '          goal:chosen.goal};\n        applyRiderSequence(H);';
const oldLabels = `      if(attacking&&!H.attacking) {
        H.statsSummary.launches=(H.statsSummary.launches||0)+1;
        if(H.sprintAt===null){H.sprintAt=H.s;H.statsSummary.sprintAt=H.s;}
        event(H.name+' 开始发力！');
      } else if(!attacking&&H.attacking) {
        H.statsSummary.withdrawals=(H.statsSummary.withdrawals||0)+1;event(H.name+' 收力重新调整节奏');
      }
      H.attacking=attacking;
`;
const oldTail = `      setAction(H,attacking?(sr>0.15?'打鞭':'推骑'):H.targetV>H.v+0.15?'推骑':'收力');
      if(!viable.length||(localFront&&localFront.s-H.s<4+Math.max(0,H.targetV-localFront.v)*3&&H.targetV>localFront.v+0.3)) {
        if(!avoidBlock(H,openGap)){mode='wait';reason='预测通道未开放，保留制动距离等待';}
      }
      recordDecision(H,list,mode,reason,reserveEstimate,observedPace);`;
const newTail = `      const sequenceBeforeSafety=H.riderSequence,beforeSafety={targetV:H.targetV,targetT:H.targetT},reasonBeforeSafety=reason;
      setAction(H,attacking?(sr>0.15?'打鞭':'推骑'):H.targetV>H.v+0.15?'推骑':'收力');
      if(!viable.length||(localFront&&localFront.s-H.s<4+Math.max(0,H.targetV-localFront.v)*3&&H.targetV>localFront.v+0.3)) {
        if(!avoidBlock(H,openGap)){mode='wait';reason='预测通道未开放，保留制动距离等待';}
      }
      const speedChanged=H.targetV!==beforeSafety.targetV,laneChanged=H.targetT!==beforeSafety.targetT;
      H.planning.selectedCandidate=chosen.mode;
      H.planning.actualControls={targetV:H.targetV,targetT:H.targetT};
      if(speedChanged||laneChanged) {
        // The safety command has no forecast for the selected action tuple.
        // Preserve that immediate command and distinguish it from its candidate.
        H.statsSummary.safetyOverrides=(H.statsSummary.safetyOverrides||0)+1;
        if(sequenceBeforeSafety) {
          H.riderSequence=null;
          H.statsSummary.safetyOverriddenSequences=(H.statsSummary.safetyOverriddenSequences||0)+1;
          if(sequenceBeforeSafety.mode==='follow'&&H.followOpportunity) {
            H.followOpportunity.accepted=false;
            H.followOpportunity.rejectedReason='safety-override';
            const reasons=H.statsSummary.followRejectedReasons||(H.statsSummary.followRejectedReasons={});
            reasons['safety-override']=(reasons['safety-override']||0)+1;
          }
        }
        mode=laneChanged?'route':'wait';
        reason=sequenceBeforeSafety?'按实测近马避让调整实际指令，取消尚未执行的动作序列':'按实测近马避让调整实际指令';
        H.planning.selectedCandidateScore=H.planning.selectedScore;
        H.planning.selectedScore=null;
        H.planning.selected=mode;
        H.planning.sequenceCommitted=false;
        H.planning.safetyOverride={candidateMode:chosen.mode,before:beforeSafety,
          actual:{targetV:H.targetV,targetT:H.targetT},speedChanged,laneChanged};
      } else {
        // Merely repeating a safe assignment does not change the action tuple.
        if(sequenceBeforeSafety) {
          mode=sequenceBeforeSafety.mode;reason=reasonBeforeSafety;
          H.statsSummary.committedSequences=(H.statsSummary.committedSequences||0)+1;
          H.planning.sequenceCommitted=true;
        } else if(mode!==chosen.mode) {
          // No viable plan may require waiting without a numerical tuple change.
          H.planning.selectedCandidateScore=H.planning.selectedScore;
          H.planning.selectedScore=null;
          H.planning.fallbackReason=reason;
        }
        H.planning.selected=mode;
      }
      // Bookkeep labels after safety chooses the actual instruction, once only.
      const finalAttacking=mode==='attack';
      if(finalAttacking&&!H.attacking) {
        H.statsSummary.launches=(H.statsSummary.launches||0)+1;
        if(H.sprintAt===null){H.sprintAt=H.s;H.statsSummary.sprintAt=H.s;}
        event(H.name+' 开始发力！');
      } else if(!finalAttacking&&H.attacking) {
        H.statsSummary.withdrawals=(H.statsSummary.withdrawals||0)+1;event(H.name+' 收力重新调整节奏');
      }
      H.attacking=finalAttacking;
      recordDecision(H,list,mode,reason,reserveEstimate,observedPace);
      if(H.planning.safetyOverride||H.planning.fallbackReason) {
        const detail={selectedCandidate:H.planning.selectedCandidate,targetT:H.targetT,
          ...(H.planning.safetyOverride?{safetyOverride:H.planning.safetyOverride}:{}),
          ...(H.planning.fallbackReason?{fallbackReason:H.planning.fallbackReason}:{})};
        Object.assign(H.strategy,detail);
        Object.assign(H.strategyHistory[H.strategyHistory.length-1],detail);
      }`;
function applySequenceSafetyOverridePatch(source) {
  if (source.includes(marker)) {
    // Upgrade the first expanded pre-release tail; physics and controls stay
    // untouched, while a no-viable-plan wait label survives an unchanged tuple.
    source=source.replace(`      } else {
        // Merely repeating a safe assignment does not change the action tuple.
        mode=chosen.mode;reason=reasonBeforeSafety;
        if(sequenceBeforeSafety) {
          H.statsSummary.committedSequences=(H.statsSummary.committedSequences||0)+1;
          H.planning.sequenceCommitted=true;
        }
      }`, `      } else {
        // Merely repeating a safe assignment does not change the action tuple.
        if(sequenceBeforeSafety) {
          mode=sequenceBeforeSafety.mode;reason=reasonBeforeSafety;
          H.statsSummary.committedSequences=(H.statsSummary.committedSequences||0)+1;
          H.planning.sequenceCommitted=true;
        } else if(mode!==chosen.mode) {
          // No viable plan may require waiting without a numerical tuple change.
          H.planning.selectedCandidateScore=H.planning.selectedScore;
          H.planning.selectedScore=null;
          H.planning.fallbackReason=reason;
        }
        H.planning.selected=mode;
      }`);
    source=source.replace(`      if(H.planning.safetyOverride) {
        const detail={selectedCandidate:H.planning.selectedCandidate,targetT:H.targetT,safetyOverride:H.planning.safetyOverride};`, `      if(H.planning.safetyOverride||H.planning.fallbackReason) {
        const detail={selectedCandidate:H.planning.selectedCandidate,targetT:H.targetT,
          ...(H.planning.safetyOverride?{safetyOverride:H.planning.safetyOverride}:{}),
          ...(H.planning.fallbackReason?{fallbackReason:H.planning.fallbackReason}:{})};`);
    assert.equal(source.split(marker).length - 1, 1);
    assert(source.includes("H.followOpportunity.rejectedReason='safety-override'"));
    assert(source.includes("const finalAttacking=mode==='attack'"), 'Integrated safety patch must include final label bookkeeping.');
    assert(source.includes(newTail), 'Integrated safety tail must match the current mechanism fixture.');
    return source;
  }
  assert.equal(source.split(commitLine).length - 1, 1);
  assert.equal(source.split(oldLabels).length - 1, 1);
  assert.equal(source.split(oldTail).length - 1, 1);
  return source.replace(commitLine, '').replace(oldLabels, '').replace(oldTail, newTail);
}
// Only tests use this fault reference: same current parameters/version/physics,
// with the former controller tail restored. It is never a production write.
function restoreSequenceSafetyOverrideBaseline(source) {
  if (!source.includes(marker)) return source;
  source=applySequenceSafetyOverridePatch(source);
  assert.equal(source.split(newTail).length - 1, 1);
  assert.equal(source.split(sequenceAnchor).length - 1, 1);
  const labelsAnchor = "      const attacking=mode==='attack',sr=H.stamina/Math.max(1,H.staminaMax);\n";
  assert.equal(source.split(labelsAnchor).length - 1, 1);
  return source.replace(newTail, oldTail)
    .replace(sequenceAnchor, '          goal:chosen.goal};\n' + commitLine + '        applyRiderSequence(H);')
    .replace(labelsAnchor, labelsAnchor + oldLabels);
}
module.exports = { applySequenceSafetyOverridePatch, restoreSequenceSafetyOverrideBaseline };
