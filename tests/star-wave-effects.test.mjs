import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createStarWaveEffects} from '../apps/web/stage/star-wave-effects.js';
import {starWaveView} from '../apps/web/stage/star-wave-layout.js';

function setup(){
 const scene=new THREE.Group(),effects=createStarWaveEffects(scene,1);
 const group=scene.children[0],dots=group.children[0];
 const state={enabled:true,active:true,energy:0,quality:1,view:starWaveView(1625,884)};
 return {effects,group,dots,state};
}

test('spiral buffers stay bounded across cycles; brighter larger heads lead their tails',()=>{
 const {effects,group,dots,state}=setup(),position=dots.geometry.attributes.position.array;
 for(let frame=0;frame<1800;frame++){
  effects.update(1/60,state);
  assert.equal(group.children.length,1);assert.equal(group.getObjectByName('pulse-core'),undefined);assert.equal(dots.geometry.attributes.position.array,position);
  assert.equal(dots.geometry.attributes.position.count,120);assert.ok(position.every(Number.isFinite));
  const alpha=dots.geometry.attributes.alpha.array,size=dots.geometry.attributes.size.array;
  for(let head=0;head<120;head+=24)for(let k=1;k<24;k++){
   if(alpha[head+k]===0)continue;
   assert.ok(position[head*3+2]>=position[(head+k)*3+2]);assert.ok(size[head]>size[head+k]);
  }
 }
});

test('spiral effects fade away for results and hide for other themes',()=>{
 const {effects,group,state}=setup();
 for(let i=0;i<90;i++)effects.update(1/60,state);
 assert.equal(group.visible,true);
 for(let i=0;i<100;i++)effects.update(1/60,{...state,active:false});
 assert.equal(group.visible,false);
 effects.update(1/60,state);effects.update(1/60,{...state,enabled:false});assert.equal(group.visible,false);
});

test('reduced effect budget uses one trail and rolling advances light faster',()=>{
 const idle=setup(),rolling=setup();
 for(let i=0;i<45;i++){
  idle.effects.update(1/60,{...idle.state,quality:.5});
  rolling.effects.update(1/60,{...rolling.state,energy:1});
 }
 assert.equal(idle.dots.geometry.drawRange.count,24);assert.equal(rolling.dots.geometry.drawRange.count,120);
 assert.ok(rolling.dots.geometry.attributes.position.array[2]>idle.dots.geometry.attributes.position.array[2]);
});

test('trail colors are random per cycle and remain consistent throughout a flight',()=>{
 let seed=123,calls=0;const random=()=>{calls++;seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const scene=new THREE.Group(),effects=createStarWaveEffects(scene,1,random),dots=scene.children[0].children[0];
 const state={enabled:true,active:true,energy:0,quality:1,view:starWaveView(1625,884)};
 effects.update(.01,state);const initial=[...dots.geometry.attributes.tint.array];assert.equal(calls,15);
 effects.update(.5,state);assert.deepEqual([...dots.geometry.attributes.tint.array],initial);assert.equal(calls,15);
 effects.update(1.1,state);const next=[...dots.geometry.attributes.tint.array];assert.equal(calls,18);
 assert.deepEqual(next.slice(0,96*3),initial.slice(0,96*3));assert.notDeepEqual(next.slice(96*3),initial.slice(96*3));
 assert.equal(new Set(Array.from({length:5},(_,i)=>next.slice(i*72,i*72+3).join(','))).size,5);
 for(let trail=0;trail<5;trail++)for(let k=1;k<24;k++)assert.deepEqual(next.slice((trail*24+k)*3,(trail*24+k)*3+3),next.slice(trail*72,trail*72+3));
});

test('point world sizes project consistently with camera perspective and viewport changes',()=>{
 const {effects,dots,state}=setup();
 for(const [width,height] of [[1625,884],[1920,1080],[390,844]]){
  state.view=starWaveView(width,height);effects.update(.1,state);
  const camera=new THREE.PerspectiveCamera(40,width/height,.1,500);camera.position.z=state.view.cameraZ;camera.updateMatrixWorld();
  assert.equal(dots.material.uniforms.focal.value,state.view.focal);
  const heads=[];
  for(let i=0;i<120;i+=24){
   const size=dots.geometry.attributes.size.array[i],z=dots.geometry.attributes.position.array[i*3+2];
   const projectedTop=new THREE.Vector3(0,size/2,z).project(camera),projectedBottom=new THREE.Vector3(0,-size/2,z).project(camera);
   const pixelSize=(projectedTop.y-projectedBottom.y)*height/2,depth=camera.position.z-z;
   assert.ok(Math.abs(pixelSize-size*state.view.focal/depth)<1e-8);heads.push({depth,pixelSize});
  }
  heads.sort((a,b)=>a.depth-b.depth);assert.ok(heads.every((h,i)=>!i||h.pixelSize<heads[i-1].pixelSize));
 }
});
