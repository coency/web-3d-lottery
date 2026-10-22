import * as THREE from 'three';
import {takeWaterfallWorker} from './waterfall-loader.js';
import {createWaterfallHunters} from './waterfall-hunters.js';
import {WATERFALL_COUNT,WATERFALL_SCALE,WATERFALL_ENTRY_WIDTH,waterfallSlots,waterfallSeed,waterfallQuaternion,waterfallView,waterfallFlightSources} from './waterfall-layout.js';

export function createWaterfall(parent,pixelRatio,notify=()=>{},reducedMotion=false,onStatus=()=>{}){
 const slots=waterfallSlots(),generations=new Int32Array(WATERFALL_COUNT),scales=new Float32Array(WATERFALL_COUNT);
 const rotations=slots.map(s=>new THREE.Quaternion().copy(waterfallQuaternion(s.angle)));
 const positions=slots.map(()=>new THREE.Vector3()),screen=slots.map(()=>({x:0,y:0})),pending=new Set();
 const group=new THREE.Group();group.name='galaxy-waterfall';group.visible=false;parent.add(group);
 const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{focal:{value:1},pixelRatio:{value:pixelRatio}},
  vertexShader:'attribute vec3 tint;attribute float alpha;attribute float size;varying vec3 color;varying float opacity;uniform float focal;uniform float pixelRatio;void main(){vec4 p=modelViewMatrix*vec4(position,1.);color=tint;opacity=alpha;gl_Position=projectionMatrix*p;gl_PointSize=size*focal/max(.1,-p.z)*pixelRatio;}',
  fragmentShader:'varying vec3 color;varying float opacity;void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(color,exp(-r*r*4.)*(1.-smoothstep(.6,1.,r))*opacity);}'
 });
 const falling=new Uint8Array(WATERFALL_COUNT),lockedAnchors=new Map();let portraits=[],lit=new Set();
 const hunters=createWaterfallHunters(group,material,{
  candidates:()=>slots.map((_,i)=>i).filter(i=>falling[i]&&portraits[i]!=null&&!pending.has(i)&&scales[i]>=WATERFALL_SCALE*.95&&screen[i].y>view.top+40&&screen[i].y<view.top+view.span*.4&&Math.abs(screen[i].x)<view.width/2-65),
  eligible:i=>!!falling[i]&&portraits[i]!=null&&!pending.has(i)&&screen[i].y<view.bottom-30,
  available:index=>positions.every((p,j)=>{
   if(j===index||scales[j]<.9)return true;
   if(p.distanceToSquared(positions[index])<=4.1)return false;
   const half=.3*scales[j]*view.focal/(view.cameraZ-p.z);
   return !(p.z>positions[index].z+.5&&Math.abs(screen[j].x-screen[index].x)<half&&Math.abs(screen[j].y-screen[index].y)<half);
  }),
  anchor:index=>{
   if(lockedAnchors.has(index))return lockedAnchors.get(index).clone();
   // Choose the face aimed most directly at the audience, then sit near its upper edge.
   const axes=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)].map(v=>v.applyQuaternion(rotations[index]));
   const normal=axes.reduce((a,b)=>Math.abs(a.z)>Math.abs(b.z)?a:b);if(normal.z<0)normal.negate();
   const tangent=axes.filter(a=>a!==normal).reduce((a,b)=>Math.abs(a.y)>Math.abs(b.y)?a:b);if(tangent.y<0)tangent.negate();
   const scale=Math.max(WATERFALL_SCALE,scales[index]);
   return positions[index].clone().addScaledVector(normal,.3*scale+.08).addScaledVector(tangent,.23*scale);
  }
 });
 const glowStrengths=new Float32Array(WATERFALL_COUNT),glowColors=slots.map(()=>new THREE.Color());
 const haloPositions=new Float32Array(WATERFALL_COUNT*3),haloColors=new Float32Array(WATERFALL_COUNT*3),haloAlpha=new Float32Array(WATERFALL_COUNT),haloSizes=new Float32Array(WATERFALL_COUNT);
 const haloGeometry=new THREE.BufferGeometry();
 for(const [name,array,size] of [['position',haloPositions,3],['tint',haloColors,3],['alpha',haloAlpha,1],['size',haloSizes,1]])haloGeometry.setAttribute(name,new THREE.BufferAttribute(array,size).setUsage(THREE.DynamicDrawUsage));
 const haloMaterial=material.clone();haloMaterial.uniforms=material.uniforms;
 haloMaterial.fragmentShader='varying vec3 color;varying float opacity;void main(){float r=length(gl_PointCoord-.5)*2.;float halo=smoothstep(.12,.38,r)*(1.-smoothstep(.35,1.,r));gl_FragColor=vec4(color,halo*opacity*.5);}';
 const halos=new THREE.Points(haloGeometry,haloMaterial);halos.frustumCulled=false;halos.renderOrder=1;halos.visible=false;group.add(halos);
 let view=waterfallView(1625,884),enabled=false,velocity=0,batchTime=0,reducedTime=0,reducedSlot=0;
 let worker=null,workerLease=null,busy=false,received=null,queuedResize=null,pendingTime=0,ready=false,stats={};
 let advance=0;
 function project(){for(let i=0;i<WATERFALL_COUNT;i++){const depth=view.cameraZ-positions[i].z;screen[i].x=positions[i].x*view.focal/depth;screen[i].y=view.height/2-positions[i].y*view.focal/depth;}}
 function seed(){for(let i=0;i<WATERFALL_COUNT;i++){const p=waterfallSeed(slots[i],view);positions[i].copy(p);if(!reducedMotion){positions[i].y=p.top+.8;positions[i].x*=WATERFALL_ENTRY_WIDTH;}rotations[i].copy(waterfallQuaternion(slots[i].angle));scales[i]=reducedMotion?WATERFALL_SCALE:0;}project();}
 function fail(error){console.error('Waterfall physics:',error?.message??'worker failed');workerLease?.dispose();workerLease=null;worker=null;busy=false;pendingTime=0;onStatus('error');notify('碰撞效果加载失败，请刷新大屏重试');}
 function pump(){
  if(!worker||busy)return;
  if(queuedResize){worker.postMessage({type:'resize',view:queuedResize});queuedResize=null;busy=true;}
  else if(pendingTime>=1/120){worker.postMessage({type:'step',dt:pendingTime,highlights:[...lit],rate:velocity});pendingTime=0;busy=true;}
 }
 function startWorker(){
  const lease=takeWaterfallWorker(),current=lease.worker;workerLease=lease;worker=current;busy=true;
  lease.ready.then(()=>{
   if(worker!==current)return;
   current.onmessage=({data})=>{if(worker!==current)return;if(data.type==='error'){fail(data);return;}busy=false;received=data;if(data.kind==='init')onStatus('ready');pump();};
   current.onerror=fail;current.postMessage({type:'init',view,slots,staticLayout:reducedMotion});
  }).catch(error=>{if(worker===current)fail(error);});
 }
 function resize(width,height){view=waterfallView(width,height);material.uniforms.focal.value=view.focal;if(worker)queuedResize=view;else seed();return view;}
 seed();
 return {
  resize,
  setEnabled(value){
   if(value!==enabled){
    workerLease?.dispose();workerLease=null;worker=null;busy=false;received=null;queuedResize=null;pendingTime=0;ready=false;stats={};
    generations.fill(0);pending.clear();falling.fill(0);glowStrengths.fill(0);halos.visible=false;hunters.reset();lockedAnchors.clear();lit.clear();velocity=0;batchTime=0;reducedTime=0;advance=0;seed();
    onStatus(value?'loading':'idle');
    if(value)try{startWorker();}catch{fail();}
   }
   enabled=value;group.visible=value;
  },
  update(dt,{phase,reduced,drawCount=0,people=[],revealPhase=null},recycle){
   if(!enabled)return;
   portraits=people;
   const active=phase==='idle'||phase==='rolling'||phase==='result',rolling=phase==='rolling';
   const target=active&&!reduced?1:0;
   const emphasis=rolling&&!reduced?1:0;
   advance+=(emphasis*1.1-advance)*(1-Math.exp(-dt*(emphasis?4:12)));
   if(!emphasis&&advance<.001)advance=0;
   if(reduced)advance=0;
   velocity+=(target-velocity)*(1-Math.exp(-dt*(target?4:18)));
   if(reduced||!active&&velocity<.01)velocity=0;
   // Background physics continues through the winner reveal and result display.
   if(received&&(!ready||velocity>0||received.kind==='resize')){
    const {data}=received;stats=received.stats;falling.set(received.falling);
    for(let i=0;i<WATERFALL_COUNT;i++){
     const o=i*9;positions[i].fromArray(data,o);rotations[i].fromArray(data,o+3);scales[i]=data[o+7];
     if(data[o+8]!==generations[i]){generations[i]=data[o+8];glowStrengths[i]=0;pending.add(i);}
    }
    received=null;ready=true;project();
   }
   pendingTime=Math.min(.1,pendingTime+dt*velocity);
   if(velocity===0)pendingTime=0;
   pump();
   if(reduced&&active){reducedTime+=dt;if(reducedTime>=3){reducedTime=0;for(let i=0;i<14;i++)pending.add(reducedSlot++%WATERFALL_COUNT);}}
   // Batch texture uploads; recycled slots stay hidden until their new portrait is ready.
   batchTime+=dt;
   if(pending.size&&(batchTime>=(rolling?.12:.3)||!active)){
    recycle([...pending]);pending.clear();batchTime=0;
   }
   if(rolling||!revealPhase)lockedAnchors.clear();
   hunters.update(dt,{rolling,count:drawCount,reduced,phase:revealPhase});lit=new Set(rolling?hunters.highlights:[]);
   if(rolling)for(const light of hunters.illumination)glowColors[light.target].set(light.color);
   let haloCount=0;
   for(let i=0;i<WATERFALL_COUNT;i++){
    const target=rolling&&!reduced&&lit.has(i)?1:0;
    glowStrengths[i]+=(target-glowStrengths[i])*(1-Math.exp(-dt*(target?12:7)));
    if(reduced)glowStrengths[i]=0;
    if(glowStrengths[i]<.02||scales[i]<.1||pending.has(i))continue;
    haloPositions.set([positions[i].x,positions[i].y,positions[i].z+.55*scales[i]],haloCount*3);
    glowColors[i].toArray(haloColors,haloCount*3);haloAlpha[haloCount]=glowStrengths[i];haloSizes[haloCount]=scales[i]*1.75;haloCount++;
   }
   haloGeometry.setDrawRange(0,haloCount);halos.visible=haloCount>0;
   for(const attribute of Object.values(haloGeometry.attributes))attribute.needsUpdate=true;
  },
  apply(index,dummy){
   dummy.position.copy(positions[index]);dummy.scale.setScalar(pending.has(index)?0:scales[index]);
   dummy.quaternion.copy(rotations[index]);
   if(screen[index].y<view.top-15)dummy.scale.setScalar(0);
  },
  flightMatrix(index,matrix){
   const p=positions[index].clone(),depth=view.cameraZ-p.z;
   // A draw stopped during entry can still reveal winners from the top of the waterfall.
   if(scales[index]<WATERFALL_SCALE*.85||screen[index].y<view.top+28||screen[index].y>view.bottom-28)
    p.y=(view.height/2-view.top-40)*depth/view.focal;
   return matrix.compose(p,rotations[index],new THREE.Vector3().setScalar(Math.max(WATERFALL_SCALE,scales[index])));
  },
  flightSources(people,records){return waterfallFlightSources(people,records,i=>{
   if(!falling[i]||pending.has(i)||scales[i]<WATERFALL_SCALE*.85||screen[i].y<view.top+28||screen[i].y>view.bottom-28)return false;
   // Exclude sources hidden at the center of a nearer cube's projected footprint.
   for(let j=0;j<WATERFALL_COUNT;j++)if(positions[j].z>positions[i].z+.5&&!pending.has(j)&&scales[j]>.9){
    const half=.3*scales[j]*view.focal/(view.cameraZ-positions[j].z);
    if(Math.abs(screen[j].x-screen[i].x)<half*.8&&Math.abs(screen[j].y-screen[i].y)<half*.8)return false;
   }
   return true;
  },Math.random,hunters.targets);},
  lockSources(indices){
   lockedAnchors.clear();
   for(const index of indices){
    const matrix=new THREE.Matrix4();this.flightMatrix(index,matrix);
    const p=new THREE.Vector3().setFromMatrixPosition(matrix),scale=new THREE.Vector3().setFromMatrixScale(matrix).x;
    lockedAnchors.set(index,p.add(new THREE.Vector3(0,.23*scale,.3*scale+.08)));
   }
   hunters.lock(indices);
  },
  spotlight(index){return Math.max(0,scales[index]/WATERFALL_SCALE-1)*.7+(lit.has(index)?.15:0);},
  emphasis(index){return Math.max(0,Math.min(1,scales[index]/WATERFALL_SCALE-1));},
  writeGlow(index,attribute){const color=glowColors[index];attribute.setXYZW(index,color.r,color.g,color.b,glowStrengths[index]);},
  get huntState(){return hunters.state.map(s=>({...s,falling:!!falling[s.target],scale:s.target<0?1:scales[s.target]/WATERFALL_SCALE}));},
  get advance(){return advance;},
  get view(){return view;},get velocity(){return velocity;},get ready(){return ready;},get stats(){return stats;}
 };
}
