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
let db,api,web,browser,sql,mock;
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

  const activityPath='activities/'+activity.id;
  for(const version of ['invalid','999999999999999999999999',null]){
   const invalid=await req(anon,'POST',join+'/checkins',{generation:authorized.generation,version,answers:{}});
   assert.equal(invalid.status(),409);assert.equal((await invalid.json()).error.code,'FORM_VERSION_CHANGED');
  }
  const config=await getConfig(a,activityPath+'/configuration');
  const prizeId=randomUUID();
  await json(await req(a,'PUT',activityPath+'/configuration/prizes',{value:[{id:prizeId,name:'只改奖项',total:1,batch:1,mode:'random'}]},undefined,{'If-Match':config.version}));
  const unchangedForm=await me(anon);assert.deepEqual(unchangedForm.form,authorized.form);
  const {matchesJoinForm}=await import('../apps/api/build/activities/join-form-version.js');
  assert.equal(await matchesJoinForm(sql,activity.id,authorized.version,unchangedForm.form),true);
  assert.equal(await matchesJoinForm(sql,activity.id,authorized.version,{...unchangedForm.form,fields:[{id:'name',name:'姓名',type:'text',required:true}]}),false);
  assert.equal(await matchesJoinForm(sql,activity.id,authorized.version,{...unchangedForm.form,signupFieldIds:['name']}),false);
  const accepted=await req(anon,'POST',join+'/checkins',{generation:authorized.generation,version:authorized.version,nickname:'',answers:{}});
  assert.equal(accepted.status(),200,await accepted.text());
  passed('unchanged OAuth signup form accepts the displayed version after prize-only edit');
  await sql.query("UPDATE activities SET phase='formal',expires_at=created_at+interval '1 millisecond',first_formal_started_at=created_at WHERE id=$1",[activity.id]);
  const ended=await getConfig(a,activityPath);assert.equal(ended.phase,'expired');
  assert.equal(ended.mode,'formal');
  await sql.query('UPDATE activities SET first_formal_started_at=NULL WHERE id=$1',[activity.id]);
  assert.equal((await getConfig(a,activityPath)).mode,'formal');
  passed('expired formal activity preserves its run mode');
  web=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts')});await web.listen();
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext({storageState:await a.ctx.storageState(),viewport:{width:1280,height:800}});
  const page=await context.newPage();await page.goto(origin);
  await page.getByRole('button',{name:'大屏抽奖',exact:true}).first().click();
  const href=await page.getByRole('link',{name:'进入大屏',exact:true}).getAttribute('href');
  assert.ok(href.includes('mode=formal'));
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'查看活动',exact:true}).click();
  await page.getByRole('menuitem',{name:'签到名单',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:'正式名单',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('menuitem',{name:'中奖名单',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:'正式名单',exact:true}).getAttribute('aria-selected'),'true');
  passed('expired formal activity opens formal stage, roster and awards');

  await sql.query("UPDATE activities SET phase='rehearsal',expires_at=created_at+interval '1 day',first_formal_started_at=NULL WHERE id=$1",[activity.id]);
  assert.equal((await getConfig(a,activityPath)).mode,'rehearsal');
  let currentConfig=await getConfig(a,activityPath+'/configuration');
  await json(await req(a,'PUT',activityPath+'/configuration/prizes',{value:[{id:prizeId,name:'手机十人',total:10,batch:10,mode:'random'}]},undefined,{'If-Match':currentConfig.version}));
  currentConfig=await getConfig(a,activityPath+'/configuration');
  await json(await req(a,'POST',activityPath+'/rehearsal/simulated-participants',{target:10,generation:currentConfig.runs.find(r=>r.mode==='rehearsal').generation},undefined,{'If-Match':currentConfig.version}));
  const stage=await context.newPage();await stage.setViewportSize({width:390,height:844});await stage.emulateMedia({reducedMotion:'reduce'});
  await stage.goto(origin+'/stage.html?activity='+activity.id+'&mode=rehearsal');
  await stage.waitForFunction(()=>!document.querySelector('#draw').disabled);
  const measure=()=>stage.evaluate(()=>({stageHeight:document.querySelector('#stage').clientHeight,canvasHeight:document.querySelector('.winner-universe').height,cssHeight:document.querySelector('.winner-universe').getBoundingClientRect().height}));
  const before=await measure();
  const dev=await agent(),devEntry=await json(await dev.ctx.get('/api/v1/dev-join/'+activity.id));
  await stage.keyboard.press('Space');await stage.waitForFunction(()=>document.body.classList.contains('rolling')&&!document.querySelector('#draw').disabled);
  await stage.keyboard.press('Space');await stage.waitForFunction(()=>document.body.classList.contains('result')&&!document.body.classList.contains('revealing'));
  assert.equal(await stage.locator('.winner-slot').count(),10);
  await stage.waitForFunction(()=>document.querySelector('.winner-universe').height===document.querySelector('#stage').clientHeight);
  const after=await measure();assert.ok(after.stageHeight>before.stageHeight);assert.equal(after.canvasHeight,after.stageHeight);
  await json(await req(dev,'POST','dev-join/'+activity.id+'/checkins',{generation:devEntry.generation,version:devEntry.version,nickname:'抽奖期间签到',answers:{}}));
  passed('unchanged development signup form accepts pre-draw version after start and stop');
  console.log('Mobile renderer measurements: '+JSON.stringify({before,after}));
  await stage.screenshot({path:path.join(root,'artifacts/review-fixed-mobile-ten-viewport.png'),fullPage:false});
  assert.equal((await measure()).canvasHeight,after.stageHeight);
  await stage.keyboard.press('Enter');
  await stage.waitForFunction(()=>!document.body.classList.contains('result')&&document.querySelector('.winner-universe').height===document.querySelector('#stage').clientHeight);
  assert.equal((await measure()).stageHeight,before.stageHeight);
  passed('ten mobile winners and next-round stage restoration keep renderer height in sync');
  await writeFile(path.join(root,'artifacts/review-fixes-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:results},null,2));
}finally{await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();await new Promise(resolve=>mock?mock.close(resolve):resolve());}
