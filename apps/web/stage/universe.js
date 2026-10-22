import {createPortraitRotation,PORTRAIT_INTERVAL,PORTRAIT_ROLLING_INTERVAL} from './portrait-rotation.js';
import {createPortraitTiles} from './portrait-tiles.js';
import {expandedMatrixLayout,matrixFlightSources,matrixPushSeeds,matrixPushDepth,MATRIX_COUNT,MATRIX_BOX_DEPTH,MATRIX_PUSH_MAX} from './matrix-layout.js';
import {matrixIdleWave,sphereIdleLight,createIdleBudget} from './idle-motion.js';
import {STAR_WAVE_COUNT,STAR_WAVE_PER_RING,STAR_WAVE_CARD_DEPTH,STAR_WAVE_CARD_SCALE,STAR_WAVE_RINGS,starWaveSlots,starWaveStep,starWaveBoxScale,starWaveLayer,starWaveView,starWavePosition,starWaveCameraDistance,starWaveFlightSources} from './star-wave-layout.js';
import {createWaterfall} from './waterfall.js';
import {WATERFALL_COUNT} from './waterfall-layout.js';
import {createCorridor} from './corridor.js';
import {createCorridorRobot} from './corridor-robot.js';
import {CORRIDOR_COUNT,CORRIDOR_COLUMNS,CORRIDOR_PER_COLUMN} from './corridor-layout.js';
import {createStarWaveEffects} from './star-wave-effects.js';
import {createRingPortraitRotation} from './ring-portraits.js';
import {createIdleOrbits} from './idle-orbits.js';
import {createCosmicBackground} from './cosmic-background.js';
import {createOrbitMeteors} from './orbit-meteors.js';
import {createMeteorTrail} from './meteor-trail.js';
import * as THREE from 'three';
import {CUBE_SIDE,SPHERE_COUNT,MAX_HIGHLIGHT_SCALE,flightSources,sphereLayout,spherePoints,winnerLayout} from './sphere-layout.js';

