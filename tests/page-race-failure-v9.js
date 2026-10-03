#!/usr/bin/env node
'use strict';
// Actual browser regression. NODE_PATH may point at the desktop's bundled
// packages; this test does not install dependencies or write game files.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..'),engine=path.join(ROOT,'sim.js');
const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(engine,'utf8').replace(/\r\n/g,'\n')).digest('hex');
const beforeHash=hash();
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext(),page=await context.newPage(),pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.addInitScript(()=>{
    // Hold native RAFs so the production callback can be driven deterministically.
    window.__requestedFrames=[];window.__canceledFrames=[];
    window.requestAnimationFrame=callback=>{const id=window.__requestedFrames.length+1;window.__requestedFrames.push({id,callback});return id;};
    window.cancelAnimationFrame=id=>window.__canceledFrames.push(id);
  });
  let passed=0;
  const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
  try{
    await page.goto('file:///'+path.join(ROOT,'index.html').replace(/\\/g,'/')+'#single');
    await check('production RAF reports an actual engine failure and preserves the single-race ticket',async()=>{
      const result=await page.evaluate(()=>{
        startRace();bankroll=45;bet={horseId:field[0].id,amount:5,target:'single',odds:2};
        const before=JSON.stringify({bankroll,bet}),[a,b]=race.race.horses;
        for(const h of [a,b]){h.s=100;h.t=3;h.v=18;}
        lastTs=1000;const scheduled=rafId;loop(1040);
        const frames=window.__requestedFrames.length;loop(1080);skipRace();
        // A failure must remain un-settleable even if an external caller marks it finished.
        race.race.finished=true;showResult();renderResult();
        return {sameTicket:before===JSON.stringify({bankroll,bet}),paused,rafId,frames,
          afterFrames:window.__requestedFrames.length,canceled:window.__canceledFrames.includes(scheduled),state,
          message:document.getElementById('raceFailureMessage').textContent,
          visible:document.getElementById('raceFailure').style.display,
          controlsDisabled:document.getElementById('btnPause').disabled&&document.getElementById('btnSkip').disabled,
          preservedDiagnostic:lastRaceFailure.diagnostic===race.race.traffic.lastInfeasible,
          infeasible:race.race.traffic.infeasibleSteps,velocities:[a.v,b.v]};
      });
      assert.equal(result.sameTicket,true);assert.equal(result.paused,true);assert.equal(result.rafId,0);
      assert.equal(result.frames,result.afterFrames);assert.equal(result.canceled,true);assert.equal(result.state,'race');
      assert.match(result.message,/步前身体已重叠/);assert.equal(result.visible,'block');assert.equal(result.controlsDisabled,true);
      assert.equal(result.preservedDiagnostic,true);assert.equal(result.infeasible,1);assert.deepEqual(result.velocities,[18,18]);
      await assert.doesNotReject(()=>page.locator('#raceFailure').waitFor({state:'visible'}));
    });
    await check('return and recreate resume a healthy race while retaining the previous diagnosis',async()=>{
      await page.locator('#btnRaceFailureBack').click();
      const result=await page.evaluate(()=>{
        const diagnosis=lastRaceFailure,oldRace=diagnosis.race,before=JSON.stringify({bankroll,bet});
        startRace();lastTs=2000;loop(2040);
        return {state,failed:raceHasFailed(),newRace:race.race!==oldRace,time:race.race.t,paused,rafId,
          visible:document.getElementById('raceFailure').style.display,
          enabled:!document.getElementById('btnPause').disabled&&!document.getElementById('btnSkip').disabled,
          sameTicket:before===JSON.stringify({bankroll,bet}),sameDiagnosis:lastRaceFailure===diagnosis};
      });
      assert.equal(result.state,'race');assert.equal(result.failed,false);assert.equal(result.newRace,true);
      assert(result.time>0);assert.equal(result.paused,false);assert(result.rafId>0);assert.equal(result.visible,'none');
      assert.equal(result.enabled,true);assert.equal(result.sameTicket,true);assert.equal(result.sameDiagnosis,true);
    });
    await check('skip-to-result catches a solver failure without settling',async()=>{
      const result=await page.evaluate(()=>{
        const before=JSON.stringify({bankroll,bet}),[a,b]=race.race.horses;
        for(const h of [a,b]){h.s=100;h.t=3;h.v=18;}
        skipRace();return {sameTicket:before===JSON.stringify({bankroll,bet}),failed:raceHasFailed(),state,rafId,
          visible:document.getElementById('raceFailure').style.display};
      });
      assert.equal(result.sameTicket,true);assert.equal(result.failed,true);assert.equal(result.state,'race');
      assert.equal(result.rafId,0);assert.equal(result.visible,'block');
    });
    await check('constructor errors show a failure notice and a later healthy creation clears it',async()=>{
      const result=await page.evaluate(()=>{
        const original=S.createRace,before=JSON.stringify({bankroll,bet});
        // A genuinely completed prior race remains selectable before the new constructor fails.
        const completed=original([field[0]],{length:200,course:'标准',profile:'平坦',rng:S.mulberry32(731)});
        let guard=0;while(!completed.race.finished&&guard++<10000)completed.step(1/30);
        if(!completed.race.finished||completed.race.order.length!==1)throw new Error('Previous-race fixture did not finish');
        race=completed;window.__previousCompletedRace=completed;
        try{S.createRace=()=>{throw new Error('构造测试：闸位无效');};startRace();}
        finally{S.createRace=original;}
        skipRace();showResult();renderResult();
        const failed={message:document.getElementById('raceFailureMessage').textContent,
          visible:document.getElementById('raceFailure').style.display,rafId,
          previousComplete:completed.race.finished,currentCleared:race===null,
          sameTicket:before===JSON.stringify({bankroll,bet})};
        startRace();return {failed,healthy:!raceHasFailed(),visible:document.getElementById('raceFailure').style.display,rafId};
      });
      assert.match(result.failed.message,/闸位无效/);assert.equal(result.failed.visible,'block');assert.equal(result.failed.rafId,0);
      assert.equal(result.failed.previousComplete,true);assert.equal(result.failed.currentCleared,true);
      assert.equal(result.failed.sameTicket,true);assert.equal(result.healthy,true);assert.equal(result.visible,'none');assert(result.rafId>0);
    });
    await check('career failure keeps sealed pending bets, saved progress and diagnostic; no results are applied',async()=>{
      const result=await page.evaluate(()=>{
        switchMode('career');const card=career.aiRaces.find(x=>x.field.length>=2);
        career.weekBets[card.id]={type:'単勝',ids:[card.field[0].id],amount:5,odds:2};
        watchAiRace(card);const before=JSON.stringify({bankroll,bets:career.weekBets,stats:career.stats,roster:career.roster});
        const [a,b]=race.race.horses;for(const h of [a,b]){h.s=100;h.t=3;h.v=18;}
        lastTs=3000;loop(3040);race.race.finished=true;
        const completion=completeCareerRace(card,race.race);showResult();renderResult();
        const same=before===JSON.stringify({bankroll,bets:career.weekBets,stats:career.stats,roster:career.roster});
        returnFromRaceFailure();const saved=window.SaimaCareerSave.load(localStorage);
        return {completion,same,state,watchInfo:career.watchInfo,pending:!!career.weekBets[card.id],
          started:career.startedIds[card.id],watched:!!career.watchedIds[card.id],settled:!!career.settledIds[card.id],
          savedValid:saved.ok,savedPending:!!saved.snapshot.career.weekBets[card.id],
          savedStarted:saved.snapshot.career.startedIds[card.id],savedSettled:!!saved.snapshot.career.settledIds[card.id]};
      });
      assert.equal(result.completion,null);assert.equal(result.same,true);assert.equal(result.state,'career');assert.equal(result.watchInfo,null);
      assert.equal(result.pending,true);assert.equal(result.started,true);assert.equal(result.watched,false);assert.equal(result.settled,false);
      assert.equal(result.savedValid,true);assert.equal(result.savedPending,true);assert.equal(result.savedStarted,true);assert.equal(result.savedSettled,false);
    });
    await check('automatic career simulation errors do not advance the week or settle the failed race',async()=>{
      const result=await page.evaluate(()=>{
        const card=career.aiRaces.find(x=>career.weekBets[x.id]),original=S.createRace;
        career.aiRaces=[card];const before=JSON.stringify({week:career.weekNum,bankroll,bets:career.weekBets,stats:career.stats,roster:career.roster});
        try{S.createRace=(...args)=>{const sim=original(...args);sim.step=()=>{throw new Error('自动模拟测试失败');};return sim;};advanceWeek();}
        finally{S.createRace=original;}
        return {same:before===JSON.stringify({week:career.weekNum,bankroll,bets:career.weekBets,stats:career.stats,roster:career.roster}),
          settled:!!career.settledIds[card.id],message:document.getElementById('raceFailureMessage').textContent,rafId};
      });
      assert.equal(result.same,true);assert.equal(result.settled,false);assert.match(result.message,/自动模拟测试失败/);assert.equal(result.rafId,0);
    });
    await check('career constructor failure cannot expose a previously completed race for settlement',async()=>{
      const result=await page.evaluate(()=>{
        const original=S.createRace,card=career.aiRaces[0],before=JSON.stringify({bankroll,bets:career.weekBets,stats:career.stats,roster:career.roster});
        race=window.__previousCompletedRace;
        try{S.createRace=()=>{throw new Error('生涯构造测试失败');};watchAiRace(card);}
        finally{S.createRace=original;}
        skipRace();showResult();renderResult();
        return {currentCleared:race===null,same:before===JSON.stringify({bankroll,bets:career.weekBets,stats:career.stats,roster:career.roster}),
          pending:!!career.weekBets[card.id],started:career.startedIds[card.id],settled:!!career.settledIds[card.id],
          message:document.getElementById('raceFailureMessage').textContent,rafId};
      });
      assert.equal(result.currentCleared,true);assert.equal(result.same,true);assert.equal(result.pending,true);
      assert.equal(result.started,true);assert.equal(result.settled,false);assert.match(result.message,/生涯构造测试失败/);assert.equal(result.rafId,0);
    });
    await check('retrying a partially completed week does not settle or pay the first race twice',async()=>{
      const result=await page.evaluate(()=>{
        const original=S.createRace,first=career.aiRaces[0],second={...first,id:first.id+'-failure'};
        career.aiRaces=[first,second];bankroll=42;
        career.weekBets[first.id]={type:'単勝',ids:[first.field[0].id],amount:5,odds:2};
        career.weekBets[second.id]={type:'単勝',ids:[second.field[0].id],amount:3,odds:2};
        let calls=0;
        // This is a business-state fixture: a completed first result, then a solver failure.
        try{S.createRace=(...args)=>{
          calls++;const sim=original(...args);
          sim.step=()=>{
            if(calls>1)throw new Error('第二场模拟测试失败');
            sim.race.order=sim.race.horses.slice();sim.race.order.forEach((h,i)=>{h.place=i+1;h.time=90+i;});
            sim.race.finished=true;sim.race.winnerTime=90;
          };return sim;
        };
          advanceWeek();const firstSummary=career.settledIds[first.id],afterFirst=JSON.stringify({bankroll,bets:career.weekBets,stats:career.stats,roster:career.roster});
          const firstCalls=calls;advanceWeek();
          return {firstCalls,totalCalls:calls,firstSettled:!!firstSummary,sameSummary:career.settledIds[first.id]===firstSummary,
            unchangedOnRetry:afterFirst===JSON.stringify({bankroll,bets:career.weekBets,stats:career.stats,roster:career.roster}),
            firstPending:!!career.weekBets[first.id],secondPending:!!career.weekBets[second.id],secondSettled:!!career.settledIds[second.id],bankroll};
        }finally{S.createRace=original;}
      });
      assert.equal(result.firstCalls,2);assert.equal(result.totalCalls,3);assert.equal(result.firstSettled,true);assert.equal(result.sameSummary,true);
      assert.equal(result.unchangedOnRetry,true);assert.equal(result.firstPending,false);assert.equal(result.secondPending,true);assert.equal(result.secondSettled,false);
      assert.equal(result.bankroll,52);
    });
    await check('autotest reports failure, stops the active RAF and never claims success',async()=>{
      const result=await page.evaluate(()=>{
        const original=S.createRace;let calls=0;
        race=window.__previousCompletedRace;
        const before=JSON.stringify({bankroll,bet});
        try{S.createRace=(...args)=>{calls++;const sim=original(...args);sim.step=()=>{throw new Error('自检求解测试失败');};return sim;};runAutotest();}
        finally{S.createRace=original;}
        skipRace();showResult();renderResult();
        return {calls,text:document.getElementById('autotest').textContent,
          visible:document.getElementById('autotest').style.display,notice:document.getElementById('raceFailureMessage').textContent,
          rafId,failedLocal:raceFailures.has(lastRaceFailure.race),currentCleared:race===null,sameTicket:before===JSON.stringify({bankroll,bet})};
      });
      assert.equal(result.calls,1);assert.match(result.text,/❌ 自检失败.*自检求解测试失败/);assert.doesNotMatch(result.text,/✅/);
      assert.equal(result.visible,'block');assert.match(result.notice,/自检求解测试失败/);assert.equal(result.rafId,0);assert.equal(result.failedLocal,true);
      assert.equal(result.currentCleared,true);assert.equal(result.sameTicket,true);
    });
    await check('autotest rejects an incomplete field instead of showing a green pass',async()=>{
      const result=await page.evaluate(()=>{
        const original=S.createRace;
        try{S.createRace=(...args)=>{const sim=original(...args);sim.step=()=>{sim.race.finished=true;};return sim;};runAutotest();}
        finally{S.createRace=original;}
        return {text:document.getElementById('autotest').textContent,rafId};
      });
      assert.match(result.text,/❌ 自检失败.*未全部完赛/);assert.doesNotMatch(result.text,/✅/);assert.equal(result.rafId,0);
    });
    assert.deepEqual(pageErrors,[],'A solver failure escaped to the browser as an unhandled page error');
    assert.equal(hash(),beforeHash,'Production engine changed during page regression');
    console.log(JSON.stringify({passed,failed:0,engineHash:beforeHash,engineUnchanged:true,gameFilesWritten:false,
      unhandledPageErrors:pageErrors.length,browser:'Edge',scope:'real page callbacks and isolated localStorage; solver failures are injected, no population fit claim'}));
  }finally{await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
