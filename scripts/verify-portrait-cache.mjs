import {simulationPortraits} from './lib/simulation-portraits.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {root} from './lib/config.mjs';

await mkdir(path.join(root,'artifacts'),{recursive:true});
const directory=await mkdtemp(path.join(root,'artifacts/portrait-cache-'));
const avatars=await simulationPortraits(5000);
assert.equal(new Set(avatars.map(bytes=>createHash('sha256').update(bytes).digest('hex'))).size,5000);
const sampleMetadata=await sharp(avatars[0]).metadata();assert.equal(sampleMetadata.width,256);assert.equal(sampleMetadata.height,256);
const downloadBytes=avatars.slice(0,2000).reduce((sum,bytes)=>sum+bytes.length,0);
const timings={};
const requests=new Map(),checks=[],errors=[];let inflight=0,peak=0,blocked=false,context;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/avatars/')){
  requests.set(url.pathname,(requests.get(url.pathname)||0)+1);inflight++;peak=Math.max(peak,inflight);
  await new Promise(resolve=>setTimeout(resolve,5));inflight--;
  if(blocked){res.writeHead(503);res.end();return;}
  res.writeHead(200,{'Content-Type':'image/webp','Cache-Control':'no-store'});
  const key=url.pathname.slice('/avatars/'.length),index=key==='new-arrival'?4999:Number(key);
  res.end(avatars[index]);return;
 }
 if(['/portrait-cache.js','/portrait-store.js'].includes(url.pathname)){
  res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(path.join(root,'apps/web/stage',url.pathname.slice(1))));return;
 }
 res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>头像缓存隔离验证</title><h1>头像缓存验证</h1>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
