import test from 'node:test';import assert from 'node:assert/strict';
import {displayPeople,flightSources,spherePoints,winnerLayout} from '../apps/web/stage/sphere-layout.js';
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};

test('six to nine winners balance each centred row with the extra person on the bottom',()=>{
 for(const [width,height] of [[1280,696],[1625,884],[1920,1080]])for(const [count,expected] of [[6,[3,3]],[7,[3,4]],[8,[4,4]],[9,[4,5]]]){
  const anchors=winnerLayout(width,height,count),rows=[...new Set(anchors.map(a=>a.y))].map(y=>anchors.filter(a=>a.y===y));
  assert.deepEqual(rows.map(row=>row.length),expected);
  for(const row of rows){
   assert.ok(Math.abs((row[0].x+row.at(-1).x)/2-width/2)<.01);
   for(let i=0;i<row.length;i++){
    assert.ok(row[i].x-row[i].cardWidth/2>=0&&row[i].x+row[i].cardWidth/2<=width);
    if(i)assert.ok(row[i-1].x+row[i-1].cardWidth/2<row[i].x-row[i].cardWidth/2);
   }
  }
  assert.ok(rows[0][0].y+rows[0][0].size*.62+96<rows[1][0].y-rows[1][0].size*.62);
 }
});
test('ten winners occupy two rows of five inside the desktop result area',()=>{
 for(const [width,height] of [[1280,696],[1625,884],[1920,1080]]){
  const anchors=winnerLayout(width,height,10);assert.equal(anchors.length,10);
  assert.equal(new Set(anchors.map(a=>a.y)).size,2);
  for(let i=0;i<10;i++){
   const a=anchors[i],top=a.y-a.size*.62,bottom=top+a.size*1.24+96;
   assert.ok(a.x>60&&a.x<width-60);assert.ok(bottom<=height-200+.01);
   if(i<5)assert.ok(bottom<anchors[i+5].y-anchors[i+5].size*.62);
  }
 }
});
test('partial spheres scatter unique people among logo slots and keep assignments stable',()=>{
 for(const n of [0,1,100,299,300]){const slots=displayPeople(n,[],rng(42));assert.equal(slots.length,300);assert.deepEqual(slots.filter(x=>x!==null).sort((a,b)=>a-b),Array.from({length:n},(_,i)=>i));assert.deepEqual(displayPeople(n,slots,rng(9)),slots);}
 const slots=displayPeople(100,[],rng(42));for(let band=0;band<3;band++)assert.ok(slots.slice(band*100,(band+1)*100).some(x=>x!==null));assert.notDeepEqual(slots,displayPeople(100,[],rng(17)));
});
test('large populations still select 300 unique valid avatars',()=>{const slots=displayPeople(1000,[],rng(7));assert.equal(new Set(slots).size,300);assert.ok(slots.every(x=>x>=0&&x<1000));});
test('winner origins are random, distinct, visible and respect exclusions',()=>{const points=spherePoints(300);for(let i=0;i<30;i++){const rot=i*.4;const indices=flightSources(points,rot,10,rng(i),index=>index%2===0);assert.equal(indices.length,10);assert.equal(new Set(indices).size,10);for(const index of indices){assert.equal(index%2,0);const p=points[index];assert.ok(p.z*Math.cos(rot)-p.x*Math.sin(rot)>=.4);}}assert.notDeepEqual(flightSources(points,0,5,rng(1)),flightSources(points,0,5,rng(2)));});

test('300-slot sphere preserves avatar size and the existing sphere radius',async()=>{
 const {sphereLayout,CUBE_SIDE,SPHERE_COUNT}=await import('../apps/web/stage/sphere-layout.js');
 const sphere=sphereLayout();assert.equal(SPHERE_COUNT,300);assert.equal(sphere.count,300);assert.equal(CUBE_SIDE,.6);
 assert.ok(Math.abs(sphere.radius-6.8*Math.sqrt(1.4))<1e-12);
 const points=spherePoints(sphere.count);assert.equal(new Set(points.map(p=>[p.x,p.y,p.z].join(','))).size,300);
 assert.ok(points.every(p=>Math.abs(Math.hypot(p.x,p.y,p.z)-1)<1e-12));
});
