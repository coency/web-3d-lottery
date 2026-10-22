import {provisionFixtureAccount} from './lib/account-fixture.mjs';
import ExcelJS from 'exceljs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import net from 'node:net';
import pg from 'pg';
import { createServer } from 'vite';
import { chromium, request } from 'playwright';
import { root } from './lib/config.mjs';
import { startLocalDatabase } from './lib/database.mjs';
import { migrate } from './lib/migrations.mjs';
import { startNode, stopChild, waitForHttp } from './lib/processes.mjs';
process.env.NODE_ENV='development';
async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
await mkdir(nodePath.join(root,'artifacts'),{recursive:true});
const directory=await mkdtemp(nodePath.join(root,'artifacts/draw-'));
const dbPort=await freePort(), apiPort=await freePort(), webPort=await freePort();
const origin='http://127.0.0.1:'+webPort, base='http://127.0.0.1:'+apiPort;
process.env.API_PORT=String(apiPort);process.env.WEB_PORT=String(webPort);
const secret=randomBytes(48).toString('hex');
let db,api,web,browser,sql;
const contexts=[],results=[];
const passed=name=>{results.push(name);console.info('PASS '+name);};
const password='Test-password-123';
async function launch(mode='development'){
  const child=startNode(['apps/api/build/main.js'],{env:{...process.env,NODE_ENV:mode,DATABASE_URL:db.connectionString,AUTH_SECRET:secret,APP_ORIGIN:mode==='development'?origin:'https://example.test',ASSET_DIRECTORY:nodePath.join(directory,'uploads')},stdio:'inherit'});
  try{await waitForHttp(base+'/health/live',child);}catch(error){await stopChild(child);throw error;}
  return child;
}
async function agent(){
  const ctx=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:origin}});
  contexts.push(ctx);
  const csrf=(await(await ctx.get('/api/v1/auth/csrf')).json()).data.csrfToken;
  return {ctx,csrf};
}
async function send(a,action,body,key=randomUUID(),headers={}){
  return a.ctx.post('/api/v1/auth/'+action,{data:body,headers:{'X-CSRF-Token':a.csrf,'Idempotency-Key':key,...headers}});
}
async function register(a,phone){await provisionFixtureAccount(sql,phone,password);}
async function login(a,phone,pw=password,key){
  const res=await send(a,'login',{phone,password:pw},key);
  assert.equal(res.status(),200,await res.text());
  return (await res.json()).data;
}
async function clearLimits(){await sql.query('DELETE FROM auth_limits');}

