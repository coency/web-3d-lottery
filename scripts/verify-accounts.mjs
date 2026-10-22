import {provisionFixtureAccount} from './lib/account-fixture.mjs';
import assert from 'node:assert/strict';
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
const directory=await mkdtemp(path.join(root,'artifacts/accounts-'));
const dbPort=await freePort(), apiPort=await freePort(), webPort=await freePort();
const origin='http://127.0.0.1:'+webPort, base='http://127.0.0.1:'+apiPort;
process.env.API_PORT=String(apiPort);process.env.WEB_PORT=String(webPort);
const secret=randomBytes(48).toString('hex');
let db,api,web,browser,sql;
const contexts=[],results=[];
const passed=name=>{results.push(name);console.info('PASS '+name);};
const password='Test-password-123';
async function launch(mode='development'){
  const child=startNode(['apps/api/build/main.js'],{env:{...process.env,NODE_ENV:mode,DATABASE_URL:db.connectionString,AUTH_SECRET:secret,APP_ORIGIN:mode==='development'?origin:'https://example.test',SMS_PROVIDER:mode==='development'?'mock':'disabled'},stdio:'inherit'});
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

async function login(a,account,pw=password,key){
 const res=await send(a,'login',{account,password:pw},key);
 assert.equal(res.status(),200,await res.text());return (await res.json()).data;
}
async function clearLimits(){await sql.query('DELETE FROM auth_limits');}
async function command(action,input){
 return new Promise((resolve,reject)=>{
  const child=startNode(['scripts/account.mjs',action,'--stdin-json'],{env:{...process.env,DATABASE_URL:db.connectionString},stdio:['pipe','pipe','pipe']});
  let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
  child.once('error',reject);child.once('exit',code=>resolve({code,output}));
  child.stdin.end(JSON.stringify(input));
 });
}
try{
 db=await startLocalDatabase({directory,port:dbPort});await migrate(db.connectionString);
 sql=new pg.Client({connectionString:db.connectionString});await sql.connect();
 const pair=await Promise.all([command('init',{account:' Owner.'+'a'.repeat(26)+' ',password}),command('init',{account:'Other.'+'b'.repeat(26),password})]);
 assert.deepEqual(pair.map(r=>r.code).sort(),[0,1]);
 assert.ok(pair.every(r=>!r.output.includes(password)));
 const record=(await sql.query('SELECT * FROM users')).rows[0];
 assert.equal((await sql.query('SELECT * FROM users')).rowCount,1);
 assert.equal(record.phone,null);assert.equal(record.role,'user');assert.match(record.password_hash,/^\$argon2id\$/);
 assert.equal((await sql.query('SELECT * FROM entitlements WHERE user_id=$1',[record.id])).rowCount,1);
 const name=record.login_name;
 assert.equal((await command('init',{account:'another_user',password})).code,1);
 assert.equal((await sql.query('SELECT * FROM users')).rowCount,1);
 passed('server initialization is atomic, concurrent/repeated init refused, no default phone/password or elevated role');
 api=await launch();
 const a=await agent(),b=await agent(),stranger=await agent();
 assert.equal((await a.ctx.get('/api/v1/auth/me')).status(),401);
 assert.equal((await a.ctx.get('/api/v1/activities')).status(),401);
 const payload={account:name,password};
 assert.equal((await send(a,'login',payload,undefined,{Origin:'https://evil.test'})).status(),403);
 assert.equal((await send(a,'login',payload,undefined,{'X-CSRF-Token':'invalid'})).status(),403);
 assert.equal((await send(a,'login',{...payload,role:'platform_admin'})).status(),422);
 for(const action of ['sms','register','reset','change-phone','init','bootstrap'])assert.equal((await send(a,action,{})).status(),404);
 const csrfData=(await(await a.ctx.get('/api/v1/auth/csrf')).json()).data;
 assert.equal('smsMode' in csrfData,false);
 passed('Origin/CSRF and field validation remain enforced; SMS, registration, remote reset and initialization endpoints absent even with mock configured');
 const loginKey=randomUUID();const owner=await login(a,name.toUpperCase(),password,loginKey);
 await login(a,name.toUpperCase(),password,loginKey);
 assert.equal(owner.account,name);assert.equal('phone' in owner,false);
 const session=(await a.ctx.storageState()).cookies.find(c=>c.name==='starlit_session');
 assert.ok(session.httpOnly);assert.equal(session.sameSite,'Lax');
 const stored=(await sql.query('SELECT token_hash FROM sessions WHERE user_id=$1',[owner.id])).rows[0].token_hash;
 assert.equal(stored.length,64);assert.notEqual(stored,session.value);
 await login(b,name);
 assert.equal((await a.ctx.get('/api/v1/auth/me')).status(),401);
 assert.equal((await send(a,'login',{account:name.toUpperCase(),password},loginKey)).status(),401);
 assert.equal((await send(a,'logout',{})).status(),200);
 assert.equal((await b.ctx.get('/api/v1/auth/me')).status(),200);
 passed('canonical account login, protected cookies, idempotent login and session replacement');
 await clearLimits();
 const ca=await agent(),cb=await agent();await Promise.all([login(ca,name),login(cb,name)]);
 assert.deepEqual((await Promise.all([ca.ctx.get('/api/v1/auth/me'),cb.ctx.get('/api/v1/auth/me')])).map(r=>r.status()).sort(),[200,401]);
 assert.equal((await sql.query('SELECT * FROM sessions WHERE user_id=$1',[owner.id])).rowCount,1);
 passed('concurrent logins produce one valid session');
 await provisionFixtureAccount(sql,'13800000002',password);
 // An upgraded phone-only record continues to accept both old and new client payloads.
 await sql.query("UPDATE users SET login_name=NULL,account='legacy_name' WHERE phone='+8613800000002'");
 let legacy=await send(stranger,'login',{phone:'+8613800000002',password});assert.equal(legacy.status(),200);
 const other=(await legacy.json()).data;assert.equal(other.account,'138****0002');
 assert.equal((await login(stranger,'13800000002')).id,other.id);
 assert.equal((await send(stranger,'login',{account:'legacy_name',password})).status(),401);
 const activity=(await sql.query("INSERT INTO activities(owner_id,name,expires_at) VALUES($1,'保留的活动',clock_timestamp()+interval '1 day') RETURNING id",[owner.id])).rows[0].id;
 await login(b,name);
 assert.equal((await b.ctx.get('/api/v1/activities/'+activity)).status(),200);
 assert.equal((await stranger.ctx.get('/api/v1/activities/'+activity)).status(),404);
 passed('legacy phone login and owner isolation preserved; obsolete legacy usernames are not re-enabled');
 const oldState=await b.ctx.storageState();const old=await request.newContext({baseURL:base,storageState:oldState});contexts.push(old);
 const updateKey=randomUUID(),replacement='Updated-password-456';
 assert.equal((await send(b,'change-password',{currentPassword:'Wrong-password-123',newPassword:replacement})).status(),422);
 const update={currentPassword:password,newPassword:replacement};
 assert.equal((await send(b,'change-password',update,updateKey)).status(),200);
 assert.equal((await send(b,'change-password',update,updateKey)).status(),200);
 assert.equal((await send(b,'change-password',{...update,newPassword:'Tampered-password-123'},updateKey)).status(),409);
 assert.equal((await sql.query("SELECT * FROM auth_audit WHERE user_id=$1 AND action='password_changed'",[owner.id])).rowCount,1);
 assert.equal((await old.get('/api/v1/auth/me')).status(),401);
 assert.equal((await b.ctx.get('/api/v1/auth/me')).status(),200);
 assert.equal((await send(a,'login',{account:name,password})).status(),401);
 passed('password change checks original password, rotates session and safely replays lost responses');
 const reset=await command('reset-password',{account:name,password:'Reset-password-789'});
 assert.equal(reset.code,0,reset.output);assert.ok(!reset.output.includes('Reset-password-789'));
 assert.equal((await b.ctx.get('/api/v1/auth/me')).status(),401);
 assert.equal((await send(b,'change-password',update,updateKey)).status(),401);
 assert.equal((await send(a,'login',{account:name,password:replacement})).status(),401);
 await clearLimits();await login(b,name,'Reset-password-789');
 assert.equal((await b.ctx.get('/api/v1/activities/'+activity)).status(),200);
 assert.equal((await command('reset-password',{account:'missing_account',password})).code,1);
 assert.equal((await command('reset-password',{account:name,password:'short'})).code,1);
 await sql.query("UPDATE users SET status='disabled' WHERE id=$1",[owner.id]);
 assert.equal((await b.ctx.get('/api/v1/auth/me')).status(),401);
 assert.equal((await command('reset-password',{account:name,password})).code,1);
 assert.equal((await send(a,'login',{account:name,password:'Reset-password-789'})).status(),401);
 await sql.query("UPDATE users SET status='active' WHERE id=$1",[owner.id]);
 passed('server password reset revokes sessions and receipts, preserves activities, rejects missing/disabled accounts and weak input');
 await clearLimits();
 for(let i=0;i<10;i++)assert.equal((await send(a,'login',{account:i%2?'MISSING.ACCOUNT':' missing.account ',password})).status(),401);
 assert.equal((await send(a,'login',{account:'Missing.Account',password})).status(),429);
 await clearLimits();
 for(let i=0;i<10;i++)assert.equal((await send(a,'login',i%2?{account:'13800000009',password}:{phone:'+8613800000009',password})).status(),401);
 assert.equal((await send(a,'login',{phone:'13800000009',password})).status(),429);
 await clearLimits();
 for(let i=0;i<60;i++)assert.equal((await send(a,'unknown',{})).status(),404);
 assert.equal((await send(a,'unknown',{})).status(),429);
 passed('canonical and legacy login aliases share account limits; IP quotas preserved');
 await clearLimits();await login(b,name,'Reset-password-789');
 await sql.query("UPDATE sessions SET created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE user_id=$1",[owner.id]);
 assert.equal((await b.ctx.get('/api/v1/auth/me')).status(),401);
 passed('expired sessions rejected');
 if(process.env.ACCOUNTS_API_ONLY!=='1'){
  web=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts')});await web.listen();
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('heading',{name:'欢迎回来'}).waitFor();
  assert.equal(await page.getByRole('tab',{name:'注册',exact:true}).count(),0);
  assert.equal(await page.locator('input[name=code],input[name=phone]').count(),0);
  await page.getByRole('button',{name:'忘记密码？'}).click();
  await page.getByText('请联系此系统的部署者重置密码，再使用新密码登录。',{exact:true}).waitFor();
  await page.locator('input[name=account]').fill(name);await page.locator('input[name=password]').fill('Reset-password-789');await page.locator('button[type=submit]').click();
  await page.getByRole('heading',{name:'你好，'+name+'。'}).waitFor();await page.reload();await page.getByRole('heading',{name:'你好，'+name+'。'}).waitFor();
  assert.equal(await page.evaluate(()=>document.cookie.includes('starlit_session')),false);
  await page.locator('.account-trigger').click();await page.getByRole('menuitem',{name:'个人中心',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:'修改手机号',exact:true}).count(),0);
  await page.locator('input[name=currentPassword]').fill('Reset-password-789');await page.locator('input[name=newPassword]').fill('Profile-ui-password-123');await page.locator('input[name=confirmPassword]').fill('Profile-ui-password-123');await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.locator('.el-message:not(.el-message-fade-leave-active)').filter({hasText:'密码已修改'}).waitFor();
  await page.screenshot({path:path.join(root,'artifacts/local-account-profile.png'),fullPage:true});
  await page.reload();await page.locator('.account-trigger').waitFor();
  await page.locator('.account-trigger').click();await page.getByRole('menuitem',{name:'退出登录',exact:true}).click();await page.getByRole('heading',{name:'欢迎回来'}).waitFor();
  await page.screenshot({path:path.join(root,'artifacts/local-account-login.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  passed('browser login/reload, recovery guidance, password change and logout without SMS controls');
 }
 await stopChild(api);api=await launch('production');
 const prod=await request.newContext({baseURL:base});contexts.push(prod);
 const csrfResponse=await prod.get('/api/v1/auth/csrf');assert.ok(csrfResponse.headers()['set-cookie'].includes('Secure'));
 const prodToken=(await csrfResponse.json()).data.csrfToken;
 for(const action of ['sms','register','reset','change-phone','init']){
  const res=await prod.post('/api/v1/auth/'+action,{data:{},headers:{Origin:'https://example.test','X-CSRF-Token':prodToken,'Idempotency-Key':randomUUID(),Cookie:'starlit_csrf='+prodToken}});
  assert.equal(res.status(),404);
 }
 passed('production Secure cookies and removed HTTP provisioning/SMS endpoints verified');
 await writeFile(path.join(root,'artifacts/accounts-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:results},null,2));
}finally{
 await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();
}
console.info('Account verification complete: '+results.length+' checks.');
