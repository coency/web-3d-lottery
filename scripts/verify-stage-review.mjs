import {provisionFixtureAccount} from './lib/account-fixture.mjs';
import assert from 'node:assert/strict';
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
const directory=await mkdtemp(nodePath.join(root,'artifacts/stage-review-'));
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

try{
 db=await startLocalDatabase({directory,port:dbPort});await migrate(db.connectionString);
 sql=new pg.Client({connectionString:db.connectionString});await sql.connect();api=await launch();
 const a=await agent();
 await register(a,'13800000031');await login(a,'13800000031');
 const req=(who,method,url,body,key=randomUUID(),headers={})=>who.ctx.fetch('/api/v1/'+url,{method,data:body,headers:{'X-CSRF-Token':who.csrf,'Idempotency-Key':key,...headers}});
 const json=async r=>{assert.equal(r.status(),200,await r.text());return (await r.json()).data;};
 const activity=await json(await req(a,'POST','activities',{name:'服务端抽奖验收',expiresAt:new Date(Date.now()+86400000).toISOString(),logoAssetId:null,h5BackgroundAssetId:null,stageBackgroundAssetId:null,tagline:'',organizer:'',coorganizer:'',display:{logo:true,tagline:true,organizer:true,coorganizer:true,h5Background:true,stageBackground:true}}));
 const path='activities/'+activity.id;
 const cfg=()=>jsonResponse(a.ctx.get('/api/v1/'+path+'/configuration'));
 async function jsonResponse(p){return json(await p);}
 let config=await cfg(),run=config.runs.find(r=>r.mode==='rehearsal');

 const fields=['部门','公司'].map(name=>({id:randomUUID(),name,type:'text',required:false,hint:'',options:[]}));
 const form={fields,titleFieldId:null,auxiliaryFieldIds:fields.map(f=>f.id)};
 await json(await req(a,'PUT',path+'/configuration/form',{value:form},undefined,{'If-Match':config.version}));
 config=await cfg();
 await json(await req(a,'POST',path+'/rehearsal/simulated-participants',{target:300,generation:run.generation},undefined,{'If-Match':config.version}));
 const longName='超长微信昵称ABCDEFGHIJKLMNOPQRSTUVWXYZ测试完整名字不被修改';
 await sql.query('UPDATE activity_participants SET nickname=$2,answers=$3 WHERE activity_id=$1',[activity.id,longName,JSON.stringify(Object.fromEntries(fields.map(f=>[f.id,f.name+'：很长的参与者填写信息用于验证卡片布局和文字截断'])))]);
 config=await cfg();
 const themes=['dream-planet','starlight-matrix','star-wave','starlight-corridor','galaxy-waterfall'];
 const prizes=[...Array.from({length:10},(_,i)=>({theme:themes[0],batch:i+1})),...themes.slice(1).map(theme=>({theme,batch:10}))].map(p=>({...p,id:randomUUID(),name:p.theme+'-'+p.batch,total:p.batch,mode:'random'}));
 await json(await req(a,'PUT',path+'/configuration/prize-settings',{value:{rule:{mode:'once',maxWins:null},prizes,reservations:[]}},undefined,{'If-Match':config.version}));
 web=await createServer({root:nodePath.join(root,'apps/web'),configFile:nodePath.join(root,'apps/web/vite.config.ts')});await web.listen();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1625,height:884},storageState:await a.ctx.storageState()});
 const stage=await context.newPage(),browserErrors=[],serverErrors=[],failures=[],checks=[];
 stage.on('pageerror',e=>browserErrors.push(e.message));
 stage.on('response',r=>{if(r.status()>=500)serverErrors.push({url:new URL(r.url()).pathname,status:r.status()});});
 if(process.env.STAGE_CHECK_AVATAR_FAILURE==='1')await stage.route('**/demo-avatars/**',route=>route.abort());
 await stage.goto(origin+'/stage.html?activity='+activity.id+'&mode=rehearsal');
 const ready=()=>stage.waitForFunction(()=>!document.querySelector('#draw').disabled&&!document.body.classList.contains('revealing'));
 async function pressAction(key,action){
  await ready();const response=stage.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/draw/'+action));
  await stage.keyboard.press(key);const result=await response;assert.equal(result.status(),200,await result.text());
  if(action==='next')await stage.waitForFunction(()=>!document.body.classList.contains('result'));
  else await ready();
 }
 async function layoutCheck(label,width,height){
  await stage.setViewportSize({width,height});
  await stage.waitForFunction(width=>{const s=document.querySelector('#stage'),c=document.querySelector('.winner-universe');return s.clientWidth===width&&c.height===s.clientHeight&&c.width===width;},width);
  const value=await stage.evaluate(()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
   const cards=[...document.querySelectorAll('.winner-slot')].map(e=>{const r=rect(e),before=getComputedStyle(e,'::before'),name=e.querySelector('h3');return {...r,y:r.y+parseFloat(before.top),bottom:r.bottom-parseFloat(before.bottom),name:name.textContent,full:name.title,clipped:name.scrollWidth>name.clientWidth,ellipsis:getComputedStyle(name).textOverflow,aux:[...e.querySelectorAll('.winner-caption p')].map(p=>({full:p.title,text:p.textContent,ellipsis:getComputedStyle(p).textOverflow}))};});
   return {cards,header:rect(document.querySelector('header')),note:rect(document.querySelector('#resultNote')),title:!!document.querySelector('#winnerTitle'),stageHeight:document.querySelector('#stage').clientHeight};
  });
  const issues=[];
  if(value.title)issues.push('result title still present');
  for(let i=0;i<value.cards.length;i++){
   const c=value.cards[i];
   if(c.x<0||c.right>width||c.y<value.header.bottom||c.bottom>value.note.y)issues.push('card '+i+' exceeds header/footer/viewport boundary');
   if(c.name!==longName||c.full!==longName||c.ellipsis!=='ellipsis'||!c.clipped)issues.push('nickname truncation or full title incorrect');
   if(c.aux.length!==0)issues.push('removed auxiliary fields still displayed');
   for(let j=i+1;j<value.cards.length;j++){const b=value.cards[j];if(!(c.right<=b.x||b.right<=c.x||c.bottom<=b.y||b.bottom<=c.y))issues.push('cards '+i+' and '+j+' overlap');}
  }
  if(issues.length){failures.push({label,width,height,issues:[...new Set(issues)],value});if(failures.length<=4)await stage.screenshot({path:nodePath.join(directory,'failure-'+failures.length+'.png')});}
  checks.push({label,width,height,cards:value.cards.length,issues:[...new Set(issues)]});
  await writeFile(nodePath.join(directory,'results.json'),JSON.stringify({checks,failures,browserErrors,serverErrors},null,2));
 }
 for(const prize of prizes){
  await stage.waitForFunction(name=>document.querySelector('#prizeName').textContent===name,prize.name);
  await stage.setViewportSize({width:1625,height:884});
  await pressAction('Space','start');await pressAction('Space','stop');
  assert.equal(await stage.locator('.winner-slot').count(),prize.batch);
  for(const [width,height] of [[1625,884],[1280,696],[1920,1080],[390,844],[360,740],[600,800],[601,800]])await layoutCheck(prize.name,width,height);
  await stage.setViewportSize({width:1625,height:884});
  await stage.waitForFunction(()=>document.querySelector('.winner-universe').width===1625);
  if(prize.batch===10){
   await stage.screenshot({path:nodePath.join(directory,prize.theme+'.png')});
   const before=await stage.locator('.winner-slot').evaluateAll(els=>els.map(e=>({id:e.dataset.id,x:e.style.left,y:e.style.top})));
   await stage.locator('.void-person').first().click();
   const response=stage.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/draw/void'));
   await stage.locator('#acceptConfirm').click();assert.equal((await response).status(),200);
   await stage.waitForFunction(()=>document.querySelectorAll('.winner-slot.vacant').length===1);await ready();
   await pressAction('Space','start');await pressAction('Space','stop');
   const after=await stage.locator('.winner-slot').evaluateAll(els=>els.map(e=>({id:e.dataset.id,x:e.style.left,y:e.style.top})));
   assert.equal(after.length,10);assert.notEqual(after[0].id,before[0].id);assert.deepEqual(after.slice(1),before.slice(1));
   await layoutCheck(prize.name+'-refill',1625,884);
   passed(prize.theme+' animated draw/refill retains the other nine winners and their positions');
  }
  if(prize===prizes[0]&&process.env.STAGE_CHECK_AVATAR_FAILURE==='1'){
   assert.equal(await stage.locator('#joined').textContent(),'300');
   assert.match(await stage.locator('#portraitProgress').textContent(),/本机已缓存 0 张/);
   passed('avatar download failures do not remove participants or prevent server-selected winners');
   await stage.unroute('**/demo-avatars/**');await stage.evaluate(()=>window.dispatchEvent(new Event('online')));
   await stage.waitForFunction(()=>document.querySelector('#portraitProgress').textContent.includes('本机已缓存 300 张'));
   await stage.keyboard.press('h');await stage.locator('#portraitProgress').scrollIntoViewIfNeeded();
   await stage.screenshot({path:nodePath.join(directory,'portrait-preparation.png')});await stage.keyboard.press('Escape');
   passed('online recovery prepares missing files and exposes progress in the help panel');
  }
  await pressAction('Enter','next');assert.equal(await stage.locator('.winner-slot').count(),0);
  console.log('CHECKED '+prize.name);
 }
 await writeFile(nodePath.join(directory,'results.json'),JSON.stringify({checks,failures,browserErrors,serverErrors},null,2));
 console.log('Review evidence: '+directory);
 assert.deepEqual(browserErrors,[]);assert.deepEqual(serverErrors,[]);assert.equal(failures.length,0,JSON.stringify(failures.map(({label,width,height,issues})=>({label,width,height,issues}))));
 passed('1–10 winners, five themes, seven viewport sizes, long names, single-field display and result restoration');
}finally{await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();}

