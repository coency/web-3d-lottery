import test from 'node:test';
import assert from 'node:assert/strict';
import {expandedMatrixLayout,MATRIX_COUNT,matrixLayout,matrixFlightSources,matrixPushSeeds,matrixPushDepth} from '../apps/web/stage/matrix-layout.js';
test('matrix fits all 300 unique slots in wide and narrow frames',()=>{
 for(const [w,h] of [[1460,584],[900,468],[340,370],[2300,600]]){
  const m=matrixLayout(300,w,h);
  assert.equal(m.points.length,300);assert.equal(new Set(m.points.map(p=>[p.x,p.y].join(','))).size,300);
  assert.ok(m.points.every(p=>Math.abs(p.x)<m.width/2&&Math.abs(p.y)<m.height/2));
 }
});
test('matrix winner origins are unique and may come from any row',()=>{
 const sources=matrixFlightSources(300,5,()=>0);
 assert.equal(new Set(sources).size,5);assert.ok(sources.every(i=>i>=0&&i<300));
 assert.notDeepEqual(sources,matrixFlightSources(300,5,()=>.99));
 assert.equal(matrixFlightSources(3,5).length,3);
});
test('forward motion returns smoothly to the wall and never moves behind it',()=>{
 const seed={period:10,offset:0,distance:3};
 assert.equal(matrixPushDepth(0,seed),0);
 assert.equal(matrixPushDepth(5,seed),3);
 assert.equal(matrixPushDepth(10,seed),0);
 assert.ok(matrixPushDepth(9,seed)>0);
 for(const seed of matrixPushSeeds(300)){
  const positions=Array.from({length:100},(_,i)=>matrixPushDepth(i*seed.period/100,seed));
  assert.ok(positions.filter(depth=>depth>0).length>=99,'each box moves throughout its cycle');
  for(let t=0;t<32;t+=.1){const depth=matrixPushDepth(t,seed);assert.ok(depth>=0&&depth<=seed.distance);}
 }
});

test('300-cell stage matrix stays centered inside its camera framing',()=>{
 assert.equal(MATRIX_COUNT,300);
 for(const [w,h] of [[1625*.9,884-175-125],[900,468],[340,370],[2300,600]]){
  const m=expandedMatrixLayout(w,h),original=matrixLayout(300,w,h,undefined,0);
  assert.deepEqual(m.framing,original);
  const horizontal=m.points[1].x-m.points[0].x,vertical=m.points[0].y-m.points[m.columns].y;
  assert.ok(horizontal>.6);assert.ok(Math.abs(horizontal-vertical)<1e-8);
  assert.equal(new Set(m.points.map(p=>[p.x,p.y].join(','))).size,300);
  assert.ok(Math.abs(m.points.reduce((sum,p)=>sum+p.x,0))<1e-8);
  assert.ok(Math.abs(m.points.reduce((sum,p)=>sum+p.y,0))<1e-8);
 }
});
