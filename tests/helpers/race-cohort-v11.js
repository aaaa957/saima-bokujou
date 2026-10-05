'use strict';
// New-generation diagnostics explicitly freeze latent profiles BEFORE editing
// abilities; historical v9 fieldFor and all of its archived inputs stay intact.
function fieldFor(job,S){
  if(!S||typeof S.makeField!=='function'||typeof S.horsePhysiology!=='function')throw new Error('v11 cohort engine APIs required');
  const entryOverrides={surface:'草地',special:'左右皆可'};
  if(job.external||job.context!=='native-official')Object.assign(entryOverrides,{'疲劳':0,'斗志':50,jockeyGrade:job.external?'优秀':'普通',bodyMass:480,carriedWeight:job.weight??57});
  const race={length:job.length,course:job.course,dir:job.dir,surface:'草地',state:job.state||'良',profile:'平坦',wind:0};
  const field=S.makeField(S.mulberry32(job.seed),{n:job.n,level:job.level??(job.external?86:70),tierKey:job.tierKey,playerIndex:-1,race,entryOverrides});
  const snapshots=field.map(h=>({...S.horsePhysiology(h)}));
  if(job.context==='equal-ability-flat')for(const h of field)for(const key of Object.keys(h.stats))h.stats[key]=70;
  if(job.neutral)for(const h of field)h.physiology=S.neutralPhysiology();
  // Equal-ability and latent-neutral arms change the SAME already selected
  // identities as the original cohort; they never resample the candidate pool.
  Object.defineProperty(field,'generationProtocol',{value:{version:'race-cohort-v11',selection:field.cohort,
    entryOverrides,physiologyBeforeAbilityIntervention:snapshots,
    abilityIntervention:job.context==='equal-ability-flat'?'all70-after-selection':'none',
    physiologyIntervention:job.neutral?'neutral-after-selection':'none'},enumerable:false});
  return field;
}
module.exports={fieldFor};
