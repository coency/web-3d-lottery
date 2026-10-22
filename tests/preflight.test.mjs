import test from 'node:test';
import assert from 'node:assert/strict';
import {stageChecks,stageCheckSummary} from '../apps/web/stage/preflight.js';
const healthy={connected:true,authLost:false,fence:'7',controlBusy:false,themeReady:true,themeError:'',peopleLoaded:true,portraits:{total:2000,cached:2000,decoded:512,failed:0,pending:0,storageAvailable:true}};

test('summary separates preparation from actionable errors without repeating avatar counts',()=>{
 assert.equal(stageCheckSummary(stageChecks(healthy)).label,'已就绪');
 const loading={...healthy,portraits:{...healthy.portraits,cached:318,pending:1682}};
 assert.deepEqual(stageCheckSummary(stageChecks(loading)),{ready:false,label:'准备中',reason:''});
 const offline=stageCheckSummary(stageChecks({...loading,connected:false}));
 assert.equal(offline.label,'需处理');assert.match(offline.reason,/服务器连接/);assert.doesNotMatch(offline.reason,/318|2000/);
 assert.equal(stageCheckSummary(stageChecks({...healthy,themeReady:false})).label,'准备中');
 assert.equal(stageCheckSummary(stageChecks({...loading,portraits:{...loading.portraits,failed:1}})).label,'需处理');
 assert.equal(stageCheckSummary(stageChecks({...healthy,portraits:{...healthy.portraits,storageAvailable:false}})).label,'需处理');
});
test('preflight treats bounded decoded memory as normal, but incomplete disk cache is not ready',()=>{
 assert.ok(stageChecks(healthy).every(r=>r.ok));
 const partial=stageChecks({...healthy,portraits:{...healthy.portraits,cached:1500,pending:500}}).at(-1);
 assert.equal(partial.ok,false);assert.match(partial.text,/1500 \/ 2000/);
 const volatile=stageChecks({...healthy,portraits:{...healthy.portraits,storageAvailable:false}}).at(-1);
 assert.equal(volatile.ok,false);assert.match(volatile.text,/暂用内存/);
 const failed=stageChecks({...healthy,portraits:{...healthy.portraits,failed:3}}).at(-1);
 assert.equal(failed.ok,false);assert.match(failed.text,/3 张失败/);
 assert.equal(stageChecks({...healthy,peopleLoaded:false}).at(-1).ok,false);
 assert.equal(stageChecks({...healthy,portraits:{...healthy.portraits,total:0,cached:0}}).at(-1).ok,true);
});
test('stale control tokens cannot report readiness after disconnection or session expiry',()=>{
 const offline=stageChecks({...healthy,connected:false});
 assert.equal(offline[0].ok,false);assert.equal(offline[1].ok,false);
 const expired=stageChecks({...healthy,authLost:true});
 assert.equal(expired[0].ok,false);assert.equal(expired[1].ok,false);assert.match(expired[1].text,/重新登录/);
 assert.match(stageChecks({...healthy,fence:'',controlBusy:true})[1].text,/另一个大屏/);
 assert.equal(stageChecks({...healthy,modeMatches:false})[1].ok,false);
});
test('theme compilation, failed custom assets and WebGL loss remain distinct from avatar preparation',()=>{
 assert.equal(stageChecks({...healthy,themeReady:false})[2].ok,false);
 assert.equal(stageChecks({...healthy,assets:['ready','loading']})[2].ok,false);
 assert.match(stageChecks({...healthy,assets:['error']})[2].text,/加载失败/);
 assert.equal(stageChecks({...healthy,themeError:'图形显示已中断'})[2].ok,false);
 assert.equal(stageChecks({...healthy,assets:['ready']})[2].ok,true);
});
