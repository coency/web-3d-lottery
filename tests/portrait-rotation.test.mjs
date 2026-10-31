import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortraitRotation} from '../apps/web/stage/portrait-rotation.js';
import {createRingPortraitRotation} from '../apps/web/stage/ring-portraits.js';
import {createPortraitTiles} from '../apps/web/stage/portrait-tiles.js';
const ids=n=>Array.from({length:n},(_,i)=>'person-'+i);
const rng=()=>{let n=123;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};};

test('theme changes retain prepared identities across queues and only fill additional slots',()=>{
 const all=ids(5000),tiles=createPortraitTiles(441),pixels=new Map();
 const planet=createPortraitRotation(300,rng()),matrix=createPortraitRotation(300,rng());
 const corridor=createRingPortraitRotation(15,20,rng(),{shuffleLayer:true});
 const wave=createRingPortraitRotation(7,28,rng()),waterfall=createRingPortraitRotation(300,1,rng());
 let visible=planet.update(all);
 function paint(){
  const result=tiles.update(visible);
  result.updates.forEach(({key,tile})=>pixels.set(tile,key));
  result.indices.forEach((tile,i)=>assert.equal(pixels.get(tile),visible[i]));
  return result.updates.length;
 }
 assert.equal(paint(),300);
 for(const queue of [matrix,corridor,waterfall,planet,corridor]){
  const previous=visible;
  visible=queue.update(all,visible);
  assert.deepEqual(visible,previous);assert.equal(paint(),0);
 }
 visible=wave.update(all,visible);
 assert.equal(visible.length,196);assert.equal(paint(),0);
 const smaller=[...visible];visible=matrix.update(all,visible);
 assert.deepEqual(visible.slice(0,196),smaller);
 assert.equal(new Set(visible).size,300);assert.ok(paint()<=104);
 // Re-enter a previously used queue, then ensure rotation still reaches every
 // eligible person rather than getting stuck on the transferred population.
 visible=corridor.update(all,visible);const seen=new Set(visible);
 for(let turn=0;turn<500;turn++)corridor.advanceLayer(turn%15).forEach(id=>seen.add(id));
 assert.equal(seen.size,5000);
});

test('transferred slots reject removed or duplicate IDs and support sparse and empty rosters',()=>{
 for(const make of [()=>createPortraitRotation(300,rng()),()=>createRingPortraitRotation(15,20,rng())]){
  const queue=make(),all=ids(500),old=queue.update(all);
  const removed=old[2],current=all.filter(id=>id!==removed);
  const transferred=[old[0],old[0],removed,null,...old.slice(4)];
  const next=queue.update(current,transferred);
  assert.equal(next[0],old[0]);assert.ok(!next.includes(removed));
  assert.equal(new Set(next).size,300);
  const sparse=queue.update(all.slice(0,8),next);
  assert.equal(sparse.filter(id=>id!==null).length,8);
  assert.equal(new Set(sparse.filter(id=>id!==null)).size,8);
  assert.deepEqual(queue.update([],sparse),Array(300).fill(null));
 }
});

test('live corridor roster additions preserve existing pixels; changed photos and removed people reconcile by key',()=>{
 const rotation=createRingPortraitRotation(15,20,rng(),{shuffleLayer:true}),tiles=createPortraitTiles(441);
 const people=new Map(ids(5000).map(id=>[id,{id,avatarUrl:'/avatars/'+id}]));
 let slots=rotation.update([...people.keys()]);
 const paint=()=>tiles.update(slots.map(id=>people.get(id)?.avatarUrl??'brand'));
 assert.equal(paint().updates.length,300);
 people.set('new',{id:'new',avatarUrl:'/avatars/new'});
 slots=rotation.update([...people.keys()]);
 assert.equal(paint().updates.length,0,'a signup must not repaint existing photos');
 const edited=slots[0];people.set(edited,{id:edited,avatarUrl:'/avatars/replacement'});
 slots=rotation.update([...people.keys()]);
 assert.deepEqual(paint().updates.map(u=>u.key),['/avatars/replacement']);
 slots=rotation.advanceLayer(14);assert.ok(slots.includes('new'));
 assert.equal(paint().updates.length,20);
 const removed=slots[1];people.delete(removed);slots=rotation.update([...people.keys()]);
 assert.ok(!slots.includes(removed));assert.equal(paint().updates.length,1);
});

