import {createPortraitStore} from './portrait-store.js';

async function download(url,signal){
 const response=await fetch(url,{credentials:'same-origin',signal});
 if(!response.ok)throw new Error('Avatar request failed');
 if(!response.headers.get('content-type')?.startsWith('image/'))throw new Error('Invalid avatar response');
 const max=1024*1024;if(Number(response.headers.get('content-length'))>max)throw new Error('Avatar too large');
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max)throw new Error('Avatar too large');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});}
 return new Blob(chunks,{type:response.headers.get('content-type')});
}
function decode(blob,signal){
 // Image.onload can leave the first real decode until drawImage, putting an
 // entire newly rotated batch on the animation thread. Prepare decoded bitmaps
 // asynchronously before exposing them to the stage; retain the same resolution.
 if(typeof createImageBitmap==='function')return createImageBitmap(blob).then(image=>{
  if(signal.aborted){image.close();throw new Error('Avatar decoding cancelled');}
  return image;
 });
 return new Promise((resolve,reject)=>{
  const image=new Image(),url=URL.createObjectURL(blob);
  const finish=(error)=>{image.onload=image.onerror=null;signal.removeEventListener('abort',abort);URL.revokeObjectURL(url);if(error){image.src='';reject(error);}else resolve(image);};
  const abort=()=>finish(new Error('Avatar decoding cancelled'));
  image.onload=()=>finish();image.onerror=()=>finish(new Error('Invalid avatar image'));
  if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});image.src=url;
 });
}
const release=image=>{if(image?.close)image.close();else if(image)image.src='';};

// Downloaded blobs live on disk. Only recently displayed portraits stay decoded.
export function createPortraitCache({scope,activityExpiresAt,store=createPortraitStore(scope,{activityExpiresAt}),fetchBlob=download,decodeBlob=decode,
 onLoad=()=>{},onChange=()=>{},concurrency=6,maxDecoded=512,maxFallbackBytes=32*1024*1024,
 schedule=setTimeout,cancel=clearTimeout}={}){
 const entries=new Map(),decoded=new Map(),fallback=new Map(),delays=[1000,3000,10000,30000];
 let active=0,disposed=false,busy=false,paused=false,storage=true,fallbackBytes=0,sequence=0,notification=null;
 const startup=store.prune().catch(()=>{storage=false;});
 const stats=()=>{
  const list=[...entries.values()].filter(e=>e.roster);
  return {total:list.length,cached:list.filter(e=>e.saved).length,ready:list.filter(e=>e.status==='ready').length,
   failed:list.filter(e=>(e.status==='failed'&&!e.timer)||e.status==='evicted').length,pending:list.filter(e=>e.status==='queued'||e.status==='loading'||(e.status==='failed'&&e.timer)).length,
   decoded:decoded.size,storageAvailable:storage};
 };
 function changed(){if(disposed||notification!==null)return;notification=schedule(()=>{notification=null;if(!disposed)onChange(stats());},100);}
 function entry(url){if(!url||disposed)return null;let e=entries.get(url);if(!e){e={url,status:'queued',saved:false,wanted:false,priority:0,order:sequence++,failures:0,timer:null};entries.set(url,e);}return e;}
 function keepBlob(e,blob){
  if(fallback.has(e.url))fallbackBytes-=fallback.get(e.url).size;
  fallback.delete(e.url);fallback.set(e.url,blob);fallbackBytes+=blob.size;
  while(fallbackBytes>maxFallbackBytes&&fallback.size){const [url,old]=fallback.entries().next().value;fallback.delete(url);fallbackBytes-=old.size;
   const evicted=entries.get(url);if(evicted&&!evicted.saved&&!decoded.has(url))evicted.status='evicted';}
 }
 function keepImage(e,image){
  if(disposed){release(image);return;}
  release(decoded.get(e.url));decoded.delete(e.url);decoded.set(e.url,image);
  while(decoded.size>maxDecoded){const [url,old]=decoded.entries().next().value;decoded.delete(url);release(old);
   const evicted=entries.get(url);if(evicted&&!evicted.saved&&!fallback.has(url))evicted.status='evicted';}
  onLoad(e.url);
 }
 async function work(e){
  active++;e.status='loading';e.controller=new AbortController();const signal=e.controller.signal;
  const timeout=schedule(()=>e.controller.abort(),20000);
  try{
   await startup;if(disposed) return;
   let blob=fallback.get(e.url),fromDisk=false;
   if(!blob&&storage){try{blob=await store.get(e.url);fromDisk=!!blob;}catch{storage=false;}}
   if(!blob){e.saved=false;blob=await fetchBlob(e.url,signal);}
   if(disposed||signal.aborted)throw new Error('Cancelled');
   let image;
   // Validate downloaded files before counting them as prepared. Disk hits were
   // already validated; only decode those when a visible/next/winner slot asks.
   if(!fromDisk||e.wanted){
    try{image=await decodeBlob(blob,signal);}catch(error){if(fromDisk){await store.remove(e.url).catch(()=>{});e.saved=false;}throw error;}
   }
   if(disposed||signal.aborted){release(image);throw new Error('Cancelled');}
   if(fromDisk)e.saved=true;
   else if(storage){try{await store.put(e.url,blob);e.saved=true;}catch{storage=false;e.saved=false;}}
   if(!e.saved)keepBlob(e,blob);
   e.status='ready';e.failures=0;
   if(e.wanted&&image)keepImage(e,image);else release(image);
   // A display request may arrive while a cached file is being read.
   if(e.wanted&&!decoded.has(e.url)){e.status='queued';}
  }catch{
   if(!disposed){e.status='failed';if(e.failures<delays.length){const delay=delays[e.failures++];e.timer=schedule(()=>{e.timer=null;e.status='queued';pump();changed();},delay);}}
  }finally{cancel(timeout);e.controller=null;active--;changed();pump();}
 }
 function pump(){
  if(disposed||paused)return;
  while(active<(busy?1:concurrency)){
   let next;for(const e of entries.values())if(e.status==='queued'&&(!next||e.priority>next.priority||(e.priority===next.priority&&e.order<next.order)))next=e;
   if(!next)break;void work(next);
  }
 }
 function load(url,{priority=0,display=false}={}){
  const e=entry(url);if(!e)return;e.priority=Math.max(e.priority,priority);e.wanted ||= display;
  if((e.status==='ready'&&!decoded.has(url)&&display)||e.status==='evicted')e.status='queued';pump();changed();
 }
 function get(url){
  const image=decoded.get(url);if(image){decoded.delete(url);decoded.set(url,image);return image;}
  load(url,{priority:2,display:true});return null;
 }
 return {load,get,stats,isReady:url=>decoded.has(url),
  preload(url){load(url,{priority:1,display:true});},
  setRoster(urls){for(const e of entries.values())e.roster=false;for(const url of new Set(urls.filter(Boolean))){const e=entry(url);if(e)e.roster=true;}pump();changed();},
  setBusy(value){busy=value;pump();},
  setPaused(value){paused=value;pump();},
  retryFailed(){for(const e of entries.values())if(e.status==='failed'||e.status==='evicted'){if(e.timer)cancel(e.timer);e.timer=null;e.failures=0;e.status='queued';}pump();changed();},
  dispose(){disposed=true;if(notification!==null)cancel(notification);for(const e of entries.values()){if(e.timer)cancel(e.timer);e.controller?.abort();}for(const image of decoded.values())release(image);decoded.clear();fallback.clear();entries.clear();store.close();},
 };
}
