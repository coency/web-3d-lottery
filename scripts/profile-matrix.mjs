import {simulationPortraits,fulfillSimulationPortrait} from './lib/simulation-portraits.mjs';
const portraitFixtures=await simulationPortraits(5000);
// Isolated graphics benchmark: production assets, mocked draw API, 5000 distinct portraits.
// No user activity or database is modified. Build the web workspace before running.
// --corridor samples idle + start/running; --switch includes entering the theme.
// --joins adds one participant every 4s using real roster revision semantics.
// --assert-incremental verifies live updates without full atlas uploads after warmup.
import assert from 'node:assert/strict';
import {preview} from 'vite';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const label=process.argv[2]||'profile';
assert.match(label,/^[a-z0-9-]+$/i);
const corridor=process.argv.includes('--corridor'),theme=corridor?'starlight-corridor':'starlight-matrix';
const switchTheme=corridor&&process.argv.includes('--switch');
const joins=process.argv.includes('--joins');
const output=`artifacts/${corridor?'corridor':'matrix'}-${label}`;
await mkdir(output,{recursive:true});
const web=await preview({configFile:'apps/web/vite.config.ts',root:'apps/web',preview:{host:'127.0.0.1',port:5188,strictPort:true}});
let browser,joinTimer;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];
 await page.route('**/demo-avatars/portraits-v1/*',route=>fulfillSimulationPortrait(route,portraitFixtures));
 page.on('pageerror',e=>errors.push(e.message));
 const id='00000000-0000-4000-8000-000000000001';let rolling=false;
 const people=Array.from({length:5000},(_,i)=>({id:String(i),nickname:'模拟用户'+i,avatarUrl:'/demo-avatars/portraits-v1/'+(i+1)+'.webp'}));
 let rosterRevision='roster-1',revision=1;
 await page.addInitScript(()=>{
  window.EventSource=class{addEventListener(){}close(){}};
  let enabled=false,last=0,started=0,frames=[],calls={},perFrame={};
  const wrap=(proto,key,accept=()=>true)=>{
   const original=proto[key];if(!original)return;
   proto[key]=function(...args){
    if(!enabled||!accept(this))return original.apply(this,args);
    const start=performance.now();
    try{return original.apply(this,args);}
    finally{
     const ms=performance.now()-start,source=args.at(-1);
     const names=[key,...(key==='texSubImage2D'&&source?.width?[key+'_'+source.width+'x'+source.height]:[])];
     for(const name of names){const s=calls[name]??={count:0,ms:0,max:0};s.count++;s.ms+=ms;s.max=Math.max(s.max,ms);perFrame[name]=(perFrame[name]||0)+ms;}
    }
   };
  };
  wrap(CanvasRenderingContext2D.prototype,'drawImage');
  wrap(CanvasRenderingContext2D.prototype,'getImageData');
  for(const name of ['texSubImage2D','texImage2D','generateMipmap','drawElementsInstanced'])wrap(WebGL2RenderingContext.prototype,name);
  let initials=0;const text=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(s,...args){if(s==='模')initials++;return text.call(this,s,...args);};
  function frame(t){if(enabled&&last)frames.push({dt:t-last,elapsed:t-started,phase:document.body.classList.contains('rolling')?'rolling':'idle',robot:document.querySelector('#universe')?.dataset.corridorRobot,...perFrame});last=t;perFrame={};requestAnimationFrame(frame);}requestAnimationFrame(frame);
  window.profile={
   start(){enabled=true;last=0;started=performance.now();frames=[];calls={};},
   stop(){enabled=false;return{frames,calls,initials};}
  };
 });
 await page.route('**/api/**',async r=>{
  const p=new URL(r.request().url()).pathname;let data={};
  if(p.endsWith('/auth/me'))data={id:'matrix-profile-test'};
  else if(p.endsWith('/csrf'))data={csrfToken:'test'};
  else if(p.endsWith('/stage-people'))data=new URL(r.request().url()).searchParams.get('revision')===rosterRevision?{generation:1,revision:rosterRevision,unchanged:true}:{generation:1,revision:rosterRevision,items:people};
  else if(p.endsWith('/claim'))data={fence:'1'};
  else if(p.endsWith('/start')){rolling=true;data={roundId:'round'};}
  else if(p.endsWith('/draw'))data={generation:1,rosterRevision,phase:'rehearsal',version:'1',signedIn:people.length,activeRootId:rolling?'round':null,prizes:[...(switchTheme?[{id:'warmup',name:'预热奖项',theme:'dream-planet',total:10,batch:10,awarded:0}]:[]),{id:'prize',name:'测试奖项',theme,total:10,batch:10,awarded:0}],rounds:rolling?[{id:'round',status:'drawing',draw_count:10,prize_id:'prize'}]:[],vacancies:[],awards:[]};
  else if(p.endsWith(id))data={id,name: (corridor?'长廊':'矩阵')+'性能测试',expires_at:'2099-12-31T00:00:00Z',display:{},logoUrl:null};
  await r.fulfill({json:{data}});
 });
 await page.goto('http://127.0.0.1:5188/stage.html?activity='+id);
 await page.waitForFunction(()=>!document.querySelector('#draw').disabled);
 await page.waitForFunction(()=>document.querySelector('#portraitProgress').textContent.includes('本机已缓存 5000 张'),null,{timeout:240000});
 console.log('5000 portraits cached');
 if(!corridor){
  await page.locator('#draw').click();
  await page.waitForFunction(()=>document.body.classList.contains('rolling'));
 }
 await page.waitForTimeout(4000);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Profiler.enable');
 await cdp.send('Profiler.start');
 await page.evaluate(()=>profile.start());
 if(joins)joinTimer=setInterval(()=>{
  people.push({...people[revision%5000],id:'new-'+revision,nickname:'新签到'+revision});
  rosterRevision='roster-'+(++revision);
 },4000);
 if(switchTheme){
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(()=>document.querySelector('#stage').dataset.theme==='starlight-corridor');
 }
 if(corridor){
  await page.waitForTimeout(15000);
  await page.locator('#draw').click();
  await page.waitForFunction(()=>document.body.classList.contains('rolling'));
 }
 await page.waitForTimeout(45000);
 const result=await page.evaluate(()=>profile.stop());
 const cpu=await cdp.send('Profiler.stop');
 await writeFile(output+'/cpu.json',JSON.stringify(cpu.profile));
 const sorted=result.frames.map(f=>f.dt).sort((a,b)=>a-b);
 const summarize=frames=>({count:frames.length,mean:frames.reduce((n,f)=>n+f.dt,0)/frames.length,over33:frames.filter(f=>f.dt>34).length,over50:frames.filter(f=>f.dt>50).length,max:Math.max(...frames.map(f=>f.dt))});
 result.summary={fps:1000/(sorted.reduce((a,b)=>a+b,0)/sorted.length),p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],all:summarize(result.frames),uploads:summarize(result.frames.filter(f=>'texSubImage2D'in f)),noUploads:summarize(result.frames.filter(f=>!('texSubImage2D'in f)))};
 result.phases=Object.fromEntries(['idle','rolling'].map(phase=>[phase,summarize(result.frames.filter(f=>f.phase===phase))]));
 result.errors=errors;result.viewport='1920x1080';result.chrome=browser.version();result.fixture={theme,switchTheme,joins,added:people.length-5000,rosterRevision,displayedParticipants:Number((await page.locator('#joined').textContent()).replace(/\D/g,''))};
 await writeFile(output+'/metrics.json',JSON.stringify(result,null,2));
 await page.screenshot({path:output+'/rolling.png'});
 console.log(JSON.stringify({summary:result.summary,phases:result.phases,calls:result.calls,initials:result.initials,errors},null,2));
 assert.deepEqual(errors,[]);assert.equal(result.initials,0);
 if(process.argv.includes('--assert-incremental')){
  assert.ok(joins,'incremental check requires --joins');
  assert.ok(result.fixture.displayedParticipants>=5010,'live signups must reach the stage');
  assert.equal(result.frames.filter(f=>f.elapsed>3000&&'texSubImage2D_2688x2688'in f).length,0,'signups caused a full atlas upload');
 }
}finally{clearInterval(joinTimer);await browser?.close();await new Promise(resolve=>web.httpServer.close(resolve));}
