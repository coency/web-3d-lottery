import {verifyMaterialsApi,verifyMaterialsBrowser} from './lib/verify-materials.mjs';
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
const artifactRoot=process.env.VERIFICATION_DIRECTORY??path.join(root,'artifacts');
await mkdir(artifactRoot,{recursive:true});
const directory=await mkdtemp(path.join(artifactRoot,'oauth-'));
const dbPort=await freePort(), apiPort=await freePort(), webPort=await freePort();
const origin='http://127.0.0.1:'+webPort, base='http://127.0.0.1:'+apiPort;
process.env.API_PORT=String(apiPort);process.env.WEB_PORT=String(webPort);
const secret=randomBytes(48).toString('hex');
process.env.WECHAT_MASTER_KEY=randomBytes(32).toString('hex');
let db,api,web,browser,sql,mock;
let nextIdentity={openid:'alpha',nickname:'微信测试者',avatar:true},tokenDelay=0,tokenStarted=false;
const codes=new Map(),tokens=new Map(),exchanges=[];
const avatarBytes=await sharp({create:{width:300,height:300,channels:3,background:'#a995d9'}}).png().toBuffer();
const contexts=[],results=[];
const passed=name=>{results.push(name);console.info('PASS '+name);};
const password='Test-password-123';
async function launch(mode='development'){
  const child=startNode(['apps/api/build/main.js'],{env:{...process.env,NODE_ENV:mode,DATABASE_URL:db.connectionString,AUTH_SECRET:secret,APP_ORIGIN:mode==='development'?origin:'https://example.test',ASSET_DIRECTORY:path.join(directory,'uploads')},stdio:'inherit'});
  try{await waitForHttp(base+'/health/ready',child);}catch(error){await stopChild(child);throw error;}
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
  const materials=await verifyMaterialsApi({a,b,anon,alien,activity,activityB,join,req,json,avatarBytes});

  await sql.query("INSERT INTO entitlements(user_id,paid_until) VALUES($1,clock_timestamp()+interval '1 day') ON CONFLICT(user_id) DO UPDATE SET paid_until=EXCLUDED.paid_until",[other.id]);
  const oldB=await begin(alien,joinB),oldBcb=await callback(alien,oldB),cfgB=await getConfig(b,urlB);
  await json(await save(b,urlB,{source:'custom',appId:'mock_custom',accountName:'模拟自定义号',appSecret:'other-fake-secret'},cfgB.version));
  const switched=await alien.ctx.get(oldBcb,{maxRedirects:0});assert.ok(switched.headers().location.includes('OAUTH_CONTEXT_CHANGED'));
  await complete(alien,await callback(alien,await begin(alien,joinB)));const customPerson=await json(await signup(alien,joinB));assert.notEqual(customPerson.id,first.id);assert.equal(exchanges.at(-1),'mock_custom');
  const keys=(await sql.query('SELECT identity_key FROM activity_participants ORDER BY id')).rows.map(r=>r.identity_key);assert.equal(new Set(keys).size,2);
  assert.equal((await anon.ctx.get('/api/v1/'+joinB+'/avatar/'+authorized.profile.avatarUrl.split('/').at(-1))).status(),404);
  passed('custom service-account routing, AppID-scoped identity and stale credential callback rejection');

  const expiredStart=await begin(anon),expiredCb=await callback(anon,expiredStart);
  await sql.query("UPDATE wechat_oauth_states SET expires_at=clock_timestamp()-interval '1 second' WHERE consumed_at IS NULL");
  assert.ok((await anon.ctx.get(expiredCb,{maxRedirects:0})).headers().location.includes('OAUTH_STATE_INVALID'));
  const deniedStart=await begin(anon),deniedUrl=new URL(deniedStart.authorizationUrl),state=deniedUrl.searchParams.get('state');
  assert.ok((await anon.ctx.get('/api/v1/wechat/callback?state='+state,{maxRedirects:0})).headers().location.includes('WECHAT_AUTH_DENIED'));
  const mismatch=await agent();nextIdentity={openid:'mismatch',nickname:'错误身份',avatar:false,mismatch:true};
  assert.ok((await mismatch.ctx.get(await callback(mismatch,await begin(mismatch)),{maxRedirects:0})).headers().location.includes('WECHAT_IDENTITY_MISMATCH'));assert.equal((await me(mismatch)).authenticated,false);
  const fallback=await agent();nextIdentity={openid:'missing-profile',nickname:'',avatar:false,profileFailure:true};await complete(fallback,await callback(fallback,await begin(fallback)));
  assert.equal((await signup(fallback,join,{nickname:''})).status(),422);const supplemented=await json(await signup(fallback,join,{nickname:'补填昵称'}));assert.equal(supplemented.nickname,'补填昵称');assert.equal(supplemented.avatarUrl,'/avatar-placeholder.svg');
  passed('expired/replayed/denied authorization, mismatched OpenID and identity-verified missing-profile fallback');

  web=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts')});await web.listen();
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  nextIdentity={openid:'browser-user',nickname:'扫码用户',avatar:true};
  const beforeBrowser=await json(await a.ctx.get('/api/v1/activities/'+activity.id+'/configuration')),field=randomUUID();
  const browserForm={fields:[{id:field,name:'公司',hint:'请填写公司',type:'text',required:true,options:[]}],titleFieldId:null,auxiliaryFieldIds:[]};
  await json(await req(a,'PUT','activities/'+activity.id+'/configuration/form',{value:browserForm},undefined,{'If-Match':beforeBrowser.version}));
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(entry.url);await page.getByRole('button',{name:'微信授权',exact:true}).click();await page.getByText('扫码用户',{exact:true}).waitFor();
  await page.getByLabel('公司').fill('星光工作室');
  const cfg=await json(await a.ctx.get('/api/v1/activities/'+activity.id+'/configuration'));
  browserForm.fields[0].hint='请填写完整公司名称';
  await json(await req(a,'PUT','activities/'+activity.id+'/configuration/form',{value:browserForm},undefined,{'If-Match':cfg.version}));
  await page.getByRole('button',{name:'签到，开启幸运时刻'}).click();await page.getByText('签到设置已更新，请重新加载并核对填写内容',{exact:true}).waitFor();await page.getByLabel('公司').fill('星光工作室');
  await page.screenshot({path:path.join(artifactRoot,'oauth-form.png'),fullPage:true});
  await page.getByRole('button',{name:'签到，开启幸运时刻'}).click();await page.getByRole('heading',{name:'签到成功'}).waitFor();await page.reload();await page.getByRole('heading',{name:'签到成功'}).waitFor();
  await page.screenshot({path:path.join(artifactRoot,'oauth-success.png'),fullPage:true});assert.deepEqual(errors,[]);
  const roster=await json(await a.ctx.get('/api/v1/activities/'+activity.id+'/participants?mode=rehearsal'));assert.ok(JSON.stringify(roster).includes('扫码用户'));
  const draw=await json(await a.ctx.get('/api/v1/activities/'+activity.id+'/draw?mode=rehearsal'));assert.equal(draw.signedIn,3);
  passed('browser OAuth redirect round-trip, changed-form reload, required fields, saved signup and stage population');
  await verifyMaterialsBrowser({browser,page,origin,a,activity,req,json,avatarBytes,materials});

  nextIdentity={openid:'inflight',nickname:'进行中回调',avatar:true};tokenDelay=1000;tokenStarted=false;
  const racing=await agent(),racingCb=await callback(racing,await begin(racing));const running=racing.ctx.get(racingCb,{maxRedirects:0});
  const waitEnd=Date.now()+5000;while(!tokenStarted&&Date.now()<waitEnd)await new Promise(r=>setTimeout(r,20));assert.equal(tokenStarted,true);
  const current=await json(await a.ctx.get('/api/v1/activities/'+activity.id+'/configuration'));
  await json(await req(a,'POST','activities/'+activity.id+'/mode/clear-rehearsal',{confirmation:'clear-rehearsal',generation:current.runs.find(r=>r.mode==='rehearsal').generation},undefined,{'If-Match':current.version}));
  assert.ok((await running).headers().location.includes('OAUTH_CONTEXT_CHANGED'));tokenDelay=0;
  assert.equal((await me(anon)).authenticated,false);assert.equal((await signup(anon)).status(),401);assert.equal((await anon.ctx.get('/api/v1/'+join+'/materials')).status(),401);
  assert.equal((await sql.query('SELECT * FROM join_avatars WHERE entry_code=$1',[entry.code])).rowCount,0);
  nextIdentity={openid:'alpha',nickname:'重新签到用户',avatar:true};await complete(anon,await callback(anon,await begin(anon)));const rejoined=await json(await signup(anon,join,{answers:{[field]:'重来'}}));assert.notEqual(rejoined.id,first.id);
  passed('full rehearsal reset invalidates sessions, cached avatars and already-in-flight OAuth callbacks');

  await sql.query("UPDATE activities SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",[activity.id]);
  assert.equal((await me(anon)).person.id,rejoined.id);assert.equal((await signup(anon)).status(),200);
  nextIdentity={openid:'late-new-user',nickname:'迟到',avatar:false};await complete(racing,await callback(racing,await begin(racing)));assert.equal((await signup(racing,join,{answers:{[field]:'迟到'}})).status(),410);
  const again=await agent();nextIdentity={openid:'alpha',nickname:'重新签到用户',avatar:true};await complete(again,await callback(again,await begin(again)));assert.equal((await me(again)).person.id,rejoined.id);
  const formalEntry=await json(await a.ctx.get('/api/v1/activities/'+activity.id+'/join-entry?mode=formal'));assert.equal(formalEntry.available,false);assert.equal((await anon.ctx.get('/api/v1/join/'+formalEntry.code)).status(),403);
  assert.equal((await sql.query('SELECT * FROM activity_wechat_verifications')).rowCount,0);
  await sql.query("UPDATE users SET status='disabled' WHERE id=$1",[owner.id]);assert.equal((await anon.ctx.get('/api/v1/'+join)).status(),403);
  passed('expiry permits authenticated history but no new signup; mock never enters formal mode or verifies a real service account');

  const configNow=await getConfig(b,urlB);await json(await save(b,urlB,{source:'custom',appId:'wx-real-shaped-account',accountName:'禁止发到模拟接口',appSecret:'must-never-leave-server'},configNow.version));
  const count=exchanges.length;assert.equal((await req(alien,'POST',joinB+'/authorize',{})).status(),403);assert.equal(exchanges.length,count);
  const {oauthProvider}= (await import('../apps/api/build/activities/wechat-provider.js')).default;
  const savedEnv=process.env.NODE_ENV;process.env.NODE_ENV='production';assert.throws(()=>oauthProvider());process.env.NODE_ENV=savedEnv;
  passed('mock adapter rejects saved real-shaped credentials and cannot be enabled outside development');
  await writeFile(path.join(artifactRoot,'oauth-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:results},null,2));
}finally{
 await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();await new Promise(resolve=>mock?mock.close(resolve):resolve());
}
console.info('OAuth verification complete: '+results.length+' checks.');
