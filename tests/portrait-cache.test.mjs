import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortraitCache} from '../apps/web/stage/portrait-cache.js';
import {createPortraitRasterizer} from '../apps/web/stage/portrait-raster.js';

test('raster reuse is bounded, follows decoded image changes and never aliases winner targets',()=>{
 const painted=[],contexts=[];
 const createCanvas=()=>({getContext(_type,options){contexts.push(options);return {fillRect(){},drawImage(image){painted.push(image);},fillText(text){painted.push(text);}};}});
 const raster=createPortraitRasterizer({maxEntries:2,createCanvas});
 const a={width:128,height:128},b={width:256,height:128},c={width:128,height:256};
 const first=raster.draw(a,'A');assert.equal(raster.draw(a,'another person'),first);assert.equal(painted.length,1);
 raster.draw(b,'B');raster.draw(a,'A');raster.draw(c,'C');raster.draw(b,'B');assert.equal(painted.length,4);
 const fallback=raster.draw(null,'未');assert.notEqual(raster.draw(a,'未'),fallback);
 const target=createCanvas();assert.equal(raster.draw(a,'A',512,target),target);assert.equal(raster.draw(b,'B',512,target),target);assert.equal(painted.at(-1),b);
 raster.clear();assert.notEqual(raster.draw(a,'A'),first);assert.ok(contexts.every(c=>c.willReadFrequently));
});

const settle=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(setImmediate);}assert.ok(predicate(),'cache did not settle');};
function disk(){const files=new Map();return {files,prune:async()=>{},get:async k=>files.get(k),put:async(k,v)=>{files.set(k,v);},remove:async k=>{files.delete(k);},close(){}};}
const blob=()=>new Blob(['avatar'],{type:'image/webp'});
function fixture(options={}){
 const store=options.store??disk(),requests=[],images=[],loaded=[];
 const cache=createPortraitCache({scope:'owner:activity:rehearsal:1',store,
  fetchBlob:async(url,signal)=>{requests.push(url);if(signal.aborted)throw new Error();return blob();},
  decodeBlob:async()=>{const image={closed:false,close(){this.closed=true;}};images.push(image);return image;},onLoad:url=>loaded.push(url),...options});
 return {cache,store,requests,images,loaded};
}
test('2000 downloads are deduplicated, stored, and reused without network after reopening',async()=>{
 const f=fixture();const urls=Array.from({length:2000},(_,i)=>'/avatar/'+i);
 f.cache.setRoster([...urls,...urls]);await settle(()=>f.cache.stats().cached===2000);
 assert.equal(f.requests.length,2000);assert.equal(f.cache.stats().decoded,0);assert.equal(f.cache.isReady(urls[0]),false);assert.ok(f.images.every(i=>i.closed));f.cache.dispose();
 const reopened=fixture({store:f.store,fetchBlob:async()=>{assert.fail('cached file was downloaded again');}});
 reopened.cache.setRoster(urls);await settle(()=>reopened.cache.stats().cached===2000);
 reopened.cache.preload(urls[0]);await settle(()=>reopened.loaded.length===1);assert.ok(reopened.cache.get(urls[0]));assert.equal(reopened.cache.isReady(urls[0]),true);
 assert.equal(reopened.cache.stats().total,2000);reopened.cache.dispose();
});
test('at most six downloads run and visible/winner requests precede background requests',async()=>{
 const requests=[],pending=[];const f=fixture({fetchBlob:(url)=>{requests.push(url);return new Promise(resolve=>pending.push(resolve));}});
 f.cache.setRoster(Array.from({length:20},(_,i)=>'/'+i));await settle(()=>requests.length===6);
 f.cache.load('/winner',{priority:3,display:true});f.cache.preload('/next');
 pending.shift()(blob());await settle(()=>requests.length===7);assert.equal(requests[6],'/winner');
 f.cache.setBusy(true);for(const resolve of pending.splice(0))resolve(blob());await settle(()=>requests.length===8);
 assert.equal(requests[7],'/next');assert.equal(pending.length,1);f.cache.dispose();pending.shift()(blob());
});

