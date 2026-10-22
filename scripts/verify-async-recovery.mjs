import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
await mkdir('artifacts/async-recovery',{recursive:true});
const web=await createServer({configFile:'apps/web/vite.config.ts',root:'apps/web',cacheDir:'../../artifacts/async-recovery/vite-cache',server:{port:0,host:'127.0.0.1'}});await web.listen();
const origin='http://127.0.0.1:'+web.httpServer.address().port;
import {chromium} from 'playwright';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage();
 await page.addInitScript(()=>{window.EventSource=class{addEventListener(){}close(){}};});
 const now=new Date().toISOString();
 const activity=id=>({id,name:'活动'+id,phase:'rehearsal',mode:'rehearsal',version:'2',created_at:now,expires_at:new Date(Date.now()+86400000*10).toISOString(),display:{},tagline:'',organizer:'',coorganizer:'',logoUrl:null,h5BackgroundUrl:null,stageBackgroundUrl:null});
 const config={version:'2',phase:'rehearsal',firstFormalStarted:false,wechatVerified:false,lockedPrizeIds:[],form:{fields:[],signupFieldIds:[],auxiliaryFieldIds:[],titleFieldId:null},rule:{mode:'once',maxWins:null},prizes:[],participants:[],reservations:[],runs:[{mode:'rehearsal',generation:1,participants:0,rounds:0,awards:0,drawing:false}]};
 let aReads=0,releaseA,refreshStarted;
 const gate=new Promise(r=>releaseA=r),started=new Promise(r=>refreshStarted=r),writes=[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let data={};
  if(path.endsWith('/auth/me'))data={id:'review-owner',account:'review',role:'user'};
  else if(path.endsWith('/csrf'))data={csrfToken:'review-token'};
  else if(path.endsWith('/entitlements/me'))data={created_activity_count:2,can_create:true,server_now:now};
  else if(path==='/api/v1/activities')data=[activity('A'),activity('B')];
  else if(path.endsWith('/configuration/prize-settings'))data={};
  else if(path.endsWith('/configuration'))data=config;
  else if(path==='/api/v1/activities/A'&&req.method()==='GET'){
   if(++aReads===2){refreshStarted();await gate;}data=activity('A');
  }else if(path==='/api/v1/activities/B'&&req.method()==='GET')data=activity('B');
  else if(req.method()==='PATCH'){writes.push({path,body:req.postDataJSON()});data=activity(path.endsWith('/A')?'A':'B');}
  await route.fulfill({json:{data}});
 });
 await page.goto(origin+'/');
 await page.locator('.activity-card').filter({hasText:'活动A'}).getByRole('button',{name:'编辑活动',exact:true}).click();
 await page.getByRole('menuitem',{name:'奖项设置',exact:true}).click();
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await started;
 await page.getByRole('menuitem',{name:'我的活动',exact:true}).click();
 await page.locator('.activity-card').filter({hasText:'活动B'}).getByRole('button',{name:'编辑活动',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('input')].some(e=>e.value==='活动B'));
 releaseA();
 await page.waitForTimeout(300);
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.waitForFunction(()=>document.body.textContent.includes('活动资料已保存'));
 assert.equal(writes.length,1);
 assert.equal(writes[0].path,'/api/v1/activities/B');
 assert.equal(writes[0].body.name,'活动B');
 const result={passed:true,scenario:'Delayed A refresh cannot overwrite B editor',writes};
 await writeFile('artifacts/async-recovery/navigation.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
 // Opening a second activity or creating one must invalidate a pending open.
 for(const destination of ['B','create','list']){
  await page.getByRole('menuitem',{name:'我的活动',exact:true}).click();
  let releaseOpen,signalOpen;
  const openGate=new Promise(r=>releaseOpen=r),openStarted=new Promise(r=>signalOpen=r);
  const slowOpen=async route=>{signalOpen();await openGate;await route.fulfill({json:{data:activity('A')}});};
  await page.route('**/api/v1/activities/A',slowOpen);
  await page.locator('.activity-card').filter({hasText:'活动A'}).getByRole('button',{name:'编辑活动',exact:true}).click();
  await openStarted;
  if(destination==='B'){
   await page.locator('.activity-card').filter({hasText:'活动B'}).getByRole('button',{name:'编辑活动',exact:true}).click();
   await page.getByRole('heading',{name:'基本信息',exact:true}).waitFor();
  }else if(destination==='create')await page.getByRole('button',{name:'创建活动',exact:true}).click();
  else await page.getByRole('menuitem',{name:'我的活动',exact:true}).click();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/activities/A');
  releaseOpen();await response;await page.waitForTimeout(300);
  if(destination==='B')assert.equal(await page.locator('input').evaluateAll(inputs=>inputs.some(i=>i.value==='活动B')),true);
  else if(destination==='create')assert.equal(await page.locator('input').evaluateAll(inputs=>inputs.some(i=>i.value==='活动A')),false);
  else assert.equal(await page.getByRole('heading',{name:'基本信息',exact:true}).count(),0);
  await page.unroute('**/api/v1/activities/A',slowOpen);
  console.log('PASS pending activity open ignored after '+destination);
 }
 await page.close();
 await verifyStage(browser,origin);
}finally{await browser.close();await web.close();}

