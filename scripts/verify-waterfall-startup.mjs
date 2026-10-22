import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {preview} from 'vite';
import {chromium} from 'playwright';
const web=await preview({configFile:'apps/web/vite.config.ts',root:'apps/web',preview:{host:'127.0.0.1',port:5182,strictPort:true}});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[],errors=[];
try{
 await mkdir('artifacts/waterfall-startup',{recursive:true});
 async function fixture({failure=false}={}){
  const context=await browser.newContext({viewport:{width:1366,height:768}});
  const id='00000000-0000-4000-8000-000000000003';
  let releaseWorker,releaseRoster,workerRequests=0,avatarRequests=0,rosterHeld=true;
  const workerGate=new Promise(resolve=>releaseWorker=resolve),rosterGate=new Promise(resolve=>releaseRoster=resolve);
  const participants=Array.from({length:40},(_,i)=>({id:String(i),nickname:'参与者 '+i,avatarUrl:'/demo-avatars/portraits-v1/'+(i+1)+'.webp'}));
  const prizes=[{id:'waterfall',name:'瀑布',theme:'galaxy-waterfall',total:10,batch:10,awarded:0,mode:'random'},{id:'matrix',name:'矩阵',theme:'starlight-matrix',total:10,batch:10,awarded:0,mode:'random'}];
  await context.addInitScript(()=>{window.EventSource=class{addEventListener(){}close(){}};});
  await context.route('**/assets/waterfall-physics.worker-*',async route=>{workerRequests++;await workerGate;if(failure)await route.abort();else await route.continue();});
  await context.route('**/demo-avatars/portraits-v1/*',async route=>{avatarRequests++;await route.continue();});
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let data={};
   if(path.endsWith('/auth/me'))data={id:'startup-owner',account:'fixture'};
   else if(path.endsWith('/csrf'))data={csrfToken:'fixture'};
   else if(path.endsWith('/draw'))data={generation:1,phase:'rehearsal',version:'1',rosterRevision:'1:40',appearanceRevision:'1',signedIn:40,activeRootId:null,prizes,rounds:[],vacancies:[],awards:[]};
   else if(path.endsWith('/stage-people')){if(rosterHeld){await rosterGate;rosterHeld=false;}data={generation:1,revision:'1:40',items:participants};}
   else if(path.endsWith('/claim'))data={fence:'7'};
   else if(path.endsWith(id))data={id,name:'瀑布首次加载验证',mode:'rehearsal',phase:'rehearsal',version:'1',expires_at:'2099-12-31T00:00:00Z',display:{},logoUrl:null,h5BackgroundUrl:null,stageBackgroundUrl:null};
   await route.fulfill({json:{data}});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5182/stage.html?activity='+id+'&mode=rehearsal');
  for(let i=0;i<100&&workerRequests===0;i++)await page.waitForTimeout(50);
  assert.equal(workerRequests,1,'worker download must start while roster is still held');
  assert.equal(avatarRequests,0);releaseRoster();
  await page.waitForFunction(()=>document.querySelector('#universe').dataset.layout==='waterfall');
  await page.waitForFunction(()=>document.querySelector('#stageStatus').textContent.includes('正在加载碰撞引擎'));
  assert.ok(await page.locator('#draw').isDisabled());
  assert.equal(avatarRequests,0,'avatar queue must remain paused while the worker is held');
  return {context,page,releaseWorker,get workerRequests(){return workerRequests;},get avatarRequests(){return avatarRequests;}};
 }
 const f=await fixture();
 await f.page.screenshot({path:'artifacts/waterfall-startup/loading.png'});
 f.releaseWorker();
 await f.page.waitForFunction(()=>document.querySelector('#universe').dataset.waterfallPhysics==='true'&&!document.querySelector('#draw').disabled);
 await f.page.waitForFunction(()=>document.querySelector('#portraitProgress').textContent.includes('本机已缓存 40 张'));
 assert.equal(f.workerRequests,1);assert.ok(f.avatarRequests>0);
 assert.doesNotMatch(await f.page.locator('#stageStatus').innerText(),/碰撞引擎/);
 await f.page.waitForFunction(()=>Number(document.querySelector('#universe').dataset.waterfallContacts)>0);
 await f.page.screenshot({path:'artifacts/waterfall-startup/ready.png'});
 results.push('production worker starts before roster, is reused once, gates drawing, resumes avatars and produces real collisions');
 await f.page.keyboard.press('ArrowDown');await f.page.waitForFunction(()=>document.querySelector('#universe').dataset.layout==='matrix'&&!document.querySelector('#draw').disabled);
 await f.page.keyboard.press('ArrowDown');await f.page.waitForFunction(()=>document.querySelector('#universe').dataset.layout==='waterfall'&&document.querySelector('#universe').dataset.waterfallPhysics==='true'&&!document.querySelector('#draw').disabled);
 results.push('switching away and returning restores physics and draw readiness');await f.context.close();
 const bad=await fixture({failure:true});bad.releaseWorker();
 await bad.page.waitForFunction(()=>document.querySelector('#stageStatus').textContent.includes('碰撞引擎加载失败'));
 assert.ok(await bad.page.locator('#draw').isDisabled());
 await bad.page.waitForFunction(()=>document.querySelector('#portraitProgress').textContent.includes('本机已缓存 40 张'));
 await bad.page.keyboard.press('ArrowDown');await bad.page.waitForFunction(()=>document.querySelector('#universe').dataset.layout==='matrix'&&!document.querySelector('#draw').disabled);
 results.push('failed worker shows an actionable error, resumes avatars and does not block another theme');await bad.context.close();
 assert.deepEqual(errors,[]);await writeFile('artifacts/waterfall-startup/results.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await browser.close();await new Promise(resolve=>web.httpServer.close(resolve));}
