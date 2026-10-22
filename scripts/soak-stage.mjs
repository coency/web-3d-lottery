// Real API + isolated database. Never reads the development database or user login.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,appendFile,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import pg from 'pg';
import {preview} from 'vite';
import {chromium,request} from 'playwright';
import {root} from './lib/config.mjs';
import {startLocalDatabase} from './lib/database.mjs';
import {migrate} from './lib/migrations.mjs';
import {startNode,stopChild,waitForHttp} from './lib/processes.mjs';
import {provisionFixtureAccount} from './lib/account-fixture.mjs';
import {soakReport} from './lib/soak-report.mjs';

const smoke=process.argv.includes('--smoke');
const blockMs=smoke?15000:180000;
const themes=['dream-planet','starlight-matrix','star-wave','starlight-corridor','galaxy-waterfall'];
const names=['梦幻星球','星光矩阵','星轨光波','星光长廊','星河瀑布'];
process.env.NODE_ENV='development';
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
await mkdir(path.join(root,'artifacts'),{recursive:true});
const directory=await mkdtemp(path.join(root,smoke?'artifacts/soak-smoke-':'artifacts/soak-stage-'));
const output=name=>path.join(directory,name);
const apiPort=await freePort(),webPort=await freePort(),dbPort=await freePort();
process.env.API_PORT=String(apiPort);process.env.WEB_PORT=String(webPort);
const origin='http://127.0.0.1:'+webPort,base='http://127.0.0.1:'+apiPort;
let db,sql,api,web,browser,ctx,client,page,cdp,timer,sampling=false;
let population=0,theme='',phase='setup',block=0,started=Date.now();
const result={status:'preparing',smoke,startedAt:new Date().toISOString(),environment:{cpu:os.cpus()[0]?.model,totalMemoryGB:os.totalmem()/2**30,viewport:'1920x1080',deviceScaleFactor:1,headless:true},activities:[],samples:[],actions:[],blocks:[],errors:[],requests:{avatars:0,rosters:0}};
let saves=Promise.resolve();
function save(){saves=saves.then(async()=>{await writeFile(output('results.tmp'),JSON.stringify(result,null,2));await rename(output('results.tmp'),output('results.json'));});return saves;}
async function progress(message){console.log(new Date().toISOString()+' '+message);await writeFile(output('progress.json'),JSON.stringify({status:result.status,population,theme,phase,block,elapsedSeconds:Math.round((Date.now()-started)/1000),message,updatedAt:new Date().toISOString(),directory},null,2));}