async function verifyStage(browser,origin){
 const results=[];
 for(const failure of ['auth','activity','draw','people','network','401','404']){
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>{window.streamCount=0;window.EventSource=class{constructor(){window.streamCount++;}addEventListener(){}close(){}};});
  const id='00000000-0000-4000-8000-000000000002',base='/api/v1/activities/'+id;
  const activity={id,name:'初始化恢复测试',mode:'rehearsal',phase:'rehearsal',version:'1',display:{},expires_at:'2099-12-31T00:00:00Z'};
  const draw={eligibleCount:0,rosterRevision:'1:1',appearanceRevision:'a1',generation:1,phase:'rehearsal',version:'1',signedIn:0,activeRootId:null,
   prizes:[{id:'prize',name:'一等奖',theme:'starlight-matrix',total:10,batch:10,awarded:0,mode:'random'}],rounds:[],vacancies:[],awards:[]};
  let failures=0,authReads=0,held=false,release;
  const gate=new Promise(r=>release=r);
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let data={};
   if(path.endsWith('/auth/me'))authReads++;
   const target=failure==='activity'?base:failure==='draw'?base+'/draw':failure==='people'?base+'/stage-people':'/api/v1/auth/me';
   if(path===target&&failures===0){
    failures++;
    if(failure==='network')return route.abort('failed');
    return route.fulfill({status:['401','404'].includes(failure)?Number(failure):503,json:{error:{code:'TEST_FAILURE',message:'测试异常'}}});
   }
   // Hold the first retry while online events arrive, detecting overlapping boots.
   if(path.endsWith('/auth/me')&&authReads===2&&failure==='network'){held=true;await gate;}
   if(path.endsWith('/auth/me'))data={id:'test-owner',account:'test',role:'user'};
   else if(path.endsWith('/csrf'))data={csrfToken:'fixture'};
   else if(path===base)data=activity;
   else if(path.endsWith('/draw'))data=draw;
   else if(path.endsWith('/stage-people'))data={generation:1,revision:'1:1',items:[]};
   else if(path.endsWith('/claim'))data={fence:'7'};
   await route.fulfill({json:{data}});
  });
  try{
   await page.goto(origin+'/stage.html?activity='+id+'&mode=rehearsal');
   await page.waitForFunction(()=>document.querySelector('#stageStatus').textContent.includes('失败')||document.querySelector('#stageStatus').textContent.includes('失效')||document.querySelector('#stageStatus').textContent.includes('测试异常'));
   if(['401','404'].includes(failure)){
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(3600);
    assert.equal(authReads,1,'Non-retryable failures must not loop');
    assert.ok(await page.locator('#draw').isDisabled());
    assert.equal(await page.locator('.winner-universe').count(),0);
   }else{
    if(failure==='network'){
     await page.evaluate(()=>window.dispatchEvent(new Event('online')));
     const end=Date.now()+10000;while(!held&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
     assert.ok(held);
     await page.evaluate(()=>{for(let i=0;i<8;i++)window.dispatchEvent(new Event('online'));});
     await page.waitForTimeout(600);assert.equal(authReads,2,'Only one bootstrap may run');release();
    }
    await page.waitForFunction(()=>!document.querySelector('#draw').disabled,{},{timeout:20000});
    assert.equal(await page.locator('.winner-universe').count(),1);
    assert.equal(await page.evaluate(()=>window.streamCount),1);
    assert.equal(await page.locator('#preflightStatus').getAttribute('data-ready'),'true');
    // Complete the keepalive release before removing mocked routes on close.
    await Promise.all([
     page.waitForResponse(r=>new URL(r.url()).pathname===base+'/draw/release'),
     page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')))
    ]);
   }
   assert.deepEqual(errors,[]);
   results.push({failure,passed:true,authReads});
  }finally{release();await context.close();}
 }
 await writeFile('artifacts/async-recovery/stage.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
}