async function open(){
 context=await chromium.launchPersistentContext(path.join(directory,'browser'),{executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);return page;
}
async function setup(page,scope,from=0,count=2000){
 await page.evaluate(async({scope,from,count})=>{
  window.cache?.dispose();const {createPortraitCache}=await import('/portrait-cache.js');
  window.cache=createPortraitCache({scope});window.urls=Array.from({length:count},(_,i)=>'/avatars/'+(from+i));window.cache.setRoster(window.urls);
 },{scope,from,count});
}
const ready=(page,total)=>page.waitForFunction(n=>window.cache.stats().cached===n,total,{timeout:120000});
const pass=name=>{checks.push(name);console.info('PASS '+name);};
try{
 let page=await open();const firstLoad=performance.now();await setup(page,'account:activity:rehearsal:1');
 await page.evaluate(()=>window.urls.slice(0,300).forEach(url=>window.cache.preload(url)));
 await ready(page,2000);assert.equal(requests.size,2000);assert.ok([...requests.values()].every(n=>n===1));assert.ok(peak<=6);
 timings.coldMs=Math.round(performance.now()-firstLoad);
 pass('2000 content-distinct WebP portraits downloaded once, at most six concurrent requests');
 await page.evaluate(()=>window.urls.forEach(url=>window.cache.preload(url)));
 await page.waitForFunction(()=>window.cache.stats().pending===0);
 const memory=await page.evaluate(()=>window.cache.stats());assert.equal(memory.decoded,512);
 assert.equal(await page.evaluate(()=>window.cache.get(window.urls.at(-1)) instanceof ImageBitmap),true);
 pass('decoded images remain bounded at 512 while all 2000 blobs persist');
 await context.close();context=null;
 const before=[...requests.values()].reduce((a,b)=>a+b,0);page=await open();blocked=true;
 const reopen=performance.now();await setup(page,'account:activity:rehearsal:1');await ready(page,2000);timings.reopenMs=Math.round(performance.now()-reopen);
 await page.evaluate(()=>window.cache.preload(window.urls[1234]));
 await page.waitForFunction(()=>!!window.cache.get(window.urls[1234]));
 assert.equal([...requests.values()].reduce((a,b)=>a+b,0),before);
 const pixel=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.drawImage(window.cache.get(window.urls[1234]),0,0);return [...ctx.getImageData(128,110,1,1).data];});
 const expected=await sharp(avatars[1234]).ensureAlpha().raw().toBuffer();const offset=(110*256+128)*4;
 assert.ok(pixel.every((value,i)=>Math.abs(value-expected[offset+i])<=4),JSON.stringify({pixel,expected:[...expected.subarray(offset,offset+4)]}));
 pass('closing and reopening the browser reuses disk files with avatar server unavailable; pixels render correctly');
 blocked=false;
 await page.evaluate(()=>window.cache.setRoster([...window.urls,'/avatars/new-arrival']));await ready(page,2001);
 assert.equal([...requests.values()].reduce((a,b)=>a+b,0),before+1);
 pass('a new check-in downloads only its new avatar');
 await setup(page,'account:activity:formal:1',0,1);await ready(page,1);assert.equal(requests.get('/avatars/0'),2);
 await setup(page,'another-account:activity:rehearsal:1',0,1);await ready(page,1);assert.equal(requests.get('/avatars/0'),3);
 await setup(page,'account:activity:rehearsal:2',0,1);await ready(page,1);assert.equal(requests.get('/avatars/0'),4);
 const scopes=await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('starlit-portraits-v1');r.onsuccess=()=>{const db=r.result,req=db.transaction('files').objectStore('files').getAll();req.onsuccess=()=>{resolve([...new Set(req.result.map(x=>x.scope))]);db.close();};req.onerror=()=>reject(req.error);};}));
 assert.ok(!scopes.includes('account:activity:rehearsal:1'));assert.ok(scopes.includes('account:activity:formal:1'));
 pass('accounts, formal/rehearsal and reset generations are isolated; obsolete generation is pruned');
 await setup(page,'account:resume:rehearsal:1',3000,2000);
 await page.waitForFunction(()=>window.cache.stats().cached>=30);
 await page.evaluate(()=>window.cache.dispose());await context.close();context=null;
 const finished=new Map(requests);page=await open();await setup(page,'account:resume:rehearsal:1',3000,2000);await ready(page,2000);
 // At most the six in-flight requests can have reached the server without
 // finishing their disk write when the browser was closed.
 const repeated=[...requests].filter(([url,n])=>url.startsWith('/avatars/')&&Number(url.slice(9))>=3000&&n>(finished.get(url)||0)&&finished.has(url));
 assert.ok(repeated.length<=6,JSON.stringify(repeated));
 pass('interrupted preparation resumes missing files; completed files are not redownloaded');
 const retention=await page.evaluate(async()=>{
  const {createPortraitStore,prunePortraitCaches}=await import('/portrait-store.js');
  const day=86400000,start=Date.UTC(2026,0,1);let time=start;
  const now=()=>time,iso=dayOffset=>new Date(start+dayOffset*day).toISOString();
  const stores=[];
  for(const [id,end] of [['active',50],['recent',34],['expired',33],['extended',10],['legacy',null]]){
   const store=createPortraitStore('retention:'+id+':formal:1',{now,activityExpiresAt:end===null?undefined:iso(end)});
   await store.put('/avatar',new Blob(['image']));stores.push([id,store]);
  }
  time=start+40*day;
  // The dashboard refresh supplies the new expiry before any deletion happens.
  await prunePortraitCaches('retention',[{id:'extended',expires_at:iso(60)},{id:'legacy',expires_at:iso(50)}],{now});
  const remaining=[];for(const [id,store] of stores){if(await store.get('/avatar'))remaining.push(id);store.close();}
  const migrated=createPortraitStore('retention:legacy:formal:1',{now});
  time=start+57*day;await migrated.prune();const removedAtDeadline=!(await migrated.get('/avatar'));migrated.close();
  return {remaining,removedAtDeadline};
 });
 assert.deepEqual(retention.remaining,['active','recent','extended','legacy']);
 assert.equal(retention.removedAtDeadline,true);
 pass('activity-end plus seven days retention preserves active/recent activities, honours extensions, migrates legacy caches and cleans at the deadline');
 assert.deepEqual(errors,[]);
 await writeFile(path.join(directory,'results.json'),JSON.stringify({checks,uniquePortraits:5000,downloadBytes,timings,peak,memory,errors},null,2));
 console.info('Evidence: '+directory);
}finally{await context?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
