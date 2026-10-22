import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ROBOT_COUNT,robotWinnerSources} from '../apps/web/stage/corridor-robot.js';
import {createCorridor} from '../apps/web/stage/corridor.js';
import {CORRIDOR_COUNT,CORRIDOR_ROWS,CORRIDOR_PER_COLUMN} from '../apps/web/stage/corridor-layout.js';

test('robot sources are unique body boxes; the brand chest is never an award source',()=>{
 const people=Array.from({length:ROBOT_COUNT},(_,id)=>({id}));
 for(const count of [1,3,5,10]){
  const records=Array.from({length:count},(_,i)=>({participant_id:i%2?999+i:i}));
  const sources=robotWinnerSources(people,records,()=>.35);
  assert.equal(sources.length,count);assert.equal(new Set(sources).size,count);
  sources.forEach((index,i)=>{assert.ok(index>=0&&index<ROBOT_COUNT);if(i%2===0)assert.equal(index,i);});
 }
 const brand=robotWinnerSources(people,[{participant_id:'brand-logo'}],()=>0);
 assert.ok(brand[0]>=0&&brand[0]<ROBOT_COUNT);
});

test('robot gathers 12 visible random boxes from each wall at wide and narrow sizes',()=>{
 const corridor=createCorridor(new THREE.Group(),1),people=Array.from({length:CORRIDOR_COUNT},(_,i)=>i);
 corridor.setEnabled(true);
 for(const [width,height] of [[1625,884],[900,768],[390,844]]){
  corridor.resize(width,height);corridor.update(.016,0,{phase:'idle',reduced:false,revealing:false},()=>{});
  const sources=corridor.gatherSources(people,ROBOT_COUNT,()=>.23);
  assert.equal(sources.length,ROBOT_COUNT);assert.equal(new Set(sources.map(s=>s.index)).size,ROBOT_COUNT);
  assert.equal(sources.filter(s=>s.index%CORRIDOR_PER_COLUMN<CORRIDOR_ROWS).length,12);
  assert.ok(sources.every(s=>s.matrix.elements.every(Number.isFinite)&&s.person===s.index));
  assert.notDeepEqual(sources.map(s=>s.index),corridor.gatherSources(people,ROBOT_COUNT,()=>.81).map(s=>s.index));
 }
});