// Bounded counters: the instrumentation itself must not accumulate frames or objects.
function instrument(){
 const stats={frames:0,total:0,max:0,over50:0,over100:0,bins:new Array(1001).fill(0),longTasks:0,longMs:0,lost:0,hidden:0,initials:0,bitmap:{created:0,closed:0},gl:{}};
 let last=0;
 function frame(t){if(last){const dt=t-last;stats.frames++;stats.total+=dt;stats.max=Math.max(stats.max,dt);stats.bins[Math.min(1000,Math.floor(dt))]++;if(dt>50)stats.over50++;if(dt>100)stats.over100++;}last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);
 new PerformanceObserver(list=>{for(const e of list.getEntries()){stats.longTasks++;stats.longMs+=e.duration;}}).observe({type:'longtask',buffered:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stats.hidden++;});
 document.addEventListener('webglcontextlost',()=>stats.lost++,true);
 const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(text==='模')stats.initials++;return fill.call(this,text,...args);};
 const bitmap=createImageBitmap;window.createImageBitmap=async(...args)=>{const image=await bitmap(...args);stats.bitmap.created++;return image;};
 const closed=new WeakSet(),close=ImageBitmap.prototype.close;ImageBitmap.prototype.close=function(){if(!closed.has(this)){closed.add(this);stats.bitmap.closed++;}return close.call(this);};
 for(const kind of ['Texture','Buffer','Program','Shader','Framebuffer','Renderbuffer','VertexArray']){
  const live=new WeakSet();stats.gl[kind]={created:0,deleted:0,live:0};
  for(const proto of [WebGLRenderingContext.prototype,WebGL2RenderingContext.prototype]){
   const create=proto['create'+kind],remove=proto['delete'+kind];if(!create||!remove||!Object.hasOwn(proto,'create'+kind))continue;
   proto['create'+kind]=function(...args){const item=create.apply(this,args);if(item&&!live.has(item)){live.add(item);stats.gl[kind].created++;stats.gl[kind].live++;}return item;};
   proto['delete'+kind]=function(item){if(item&&live.has(item)){live.delete(item);stats.gl[kind].deleted++;stats.gl[kind].live--;}return remove.call(this,item);};
  }
 }
 window.soakSample=()=>{
  const quantile=q=>{let n=0;for(let i=0;i<stats.bins.length;i++){n+=stats.bins[i];if(n>=stats.frames*q)return i;}return 0;};
  const value={frames:stats.frames,fps:stats.total?1000*stats.frames/stats.total:0,p95Ms:quantile(.95),p99Ms:quantile(.99),maxMs:stats.max,over50:stats.over50,over100:stats.over100,longTasks:stats.longTasks,longMs:stats.longMs,contextLost:stats.lost,hidden:stats.hidden,initials:stats.initials,bitmap:{...stats.bitmap,live:stats.bitmap.created-stats.bitmap.closed},gl:JSON.parse(JSON.stringify(stats.gl)),cache:document.querySelector('#portraitProgress')?.textContent,ready:document.querySelector('#preflightStatus')?.dataset.ready,body:document.body.className};
  stats.frames=stats.total=stats.max=stats.over50=stats.over100=stats.longTasks=stats.longMs=0;stats.bins.fill(0);return value;
 };
}
async function sample(label='periodic'){
 if(!page||page.isClosed()||(sampling&&label==='periodic'))return;
 while(sampling)await new Promise(resolve=>setTimeout(resolve,50));
 sampling=true;
 try{
  const [probe,metrics,dom]=await Promise.all([page.evaluate(()=>window.soakSample()),cdp.send('Performance.getMetrics'),cdp.send('Memory.getDOMCounters')]);
  const m=Object.fromEntries(metrics.metrics.map(x=>[x.name,x.value]));
  const row={at:new Date().toISOString(),elapsedSeconds:(Date.now()-started)/1000,population,theme,phase,block,label,heapMB:m.JSHeapUsedSize/2**20,dom,...probe};
  result.samples.push(row);await appendFile(output('samples.jsonl'),JSON.stringify(row)+'\n');await save();
 }finally{sampling=false;}
}
async function rest(ms){const end=Date.now()+ms;while(Date.now()<end){if(existsSync(output('STOP')))throw new Error('Test cancelled by STOP file');await new Promise(r=>setTimeout(r,Math.min(1000,end-Date.now())));}}
async function ready(){await page.waitForFunction(()=>!document.querySelector('#draw').disabled&&!document.body.classList.contains('revealing'),null,{timeout:60000});}
async function action(kind,key){
 await ready();await sample('before-'+kind);phase=kind;const begin=Date.now();
 // The production client renews an expired CSRF token and retries once with
 // the same operation key. Observe its terminal response, not the first 403.
 const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/draw/'+kind)&&r.status()!==403,{timeout:35000});
 await page.keyboard.press(key);const res=await response;
 if(res.status()!==200)throw new Error('Draw '+kind+' failed: '+res.status()+' '+await res.text().catch(()=>'(body unavailable)'));
 const apiMs=Date.now()-begin;await ready();
 if(kind==='start')await page.waitForFunction(()=>document.body.classList.contains('rolling'));
 if(kind==='stop'){await page.waitForFunction(()=>document.body.classList.contains('result')&&!document.body.classList.contains('revealing'));assert.equal(await page.locator('.winner-slot:visible').count(),10);}
 if(kind==='next')await page.waitForFunction(()=>!document.body.classList.contains('result'));
 result.actions.push({population,theme,block,kind,apiMs,settledMs:Date.now()-begin});await sample('after-'+kind);
 phase=kind==='start'?'rolling':kind==='stop'?'result':'idle';
}
async function openStage(activity){
 phase='opening';page=await ctx.newPage();
 page.on('pageerror',e=>result.errors.push({type:'page',message:e.message,population,theme}));
 page.on('crash',()=>result.errors.push({type:'crash',population,theme}));
 page.on('response',async r=>{if(r.status()>=400)result.errors.push({type:'http',status:r.status(),url:new URL(r.url()).pathname,population,theme,body:await r.text().catch(()=>'(unavailable)')});});
 page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/demo-avatars/portraits-v1/'))result.requests.avatars++;if(p.endsWith('/stage-people'))result.requests.rosters++;});
 cdp=await ctx.newCDPSession(page);await cdp.send('Performance.enable');
 await page.goto(origin+'/stage.html?activity='+activity.id+'&mode=rehearsal');await ready();
 await rest(smoke?1000:5000);await sample('page-ready');
}

