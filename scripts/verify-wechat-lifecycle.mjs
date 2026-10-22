import {provisionFixtureAccount} from './lib/account-fixture.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import sharp from 'sharp';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
await mkdir(path.join(root,'artifacts'),{recursive:true});
const directory=await mkdtemp(path.join(root,'artifacts/oauth-'));
const dbPort=await freePort(), apiPort=await freePort(), webPort=await freePort();
const origin='http://127.0.0.1:'+webPort, base='http://127.0.0.1:'+apiPort;
process.env.API_PORT=String(apiPort);process.env.WEB_PORT=String(webPort);
const secret=randomBytes(48).toString('hex');
process.env.WECHAT_MASTER_KEY=randomBytes(32).toString('hex');
let db,api,web,browser,sql,mock,cleanupDb;
let nextIdentity={openid:'alpha',nickname:'微信测试者',avatar:true},tokenDelay=0,tokenStarted=false;
const codes=new Map(),tokens=new Map(),exchanges=[];
const avatarBytes=await sharp({create:{width:300,height:300,channels:3,background:'#a995d9'}}).png().toBuffer();
const contexts=[],results=[];
const passed=name=>{results.push(name);console.info('PASS '+name);};
const password='Test-password-123';
async function launch(mode='development'){
  const child=startNode(['apps/api/build/main.js'],{env:{...process.env,NODE_ENV:mode,DATABASE_URL:db.connectionString,AUTH_SECRET:secret,APP_ORIGIN:mode==='development'?origin:'https://example.test',ASSET_DIRECTORY:path.join(directory,'uploads')},stdio:'inherit'});
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
  sql=new pg.Client({connectionString:db.connectionString});await sql.connect();
  const mockPort=await freePort();process.env.WECHAT_OAUTH_PROVIDER='mock';process.env.WECHAT_MOCK_ORIGIN='http://127.0.0.1:'+mockPort;
  mock=http.createServer(async(r,s)=>{
   const u=new URL(r.url,process.env.WECHAT_MOCK_ORIGIN),q=u.searchParams;
   if(u.pathname==='/authorize'){const code=randomUUID();codes.set(code,{appId:q.get('appid'),...nextIdentity});const callback=new URL(q.get('redirect_uri'));callback.search=new URLSearchParams({state:q.get('state'),code}).toString();s.writeHead(302,{Location:callback.toString()});s.end();return;}
   if(u.pathname==='/sns/oauth2/access_token'){tokenStarted=true;if(tokenDelay)await new Promise(resolve=>setTimeout(resolve,tokenDelay));const record=codes.get(q.get('code'));codes.delete(q.get('code'));exchanges.push(q.get('appid'));s.setHeader('Content-Type','application/json');if(!record||record.appId!==q.get('appid')){s.end(JSON.stringify({errcode:40029}));return;}const token=randomUUID();tokens.set(token,record);s.end(JSON.stringify({openid:record.openid,access_token:token,scope:'snsapi_userinfo'}));return;}
   if(u.pathname==='/sns/userinfo'){const record=tokens.get(q.get('access_token'));s.setHeader('Content-Type','application/json');s.end(JSON.stringify(!record||record.profileFailure?{errcode:40003}:{openid:record.mismatch?'different':record.openid,nickname:record.nickname,headimgurl:record.avatar?process.env.WECHAT_MOCK_ORIGIN+'/avatar.png':record.unsafeAvatar||''}));return;}
   if(u.pathname==='/avatar.png'){s.setHeader('Content-Type','image/png');s.end(avatarBytes);return;}s.writeHead(404);s.end();
  });await new Promise(resolve=>mock.listen(mockPort,'127.0.0.1',resolve));
  api=await launch();
  const a=await agent(),b=await agent(),admin=await agent(),anon=await agent();
  await register(a,'13800000001');const owner=await login(a,'13800000001');
  await register(b,'13800000002');const other=await login(b,'13800000002');
  await register(admin,'13800000003');const adminUser=await login(admin,'13800000003');
  const req=async(agent,method,url,body,key=randomUUID(),headers={})=>agent.ctx.fetch('/api/v1/'+url,{method,data:body,headers:{'X-CSRF-Token':agent.csrf,'Idempotency-Key':key,...headers}});
  const json=async response=>{assert.equal(response.status(),200,await response.text());return (await response.json()).data;};
  const draft={name:'微信配置验收',expiresAt:new Date(Date.now()+86400000).toISOString(),logoAssetId:null,h5BackgroundAssetId:null,stageBackgroundAssetId:null,tagline:'',organizer:'',coorganizer:'',display:{logo:true,tagline:true,organizer:true,coorganizer:true,h5Background:true,stageBackground:true}};
  const activity=await json(await req(a,'POST','activities',draft)),activityB=await json(await req(b,'POST','activities',draft));
  // This suite counts OAuth identities; rehearsal seed coverage lives in its own suite.
  for(const [who,item] of [[a,activity],[b,activityB]]){
   const config=await json(await who.ctx.get('/api/v1/activities/'+item.id+'/configuration'));
   await json(await req(who,'POST','activities/'+item.id+'/mode/clear-rehearsal',{confirmation:'clear-rehearsal',generation:config.runs.find(r=>r.mode==='rehearsal').generation},undefined,{'If-Match':config.version}));
  }
  const url='activities/'+activity.id+'/wechat',urlB='activities/'+activityB.id+'/wechat';
  const getConfig=async(who,target)=>json(await who.ctx.get('/api/v1/'+target));
  const save=async(who,target,body,version,key)=>req(who,'PUT',target,body,key,{'If-Match':String(version)});
  const platformBody={source:'custom',appId:'mock_platform',accountName:'模拟平台号',appSecret:'fake-secret'};
  await json(await save(a,url,platformBody,(await getConfig(a,url)).version));
  await json(await save(b,urlB,platformBody,(await getConfig(b,urlB)).version));
  const entry=await json(await a.ctx.get('/api/v1/activities/'+activity.id+'/join-entry?mode=rehearsal'));
  const entryB=await json(await b.ctx.get('/api/v1/activities/'+activityB.id+'/join-entry?mode=rehearsal'));
  assert.equal(entry.available,true);assert.equal(entry.provider,'mock');
  const join='join/'+entry.code,joinB='join/'+entryB.code;
  const me=(who,target=join)=>getConfig(who,target);
  const begin=async(who,target=join)=>json(await req(who,'POST',target+'/authorize',{}));
  const callback=async(who,start)=>{const r=await who.ctx.get(start.authorizationUrl,{maxRedirects:0});assert.equal(r.status(),302);const u=new URL(r.headers().location);return u.pathname+u.search;};
  const complete=async(who,cb)=>{const r=await who.ctx.get(cb,{maxRedirects:0});assert.equal(r.status(),303);assert.ok(!r.headers().location.includes('authError'),r.headers().location);return r;};
  const signup=async(who,target=join,extra={})=>{const state=await me(who,target);return req(who,'POST',target+'/checkins',{generation:state.generation,version:state.version,nickname:'页面伪造昵称',answers:{},...extra});};
  assert.equal((await me(anon)).authenticated,false);
  const start=await begin(anon),cb=await callback(anon,start),alien=await agent();
  const stolen=await alien.ctx.get(cb,{maxRedirects:0});assert.ok(stolen.headers().location.includes('OAUTH_STATE_INVALID'));assert.equal(exchanges.length,0);
  await complete(anon,cb);const authorized=await me(anon);assert.equal(authorized.authenticated,true);assert.equal(authorized.profile.nickname,'微信测试者');
  assert.ok(!JSON.stringify(authorized).includes('openid'));assert.ok(!JSON.stringify(authorized).includes('access_token'));assert.ok(!JSON.stringify(authorized).includes('fake-secret'));
  const photo=await anon.ctx.get(authorized.profile.avatarUrl);assert.equal(photo.status(),200);assert.equal(photo.headers()['content-type'],'image/webp');
  const replay=await anon.ctx.get(cb,{maxRedirects:0});assert.ok(replay.headers().location.includes('OAUTH_STATE_INVALID'));assert.equal(exchanges.length,1);
  const concurrently=await Promise.all([signup(anon),signup(anon)]),first=await json(concurrently[0]),second=await json(concurrently[1]);assert.equal(first.id,second.id);assert.equal(first.nickname,'微信测试者');
  const repeat=await agent();await complete(repeat,await callback(repeat,await begin(repeat)));assert.equal((await json(await signup(repeat))).id,first.id);
  assert.equal((await me(anon,joinB)).authenticated,false);
  assert.equal((await signup(alien)).status(),401);
  assert.equal((await sql.query('SELECT * FROM activity_wechat_verifications')).rowCount,0);
  passed('browser-bound one-use OAuth, cached avatar, server-owned identity, same-OpenID deduplication and cross-activity isolation');

  // A second authorization for the same identity already exists in the fixture.
  // Expire the sessions, then exercise normal entry loading to inspect retention.
  await sql.query("UPDATE participant_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE entry_code=$1",[entry.code]);
  await me(anon);
  const retention=(await sql.query(
    "SELECT (SELECT count(*)::int FROM activity_participants WHERE activity_id=$1) AS participants, (SELECT count(*)::int FROM join_avatars WHERE entry_code=$2) AS avatars, (SELECT count(*)::int FROM join_avatars a WHERE entry_code=$2 AND NOT EXISTS(SELECT 1 FROM activity_participants p WHERE p.avatar_url='/api/v1/join/'||a.entry_code||'/avatar/'||a.id::text) AND NOT EXISTS(SELECT 1 FROM participant_sessions s WHERE s.avatar_id=a.id AND s.expires_at>clock_timestamp())) AS unreferenced_expired_avatars",[activity.id,entry.code])).rows[0];
  console.info('RETENTION '+JSON.stringify(retention));
  assert.equal(retention.participants,1);assert.equal(retention.avatars,2);assert.equal(retention.unreferenced_expired_avatars,1);
  process.env.DATABASE_URL=db.connectionString;
  const {DatabaseService}=(await import('../apps/api/build/database.service.js')).default;
  const {WechatCleanupService}=(await import('../apps/api/build/activities/wechat-cleanup.service.js')).default;
  cleanupDb=new DatabaseService();const cleanup=new WechatCleanupService(cleanupDb);
  await sql.query("UPDATE wechat_oauth_states SET expires_at=clock_timestamp()-interval '1 second' WHERE entry_code=$1",[entry.code]);
  await cleanup.sweep();
  assert.equal((await sql.query('SELECT 1 FROM participant_sessions WHERE entry_code=$1',[entry.code])).rowCount,0);
  assert.equal((await sql.query('SELECT 1 FROM wechat_oauth_states WHERE entry_code=$1',[entry.code])).rowCount,0);
  assert.equal((await sql.query('SELECT 1 FROM join_avatars WHERE entry_code=$1',[entry.code])).rowCount,1);
  assert.equal((await anon.ctx.get(first.avatarUrl)).status(),200);
  passed('expired sessions/states and orphan avatars removed; signed-in portrait retained');

  // A current session protects its avatar, even if its owner has not checked in.
  nextIdentity={openid:'not-yet-signed-in',nickname:'尚未签到',avatar:true};
  const waiting=await agent(),waitingStart=await begin(waiting);
  await cleanup.sweep();await complete(waiting,await callback(waiting,waitingStart));
  const waitingProfile=(await me(waiting)).profile;
  await cleanup.sweep();assert.equal((await anon.ctx.get(waitingProfile.avatarUrl)).status(),200);
  assert.equal((await me(waiting)).authenticated,true);
  passed('unexpired OAuth state and authorized but unsigned-in avatar survive cleanup');

  // Replaying one callback concurrently must still exchange its code only once.
  const once=await agent(),onceCb=await callback(once,await begin(once)),exchangeCount=exchanges.length;
  const attempts=await Promise.all([once.ctx.get(onceCb,{maxRedirects:0}),once.ctx.get(onceCb,{maxRedirects:0})]);
  assert.equal(attempts.filter(r=>!r.headers().location.includes('authError')).length,1);
  assert.equal(attempts.filter(r=>r.headers().location.includes('OAUTH_STATE_INVALID')).length,1);
  assert.equal(exchanges.length,exchangeCount+1);
  passed('concurrent callback replay exchanges a single authorization code exactly once');

  // Expired sessions are retained while an in-flight operation owns the account
  // lock. A simulated commit adds the roster reference before cleanup resumes.
  await sql.query('BEGIN');
  await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[owner.id]);
  await sql.query("UPDATE participant_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE avatar_id=$1",[waitingProfile.avatarUrl.split('/').at(-1)]);
  await cleanup.sweep();
  assert.equal((await sql.query('SELECT 1 FROM join_avatars WHERE id=$1',[waitingProfile.avatarUrl.split('/').at(-1)])).rowCount,1);
  await sql.query('UPDATE activity_participants SET avatar_url=$2 WHERE id=$1',[first.id,waitingProfile.avatarUrl]);
  await sql.query('COMMIT');await cleanup.sweep();
  assert.equal((await anon.ctx.get(waitingProfile.avatarUrl)).status(),200);
  passed('cleanup skips a locked owner and preserves the portrait committed by that operation');

  // Protect snapshots independently of current roster images, for valid and
  // void awards alike. Both modes use the same cleanup/reference rules.
  const currentRun=(await sql.query("SELECT * FROM activity_runs WHERE activity_id=$1 AND mode='rehearsal'",[activity.id])).rows[0];
  const historyPrize=randomUUID(),historyRound=randomUUID();
  await sql.query('INSERT INTO prize_identities(id,activity_id) VALUES($1,$2)',[historyPrize,activity.id]);
  await sql.query("INSERT INTO draw_rounds(id,activity_id,run_id,generation,prize_id,config_version,status) VALUES($1,$2,$3,$4,$5,$6,'completed')",[historyRound,activity.id,currentRun.id,currentRun.generation,historyPrize,first.formVersion??(await getConfig(a,'activities/'+activity.id+'/configuration')).version]);
  // Recreate a history-only image: the original was deliberately unreferenced
  // in the preceding fixture and may have been reclaimed.
  const historyAvatar=randomUUID(),historyUrl='/api/v1/join/'+entry.code+'/avatar/'+historyAvatar;
  await sql.query('INSERT INTO join_avatars(id,entry_code,bytes) VALUES($1,$2,$3)',[historyAvatar,entry.code,avatarBytes]);
  await sql.query("INSERT INTO draw_awards(activity_id,run_id,generation,round_id,participant_id,prize_id,status,display_snapshot) VALUES($1,$2,$3,$4,$5,$6,'valid',$7)",[activity.id,currentRun.id,currentRun.generation,historyRound,first.id,historyPrize,JSON.stringify({avatarUrl:historyUrl})]);
  await cleanup.sweep();assert.equal((await anon.ctx.get(historyUrl)).status(),200);
  await sql.query("UPDATE draw_awards SET status='void' WHERE round_id=$1",[historyRound]);
  await cleanup.sweep();assert.equal((await anon.ctx.get(historyUrl)).status(),200);
  passed('valid and void award snapshots retain their history-only avatars');

  // More than one batch must drain gradually; never monopolize an activity.
  const bulkIds=Array.from({length:205},()=>randomUUID());
  await sql.query('INSERT INTO join_avatars(id,entry_code,bytes) SELECT id,$2,$3 FROM unnest($1::uuid[]) id',[bulkIds,entry.code,avatarBytes]);
  await cleanup.sweep();assert.equal((await sql.query('SELECT 1 FROM join_avatars WHERE id=ANY($1::uuid[])',[bulkIds])).rowCount,5);
  await cleanup.sweep();assert.equal((await sql.query('SELECT 1 FROM join_avatars WHERE id=ANY($1::uuid[])',[bulkIds])).rowCount,0);
  passed('orphan cleanup is limited to 200 images per entry per pass and resumes next pass');

  const expiredTokens=Array.from({length:205},()=>randomBytes(32).toString('hex'));
  await sql.query(`INSERT INTO wechat_oauth_states(token_hash,entry_code,generation,credential_id,browser_hash,provider,expires_at)
   SELECT token,s.entry_code,s.generation,s.credential_id,s.browser_hash,s.provider,clock_timestamp()-interval '1 second'
   FROM unnest($1::text[]) token CROSS JOIN (SELECT * FROM wechat_oauth_states WHERE entry_code=$2 LIMIT 1) s`,[expiredTokens,entry.code]);
  await sql.query(`INSERT INTO participant_sessions(token_hash,entry_code,generation,credential_id,provider,identity_key,expires_at)
   SELECT token,s.entry_code,s.generation,s.credential_id,s.provider,s.identity_key,clock_timestamp()-interval '1 second'
   FROM unnest($1::text[]) token CROSS JOIN (SELECT * FROM participant_sessions WHERE entry_code=$2 LIMIT 1) s`,[expiredTokens,entry.code]);
  for(const expected of [5,0]){
   await cleanup.sweep();
   for(const table of ['wechat_oauth_states','participant_sessions'])assert.equal((await sql.query('SELECT 1 FROM '+table+' WHERE token_hash=ANY($1::text[])',[expiredTokens])).rowCount,expected);
  }
  passed('expired state and session cleanup also respects batch limits and drains the remainder');

  const formalEntry=await json(await a.ctx.get('/api/v1/activities/'+activity.id+'/join-entry?mode=formal'));
  const formalRun=(await sql.query("SELECT * FROM activity_runs WHERE activity_id=$1 AND mode='formal'",[activity.id])).rows[0];
  const formalAvatar=randomUUID(),formalOrphan=randomUUID();
  await sql.query('INSERT INTO join_avatars(id,entry_code,bytes) SELECT id,$2,$3 FROM unnest($1::uuid[]) id',[[formalAvatar,formalOrphan],formalEntry.code,avatarBytes]);
  await sql.query(`INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version,avatar_url)
   SELECT activity_id,$2,$3,'formal-cleanup-fixture','正式历史用户',form_version,$4 FROM activity_participants WHERE id=$1`,
   [first.id,formalRun.id,formalRun.generation,'/api/v1/join/'+formalEntry.code+'/avatar/'+formalAvatar]);
  await cleanup.sweep();
  assert.equal((await sql.query('SELECT id FROM join_avatars WHERE id=$1',[formalAvatar])).rowCount,1);
  assert.equal((await sql.query('SELECT id FROM join_avatars WHERE id=$1',[formalOrphan])).rowCount,0);
  passed('formal entry cleanup preserves signed-in portraits while reclaiming unused images');
  const pendingCallback=await callback(anon,await begin(anon));
  const beforeReset=await json(await a.ctx.get('/api/v1/activities/'+activity.id+'/configuration'));
  // Hold reset at its existing DELETE statement, after acquiring owner/run locks.
  // This test-only trigger controls timing; production queries remain unchanged.
  await sql.query('CREATE FUNCTION review_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(834011); RETURN NULL; END $$');
  await sql.query('CREATE TRIGGER review_gate BEFORE DELETE ON participant_sessions FOR EACH STATEMENT EXECUTE FUNCTION review_gate()');
  await sql.query('SELECT pg_advisory_lock(834011)');
  async function waitBlocked(fragment,event){
    const deadline=Date.now()+2000;
    while(Date.now()<deadline){
      const result=await sql.query("SELECT query,wait_event FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active' AND position($1 in query)>0 AND wait_event=$2",[fragment,event]);
      if(result.rowCount)return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw new Error('Did not reach lock gate: '+fragment);
  }
  const resetPromise=req(a,'POST','activities/'+activity.id+'/mode/clear-rehearsal',{confirmation:'clear-rehearsal',generation:beforeReset.runs.find(r=>r.mode==='rehearsal').generation},undefined,{'If-Match':beforeReset.version});
  await waitBlocked('DELETE FROM participant_sessions','advisory');
  const callbackPromise=anon.ctx.get(pendingCallback,{maxRedirects:0});
  await waitBlocked('SELECT status FROM users WHERE id=','transactionid');
  await sql.query('SELECT pg_advisory_unlock(834011)');
  const [resetResponse,callbackResponse]=await Promise.all([resetPromise,callbackPromise]);
  const result={resetStatus:resetResponse.status(),resetBody:await resetResponse.json(),callbackStatus:callbackResponse.status(),callbackLocation:callbackResponse.headers().location};
  assert.equal(result.resetStatus,200);
  assert.ok(result.callbackLocation.includes('OAUTH_STATE_INVALID'));
  assert.ok(!result.callbackLocation.includes('WECHAT_UNAVAILABLE'));
  passed('concurrent reset completes and rejects the stale callback without a database error');
  await writeFile(path.join(directory,'results.json'),JSON.stringify({checks:results,race:result},null,2));
  console.info('Evidence: '+directory);
}finally{
 await sql?.query('ROLLBACK').catch(()=>{});await sql?.query('SELECT pg_advisory_unlock_all()').catch(()=>{});
 await cleanupDb?.onApplicationShutdown();await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();await new Promise(resolve=>mock?mock.close(resolve):resolve());
}
console.info('OAuth verification complete: '+results.length+' checks.');
