'use strict';
const assert=require('node:assert/strict');
function replaceOnce(source,a,b,label){assert.equal(source.split(a).length-1,1,label);return source.replace(a,b);}
function applyFollowingWitnessCpuPatch(source){
  source=source.replace(/\r\n/g,'\n');
  source=replaceOnce(source,'        const certificates=[];','        const certificates=[];let intervalNegativeWitness=null;','Certificates anchor');
  source=replaceOnce(source,'        function certifyInterval(left,right,depth) {',`        function certifyInterval(left,right,depth) {
          if(withResponse&&intervalNegativeWitness!==null)return false;`,'Certify interval anchor');
  source=replaceOnce(source,'          if(depth>=6)return false;\n          const middle=(left+right)/2;',`          // An exact negative sample only rejects; it never certifies safety.
          // Skip repeated interval bounds once rejection is already proven.
          const middle=(left+right)/2;
          if(withResponse) {
            const witness=gapAt(middle)-response;
            if(witness<-1e-7){intervalNegativeWitness=witness;return false;}
          }
          if(depth>=6)return false;`,'Exact sample rejection');
  source=replaceOnce(source,'        const fullyCertified=certifyInterval(0,brakingSteps*brakingInterval,0);',
    '        const fullyCertified=certifyInterval(0,brakingSteps*brakingInterval,0);\n        if(withResponse&&intervalNegativeWitness!==null)return intervalNegativeWitness;','Return uncached negative witness');
  return source;
}
module.exports={applyFollowingWitnessCpuPatch};
