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
 const audit=(who=a,query='')=>who.ctx.get('/api/v1/'+path+'/audit'+query);
 assert.equal((await audit(anon)).status(),401);assert.equal((await audit(b)).status(),404);
 assert.equal((await audit(a,'?page=0')).status(),422);assert.equal((await audit(a,'?category=private')).status(),422);assert.equal((await audit(a,'?start=2026-02-31')).status(),422);
 assert.equal((await audit(a,'?start=2026-10-01&end=2026-09-01')).status(),422);
 let list=await json(await audit());assert.ok(list.items.some(x=>x.title==='创建活动'));assert.equal(list.items[0].mode,'rehearsal');
 const ownerId=(await sql.query('SELECT owner_id FROM activities WHERE id=$1',[activity.id])).rows[0].owner_id;
 const sentinel='should-never-leak-secret';await sql.query("INSERT INTO business_audit(actor_id,target_user_id,activity_id,action,details) VALUES($1,$1,$2,'wechat_configuration_saved',$3)",[ownerId,activity.id,JSON.stringify({source:'custom',appSecret:sentinel,credentialId:sentinel,access_token:sentinel})]);
 list=await json(await audit());assert.ok(!JSON.stringify(list).includes(sentinel));assert.equal(list.items[0].lines[0],'使用自定义服务号');
 passed('activity ownership, login, filters and explicit display allowlist protect audit data');
 let cfg=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));
 const prizeId=randomUUID();const saveKey=randomUUID();
 const prizeBody={value:[{id:prizeId,name:'操作记录测试奖',total:1,batch:1,mode:'random',theme:'dream-planet'}]};
 for(let i=0;i<2;i++)await json(await req(a,'PUT',path+'/configuration/prizes',prizeBody,saveKey,{'If-Match':cfg.version}));
 list=await json(await audit(a,'?category=settings&mode=rehearsal'));assert.equal(list.items.filter(x=>x.title==='修改奖项').length,1);
 await json(await req(a,'PUT',path+'/configuration/prizes',prizeBody,undefined,{'If-Match':'0'}).then(async response=>{assert.equal(response.status(),409);return a.ctx.get('/api/v1/'+path+'/audit');}));
 assert.equal((await json(await audit(a,'?category=settings&mode=rehearsal'))).items.filter(x=>x.title==='修改奖项').length,1);
 passed('successful idempotent retry logs once; rejected configuration changes do not appear as saved operations');
 const join='/api/v1/dev-join/'+activity.id,entry=await json(await anon.ctx.get(join));
 const person=await json(await req(anon,'POST','dev-join/'+activity.id+'/checkins',{generation:entry.generation,version:entry.version,nickname:'操作记录测试来宾',answers:{}}));
 const details=await json(await a.ctx.get('/api/v1/'+path+'/participants/'+person.id+'?mode=rehearsal'));
 await json(await req(a,'POST',path+'/participants/'+person.id+'/eligibility',{mode:'rehearsal',generation:entry.generation,reason:'审计测试',eligible:false},undefined,{'If-Match':details.version}));
 const excluded=await json(await a.ctx.get('/api/v1/'+path+'/participants/'+person.id+'?mode=rehearsal'));
 await json(await req(a,'POST',path+'/participants/'+person.id+'/eligibility',{mode:'rehearsal',generation:entry.generation,reason:'恢复测试',eligible:true},undefined,{'If-Match':excluded.version}));
 list=await json(await audit(a,'?category=participants'));assert.equal(list.total,2);assert.ok(list.items.every(x=>x.mode==='rehearsal'));assert.ok(JSON.stringify(list).includes(person.id));
 let drawState=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));
 const tabId=randomUUID(),baseBody={mode:'rehearsal',generation:entry.generation,tabId};
 const lease=await json(await req(a,'POST',path+'/draw/claim',baseBody));
 const started=await json(await req(a,'POST',path+'/draw/start',{...baseBody,fence:String(lease.fence),prizeId,version:drawState.version}));
 await json(await req(a,'POST',path+'/draw/stop',{...baseBody,fence:String(lease.fence),roundId:started.roundId}));
 drawState=await json(await a.ctx.get('/api/v1/'+path+'/draw?mode=rehearsal'));
 await json(await req(a,'POST',path+'/draw/void',{...baseBody,fence:String(lease.fence),awardId:drawState.awards[0].id,confirmed:true}));
 assert.equal((await a.ctx.get('/api/v1/'+path+'/awards/download?mode=rehearsal')).status(),200);
 list=await json(await audit(a,'?category=draw'));assert.equal(list.total,3);assert.ok(list.items.some(x=>x.title.includes('不在场')));assert.ok(list.items.every(x=>x.mode==='rehearsal'));
 assert.ok((await json(await audit(a,'?category=data'))).items.some(x=>x.title==='生成中奖名单下载文件'));
 passed('exclude, restore, start, stop, void and winner export produce readable mode-tagged records');
 web=await createServer({root:nodePath.join(root,'apps/web'),configFile:nodePath.join(root,'apps/web/vite.config.ts')});await web.listen();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const owner=await browser.newContext({storageState:await a.ctx.storageState(),viewport:{width:1440,height:960},reducedMotion:'reduce'});
 const page=await owner.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.getByRole('button',{name:/编辑活动/}).click();await page.getByRole('menuitem',{name:'操作记录',exact:true}).click();
 await page.locator('.audit-table').getByText('排除抽奖资格',{exact:true}).waitFor();
 await page.locator('.el-select').filter({has:page.getByRole('combobox',{name:'操作类型',exact:true})}).click();await page.getByRole('option',{name:'抽奖操作',exact:true}).click();await page.getByRole('button',{name:'筛选',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.audit-table tbody tr').length===3);
 assert.equal(await page.locator('.audit-filters').evaluate(el=>getComputedStyle(el).display),'grid');
 await page.getByLabel('开始日期',{exact:true}).click();await page.locator('.el-picker-panel:visible').waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.el-popper')].some(el=>el.getBoundingClientRect().height>100&&getComputedStyle(el).opacity==='1'&&!String(el.className).includes('enter')));
 await page.screenshot({path:nodePath.join(root,'artifacts/ui-date-picker.png'),fullPage:true});
 await page.locator('.el-picker-panel:visible .el-date-table td.today').click();
 await page.getByRole('button',{name:'筛选',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.audit-table tbody tr').length===3);
 assert.ok(await page.getByLabel('开始日期',{exact:true}).inputValue());
 await page.screenshot({path:nodePath.join(root,'artifacts/audit-desktop.png'),fullPage:true});
 assert.deepEqual(errors,[]);passed('desktop audit module displays readable rows and filters without exposing raw JSON');
 cfg=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));
 await json(await req(a,'POST',path+'/mode/clear-rehearsal',{confirmation:'clear-rehearsal',generation:entry.generation},undefined,{'If-Match':cfg.version}));
 list=await json(await audit());assert.ok(!JSON.stringify(list).includes(person.id));assert.ok(!JSON.stringify(list).includes(started.roundId));assert.ok(list.items.some(x=>x.title==='清空全部彩排数据'));
 const stored=(await sql.query("SELECT details FROM business_audit WHERE activity_id=$1 AND action='participant_exclude'",[activity.id])).rows[0].details;
 assert.deepEqual(stored,{mode:'rehearsal',historyCleared:true});
 await page.getByRole('button',{name:'活动有更新，查看最新记录'}).waitFor();await page.getByRole('button',{name:'重置',exact:true}).click();await page.locator('.audit-table').getByText('清空全部彩排数据',{exact:true}).waitFor();
 passed('clearing rehearsal redacts historical person associations while retaining operation trail');
 for(let i=0;i<30;i++)await sql.query("INSERT INTO business_audit(actor_id,target_user_id,activity_id,action,details) VALUES($1,$1,$2,'activity_updated','{}')",[ownerId,activity.id]);
 const first=await json(await audit(a,'?page=1')),second=await json(await audit(a,'?page=2'));assert.equal(first.items.length,25);assert.ok(second.items.length);assert.ok(!first.items.some(x=>second.items.some(y=>x.id===y.id)));
 await sql.query("UPDATE activities SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",[activity.id]);assert.equal((await json(await audit())).phase,'expired');
 assert.equal((await req(a,'POST',path+'/audit',{})).status(),404);
 passed('pagination is deterministic; expired activities remain readable; no audit mutation endpoint exists');
 await writeFile(nodePath.join(root,'artifacts/audit-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:results},null,2));
}finally{
 await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();
}
console.info('Audit verification complete: '+results.length+' checks.');
