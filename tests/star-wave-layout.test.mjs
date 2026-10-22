import test from 'node:test';
import assert from 'node:assert/strict';
import {STAR_WAVE_COUNT,STAR_WAVE_RINGS,STAR_WAVE_PER_RING,STAR_WAVE_CARD_SCALE,STAR_WAVE_OUTER_SCALE,STAR_WAVE_RADIUS,STAR_WAVE_PERIOD,starWaveSlots,starWavePosition,starWaveView,starWaveLayer,starWaveTravel,starWaveStep,starWaveBoxScale,starWaveProjectedRadius,starWaveFlightSources} from '../apps/web/stage/star-wave-layout.js';
import {createRingPortraitRotation} from '../apps/web/stage/ring-portraits.js';
const seeded=()=>{let n=17;return ()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);};
const unique=slots=>{const ids=slots.filter(x=>x!==null);assert.equal(new Set(ids).size,ids.length);};

test('seven sparse rings keep enough space for full three-axis cube rotations',()=>{
 const slots=starWaveSlots();assert.equal(slots.length,196);assert.equal(STAR_WAVE_COUNT,196);assert.equal(STAR_WAVE_RINGS.length,7);
 const nearest=2*STAR_WAVE_RADIUS*Math.sin(Math.PI/STAR_WAVE_PER_RING),diagonal=.6*STAR_WAVE_OUTER_SCALE*Math.sqrt(3);assert.ok(nearest>diagonal);
 const a={},b={},view=starWaveView(1625,884);
 for(const slot of slots){const layer=starWaveLayer(slot.layer,0);starWavePosition(slot,0,layer,view,a);starWavePosition(slot,.01,layer,view,b);assert.ok((a.x*b.y-a.y*b.x)*slot.direction>0);}
});
test('each wave advances one rung; only the exiting ring recycles, continuously',()=>{
 for(let step=0;step<24;step++){
  assert.equal(starWaveTravel(step*STAR_WAVE_PERIOD),step);
  const before=STAR_WAVE_RINGS.map(r=>starWaveLayer(r.layer,step+.999999)),after=STAR_WAVE_RINGS.map(r=>starWaveLayer(r.layer,step+1));
  const changed=after.map((l,i)=>l.generation!==before[i].generation?i:-1).filter(i=>i>=0);assert.deepEqual(changed,[step%7]);
  assert.ok(before[changed[0]].age>6.99);assert.equal(after[changed[0]].age,0);assert.equal(after[changed[0]].scale,0);
 }
 for(let t=0;t<20;t+=.013)assert.ok(starWaveTravel(t+.013)>=starWaveTravel(t));
});
test('outer ring actually exits all screen edges before recycling, at wide and narrow sizes',()=>{
 const halfDiagonal=.3*STAR_WAVE_OUTER_SCALE*Math.sqrt(3);
 for(const [w,h] of [[1625,884],[1920,1080],[2560,720],[900,768],[390,844]]){
  const view=starWaveView(w,h),centerY=-5*view.cameraZ/view.focal;
  const initial=starWaveProjectedRadius(6,view);assert.ok(initial>view.inner*4);
  let previous=-Infinity;for(let age=0;age<=7;age+=.02){const r=starWaveProjectedRadius(age,view);assert.ok(r>previous);previous=r;}
  const exitRadius=starWaveProjectedRadius(6.99999,view),distance=view.focal*STAR_WAVE_RADIUS/exitRadius;
  const minimumRadius=view.focal*(STAR_WAVE_RADIUS-halfDiagonal-Math.abs(centerY))/(distance+halfDiagonal);
  assert.ok(minimumRadius>Math.hypot(w/2,h/2));
  assert.ok(distance-halfDiagonal>.1);
 }
});
test('ring queue shows the entire first roster before recycling previously seen participants',()=>{
 const queue=createRingPortraitRotation(7,28,seeded()),ids=Array.from({length:700},(_,i)=>i);
 let slots=queue.update(ids);unique(slots);const seen=new Set(slots);
 for(let wave=0;wave<18;wave++){
  const ring=wave%7,before=slots;slots=queue.advanceLayer(ring);unique(slots);
  slots.forEach((id,i)=>{if(Math.floor(i/28)!==ring)assert.equal(id,before[i]);else{assert.ok(!seen.has(id));seen.add(id);}});
 }
 assert.equal(seen.size,700);
 for(let i=0;i<20;i++)unique(queue.advanceLayer(i%7));
 assert.deepEqual(queue.update([...ids].reverse()),queue.update(ids));
});
test('ring queue handles empty, small, near-capacity rosters and live membership changes',()=>{
 for(const size of [0,1,27,100,196,197,202]){
  const queue=createRingPortraitRotation(7,28,seeded()),ids=Array.from({length:size},(_,i)=>i);let slots=queue.update(ids),seen=new Set(slots.filter(x=>x!==null));
  for(let i=0;i<24;i++){unique(slots);assert.equal(slots.filter(x=>x!==null).length,Math.min(size,196));slots=queue.advanceLayer(i%7);slots.filter(x=>x!==null).forEach(x=>seen.add(x));}
  assert.equal(seen.size,size);
 }
 const queue=createRingPortraitRotation(7,28,seeded());queue.update(Array.from({length:300},(_,i)=>i));
 const updated=queue.update(Array.from({length:300},(_,i)=>i+100));unique(updated);assert.ok(updated.every(x=>x===null||x>=100));
 assert.deepEqual(queue.update([]),Array(196).fill(null));
});

test('outer boxes grow smoothly by 18 percent while inner boxes keep their size',()=>{
 assert.equal(starWaveBoxScale(0),STAR_WAVE_CARD_SCALE);assert.equal(starWaveBoxScale(5),STAR_WAVE_CARD_SCALE);
 assert.equal(starWaveBoxScale(6),STAR_WAVE_OUTER_SCALE);assert.equal(starWaveBoxScale(6.9),STAR_WAVE_OUTER_SCALE);
 let last=0;for(let age=0;age<7;age+=.01){const scale=starWaveBoxScale(age);assert.ok(scale>=last);last=scale;}
});
test('continuous travel never pauses at cycle boundaries and switching cannot jump backwards',()=>{
 for(let t=0;t<30;t+=.025)assert.ok(Math.abs(starWaveStep(t,t+.025,1)-.025/STAR_WAVE_PERIOD)<1e-12);
 assert.ok(starWaveStep(4.8,4.81,0)<starWaveStep(2.4,2.41,0)*.001);
 let distance=0;for(let i=0;i<2000;i++){const t=i*.017,blend=i<400?0:i<450?(i-400)/50:i<1200?1:i<1250?1-(i-1200)/50:0;
 const delta=starWaveStep(t,t+.017,blend);assert.ok(delta>=0&&delta<=2*.017/STAR_WAVE_PERIOD+1e-10);distance+=delta;}
 assert.ok(distance>0);
});

test('winner origins exclude exited/emerging slots and retain unique visible matching positions',()=>{
 const people=Array.from({length:196},(_,i)=>({id:'p'+i})),visible=i=>i>=28&&i<196;
 const sources=starWaveFlightSources(people,[{person:{id:'p0'}},{participant_id:'p195'},{person:{id:'missing'}},{person:{id:'p30'}}],()=>.25,visible);
 assert.equal(sources[1],195);assert.equal(sources[3],30);assert.equal(new Set(sources).size,4);assert.ok(sources.every(visible));
});