test('physics preparation pauses queued portraits and resumes the same queue afterwards',async()=>{
 const f=fixture();f.cache.setPaused(true);
 f.cache.setRoster(['/a','/b']);f.cache.preload('/a');
 await new Promise(setImmediate);assert.deepEqual(f.requests,[]);assert.equal(f.cache.stats().pending,2);
 f.cache.setBusy(true);f.cache.setPaused(false);
 await settle(()=>f.cache.stats().cached===2);
 assert.deepEqual(f.requests,['/a','/b']);assert.ok(f.cache.isReady('/a'));f.cache.dispose();
});
test('decoded memory is bounded and evicted images reload from disk, not network',async()=>{
 const f=fixture({maxDecoded:3});f.cache.setRoster(['/a','/b','/c','/d']);await settle(()=>f.cache.stats().cached===4);
 for(const url of ['/a','/b','/c','/d']){f.cache.preload(url);await settle(()=>f.cache.stats().decoded===Math.min(f.loaded.length,3)&&f.loaded.includes(url));}
 assert.equal(f.cache.stats().decoded,3);const requests=f.requests.length;
 assert.equal(f.cache.get('/a'),null);await settle(()=>f.loaded.length===5);assert.ok(f.cache.get('/a'));assert.equal(f.requests.length,requests);assert.equal(f.cache.stats().decoded,3);f.cache.dispose();assert.ok(f.images.every(i=>i.closed));
});
test('quota failures keep rendering with bounded temporary blobs and report degraded storage',async()=>{
 const store=disk();store.put=async()=>{throw new Error('QuotaExceededError');};
 const f=fixture({store,maxFallbackBytes:12,maxDecoded:2});
 f.cache.setRoster(['/a','/b','/c']);await settle(()=>f.requests.length===3&&f.cache.stats().failed===1);
 assert.equal(f.cache.stats().pending,0);
 assert.equal(f.cache.stats().storageAvailable,false);assert.equal(f.cache.stats().cached,0);
 f.cache.preload('/c');await settle(()=>f.loaded.includes('/c'));assert.ok(f.cache.get('/c'));f.cache.dispose();
});
test('failed downloads back off, manual retry deduplicates, and disposal ignores late responses',async()=>{
 const timers=new Map();let sequence=0,fail=true;
 const f=fixture({schedule:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,delay});return id;},cancel:id=>timers.delete(id),fetchBlob:async()=>{if(fail)throw new Error('offline');return blob();}});
 f.cache.setRoster(['/avatar']);await settle(()=>[...timers.values()].some(t=>t.delay===1000));
 fail=false;f.cache.retryFailed();f.cache.retryFailed();await settle(()=>f.cache.stats().cached===1);
 assert.equal([...timers.values()].some(t=>t.delay===1000),false);f.cache.dispose();assert.equal(timers.size,0);
 let resolve;const late=fixture({fetchBlob:()=>new Promise(r=>{resolve=r;})});late.cache.preload('/late');await settle(()=>!!resolve);late.cache.dispose();resolve(blob());await new Promise(setImmediate);assert.equal(late.loaded.length,0);assert.equal(late.store.files.size,0);
});
test('a corrupt persisted file is removed and replaced on retry',async()=>{
 const store=disk();store.files.set('/bad',new Blob(['corrupt']));let attempts=0;
 const f=fixture({store,decodeBlob:async b=>{attempts++;if(await b.text()==='corrupt')throw new Error('bad');return {close(){}};}});
 f.cache.preload('/bad');await settle(()=>attempts===1&&!store.files.has('/bad'));
 f.cache.retryFailed();await settle(()=>f.cache.stats().decoded===1);assert.deepEqual(f.requests,['/bad']);f.cache.dispose();
});

// Brand placeholders are shared across all themes, including winner canvases.
import {createStagePortraits} from '../apps/web/stage/portrait-source.js';
test('pending, failed and missing avatars use the brand; decoded photos replace it',()=>{
 const images=new Map(),photos=new Map(),requests=[],painted=[];
 const createCanvas=()=>({getContext(){return {fillRect(){},drawImage(source,...args){painted.push({source,args});},save(){},scale(){},beginPath(){},moveTo(){},bezierCurveTo(){},closePath(){},fill(){painted.push({source:'system-vector'});},restore(){}};}});
 const raster={draw(image,label,size,target){painted.push({source:image});return target||{photo:image};}};
 let url='/brand';
 const portraits={get:key=>photos.get(key),isReady:key=>photos.has(key),preload:key=>requests.push(key)};
 const {avatar,logo}=createStagePortraits({images:{load:key=>requests.push(key),get:key=>images.get(key)},getPortraits:()=>portraits,getLogoUrl:()=>url,raster,createCanvas});
 const person={avatarUrl:'/photo',nickname:'真实用户'};
 const first=avatar(person);assert.equal(painted.at(-1).source,'system-vector');assert.equal(avatar(person),first);assert.equal(avatar.isReady(person),false);
 const brand={width:256,height:128};images.set('/brand',brand);const readyBrand=avatar(person);assert.notEqual(readyBrand,first);assert.equal(painted.at(-1).source,brand);
 const [x,y,width,height]=painted.at(-1).args;assert.equal(width/height,2);assert.ok(x>=0&&y>=0&&x+width<=128&&y+height<=128,'Brand logo remains fully visible without cropping');
 assert.equal(avatar(person),readyBrand,'Failed or still-pending photos keep the logo');
 assert.equal(avatar({nickname:'没有头像'}),readyBrand);assert.equal(avatar({avatarUrl:'/avatar-placeholder.svg'}),readyBrand);
 const photo={width:128,height:128};photos.set('/photo',photo);assert.equal(avatar.isReady(person),true);assert.equal(avatar(person).photo,photo);
 const target=createCanvas();assert.equal(avatar(person,512,target),target);photos.delete('/photo');assert.equal(avatar(person,512,target),target);assert.equal(painted.at(-1).source,brand);
 assert.equal(logo.changed(new Set(['/brand'])),true);assert.equal(logo.changed(new Set(['/other'])),false);assert.equal(logo.version(),brand);
 url=null;const system={width:64,height:64};images.set('/favicon.svg',system);avatar(person);assert.equal(painted.at(-1).source,system);
});