try{
 db=await startLocalDatabase({directory,port:dbPort});await migrate(db.connectionString);
 sql=new pg.Client({connectionString:db.connectionString});await sql.connect();api=await launch();
 let a=await agent();const b=await agent(),anon=await agent();
 await register(a,'13800000031');await login(a,'13800000031');await register(b,'13800000032');await login(b,'13800000032');
 const req=(who,method,url,body,key=randomUUID(),headers={})=>who.ctx.fetch('/api/v1/'+url,{method,data:body,headers:{'X-CSRF-Token':who.csrf,'Idempotency-Key':key,...headers}});
 const json=async r=>{assert.equal(r.status(),200,await r.text());return (await r.json()).data;};
 const activity=await json(await req(a,'POST','activities',{name:'服务端抽奖验收',expiresAt:new Date(Date.now()+86400000).toISOString(),logoAssetId:null,h5BackgroundAssetId:null,stageBackgroundAssetId:null,tagline:'',organizer:'',coorganizer:'',display:{logo:true,tagline:true,organizer:true,coorganizer:true,h5Background:true,stageBackground:true}}));
 const path='activities/'+activity.id;
 const cfg=()=>jsonResponse(a.ctx.get('/api/v1/'+path+'/configuration'));
 async function jsonResponse(p){return json(await p);}
 let config=await cfg(),run=config.runs.find(r=>r.mode==='rehearsal'),formal=config.runs.find(r=>r.mode==='formal');

 const count=async mode=>(await sql.query('SELECT count(*)::int n FROM activity_participants p JOIN activity_runs r ON r.id=p.run_id WHERE p.activity_id=$1 AND r.mode=$2',[activity.id,mode])).rows[0].n;
 assert.equal(config.phase,'rehearsal');assert.equal(run.simulated,0);assert.equal(await count('rehearsal'),0);assert.equal(await count('formal'),0);
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/stage-people?mode=rehearsal'))).items.length,0);

 const simulationUrl=path+'/rehearsal/simulated-participants';
 const seedBody={target:2000,generation:run.generation},seedKey=randomUUID(),seedHeaders={'If-Match':config.version};
 assert.equal((await req(b,'POST',simulationUrl,seedBody,undefined,seedHeaders)).status(),404);
 assert.equal((await req(anon,'POST',simulationUrl,seedBody,undefined,seedHeaders)).status(),401);
 for(const target of [0,5001,1.5,'2000'])assert.equal((await req(a,'POST',simulationUrl,{...seedBody,target},undefined,seedHeaders)).status(),422);
 const seeded=await json(await req(a,'POST',simulationUrl,seedBody,seedKey,seedHeaders));
 assert.deepEqual(seeded,{added:2000,simulated:2000,participants:2000});
 const sim=(await sql.query('SELECT nickname,avatar_url FROM activity_participants WHERE run_id=$1',[run.id])).rows;assert.equal(sim.length,2000);assert.ok(sim.every(p=>p.nickname.startsWith('模拟用户 ')&&p.avatar_url.startsWith('/demo-avatars/')));
 assert.equal(new Set(sim.map(p=>p.avatar_url)).size,2000);
 assert.ok(sim.every(p=>/^\/demo-avatars\/portraits-v1\/\d+\.webp$/.test(p.avatar_url)));
 assert.deepEqual(await json(await req(a,'POST',simulationUrl,seedBody,seedKey,seedHeaders)),seeded);
 config=await cfg();assert.equal(config.runs.find(r=>r.mode==='rehearsal').simulated,2000);
 assert.equal((await json(await req(a,'POST',simulationUrl,seedBody,undefined,{'If-Match':config.version}))).added,0);
 await sql.query("UPDATE activity_participants SET avatar_url='/demo-avatars/1.svg' WHERE run_id=$1 AND identity_key='rehearsal-simulation-1'",[run.id]);
 assert.equal((await json(await req(a,'POST',simulationUrl,seedBody,undefined,{'If-Match':config.version}))).added,0);
 assert.equal((await sql.query("SELECT avatar_url FROM activity_participants WHERE run_id=$1 AND identity_key='rehearsal-simulation-1'",[run.id])).rows[0].avatar_url,'/demo-avatars/portraits-v1/1.webp');
 config=await cfg();
 assert.equal((await req(a,'POST',simulationUrl,{...seedBody,target:100},undefined,{'If-Match':config.version})).status(),422);
 assert.equal(await count('rehearsal'),2000);assert.equal(await count('formal'),0);
 const people=await json(await a.ctx.get('/api/v1/'+path+'/stage-people?mode=rehearsal'));
 assert.equal(people.items.length,2000);assert.equal(new Set(people.items.map(p=>p.nickname)).size,2000);
 assert.ok(people.items.some(p=>p.nickname==='模拟用户 2000'));
 const roster=await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal'));
 assert.equal(roster.total,2000);assert.equal(roster.items.length,25);
 const job=await json(await req(a,'POST',path+'/exports',{mode:'rehearsal',generation:run.generation}));
 let ready=false;
 for(let i=0;i<60;i++){
  const status=await json(await a.ctx.get('/api/v1/'+path+'/exports/'+job.id));
  if(status.status==='ready'){ready=true;break;}
  assert.notEqual(status.status,'failed');await new Promise(r=>setTimeout(r,250));
 }
 assert.ok(ready,'2000-person export completes');
 const download=await a.ctx.get('/api/v1/'+path+'/exports/'+job.id+'/download');assert.equal(download.status(),200);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await download.body());
 assert.equal(workbook.getWorksheet('彩排签到名单').rowCount,2001);
 passed('2000 simulation records via authenticated API, retry safety, full stage roster and Excel export');
 const prize={id:randomUUID(),name:'模拟试抽',total:13,batch:10,mode:'random'};
 await json(await req(a,'PUT',path+'/configuration/prize-settings',{value:{rule:{mode:'once',maxWins:null},prizes:[prize],reservations:[]}},undefined,{'If-Match':config.version}));
 const tabId=randomUUID();let body={mode:'rehearsal',generation:run.generation,tabId};const control=await json(await req(a,'POST',path+'/draw/claim',body));body.fence=String(control.fence);
 let state=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));const round=await json(await req(a,'POST',path+'/draw/start',{...body,prizeId:prize.id,version:state.version}));assert.equal(round.candidateCount,2000);
 config=await cfg();assert.equal((await req(a,'POST',simulationUrl,{...seedBody,target:2100},undefined,{'If-Match':config.version})).status(),409);
 await json(await req(a,'POST',path+'/draw/stop',{...body,roundId:round.roundId}));
 state=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));assert.equal(state.awards.length,10);assert.equal(new Set(state.awards.map(x=>x.participant_id)).size,10);
 for(const award of state.awards)await json(await req(a,'POST',path+'/draw/void',{...body,awardId:award.id,confirmed:true}));
 state=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));
 const replacement=await json(await req(a,'POST',path+'/draw/start',{...body,prizeId:prize.id,version:state.version}));
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'))).rounds.find(r=>r.status==='drawing').draw_count,10);
 await json(await req(a,'POST',path+'/draw/stop',{...body,roundId:replacement.roundId}));
 state=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));
 assert.equal(state.awards.filter(a=>a.status==='valid').length,10);assert.equal(state.vacancies.length,0);
 await json(await req(a,'POST',path+'/draw/next',{...body,rootId:state.activeRootId}));
 state=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));
 const last=await json(await req(a,'POST',path+'/draw/start',{...body,prizeId:prize.id,version:state.version}));
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'))).rounds.find(r=>r.status==='drawing').draw_count,3);
 await json(await req(a,'POST',path+'/draw/stop',{...body,roundId:last.roundId}));
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'))).prizes[0].awarded,13);
 passed('ten-person draw, ten-person replacement and final three-person round');
 config=await cfg();await json(await req(a,'POST',path+'/mode/reset-draw',{confirmation:'reset-draw',generation:run.generation},undefined,{'If-Match':config.version}));assert.equal(await count('rehearsal'),2000);
 config=await cfg();await json(await req(a,'POST',path+'/mode/clear-rehearsal',{confirmation:'clear-rehearsal',generation:run.generation},undefined,{'If-Match':config.version}));assert.equal(await count('rehearsal'),0);assert.equal(await count('formal'),0);
 config=await cfg();
 assert.equal((await req(a,'POST',simulationUrl,seedBody,undefined,{'If-Match':config.version})).status(),409);
 const nextRun=config.runs.find(r=>r.mode==='rehearsal');
 // Exercise the actual management UI against an empty generation, with one real-style identity retained.
 await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version) VALUES($1,$2,$3,'wechat-fixture','真实参与者样例',$4)",[activity.id,nextRun.id,nextRun.generation,config.version]);
 await sql.query("UPDATE activity_participants SET avatar_url='/demo-avatars/1.svg' WHERE run_id=$1 AND identity_key='wechat-fixture'",[nextRun.id]);
 web=await createServer({root:nodePath.join(root,'apps/web'),configFile:nodePath.join(root,'apps/web/vite.config.ts')});await web.listen();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const browserContext=await browser.newContext({viewport:{width:1440,height:1000},storageState:await a.ctx.storageState()});
 const page=await browserContext.newPage(),browserErrors=[];page.on('pageerror',e=>browserErrors.push(e.message));
 await page.goto(origin);await page.getByRole('button',{name:/编辑活动/}).click();
 await page.getByRole('menuitem',{name:'模式切换',exact:true}).click();
 await page.getByRole('tab',{name:'模拟参与者',exact:true}).click();
 await page.getByRole('spinbutton',{name:'模拟参与者总数',exact:true}).fill('2000');
 const generated=page.waitForResponse(r=>r.url().endsWith('/rehearsal/simulated-participants')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'生成模拟参与者',exact:true}).click();
 assert.equal((await generated).status(),200);
 await page.getByText('当前模拟参与者 2000 人 · 彩排名单共 2001 人',{exact:true}).waitFor();
 assert.equal(await count('rehearsal'),2001);
 assert.equal((await sql.query("SELECT count(*)::int n FROM activity_participants WHERE run_id=$1 AND identity_key='wechat-fixture'",[nextRun.id])).rows[0].n,1);
 assert.equal((await sql.query("SELECT avatar_url FROM activity_participants WHERE run_id=$1 AND identity_key='wechat-fixture'",[nextRun.id])).rows[0].avatar_url,'/demo-avatars/1.svg');
 await page.screenshot({path:nodePath.join(directory,'simulation-2000.png'),fullPage:true});
 assert.deepEqual(browserErrors,[]);
 console.log('PASS browser simulation entry, 2000 generated users and existing participant preserved; screenshot: '+nodePath.join(directory,'simulation-2000.png'));
 config=await cfg();
 const themes=['dream-planet','starlight-matrix','star-wave','starlight-corridor','galaxy-waterfall'];
 const tenPrizes=themes.map(theme=>({id:randomUUID(),name:theme,total:10,batch:10,mode:'random',theme}));
 await json(await req(a,'PUT',path+'/configuration/prize-settings',{value:{rule:{mode:'once',maxWins:null},prizes:tenPrizes,reservations:[]}},undefined,{'If-Match':config.version}));
 const stage=await browserContext.newPage();await stage.setViewportSize({width:1625,height:884});stage.on('pageerror',e=>browserErrors.push(e.message));
 await stage.goto(origin+'/stage.html?activity='+activity.id+'&mode=rehearsal');
 for(let index=0;index<themes.length;index++){
  await stage.waitForFunction(theme=>document.querySelector('#prizeName')?.textContent===theme&&!document.querySelector('#draw').disabled,themes[index],{timeout:30000});
  await stage.keyboard.press('Space');await stage.waitForFunction(()=>document.body.classList.contains('rolling'));
  await stage.keyboard.press('Space');await stage.waitForFunction(()=>!document.body.classList.contains('revealing')&&document.body.classList.contains('result'),{},{timeout:30000});
  assert.equal(await stage.locator('.winner-slot').count(),10);
  const boxes=await stage.locator('.winner-slot').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
  for(let i=0;i<boxes.length;i++){
   assert.ok(boxes[i].x>=0&&boxes[i].right<=1625&&boxes[i].bottom<700,JSON.stringify(boxes[i]));
   for(let j=i+1;j<boxes.length;j++)assert.ok(boxes[i].right<=boxes[j].x||boxes[j].right<=boxes[i].x||boxes[i].bottom+20<=boxes[j].y||boxes[j].bottom+20<=boxes[i].y,'winner cards overlap');
  }
  await stage.screenshot({path:nodePath.join(directory,'ten-winners-'+themes[index]+'.png')});
  if(index<themes.length-1){await stage.keyboard.press('Enter');}
 }
 await stage.close();assert.deepEqual(browserErrors,[]);passed('all five stage themes reveal ten non-overlapping winner cards');
 config=await cfg();
 await sql.query("UPDATE activities SET phase='formal' WHERE id=$1",[activity.id]);
 assert.equal((await req(a,'POST',simulationUrl,{target:2100,generation:nextRun.generation},undefined,{'If-Match':config.version})).status(),409);
 assert.equal(await count('formal'),0);
 await sql.query("UPDATE activities SET phase='rehearsal',expires_at=created_at+interval '1 millisecond' WHERE id=$1",[activity.id]);
 assert.equal((await req(a,'POST',simulationUrl,{target:2100,generation:nextRun.generation},undefined,{'If-Match':config.version})).status(),410);
 console.log('PASS: 2000-person draw, active draw lock, reset retains roster, clear and regenerate, formal/expiry/generation guards');
}finally{await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();}
