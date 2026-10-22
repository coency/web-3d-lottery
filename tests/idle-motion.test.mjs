import test from 'node:test';
import assert from 'node:assert/strict';
import {orbitTrailAngle,matrixIdleWave,sphereIdleLight,createIdleBudget} from '../apps/web/stage/idle-motion.js';
test('idle wave has a quiet interval and bounded displacement',()=>{
 for(let time=0;time<48;time+=.1)for(const x of [-9,-4,0,4,9]){const wave=matrixIdleWave(x,2,18,time);assert.ok(wave>=0&&wave<=1);if(time%12>=6)assert.equal(wave,0);}
 assert.equal(matrixIdleWave(0,0,18,3),1);assert.equal(matrixIdleWave(0,0,18,9),0);
});
test('sphere sweep stays on the visible hemisphere and rests between passes',()=>{
 assert.equal(sphereIdleLight(0,1,4),.65);assert.equal(sphereIdleLight(0,-1,4),0);assert.equal(sphereIdleLight(0,1,10),0);
});
test('sustained slow frames reduce accents, isolated stalls do not',()=>{
 const budget=createIdleBudget();for(let i=0;i<500;i++)assert.equal(budget.update(i%90===0?50:16.67,true),1);
 for(let i=0;i<45;i++)budget.update(50,true);assert.equal(budget.update(16,true),.5);
 for(let i=0;i<45;i++)budget.update(50,true);assert.equal(budget.update(16,true),0);
 for(let i=0;i<650;i++)budget.update(16.67,true);assert.equal(budget.update(16,true),.5);
 for(let i=0;i<650;i++)budget.update(16.67,true);assert.equal(budget.update(16,true),1);
 for(let i=0;i<200;i++)assert.equal(budget.update(50,false),1);
});

test('large orbit heads lead their tails in both travel directions',()=>{
 for(const speed of [-.3,.24]){
  const head=orbitTrailAngle(5,speed,1,0),next=orbitTrailAngle(5.01,speed,1,0);
  assert.ok((next-head)*speed>0);
  for(const age of [.1,.5,1])assert.ok((head-orbitTrailAngle(5,speed,1,age))*speed>0);
 }
});
