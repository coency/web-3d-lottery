import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {renderSimulationPortrait} from './simulation-portrait';

// At most two encoders, shared by background preparation and on-demand reads.
export class SimulationPortraitStore {
 private pending=new Map<number,Promise<Buffer>>();
 private queue:Array<()=>void>=[];
 private active=0;
 private target=0;
 private next=1;
 private warming?:Promise<void>;
 private stopped=false;
 constructor(readonly directory:string,private render=renderSimulationPortrait){}
 private filename(id:number){
  if(!Number.isInteger(id)||id<1||id>5000)throw new RangeError('Invalid simulated portrait number');
  return path.join(this.directory,id+'.webp');
 }
 async cached(id:number):Promise<Buffer|null>{
  try{return await readFile(this.filename(id));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
 }
 ensure(id:number):Promise<Buffer>{
  this.filename(id);
  const existing=this.pending.get(id);if(existing)return existing;
  if(this.stopped)return Promise.reject(new Error('Portrait store is shutting down'));
  const job=new Promise<Buffer>((resolve,reject)=>{
   this.queue.push(()=>{
    this.active++;
    void this.generate(id).then(resolve,reject).finally(()=>{this.active--;this.pump();});
   });
  });
  this.pending.set(id,job);
  void job.then(()=>this.pending.delete(id),()=>this.pending.delete(id));
  this.pump();return job;
 }
 private pump(){while(this.active<2&&this.queue.length)this.queue.shift()!();}
 private async generate(id:number){
  const cached=await this.cached(id);if(cached)return cached;
  const bytes=await this.render(id);
  await mkdir(this.directory,{recursive:true});
  const filename=this.filename(id),temporary=filename+'.'+randomUUID()+'.tmp';
  try{await writeFile(temporary,bytes,{flag:'wx',mode:0o644});await rename(temporary,filename);}
  finally{await unlink(temporary).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});}
  return bytes;
 }
 warm(target:number):Promise<void>{
  this.filename(target);this.target=Math.max(this.target,target);
  if(this.stopped||this.next>this.target)return Promise.resolve();
  if(!this.warming){
   this.warming=(async()=>{
    try{
     // No array of 5000 queued encodes: foreground reads can get a slot promptly.
     while(!this.stopped&&this.next<=this.target){
      const first=this.next;
      const ids=Array.from({length:Math.min(2,this.target-first+1)},(_,i)=>first+i);
      const results=await Promise.allSettled(ids.map(id=>this.ensure(id)));
      const failure=results.find(r=>r.status==='rejected');
      if(failure?.status==='rejected')throw failure.reason;
      this.next+=ids.length;
     }
    }finally{this.warming=undefined;}
   })();
  }
  return this.warming;
 }
 async close(){this.stopped=true;await Promise.allSettled([...this.pending.values(),...(this.warming?[this.warming]:[])]);}
}
