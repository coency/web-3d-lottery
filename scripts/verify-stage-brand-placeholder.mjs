import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import sharp from 'sharp';
// Every API request is mocked; no business database or real avatar cache is used.
const cacheDir=await mkdtemp(path.join(tmpdir(),'starlit-brand-placeholder-'));
const web=await createServer({configFile:'apps/web/vite.config.ts',root:'apps/web',cacheDir,server:{port:0,host:'127.0.0.1'}});
let browser;
const photo=await sharp({create:{width:128,height:128,channels:3,background:'#2dbb72'}}).png().toBuffer();
const brand='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="128"><rect width="256" height="128" fill="#e0b86a"/><text x="128" y="83" text-anchor="middle" font-size="52">BRAND</text></svg>';
try{
 await web.listen();const origin='http://127.0.0.1:'+web.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 for(const theme of ['dream-planet','starlight-matrix','star-wave','starlight-corridor','galaxy-waterfall']){
  const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
  let releaseLogo,releasePhotos;const logoGate=new Promise(resolve=>releaseLogo=resolve),photoGate=new Promise(resolve=>releasePhotos=resolve);
  try{
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    window.EventSource=class{addEventListener(){}close(){}};
    window.brandProbe={tiles:{},system:0,brand:0,photos:0,silhouettes:0};
    const draw=CanvasRenderingContext2D.prototype.drawImage,fill=CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill=function(...args){if(this.canvas.width===128)this.canvas.fixtureKind='system';return fill.apply(this,args);};
    CanvasRenderingContext2D.prototype.drawImage=function(source,...args){
     const kind=source.fixtureKind||(source.src?.includes('/fixture-brand.svg')?'brand':source.src?.includes('/favicon.svg')?'system':source.src?.includes('/avatar-placeholder.svg')?'silhouette':null);
     if(this.canvas.width===128&&kind)this.canvas.fixtureKind=kind;
     if(this.canvas.width===2688&&kind){brandProbe.tiles[args[0]+':'+args[1]]=kind;brandProbe[kind==='photo'?'photos':kind==='silhouette'?'silhouettes':kind]++;}
     return draw.call(this,source,...args);
    };
    const bitmap=window.createImageBitmap.bind(window);
    window.createImageBitmap=async(...args)=>{const image=await bitmap(...args);image.fixtureKind='photo';return image;};
   });
   const id='00000000-0000-4000-8000-000000000001';
   const people=Array.from({length:4},(_,i)=>({id:String(i),nickname:'参与者'+i,avatarUrl:'/api/fixture-photo/'+i}));
   people.push({id:'4',nickname:'默认头像',avatarUrl:'/avatar-placeholder.svg'},{id:'5',nickname:'无头像',avatarUrl:null});
   await page.route('**/api/**',async route=>{
    const p=new URL(route.request().url()).pathname;let data={};
    if(p.endsWith('/fixture-brand.svg')){await logoGate;return route.fulfill({contentType:'image/svg+xml',body:brand});}
    if(p.includes('/fixture-photo/')){if(p.endsWith('/3'))return route.fulfill({status:404,body:''});await photoGate;return route.fulfill({contentType:'image/png',body:photo});}
    if(p.endsWith('/auth/me'))data={id:'brand-fixture-'+theme};
    else if(p.endsWith('/csrf'))data={csrfToken:'fixture'};
    else if(p.endsWith('/stage-people'))data={generation:1,items:people};
    else if(p.endsWith('/claim'))data={fence:'1'};
    else if(p.endsWith('/draw'))data={generation:1,phase:'rehearsal',version:'1',signedIn:people.length,prizes:[{id:'prize',name:'测试奖项',theme,total:3,batch:3,awarded:0}],rounds:[],vacancies:[],awards:[]};
    else if(p.endsWith(id))data={id,name:'品牌占位检查',expires_at:'2099-12-31T00:00:00Z',display:{logo:true},logoUrl:'/api/fixture-brand.svg'};
    await route.fulfill({json:{data}});
   });
   await page.goto(origin+'/stage.html?activity='+id,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>brandProbe.system>0,null,{timeout:45000});
   assert.equal(await page.evaluate(()=>brandProbe.silhouettes),0);
   releaseLogo();
   await page.waitForFunction(()=>Object.values(brandProbe.tiles).filter(k=>k==='brand').length>=5,null,{timeout:45000});
   assert.equal(await page.evaluate(()=>brandProbe.photos),0);
   releasePhotos();
   await page.waitForFunction(()=>Object.values(brandProbe.tiles).filter(k=>k==='photo').length>=3,null,{timeout:45000});
   const result=await page.evaluate(()=>({tiles:Object.values(brandProbe.tiles),silhouettes:brandProbe.silhouettes}));
   assert.ok(result.tiles.filter(k=>k==='brand').length>=2,'Failed and missing avatars must retain the brand');
   assert.equal(result.silhouettes,0);assert.deepEqual(errors,[]);
   console.info('PASS '+theme+': first-frame brand, late custom logo, decoded photos, failed/missing avatars retain brand');
  }finally{releaseLogo();releasePhotos();await context.close();}
 }
}finally{await browser?.close();await web.close();}
