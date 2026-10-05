'use strict';
const assert=require('node:assert/strict');
function applyPeerPairCpuPatch(source){
  source=source.replace(/\r\n/g,'\n');
  const before='          for(let a=0;a<traffic.length;a++)for(let b=a+1;b<traffic.length;b++)if(projectionBodySweep(traffic[a].h,traffic[b].h,traffic[a].before,traffic[b].before,traffic[a].move,traffic[b].move))opponentPathConflict=true;';
  const after=`          if(!opponentPathConflict) {
            peerCollision:for(let a=0;a<traffic.length;a++)for(let b=a+1;b<traffic.length;b++) {
              if(projectionBodySweep(traffic[a].h,traffic[b].h,traffic[a].before,traffic[b].before,traffic[a].move,traffic[b].move)) {
                opponentPathConflict=true;break peerCollision;
              }
            }
          }`;
  assert.equal(source.split(before).length-1,1,'Unique peer pair diagnostic loop');
  return source.replace(before,after);
}
function applyLazyFollowingFactoryPatch(source){
  source=source.replace(/\r\n/g,'\n');
  const before='        const followingSlack=followingConstraintSolver(Math.max(freeV,...traffic.map(x=>x.move.v)));';
  const condition='          if(!transverse||followingSlack(H,F,move,fm)>=-1e-8)continue;';
  assert.equal(source.split(before).length-1,1,'Unique projection following factory');
  assert.equal(source.split(condition).length-1,1,'Unique projection transverse headway condition');
  source=source.replace(before,'        let followingSlack=null;');
  return source.replace(condition,`          if(!transverse)continue;
          followingSlack??=followingConstraintSolver(Math.max(freeV,...traffic.map(x=>x.move.v)));
          if(followingSlack(H,F,move,fm)>=-1e-8)continue;`);
}
function applyTrafficCpuPatch(source){return applyLazyFollowingFactoryPatch(applyPeerPairCpuPatch(source));}
module.exports={applyPeerPairCpuPatch,applyLazyFollowingFactoryPatch,applyTrafficCpuPatch};
