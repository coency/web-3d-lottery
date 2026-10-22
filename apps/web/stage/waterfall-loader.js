// Start downloading/compiling the physics worker before roster and scene setup.
// The scene takes ownership of this same worker; warming never starts a simulation.
let prepared=null;
export function prepareWaterfallWorker(){
 if(prepared)return prepared;
 const worker=new Worker(new URL('./waterfall-physics.worker.js',import.meta.url),{type:'module'});
 let finish;
 const ready=new Promise((resolve,reject)=>{
  const message=({data})=>{if(data.type==='prepared')finish();else if(data.type==='error')finish(new Error(data.message));};
  const error=()=>finish(new Error('碰撞引擎加载失败'));
  const timer=setTimeout(()=>finish(new Error('碰撞引擎加载超时')),90000);
  finish=reason=>{clearTimeout(timer);worker.removeEventListener('message',message);worker.removeEventListener('error',error);reason?reject(reason):resolve();};
  worker.addEventListener('message',message);worker.addEventListener('error',error);
 });
 ready.catch(()=>{});
 prepared={worker,ready,dispose(){finish(new Error('碰撞引擎加载已取消'));worker.terminate();}};
 worker.postMessage({type:'warmup'});
 return prepared;
}
export function takeWaterfallWorker(){const next=prepareWaterfallWorker();prepared=null;return next;}
export function cancelWaterfallPreparation(){prepared?.dispose();prepared=null;}
