import * as THREE from 'three';
import {CORRIDOR_COUNT,CORRIDOR_PER_COLUMN,CORRIDOR_COLUMNS,CORRIDOR_SCALE,CORRIDOR_DEPTH,corridorSlots,corridorView,corridorColumn,corridorPosition,corridorFlightSources} from './corridor-layout.js';

export function createCorridor(cluster,pixelRatio){
 const slots=corridorSlots(),positions=slots.map(()=>new THREE.Vector3()),scales=new Float32Array(CORRIDOR_COUNT),generations=new Int32Array(CORRIDOR_COLUMNS);
 // Sample each box's turn speed once, so it rotates smoothly at its own pace.
 const spinSpeeds=Float32Array.from({length:CORRIDOR_COUNT},()=>.25+Math.random()*.8),spinAngles=new Float64Array(CORRIDOR_COUNT);
 const group=new THREE.Group();group.name='starlight-corridor';group.visible=false;cluster.add(group);
 const floorY=-6.4,trailCount=12,tailSamples=8;
 const trailSpeeds=Float32Array.from({length:trailCount},()=>.055+Math.random()*.085),trailProgress=Float64Array.from({length:trailCount},()=>Math.random());
 const count=trailCount*tailSamples,dotPositions=new Float32Array(count*3),tints=new Float32Array(count*3),dotAlpha=new Float32Array(count);
 const dotGeo=new THREE.BufferGeometry();dotGeo.setAttribute('position',new THREE.BufferAttribute(dotPositions,3).setUsage(THREE.DynamicDrawUsage));dotGeo.setAttribute('tint',new THREE.BufferAttribute(tints,3));dotGeo.setAttribute('alpha',new THREE.BufferAttribute(dotAlpha,1).setUsage(THREE.DynamicDrawUsage));
 const tint=new THREE.Color();for(let lane=0;lane<trailCount;lane++){tint.setHSL(Math.random(),.65,.72);for(let k=0;k<tailSamples;k++)tint.toArray(tints,(lane*tailSamples+k)*3);}
 const dotMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{focal:{value:1},strength:{value:1},pixelRatio:{value:pixelRatio}},
  vertexShader:'attribute vec3 tint;attribute float alpha;varying vec3 color;varying float opacity;uniform float focal;uniform float strength;uniform float pixelRatio;void main(){vec4 p=modelViewMatrix*vec4(position,1.);color=tint;opacity=alpha*strength;gl_Position=projectionMatrix*p;gl_PointSize=.17*focal/max(.1,-p.z)*pixelRatio;}',
  fragmentShader:'varying vec3 color;varying float opacity;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(color,exp(-r*r*4.)*(1.-smoothstep(.6,1.,r))*opacity);}'
 });
 const dots=new THREE.Points(dotGeo,dotMaterial);dots.frustumCulled=false;group.add(dots);
 let view=corridorView(1625,884),enabled=false,travel=0,speed=0,wasRolling=false,resetState=null,reducedColumn=0,reducedTime=0;
 function resize(width,height){
  view=corridorView(width,height);dotMaterial.uniforms.focal.value=view.focal;return view;
 }
 function reset(now,reduced){
  if(!enabled||resetState)return;
  resetState=reduced?null:{start:now,positions:positions.map(p=>p.clone()),scales:scales.slice()};
  travel=0;speed=0;generations.fill(0);wasRolling=false;
 }
 return {
  resize,reset,
  setEnabled(value){if(value!==enabled){travel=0;speed=0;generations.fill(0);wasRolling=false;resetState=null;}enabled=value;group.visible=value;},
  update(dt,now,{phase,reduced,revealing},recycle){
   if(!enabled)return;
   const rolling=phase==='rolling';if(wasRolling&&!rolling)reset(now,reduced);wasRolling=rolling;
   if(resetState&&now-resetState.start>=900)resetState=null;
   const moving=(rolling||phase==='idle'||phase==='result')&&!revealing&&!resetState;
   if(!reduced&&!revealing)for(let i=0;i<CORRIDOR_COUNT;i++)spinAngles[i]=(spinAngles[i]+spinSpeeds[i]*dt)%(Math.PI*2);
   speed+=((moving&&!reduced?(rolling?-3.6:-.45):0)-speed)*(1-Math.exp(-dt*4));
   if(moving&&!reduced)travel+=speed*dt;
   if(moving&&reduced){reducedTime+=dt;if(reducedTime>3){recycle(reducedColumn++%CORRIDOR_COLUMNS);reducedTime=0;}}
   const u=resetState?Math.min(1,(now-resetState.start)/900):1,e=u*u*(3-2*u);
   for(let column=0;column<CORRIDOR_COLUMNS;column++){
    const state=corridorColumn(column,travel);
    if(state.generation!==generations[column]){recycle(column);generations[column]=state.generation;}
    for(let j=0;j<CORRIDOR_PER_COLUMN;j++){
     const i=column*CORRIDOR_PER_COLUMN+j;corridorPosition(slots[i],state,view,positions[i]);
     if(resetState)positions[i].lerpVectors(resetState.positions[i],positions[i],e);
     scales[i]=resetState?THREE.MathUtils.lerp(resetState.scales[i],CORRIDOR_SCALE*state.scale,e):CORRIDOR_SCALE*state.scale;
    }
   }
   dots.visible=!reduced&&!revealing;
   for(let lane=0;lane<trailCount;lane++){
    if(!reduced)trailProgress[lane]=(trailProgress[lane]+dt*trailSpeeds[lane]*(rolling?3.6:1))%1;
    for(let k=0;k<tailSamples;k++){
     const i=lane*tailSamples+k,progress=((trailProgress[lane]-k*.004)%1+1)%1;
     dotPositions.set([(lane/(trailCount-1)-.5)*11.75,floorY+.12+(lane%3)*.35,-52+progress*55],i*3);
     dotAlpha[i]=(1-k/tailSamples)*Math.sin(Math.PI*progress)*.85;
    }
   }
   dotGeo.attributes.position.needsUpdate=true;dotGeo.attributes.alpha.needsUpdate=true;
  },
  apply(index,dummy){const slot=slots[index];dummy.position.copy(positions[index]);dummy.rotation.set(0,-slot.side*(Math.PI/2-.04)+spinAngles[index],0);dummy.scale.set(scales[index],scales[index],scales[index]*CORRIDOR_DEPTH);},
  gatherSources(people,count,random=Math.random){
   const candidates=slots.map((slot,index)=>({slot,index})).filter(({index})=>{
    const p=positions[index],distance=view.cameraZ-p.z;
    return scales[index]>.8&&Math.abs(p.x*view.focal/distance)<view.width/2-35&&Math.abs((p.y+view.centerY)*view.focal/distance)<view.height/2-100;
   });
   const sourceDummy=new THREE.Object3D(),selected=[];
   for(const side of [-1,1]){
    const pool=candidates.filter(c=>c.slot.side===side);
    for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
    selected.push(...pool.slice(0,count/2));
   }
   return selected.map(({index})=>{this.apply(index,sourceDummy);sourceDummy.updateMatrix();return {index,person:people[index]??null,matrix:sourceDummy.matrix.clone()};});
  },
  flightSources(people,records){return corridorFlightSources(people,records,i=>{
   const p=positions[i],distance=view.cameraZ-p.z,x=p.x*view.focal/distance,y=(p.y+view.centerY)*view.focal/distance;
   return scales[i]>.5&&Math.abs(x)<view.width/2-30&&Math.abs(y)<view.height/2-110;
  });},
  get travel(){return travel;},get movingSpeed(){return speed;},get resetting(){return !!resetState;},get view(){return view;}
 };
}