try{
 await progress('Preparing isolated database and real API');
 db=await startLocalDatabase({directory,port:dbPort});await migrate(db.connectionString);
 sql=new pg.Client({connectionString:db.connectionString});await sql.connect();
 api=startNode(['apps/api/build/main.js'],{env:{...process.env,NODE_ENV:'development',DATABASE_URL:db.connectionString,AUTH_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:origin,ASSET_DIRECTORY:output('uploads')}});
 await waitForHttp(base+'/health/ready',api);
 client=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:origin}});
 const json=async res=>{assert.equal(res.status(),200,await res.text());return (await res.json()).data;};
 const csrf=(await json(await client.get('/api/v1/auth/csrf'))).csrfToken;
 const req=(method,url,body,version)=>client.fetch('/api/v1/'+url,{method,data:body,headers:{'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID(),...(version?{'If-Match':String(version)}:{})}});
 const password=randomBytes(24).toString('hex');await provisionFixtureAccount(sql,'13800000971',password);
 await json(await req('POST','auth/login',{phone:'13800000971',password}));
 web=await preview({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),preview:{host:'127.0.0.1',port:webPort,strictPort:true,proxy:{'/api':base,'/health':base}}});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 const browserSession=await browser.newBrowserCDPSession();result.environment.gpu=(await browserSession.send('SystemInfo.getInfo')).gpu;result.environment.chrome=browser.version();
 ctx=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,storageState:await client.storageState()});await ctx.addInitScript(instrument);
 result.status='running';started=Date.now();result.runStartedAt=new Date().toISOString();await save();
 timer=setInterval(()=>{sample().catch(e=>result.errors.push({type:'sample',message:e.message}));},30000);
 for(population of (smoke?[2000]:[2000,5000])){
  const activity=await json(await req('POST','activities',{name:'隔离持续测试 '+population+' '+new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),logoAssetId:null,h5BackgroundAssetId:null,stageBackgroundAssetId:null,tagline:'',organizer:'',coorganizer:'',display:{logo:true,tagline:true,organizer:true,coorganizer:true,h5Background:true,stageBackground:true}}));
  const cfg=()=>client.get('/api/v1/activities/'+activity.id+'/configuration').then(json);
  let config=await cfg(),run=config.runs.find(r=>r.mode==='rehearsal');
  await json(await req('POST','activities/'+activity.id+'/rehearsal/simulated-participants',{target:population,generation:run.generation},config.version));config=await cfg();
  const prizes=themes.map((theme,i)=>({id:randomUUID(),name:names[i],theme,total:500,batch:10,mode:'random'}));
  await json(await req('PUT','activities/'+activity.id+'/configuration/prize-settings',{value:{rule:{mode:'once',maxWins:null},prizes,reservations:[]}},config.version));
  result.activities.push({id:activity.id,population});
  theme=themes[0];await openStage(activity);
  const controllerBefore=(await sql.query('SELECT tab_id,fence::text FROM draw_controls WHERE run_id=$1',[run.id])).rows[0];
  const other=await ctx.newPage();
  await other.goto(origin+'/stage.html?activity='+activity.id+'&mode=rehearsal');
  await other.waitForFunction(()=>document.querySelector('#stageStatus')?.textContent.includes('另一个大屏正在控制'),null,{timeout:30000});
  assert.equal(await other.locator('#draw').isDisabled(),true);
  const otherClosed=other.waitForEvent('close');await other.close({runBeforeUnload:true});await otherClosed;
  assert.deepEqual((await sql.query('SELECT tab_id,fence::text FROM draw_controls WHERE run_id=$1',[run.id])).rows[0],controllerBefore,'closing a read-only page must not release the controller');
  result.blocks.push({population,secondPageReadOnly:true});
  for(let lap=0;lap<(smoke?1:2);lap++)for(let i=0;i<themes.length;i++){
   block++;theme=themes[i];phase='switch';
   if(i||lap){await page.keyboard.press('ArrowDown');await page.waitForFunction(theme=>document.querySelector('#stage').dataset.theme===theme,theme);await ready();}
   const beginning=Date.now();phase='idle';await progress('Block '+block+' · '+population+' portraits · '+names[i]+' · lap '+(lap+1));
   await rest(smoke?1000:45000);await sample('idle-baseline');
   for(let cycle=0;cycle<(smoke?1:2);cycle++){
    await action('start','Space');await rest(smoke?1500:25000);await action('stop','Space');await rest(smoke?1000:12000);await action('next','Enter');
   }
   await rest(Math.max(0,blockMs-(Date.now()-beginning)));await sample('block-end');
   // Diagnostic GC only at block boundaries; excluded from normal-frame samples.
   phase='diagnostic-gc';await cdp.send('HeapProfiler.collectGarbage');await rest(500);await sample('after-gc');phase='idle';
   const last=result.samples.at(-1);result.blocks.push({population,theme,lap,block,durationSeconds:(Date.now()-beginning)/1000,heapAfterGCMB:last.heapMB,gl:last.gl,bitmap:last.bitmap});
   await page.screenshot({path:output(population+'-'+lap+'-'+theme+'.png')});await save();
  }
  clearInterval(timer);timer=null;while(sampling)await rest(100);
  const before=result.requests.avatars,closingAt=Date.now();
  const closed=page.waitForEvent('close');await page.close({runBeforeUnload:true});await closed;
  // Exercise a normal browser close, including pagehide/keepalive. Do not hide
  // a missing release behind the server's 15-second crash-recovery timeout.
  let released=false;
  while(Date.now()-closingAt<3000){
   released=!(await sql.query('SELECT 1 FROM draw_controls WHERE run_id=$1 AND lease_until>clock_timestamp()',[run.id])).rowCount;
   if(released)break;await rest(50);
  }
  assert.ok(released,'closing the stage did not release its control lease promptly');
  const releaseMs=Date.now()-closingAt;theme=themes[0];await openStage(activity);
  result.blocks.push({population,reopened:true,releaseMs,avatarNetworkRequests:result.requests.avatars-before});await page.close();
  const totals=(await sql.query("SELECT count(*)::int total,count(DISTINCT participant_id)::int unique_people FROM draw_awards WHERE activity_id=$1 AND status='valid'",[activity.id])).rows[0];
  const stops=result.actions.filter(a=>a.population===population&&a.kind==='stop').length;assert.equal(totals.total,stops*10);assert.equal(totals.unique_people,totals.total);
  result.activities.at(-1).awards=totals;
  timer=setInterval(()=>{sample().catch(e=>result.errors.push({type:'sample',message:e.message}));},30000);
 }
 const findings=result.errors.length||result.samples.some(s=>s.contextLost||s.initials);
 result.status=findings?'completed_with_findings':'completed';result.completedAt=new Date().toISOString();result.durationSeconds=(Date.now()-started)/1000;
 await progress('Completed: '+result.actions.length+' actions; '+result.errors.length+' errors');
}catch(e){result.status='failed';result.failure=e.stack;await progress('FAILED: '+e.message);process.exitCode=1;}
finally{
 clearInterval(timer);while(sampling)await new Promise(resolve=>setTimeout(resolve,100));
 result.durationSeconds=(Date.now()-started)/1000;await save();await writeFile(output('report.md'),soakReport(result));
 await browser?.close();if(web)await new Promise(resolve=>web.httpServer.close(resolve));await client?.dispose();await stopChild(api);await sql?.end();await db?.stop();
 console.log('SOAK_REPORT '+output('results.json'));
 process.exitCode=result.status==='completed'?0:1;
}
