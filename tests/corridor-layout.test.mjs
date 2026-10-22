import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {corridorSlots,corridorView,corridorColumn,corridorPosition,corridorDistance,corridorFlightSources,CORRIDOR_COUNT} from '../apps/web/stage/corridor-layout.js';
import {createCorridor} from '../apps/web/stage/corridor.js';
import {createRingPortraitRotation} from '../apps/web/stage/ring-portraits.js';
test('corridor has 150 slots per wall and fits its initial framing',()=>{
 const slots=corridorSlots();assert.equal(slots.length,300);assert.equal(slots.filter(s=>s.side===1).length,150);
 for(const [w,h] of [[1625,884],[900,768],[2560,1440]]){
 const view=corridorView(w,h);
 for(const slot of slots){const p={};corridorPosition(slot,corridorColumn(slot.column,0),view,p);const f=view.focal/(view.cameraZ-p.z);assert.ok(Math.abs(p.x*f)<w/2-30);assert.ok(Math.abs((p.y+view.centerY)*f)<h/2-110);}
 assert.ok(9*view.focal/corridorDistance(20.999,view)>w/2);
 }
});
test('recycling covers 1000 people without duplicate visible identities or extra slots',()=>{
 const queue=createRingPortraitRotation(15,20);let ids=queue.update(Array.from({length:1000},(_,i)=>i));const seen=new Set(ids);
 for(let i=0;i<50;i++){ids=queue.advanceLayer(i%15);assert.equal(ids.length,CORRIDOR_COUNT);assert.equal(new Set(ids).size,300);ids.forEach(id=>seen.add(id));}assert.equal(seen.size,1000);
});
test('winner sources are distinct, visible and preserve matching identities',()=>{
 const people=Array.from({length:300},(_,id)=>({id}));const sources=corridorFlightSources(people,[{participant_id:20},{participant_id:21},{participant_id:999},{participant_id:998}],i=>i>=20&&i<60);
 assert.deepEqual(sources.slice(0,2),[20,21]);assert.equal(new Set(sources).size,4);assert.ok(sources.every(i=>i>=20&&i<60));
});
test('corridor resets during reveal then resumes idle travel behind persistent results',()=>{
 const c=createCorridor(new THREE.Group(),1),dummy=new THREE.Object3D();c.resize(1625,884);c.setEnabled(true);let recycled=0,now=0;
 for(let i=0;i<200;i++){now+=20;c.update(.02,now,{phase:'rolling',reduced:false,revealing:false},()=>recycled++);}assert.ok(c.travel< -10);assert.ok(recycled>0);const before=recycled;
 for(let i=0;i<100;i++){now+=20;c.update(.02,now,{phase:'result',reduced:false,revealing:true},()=>recycled++);}assert.equal(c.travel,0);assert.equal(c.resetting,false);assert.equal(recycled,before);
 for(const [i,slot] of corridorSlots().entries()){const p={};corridorPosition(slot,corridorColumn(slot.column,0),c.view,p);c.apply(i,dummy);assert.ok(dummy.position.distanceTo(new THREE.Vector3(p.x,p.y,p.z))<.00001);}
 const beforeResume=c.travel;for(let i=0;i<200;i++){now+=20;c.update(.02,now,{phase:'result',reduced:false,revealing:false},()=>recycled++);}
 assert.ok(c.travel<beforeResume-1);assert.ok(Math.abs(c.movingSpeed+.45)<.001);assert.ok(recycled>before);
});
test('reduced motion keeps walls still while rotating portraits at a low frequency',()=>{
 const c=createCorridor(new THREE.Group(),1);c.resize(900,768);c.setEnabled(true);let count=0;
 for(let i=0;i<200;i++)c.update(.02,i*20,{phase:'idle',reduced:true,revealing:false},()=>count++);
 assert.equal(c.travel,0);assert.equal(count,1);
});

test('sparse participants keep random positions on both walls after repeated recycling',()=>{
 let seed=42;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 const queue=createRingPortraitRotation(15,20,random,{shuffleLayer:true});
 let slots=queue.update(Array.from({length:100},(_,i)=>i));const initial=[...slots];
 for(let cycle=0;cycle<20;cycle++){
  for(let layer=14;layer>=0;layer--)slots=queue.advanceLayer(layer);
  const people=slots.filter(id=>id!==null),left=slots.filter((id,i)=>id!==null&&i%20<10).length;
  assert.equal(people.length,100);assert.equal(new Set(people).size,100);
  assert.ok(left>20&&left<80,`both walls must retain participants, left=${left}`);
 }
 assert.notDeepEqual(slots,initial);
 const fewer=queue.update(Array.from({length:60},(_,i)=>i));assert.equal(fewer.filter(id=>id!==null).length,60);assert.ok(fewer.every(id=>id===null||id<60));
});

test('rolling walls recede and recycle in reverse without losing portrait coverage',()=>{
 const c=createCorridor(new THREE.Group(),1),dummy=new THREE.Object3D(),queue=createRingPortraitRotation(15,20,Math.random,{shuffleLayer:true});
 let ids=queue.update(Array.from({length:1000},(_,i)=>i));const seen=new Set(ids),recycled=new Set();
 c.resize(1625,884);c.setEnabled(true);c.update(0,0,{phase:'idle',reduced:false,revealing:false},()=>{});
 c.apply(100,dummy);const initialZ=dummy.position.z;
 for(let i=1;i<=1500;i++){
  c.update(.02,i*20,{phase:'rolling',reduced:false,revealing:false},column=>{
   recycled.add(column);ids=queue.advanceLayer(column);assert.equal(new Set(ids).size,300);ids.forEach(id=>seen.add(id));
  });
  if(i===50){c.apply(100,dummy);assert.ok(dummy.position.z<initialZ,'wall boxes must move away from the camera');}
  for(let column=0;column<15;column++){
   const state=corridorColumn(column,c.travel);assert.ok(state.age>=0&&state.age<15);assert.ok(state.scale>=0&&state.scale<=1);
  }
 }
 assert.equal(recycled.size,15);assert.equal(seen.size,1000);assert.ok(Math.abs(c.movingSpeed+3.6)<.001);
});
