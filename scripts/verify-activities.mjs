import {provisionFixtureAccount} from './lib/account-fixture.mjs';
import assert from 'node:assert/strict';
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
const directory=await mkdtemp(path.join(root,'artifacts/activities-'));
const dbPort=await freePort(), apiPort=await freePort(), webPort=await freePort();
const origin='http://127.0.0.1:'+webPort, base='http://127.0.0.1:'+apiPort;
process.env.API_PORT=String(apiPort);process.env.WEB_PORT=String(webPort);
const secret=randomBytes(48).toString('hex');
let db,api,web,browser,sql;
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
  api=await launch();
  const a=await agent(),b=await agent(),admin=await agent(),anon=await agent();
  await register(a,'13800000001');const owner=await login(a,'13800000001');
  await register(b,'13800000002');const other=await login(b,'13800000002');
  await register(admin,'13800000003');const adminUser=await login(admin,'13800000003');
  const req=async(agent,method,url,body,key=randomUUID(),headers={})=>agent.ctx.fetch('/api/v1/'+url,{method,data:body,headers:{'X-CSRF-Token':agent.csrf,'Idempotency-Key':key,...headers}});
  const json=async response=>{assert.equal(response.status(),200,await response.text());return (await response.json()).data;};
  const input=await sharp({create:{width:1024,height:768,channels:4,background:'#8270b4'}}).png().toBuffer();
  const upload=async(agent,purpose,activityId=null)=>{
    const ticket=await json(await req(agent,'POST','assets/uploads',{purpose,activityId}));
    const result=await json(await req(agent,'PUT','assets/'+ticket.id+'/content',input,undefined,{'Content-Type':'application/octet-stream'}));
    return result.id;
  };
  const draft=async(agent,name='星光年度盛典')=>({name,expiresAt:new Date(Date.now()+86400000).toISOString(),logoAssetId:await upload(agent,'activity_logo'),h5BackgroundAssetId:await upload(agent,'h5_background'),stageBackgroundAssetId:null,tagline:'相聚此刻 · 幸运同行',organizer:'星光活动组',coorganizer:'',display:{logo:true,tagline:true,organizer:true,coorganizer:true,h5Background:true,stageBackground:true}});
  assert.equal((await anon.ctx.get('/api/v1/entitlements/me')).status(),401);
  const first=await draft(a), secondUserDraft=await draft(b);
  assert.equal((await req(b,'POST','activities',{...secondUserDraft,logoAssetId:first.logoAssetId})).status(),422);
  assert.equal((await b.ctx.get('/api/v1/assets/'+first.logoAssetId+'/content')).status(),404);
  assert.equal((await req(a,'POST','activities',{...first,owner_id:other.id})).status(),422);
  assert.equal((await req(a,'POST','activities',{...first,expiresAt:new Date(Date.now()+31*86400000).toISOString()})).status(),422);
  assert.equal((await req(a,'POST','activities',{...first,expiresAt:new Date(Date.now()-1000).toISOString()})).status(),422);
  passed('anonymous, cross-user images, injected owner and invalid activity dates rejected');

  const ticket=await json(await req(a,'POST','assets/uploads',{purpose:'activity_logo',activityId:null}));
  assert.equal((await req(a,'PUT','assets/'+ticket.id+'/content',Buffer.from('<svg onload="alert(1)"/>'),undefined,{'Content-Type':'application/octet-stream'})).status(),422);
  assert.equal((await req(a,'PUT','assets/'+ticket.id+'/content',Buffer.alloc(10*1024*1024+1),undefined,{'Content-Type':'application/octet-stream'})).status(),413);
  const oversize=await sharp({create:{width:8193,height:1,channels:3,background:'#333'}}).png().toBuffer();
  assert.equal((await req(a,'PUT','assets/'+ticket.id+'/content',oversize,undefined,{'Content-Type':'application/octet-stream'})).status(),422);
  await json(await req(a,'PUT','assets/'+ticket.id+'/content',input,undefined,{'Content-Type':'application/octet-stream'}));
  await json(await req(a,'PUT','assets/'+ticket.id+'/content',input,undefined,{'Content-Type':'application/octet-stream'}));
  const different=await sharp({create:{width:1,height:1,channels:3,background:'#aaa'}}).png().toBuffer();
  assert.equal((await req(a,'PUT','assets/'+ticket.id+'/content',different,undefined,{'Content-Type':'application/octet-stream'})).status(),409);
  const imageResponse=await a.ctx.get('/api/v1/assets/'+ticket.id+'/content');
  assert.equal(imageResponse.headers()['content-type'],'image/webp');
  assert.equal((await sharp(await imageResponse.body()).metadata()).format,'webp');
  passed('real raster validation, size limits, WebP re-encoding and immutable image retry');

  const key=randomUUID();
  const pair=await Promise.all([req(a,'POST','activities',first,key),req(a,'POST','activities',first,key)]);
  const created=await json(pair[0]);assert.equal((await json(pair[1])).id,created.id);
  assert.equal((await sql.query('SELECT created_activity_count n FROM users WHERE id=$1',[owner.id])).rows[0].n,1);
  assert.equal((await req(a,'POST','activities',{...first,name:'不同请求'},key)).status(),409);
  assert.equal((await req(a,'POST','activities',{...first,logoAssetId:null,h5BackgroundAssetId:null})).status(),200);
  const freePair=await Promise.all([req(b,'POST','activities',{...secondUserDraft,logoAssetId:null,h5BackgroundAssetId:null}),req(b,'POST','activities',{...secondUserDraft,logoAssetId:null,h5BackgroundAssetId:null})]);
  assert.deepEqual(freePair.map(r=>r.status()).sort(),[200,200]);
  assert.equal((await b.ctx.get('/api/v1/activities/'+created.id)).status(),404);
  assert.equal((await req(b,'PATCH','activities/'+created.id,first,undefined,{'If-Match':'1'})).status(),404);
  passed('same-key concurrent create returns one activity; different keys create separate activities without a quota');

  const updateKey=randomUUID();
  const updated=await json(await req(a,'PATCH','activities/'+created.id,{...first,name:'更新后的盛典'},updateKey,{'If-Match':'1'}));
  assert.equal(updated.version,'2');
  assert.equal((await json(await req(a,'PATCH','activities/'+created.id,{...first,name:'更新后的盛典'},updateKey,{'If-Match':'1'}))).version,'2');
  assert.equal((await req(a,'PATCH','activities/'+created.id,first,undefined,{'If-Match':'1'})).status(),409);
  assert.equal((await req(a,'PATCH','activities/'+created.id,first)).status(),422);
  passed('editing uses optimistic version checks and idempotent responses');

  assert.equal((await admin.ctx.get('/api/v1/admin/users/lookup?phone=13800000001')).status(),404);
  assert.equal((await req(admin,'PUT','admin/users/'+owner.id+'/entitlement',{})).status(),404);
  assert.equal((await admin.ctx.get('/api/v1/admin/users/'+owner.id+'/entitlement/history')).status(),404);
  assert.equal((await admin.ctx.get('/api/v1/activities')).status(),200);
  const next=await draft(a,'第二场独立活动');
  const paidActivity=await json(await req(a,'POST','activities',next));
  assert.notEqual(paidActivity.logo_asset_id,created.logo_asset_id);
  assert.equal((await req(a,'PATCH','activities/'+paidActivity.id,{...next,logoAssetId:first.logoAssetId},undefined,{'If-Match':'1'})).status(),422);
  await sql.query("UPDATE entitlements SET paid_until=clock_timestamp()-interval '1 second' WHERE user_id=$1",[owner.id]);
  assert.equal((await req(a,'POST','activities',{...next,logoAssetId:null,h5BackgroundAssetId:null})).status(),200);
  await json(await req(a,'PATCH','activities/'+paidActivity.id,{...next,name:'权益到期后仍可修改原活动'},undefined,{'If-Match':'1'}));
  assert.equal((await json(await a.ctx.get('/api/v1/entitlements/me'))).created_activity_count,4);
  passed('removed admin endpoints, unrestricted creation after entitlement expiry and per-activity asset ownership');


  assert.equal((await req(b,'PATCH','activities/'+paidActivity.id+'/checkin-settings',{h5BackgroundAssetId:null,showBackground:true},undefined,{'If-Match':'2'})).status(),404);
  assert.equal((await req(a,'PATCH','activities/'+paidActivity.id+'/checkin-settings',{h5BackgroundAssetId:next.logoAssetId,showBackground:true},undefined,{'If-Match':'2'})).status(),422);
  const bg=await upload(a,'h5_background',paidActivity.id);
  const settingsKey=randomUUID(), settings={h5BackgroundAssetId:bg,showBackground:false};
  const settingsSaved=await json(await req(a,'PATCH','activities/'+paidActivity.id+'/checkin-settings',settings,settingsKey,{'If-Match':'2'}));
  assert.equal(settingsSaved.display.h5Background,false);assert.equal(settingsSaved.h5_background_asset_id,bg);
  assert.equal((await json(await req(a,'PATCH','activities/'+paidActivity.id+'/checkin-settings',settings,settingsKey,{'If-Match':'2'}))).version,settingsSaved.version);
  assert.equal((await req(a,'PATCH','activities/'+paidActivity.id+'/checkin-settings',settings,undefined,{'If-Match':'2'})).status(),409);
  passed('check-in settings enforce ownership, purpose, version and idempotency');


  const configPath='activities/'+paidActivity.id;
  // Response helpers await requests before decoding.
  const readConfig=async()=>json(await a.ctx.get('/api/v1/'+configPath+'/configuration'));
  let cfg=await readConfig();
  const putConfig=async(section,value,extra={})=>req(a,'PUT',configPath+'/configuration/'+section,{value,...extra},undefined,{'If-Match':String((await readConfig()).version)});
  assert.equal((await b.ctx.get('/api/v1/'+configPath+'/configuration')).status(),404);
  assert.deepEqual(cfg.form.fields,[]);
  const field={id:randomUUID(),name:'姓名',type:'text',hint:'',required:true,options:[]};
  const formConfig={fields:[field],titleFieldId:field.id,auxiliaryFieldIds:[]};
  await json(await putConfig('form',formConfig));
  cfg=await readConfig();
  assert.equal((await req(a,'POST',configPath+'/form-preview',{version:cfg.version,answers:{}})).status(),422);
  await json(await req(a,'POST',configPath+'/form-preview',{version:cfg.version,answers:{[field.id]:'测试人员'}}));
  const prize={id:randomUUID(),name:'三等奖',total:20,batch:5,mode:'random'};
  await json(await putConfig('prizes',[prize]));
  assert.equal((await putConfig('prizes',[{...prize,batch:21}])).status(),422);
  await json(await putConfig('rule',{mode:'max',maxWins:2}));
  cfg=await readConfig();
  const rehearsal=cfg.runs.find(r=>r.mode==='rehearsal');
  const modeRequest=(action,key=randomUUID(),version=cfg.version,generation=rehearsal.generation)=>req(a,'POST',configPath+'/mode/'+action,{confirmation:action,generation},key,{'If-Match':String(version)});
  assert.equal((await modeRequest('promote')).status(),409);
  const participant=(await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version,answers) VALUES($1,$2,$3,'isolated-fixture','测试',$4,$5) RETURNING id",[paidActivity.id,rehearsal.id,cfg.runs.find(r=>r.mode==='rehearsal').generation,cfg.version,JSON.stringify({[field.id]:'历史姓名'})])).rows[0].id;
  const round=(await sql.query("INSERT INTO draw_rounds(activity_id,run_id,generation,prize_id,config_version,status) VALUES($1,$2,$3,$4,$5,'drawing') RETURNING id",[paidActivity.id,rehearsal.id,rehearsal.generation,prize.id,cfg.version])).rows[0].id;
  assert.equal((await modeRequest('clear-rehearsal')).status(),409);
  assert.equal((await putConfig('rule',{mode:'once',maxWins:null})).status(),409);
  await sql.query("UPDATE draw_rounds SET status='completed' WHERE id=$1",[round]);
  await sql.query("INSERT INTO draw_awards(activity_id,run_id,generation,round_id,participant_id,prize_id,status) VALUES($1,$2,$3,$4,$5,$6,'valid')",[paidActivity.id,rehearsal.id,rehearsal.generation,round,participant,prize.id]);
  assert.equal((await putConfig('prizes',[{...prize,total:30}])).status(),409);
  const clearKey=randomUUID();await json(await modeRequest('clear-rehearsal',clearKey));await json(await modeRequest('clear-rehearsal',clearKey));
  let cleared=await readConfig();
  assert.equal(cleared.runs.find(r=>r.mode==='rehearsal').generation,rehearsal.generation+1);
  assert.equal(cleared.runs.find(r=>r.mode==='rehearsal').participants,0);
  assert.deepEqual(cleared.prizes,[{...prize,theme:'dream-planet'}]);assert.deepEqual(cleared.form,{...formConfig,signupFieldIds:[]});
  assert.equal((await modeRequest('clear-rehearsal',randomUUID(),cleared.version,rehearsal.generation)).status(),409);
  // Combined saves are transactional: a bad field must not update the background.
  let combined=await readConfig();
  const backgroundBefore=(await json(await a.ctx.get('/api/v1/'+configPath))).h5_background_asset_id;
  assert.equal((await req(a,'PUT',configPath+'/configuration/checkin',{value:{form:{...formConfig,fields:[{...field,name:'超过八个字的字段名称'}]},h5BackgroundAssetId:null,showBackground:false}},undefined,{'If-Match':combined.version})).status(),422);
  assert.equal((await json(await a.ctx.get('/api/v1/'+configPath))).h5_background_asset_id,backgroundBefore);
  await json(await req(a,'PUT',configPath+'/configuration/checkin',{value:{form:formConfig,h5BackgroundAssetId:null,showBackground:false}},undefined,{'If-Match':combined.version}));
  combined=await readConfig();assert.equal((await json(await a.ctx.get('/api/v1/'+configPath))).display.h5Background,false);
  const designated={id:randomUUID(),name:'指定奖',total:1,batch:1,mode:'designated'};
  const person=(await sql.query("INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version) VALUES($1,$2,$3,'selection-fixture','指定人员',$4) RETURNING id",[paidActivity.id,rehearsal.id,rehearsal.generation+1,combined.version])).rows[0].id;
  const bundle={rule:{mode:'once',maxWins:null},prizes:[prize,designated],reservations:[{prizeId:designated.id,participantIds:[person]}]};
  await json(await req(a,'PUT',configPath+'/configuration/prize-settings',{value:bundle},undefined,{'If-Match':combined.version}));
  combined=await readConfig();assert.equal(combined.reservations[0].participant_id,person);
  assert.equal((await req(a,'PUT',configPath+'/configuration/prize-settings',{value:{...bundle,rule:{mode:'max',maxWins:3},reservations:[{prizeId:designated.id,participantIds:[randomUUID()]}]}},undefined,{'If-Match':combined.version})).status(),422);
  assert.equal((await readConfig()).rule.mode,'once');
  cleared=await readConfig();
  passed('combined check-in and prize saves roll back together; designated selections validate real run membership');
  // Private verification evidence exists only in this disposable test database.
  const credential=randomUUID();
  await sql.query("INSERT INTO wechat_credentials(id,app_id,account_name,sealed_secret) VALUES($1,'isolated-test','fixture','{}')",[credential]);
  await sql.query("INSERT INTO wechat_configurations(scope,source,credential_id) VALUES($1,'platform',$2) ON CONFLICT(scope) DO UPDATE SET credential_id=EXCLUDED.credential_id",[paidActivity.id,credential]);
  await sql.query("INSERT INTO activity_wechat_verifications(activity_id,verified_at,valid_until,evidence_reference,credential_id) VALUES($1,clock_timestamp(),clock_timestamp()+interval '1 day','isolated-test-only',$2)",[paidActivity.id,credential]);
  await json(await modeRequest('promote',randomUUID(),cleared.version,rehearsal.generation+1));
  cfg=await readConfig();assert.equal(cfg.phase,'formal');
  assert.equal((await modeRequest('clear-rehearsal',randomUUID(),cfg.version,rehearsal.generation+1)).status(),409);
  await sql.query('UPDATE activities SET first_formal_started_at=clock_timestamp() WHERE id=$1',[paidActivity.id]);
  assert.equal((await putConfig('form',formConfig)).status(),409);
  assert.equal((await putConfig('rule',{mode:'max',maxWins:4})).status(),422);
  await json(await putConfig('rule',{mode:'max',maxWins:4},{confirmed:true,reason:'现场规则调整'}));
  passed('configuration validation, scoped access, busy locks, rehearsal clearing and one-way verified promotion');

  await sql.query("UPDATE activities SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",[created.id]);
  assert.equal((await json(await a.ctx.get('/api/v1/activities/'+created.id))).phase,'expired');
  assert.equal((await req(a,'PATCH','activities/'+created.id,first,undefined,{'If-Match':'2'})).status(),410);
  assert.equal((await req(a,'POST','assets/uploads',{purpose:'activity_logo',activityId:created.id})).status(),410);
  assert.equal((await req(a,'PATCH','activities/'+created.id+'/checkin-settings',{h5BackgroundAssetId:null,showBackground:true},undefined,{'If-Match':'2'})).status(),410);
  assert.equal((await a.ctx.get('/api/v1/assets/'+first.logoAssetId+'/content')).status(),200);
  assert.equal((await req(a,'DELETE','activities/'+created.id,{})).status(),404);
  assert.equal((await req(a,'POST','activities/'+created.id+'/end',{})).status(),404);
  passed('expiry becomes read-only without scheduler; no extend/reopen/delete/manual-end route');

  const replacement=await agent();await login(replacement,'13800000001');
  assert.equal((await req(a,'POST','activities',next,key)).status(),401);
  assert.equal((await a.ctx.get('/api/v1/assets/'+first.logoAssetId+'/content')).status(),401);
  await stopChild(api);api=await launch();
  assert.equal((await json(await replacement.ctx.get('/api/v1/activities'))).length,4);
  passed('session revocation applies to activity reads, images and replay; restart preserves data');

  const ui=await agent();await register(ui,'13800000004');
  web=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts')});await web.listen();
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);
  await page.locator('input[name=account]').fill('13800000004');await page.locator('input[name=password]').fill(password);
  await page.locator('button[type=submit]').click();await page.getByRole('heading',{name:'你好，138****0004。'}).waitFor();
  await page.getByRole('button',{name:'创建活动',exact:true}).click();
  await page.locator('input[name=activityName]').fill('浏览器验收 · 星光盛典');
  await page.getByLabel('选择活动结束日期',{exact:true}).click();
  await page.locator('.el-picker-panel:visible .el-date-table td.today').click();
  await page.getByRole('tab',{name:'品牌视觉',exact:true}).click();
  await page.route('**/assets/*/content',route=>route.request().method()==='PUT'?route.abort():route.continue(),{times:1});
  await page.locator('input[name=activity_logo]').setInputFiles({name:'logo.png',mimeType:'image/png',buffer:input});
  const uploadError=page.locator('.el-message--error:not(.el-message-fade-leave-active)').first();
  await uploadError.waitFor();
  assert.ok((await uploadError.boundingBox()).y<150);
  await uploadError.locator('.el-message__closeBtn').click();
  await page.locator('input[name=activity_logo]').setInputFiles({name:'logo.png',mimeType:'image/png',buffer:input});
  await page.locator('.el-message:not(.el-message-fade-leave-active)').filter({hasText:'logo.png'}).waitFor();
  await page.locator('.upload-preview.activity_logo img').waitFor();
  assert.equal(await page.locator('input[name=h5_background]').count(),0);
  assert.equal(await page.getByText('活动地点',{exact:true}).count(),0);
  await page.screenshot({path:path.join(root,'artifacts/activities-editor.png'),fullPage:true});
  await page.getByRole('button',{name:'创建活动',exact:true}).click();
  await page.getByRole('heading',{name:'浏览器验收 · 星光盛典',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'创建活动',exact:true}).isDisabled(),false);
  await page.screenshot({path:path.join(root,'artifacts/activities-list.png'),fullPage:true});

  assert.equal(await page.locator('input[name=h5_background]').count(),0);
  const sidebarTop=await page.locator('aside').evaluate(el=>el.getBoundingClientRect().top);
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
  assert.ok(Math.abs(await page.locator('aside').evaluate(el=>el.getBoundingClientRect().top)-sidebarTop)<1);
  await page.getByRole('button',{name:/编辑活动/}).click();
  await page.getByRole('menuitem',{name:'签到设置',exact:true}).click();
  await page.getByRole('heading',{name:'签到设置',exact:true}).waitFor();
  await page.locator('input[name=h5_background]').setInputFiles({name:'background.png',mimeType:'image/png',buffer:input});
  await page.locator('.el-message:not(.el-message-fade-leave-active)').filter({hasText:'background.png'}).waitFor();
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.locator('.el-message:not(.el-message-fade-leave-active)').filter({hasText:'配置已保存'}).waitFor();
  await page.screenshot({path:path.join(root,'artifacts/checkin-settings.png'),fullPage:true});

  await page.getByRole('tab',{name:/签到字段/}).click();
  await page.getByRole('button',{name:'＋ 添加字段',exact:true}).click();
  await page.locator('.checkin-controls').getByLabel('字段名称',{exact:true}).fill('公司');

  await page.locator('.phone-content').getByRole('textbox',{name:'公司',exact:true}).waitFor();
  await page.locator('.field-required .el-checkbox').click();assert.equal(await page.getByRole('checkbox',{name:'必填',exact:true}).isChecked(),true);
  await page.locator('.el-select').filter({has:page.getByRole('combobox',{name:'类型',exact:true})}).click();
  await page.getByRole('option',{name:'下拉单选',exact:true}).click();
  await page.getByLabel('选项',{exact:true}).fill('研发');
  await page.locator('.phone-content .el-select').filter({has:page.getByRole('combobox',{name:'公司',exact:true})}).click();
  await page.getByRole('option',{name:'研发',exact:true}).click();
  await page.locator('.el-select').filter({has:page.getByRole('combobox',{name:'类型',exact:true})}).click();
  await page.getByRole('option',{name:'单行文本',exact:true}).click();
  for(const name of ['姓名','职位']){
   await page.getByRole('button',{name:'＋ 添加字段',exact:true}).click();
   await page.locator('.checkin-controls').getByLabel('字段名称',{exact:true}).last().fill(name);
  }
  assert.equal(await page.getByRole('button',{name:'＋ 添加字段',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('.phone-content .signup-fields input').count(),3);
  await page.getByRole('tab',{name:'展示信息',exact:true}).click();
  await page.locator('.winner-display').getByText('微信昵称',{exact:true}).waitFor();
  assert.equal(await page.locator('.winner-display:not(.signup-display) input[type=checkbox]').count(),0);
  for(const name of ['公司','姓名','职位'])await page.locator('.signup-display .el-checkbox').filter({hasText:name}).click();
  assert.equal(await page.locator('.phone-screen').evaluate(el=>el.scrollHeight<=el.clientHeight+1),true);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.locator('.el-message:not(.el-message-fade-leave-active)').filter({hasText:'配置已保存'}).waitFor();
  assert.equal(await page.locator('.signup-display input:checked').count(),3);
  await page.screenshot({path:path.join(root,'artifacts/checkin-phone-preview.png'),fullPage:true});

  await page.getByRole('menuitem',{name:'奖项设置',exact:true}).click();
  await page.getByRole('button',{name:'＋ 添加奖项',exact:true}).click();
  await page.getByLabel('奖项名称',{exact:true}).fill('一等奖');
  await page.getByLabel('总名额',{exact:true}).fill('20');
  await page.getByLabel('总名额',{exact:true}).press('Tab');
  assert.equal(await page.getByLabel('每轮人数',{exact:true}).inputValue(),'10');
  await page.getByLabel('每轮人数',{exact:true}).fill('11');
  await page.getByLabel('每轮人数',{exact:true}).press('Tab');assert.equal(await page.getByLabel('每轮人数',{exact:true}).inputValue(),'10');
  await page.getByLabel('每轮人数',{exact:true}).fill('6');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.locator('.el-message:not(.el-message-fade-leave-active)').filter({hasText:'配置已保存'}).waitFor();
  await page.screenshot({path:path.join(root,'artifacts/prize-settings.png'),fullPage:true});
  await page.getByRole('menuitem',{name:'模式切换',exact:true}).click();
  await page.getByRole('tab',{name:'启用正式活动',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'启用正式活动',exact:true}).isDisabled(),true);
  await page.getByRole('tab',{name:'清空彩排数据',exact:true}).click();
  await page.getByRole('button',{name:'清空彩排数据',exact:true}).click();
  await page.getByRole('button',{name:'确认操作',exact:true}).click();
  await page.locator('.el-message:not(.el-message-fade-leave-active)').filter({hasText:'操作已完成'}).waitFor();
  await page.getByRole('menuitem',{name:'签到设置',exact:true}).click();
  passed('browser custom fields, saved-form preview, prizes and rehearsal confirmation');

  await page.getByRole('menuitem',{name:'我的活动',exact:true}).click();

  await page.reload();await page.getByRole('heading',{name:'浏览器验收 · 星光盛典',exact:true}).waitFor();
  await page.getByRole('button',{name:/编辑活动/}).click();
  await page.locator('input[name=activityName]').fill('连续保存第一次');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.locator('.el-message:not(.el-message-fade-leave-active)').filter({hasText:'活动资料已保存'}).waitFor();
  assert.equal(await page.locator('input[name=activityName]').isVisible(),true);
  await page.locator('input[name=activityName]').fill('已保存的活动新名称');
  const savedAgain=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().includes('/api/v1/activities/'));
  await page.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal((await savedAgain).status(),200);
  assert.equal(await page.locator('input[name=activityName]').isVisible(),true);
  await page.getByRole('menuitem',{name:'我的活动',exact:true}).click();
  await page.getByRole('heading',{name:'已保存的活动新名称',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  passed('browser upload/create/list/refresh/edit and unrestricted create button');

  const uiActivity=(await sql.query("SELECT a.id,a.created_at FROM activities a JOIN users u ON u.id=a.owner_id WHERE u.phone='+8613800000004'")).rows[0];

  await sql.query("UPDATE activities SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",[uiActivity.id]);
  await page.reload();await page.getByRole('button',{name:/查看活动/}).click();
  await page.locator('.readonly-note').waitFor(); assert.equal(await page.locator('input[name=activityName]').isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'保存',exact:true}).count(),0);
  assert.equal(await page.getByLabel('选择活动结束日期',{exact:true}).isDisabled(),true);
  await page.screenshot({path:path.join(root,'artifacts/activities-readonly.png'),fullPage:true});
  passed('expired activity is read-only in browser and retains original 30-day anchor');

  const adminPage=await browser.newPage({viewport:{width:1440,height:1000}});
  adminPage.on('pageerror',e=>errors.push(e.message));
  await adminPage.goto(origin);await adminPage.locator('input[name=account]').fill('13800000003');await adminPage.locator('input[name=password]').fill(password);await adminPage.locator('button[type=submit]').click();
  await adminPage.getByRole('menuitem',{name:'我的活动',exact:true}).waitFor();
  assert.equal(await adminPage.getByText('用户权益管理',{exact:true}).count(),0);
  assert.equal(await adminPage.getByText('平台默认服务号',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  passed('all accounts use the normal activity workspace without administrator UI');

  await writeFile(path.join(root,'artifacts/activities-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),checks:results},null,2));

}finally{
 await browser?.close();await web?.close();for(const ctx of contexts)await ctx.dispose();await stopChild(api);await sql?.end();await db?.stop();
}
console.info("Activity verification complete: "+results.length+" checks.");