test('preparing future portraits has a per-frame budget and preserves visible cells through eviction',()=>{
 const tiles=createPortraitTiles(441),rotation=createPortraitRotation(300,rng()),pixels=new Map(),seen=new Set();
 let visible=rotation.update(ids(5000));
 visible.forEach(id=>seen.add(id));
 const upload=result=>result.updates.forEach(({key,tile})=>pixels.set(tile,key));
 upload(tiles.update(visible));
 for(let turn=0;turn<90;turn++){
  const pending=rotation.upcoming(),before=tiles.update(visible).indices;
  for(let frame=0;frame<10;frame++){
   const prepared=pending.filter(key=>tiles.prepared(key)).length;
   const warm=tiles.update([...visible,...pending],new Set(),()=>true,6);
   assert.ok(warm.updates.length<=6);upload(warm);
   before.forEach((tile,i)=>assert.equal(pixels.get(tile),visible[i],'preload overwrote a visible portrait'));
   assert.ok(pending.filter(key=>tiles.prepared(key)).length<=prepared+6);
  }
  visible=rotation.advance({isReady:id=>tiles.prepared(id)});
  const swapped=tiles.update(visible);
  assert.equal(swapped.updates.length,0,'rotation must not upload another batch');
  swapped.indices.forEach((tile,i)=>assert.equal(pixels.get(tile),visible[i]));
  visible.forEach(id=>seen.add(id));
 }
 assert.equal(seen.size,5000);
 const key=visible[0];
 tiles.update(visible,new Set([key]),()=>true,0);
 assert.equal(tiles.prepared(key),false,'invalidated cells must be prepared again');
 upload(tiles.update(visible,new Set(),()=>true,1));
 assert.equal(tiles.prepared(key),true);
});

test('matrix rotation waits for decoded avatars while shuffling prepared people; late people are not lost',()=>{
 const queue=createPortraitRotation(300,rng()),initial=queue.update(ids(500)),visible=new Set(initial);
 const pending=queue.upcoming(),ready=new Set(pending.slice(1,8));
 const shuffled=queue.advance({shuffleVisible:true,isReady:()=>false});
 assert.notDeepEqual(shuffled,initial);assert.deepEqual(new Set(shuffled),visible);
 assert.deepEqual(queue.upcoming(),pending);
 const partial=queue.advance({isReady:id=>ready.has(id)});
 assert.equal(new Set(partial).size,300);
 assert.deepEqual(new Set(partial.filter(id=>!visible.has(id))),ready);
 assert.ok(queue.upcoming().includes(pending[0]));
 const seen=new Set([...initial,...partial]);
 for(let i=0;i<10;i++)queue.advance({isReady:()=>true}).forEach(id=>seen.add(id));
 assert.equal(seen.size,500);
});