export function createUniverse({getState,getPeople,avatar,brandLogo,reduced,notify,onWaterfallStatus}){
 const canvas=document.querySelector('#universe'),stage=document.querySelector('#stage');
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));
 // Place winner portraits above the HTML glass so only the backdrop is frosted.
 const resultCanvas=document.createElement('canvas');resultCanvas.className='winner-universe';resultCanvas.setAttribute('aria-hidden','true');canvas.after(resultCanvas);
 const resultRenderer=new THREE.WebGLRenderer({canvas:resultCanvas,antialias:true,alpha:true,powerPreference:'high-performance'});
 resultRenderer.setPixelRatio(renderer.getPixelRatio());resultRenderer.setClearColor(0x000000,0);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(40,1,.1,100),cluster=new THREE.Group();scene.add(cluster);
 const tintCanvas=document.createElement('canvas');tintCanvas.width=tintCanvas.height=12;const tintContext=tintCanvas.getContext('2d',{willReadFrequently:true});
 const portraitTints=new WeakMap();
 function portraitTint(source,cache=false){
  if(cache&&portraitTints.has(source))return portraitTints.get(source);
  tintContext.clearRect(0,0,12,12);tintContext.drawImage(source,0,0,12,12);
  const pixels=tintContext.getImageData(0,0,12,12).data,bins=new Map();
  for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]<128)continue;const r=pixels[i]/255,g=pixels[i+1]/255,b=pixels[i+2]/255,max=Math.max(r,g,b),min=Math.min(r,g,b),chroma=max-min;
   if(max<.10||min>.90)continue;
   const key=[r,g,b].map(v=>Math.floor(v*4)).join(','),weight=.15+chroma*2;
   const bin=bins.get(key)||{r:0,g:0,b:0,weight:0};bin.r+=r*weight;bin.g+=g*weight;bin.b+=b*weight;bin.weight+=weight;bins.set(key,bin);
  }
  const best=[...bins.values()].sort((a,b)=>b.weight-a.weight)[0];
  const tint=best?new THREE.Color().setRGB(best.r/best.weight,best.g/best.weight,best.b/best.weight,THREE.SRGBColorSpace):new THREE.Color('#71829d');
  if(cache)portraitTints.set(source,tint);return tint;
 }
 // The atlas is CPU staging memory for explicit WebGL uploads. Keeping this
 // canvas on the GPU would bounce each read-friendly portrait across contexts.
 const atlas=document.createElement('canvas');atlas.width=atlas.height=2688;const ctx=atlas.getContext('2d',{willReadFrequently:true});
 const portraitTiles=createPortraitTiles(441),tileTints=[];
 const portraitKey=person=>person===null?'brand':typeof person==='number'?'number:'+person:person?.avatarUrl?'url:'+person.avatarUrl:'fallback:'+(person?.nickname||'✦');
 const texture=new THREE.CanvasTexture(atlas);texture.colorSpace=THREE.SRGBColorSpace;
 const portraitUpload=new THREE.Texture(),portraitUploadPosition=new THREE.Vector2();
 const material=new THREE.ShaderMaterial({uniforms:{atlas:{value:texture},grid:{value:21},brightness:{value:1},opacity:{value:1},frontOnly:{value:0},sideFlowTime:{value:0},sideFlowStrength:{value:0}},vertexShader:`
 attribute vec4 avatarGlow;varying vec4 vAvatarGlow;attribute float avatarIndex; attribute float spotlight;attribute float pinnedWinner;attribute vec3 bodyTint;
 varying float vPinned;varying vec2 vUv; varying float vTile; varying float vLight; varying float vSpot;varying float vFront;varying vec3 vTint;varying float vDepth;varying float vTop;varying vec3 vNormal;varying vec3 vView;
 void main(){vAvatarGlow=avatarGlow;vPinned=pinnedWinner;vUv=uv;vTile=avatarIndex;vSpot=spotlight;vFront=step(.5,normal.z);vTint=bodyTint;vDepth=position.z/.6+.5;vTop=normal.y;
 vec3 n=normalize(mat3(modelMatrix*instanceMatrix)*normal);
 vNormal=n;vView=cameraPosition-(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;
 vLight=.62+.38*abs(dot(n,normalize(vec3(.3,.8,1.))));
 gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
 fragmentShader:`varying vec4 vAvatarGlow;uniform sampler2D atlas;uniform float grid;uniform float brightness;uniform float opacity;uniform float frontOnly;uniform float sideFlowTime;uniform float sideFlowStrength;varying float vPinned;varying vec2 vUv;varying float vTile;varying float vLight;varying float vSpot;varying float vFront;varying vec3 vTint;varying float vDepth;varying float vTop;varying vec3 vNormal;varying vec3 vView;
 void main(){float tile=floor(vTile+.5);vec2 cell=vec2(mod(tile,grid),grid-1.-floor(tile/grid));
 vec2 uv=(cell+mix(vec2(.018),vec2(.982),vUv))/grid;vec4 c=texture2D(atlas,uv);
 if(frontOnly>.5&&vFront<.5){
  float depth=clamp(vDepth,0.,1.);
  vec3 base=mix(vec3(.045,.055,.08),vTint,.78);
  float sheen=pow(max(dot(normalize(vNormal),normalize(normalize(vView)+normalize(vec3(-.4,.8,1.)))),0.),26.);
  float brushed=1.+.022*sin((abs(vTop)>.5?vUv.x:vUv.y)*420.);
  vec3 body=base*mix(.28,.92,smoothstep(0.,1.,depth))*(1.+vTop*.18)*brushed;
  body+=mix(vec3(.12,.14,.18),vTint,.35)*sheen*.35;
  if(sideFlowStrength>.001&&abs(vNormal.z)<.5){
   float travel=fract(sideFlowTime*.24+vTile*.017);
   float ribbon=1.-smoothstep(.055,.25,abs(depth-travel));
   float fade=4.*travel*(1.-travel);
   // Keep the sheen visible between spatial waves; the wave adds a brighter pass.
   float flowLight=.48+.52*clamp(vSpot,0.,1.);
   body+=mix(vec3(.58,.7,.85),vTint,.3)*ribbon*fade*sideFlowStrength*flowLight*.9;
  }
  c=vec4(body,1.);
 }
 vec3 litColor=c.rgb*(vLight+vSpot*.42)*max(brightness,vPinned);
 if(vAvatarGlow.a>.001){
  float sheen=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),2.);
  float glow=vAvatarGlow.a*(.94+.06*sin(sideFlowTime*3.));
  litColor=mix(litColor,litColor*mix(vec3(1.),vAvatarGlow.rgb*1.8,.4),glow*.35);
  litColor+=vAvatarGlow.rgb*glow*(.12+sheen*.32);
 }
 gl_FragColor=vec4(litColor,opacity);
 #include <colorspace_fragment>
 }`});
 function geometry(size,count){const geo=new THREE.BoxGeometry(size,size,size),ids=new Float32Array(count),lights=new Float32Array(count);for(let i=0;i<count;i++)ids[i]=i%64;geo.setAttribute('avatarGlow',new THREE.InstancedBufferAttribute(new Float32Array(count*4),4));geo.setAttribute('pinnedWinner',new THREE.InstancedBufferAttribute(new Float32Array(count),1));geo.setAttribute('bodyTint',new THREE.InstancedBufferAttribute(new Float32Array(count*3).fill(.2),3));geo.setAttribute('avatarIndex',new THREE.InstancedBufferAttribute(ids,1));geo.setAttribute('spotlight',new THREE.InstancedBufferAttribute(lights,1));return geo;}
 const capacity=Math.max(SPHERE_COUNT,MATRIX_COUNT,STAR_WAVE_COUNT,CORRIDOR_COUNT,WATERFALL_COUNT);
 const geo=geometry(CUBE_SIDE,capacity),cubes=new THREE.InstancedMesh(geo,material,capacity);cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);cubes.frustumCulled=false;cluster.add(cubes);
 // Each winner has one reusable 512px texture, uploaded separately during retreat.
 const resultScene=new THREE.Scene(),resultCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,20000);resultCamera.position.z=10000;
 const winnerSlots=Array.from({length:10},()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const geo=geometry(CUBE_SIDE,1),mat=material.clone();mat.uniforms.atlas.value=texture;mat.uniforms.grid.value=1;mat.transparent=true;mat.depthWrite=false;const mesh=new THREE.InstancedMesh(geo,mat,1);mesh.frustumCulled=false;mesh.visible=false;resultScene.add(mesh);return {canvas,texture,geo,mesh,person:null};});
 function prepareWinner(index,record,force=false){const slot=winnerSlots[index];if(!force&&slot.person===record.person)return;avatar(record.person,512,slot.canvas);slot.person=record.person;const tint=portraitTint(slot.canvas);slot.geo.attributes.bodyTint.setXYZ(0,tint.r,tint.g,tint.b);slot.geo.attributes.bodyTint.needsUpdate=true;slot.texture.needsUpdate=true;resultRenderer.initTexture(slot.texture);}
 const trails=Array.from({length:10},()=>createMeteorTrail(resultScene,renderer.getPixelRatio()));
 renderer.autoClear=false;
 const dummy=new THREE.Object3D(),flyDummy=new THREE.Object3D();let layout=sphereLayout(getState().population),points=spherePoints(layout.count),radius=layout.radius,rotation=0,speed=.038,energy=0;
 // Keep background framing independent from the sphere's immersive camera.
 const cosmicScene=new THREE.Scene(),cosmicCamera=new THREE.PerspectiveCamera(40,1,.1,100);
 const cosmos=createCosmicBackground(cosmicScene,renderer.getPixelRatio());
 const orbit=new THREE.Group();orbit.rotation.set(1.03,.26,-.25);cluster.add(orbit);
 for(let j=0;j<2;j++){const pts=[];for(let i=0;i<180;i++){const a=i/180*Math.PI*2;pts.push(new THREE.Vector3(Math.cos(a)*(1.12+j*.055),Math.sin(a)*(1.12+j*.055),0));}orbit.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xd5b988,transparent:true,opacity:.08-j*.03})));}
 const idleOrbits=createIdleOrbits(orbit,renderer.getPixelRatio()),idleBudget=createIdleBudget();let idleBlend=0,idleQuality=1;
 const orbitMeteors=createOrbitMeteors(scene,renderer.getPixelRatio());
 const waveEffects=createStarWaveEffects(cluster,renderer.getPixelRatio());
 const corridor=createCorridor(cluster,renderer.getPixelRatio());
 const corridorRobot=createCorridorRobot(cluster,{geometry,material,avatar,brandLogo,getParticipants:()=>[...portraitMap.values()]});
 const waterfall=createWaterfall(cluster,renderer.getPixelRatio(),notify,reduced,onWaterfallStatus);
 const pushSeeds=matrixPushSeeds(MATRIX_COUNT);
 let baseCameraZ=30,baseCenterY=0,cameraPush=0,matrixMode=false,waveMode=false,corridorMode=false,waterfallMode=false,waveTime=0,waveDistance=0,waveContinuous=0,waveSpinTime=0,waveFlowSpeed=0,waveWasRolling=false,waveReset=null,reducedRing=0,matrix=null,pushTime=0,pushStrength=0,matrixAdvance=0;
 const waveSlots=starWaveSlots(),waveVisible=new Uint8Array(STAR_WAVE_COUNT),waveGenerations=new Int32Array(STAR_WAVE_RINGS.length);let waveView=starWaveView(stage.clientWidth,stage.clientHeight);
 function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);resultRenderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();resultCamera.left=-w/2;resultCamera.right=w/2;resultCamera.top=h/2;resultCamera.bottom=-h/2;resultCamera.updateProjectionMatrix();
  waterfall.resize(w,h);corridor.resize(w,h);corridorRobot.resize(corridor.view);waveView=starWaveView(w,h);camera.far=corridorMode?Math.max(500,corridor.view.far+100):waveMode?Math.max(500,waveView.focal*7.4/waveView.inner+100):100;camera.updateProjectionMatrix();
  // Fit the fixed sphere and rotating cube envelope to the desktop stage.
  const top=matrixMode?175:135,bottom=h-125,center=(top+bottom)/2;
  const usable=Math.max(230,Math.min(bottom-top,w*.94));const focal=h/(2*Math.tan(THREE.MathUtils.degToRad(20)));
  matrix=expandedMatrixLayout(w*.90,Math.max(160,bottom-top));
  const originalMatrix=matrix.framing;
  const sphereEnvelope=layout.radius+CUBE_SIDE*Math.sqrt(3)/2*MAX_HIGHLIGHT_SCALE;
  baseCameraZ=waterfallMode?waterfall.view.cameraZ:corridorMode?corridor.view.cameraZ:waveMode?starWaveCameraDistance(focal,w,bottom-top):matrixMode?Math.max(originalMatrix.width*focal/(w*.90),originalMatrix.height*focal/Math.max(160,bottom-top))+MATRIX_PUSH_MAX+CUBE_SIDE*MATRIX_BOX_DEPTH/2+1.3:sphereEnvelope*Math.sqrt(1+(2*focal/usable)**2);baseCenterY=waterfallMode?0:(h/2-center)*baseCameraZ/focal;
  camera.position.z=THREE.MathUtils.lerp(baseCameraZ,layout.radius*1.55+.3,cameraPush);camera.fov=40+20*cameraPush;camera.updateProjectionMatrix();cluster.position.set(0,baseCenterY*(1-cameraPush),0);
 }
 window.addEventListener('resize',resize);resize();
 // Result rows can grow the stage without changing the browser viewport.
 let observedWidth=stage.clientWidth,observedHeight=stage.clientHeight;
 const stageObserver=new ResizeObserver(()=>{
  if(stage.clientWidth===observedWidth&&stage.clientHeight===observedHeight)return;
  observedWidth=stage.clientWidth;observedHeight=stage.clientHeight;resize();
 });
 stageObserver.observe(stage);
 window.addEventListener('pagehide',event=>{if(!event.persisted)stageObserver.disconnect();});
 let last=performance.now(),active=true,resultRecords=[];
 let revealJob=null;const arrivals=new Map();let visiblePeople=[],population=getState().population,turnover=performance.now();
 const matrixPins=new Map();
 const portraitRotation=createPortraitRotation(SPHERE_COUNT),matrixPortraitRotation=createPortraitRotation(MATRIX_COUNT),wavePortraitRotation=createRingPortraitRotation(STAR_WAVE_RINGS.length,STAR_WAVE_PER_RING),corridorPortraitRotation=createRingPortraitRotation(CORRIDOR_COLUMNS,CORRIDOR_PER_COLUMN,Math.random,{shuffleLayer:true}),waterfallPortraitRotation=createRingPortraitRotation(WATERFALL_COUNT,1);let portraitMap=new Map();
 const displayCount=()=>waterfallMode?WATERFALL_COUNT:corridorMode?CORRIDOR_COUNT:waveMode?STAR_WAVE_COUNT:matrixMode?MATRIX_COUNT:SPHERE_COUNT;
 const portraitQueue=()=>waterfallMode?waterfallPortraitRotation:corridorMode?corridorPortraitRotation:waveMode?wavePortraitRotation:matrixMode?matrixPortraitRotation:portraitRotation;
 function paintVisiblePortraits(dirtyUrls=new Set()){
  const persons=visiblePeople.map((person,index)=>matrixPins.get(index)?.person??person),keys=persons.map(portraitKey);
  const byKey=new Map(keys.map((key,index)=>[key,persons[index]]));
  const dirty=dirtyUrls===null?null:new Set([...dirtyUrls].map(url=>'url:'+url));
  if(dirtyUrls?.has(brandLogo.url?.()))dirty.add('brand');
  const {indices,updates}=portraitTiles.update(keys,dirty,key=>{
   const person=byKey.get(key);return person===null||!avatar.isReady||avatar.isReady(person);
  });
  uploadPortraitTiles(updates,byKey);
  for(let i=0;i<indices.length;i++){
   const tile=indices[i],tint=tileTints[tile];geo.attributes.avatarIndex.array[i]=tile;
   geo.attributes.bodyTint.setXYZ(i,tint.r,tint.g,tint.b);
  }
  geo.attributes.avatarIndex.needsUpdate=true;geo.attributes.bodyTint.needsUpdate=true;
 }
 function uploadPortraitTiles(updates,byKey){
  const changed=[];
  for(const {key,tile} of updates){
   const person=byKey.get(key),source=person===null?brandLogo():avatar(person,128);
   ctx.drawImage(source,tile%21*128,Math.floor(tile/21)*128,128,128);
   tileTints[tile]=portraitTint(source,true);changed.push({index:tile,source});
  }
  if(changed.length){
   if(changed.length<=64){
    // Upload only recycled portraits; regenerate the atlas mipmaps once per batch.
    renderer.initTexture(texture);
    try{for(let i=0;i<changed.length;i++){
     const {index,source}=changed[i];portraitUpload.image=source;
     texture.generateMipmaps=i===changed.length-1;
     portraitUploadPosition.set(index%21*128,(20-Math.floor(index/21))*128);
     renderer.copyTextureToTexture(portraitUpload,texture,null,portraitUploadPosition);
    }}finally{texture.generateMipmaps=true;}
   }else texture.needsUpdate=true;
  }
 }
 function warmMatrixPortraits(){
  // Reserve visible cells (including pinned winners) while preparing the next
  // batch in spare atlas cells. Keep the 180ms visual cadence, but spread the
  // rasterization and GPU uploads across frames instead of doing 60 at once.
  const visible=visiblePeople.map((person,index)=>matrixPins.get(index)?.person??person);
  const upcoming=matrixPortraitRotation.upcoming().map(id=>portraitMap.get(id)).filter(person=>person!=null&&(!avatar.isReady||avatar.isReady(person)));
  const byKey=new Map([...visible,...upcoming].map(person=>[portraitKey(person),person]));
  const {updates}=portraitTiles.update([...byKey.keys()],new Set(),key=>{
   const person=byKey.get(key);return person===null||!avatar.isReady||avatar.isReady(person);
  },6);
  uploadPortraitTiles(updates,byKey);
 }
 function applyPortraitSlots(ids){
  visiblePeople=ids.map(id=>id===null?null:portraitMap.get(id));
  paintVisiblePortraits();
  avatar.preload?.(portraitQueue().upcoming().map(id=>portraitMap.get(id)));
 }
 let lastPeople=null;
 function refreshPeople(force=false){
  const persons=getPeople?getPeople():Array.from({length:population},(_,i)=>i);
  if(!force&&persons===lastPeople)return;lastPeople=persons;
  // Changing layout should not replace hundreds of already prepared portraits.
  // The new queue retains these IDs and resumes its own normal turnover. A
  // smaller layout trims slots; a larger one fills only its additional slots.
  const retained=force?visiblePeople.map(p=>p==null?null:typeof p==='number'?p:p.id):undefined;
  portraitMap=new Map(persons.map(p=>[typeof p==='number'?p:p.id,p]));
  applyPortraitSlots(portraitQueue().update([...portraitMap.keys()],retained));
 }
 refreshPeople();
 function syncMatrixPins(){
  const winners=getState().theme==='starlight-matrix'?resultRecords.filter(r=>r.status!=='void'):[];
  const valid=new Set(winners.map(r=>r.id));
  let changed=false;
  for(const [index,pin] of matrixPins){if(!valid.has(pin.awardId)){matrixPins.delete(index);changed=true;}}
  for(const r of winners){
   if([...matrixPins.values()].some(pin=>pin.awardId===r.id))continue;
   const personId=r.participant_id??r.person?.id;
   const matching=visiblePeople.findIndex((p,i)=>!matrixPins.has(i)&&(typeof r.person==='number'?p===r.person:personId!=null&&p?.id===personId));
   const index=matching>=0?matching:matrixFlightSources(MATRIX_COUNT,MATRIX_COUNT).find(i=>!matrixPins.has(i));
   if(index===undefined)continue;
   // Keep this winner at its matrix cell while the rest of the wall retreats.
   const depth=Math.max(3.5,matrixAdvance+matrixPushDepth(pushTime,pushSeeds[index])*pushStrength);
   matrixPins.set(index,{awardId:r.id,person:r.person,depth});changed=true;
  }
  if(changed)paintVisiblePortraits();
 }
 function setRecords(records){resultRecords=records.slice(0,10);const valid=new Set(resultRecords.filter(r=>r.status!=='void').map(r=>r.id));for(const id of arrivals.keys())if(!valid.has(id))arrivals.delete(id);syncMatrixPins();}
 function syncWinners(records){
  setRecords(records);
  resultRecords.forEach((r,index)=>{if(r.status==='void')return;prepareWinner(index,r);if(!arrivals.has(r.id))arrivals.set(r.id,{screenOrigin:new THREE.Vector3(),sourceSize:0,orientation:new THREE.Quaternion(),index:-1,start:null});});
 }
 function resetWaveLayout(now){
  if(!waveMode||waveReset)return;
  const matrix=new THREE.Matrix4(),quaternion=new THREE.Quaternion();
  const origins=Array.from({length:STAR_WAVE_COUNT},(_,i)=>{
   cubes.getMatrixAt(i,matrix);const position=new THREE.Vector3(),scale=new THREE.Vector3();
   matrix.decompose(position,quaternion,scale);return {position,scale:scale.x};
  });
  waveReset=reduced?null:{start:now,origins};waveTime=0;waveDistance=0;waveContinuous=0;waveFlowSpeed=0;
  waveGenerations.fill(0);rotation=0;waveWasRolling=false;
 }
 function reveal(records,onComplete){
  if(waveMode)resetWaveLayout(performance.now());
  if(corridorMode)corridor.reset(performance.now(),reduced);
  const robotReveal=corridorMode&&!reduced&&corridorRobot.stop();
  if(reduced){syncWinners(records);onComplete?.();return;}
  setRecords(records);const pending=resultRecords.map((r,index)=>({r,index})).filter(({r})=>r.status!=='void'&&!arrivals.has(r.id));
  if(!pending.length){onComplete?.();return;}
  revealJob={phase:'retreat',settle:robotReveal?300:waterfallMode?650:900,highlight:waterfallMode?350:150,start:performance.now(),push:cameraPush,matrixAdvance,pushStrength,speed,energy,pending,queue:[...pending],onComplete,end:Infinity};
 }
 function launchWinners(now){
  camera.updateMatrixWorld(true);cluster.updateMatrixWorld(true);
  const robotReveal=corridorMode&&corridorRobot.ready;
  const sources=robotReveal?corridorRobot.flightSources(revealJob.pending.map(({r})=>r)):waterfallMode?waterfall.flightSources(visiblePeople,revealJob.pending.map(({r})=>r)):corridorMode?corridor.flightSources(visiblePeople,revealJob.pending.map(({r})=>r)):waveMode?starWaveFlightSources(visiblePeople,revealJob.pending.map(({r})=>r),Math.random,i=>!!waveVisible[i]):matrixMode?matrixFlightSources(MATRIX_COUNT,revealJob.pending.length):flightSources(points,rotation,revealJob.pending.length);
  if(waterfallMode)waterfall.lockSources(sources);
  for(const [order,{r}] of revealJob.pending.entries()){
   const index=matrixMode?([...matrixPins].find(([,pin])=>pin.awardId===r.id)?.[0]??sources[order]):sources[order],matrix=new THREE.Matrix4();if(robotReveal)corridorRobot.flightMatrix(index,matrix);else if(waterfallMode)waterfall.flightMatrix(index,matrix);else cubes.getMatrixAt(index,matrix);matrix.premultiply(cluster.matrixWorld);
   const origin=new THREE.Vector3(),orientation=new THREE.Quaternion(),sourceScale=new THREE.Vector3();matrix.decompose(origin,orientation,sourceScale);
   const screenOrigin=origin.clone().project(camera),sourceSize=sourceScale.x/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*(camera.position.z-origin.z));
   arrivals.set(r.id,{screenOrigin,sourceSize,sourceDepth:sourceScale.z/sourceScale.x,orientation,index,robot:robotReveal,waterfall:waterfallMode,waterfallScale:waterfallMode?sourceScale.x/1.25:1,highlightStart:waterfallMode?now:null,start:now+revealJob.highlight+order*(corridorMode||waterfallMode?0:90)});
   // The high-resolution winner replaces its source cube during the highlight.
   if(!matrixMode&&!robotReveal){const hidden=new THREE.Matrix4().makeScale(0,0,0);cubes.setMatrixAt(index,hidden);}
  }
  if(robotReveal)corridorRobot.explode(sources);
  revealJob.phase='highlight';revealJob.flightStart=now+revealJob.highlight;revealJob.end=now+revealJob.highlight+1600+(revealJob.pending.length-1)*(corridorMode||waterfallMode?0:90);
 }

 function frame(now){requestAnimationFrame(frame);if(document.hidden||!active){last=now;return;}
  const elapsed=now-last,dt=Math.min(elapsed/1000,.05),t=now/1000;last=now;const rolling=getState().phase==='rolling';
  const nextMatrix=getState().theme==='starlight-matrix',nextWave=getState().theme==='star-wave',nextCorridor=getState().theme==='starlight-corridor',nextWaterfall=getState().theme==='galaxy-waterfall';
  if((matrixMode!==nextMatrix||waveMode!==nextWave||corridorMode!==nextCorridor||waterfallMode!==nextWaterfall)&&!revealJob){matrixMode=nextMatrix;waveMode=nextWave;corridorMode=nextCorridor;waterfallMode=nextWaterfall;waterfall.setEnabled(waterfallMode);corridor.setEnabled(corridorMode);corridorRobot.setEnabled(corridorMode);waveTime=0;waveDistance=0;waveContinuous=0;waveSpinTime=0;waveFlowSpeed=0;waveGenerations.fill(0);waveReset=null;waveWasRolling=false;cameraPush=0;rotation=0;resize();refreshPeople(true);syncMatrixPins();}
  if(waveMode&&waveWasRolling&&!rolling)resetWaveLayout(now);
  waveWasRolling=rolling;
  if(waveReset&&now-waveReset.start>=900)waveReset=null;
  const resting=getState().phase==='idle'||getState().phase==='result';
  const waveActive=rolling||resting;
  const resetProgress=waveReset?Math.min(1,(now-waveReset.start)/900):1,resetEase=resetProgress*resetProgress*(3-2*resetProgress);
  canvas.dataset.layout=waterfallMode?'waterfall':corridorMode?'corridor':waveMode?'star-wave':matrixMode?'matrix':'sphere';canvas.dataset.waveLayers=waveMode?String(STAR_WAVE_RINGS.length):'0';canvas.dataset.avatarCount=String(displayCount());canvas.dataset.matrixRows=String(matrix.rows);canvas.dataset.matrixColumns=String(matrix.columns);orbit.visible=!matrixMode&&!waveMode&&!corridorMode&&!waterfallMode;
  material.uniforms.frontOnly.value=matrixMode?1:0;
  const ease=1-Math.exp(-dt*4);
  const idleActive=resting&&!reduced&&!revealJob&&(!matrixMode||getState().phase==='idle'&&!resultRecords.some(r=>r.status!=='void'));
  idleQuality=idleBudget.update(elapsed,idleActive);idleBlend+=((idleActive?idleQuality:0)-idleBlend)*(1-Math.exp(-dt*5));
  if(reduced)idleBlend=0;
  canvas.dataset.idleQuality=String(idleQuality);canvas.dataset.idleEffects=idleBlend.toFixed(3);
  idleOrbits.update(t,matrixMode||waveMode||corridorMode||waterfallMode?0:idleBlend);
  material.uniforms.sideFlowTime.value=t;material.uniforms.sideFlowStrength.value=matrixMode?idleBlend:0;
  let completed=null;
  const retreat=revealJob?.phase==='retreat',revealing=!!revealJob&&!retreat;
  const matrixMoving=matrixMode&&!reduced&&!revealJob&&!resultRecords.some(r=>r.status!=='void');
  if(matrixMoving||matrixMode&&rolling&&!reduced)pushTime+=dt*(1+energy*4);
  pushStrength+=((matrixMoving||rolling&&!reduced?1:0)-pushStrength)*ease;
  material.uniforms.brightness.value+=((resultRecords.some(r=>r.status!=='void')&&(!retreat||waterfallMode)?.20:waterfallMode&&rolling&&!reduced?.65:1)-material.uniforms.brightness.value)*ease;
  if(retreat){
   const u=THREE.MathUtils.clamp((now-revealJob.start)/revealJob.settle,0,1),e=u*u*(3-2*u);
   cameraPush=revealJob.push*(1-e);matrixAdvance=revealJob.matrixAdvance*(1-e);pushStrength=revealJob.pushStrength*(1-e);speed=THREE.MathUtils.lerp(revealJob.speed,.038,e);energy=revealJob.energy*(1-e);
   // At most one new winner is rasterized and uploaded in each frame.
   const next=revealJob.queue.shift();if(next)prepareWinner(next.index,next.r);
  }else{
   matrixAdvance+=((matrixMode&&rolling&&!reduced?2.4:0)-matrixAdvance)*ease;
   const targetPush=rolling&&!reduced&&!matrixMode&&!waveMode&&!corridorMode&&!waterfallMode?1:0;cameraPush+=(targetPush-cameraPush)*(1-Math.exp(-dt*2.3));
   speed+=((rolling?(reduced?.12:1.8):.038+Math.sin(t*.23)*.012*idleBlend)-speed)*ease;energy+=((rolling?1:0)-energy)*ease;
  }
  if(revealJob&&!retreat){cameraPush=0;matrixAdvance=0;pushStrength=0;}
  camera.position.z=THREE.MathUtils.lerp(baseCameraZ,layout.radius*1.55+.3,cameraPush);camera.fov=40+20*cameraPush;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);cluster.position.y=baseCenterY*(1-cameraPush);cluster.position.z=matrixMode?matrixAdvance:0;
  cosmicCamera.aspect=camera.aspect;cosmicCamera.position.z=baseCameraZ;cosmicCamera.updateProjectionMatrix();
  cosmos.update(t,{focal:stage.clientHeight/(2*Math.tan(THREE.MathUtils.degToRad(20))),energy:0,dim:waterfallMode?.8+material.uniforms.brightness.value*.2:1,reduced,customBackground:!!getState().customBackground});
  canvas.dataset.background=getState().customBackground?'custom':'cosmic';
  orbitMeteors.update(t,reduced||matrixMode||waveMode||corridorMode||waterfallMode?0:energy,layout.radius,cluster.position.y,stage.clientHeight/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))));
  const portraitInterval=(matrixMode||waveMode)&&rolling&&!reduced?PORTRAIT_ROLLING_INTERVAL:PORTRAIT_INTERVAL;
  const portraitActive=(!matrixMode&&!waveMode)||rolling||getState().phase==='idle'||!matrixMode&&resting;
  if(matrixMode&&!revealJob&&portraitActive)warmMatrixPortraits();
  if(!waterfallMode&&!corridorMode&&!revealJob&&portraitActive&&now-turnover>=portraitInterval){
   if(!waveMode)applyPortraitSlots(portraitQueue().advance({shuffleVisible:matrixMode&&rolling&&!reduced,isReady:id=>!matrixMode||((!avatar.isReady||avatar.isReady(portraitMap.get(id)))&&portraitTiles.prepared(portraitKey(portraitMap.get(id))))}));
   else if(reduced)applyPortraitSlots(wavePortraitRotation.advanceLayer(reducedRing++%STAR_WAVE_RINGS.length));
   turnover=now;
  }
  canvas.dataset.matrixAdvance=matrixMode?matrixAdvance.toFixed(4):'0';canvas.dataset.matrixMotion=matrixMode?pushStrength.toFixed(4):'0';
  if(!waterfallMode&&!corridorMode&&!revealing&&!matrixMode&&(!waveMode||!reduced&&waveActive&&!waveReset&&!revealJob))rotation+=speed*dt;cluster.rotation.y=matrixMode||waveMode||corridorMode||waterfallMode?0:rotation;
  waveContinuous+=((rolling?1:0)-waveContinuous)*ease;
  waveFlowSpeed+=((waveMode&&!reduced&&!revealJob&&!waveReset&&waveActive?(rolling?3.4:1):0)-waveFlowSpeed)*ease;
  if(waveMode&&!reduced&&!revealing){
   if(!waveReset&&waveActive){const previous=waveTime;waveTime+=dt*waveFlowSpeed;waveDistance+=starWaveStep(previous,waveTime,waveContinuous);}
   waveSpinTime+=dt*(1+energy*.7);
  }
  waveEffects.update(dt,{enabled:waveMode&&!reduced,active:waveActive&&!waveReset&&!revealJob,energy,quality:idleQuality,view:waveView});
  waterfall.update(dt,{phase:getState().phase,reduced,drawCount:getState().drawCount??0,people:visiblePeople,revealPhase:revealJob?.phase??null},indices=>{
   let ids;for(const index of indices)ids=waterfallPortraitRotation.advanceLayer(index);
   if(ids)applyPortraitSlots(ids);
  });
  if(waterfallMode)cluster.position.z=waterfall.advance;
  canvas.dataset.waterfallHunters=JSON.stringify(waterfall.huntState);
  canvas.dataset.waterfallAdvance=waterfallMode?waterfall.advance.toFixed(4):'0';
  canvas.dataset.waterfallSpeed=waterfall.velocity.toFixed(4);canvas.dataset.waterfallPhysics=String(waterfall.ready);canvas.dataset.waterfallContacts=String(waterfall.stats.bodyContacts??0);
  corridor.update(dt,now,{phase:getState().phase,reduced,revealing:!!revealJob},column=>applyPortraitSlots(corridorPortraitRotation.advanceLayer(column)));
  corridorRobot.update(dt,{rolling,reduced,revealing:!!revealJob},count=>corridor.gatherSources(visiblePeople,count));
  canvas.dataset.corridorRobot=JSON.stringify(corridorRobot.state);
  canvas.dataset.corridorTravel=corridor.travel.toFixed(4);canvas.dataset.corridorResetting=String(corridor.resetting);
  const waveTravel=waveDistance,waveLayers=waveMode?STAR_WAVE_RINGS.map(r=>starWaveLayer(r.layer,waveTravel)):[];
  if(waveMode)for(let layer=0;layer<waveLayers.length;layer++){
   if(waveLayers[layer].generation!==waveGenerations[layer]){
    applyPortraitSlots(wavePortraitRotation.advanceLayer(layer));waveGenerations[layer]=waveLayers[layer].generation;
   }
  }
  canvas.dataset.waveCycle=waveMode?String(Math.floor(waveTravel)):'0';canvas.dataset.waveContinuous=waveMode?waveContinuous.toFixed(4):'0';
  cluster.rotation.x=0;
  radius+=(layout.radius-radius)*(1-Math.exp(-dt*5));const spread=radius*(1+.055*energy);orbit.scale.setScalar(spread);
  const departures=new Set(revealing?revealJob.pending.filter(({r})=>!arrivals.get(r.id)?.robot).map(({r})=>arrivals.get(r.id)?.index):[]);
  const sweep=new THREE.Vector3(Math.sin(t*.9)*.6,Math.cos(t*.7)*.38,1).normalize(),cs=Math.cos(rotation),sn=Math.sin(rotation);
  const pinnedPositions=[];let restDepth=0;
  for(let i=0;i<displayCount();i++){const p=matrixMode?matrix.points[i]:points[i],wx=p.x*cs+p.z*sn,wz=-p.x*sn+p.z*cs;
   geo.attributes.avatarGlow.setXYZW(i,0,0,0,0);
   geo.attributes.pinnedWinner.array[i]=matrixMode&&matrixPins.has(i)?1:0;
   if(!matrixMode&&departures.has(i)){dummy.scale.setScalar(0);dummy.updateMatrix();cubes.setMatrixAt(i,dummy.matrix);continue;}
   const mp=matrix.points[i];
   const scanX=Math.sin(t*2.4)*matrix.width*.5,scanY=Math.cos(t*1.7)*matrix.height*.5;
   let spotlight=matrixMode?(reduced?0:energy*Math.max(Math.exp(-Math.pow((mp.x-scanX)/.85,2)),.7*Math.exp(-Math.pow((mp.y-scanY)/.7,2)))):energy*Math.pow(Math.max(0,wx*sweep.x+p.y*sweep.y+wz*sweep.z),36);
   const idleWave=matrixMode&&idleBlend>.001?matrixIdleWave(mp.x,mp.y,matrix.width,t):0;
   spotlight+=idleBlend*(matrixMode?idleWave*.8:sphereIdleLight(p.y,wz,t));
   geo.attributes.spotlight.array[i]=spotlight;dummy.position.set(p.x*spread,p.y*spread,p.z*spread);
   const motion=reduced?0:t*.15;dummy.rotation.set(motion*(.4+i%7*.08)+i,motion*(.7+i%5*.06)+i*.6,motion*.35+i*.23);
   dummy.scale.setScalar(1+spotlight*.10);
   if(matrixMode){
    const pin=matrixPins.get(i);
    dummy.position.set(mp.x,mp.y,pin?pin.depth-matrixAdvance:reduced?0:matrixPushDepth(pushTime,pushSeeds[i])*pushStrength*(1-idleBlend*.45)+idleWave*idleBlend*1.35);
    if(pin){geo.attributes.spotlight.array[i]=.8;pinnedPositions.push({id:pin.awardId,index:i,z:dummy.position.z+matrixAdvance});}
    else restDepth=Math.max(restDepth,Math.abs(dummy.position.z));
    dummy.rotation.set(0,0,0);
    dummy.scale.set(1,1,MATRIX_BOX_DEPTH);
   }
   if(waveMode){
    const layer=waveLayers[waveSlots[i].layer];starWavePosition(waveSlots[i],rotation,layer,waveView,dummy.position);
    if(waveReset)dummy.position.lerpVectors(waveReset.origins[i].position,dummy.position,resetEase);
    const depth=camera.position.z-dummy.position.z,screenScale=waveView.focal/depth;
    waveVisible[i]=layer.scale>.8&&Math.abs(dummy.position.x*screenScale)<stage.clientWidth/2-25&&Math.abs((dummy.position.y+cluster.position.y)*screenScale)<stage.clientHeight/2-25?1:0;
    // Like the planet cubes, each avatar rotates independently on all three axes.
    dummy.rotation.set(
     reduced?0:waveSpinTime*(.19+(i%5)*.014)+i*.73,
     reduced?0:waveSpinTime*(.27+(i%7)*.016)+i*2.399963,
     reduced?0:waveSpinTime*(.13+(i%3)*.018)+i*.41);
    dummy.scale.setScalar(waveReset?THREE.MathUtils.lerp(waveReset.origins[i].scale,starWaveBoxScale(layer.age)*layer.scale,resetEase):starWaveBoxScale(layer.age)*layer.scale);
    geo.attributes.spotlight.array[i]=0;
   }
   if(corridorMode){corridor.apply(i,dummy);if(corridorRobot.hideWall(i))dummy.scale.setScalar(0);geo.attributes.spotlight.array[i]=0;}
   if(waterfallMode){waterfall.apply(i,dummy);geo.attributes.spotlight.array[i]=waterfall.spotlight(i);geo.attributes.pinnedWinner.array[i]=waterfall.emphasis(i);waterfall.writeGlow(i,geo.attributes.avatarGlow);}
   dummy.updateMatrix();cubes.setMatrixAt(i,dummy.matrix);
  }
  canvas.dataset.matrixWinners=JSON.stringify(pinnedPositions);canvas.dataset.matrixRestDepth=restDepth.toFixed(4);
  geo.attributes.pinnedWinner.needsUpdate=true;geo.attributes.avatarGlow.needsUpdate=true;
  if(retreat&&now-revealJob.start>=revealJob.settle&&!revealJob.queue.length)launchWinners(now);
  if(revealJob?.phase==='highlight'&&now>=revealJob.flightStart)revealJob.phase='flying';
  canvas.dataset.revealPhase=revealJob?.phase||'idle';canvas.dataset.cameraPush=cameraPush.toFixed(6);
  cubes.count=displayCount();cubes.instanceMatrix.needsUpdate=true;geo.attributes.spotlight.needsUpdate=true;
  const anchors=winnerLayout(stage.clientWidth,stage.clientHeight,resultRecords.length,0),focal=stage.clientHeight/(2*Math.tan(THREE.MathUtils.degToRad(20)));
  let flyingCount=0;winnerSlots.forEach(slot=>slot.mesh.visible=false);trails.forEach(trail=>trail.hide());
  for(let i=0;i<resultRecords.length;i++){
   const r=resultRecords[i];if(r.status==='void')continue;const anchor=anchors[i],arrival=arrivals.get(r.id);if(!arrival)continue;
   const target=new THREE.Vector3(anchor.x-stage.clientWidth/2,stage.clientHeight/2-anchor.y,0);
   const projected=arrival.screenOrigin,origin=new THREE.Vector3(projected.x*stage.clientWidth/2,projected.y*stage.clientHeight/2,0);
   const lift=arrival.waterfall&&arrival.highlightStart!=null?THREE.MathUtils.smoothstep(now,arrival.highlightStart,arrival.start):0;
   const startScale=arrival.sourceSize*stage.clientHeight*(1+lift*(arrival.waterfall?2/arrival.waterfallScale-1:.18));
   if(arrival.start!==null&&now>=arrival.start&&now<arrival.start+1600)flyingCount++;
   const progress=arrival.start===null?1:THREE.MathUtils.clamp((now-arrival.start)/1600,0,1),eased=progress*progress*(3-2*progress);
   const control=origin.clone().lerp(target,.5);control.y+=Math.min(160,stage.clientHeight*.16);control.x+=(i-(resultRecords.length-1)/2)*24;
   const curve=new THREE.QuadraticBezierCurve3(origin,control,target);
   flyDummy.position.copy(curve.getPoint(eased));
   if(arrival.start!==null&&!reduced)trails[i].update(curve,(now-arrival.start)/1000,1.6);
   // Finish at zero rotation under orthographic projection, including outermost winners.
   flyDummy.quaternion.copy(arrival.orientation).slerp(new THREE.Quaternion(),eased);
   const scale=anchor.size/CUBE_SIDE;
   flyDummy.scale.setScalar(THREE.MathUtils.lerp(startScale,scale,eased));flyDummy.scale.z*=THREE.MathUtils.lerp(arrival.sourceDepth??1,matrixMode?MATRIX_BOX_DEPTH:waveMode?STAR_WAVE_CARD_DEPTH:1,eased);if(matrixMode)flyDummy.position.z=-CUBE_SIDE*flyDummy.scale.z/2;flyDummy.updateMatrix();const slot=winnerSlots[i];slot.mesh.setMatrixAt(0,flyDummy.matrix);slot.mesh.visible=true;slot.mesh.instanceMatrix.needsUpdate=true;
   const replacementReveal=revealJob?.pending.some(({r})=>!!r.replaces),isNew=revealJob?.pending.some(({r:pending})=>pending.id===r.id);
   const dimmed=rolling||(replacementReveal&&!isNew);slot.mesh.material.uniforms.opacity.value=dimmed?.3:1;slot.mesh.material.uniforms.frontOnly.value=matrixMode?1:0;slot.mesh.material.depthWrite=matrixMode;
   slot.geo.attributes.spotlight.array[0]=.4;slot.geo.attributes.spotlight.needsUpdate=true;
  }
  canvas.dataset.flyingCount=String(flyingCount);canvas.dataset.winnerDepth=String(matrixMode?MATRIX_BOX_DEPTH:waveMode?STAR_WAVE_CARD_DEPTH:1);
  if(revealJob&&now>=revealJob.end){completed=revealJob.onComplete;revealJob=null;turnover=now;canvas.dataset.revealPhase='idle';}
  renderer.clear();renderer.render(cosmicScene,cosmicCamera);renderer.clearDepth();renderer.render(scene,camera);resultRenderer.render(resultScene,resultCamera);completed?.();
 }
 requestAnimationFrame(frame);
 resultCanvas.addEventListener('webglcontextlost',e=>{e.preventDefault();active=false;notify('图形显示已中断，请刷新恢复活动进度');});resultCanvas.addEventListener('webglcontextrestored',()=>location.reload());
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();active=false;notify('图形显示已中断，请刷新恢复活动进度');});canvas.addEventListener('webglcontextrestored',()=>location.reload());
 // Compile even currently hidden effects before enabling the first draw.
 const ready=Promise.all([renderer.compileAsync(scene,camera),renderer.compileAsync(cosmicScene,cosmicCamera),resultRenderer.compileAsync(resultScene,resultCamera)]);
 return {ready,refreshPortraits(urls=null){corridorRobot.refreshPortraits(urls);paintVisiblePortraits(urls);resultRecords.forEach((record,index)=>{if(record.status!=='void'&&(urls===null||urls.has(record.person?.avatarUrl)))prepareWinner(index,record,true);});},setPopulation(n){population=n;refreshPeople();},syncWinners,
  reveal,

 };
}
