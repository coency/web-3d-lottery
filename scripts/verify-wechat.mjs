import {provisionFixtureAccount} from './lib/account-fixture.mjs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createServer as createHttpsServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
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
const directory=await mkdtemp(path.join(root,'artifacts/wechat-'));
const dbPort=await freePort(), apiPort=await freePort(), webPort=await freePort();
const origin='http://127.0.0.1:'+webPort, base='http://127.0.0.1:'+apiPort;
process.env.API_PORT=String(apiPort);process.env.WEB_PORT=String(webPort);
const secret=randomBytes(48).toString('hex');
process.env.WECHAT_MASTER_KEY=randomBytes(32).toString('hex');
let db,api,web,browser,sql,httpsServer;
let publicOrigin=origin;
const verificationDirectory=path.join(directory,'verification');
await mkdir(verificationDirectory);
process.env.WECHAT_VERIFICATION_DIRECTORY=verificationDirectory;
const contexts=[],results=[];
const passed=name=>{results.push(name);console.info('PASS '+name);};
const password='Test-password-123';
async function launch(mode='development'){
  const child=startNode(['apps/api/build/main.js'],{env:{...process.env,NODE_ENV:mode,DATABASE_URL:db.connectionString,AUTH_SECRET:secret,APP_ORIGIN:mode==='development'?publicOrigin:'https://example.test',ASSET_DIRECTORY:path.join(directory,'uploads')},stdio:'inherit'});
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
  api=await launch();
  const a=await agent(),b=await agent(),admin=await agent(),anon=await agent();
  await register(a,'13800000001');const owner=await login(a,'13800000001');
  await register(b,'13800000002');const other=await login(b,'13800000002');
  await register(admin,'13800000003');const adminUser=await login(admin,'13800000003');
  const req=async(agent,method,url,body,key=randomUUID(),headers={})=>{if(url.endsWith('/wechat/check')&&!headers['If-Match'])headers['If-Match']=(await(await agent.ctx.get('/api/v1/'+url.slice(0,-6))).json()).data?.version??'1';return agent.ctx.fetch('/api/v1/'+url,{method,data:body,headers:{Origin:publicOrigin,'X-CSRF-Token':agent.csrf,'Idempotency-Key':key,...headers}});};
  const json=async response=>{assert.equal(response.status(),200,await response.text());return (await response.json()).data;};
  const draft={name:'微信配置验收',expiresAt:new Date(Date.now()+86400000).toISOString(),logoAssetId:null,h5BackgroundAssetId:null,stageBackgroundAssetId:null,tagline:'',organizer:'',coorganizer:'',display:{logo:true,tagline:true,organizer:true,coorganizer:true,h5Background:true,stageBackground:true}};
  const activity=await json(await req(a,'POST','activities',draft)),activityB=await json(await req(b,'POST','activities',draft));
  const url='activities/'+activity.id+'/wechat',urlB='activities/'+activityB.id+'/wechat';
  const getConfig=async(who,target)=>json(await who.ctx.get('/api/v1/'+target));
  const save=async(who,target,body,version,key)=>req(who,'PUT',target,body,key,{'If-Match':String(version)});
  let config=await getConfig(a,url);assert.equal(config.secretConfigured,false);assert.equal(config.customAllowed,true);
  assert.equal((await anon.ctx.get('/api/v1/'+url)).status(),401);
  assert.equal((await b.ctx.get('/api/v1/'+url)).status(),404);
  assert.equal((await a.ctx.get('/api/v1/admin/wechat')).status(),404);
  assert.equal((await req(admin,'PUT','admin/wechat',{})).status(),404);
  assert.equal((await req(admin,'POST','admin/wechat/check',{})).status(),404);
  assert.equal(config.source,'custom');assert.equal(config.appId,'');
  assert.equal((await save(a,url,{source:'platform'},config.version)).status(),422);
  passed('no default service account, removed admin routes and anonymous/cross-owner isolation');

  // Simulate a pre-migration activity binding: it remains usable but never becomes a default.
  const legacyId=randomUUID();
  const vaultForLegacy=(await import('../apps/api/build/activities/wechat-vault.js')).default;
  await sql.query('INSERT INTO wechat_credentials(id,app_id,account_name,sealed_secret) VALUES($1,$2,$3,$4)',[legacyId,'wx-legacy','历史服务号',JSON.stringify(vaultForLegacy.sealSecret('legacy-test-secret',legacyId))]);
  await sql.query("INSERT INTO wechat_configurations(scope,source,credential_id) VALUES($1,'platform',$2)",[activityB.id,legacyId]);
  const legacy=await getConfig(b,urlB);assert.equal(legacy.legacyBinding,true);assert.equal(legacy.appId,'wx-legacy');
  assert.equal((await req(b,'POST',urlB+'/check',{})).status(),422);
  assert.equal((await getConfig(a,url)).secretConfigured,false);
  assert.equal((await save(b,urlB,{source:'custom',appId:'wx-legacy',accountName:'历史服务号',appSecret:''},legacy.version)).status(),422);
  passed('legacy activity binding retained without default inheritance or shared-secret reuse');

  const custom={source:'custom',appId:'wx-owner-test',accountName:'活动独立服务号',appSecret:'fake-owner-secret-only-for-tests'};
  config=await getConfig(a,url);const key=randomUUID(),before=config.version;
  const saved=await json(await save(a,url,custom,before,key));assert.equal(saved.source,'custom');
  assert.deepEqual(await json(await save(a,url,custom,before,key)),saved);
  assert.equal((await save(a,url,custom,before)).status(),409);
  assert.equal((await save(a,url,{...custom,appId:'different-id',appSecret:''},saved.version)).status(),422);
  config=await json(await save(a,url,{...custom,appSecret:'',accountName:'重命名后保留密钥'},saved.version));
  assert.ok(!JSON.stringify(config).includes(custom.appSecret));
  const check=await req(a,'POST',url+'/check',{});assert.equal(check.status(),422);assert.equal((await check.json()).error.code,'DOMAIN_CONFIRMATION_REQUIRED');
  const credentials=(await sql.query('SELECT sealed_secret FROM wechat_credentials')).rows;
  assert.ok(!JSON.stringify(credentials).includes(custom.appSecret));
  const audits=(await sql.query('SELECT details FROM business_audit')).rows;assert.ok(!JSON.stringify(audits).includes(custom.appSecret));
  assert.equal((await sql.query('SELECT * FROM activity_wechat_verifications')).rowCount,0);
  const cfg=await json(await a.ctx.get('/api/v1/activities/'+activity.id+'/configuration'));
  const promote=await req(a,'POST','activities/'+activity.id+'/mode/promote',{confirmation:'promote',generation:cfg.runs.find(r=>r.mode==='rehearsal').generation},undefined,{'If-Match':cfg.version});
  assert.equal(promote.status(),409);assert.equal((await promote.json()).error.code,'WECHAT_NOT_VERIFIED');
  passed('unpaid custom config, write idempotency, stale editor protection, encrypted storage and local checks never unlock formal mode');

  assert.equal((await getConfig(a,url)).status,'pending_validation');
  await sql.query("INSERT INTO activity_wechat_verifications(activity_id,verified_at,valid_until,evidence_reference,credential_id) SELECT $1::text::uuid,clock_timestamp(),clock_timestamp()+interval '24 hours','test-check-message',credential_id FROM wechat_configurations WHERE scope=$1::text",[activity.id]);
  const verifiedCheck=await getConfig(a,url);
  assert.equal(verifiedCheck.status,'ready');
  assert.match(verifiedCheck.message,/微信接入已就绪/);
  assert.equal((await getConfig(a,url)).status,'ready');
  await sql.query("UPDATE activity_wechat_verifications SET verified_at=clock_timestamp()-interval '2 days',valid_until=clock_timestamp()-interval '1 day' WHERE activity_id=$1",[activity.id]);
  const expiredCheck=await getConfig(a,url);
  assert.equal(expiredCheck.status,'pending_validation');
  assert.match(expiredCheck.message,/检查微信接入/);
  await sql.query('DELETE FROM activity_wechat_verifications WHERE activity_id=$1',[activity.id]);
  passed('configuration check reports valid, missing and expired OAuth verification accurately');

  await sql.query("UPDATE entitlements SET paid_until=clock_timestamp()-interval '1 second' WHERE user_id=$1",[owner.id]);
  config=await getConfig(a,url);assert.equal(config.source,'custom');assert.equal(config.customAllowed,true);
  assert.equal((await req(a,'POST',url+'/check',{})).status(),422);
  config=await json(await save(a,url,custom,config.version));
  passed('custom configuration remains editable without paid entitlements');

  web=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts')});await web.listen();
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const ownerContext=await browser.newContext({storageState:await a.ctx.storageState(),viewport:{width:1440,height:1000}}),page=await ownerContext.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.getByRole('button',{name:/编辑活动/}).click();await page.getByRole('menuitem',{name:'签到设置',exact:true}).click();
  await page.getByRole('button',{name:'接入步骤',exact:true}).click();await page.getByText('设置授权域名并检查',{exact:true}).waitFor();assert.equal(await page.locator('.guide-steps li').count(),3);assert.equal(await page.locator('.guide-reference').count(),0);await page.getByRole('button',{name:'知道了',exact:true}).click();await page.getByRole('button',{name:'修改配置',exact:true}).click();await page.getByLabel('AppID',{exact:true}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'使用方式',exact:true}).count(),0);
  assert.equal(await page.getByLabel('AppSecret',{exact:true}).inputValue(),'');assert.equal(await page.getByRole('button',{name:'保存配置',exact:true}).isDisabled(),false);
  assert.equal(await page.getByRole('button',{name:'检查微信接入',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'刷新配置状态'}).count(),0);
  await page.screenshot({path:path.join(root,'artifacts/wechat-activity.png'),fullPage:true});
  await page.getByLabel('服务号名称').fill('自己的服务号');
  await page.getByRole('button',{name:'保存配置',exact:true}).click();
  await page.locator('.el-message:not(.el-message-fade-leave-active)').filter({hasText:'服务号配置已保存'}).waitFor();
  assert.equal(await page.getByLabel('AppSecret',{exact:true}).inputValue(),'');assert.deepEqual(errors,[]);
  await page.getByLabel('上传微信校验文件',{exact:true}).setInputFiles({name:'MP_verify_fixture123.txt',mimeType:'text/plain',buffer:Buffer.from('FixtureVerificationToken123')});
  await page.locator('.el-message:not(.el-message-fade-leave-active)').filter({hasText:'校验文件已上传'}).waitFor();
  assert.equal(await page.getByLabel('微信校验文件名',{exact:true}).inputValue(),'MP_verify_fixture123.txt');
  assert.equal(await readFile(path.join(verificationDirectory,'MP_verify_fixture123.txt'),'utf8'),'FixtureVerificationToken123');
  await ownerContext.close();passed('browser independent configuration, upload writes original token and fills filename');

  // Exercise the actual HTTPS fetch and endpoint against an isolated TLS fixture.
  const openssl=process.env.OPENSSL_PATH??(process.platform==='win32'?'D:/Program Files/Git/mingw64/bin/openssl.exe':'openssl');
  const cert=path.join(directory,'fixture.crt'),keyFile=path.join(directory,'fixture.key');
  execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
  const filename='MP_verify_fixture123.txt',token='FixtureVerificationToken123';
  let served=token;
  httpsServer=createHttpsServer({key:await readFile(keyFile),cert:await readFile(cert)},(req,res)=>{res.writeHead(req.url==='/'+filename?200:404);res.end(served);});
  await new Promise(resolve=>httpsServer.listen(0,'127.0.0.1',resolve));
  publicOrigin='https://127.0.0.1:'+httpsServer.address().port;
  process.env.NODE_EXTRA_CA_CERTS=cert;process.env.WECHAT_OAUTH_PROVIDER='wechat';
  await stopChild(api);api=await launch();
  const input={filename,domainConfirmed:true};
  const uploadPath=url+'/verification-file',version=(await getConfig(a,url)).version;
  assert.equal((await req(anon,'POST',uploadPath,{filename,content:token},undefined,{'If-Match':version})).status(),401);
  assert.equal((await req(b,'POST',uploadPath,{filename,content:token},undefined,{'If-Match':version})).status(),404);
  assert.equal((await req(a,'POST',uploadPath,{filename:'../private.txt',content:token},undefined,{'If-Match':version})).status(),422);
  assert.equal((await req(a,'POST',uploadPath,{filename,content:'<html>bad</html>'},undefined,{'If-Match':version})).status(),422);
  assert.equal((await req(a,'POST',uploadPath,{filename,content:token},undefined,{'If-Match':'0'})).status(),409);
  await json(await req(a,'POST',uploadPath,{filename,content:token},undefined,{'If-Match':version}));
  assert.equal(await readFile(path.join(verificationDirectory,filename),'utf8'),token);
  await json(await req(a,'POST',uploadPath,{filename,content:token},undefined,{'If-Match':version}));
  assert.equal((await req(a,'POST',uploadPath,{filename,content:'DifferentToken123'},undefined,{'If-Match':version})).status(),409);
  assert.equal(await readFile(path.join(verificationDirectory,filename),'utf8'),token);
  assert.equal((await req(b,'POST',url+'/check',input)).status(),404);
  assert.equal((await req(a,'POST',url+'/check',{...input,domainConfirmed:false})).status(),422);
  assert.equal((await req(a,'POST',url+'/check',input,undefined,{'If-Match':'0'})).status(),409);
  assert.equal((await req(a,'POST',url+'/check',{...input,filename:'../secret'})).status(),422);
  served='<html>fallback</html>';assert.equal((await req(a,'POST',url+'/check',input)).status(),422);
  assert.equal((await getConfig(a,url)).status,'pending_validation');
  served=token;
  assert.equal((await json(await req(a,'POST',url+'/check',input))).status,'ready');
  assert.equal((await getConfig(a,url)).status,'ready');
  assert.equal((await getConfig(a,'activities/'+activity.id+'/configuration')).wechatVerified,true);
  assert.equal((await sql.query('SELECT * FROM activity_wechat_verifications')).rowCount,0);
  await unlink(path.join(verificationDirectory,filename));
  assert.equal((await getConfig(a,'activities/'+activity.id+'/configuration')).wechatVerified,false);
  await writeFile(path.join(verificationDirectory,filename),token);
  served='WrongVerificationToken';assert.equal((await req(a,'POST',url+'/check',input)).status(),422);
  assert.equal((await getConfig(a,url)).status,'pending_validation');
  served=token;await json(await req(a,'POST',url+'/check',input));
  config=await getConfig(a,url);await json(await save(a,url,custom,config.version));
  assert.equal((await getConfig(a,'activities/'+activity.id+'/configuration')).wechatVerified,false);
  await json(await req(a,'POST',url+'/check',input));
  const readyConfig=await getConfig(a,'activities/'+activity.id+'/configuration');
  await json(await req(a,'POST','activities/'+activity.id+'/mode/promote',{confirmation:'promote',generation:readyConfig.runs.find(r=>r.mode==='rehearsal').generation},undefined,{'If-Match':readyConfig.version}));
  assert.equal((await getConfig(a,'activities/'+activity.id+'/configuration')).phase,'formal');
  passed('HTTPS file check unlocks formal mode without OAuth; confirmation, ownership, stale edits, file removal and credential changes enforced');

  const run=(await sql.query("SELECT * FROM activity_runs WHERE activity_id=$1 AND mode='formal'",[activity.id])).rows[0];
  await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version) VALUES($1,$2,$3,'test-formal','正式隔离测试',$4)",[activity.id,run.id,run.generation,cfg.version]);
  config=await getConfig(a,url);assert.ok(config.lockedReason.includes('正式签到'));
  assert.equal((await save(a,url,custom,config.version)).status(),409);
  await sql.query("UPDATE activities SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",[activityB.id]);
  const expired=await getConfig(b,urlB);assert.ok(expired.lockedReason.includes('到期'));assert.equal((await save(b,urlB,custom,expired.version)).status(),409);
  passed('formal identity lock and expired activity read-only behavior');

  const stored=(await sql.query('SELECT id,sealed_secret FROM wechat_credentials WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 1',[owner.id])).rows[0];
  const vault=(await import('../apps/api/build/activities/wechat-vault.js')).default;
  assert.equal(vault.openSecret(stored.sealed_secret,stored.id),custom.appSecret);
  await stopChild(api);const correctKey=process.env.WECHAT_MASTER_KEY;delete process.env.WECHAT_MASTER_KEY;api=await launch();
  assert.equal((await req(a,'POST',url+'/check',{})).status(),503);process.env.WECHAT_MASTER_KEY=correctKey;
  passed('retained encrypted versions decrypt correctly and missing master key fails safely');
  await writeFile(path.join(root,'artifacts/wechat-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:results},null,2));
}finally{
 await browser?.close();await web?.close();await new Promise(resolve=>httpsServer?httpsServer.close(resolve):resolve());for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();
}
console.info('WeChat configuration verification complete: '+results.length+' checks.');

