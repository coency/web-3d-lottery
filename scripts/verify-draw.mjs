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
 // Use this suite's controlled roster; default simulation seeding has its own tests.
 await sql.query("DELETE FROM activity_participants WHERE run_id=$1 AND identity_key LIKE 'rehearsal-simulation-%'",[run.id]);
 await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version) SELECT $1,$2,$3,'draw-private-'||n,CASE WHEN n=20 THEN '=SUM(1,2)' ELSE '抽奖人员'||n END,$4 FROM generate_series(1,20)n",[activity.id,run.id,run.generation,config.version]);
 const people=(await sql.query("SELECT id FROM activity_participants WHERE run_id=$1 ORDER BY identity_key",[run.id])).rows;
 const designatedPeople=people.slice(-2).map(p=>p.id);
 const randomPrize={id:randomUUID(),name:'随机奖',total:7,batch:5,mode:'random'},designated={id:randomUUID(),name:'指定奖',total:2,batch:2,mode:'designated'};
 let prizes=[randomPrize,designated],rule={mode:'once',maxWins:null};
 async function saveConfig(reservations=[]){config=await cfg();await json(await req(a,'PUT',path+'/configuration/prize-settings',{value:{rule,prizes,reservations}},undefined,{'If-Match':config.version}));}
 await saveConfig([{prizeId:designated.id,participantIds:designatedPeople}]);
 designated.mode='random';await saveConfig();assert.equal((await cfg()).prizes.find(p=>p.id===designated.id).mode,'random');designated.mode='designated';await saveConfig([{prizeId:designated.id,participantIds:designatedPeople}]);
 assert.ok((await cfg()).prizes.every(p=>p.theme==='dream-planet'));
 let tabId=randomUUID(),fence='',mode='rehearsal';
 const state=()=>jsonResponse(a.ctx.get('/api/v1/'+path+'/draw?mode='+mode));
 const preflight=()=>jsonResponse(a.ctx.get('/api/v1/'+path+'/draw/preflight?mode='+mode));
 const roster=(revision='')=>jsonResponse(a.ctx.get('/api/v1/'+path+'/stage-people?mode='+mode+(revision?'&revision='+encodeURIComponent(revision):'')));
 const body=()=>({mode,generation:run.generation,tabId,fence});
 async function act(action,extra={},key){return req(a,'POST',path+'/draw/'+action,{...body(),...extra},key);}
 async function claim(){fence=String((await json(await act('claim'))).fence);}
 async function start(prizeId){const s=await preflight(),check=s.readiness.find(p=>p.prizeId===prizeId);const result=await json(await act('start',{prizeId,version:s.version}));assert.equal(check.required,result.count);assert.equal(check.available,result.candidateCount);return result;}
 async function stop(round){return json(await act('stop',{roundId:round.roundId}));}
 async function next(){return json(await act('next',{rootId:(await state()).activeRootId}));}
 await claim();
 assert.equal((await req(a,'POST',path+'/draw/claim',{...body(),tabId:randomUUID()})).status(),409);
 // Closing a page releases only its exact fenced lease. Replays, a different
 // tab, invalid CSRF and another owner cannot release the current controller.
 const originalControl={...body()};
 assert.equal((await json(await act('release',{tabId:randomUUID()}))).released,false);
 assert.equal((await req(a,'POST',path+'/draw/release',body(),undefined,{'X-CSRF-Token':'invalid'})).status(),403);
 assert.equal((await req(b,'POST',path+'/draw/release',body())).status(),404);
 assert.equal((await json(await act('release'))).released,true);
 assert.equal((await json(await req(a,'POST',path+'/draw/release',originalControl))).released,false);
 assert.equal((await act('heartbeat')).status(),409);
 tabId=randomUUID();await claim();assert.ok(BigInt(fence)>BigInt(originalControl.fence));
 assert.equal((await json(await req(a,'POST',path+'/draw/release',originalControl))).released,false);
 assert.equal((await act('heartbeat')).status(),200);
 const sameTabControl={...body()};
 await json(await act('release'));await claim();
 assert.equal((await json(await req(a,'POST',path+'/draw/release',sameTabControl))).released,false);
 assert.equal((await act('heartbeat')).status(),200);
 passed('page exit releases only the matching fenced lease; immediate reclaim works and delayed releases cannot revoke it');
 assert.equal((await b.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal')).status(),404);
 assert.equal((await anon.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal')).status(),401);
 assert.equal((await b.ctx.get('/api/v1/'+path+'/draw/preflight?mode=rehearsal')).status(),404);
 assert.equal((await anon.ctx.get('/api/v1/'+path+'/draw/preflight?mode=rehearsal')).status(),401);
 const initialRoster=await roster();assert.equal(initialRoster.items.length,20);
 assert.deepEqual(await roster(initialRoster.revision),{generation:run.generation,revision:initialRoster.revision,unchanged:true});
 assert.equal((await b.ctx.get('/api/v1/'+path+'/stage-people?mode=rehearsal&revision='+encodeURIComponent(initialRoster.revision))).status(),404);
 const initialState=await state();assert.equal(initialState.rosterRevision,initialRoster.revision);assert.equal(initialState.eligibleCount,20);
 await sql.query("UPDATE activity_participants SET avatar_url='/demo-avatars/1.svg' WHERE id=$1",[people[0].id]);
 const changedRoster=await roster(initialRoster.revision);assert.notEqual(changedRoster.revision,initialRoster.revision);assert.equal(changedRoster.items.find(p=>p.id===people[0].id).avatarUrl,'/demo-avatars/1.svg');
 await saveConfig([{prizeId:designated.id,participantIds:designatedPeople}]);
 assert.equal((await state()).rosterRevision,changedRoster.revision);assert.equal((await state()).appearanceRevision,initialState.appearanceRevision);
 await sql.query("UPDATE activities SET tagline='外观修改验收' WHERE id=$1",[activity.id]);
 assert.notEqual((await state()).appearanceRevision,initialState.appearanceRevision);assert.equal((await state()).rosterRevision,changedRoster.revision);
 const pre=await preflight();assert.equal(pre.readiness.find(p=>p.prizeId===randomPrize.id).available,18);assert.ok(!JSON.stringify(pre).includes(people[0].id));
 passed('preflight shares candidate rules without leaking identities; roster and appearance revisions change independently');
 let s=await state();const startBody={prizeId:randomPrize.id,version:s.version};
 const simultaneous=await Promise.all([act('start',startBody),act('start',startBody)]);
 assert.deepEqual(simultaneous.map(r=>r.status()).sort(),[200,409]);
 const first=await json(simultaneous.find(r=>r.status()===200));assert.equal(first.count,5);assert.equal(first.candidateCount,18);
 const drawingBeforeRelease=await state();
 await json(await act('release'));await claim();
 assert.deepEqual(await state(),drawingBeforeRelease,'release must not stop or change the active draw');
 assert.ok(!JSON.stringify(await state()).includes('draw-private'));
 assert.ok(!('candidates' in (await state()).rounds[0]));
 config=await cfg();
 const late=(await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version) VALUES($1,$2,$3,'late','晚签到人员',$4) RETURNING id",[activity.id,run.id,run.generation,config.version])).rows[0].id;
 const lateRevision=(await state()).rosterRevision;assert.notEqual(lateRevision,changedRoster.revision);
 assert.equal((await req(a,'POST',path+'/participants/'+people[0].id+'/eligibility',{mode,generation:run.generation,eligible:false,reason:'抽取期间拒绝'},undefined,{'If-Match':'1'})).status(),409);
 const stops=await Promise.all([act('stop',{roundId:first.roundId}),act('stop',{roundId:first.roundId})]);
 assert.ok(stops.every(r=>r.status()===200));s=await state();assert.equal(s.awards.length,5);assert.ok((await cfg()).lockedPrizeIds.includes(randomPrize.id));
 assert.equal(s.rosterRevision,lateRevision);assert.equal((await roster(lateRevision)).unchanged,true);
 assert.equal((await preflight()).readiness.find(p=>p.prizeId===randomPrize.id).status,'result');
 assert.ok(s.awards.every(x=>x.participant_id!==late&&!designatedPeople.includes(x.participant_id)));
 const original=s.awards.map(x=>x.id);assert.deepEqual((await state()).awards.map(x=>x.id),original);
 passed('candidate snapshots exclude late signups and reserved people; concurrent starts/stops do not duplicate results');
 const absent=s.awards.slice(0,2);
 assert.equal((await act('void',{awardId:absent[0].id,confirmed:false})).status(),422);
 for(const award of absent)await json(await act('void',{awardId:award.id,confirmed:true}));
 s=await state();assert.equal(s.awards.length,5);assert.equal(s.vacancies.length,2);
 assert.notEqual(s.rosterRevision,lateRevision);assert.equal((await preflight()).readiness.find(p=>p.prizeId===randomPrize.id).status,'replacement');
 assert.equal((await act('next',{rootId:s.activeRootId})).status(),409);
 const refill=await start(randomPrize.id);assert.equal(refill.count,2);await stop(refill);
 s=await state();assert.equal(s.awards.length,7);assert.equal(s.awards.filter(x=>x.status==='valid').length,5);assert.equal(s.vacancies.length,0);
 assert.ok(s.awards.filter(x=>x.replaces_award_id).every(x=>absent.some(v=>v.id===x.replaces_award_id)));
 assert.ok(s.awards.filter(x=>x.status==='valid').every(x=>!absent.some(v=>v.participant_id===x.participant_id)));
 const person=(await sql.query('SELECT version FROM activity_participants WHERE id=$1',[absent[0].participant_id])).rows[0];
 assert.equal((await req(a,'POST',path+'/participants/'+absent[0].participant_id+'/eligibility',{mode,generation:run.generation,eligible:true,reason:'禁止恢复'},undefined,{'If-Match':person.version})).status(),409);
 await next();assert.equal((await act('void',{awardId:original[2],confirmed:true})).status(),409);
 const last=await start(randomPrize.id);assert.equal(last.count,2);
 await stopChild(api);api=await launch();await claim();assert.equal((await state()).rounds.at(-1).id,last.roundId);await stop(last);await next();
 assert.equal((await act('start',{prizeId:randomPrize.id,version:(await state()).version})).status(),409);
 const specific=await start(designated.id);await stop(specific);s=await state();
 assert.deepEqual(s.awards.map(x=>x.participant_id).sort(),designatedPeople.sort());
 assert.equal((await sql.query("SELECT count(*)::int n FROM designated_reservations WHERE run_id=$1 AND status='issued'",[run.id])).rows[0].n,2);
 const missingDesignated=s.awards[0];await json(await act('void',{awardId:missingDesignated.id,confirmed:true}));
 const alternate=(await sql.query("SELECT p.id FROM activity_participants p WHERE p.run_id=$1 AND p.eligible AND NOT EXISTS(SELECT 1 FROM draw_awards a WHERE a.participant_id=p.id AND a.status='valid') LIMIT 1",[run.id])).rows[0].id;
 await saveConfig([{prizeId:designated.id,participantIds:[alternate]}]);const specifiedRefill=await start(designated.id);assert.equal(specifiedRefill.count,1);await stop(specifiedRefill);assert.equal((await state()).awards.find(x=>x.replaces_award_id===missingDesignated.id).participant_id,alternate);await next();

 passed('absence only voids selected winners; explicit refill preserves others; restart resumes same round; designated awards consume reservations');
 const retained=(await sql.query("SELECT participant_id FROM draw_awards WHERE run_id=$1 AND status='valid' LIMIT 1",[run.id])).rows[0].participant_id;
 await sql.query("UPDATE activity_participants SET eligible=(id=$2),exclusion_kind=CASE WHEN id=$2 THEN NULL ELSE 'manual' END WHERE run_id=$1 AND exclusion_kind IS DISTINCT FROM 'absent'",[run.id,retained]);
 const repeat={id:randomUUID(),name:'次数验收',total:2,batch:1,mode:'random'};prizes.push(repeat);rule={mode:'max',maxWins:1};await saveConfig();
 assert.equal((await preflight()).readiness.find(p=>p.prizeId===repeat.id).available,0);
 assert.equal((await act('start',{prizeId:repeat.id,version:(await state()).version})).status(),409);
 rule={mode:'max',maxWins:2};await saveConfig();await stop(await start(repeat.id));assert.equal((await state()).awards[0].participant_id,retained);await next();
 const again={id:randomUUID(),name:'跨奖重复',total:1,batch:1,mode:'random'};prizes.push(again);await saveConfig();
 assert.equal((await act('start',{prizeId:again.id,version:(await state()).version})).status(),409);
 rule={mode:'across',maxWins:null};await saveConfig();await stop(await start(again.id));await next();
 assert.equal((await act('start',{prizeId:repeat.id,version:(await state()).version})).status(),409);
 passed('once, max-N and cross-prize repetition respect win counts and same-prize uniqueness');
 // A lower limit preserves existing awards but blocks further wins; invalid values fail validation.
 rule={mode:'once',maxWins:null};await saveConfig();
 assert.equal((await act('start',{prizeId:repeat.id,version:(await state()).version})).status(),409);
 for(const invalid of [0,-1,1.5]){config=await cfg();assert.equal((await req(a,'PUT',path+'/configuration/prize-settings',{value:{rule:{mode:'max',maxWins:invalid},prizes,reservations:[]}},undefined,{'If-Match':config.version})).status(),422);}
 assert.equal((await sql.query("SELECT count(*)::int n FROM draw_awards WHERE run_id=$1 AND participant_id=$2 AND status='valid'",[run.id,retained])).rows[0].n,3);
 rule={mode:'across',maxWins:null};await saveConfig();
 passed('lowering limit retains history and invalid zero/negative/fractional limits are rejected');
 const previousFence=fence,previousTab=tabId;
 await sql.query("UPDATE draw_controls SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[run.id]);
 assert.equal((await act('heartbeat')).status(),409);tabId=randomUUID();await claim();assert.ok(BigInt(fence)>BigInt(previousFence));
 assert.equal((await req(a,'POST',path+'/draw/heartbeat',{...body(),tabId:previousTab,fence:previousFence})).status(),409);
 const old=a;a=await agent();await login(a,'13800000031');await claim();
 assert.equal((await req(old,'POST',path+'/draw/heartbeat',body())).status(),401);
 assert.equal((await b.ctx.get('/api/v1/'+path+'/awards?mode=rehearsal')).status(),404);
 const records=await json(await a.ctx.get('/api/v1/'+path+'/awards?mode=rehearsal'));assert.equal(records.total,14);
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/awards?mode=formal'))).total,0);
 const excel=await a.ctx.get('/api/v1/'+path+'/awards/download?mode=rehearsal');assert.equal(excel.status(),200);
 const book=new ExcelJS.Workbook();await book.xlsx.load(await excel.body());assert.equal(book.worksheets[0].rowCount,15);
 book.worksheets[0].eachRow(row=>row.eachCell(cell=>assert.notEqual(cell.type,ExcelJS.ValueType.Formula)));
 await writeFile(nodePath.join(root,'artifacts/draw-records.xlsx'),await excel.body());
 passed('leases expire and fence old tabs; new login takes control; records and Excel stay isolated by owner and mode');
 config=await cfg();await json(await req(a,'POST',path+'/mode/clear-rehearsal',{confirmation:'clear-rehearsal',generation:run.generation},undefined,{'If-Match':config.version}));
 const resetRoster=await roster(initialRoster.revision);assert.notEqual(resetRoster.revision,initialRoster.revision);assert.ok(Array.isArray(resetRoster.items));assert.notEqual(resetRoster.generation,initialRoster.generation);
 assert.equal((await act('stop',{roundId:first.roundId})).status(),409);
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/awards?mode=rehearsal'))).total,0);
 run=(await cfg()).runs.find(r=>r.mode==='rehearsal');await claim();
 config=await cfg();await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version,avatar_url) VALUES($1,$2,$3,'browser-demo','浏览器抽奖人员',$4,'/demo-avatars/1.svg')",[activity.id,run.id,run.generation,config.version]);
 const recordsOnly=process.env.DRAW_RECORDS_ONLY==='1',rulesOnly=process.env.DRAW_RULES_ONLY==='1';
 if(!rulesOnly){
 if(recordsOnly)await stop(await start(again.id));
 // UI uses one-person prize to verify start/stop, refresh, record and export.
 web=await createServer({root:nodePath.join(root,'apps/web'),configFile:nodePath.join(root,'apps/web/vite.config.ts')});await web.listen();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.locator('input[name=account]').fill('13800000031');await page.locator('input[name=password]').fill(password);await page.locator('button[type=submit]').click();
 if(!recordsOnly){
 await page.getByRole('button',{name:'大屏抽奖',exact:true}).click();
 const popup=page.waitForEvent('popup');await page.getByRole('link',{name:'进入大屏',exact:true}).click();const stage=await popup;stage.on('pageerror',e=>errors.push(e.message));
 await stage.waitForSelector('#universe[data-background="cosmic"]');
 await stage.waitForFunction(()=>!document.querySelector('#draw').disabled);
 await stage.keyboard.press('h');assert.equal(await stage.evaluate(()=>document.activeElement.id),'helpTitle');await stage.keyboard.press('Escape');
 assert.equal(await stage.locator('#joined').textContent(),'1');assert.equal(await stage.locator('#stage').getAttribute('data-theme'),'dream-planet');
 assert.equal(await stage.locator('#helpDialog').innerText().then(t=>t.includes('切换模拟人数')),false);
 await stage.keyboard.press('Space');await stage.locator('.el-message:not(.el-message-fade-leave-active)').last().filter({hasText:'本轮需 5 人'}).waitFor();assert.ok((await stage.locator('.el-message:not(.el-message-fade-leave-active)').last().boundingBox()).y<100);
 for(let i=0;i<prizes.length&&await stage.locator('#prizeName').textContent()!==again.name;i++)await stage.keyboard.press('ArrowDown');
 assert.equal(await stage.locator('#prizeName').textContent(),again.name);
 await stage.keyboard.press('Space');await stage.waitForFunction(()=>document.body.classList.contains('rolling'));
 await stage.reload();await stage.waitForFunction(()=>!document.querySelector('#draw').disabled,{},{timeout:10000});
 assert.equal(await stage.locator('body').evaluate(el=>el.classList.contains('rolling')),true);
 await stage.keyboard.press('Space');
 await stage.waitForFunction(()=>document.querySelector('#universe').dataset.revealPhase==='retreat');
 assert.equal(await stage.locator('#universe').getAttribute('data-flying-count'),'0');
 await stage.waitForFunction(()=>!document.body.classList.contains('revealing')&&document.body.classList.contains('result'),{},{timeout:25000});
 await stage.getByRole('heading',{name:'浏览器抽奖人员',exact:true}).waitFor();
 await stage.screenshot({path:nodePath.join(root,'artifacts/stage-draw.png')});
 await stage.keyboard.press('w');await stage.locator('#historyContent').filter({hasText:'浏览器抽奖人员'}).waitFor();await stage.keyboard.press('Escape');
 await stage.reload();await stage.getByRole('heading',{name:'浏览器抽奖人员',exact:true}).waitFor();

 await stage.waitForFunction(()=>!document.querySelector('#draw').disabled,{},{timeout:25000});
 await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version,avatar_url) VALUES($1,$2,$3,'browser-refill','浏览器补抽人员',$4,'/demo-avatars/2.svg')",[activity.id,run.id,run.generation,config.version]);
 await stage.getByRole('button',{name:'不在场 · 补抽',exact:true}).click();
 await stage.keyboard.press('Space');assert.equal(await stage.locator('#confirmDialog').evaluate(el=>el.open),true);
 await stage.locator('#acceptConfirm').click();
 await stage.waitForFunction(()=>document.querySelector('#drawLabel').textContent==='开始补抽');
 assert.equal(await stage.locator('.winner-slot.vacant').count(),1);
 await stage.keyboard.press('Space');await stage.waitForFunction(()=>document.body.classList.contains('rolling'));
 await stage.reload();await stage.waitForFunction(()=>!document.querySelector('#draw').disabled,{},{timeout:25000});
 await stage.keyboard.press('Space');
 await stage.waitForFunction(()=>!document.body.classList.contains('revealing')&&document.body.classList.contains('result'),{},{timeout:25000});
 await stage.getByRole('heading',{name:'浏览器补抽人员',exact:true}).waitFor();
 // A second document must remain read-only while the first renews its lease.
 await page.getByRole('button',{name:'大屏抽奖',exact:true}).click();
 const secondPopup=page.waitForEvent('popup');await page.getByRole('link',{name:'进入大屏',exact:true}).click();const second=await secondPopup;
 await second.waitForSelector('#universe[data-background="cosmic"]');assert.equal(await second.locator('#draw').isDisabled(),true);await second.close();
 // Disconnect fails closed and reconnect reads persisted results before reclaiming.
 await page.context().setOffline(true);await stage.waitForFunction(()=>document.querySelector('#draw').disabled);
 await stage.keyboard.press('Enter');assert.equal(await stage.locator('.winner-slot').count(),1);
 await page.context().setOffline(false);await stage.waitForFunction(()=>!document.querySelector('#draw').disabled,{},{timeout:25000});
 await stage.keyboard.press('Enter');await stage.waitForFunction(()=>document.querySelectorAll('.winner-slot').length===0);
 assert.equal(await stage.locator('#roundLabel').textContent(),'已中奖');assert.equal(await stage.locator('#roundCount').textContent(),'1');assert.equal(await stage.locator('#remaining').textContent(),'0');assert.equal(await stage.locator('#drawLabel').textContent(),'本奖项已完成');
 // Populate an isolated five-person round; leave sufficient candidates for replacement.
 for(let i=0;i<8;i++)await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version,avatar_url) VALUES($1,$2,$3,$4,$5,$6,'/demo-avatars/3.svg')",[activity.id,run.id,run.generation,'multi-'+i,'多人验收'+i,config.version]);
 for(let i=0;i<prizes.length&&await stage.locator('#prizeName').textContent()!==prizes[0].name;i++)await stage.keyboard.press('ArrowDown');
 await stage.keyboard.press('Space');await stage.waitForFunction(()=>document.body.classList.contains('rolling'));
 await stage.keyboard.press('Space');await stage.waitForFunction(()=>!document.body.classList.contains('revealing')&&document.body.classList.contains('result'),{},{timeout:25000});
 assert.equal(await stage.locator('.winner-slot').count(),5);
 const originalPositions=await stage.locator('.winner-slot').evaluateAll(els=>els.map(e=>({id:e.dataset.id,left:e.style.left,top:e.style.top})));
 await stage.locator('.void-person').first().click();await stage.locator('#acceptConfirm').click();
 await stage.waitForFunction(()=>document.querySelectorAll('.vacant').length===1);
 assert.equal(await stage.locator('.winner-slot.dimmed').count(),0);
 await stage.keyboard.press('Space');await stage.waitForFunction(()=>document.body.classList.contains('rolling'));
 assert.equal(await stage.locator('.winner-slot.dimmed').count(),5);
 await stage.keyboard.press('Space');await stage.waitForFunction(()=>!document.body.classList.contains('revealing')&&document.body.classList.contains('result'),{},{timeout:25000});
 assert.equal(await stage.locator('.winner-slot.dimmed').count(),0);
 const after=await stage.locator('.winner-slot').evaluateAll(els=>els.map(e=>({id:e.dataset.id,left:e.style.left,top:e.style.top})));
 assert.deepEqual(after.slice(1),originalPositions.slice(1));assert.notEqual(after[0].id,originalPositions[0].id);
 await stage.screenshot({path:nodePath.join(root,'artifacts/stage-refill.png')});
 // Reduced-motion restoration and a second refill complete without waiting for a flight.
 await stage.emulateMedia({reducedMotion:'reduce'});await stage.reload();await stage.waitForFunction(()=>!document.querySelector('#draw').disabled,{},{timeout:25000});
 await stage.locator('.void-person').first().click();
 const voidResponse=stage.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/draw/void'));
 await stage.locator('#acceptConfirm').click();const voidResult=await voidResponse;assert.equal(voidResult.status(),200,await voidResult.text());
 await stage.waitForFunction(()=>document.querySelectorAll('.vacant').length===1);
 await stage.keyboard.press('Space');await stage.waitForFunction(()=>document.body.classList.contains('rolling'));await stage.keyboard.press('Space');
 await stage.waitForFunction(()=>!document.body.classList.contains('revealing')&&document.body.classList.contains('result'),{},{timeout:25000});
 assert.equal(await stage.locator('.winner-slot').count(),5);
 passed('stage refill preserves other positions; multiple winners, reduced motion, disconnect and second-window lock');

 const prizeBeforeSwitch=await stage.locator('#prizeName').textContent();await stage.keyboard.press('ArrowDown');await stage.waitForFunction(previous=>document.querySelector('#prizeName').textContent!==previous,prizeBeforeSwitch);assert.equal(await stage.locator('.winner-slot').count(),0);
 await stage.keyboard.press('ArrowUp');await stage.waitForFunction(previous=>document.querySelector('#prizeName').textContent===previous,prizeBeforeSwitch);
 const replacementLogin=await agent();await login(replacementLogin,'13800000031');await stage.waitForFunction(()=>document.querySelector('#stageStatus').textContent.includes('登录已失效'),{},{timeout:15000});assert.equal(await stage.locator('#draw').isDisabled(),true);
 await stage.close();
 await page.reload();await page.locator('input[name=account]').fill('13800000031');await page.locator('input[name=password]').fill(password);await page.locator('button[type=submit]').click();
 }
 await page.getByRole('button',{name:/编辑活动/}).click();assert.equal(await page.getByRole('button',{name:'抽奖操作',exact:true}).count(),0);await page.getByRole('menuitem',{name:'中奖名单',exact:true}).click();await page.locator('tbody tr').filter({has:page.locator('td:first-child').filter({hasText:/^浏览器抽奖人员/})}).waitFor();
 await page.getByRole('menuitem',{name:'奖项设置',exact:true}).click();await page.locator('.prize-fields').first().waitFor();assert.equal(await page.getByRole('button',{name:'抽奖外观',exact:true}).count(),0);await page.locator('.prize-fields').first().getByText('梦幻星球',{exact:true}).waitFor();await page.getByRole('menuitem',{name:'中奖名单',exact:true}).click();
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'导出名单',exact:true}).click();await event;
 await page.screenshot({path:nodePath.join(root,'artifacts/draw-records.png'),fullPage:true});assert.deepEqual(errors,[]);
 const rosterBeforeReset=(await sql.query('SELECT id,nickname,answers,created_at FROM activity_participants WHERE run_id=$1 ORDER BY id',[run.id])).rows;
 await page.getByRole('button',{name:'清空抽奖',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();
 assert.ok((await sql.query('SELECT count(*)::int n FROM draw_awards WHERE run_id=$1',[run.id])).rows[0].n>0);
 await page.getByRole('button',{name:'清空抽奖',exact:true}).click();await page.getByRole('button',{name:'确认清空',exact:true}).click();
 await page.getByText('彩排抽奖已清空，签到名单和奖项设置已保留，可重新试抽。',{exact:true}).waitFor();
 assert.equal((await sql.query('SELECT count(*)::int n FROM draw_awards WHERE run_id=$1',[run.id])).rows[0].n,0);
 assert.deepEqual((await sql.query('SELECT id,nickname,answers,created_at FROM activity_participants WHERE run_id=$1 ORDER BY id',[run.id])).rows,rosterBeforeReset);
 assert.equal((await sql.query("SELECT count(*)::int n FROM activity_participants WHERE run_id=$1 AND exclusion_kind='absent'",[run.id])).rows[0].n,0);
 await page.screenshot({path:nodePath.join(root,'artifacts/awards-reset.png'),fullPage:true});
 passed('awards module clears rehearsal results only after confirmation, preserving roster identity and restoring absent eligibility');
 passed(recordsOnly?'records-only UI: list, export and confirmed reset':'clear removes results and blocks stale generation; browser starts, reloads, stops, views and downloads records');
 }else{
  config=await cfg();await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version) SELECT $1,$2,$3,'rules-extra-'||n,'规则测试'||n,$4 FROM generate_series(1,5)n",[activity.id,run.id,run.generation,config.version]);
 }
 if(!recordsOnly){
 // Formal first-start lock and deadline are verified with isolated fixtures only.
 a=await agent();await login(a,'13800000031');config=await cfg();
 // Mixed awards freeze designated selections and fill only the remainder randomly.
 rule={mode:'across',maxWins:null};
 const availableMixed=(await sql.query('SELECT id FROM activity_participants WHERE run_id=$1 AND eligible ORDER BY id',[run.id])).rows.map(p=>p.id);
 await claim();
 for(const fixedCount of [0,1,2,3]){
  const mixed={id:randomUUID(),name:'指定验收'+fixedCount,total:3,batch:3,mode:fixedCount===0?'mixed':'designated'};prizes.push(mixed);
  const fixed=availableMixed.slice(0,fixedCount);await saveConfig([{prizeId:mixed.id,participantIds:fixed}]);
  assert.equal((await cfg()).prizes.find(p=>p.id===mixed.id).mode,'designated');const round=await start(mixed.id);await stop(round);await stop(round);const result=await state();
  assert.equal(result.awards.length,3);assert.equal(new Set(result.awards.map(a=>a.participant_id)).size,3);
  assert.ok(fixed.every(id=>result.awards.some(a=>a.participant_id===id&&a.display_snapshot.method==='designated')));
  assert.equal(result.awards.filter(a=>a.display_snapshot.method==='random').length,3-fixedCount);
  await next();
 }
 passed('mixed awards support zero/one/two/three designated people; random fills the remainder without duplicates; repeated stop is stable');
 const resetPrize={id:randomUUID(),name:'重置保护',total:1,batch:1,mode:'random'};prizes.push(resetPrize);
 await saveConfig([{prizeId:designated.id,participantIds:[availableMixed[0]]}]);
 await sql.query("UPDATE activity_participants SET eligible=false,exclusion_kind='manual',exclusion_reason='reset test' WHERE id=$1",[availableMixed[1]]);
 const resetRound=await start(resetPrize.id);config=await cfg();
 assert.equal((await req(a,'POST',path+'/mode/reset-draw',{confirmation:'reset-draw',generation:run.generation},undefined,{'If-Match':config.version})).status(),409);
 await stop(resetRound);config=await cfg();
 await json(await req(a,'POST',path+'/mode/reset-draw',{confirmation:'reset-draw',generation:run.generation},undefined,{'If-Match':config.version}));
 assert.equal((await act('stop',{roundId:resetRound.roundId})).status(),409);
 assert.equal((await sql.query('SELECT eligible FROM activity_participants WHERE id=$1',[availableMixed[1]])).rows[0].eligible,false);
 assert.equal((await sql.query("SELECT count(*)::int n FROM designated_reservations WHERE run_id=$1 AND status='reserved'",[run.id])).rows[0].n,1);
 assert.equal((await cfg()).lockedPrizeIds.length,0);assert.equal((await state()).activeRootId,null);
 passed('draw-only reset rejects active rounds, fences stale controls, retains manual exclusion and pending reservations, unlocks rehearsal prizes');
 await sql.query("UPDATE activities SET phase='formal' WHERE id=$1",[activity.id]);
 const fp=(await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version) VALUES($1,$2,$3,'formal-fixture','正式验收人员',$4) RETURNING id",[activity.id,formal.id,formal.generation,config.version])).rows[0].id;
 mode='formal';run=formal;await claim();const unfinished=await start(again.id);
 const locked=(await cfg());assert.equal(locked.firstFormalStarted,true);
 assert.equal((await req(a,'POST',path+'/participants/'+fp+'/eligibility',{mode,generation:run.generation,eligible:false,reason:'锁定验收'},undefined,{'If-Match':'1'})).status(),409);
 await sql.query("UPDATE activities SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",[activity.id]);
 assert.equal((await act('stop',{roundId:unfinished.roundId})).status(),410);s=await state();assert.equal(s.rounds[0].status,'expired');assert.equal(s.awards.length,0);
 assert.equal((await a.ctx.get('/api/v1/'+path+'/awards/download?mode=rehearsal')).status(),200);
 passed('first formal start locks configuration boundaries; expiry does not invent results and history remains downloadable');
 }
 await writeFile(nodePath.join(root,rulesOnly?'artifacts/draw-rules-verification.json':recordsOnly?'artifacts/awards-ui-verification.json':'artifacts/draw-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:results},null,2));
}finally{await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();}
console.info('Draw verification complete: '+results.length+' checks.');
