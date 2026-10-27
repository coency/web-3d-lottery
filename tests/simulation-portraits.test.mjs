import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {SimulationPortraitStore} from '../apps/api/build/activities/simulation-portrait-store.js';
import {renderSimulationPortrait} from '../apps/api/build/activities/simulation-portrait.js';
import {SimulationPortraitService} from '../apps/api/build/activities/simulation-portraits.js';

test('portraits are deterministic, distinct WebP images and reject invalid seeds',async()=>{
 const a=await renderSimulationPortrait(1),b=await renderSimulationPortrait(2);
 assert.deepEqual(await renderSimulationPortrait(1),a);assert.notDeepEqual(a,b);
 const meta=await sharp(a).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,256);assert.equal(meta.height,256);
 for(const n of [0,5001,1.5,NaN])assert.throws(()=>renderSimulationPortrait(n),RangeError);
});
test('lazy creation, bounded encoding, deduplication, reuse after restart and regeneration',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'starlit-portraits-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const images=path.join(dir,'images');let calls=0,active=0,peak=0;
 const render=async n=>{calls++;active++;peak=Math.max(active,peak);await new Promise(r=>setTimeout(r,5));active--;return Buffer.from('portrait-'+n);};
 const store=new SimulationPortraitStore(images,render);t.after(()=>store.close());
 assert.deepEqual(await readdir(dir),[]);
 await Promise.all([store.warm(5),store.ensure(1),store.ensure(1),store.warm(8)]);
 assert.equal(calls,8);assert.equal(peak,2);assert.equal((await readdir(images)).length,8);
 await store.warm(8);await store.warm(10);assert.equal(calls,10);
 await store.close();
 const reopened=new SimulationPortraitStore(images,render);t.after(()=>reopened.close());
 await reopened.ensure(1);assert.equal(calls,10);
 await unlink(path.join(images,'1.webp'));assert.equal((await reopened.ensure(1)).toString(),'portrait-1');assert.equal(calls,11);
 assert.ok((await readdir(images)).every(f=>f.endsWith('.webp')));
});
test('encoding failures can be retried and do not publish partial files',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'starlit-portraits-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let fail=true;const store=new SimulationPortraitStore(dir,async()=>{if(fail)throw Error('encode failed');return Buffer.from('ready');});t.after(()=>store.close());
 await assert.rejects(store.warm(1),/encode failed/);assert.deepEqual(await readdir(dir),[]);
 fail=false;await store.warm(1);assert.deepEqual(await readdir(dir),['1.webp']);
});
test('public route validates names and only generates referenced simulated participants',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'starlit-portraits-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const previous=process.env.ASSET_DIRECTORY;process.env.ASSET_DIRECTORY=dir;
 let exists=false,queries=0;
 const db={transaction:fn=>fn({query:async(_sql,args)=>{queries++;assert.deepEqual(args,['rehearsal-simulation-1','/demo-avatars/portraits-v1/1.webp']);return {rowCount:exists?1:0};}})};
 const service=new SimulationPortraitService(db);
 if(previous===undefined)delete process.env.ASSET_DIRECTORY;else process.env.ASSET_DIRECTORY=previous;
 t.after(()=>service.onModuleDestroy());
 for(const name of ['0.webp','5001.webp','../1.webp','01.webp','1.svg'])await assert.rejects(service.image(name),e=>e.getStatus()===404);
 assert.equal(queries,0);await assert.rejects(service.image('1.webp'),e=>e.getStatus()===404);assert.deepEqual(await readdir(dir),[]);
 exists=true;const bytes=await service.image('1.webp');assert.equal((await sharp(bytes).metadata()).format,'webp');
 exists=false;assert.deepEqual(await service.image('1.webp'),bytes);assert.equal(queries,2);
});
