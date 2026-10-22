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
const directory=await mkdtemp(nodePath.join(root,'artifacts/roster-'));
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
 let cfg=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));
 const field={id:randomUUID(),name:'原部门',type:'single',hint:'',required:false,options:[{id:randomUUID(),label:'市场部'}]};
 const form={fields:[field],titleFieldId:null,auxiliaryFieldIds:[]};
 await json(await req(a,'PUT',path+'/configuration/form',{value:form},undefined,{'If-Match':cfg.version}));
 cfg=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));const oldVersion=cfg.version;
 const run=cfg.runs.find(r=>r.mode==='rehearsal'),formal=cfg.runs.find(r=>r.mode==='formal');
 await sql.query("DELETE FROM activity_participants WHERE run_id=$1 AND identity_key LIKE 'rehearsal-simulation-%'",[run.id]);
 await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version,answers,eligible,exclusion_kind) SELECT $1,$2,$3,'private-openid-'||n,CASE WHEN n=1 THEN '=SUM(1,2)' WHEN n=2 THEN '同名人员' WHEN n=3 THEN '同名人员' ELSE '签到人员'||n END,$4,$5,n<>4,CASE WHEN n=4 THEN 'manual' ELSE NULL END FROM generate_series(1,2000) n",[activity.id,run.id,run.generation,oldVersion,JSON.stringify({[field.id]:field.options[0].id})]);
 await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version,answers) VALUES($1,$2,$3,'private-formal','正式人员',$4,$5)",[activity.id,formal.id,formal.generation,oldVersion,JSON.stringify({[field.id]:field.options[0].id})]);
 const initial=await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal'));
 assert.equal(initial.total,2000);assert.equal(initial.items.length,25);assert.equal(initial.stats.eligible,1999);assert.ok(!JSON.stringify(initial).includes('private-openid'));
 const page2=await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal&page=2'));
 assert.ok(page2.items.every(p=>!initial.items.some(a=>a.id===p.id)));
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=formal'))).total,1);
 const same=await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal&search='+encodeURIComponent('同名人员')));
 assert.equal(same.total,2);assert.notEqual(same.items[0].id,same.items[1].id);
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal&eligibility=excluded'))).total,1);
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal&search='+encodeURIComponent('%')))).total,0);
 assert.equal((await a.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal&page=-1')).status(),422);
 assert.equal((await b.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal')).status(),404);
 assert.equal((await anon.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal')).status(),401);
 passed('2000 participants paginate, search, deduplicate names, filter and isolate modes/owners without identity keys');
 const personPath=path+'/participants/'+same.items[0].id;
 const readPerson=async()=>json(await a.ctx.get('/api/v1/'+personPath+'?mode=rehearsal'));
 let person=await readPerson();
 assert.ok(!JSON.stringify(person).includes('private-openid'));
 assert.equal((await b.ctx.get('/api/v1/'+personPath+'?mode=rehearsal')).status(),404);
 const correction={mode:'rehearsal',generation:run.generation,reason:'纠正资料',answers:{}},changeKey=randomUUID(),originalVersion=person.version;
 const changed=await json(await req(a,'PATCH',personPath+'/answers',correction,changeKey,{'If-Match':originalVersion}));
 assert.deepEqual(await json(await req(a,'PATCH',personPath+'/answers',correction,changeKey,{'If-Match':originalVersion})),changed);
 person=await readPerson();assert.equal(person.history.length,1);assert.deepEqual(person.answers,{});
 assert.equal((await req(a,'PATCH',personPath+'/answers',correction,undefined,{'If-Match':originalVersion})).status(),409);
 assert.equal((await req(a,'PATCH',personPath+'/answers',{...correction,answers:{[field.id]:'invalid'}},undefined,{'If-Match':person.version})).status(),422);
 assert.equal((await req(a,'PATCH',personPath+'/answers',{...correction,reason:''},undefined,{'If-Match':person.version})).status(),422);
 const prizeId=randomUUID();
 await sql.query('INSERT INTO prize_identities(id,activity_id) VALUES($1,$2)',[prizeId,activity.id]);
 await sql.query("INSERT INTO designated_reservations(activity_id,run_id,generation,participant_id,prize_id,status) VALUES($1,$2,$3,$4,$5,'reserved')",[activity.id,run.id,run.generation,person.id,prizeId]);
 const eligibility={mode:'rehearsal',generation:run.generation,reason:'不参与抽奖',eligible:false};
 assert.equal((await json(await req(a,'POST',personPath+'/eligibility',eligibility,undefined,{'If-Match':person.version}))).releasedReservations,1);
 person=await readPerson();assert.equal(person.eligible,false);assert.equal(person.reserved,0);
 await json(await req(a,'POST',personPath+'/eligibility',{...eligibility,eligible:true},undefined,{'If-Match':person.version}));
 person=await readPerson();assert.equal(person.eligible,true);assert.equal(person.reserved,0);assert.equal(person.history.length,3);
 await sql.query("UPDATE activity_participants SET eligible=false,exclusion_kind='absent' WHERE id=$1",[person.id]);
 assert.equal((await req(a,'POST',personPath+'/eligibility',{...eligibility,eligible:true},undefined,{'If-Match':person.version})).status(),409);
 await sql.query('UPDATE activity_participants SET eligible=true,exclusion_kind=NULL WHERE id=$1',[person.id]);
 const round=(await sql.query("INSERT INTO draw_rounds(activity_id,run_id,generation,prize_id,config_version,status) VALUES($1,$2,$3,$4,$5,'drawing') RETURNING id",[activity.id,run.id,run.generation,prizeId,oldVersion])).rows[0];
 assert.equal((await req(a,'POST',personPath+'/eligibility',eligibility,undefined,{'If-Match':person.version})).status(),409);
 await sql.query("UPDATE draw_rounds SET status='completed' WHERE id=$1",[round.id]);
 await sql.query("UPDATE activities SET phase='formal',first_formal_started_at=clock_timestamp() WHERE id=$1",[activity.id]);
 assert.equal((await req(a,'POST',personPath+'/eligibility',eligibility,undefined,{'If-Match':person.version})).status(),409);
 const formalPerson=(await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=formal'))).items[0];
 assert.equal((await req(a,'POST',path+'/participants/'+formalPerson.id+'/eligibility',{...eligibility,mode:'formal',generation:formal.generation},undefined,{'If-Match':'1'})).status(),409);
 await sql.query("UPDATE activities SET phase='rehearsal',first_formal_started_at=NULL,expires_at=created_at+interval '1 millisecond' WHERE id=$1",[activity.id]);
 assert.equal((await req(a,'POST',personPath+'/eligibility',eligibility,undefined,{'If-Match':person.version})).status(),410);
 await sql.query("UPDATE activities SET phase='rehearsal',expires_at=created_at+interval '1 day' WHERE id=$1",[activity.id]);
 passed('participant correction, retries, versions, reservation release, restoration and mutation locks');
 cfg=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));
 await json(await req(a,'PUT',path+'/configuration/form',{value:{fields:[],titleFieldId:null,auxiliaryFieldIds:[]}},undefined,{'If-Match':cfg.version}));
 const historical=await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal'));
 assert.equal(historical.items[0].fields[0].name,'原部门');assert.equal(historical.items[0].fields[0].value,'市场部');
 const exportKey=randomUUID();
 const job=await json(await req(a,'POST',path+'/exports',{mode:'rehearsal',generation:run.generation},exportKey));
 assert.equal((await json(await req(a,'POST',path+'/exports',{mode:'rehearsal',generation:run.generation},exportKey))).id,job.id);
 await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version) VALUES($1,$2,$3,'late','快照之后的人',$4)",[activity.id,run.id,run.generation,oldVersion]);
 async function waitJob(id,agent=a){for(let i=0;i<60;i++){const data=await json(await agent.ctx.get('/api/v1/'+path+'/exports/'+id));if(data.status==='ready')return data;if(data.status==='failed')throw new Error('Export failed');await new Promise(r=>setTimeout(r,500));}throw new Error('Export timeout');}
 await waitJob(job.id);
 const download=await a.ctx.get('/api/v1/'+path+'/exports/'+job.id+'/download');assert.equal(download.status(),200);
 assert.match(download.headers()['content-type'],/spreadsheetml/);
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await download.body());
 const sheet=workbook.getWorksheet('彩排签到名单');assert.equal(sheet.rowCount,2001);
 assert.equal(sheet.getRow(2).getCell(3).value,'市场部');assert.equal(sheet.getRow(1).getCell(3).value,'原部门');assert.equal(workbook.worksheets.length,1);
 let formulaText=false;sheet.eachRow(row=>row.eachCell(cell=>{assert.notEqual(cell.type,ExcelJS.ValueType.Formula);if(cell.value==='=SUM(1,2)')formulaText=true;assert.ok(!String(cell.value).includes('private-openid'));}));assert.ok(formulaText);
 assert.equal((await b.ctx.get('/api/v1/'+path+'/exports/'+job.id)).status(),404);
 assert.equal((await b.ctx.get('/api/v1/'+path+'/exports/'+job.id+'/download')).status(),404);
 assert.equal((await anon.ctx.get('/api/v1/'+path+'/exports/'+job.id+'/download')).status(),401);
 passed('Excel snapshot preserves historical fields and literal formula text; export retries and downloads are scoped');
 // Simulate a crashed worker and verify persisted snapshot recovery after API restart.
 await stopChild(api);
 await sql.query("UPDATE participant_exports SET status='processing',attempts=1,lease_until=clock_timestamp()-interval '1 second',lease_token=$2,snapshot=$3,file_bytes=NULL WHERE id=$1",[job.id,randomUUID(),JSON.stringify({activityName:'恢复验收',mode:'rehearsal',generation:run.generation,createdAt:new Date().toISOString(),rows:[]})]);
 api=await launch();await waitJob(job.id);
 passed('expired worker lease is recovered from persisted state after API restart');
 cfg=await json(await a.ctx.get('/api/v1/'+path+'/configuration'));
 await json(await req(a,'POST',path+'/mode/clear-rehearsal',{confirmation:'clear-rehearsal',generation:run.generation},undefined,{'If-Match':cfg.version}));
 assert.equal((await a.ctx.get('/api/v1/'+path+'/exports/'+job.id+'/download')).status(),410);
 assert.equal((await req(a,'POST',path+'/exports',{mode:'rehearsal',generation:run.generation},exportKey)).status(),409);
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=rehearsal'))).total,0);
 assert.equal((await json(await a.ctx.get('/api/v1/'+path+'/participants?mode=formal'))).total,1);
 const empty=await json(await req(a,'POST',path+'/exports',{mode:'rehearsal',generation:run.generation+1}));await waitJob(empty.id);
 const emptyBook=new ExcelJS.Workbook();await emptyBook.xlsx.load(await (await a.ctx.get('/api/v1/'+path+'/exports/'+empty.id+'/download')).body());assert.equal(emptyBook.getWorksheet('彩排签到名单').rowCount,1);
 await sql.query("UPDATE participant_exports SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[empty.id]);
 assert.equal((await a.ctx.get('/api/v1/'+path+'/exports/'+empty.id+'/download')).status(),410);
 passed('clearing invalidates old generation exports; formal rows survive and empty XLSX remains valid');
 assert.equal((await sql.query('SELECT count(*)::int n FROM participant_changes WHERE activity_id=$1',[activity.id])).rows[0].n,0);
 assert.equal((await req(a,'PATCH',personPath+'/answers',correction,changeKey,{'If-Match':originalVersion})).status(),404);
 if(process.env.ROSTER_API_ONLY!=='1'){
 // Browser uses isolated fixture activity and real owner login; no participant creation UI.
 web=await createServer({root:nodePath.join(root,'apps/web'),configFile:nodePath.join(root,'apps/web/vite.config.ts')});await web.listen();
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.locator('input[name=account]').fill('13800000011');await page.locator('input[name=password]').fill(password);await page.locator('button[type=submit]').click();
 await page.getByRole('button',{name:/编辑活动/}).click();await page.getByRole('menuitem',{name:'签到名单',exact:true}).click();
 await page.getByText('暂无彩排签到人员',{exact:true}).waitFor();
 await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version,answers) VALUES($1,$2,$3,'ui-person','管理验收人员',$4,$5)",[activity.id,run.id,run.generation+1,oldVersion,JSON.stringify({[field.id]:field.options[0].id})]);
 await page.getByRole('button',{name:'搜索',exact:true}).click();
 await sql.query("UPDATE activity_participants SET avatar_url='/demo-avatars/1.svg' WHERE identity_key='ui-person'");
 await page.getByRole('button',{name:'搜索',exact:true}).click();
 await page.locator('img[alt="管理验收人员的头像"]').waitFor();
 assert.ok(await page.locator('img[alt="管理验收人员的头像"]').evaluate(img=>img.complete&&img.naturalWidth>0));
 await page.getByRole('button',{name:'排除抽奖',exact:true}).click();
 assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByRole('button',{name:'恢复抽奖',exact:true}).click();
 await page.getByRole('button',{name:'排除抽奖',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'查看资料',exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:'最近导出',exact:true}).count(),0);
 await page.screenshot({path:nodePath.join(root,'artifacts/participant-management.png'),fullPage:true});
 passed('browser shows avatar and direct exclude/restore actions without detail or recent exports panels');
 await page.getByRole('menuitem',{name:'奖项设置',exact:true}).click();
 await page.getByRole('button',{name:'＋ 添加奖项',exact:true}).click();
 await page.getByLabel('奖项名称',{exact:true}).fill('搜索验收');
 await page.locator('.el-select').filter({has:page.getByRole('combobox',{name:'颁发方式',exact:true})}).click();await page.getByRole('option',{name:'指定',exact:true}).click();
 assert.equal(await page.locator('.people-list input').count(),0);
 await page.getByLabel('搜索验收指定人员搜索',{exact:true}).fill('管理验收人员');
 await page.getByRole('button',{name:'查找人员',exact:true}).click();await page.locator('.people-list .el-checkbox').click();assert.equal(await page.locator('.people-list input').isChecked(),true);
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('.el-message:not(.el-message-fade-leave-active)').filter({hasText:'配置已保存'}).waitFor();
 await page.locator('.prize-fields').getByText('梦幻星球',{exact:true}).waitFor();
 await page.getByRole('menuitem',{name:'基本信息',exact:true}).click();await page.getByRole('tab',{name:'品牌视觉',exact:true}).click();await page.getByRole('button',{name:'移除品牌Logo，使用系统样式',exact:true}).click();assert.equal(await page.locator('.upload-preview.activity_logo img').count(),0);
 await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('.el-message').filter({hasText:'活动资料已保存'}).waitFor();assert.equal(await page.getByRole('heading',{name:'基本信息',exact:true}).isVisible(),true);await page.getByRole('menuitem',{name:'我的活动',exact:true}).click();await page.locator('.cover-logo [aria-label="系统样式"]').waitFor();assert.equal(await page.locator('.activity-card').getByRole('menuitem',{name:'签到设置',exact:true}).count(),0);await page.locator('.activity-card').getByText('参与人数',{exact:true}).waitFor();assert.equal(await page.locator('.cover-metrics strong').innerText(),'1 人');assert.equal(await page.getByRole('button',{name:'报名二维码',exact:true}).isEnabled(),true);assert.ok(await page.getByRole('button',{name:'大屏抽奖',exact:true}).isEnabled());await page.getByRole('button',{name:/编辑活动/}).click();await page.getByRole('heading',{name:'基本信息',exact:true}).waitFor();assert.equal(await page.locator('.upload-preview.activity_logo img').count(),0);
 await page.getByRole('menuitem',{name:'奖项设置',exact:true}).click();await page.locator('.selected-people').getByText(/管理验收人员/).waitFor();assert.equal(await page.locator('.people-list input').count(),0);
 await page.screenshot({path:nodePath.join(root,'artifacts/designated-search.png'),fullPage:true});
 await page.getByRole('menuitem',{name:'签到名单',exact:true}).click();
 passed('designated lookup searches on demand and persists selection; theme and logo removal controls are available');

 await page.getByRole('tab',{name:'正式名单',exact:true}).click();await page.locator('tbody').getByText('正式人员',{exact:true}).waitFor();
 const fileEvent=page.waitForEvent('download');await page.getByRole('button',{name:'导出名单',exact:true}).click();const file=await fileEvent;await file.saveAs(nodePath.join(root,'artifacts/roster-formal.xlsx'));
 await page.screenshot({path:nodePath.join(root,'artifacts/participant-roster.png'),fullPage:true});
 assert.equal((await a.ctx.get('/api/v1/'+path+'/participants?mode=formal')).status(),401);
 await page.reload();await page.getByRole('button',{name:/编辑活动/}).click();await page.getByRole('menuitem',{name:'签到名单',exact:true}).click();await page.getByRole('tab',{name:'正式名单',exact:true}).click();await page.getByRole('button',{name:'导出名单',exact:true}).waitFor();
 await sql.query("UPDATE activities SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",[activity.id]);
 await page.getByRole('button',{name:'搜索',exact:true}).click();await page.getByText('活动已到期，仍可查看和导出名单。',{exact:true}).waitFor();
 const expiredDownload=page.waitForEvent('download');await page.getByRole('button',{name:'导出名单',exact:true}).click();await expiredDownload;
 assert.deepEqual(errors,[]);
 passed('browser mode switch, automatic XLSX download, revoked session and expired read/export');
 }
 await writeFile(nodePath.join(root,'artifacts/roster-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:results},null,2));
}finally{
 await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();
}
console.info('Roster verification complete: '+results.length+' checks.');