test('texture cells preserve existing portraits when a decoded image is evicted before refresh',()=>{
 const tiles=createPortraitTiles(2),first=tiles.update(['a','b']);
 assert.equal(tiles.update(['b','a'],new Set(['a']),()=>false).updates.length,0);
 assert.equal(tiles.update(['a','b'],new Set(),()=>false).updates.length,0);
 assert.deepEqual(tiles.update(['a','b']).updates,[{key:'a',tile:first.indices[0]}]);
 const initialFallback=tiles.update(['b','new'],new Set(),()=>false);
 assert.deepEqual(initialFallback.updates,[{key:'new',tile:first.indices[0]}]);
 assert.equal(tiles.update(['b','new'],new Set(),()=>false).updates.length,0);
 assert.deepEqual(tiles.update(['b','new']).updates,[{key:'new',tile:first.indices[0]}]);
});
test('portrait shuffles and shared avatars reuse cells; delayed loads update only their cells',()=>{
 const tiles=createPortraitTiles(4),first=tiles.update(['a','b','c','a']);
 assert.equal(first.updates.length,3);assert.equal(first.indices[0],first.indices[3]);
 const shuffled=tiles.update(['c','a','b','a']);assert.equal(shuffled.updates.length,0);
 assert.deepEqual(shuffled.indices,[first.indices[2],first.indices[0],first.indices[1],first.indices[0]]);
 assert.deepEqual(tiles.update(['c','a','b','a'],new Set(['b','unseen'])).updates,[{key:'b',tile:first.indices[1]}]);
 tiles.update(['a','b']);tiles.update(['a','b'],new Set(['c']));
 assert.deepEqual(tiles.update(['c','b']).updates,[{key:'c',tile:first.indices[2]}]);
 assert.equal(tiles.update(['c','b'],null).updates.length,2);
 assert.throws(()=>tiles.update(['a','b','c','d','e']),/capacity/);
});
test('5000-person rotation preserves cell contents through eviction, winner pins and smaller layouts',()=>{
 const tiles=createPortraitTiles(441),rotation=createPortraitRotation(300,rng()),pixels=new Map();
 let slots=rotation.update(ids(5000));const seen=new Set();
 for(let round=0;round<180;round++){
  const pinned=slots.map((key,index)=>index<10?'winner-'+index:key);
  const result=tiles.update(pinned);
  for(const {key,tile} of result.updates){assert.ok(tile>=0&&tile<441);pixels.set(tile,key);}
  result.indices.forEach((tile,index)=>assert.equal(pixels.get(tile),pinned[index]));
  slots.forEach(key=>seen.add(key));slots=rotation.advance({shuffleVisible:true});
 }
 assert.equal(seen.size,5000);assert.ok(pixels.size<=441);
 const smaller=slots.slice(0,196),result=tiles.update(smaller);
 result.updates.forEach(({key,tile})=>pixels.set(tile,key));
 result.indices.forEach((tile,index)=>assert.equal(pixels.get(tile),smaller[index]));
});
test('2000 participants rotate through bounded slots across stage queue types',()=>{
 const all=ids(2000),rotation=createPortraitRotation(300,rng()),seen=new Set(rotation.update(all));
 for(let i=0;i<29;i++){
  const slots=rotation.advance();assert.equal(slots.length,300);assert.equal(new Set(slots).size,300);slots.forEach(id=>seen.add(id));
 }
 assert.equal(seen.size,2000);
 for(const [layers,perLayer] of [[7,28],[10,30],[300,1]]){
  const queue=createRingPortraitRotation(layers,perLayer,rng()),covered=new Set(queue.update(all));
  for(let i=0;i<2000;i++){
   const slots=queue.advanceLayer(i%layers);assert.equal(slots.length,layers*perLayer);assert.equal(new Set(slots).size,slots.length);slots.forEach(id=>covered.add(id));
  }
  assert.equal(covered.size,2000);
 }
});
test('rolling shuffles visible portraits even below capacity without duplicates',()=>{
 for(const count of [100,300,301]){
  const rotation=createPortraitRotation(300,rng());let before=rotation.update(ids(count));
  for(let tick=0;tick<10;tick++){
   const after=rotation.advance({shuffleVisible:true}),people=after.filter(id=>id!==null);
   assert.notDeepEqual(after,before);assert.equal(new Set(people).size,Math.min(count,300));
   assert.ok(people.every(id=>ids(count).includes(id)));before=after;
  }
 }
});
test('1000 participants all appear within 12 updates without first-cycle repeats',()=>{
 const rotation=createPortraitRotation(300,rng());let slots=rotation.update(ids(1000));const seen=new Set(slots);
 for(let tick=0;tick<12;tick++){
  const next=rotation.advance();assert.equal(new Set(next).size,300);
  const changes=next.filter((id,i)=>id!==slots[i]);assert.equal(changes.length,tick===11?40:60);
  for(const id of changes){assert.ok(!seen.has(id));seen.add(id);}slots=next;
 }
 assert.equal(seen.size,1000);
 const remaining=new Set(ids(1000).filter(id=>!slots.includes(id)));
 for(let tick=0;tick<12;tick++)for(const id of rotation.advance())remaining.delete(id);
 assert.equal(remaining.size,0);
});
test('partial capacity stays stable; 301 participants never duplicate on screen',()=>{
 for(const count of [0,1,100,300,301]){
  const rotation=createPortraitRotation(300,rng()),initial=rotation.update(ids(count));let seen=new Set(initial.filter(x=>x!==null));
  for(let tick=0;tick<10;tick++){const slots=rotation.advance(),people=slots.filter(x=>x!==null);assert.equal(new Set(people).size,Math.min(count,300));people.forEach(id=>seen.add(id));if(count<=300)assert.deepEqual(slots,initial);}
  assert.equal(seen.size,count);
 }
});
test('new arrivals have priority; reorder and removals preserve valid assignments',()=>{
 const rotation=createPortraitRotation(300,rng());const all=ids(1000),initial=rotation.update(all);
 assert.deepEqual(rotation.update([...all].reverse()),initial);
 assert.deepEqual(rotation.update([...all,'newcomer']),initial);
 assert.ok(rotation.advance().includes('newcomer'));
 const remaining=all.slice(900);const slots=rotation.update(remaining);
 assert.equal(slots.filter(x=>x!==null).length,100);assert.ok(slots.every(id=>id===null||remaining.includes(id)));
 assert.deepEqual(rotation.update([]),Array(300).fill(null));
 assert.equal(new Set(rotation.update(ids(400))).size,300);
});

test('late brand loads refresh only unresolved fallback cells and preserve real GPU portraits',()=>{
 const tiles=createPortraitTiles(3),ready=new Set(['ready']);let brand={name:'system'};
 const keys=['pending','ready','brand'];const canDraw=key=>key==='brand'||ready.has(key);
 const initial=tiles.update(keys,new Set(),canDraw,Infinity,brand);assert.equal(initial.updates.length,3);
 assert.equal(tiles.update(keys,new Set(),canDraw,Infinity,brand).updates.length,0);
 brand={name:'custom'};ready.clear();
 assert.deepEqual(tiles.update(keys,new Set(['brand']),canDraw,Infinity,brand).updates.map(u=>u.key),['pending','brand']);
 assert.equal(tiles.prepared('pending'),false);assert.equal(tiles.prepared('ready'),true);
 ready.add('pending');assert.deepEqual(tiles.update(keys,new Set(['pending']),canDraw,Infinity,brand).updates.map(u=>u.key),['pending']);
 ready.clear();brand={name:'new custom'};
 assert.deepEqual(tiles.update(keys,null,canDraw,Infinity,brand).updates.map(u=>u.key),['brand']);
});
