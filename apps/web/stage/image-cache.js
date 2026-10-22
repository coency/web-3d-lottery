// Deduplicate requests; back off on failure and retry again when connectivity returns.
export function createImageCache({onLoad=()=>{},createImage=()=>new Image(),schedule=setTimeout,cancel=clearTimeout}={}){
 const entries=new Map(),delays=[1000,3000,10000,30000];let disposed=false;
 function attempt(url,entry){
  if(disposed)return;
  entry.status='loading';entry.timer=null;const image=createImage();entry.request=image;
  image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';
  const finish=success=>{
   if(entry.request!==image||disposed)return;
   image.onload=image.onerror=null;cancel(entry.timeout);entry.timeout=null;entry.request=null;
   if(success){entry.image=image;entry.status='ready';onLoad(url);return;}
   entry.status='failed';
   if(entry.failures<delays.length){const delay=delays[entry.failures++];entry.timer=schedule(()=>attempt(url,entry),delay);}
  };
  image.onload=()=>finish(true);image.onerror=()=>finish(false);
  entry.timeout=schedule(()=>{finish(false);image.src='';},15000);image.src=url;
 }
 function load(url){
  if(!url||disposed||entries.has(url))return;
  const entry={image:null,request:null,status:'loading',failures:0,timer:null,timeout:null};entries.set(url,entry);attempt(url,entry);
 }
 function retryFailed(){
  if(disposed)return;
  for(const [url,entry] of entries)if(entry.status==='failed'){if(entry.timer!==null)cancel(entry.timer);entry.failures=0;attempt(url,entry);}
 }
 function dispose(){
  disposed=true;
  for(const entry of entries.values()){
   if(entry.timer!==null)cancel(entry.timer);if(entry.timeout!==null)cancel(entry.timeout);
   if(entry.request){entry.request.onload=entry.request.onerror=null;entry.request.src='';entry.request=null;}
  }
  entries.clear();
 }
 return {load,get:url=>entries.get(url)?.image??null,retryFailed,dispose};
}
