import {simulationPortraits,fulfillSimulationPortrait} from './lib/simulation-portraits.mjs';
const portraitFixtures=await simulationPortraits(2000);
import assert from 'node:assert/strict';
import {createServer,preview} from 'vite';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';

const production=process.argv.includes('--production');
const web=production
 ?await preview({configFile:'apps/web/vite.config.ts',root:'apps/web',preview:{port:5178,host:'127.0.0.1',strictPort:true}})
 :await createServer({configFile:'apps/web/vite.config.ts',root:'apps/web',server:{port:5178,host:'127.0.0.1',strictPort:true}});
if(!production)await web.listen();
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
 await page.route('**/demo-avatars/portraits-v1/*',route=>fulfillSimulationPortrait(route,portraitFixtures));
 page.on('pageerror',e=>errors.push(e.message));
 const id='00000000-0000-4000-8000-000000000001';let rolling=false;
 const people=Array.from({length:2000},(_,i)=>({id:String(i),nickname:'模拟用户'+i,avatarUrl:'/demo-avatars/portraits-v1/'+(i+1)+'.webp'}));
 await page.addInitScript(()=>{
  window.EventSource=class{addEventListener(){}close(){}};
  window.probe={fallbacks:0,placeholders:0,initials:0,slow:false,frames:[]};
  const text=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(value,...args){this.canvas.portraitLabel=value;if(value==='模')probe.initials++;return text.call(this,value,...args);};
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(source,...args){
   const placeholder=source.portraitPlaceholder||source.src?.endsWith('/avatar-placeholder.svg');
   if(this.canvas.width===128)this.canvas.portraitPlaceholder=!!placeholder;
   if(probe.slow&&source.portraitLabel==='模')probe.fallbacks++;
   if(probe.slow&&this.canvas.width===2688&&(placeholder||source.portraitLabel==='✦'))probe.placeholders++;
   return draw.call(this,source,...args);
  };
  const decode=window.createImageBitmap.bind(window);
  window.createImageBitmap=async(...args)=>{if(probe.slow)await new Promise(r=>setTimeout(r,40));return decode(...args);};
  let last;function frame(t){if(probe.slow&&last)probe.frames.push(t-last);last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);
 });
 await page.route('**/api/**',async r=>{
  const p=new URL(r.request().url()).pathname;let data={};
  if(p.endsWith('/auth/me'))data={id:'matrix-loading-test'};
  else if(p.endsWith('/csrf'))data={csrfToken:'test'};
  else if(p.endsWith('/stage-people'))data={generation:1,items:people};
  else if(p.endsWith('/claim'))data={fence:'1'};
  else if(p.endsWith('/start')){rolling=true;data={roundId:'round'};}
  else if(p.endsWith('/draw'))data={generation:1,phase:'rehearsal',version:'1',signedIn:2000,activeRootId:rolling?'round':null,prizes:[{id:'prize',name:'奖项',theme:'starlight-matrix',total:10,batch:10,awarded:0}],rounds:rolling?[{id:'round',status:'drawing',draw_count:10,prize_id:'prize'}]:[],vacancies:[],awards:[]};
  else if(p.endsWith(id))data={id,name:'头像加载测试',expires_at:'2099-12-31T00:00:00Z',display:{},logoUrl:null};
  await r.fulfill({json:{data}});
 });
 await page.goto('http://127.0.0.1:5178/stage.html?activity='+id);
 await page.waitForFunction(()=>!document.querySelector('#draw').disabled);
 await page.waitForFunction(()=>document.querySelector('#portraitProgress').textContent.includes('本机已缓存 2000 张'),null,{timeout:120000});
 await page.waitForTimeout(2500);
 await page.evaluate(()=>{probe.slow=true;document.querySelector('#draw').click();});
 await page.waitForFunction(()=>document.body.classList.contains('rolling'));
 await page.waitForTimeout(8000);
 const result=await page.evaluate(()=>{const frames=probe.frames.sort((a,b)=>a-b);return {fallbacks:probe.fallbacks,placeholders:probe.placeholders,initials:probe.initials,p95:frames[Math.floor(frames.length*.95)],rolling:document.body.classList.contains('rolling')};});
 result.errors=errors;console.log(JSON.stringify(result));
 await writeFile(process.argv.slice(2).find(arg=>!arg.startsWith('--'))||'artifacts/matrix-portrait-loading.json',JSON.stringify(result,null,2));
 await page.screenshot({path:'artifacts/matrix-portrait-loading.png'});
 assert.equal(result.fallbacks,0,'unprepared avatars were painted as 模 during the draw');
 assert.equal(result.placeholders,0,'prepared portraits were replaced with loading placeholders');
 assert.equal(result.initials,0,'initial avatar loading painted 模');
 assert.deepEqual(errors,[]);
}finally{await browser.close();if(production)await new Promise(resolve=>web.httpServer.close(resolve));else await web.close();}
