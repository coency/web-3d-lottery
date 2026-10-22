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
 assert.equal(config.phase,'rehearsal');assert.equal(await count('rehearsal'),0);assert.equal(await count('formal'),0);
 const seeded=await json(await req(a,'POST',path+'/rehearsal/simulated-participants',{target:100,generation:run.generation},undefined,{'If-Match':config.version}));
 assert.deepEqual(seeded,{added:100,simulated:100,participants:100});config=await cfg();
 const sim=(await sql.query('SELECT nickname,avatar_url FROM activity_participants WHERE run_id=$1',[run.id])).rows;assert.ok(sim.every(p=>p.nickname.startsWith('模拟用户 ')&&p.avatar_url.startsWith('/demo-avatars/')));
 const prize={id:randomUUID(),name:'模拟试抽',total:5,batch:5,mode:'random'};
 await json(await req(a,'PUT',path+'/configuration/prize-settings',{value:{rule:{mode:'once',maxWins:null},prizes:[prize],reservations:[]}},undefined,{'If-Match':config.version}));
 const tabId=randomUUID();let body={mode:'rehearsal',generation:run.generation,tabId};const control=await json(await req(a,'POST',path+'/draw/claim',body));body.fence=String(control.fence);
 let state=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));const round=await json(await req(a,'POST',path+'/draw/start',{...body,prizeId:prize.id,version:state.version}));assert.equal(round.candidateCount,100);await json(await req(a,'POST',path+'/draw/stop',{...body,roundId:round.roundId}));
 state=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));assert.equal(state.awards.length,5);assert.equal(new Set(state.awards.map(x=>x.participant_id)).size,5);

 // Fixture credentials are confined to this disposable database; this does not test live WeChat authorization.
 const credential=randomUUID();
 await sql.query("INSERT INTO wechat_credentials(id,app_id,account_name,sealed_secret) VALUES($1,'isolated-test','fixture','{}')",[credential]);
 await sql.query("INSERT INTO wechat_configurations(scope,source,credential_id) VALUES($1,'platform',$2)",[activity.id,credential]);
 await sql.query("INSERT INTO activity_wechat_verifications(activity_id,verified_at,valid_until,evidence_reference,credential_id) VALUES($1,clock_timestamp(),clock_timestamp()+interval '1 day','isolated-test-only',$2)",[activity.id,credential]);
 config=await cfg();await json(await req(a,'POST',path+'/mode/promote',{confirmation:'promote',generation:run.generation},undefined,{'If-Match':config.version}));
 config=await cfg();assert.equal(config.phase,'formal');assert.equal(await count('rehearsal'),100);assert.equal(await count('formal'),0);
 const rehearsalState=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));assert.equal(rehearsalState.awards.length,5);
 const formalState=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=formal'));assert.equal(formalState.awards.length,0);
 const formalBody={mode:'formal',generation:formal.generation,tabId:randomUUID()};
 const formalControl=await json(await req(a,'POST',path+'/draw/claim',formalBody));formalBody.fence=String(formalControl.fence);
 const denied=await req(a,'POST',path+'/draw/start',{...formalBody,prizeId:prize.id,version:formalState.version});assert.equal(denied.status(),409);assert.match(await denied.text(),/NOT_ENOUGH_CANDIDATES/);
 assert.equal(await count('formal'),0);
 console.log('PASS: promotion retains 100 rehearsal users and 5 rehearsal awards; formal roster and awards remain empty; formal draw rejects empty candidate pool.');

}finally{await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();}
