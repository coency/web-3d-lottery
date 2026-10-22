import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {waterfallSlots,waterfallView,waterfallSeed,waterfallQuaternion,waterfallFlightSources,WATERFALL_COUNT,WATERFALL_HALF} from '../apps/web/stage/waterfall-layout.js';
import {initWaterfallPhysics,createWaterfallPhysics,PHYSICS_STEP} from '../apps/web/stage/waterfall-physics.js';
import {createRingPortraitRotation} from '../apps/web/stage/ring-portraits.js';
import {createWaterfallHunters} from '../apps/web/stage/waterfall-hunters.js';
await initWaterfallPhysics();
function rng(){let seed=73;return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function create(recycling=true,staticLayout=false){const random=rng();return createWaterfallPhysics({view:waterfallView(1625,884),slots:waterfallSlots(random),random,recycling,staticLayout});}
function overlap(a,b,ha,hb){
 const axes=q=>[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)].map(v=>v.applyQuaternion(q));
 const aa=axes(a.rotation()),bb=axes(b.rotation()),d=new THREE.Vector3().copy(a.translation()).sub(b.translation());
 const directions=[...aa,...bb,...aa.flatMap(x=>bb.map(y=>x.clone().cross(y)))];let result=Infinity;
 for(const n of directions){if(n.lengthSq()<1e-10)continue;n.normalize();const separation=Math.abs(d.dot(n)),r=ha*aa.reduce((s,x)=>s+Math.abs(x.dot(n)),0)+hb*bb.reduce((s,x)=>s+Math.abs(x.dot(n)),0);result=Math.min(result,r-separation);}
 return result;
}
test('300 non-overlapping seed positions fit the fixed camera in three depth bands',()=>{
 const slots=waterfallSlots(rng());assert.equal(WATERFALL_COUNT,300);assert.equal(slots.length,WATERFALL_COUNT);
 for(const [w,h] of [[1625,884],[900,768],[2560,1440]]){
  const view=waterfallView(w,h),points=slots.map(s=>waterfallSeed(s,view));
  for(const p of points){const x=p.x*view.focal/(view.cameraZ-p.z);assert.ok(Math.abs(x)<w*.46);assert.ok(p.y>view.ground+.65);}
  for(let i=0;i<WATERFALL_COUNT;i++)for(let j=i+1;j<WATERFALL_COUNT;j++){
   if(new THREE.Vector3().copy(points[i]).distanceTo(points[j])>1.4)continue;
   const a={translation:()=>points[i],rotation:()=>waterfallQuaternion(slots[i].angle)},b={translation:()=>points[j],rotation:()=>waterfallQuaternion(slots[j].angle)};
   assert.ok(overlap(a,b,WATERFALL_HALF+.008,WATERFALL_HALF+.008)<=0,'seed overlap at '+w+'x'+h+' slots '+i+'/'+j);
  }
 }
});
test('off-centre box collisions transfer momentum and produce rotation without visible interpenetration',()=>{
 const s=create(false,true);try{
  s.world.gravity={x:0,y:0,z:0};for(let i=2;i<WATERFALL_COUNT;i++)s.bodies[i].setEnabled(false);
  const [a,b]=s.bodies;for(const body of [a,b]){body.setRotation({x:0,y:0,z:0,w:1},true);body.setAngvel({x:0,y:0,z:0},true);}
  a.setTranslation({x:-1,y:0,z:.18},true);b.setTranslation({x:0,y:0,z:0},true);a.setLinvel({x:3,y:0,z:0},true);
  let transferred=0,rotation=0,penetration=0;
  for(let i=0;i<180;i++){s.advance(PHYSICS_STEP);transferred=Math.max(transferred,b.linvel().x);rotation=Math.max(rotation,Math.abs(b.rotation().y));penetration=Math.max(penetration,overlap(a,b,WATERFALL_HALF,WATERFALL_HALF));}
  assert.ok(s.snapshot().stats.bodyContacts>0);assert.ok(transferred>1);assert.ok(rotation>.05);assert.ok(penetration<.012,'penetration '+penetration);
 }finally{s.dispose();}
});
test('three boxes settle into a supported stack instead of passing through one another',()=>{
 const s=create(false,true);try{
  for(let i=3;i<WATERFALL_COUNT;i++)s.bodies[i].setEnabled(false);
  const ground=waterfallView(1625,884).ground;
  for(let i=0;i<3;i++){const b=s.bodies[i];b.setTranslation({x:0,y:ground+1+i*1.7,z:-8},true);b.setRotation({x:0,y:0,z:0,w:1},true);b.setAngvel({x:0,y:0,z:0},true);}
  for(let i=0;i<1200;i++)s.advance(PHYSICS_STEP);
  const ys=s.bodies.slice(0,3).map(b=>b.translation().y).sort((a,b)=>a-b);
  assert.ok(ys[0]-WATERFALL_HALF>=ground-.008);assert.ok(ys[1]-ys[0]>.74);assert.ok(ys[2]-ys[1]>.74);
  assert.ok(s.snapshot().stats.bodyContacts>=2);assert.ok(s.bodies.slice(0,3).every(b=>Math.abs(b.linvel().y)<.05));
 }finally{s.dispose();}
});
test('300-body recycling stays bounded, covers the roster, shrinks colliders with visuals and preserves a paused snapshot',()=>{
 const s=create(),queue=createRingPortraitRotation(WATERFALL_COUNT,1),seen=new Set(),generations=new Int32Array(WATERFALL_COUNT);let ids=queue.update(Array.from({length:1000},(_,i)=>i)),shrinking=false,maxOverlap=0;
 try{
  for(let frame=0;frame<4800;frame++){
   s.advance(PHYSICS_STEP);
   for(let i=0;i<WATERFALL_COUNT;i++){
    const state=s.states[i];if(state.generation!==generations[i]){ids=queue.advanceLayer(i);generations[i]=state.generation;}
    if(!state.waiting&&state.scale>.85)seen.add(ids[i]);
    if(state.scale>.1&&state.scale<.9){shrinking=true;assert.ok(Math.abs(s.colliders[i].halfExtents().x-(WATERFALL_HALF+.008)*state.scale)<1e-6);}
   }
   if(frame%60===0)for(let i=0;i<WATERFALL_COUNT;i++){
    if(s.states[i].waiting)continue;
    s.world.contactPairsWith(s.colliders[i],c=>{const j=s.colliders.indexOf(c);if(j>i&&!s.states[j].waiting)maxOverlap=Math.max(maxOverlap,overlap(s.bodies[i],s.bodies[j],WATERFALL_HALF*s.states[i].scale,WATERFALL_HALF*s.states[j].scale));});
   }
  }
  const before=s.snapshot();s.advance(0);assert.deepEqual(s.snapshot().data,before.data);
  assert.equal(seen.size,1000);assert.equal(s.world.bodies.len(),WATERFALL_COUNT);assert.equal(s.world.colliders.len(),WATERFALL_COUNT+3);assert.ok(shrinking);assert.ok(before.stats.recycled>WATERFALL_COUNT);assert.ok(before.stats.bodyContacts>500);assert.ok([...before.data].every(Number.isFinite));
  assert.ok(maxOverlap<.018,'maximum visible overlap '+maxOverlap);console.log('contacts / recycled / max overlap',before.stats.bodyContacts,before.stats.recycled,maxOverlap);
 }finally{s.dispose();}
});
test('matching winners use visible unique source slots',()=>{
 const people=Array.from({length:WATERFALL_COUNT},(_,id)=>({id}));const indices=waterfallFlightSources(people,[{participant_id:20},{participant_id:21},{participant_id:999}],i=>i>=20&&i<60);
 assert.deepEqual(indices.slice(0,2),[20,21]);assert.equal(new Set(indices).size,3);assert.ok(indices.every(i=>i>=20&&i<60));
});
test('startup streams from above with staggered first arrivals and preserves their assigned portraits',()=>{
 const s=create(false),view=waterfallView(1625,884),slots=waterfallSlots(rng()),entered=new Set();
 try{
  assert.ok(s.states.every((state,i)=>state.scale===0&&!s.bodies[i].isEnabled()));
  const before=s.snapshot().data;s.advance(0);assert.deepEqual(s.snapshot().data,before);
  for(let frame=0;frame<1200;frame++){
   s.advance(PHYSICS_STEP);let newEntries=0;
   for(let i=0;i<WATERFALL_COUNT;i++)if(s.states[i].entered&&!entered.has(i)){
    entered.add(i);newEntries++;
    assert.ok(s.bodies[i].translation().y>=waterfallSeed(slots[i],view).top+.79,'first entry must start above the top');
    assert.equal(s.states[i].generation,0);
    assert.ok(Math.abs(s.bodies[i].translation().x-waterfallSeed(slots[i],view).x*.85)<=.213,'entry should narrow horizontally by 15%');
   }
   assert.ok(newEntries<=8,'startup must not activate a full batch at once');
   if(frame===59){assert.ok(entered.size>0&&entered.size<42);assert.equal(new Set([...entered].map(i=>slots[i].layer)).size,3);}
  }
  assert.equal(entered.size,WATERFALL_COUNT);assert.equal(s.snapshot().stats.recycled,0);
 }finally{s.dispose();}
 const still=create(false,true);try{assert.ok(still.states.every(state=>state.scale===1));}finally{still.dispose();}
});
test('early winner reveal has unique valid sources even before any cube has entered',()=>{
 const sources=waterfallFlightSources([],Array.from({length:5},(_,person)=>({person})),()=>false);
 assert.equal(new Set(sources).size,5);assert.ok(sources.every(i=>Number.isInteger(i)&&i>=0&&i<WATERFALL_COUNT));
});
test('light count follows 3 / 5 / 10 / 1 draw slots, avoids duplicate targets and leaves ineligible boxes',()=>{
 let pool=Array.from({length:20},(_,i)=>i);
 const hunters=createWaterfallHunters(new THREE.Group(),new THREE.ShaderMaterial(),{candidates:()=>pool,anchor:i=>new THREE.Vector3(i,5,0),random:rng()});
 for(const count of [3,5,10,1]){
  for(let frame=0;frame<60;frame++){hunters.update(1/60,{rolling:true,count,reduced:false});assert.equal(hunters.targets.length,count);assert.equal(new Set(hunters.targets).size,count);}
 }
 const previous=hunters.targets[0];pool=pool.filter(i=>i!==previous);hunters.update(.01,{rolling:true,count:1});assert.notEqual(hunters.targets[0],previous);
 hunters.lock([35,36,37]);hunters.update(.3,{rolling:false,phase:'highlight'});assert.deepEqual(hunters.targets,[35,36,37]);assert.ok(hunters.state.every(s=>s.locked&&s.attached));
 hunters.update(.1,{rolling:false,phase:null});assert.equal(hunters.targets.length,0);
 hunters.update(.1,{rolling:true,count:5,reduced:true});assert.equal(hunters.targets.length,0);
});
test('illuminated falling boxes reach double size with matching colliders and restore after release',()=>{
 const s=create(false,true);try{
  for(let i=1;i<WATERFALL_COUNT;i++)s.bodies[i].setEnabled(false);
  const body=s.bodies[0];body.setTranslation({x:0,y:10,z:-8},true);body.setLinvel({x:0,y:-1,z:0},true);
  s.setHighlights([0],3);
  for(let frame=0;frame<60;frame++)s.advance(PHYSICS_STEP);
  assert.equal(s.states[0].boost,2);assert.equal(s.snapshot().falling[0],1);assert.equal(s.snapshot().data[7],2.5);
  assert.ok(Math.abs(s.colliders[0].halfExtents().x-(WATERFALL_HALF+.008)*2)<1e-6);
  s.setHighlights([]);for(let frame=0;frame<60;frame++)s.advance(PHYSICS_STEP);
  assert.equal(s.states[0].boost,1);assert.equal(s.snapshot().data[7],1.25);
  for(let frame=0;frame<1200;frame++)s.advance(PHYSICS_STEP);
  assert.ok(s.states[0].landed>=0);assert.equal(s.snapshot().falling[0],0);
  body.setLinvel({x:0,y:-1,z:0},true);s.setHighlights([0]);s.advance(.1);assert.equal(s.states[0].boost,1);
 }finally{s.dispose();}
});
test('lights linger visibly and keep following a falling target after it leaves the upper selection band',()=>{
 let pool=[0,1,2],falling=true;
 const hunters=createWaterfallHunters(new THREE.Group(),new THREE.ShaderMaterial(),{candidates:()=>pool,eligible:()=>falling,anchor:i=>new THREE.Vector3(i,5,0),random:rng()});
 hunters.update(.01,{rolling:true,count:1});const target=hunters.targets[0];
 pool=pool.filter(i=>i!==target);
 for(let i=0;i<75;i++){hunters.update(1/60,{rolling:true,count:1});assert.equal(hunters.targets[0],target);if(i>36)assert.ok(hunters.state[0].attached);}
 falling=false;pool=[];hunters.update(.01,{rolling:true,count:1});assert.equal(hunters.targets.length,0);
});
test('occasional paired flights preserve draw count and targets, and cancel for single draws or winner lock',()=>{
 const pool=Array.from({length:30},(_,i)=>i),hunters=createWaterfallHunters(new THREE.Group(),new THREE.ShaderMaterial(),{candidates:()=>pool,anchor:i=>new THREE.Vector3(i%6,(i/6|0),0),random:rng()});
 let events=0,wasChasing=false,lastStart=-Infinity;
 for(let frame=0;frame<2400;frame++){
  hunters.update(1/60,{rolling:true,count:5});const state=hunters.state,chasing=state.filter(a=>a.chasing);
  assert.equal(state.length,5);assert.equal(new Set(hunters.targets).size,5);assert.ok(chasing.length===0||chasing.length===2);assert.ok(chasing.every(a=>!a.attached));
  if(chasing.length&&!wasChasing){assert.ok(frame/60-lastStart>=7.9);lastStart=frame/60;events++;}
  wasChasing=chasing.length>0;
 }
 assert.ok(events>=2&&events<=4);
 for(let i=0;i<1800;i++){hunters.update(1/60,{rolling:true,count:1});assert.ok(hunters.state.every(a=>!a.chasing));}
 for(let i=0;i<1800&&!hunters.state.some(a=>a.chasing);i++)hunters.update(1/60,{rolling:true,count:3});
 assert.equal(hunters.state.filter(a=>a.chasing).length,2);
 hunters.lock([31,32,33]);hunters.update(.3,{rolling:false,phase:'highlight'});assert.ok(hunters.state.every(a=>a.locked&&a.attached&&!a.chasing));
 hunters.update(.1,{rolling:true,count:3,reduced:true});assert.equal(hunters.state.length,0);
});
test('five cycling enlarged boxes preserve bounded collision bodies without visible overlap',()=>{
 const s=create();let maxOverlap=0,expanded=false;
 try{
  for(let frame=0;frame<2400;frame++){
   if(frame%60===0){
    const {falling}=s.snapshot(),chosen=[];
    for(let i=0;i<WATERFALL_COUNT&&chosen.length<5;i++)if(falling[i]){
     const p=s.bodies[i].translation();
     if(s.bodies.every((b,j)=>j===i||s.states[j].waiting||new THREE.Vector3().copy(p).distanceToSquared(b.translation())>4.1))chosen.push(i);
    }
    s.setHighlights(chosen,3);
   }
   s.advance(PHYSICS_STEP);expanded||=s.states.some(state=>state.boost===2);
   if(frame%20===0)for(let i=0;i<WATERFALL_COUNT;i++){
    if(s.states[i].waiting)continue;
    s.world.contactPairsWith(s.colliders[i],c=>{const j=s.colliders.indexOf(c);if(j>i&&!s.states[j].waiting)maxOverlap=Math.max(maxOverlap,overlap(s.bodies[i],s.bodies[j],WATERFALL_HALF*s.states[i].scale*s.states[i].boost,WATERFALL_HALF*s.states[j].scale*s.states[j].boost));});
   }
  }
  assert.ok(expanded);assert.equal(s.world.bodies.len(),WATERFALL_COUNT);assert.ok(maxOverlap<.018,'enlarged maximum overlap '+maxOverlap);console.log('enlarged maximum overlap',maxOverlap);
 }finally{s.dispose();}
});
