'use strict';
const assert=require('node:assert/strict');
const oldSearch=`      const stations=step;let lo=0,hi=stations.length-1;
      while(hi-lo>1){const mid=(lo+hi)>>1;if(stations[mid]<=at)lo=mid;else hi=mid;}`;
const newSearch=`      const stations=step,lo=routeStationLowerIndex(stations,at),hi=stations.length>1?lo+1:stations.length-1;`;
const helper=`  // Exact bracket lookup on the same immutable route stations. The metre bin
  // supplies only a search seed; the original <= comparisons locate the exact
  // cell. No query coordinate, interpolation, or floating expression is rounded.
  const ROUTE_STATION_LOOKUP_CACHE=new WeakMap();
  function routeStationLowerIndex(stations,at) {
    const last=stations.length-1,first=stations[0],end=stations[last];
    if(!Number.isFinite(at)||last<1||!Number.isFinite(first)||!Number.isFinite(end)||at<first||at>=end) {
      let lo=0,hi=last;
      while(hi-lo>1){const mid=(lo+hi)>>1;if(stations[mid]<=at)lo=mid;else hi=mid;}
      return lo;
    }
    let lookup=ROUTE_STATION_LOOKUP_CACHE.get(stations);
    if(!lookup) {
      const bins=new Uint32Array(Math.ceil(end-first));let lo=0;
      for(let bin=0;bin<bins.length;bin++) {
        const seed=first+bin;
        while(lo<last-1&&stations[lo+1]<=seed)lo++;
        bins[bin]=lo;
      }
      lookup={first,bins};ROUTE_STATION_LOOKUP_CACHE.set(stations,lookup);
    }
    let lo=lookup.bins[Math.min(lookup.bins.length-1,Math.floor(at-lookup.first))];
    while(lo>0&&stations[lo]>at)lo--;
    while(lo<last-1&&stations[lo+1]<=at)lo++;
    return lo;
  }
`;
function applyRouteStationLookupPatch(source){
  source=source.replace(/\r\n/g,'\n');
  if(source.includes('  const ROUTE_STATION_LOOKUP_CACHE=new WeakMap();')){
    assert(source.includes(newSearch));assert(source.includes(helper));return source;
  }
  assert.equal(source.split(oldSearch).length-1,1,'Original route-table search anchor');
  assert.equal(source.split('  function routeTablePoint(samples,step,at) {').length-1,1,'Route-table function anchor');
  return source.replace('  function routeTablePoint(samples,step,at) {',helper+'  function routeTablePoint(samples,step,at) {').replace(oldSearch,newSearch);
}
function restoreRouteStationLookupBaseline(source){
  source=source.replace(/\r\n/g,'\n');assert(source.includes(helper)&&source.includes(newSearch));return source.replace(helper,'').replace(newSearch,oldSearch);
}
module.exports={applyRouteStationLookupPatch,restoreRouteStationLookupBaseline};
