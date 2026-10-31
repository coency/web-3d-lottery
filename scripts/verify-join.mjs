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
 const join='/api/v1/dev-join/'+activity.id;
 const entry=await json(await anon.ctx.get(join));
 assert.equal(entry.person,null);assert.equal(entry.development,true);
 const payload={generation:entry.generation,version:entry.version,nickname:'星光测试者',answers:{}};
 const submit=(who,body=payload)=>req(who,'POST','dev-join/'+activity.id+'/checkins',body);
 const people=await Promise.all([submit(anon),submit(anon)]);
 const first=await json(people[0]),second=await json(people[1]);assert.equal(first.id,second.id);
 assert.equal((await json(await anon.ctx.get(join))).person.id,first.id);
 assert.equal((await json(await submit(anon,{...payload,nickname:'不能覆盖'}))).nickname,'星光测试者');
 assert.equal((await anon.ctx.get(entry.logoUrl)).status(),200);
 const state=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));
 assert.equal(state.signedIn,1);
 const stagePeople=await json(await a.ctx.get('/api/v1/'+path+'/stage-people?mode=rehearsal'));
 assert.equal(stagePeople.items[0].id,first.id);assert.equal(stagePeople.items[0].avatarUrl,'/demo-avatar.svg');
 assert.equal((await anon.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal')).status(),401);
 passed('anonymous rehearsal checkin is idempotent, private to signed identity, and visible to the stage without exposing roster');

 let cfg=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));
 const field=randomUUID(),choice=randomUUID();
 const form={fields:[{id:field,name:'部门',type:'text',required:true,hint:'请填写部门',options:[]},{id:randomUUID(),name:'身份',type:'single',required:false,hint:'请选择身份',options:[{id:choice,label:'嘉宾'}]},{id:randomUUID(),name:'备注',type:'text',required:false,hint:'可不填写',options:[]}],titleFieldId:null,auxiliaryFieldIds:[]};
 form.signupFieldIds=form.fields.map(f=>f.id);
 const bg=await json(await req(a,'POST','assets/uploads',{purpose:'h5_background',activityId:activity.id}));
 const bgBytes=await sharp({create:{width:360,height:640,channels:3,background:'#1d2449'}}).png().toBuffer();
 await json(await req(a,'PUT','assets/'+bg.id+'/content',bgBytes,undefined,{'Content-Type':'application/octet-stream'}));
 await json(await req(a,'PUT',path+'/configuration/checkin',{value:{form,h5BackgroundAssetId:bg.id,showBackground:true}},undefined,{'If-Match':cfg.version}));
 const fresh=await agent(),newEntry=await json(await fresh.ctx.get(join));
 assert.equal((await fresh.ctx.get(newEntry.backgroundUrl)).status(),200);
 assert.equal((await submit(fresh,{...payload,generation:newEntry.generation,version:newEntry.version})).status(),422);
 assert.equal((await submit(fresh,payload)).status(),409);
 assert.equal((await fresh.ctx.post(join+'/checkins',{data:{...payload,version:newEntry.version},headers:{Origin:'https://foreign.test'}})).status(),403);
 passed('required fields, stale form versions and foreign-origin writes are rejected');

 web=await createServer({root:nodePath.join(root,'apps/web'),configFile:nodePath.join(root,'apps/web/vite.config.ts')});await web.listen();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/join.html?activity='+activity.id);
 await page.getByLabel('彩排昵称').fill('手机测试者');await page.getByLabel('部门').fill('市场部');
 await page.locator('.el-select').filter({has:page.getByRole('combobox',{name:'身份',exact:true})}).click();await page.getByRole('option',{name:'嘉宾',exact:true}).click();
 await page.screenshot({path:nodePath.join(root,'artifacts/join-form.png'),fullPage:true});
 await page.getByRole('button',{name:'签到，开启幸运时刻'}).click();await page.getByRole('heading',{name:'签到成功'}).waitFor();
 assert.deepEqual(await page.locator('.signup-details dd').allTextContents(),['市场部','嘉宾']);
 await page.reload();await page.getByRole('heading',{name:'签到成功'}).waitFor();
 assert.deepEqual(await page.locator('.signup-details dd').allTextContents(),['市场部','嘉宾']);
 await page.screenshot({path:nodePath.join(root,'artifacts/join-success.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 const roster=await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal'));
 assert.ok(JSON.stringify(roster).includes('手机测试者'));assert.ok(JSON.stringify(roster).includes('市场部'));
 passed('mobile-sized H5 renders required form, persists signup across reload and updates admin roster');

 cfg=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));
 const prizeId=randomUUID();
 await json(await req(a,'PUT',path+'/configuration/prizes',{value:[{id:prizeId,name:'签到联通奖',total:1,batch:1,mode:'random',theme:'dream-planet'}]},undefined,{'If-Match':cfg.version}));
 const ownerContext=await browser.newContext({storageState:await a.ctx.storageState(),viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const admin=await ownerContext.newPage();await admin.goto(origin);
 await admin.getByRole('button',{name:'报名二维码',exact:true}).click();
 await admin.getByText('签到暂不可用',{exact:true}).waitFor();assert.equal(await admin.locator('.join-entry img').count(),0);
 await admin.locator('.join-entry .el-dialog__headerbtn').click();
 // QR rendering is a UI fixture; actual OAuth validation is covered by verify-oauth.
 const qrResponse=async route=>{const response=await route.fetch(),body=await response.json();body.data={...body.data,available:true,provider:'wechat'};return {response,body:JSON.stringify(body)};};
 await admin.route('**/join-entry?mode=rehearsal',async route=>route.fulfill(await qrResponse(route)));
 await admin.getByRole('button',{name:'报名二维码',exact:true}).click();
 await admin.locator('.join-entry img').waitFor();assert.equal(await admin.locator('.join-entry img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
 await admin.waitForFunction(()=>[...document.querySelectorAll('.el-overlay')].some(el=>getComputedStyle(el).opacity==='1'&&!el.className.includes('enter')));await admin.screenshot({path:nodePath.join(root,'artifacts/join-entry.png'),fullPage:true});
 await admin.locator('.join-entry .el-dialog__headerbtn').click();
 const live=await json(await fresh.ctx.get(join));
 await json(await submit(fresh,{generation:live.generation,version:live.version,nickname:'自动同步测试者',answers:{[field]:'运营'}}));
 await admin.waitForFunction(()=>document.querySelector('.cover-metrics strong')?.textContent?.trim()==='3 人',{},{timeout:20000});
 await admin.getByRole('button',{name:/编辑活动/}).click();await admin.getByRole('menuitem',{name:'签到名单',exact:true}).click();
 const live2=await json(await b.ctx.get(join));
 await json(await submit(b,{generation:live2.generation,version:live2.version,nickname:'名单同步测试者',answers:{[field]:'研发'}}));
 await admin.locator('tbody').getByText('名单同步测试者',{exact:true}).waitFor({timeout:15000});
 const stage=await ownerContext.newPage();await stage.goto(origin+'/stage.html?activity='+activity.id+'&mode=rehearsal');
 await stage.waitForFunction(()=>document.querySelector('#joined')?.textContent==='4');
 await stage.waitForFunction(()=>document.querySelector('#draw')?.disabled===false);
 let releaseFirst,firstRequested,releaseSecond;
 const firstPending=new Promise(resolve=>firstRequested=resolve);
 const firstRelease=new Promise(resolve=>releaseFirst=resolve);
 const secondRelease=new Promise(resolve=>releaseSecond=resolve);
 let entries=0;
 await stage.route('**/join-entry?mode=rehearsal',async route=>{
  const response=await qrResponse(route);
  if(++entries===1){firstRequested();await firstRelease;}
  else if(entries===2)await secondRelease;
  await route.fulfill(response);
 });
 await stage.keyboard.press('q');await firstPending;
 // Reopen before the queued close event is delivered, then release the new response.
 await stage.evaluate(()=>new Promise(resolve=>{
  const dialog=document.querySelector('#qrDialog');
  dialog.addEventListener('close',()=>resolve(),{once:true});
  dialog.close();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'q',bubbles:true}));
 }));
 releaseSecond();await stage.locator('#qrDialog img').waitFor();
 releaseFirst();await stage.waitForTimeout(300);
 assert.equal(await stage.locator('#qrDialog img').count(),1);
 assert.equal(await stage.locator('#qrDialog a').count(),0);
 await stage.unroute('**/join-entry?mode=rehearsal');await stage.keyboard.press('Escape');
 await stage.keyboard.press('Space');
 await stage.waitForFunction(()=>document.querySelector('#drawLabel')?.textContent==='停止 · 揭晓幸运');
 await stage.keyboard.press('Space');
 await stage.locator('.winner-caption h3').waitFor({state:'visible',timeout:20000});
 const drawn=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));
 assert.equal(drawn.awards.filter(x=>x.status==='valid').length,1);
 await stage.screenshot({path:nodePath.join(root,'artifacts/join-stage.png')});
 await ownerContext.close();
 passed('activity QR opens H5; stage QR, participant count and lottery work with newly signed-up people');

 cfg=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));
 await json(await req(a,'POST',path+'/mode/clear-rehearsal',{confirmation:'clear-rehearsal',generation:entry.generation},undefined,{'If-Match':cfg.version}));
 assert.equal((await submit(fresh,{...payload,version:newEntry.version,answers:{[field]:'工程'}})).status(),409);
 const resetEntry=await json(await anon.ctx.get(join));assert.equal(resetEntry.person,null);assert.ok(resetEntry.generation>entry.generation);
 const afterReset=await json(await submit(anon,{...payload,generation:resetEntry.generation,version:resetEntry.version,answers:{[field]:'工程'}}));
 assert.notEqual(first.id,afterReset.id);
 passed('rehearsal clear invalidates old submissions and retains a stable entry link for a new generation');

 await sql.query("UPDATE activities SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",[activity.id]);
 assert.equal((await json(await anon.ctx.get(join))).person.id,afterReset.id);
 assert.equal((await submit(anon,{...payload,generation:resetEntry.generation,version:resetEntry.version})).status(),200);
 const expiredEntry=await json(await fresh.ctx.get(join));assert.equal(expiredEntry.ended,true);
 assert.equal((await submit(fresh,{...payload,generation:expiredEntry.generation,version:expiredEntry.version,answers:{[field]:'工程'}})).status(),410);
 await sql.query("UPDATE activities SET phase='formal' WHERE id=$1",[activity.id]);assert.equal((await anon.ctx.get(join)).status(),403);
 await sql.query("UPDATE activities SET phase='rehearsal' WHERE id=$1",[activity.id]);
 await sql.query("UPDATE users SET status='disabled' WHERE id=(SELECT owner_id FROM activities WHERE id=$1)",[activity.id]);assert.equal((await anon.ctx.get(join)).status(),403);
 passed('expiry allows own historical state and retry but blocks new signup; formal mode and disabled owners block mock access');
 await stopChild(api);api=await launch('production');assert.equal((await anon.ctx.get(join)).status(),404);assert.equal((await submit(anon)).status(),404);
 passed('production does not register development signup routes');
 await writeFile(nodePath.join(root,'artifacts/join-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:results},null,2));
}finally{
 await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();
}
console.info('Join verification complete: '+results.length+' checks.');
