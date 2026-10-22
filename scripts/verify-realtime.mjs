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
const directory=await mkdtemp(nodePath.join(root,'artifacts/join-'));
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
 const a=await agent(),b=await agent(),anon=await agent();
 await register(a,'13800000011');await login(a,'13800000011');
 await register(b,'13800000012');await login(b,'13800000012');
 const req=(who,method,url,body,key=randomUUID(),headers={})=>who.ctx.fetch('/api/v1/'+url,{method,data:body,headers:{'X-CSRF-Token':who.csrf,'Idempotency-Key':key,...headers}});
 const json=async r=>{assert.equal(r.status(),200,await r.text());return (await r.json()).data;};
 const ticket=await json(await req(a,'POST','assets/uploads',{purpose:'activity_logo',activityId:null}));
 const input=await sharp({create:{width:100,height:100,channels:3,background:'#8470b3'}}).png().toBuffer();
 await json(await req(a,'PUT','assets/'+ticket.id+'/content',input,undefined,{'Content-Type':'application/octet-stream'}));
 const activity=await json(await req(a,'POST','activities',{name:'签到名单验收',expiresAt:new Date(Date.now()+86400000).toISOString(),logoAssetId:ticket.id,h5BackgroundAssetId:null,stageBackgroundAssetId:null,tagline:'',organizer:'',coorganizer:'',display:{logo:true,tagline:true,organizer:true,coorganizer:true,h5Background:true,stageBackground:true}}));
 const path='activities/'+activity.id;
 const initialConfig=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));
 await json(await req(a,'POST',path+'/mode/clear-rehearsal',{confirmation:'clear-rehearsal',generation:initialConfig.runs.find(r=>r.mode==='rehearsal').generation},undefined,{'If-Match':initialConfig.version}));
 assert.equal((await anon.ctx.get('/api/v1/events')).status(),401);
 const streams=[];
 async function stream(who){
  const cookies=(await who.ctx.storageState()).cookies.map(c=>c.name+'='+c.value).join(';');
  const controller=new AbortController();const response=await fetch(base+'/api/v1/events',{headers:{Cookie:cookies},signal:controller.signal});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const events=[],reader=response.body.getReader();
  streams.push(controller);
  void(async()=>{let buffer='';try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value);let pos;while((pos=buffer.indexOf('\n\n'))>=0){const chunk=buffer.slice(0,pos);buffer=buffer.slice(pos+2);const type=chunk.match(/event: (.*)/)?.[1],data=chunk.match(/data: (.*)/)?.[1];if(type)events.push({type,data:JSON.parse(data),id:chunk.match(/id: (.*)/)?.[1]});}}}catch{}})();
  return events;
 }
 async function until(check,label){const end=Date.now()+12000;while(!check()){if(Date.now()>end)throw new Error('Timed out: '+label);await new Promise(r=>setTimeout(r,100));}}
 const events=await stream(a),other=await stream(b);
 await until(()=>events.length&&other.length,'initial sync');
 assert.deepEqual(other[0].data.activities,[]);assert.equal(events[0].data.activities[0].id,activity.id);
 assert.deepEqual(Object.keys(events[0].data.activities[0]).sort(),['ended','id','phase','revision']);
 passed('authenticated SSE sends only owner-scoped invalidation metadata');
 const before=events.length;
 await sql.query('BEGIN');await sql.query("UPDATE activities SET tagline='rolled back' WHERE id=$1",[activity.id]);await sql.query('ROLLBACK');
 await new Promise(r=>setTimeout(r,1300));assert.equal(events.length,before);
 await sql.query("UPDATE activities SET tagline='committed' WHERE id=$1",[activity.id]);await until(()=>events.length>before,'commit notice');
 assert.equal(other.length,1);passed('rollback produces no notification; committed change does not leak to another user');
 const reconnected=await stream(a);await until(()=>reconnected.length,'reconnect snapshot');assert.equal(reconnected[0].id,events.at(-1).id);
 for(const controller of streams)controller.abort();
 passed('reconnecting always receives current revision, without replaying business operations');
 web=await createServer({root:nodePath.join(root,'apps/web'),configFile:nodePath.join(root,'apps/web/vite.config.ts')});await web.listen();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const owner=await browser.newContext({storageState:await a.ctx.storageState(),viewport:{width:1280,height:720},reducedMotion:'reduce'});
 const admin=await owner.newPage(),stage=await owner.newPage(),errors=[];
 for(const page of [admin,stage])page.on('pageerror',e=>errors.push(e.message));
 let cfg=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));
 const prizeId=randomUUID();await json(await req(a,'PUT',path+'/configuration/prizes',{value:[{id:prizeId,name:'实时同步奖',total:1,batch:1,mode:'random',theme:'dream-planet'}]},undefined,{'If-Match':cfg.version}));
 await stage.setViewportSize({width:640,height:360});await stage.emulateMedia({reducedMotion:'no-preference'});
 await admin.goto(origin);await stage.goto(origin+'/stage.html?activity='+activity.id+'&mode=rehearsal');
 await stage.waitForFunction(()=>document.querySelector('#draw')?.disabled===false);
 const join='/api/v1/dev-join/'+activity.id,entry=await json(await anon.ctx.get(join));
 const t=Date.now();await json(await req(anon,'POST','dev-join/'+activity.id+'/checkins',{generation:entry.generation,version:entry.version,nickname:'实时来宾',answers:{}}));
 await admin.waitForFunction(()=>document.querySelector('.cover-metrics strong')?.textContent?.trim()==='1 人',{},{timeout:12000});
 await stage.waitForFunction(()=>document.querySelector('#joined')?.textContent==='1',{},{timeout:12000});
 console.info('Signup synchronization ms: '+(Date.now()-t));
 // Exercise controls in the active tab, without relying on background frames.
 await admin.bringToFront();
 await admin.getByRole('button',{name:/编辑活动/}).click();await admin.getByRole('menuitem',{name:'签到名单',exact:true}).click();await admin.locator('tbody').getByText('实时来宾',{exact:true}).waitFor();
 passed('new signup updates activity card, roster and real 3D stage');
 await stage.bringToFront();await stage.emulateMedia({reducedMotion:'no-preference'});
 await stage.keyboard.press('Space');await stage.waitForFunction(()=>document.querySelector('#drawLabel')?.textContent==='停止 · 揭晓幸运');
 await sql.query("UPDATE activities SET name='同步后的活动' WHERE id=$1",[activity.id]);
 await new Promise(r=>setTimeout(r,1800));assert.notEqual(await stage.locator('.event h1').textContent(),'同步后的活动');
 await stage.keyboard.press('Space');await stage.locator('.winner-caption h3').waitFor({state:'visible'});
 await stage.waitForFunction(()=>document.querySelector('.event h1')?.textContent==='同步后的活动');
 const drawn=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));assert.equal(drawn.awards.length,1);
 await owner.setOffline(true);await stage.waitForFunction(()=>document.querySelector('#draw')?.disabled===true);
 await owner.setOffline(false);await stage.waitForFunction(()=>document.querySelector('#draw')?.disabled===false,{},{timeout:15000});
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'))).awards[0].id,drawn.awards[0].id);
 passed('appearance waits until reveal completes; disconnect/reconnect retains the same saved winner');
 cfg=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));
 await json(await req(a,'POST',path+'/mode/clear-rehearsal',{confirmation:'clear-rehearsal',generation:entry.generation},undefined,{'If-Match':cfg.version}));
 await stage.waitForFunction(()=>document.querySelector('#joined')?.textContent==='0'&&document.querySelectorAll('.winner-slot').length===0);
 await admin.locator('tbody').getByText('实时来宾',{exact:true}).waitFor({state:'detached'});
 passed('clearing rehearsal removes old participants and winners from already-open pages');
 await sql.query("UPDATE activities SET expires_at=clock_timestamp()+interval '3 seconds' WHERE id=$1",[activity.id]);
 await stage.waitForFunction(()=>document.querySelector('#stageStatus')?.textContent?.includes('已到期'),{},{timeout:15000});
 assert.equal(await stage.locator('#draw').isDisabled(),true);
 passed('deadline disables stage without another user write');
 await login(a,'13800000011');
 await stage.waitForFunction(()=>document.querySelector('#stageStatus')?.textContent?.includes('登录已失效'),{},{timeout:12000});
 await admin.locator('input[name=account]').waitFor({timeout:12000});
 assert.deepEqual(errors,[]);
 passed('new login invalidates old admin and stage sessions via stream');
 await writeFile(nodePath.join(root,'artifacts/realtime-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:results},null,2));
}catch(error){
 if(browser)for(const context of browser.contexts())for(const page of context.pages()){console.info('FAIL PAGE '+page.url());console.info((await page.locator('body').innerText().catch(()=>'' )).slice(0,4000));}
 throw error;
}finally{
 await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();
}
console.info('Realtime verification complete: '+results.length+' checks.');
