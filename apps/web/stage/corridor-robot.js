import * as THREE from 'three';

export const ROBOT_COUNT=24;
export const ROBOT_GATHER_SECONDS=1.15;
export const ROBOT_RUN_SECONDS=2.4;
const clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{const u=clamp(x);return u*u*(3-2*u);};

// Presentation only. The separate rolling-avatar chest is not a winner source.
export function robotWinnerSources(people,records,random=Math.random){
 const used=new Set(),matches=records.map(r=>{
  const id=r.participant_id??r.person?.id;
  const i=people.findIndex((p,j)=>!used.has(j)&&(typeof r.person==='number'?p===r.person:id!=null&&p?.id===id));
  if(i>=0)used.add(i);return i;
 });
 const pool=Array.from({length:ROBOT_COUNT},(_,i)=>i).filter(i=>!used.has(i));
 for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 return matches.map(i=>i>=0?i:pool.pop());
}

export function createCorridorRobot(parent,{geometry,material,avatar,brandLogo,getParticipants=()=>[],random=Math.random}){
 const group=new THREE.Group();group.name='corridor-robot';group.visible=false;parent.add(group);
 const atlas=document.createElement('canvas');atlas.width=atlas.height=640;const context=atlas.getContext('2d',{willReadFrequently:true});
 const texture=new THREE.CanvasTexture(atlas);texture.colorSpace=THREE.SRGBColorSpace;
 const mat=material.clone();mat.uniforms.atlas.value=texture;mat.uniforms.grid.value=5;
 mat.uniforms.brightness.value=1;mat.uniforms.frontOnly.value=0;mat.transparent=true;
 const geo=geometry(.6,ROBOT_COUNT);for(let i=0;i<ROBOT_COUNT;i++)geo.attributes.avatarIndex.setX(i,i);
 const mesh=new THREE.InstancedMesh(geo,mat,ROBOT_COUNT);mesh.name='robot-avatar-body';mesh.frustumCulled=false;
 mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(mesh);

 const logoCanvas=document.createElement('canvas');logoCanvas.width=logoCanvas.height=256;
 const logoTexture=new THREE.CanvasTexture(logoCanvas);logoTexture.colorSpace=THREE.SRGBColorSpace;
 const sideMaterial=new THREE.MeshBasicMaterial({color:'#65788e',transparent:true});
 const logoMaterial=new THREE.MeshBasicMaterial({map:logoTexture,transparent:true});
 const chest=new THREE.Mesh(new THREE.BoxGeometry(1.8,1.8,1.8),[sideMaterial,sideMaterial,sideMaterial,sideMaterial,logoMaterial,sideMaterial]);
 chest.name='robot-avatar-chest';chest.matrixAutoUpdate=false;group.add(chest);
 let chestQueue=[],chestCursor=0,chestElapsed=0,chestPerson=null,chestChanges=0,chestPortraitReady=false;const portraitReady=[];
 function refreshLogo(){
  const ctx=logoCanvas.getContext('2d',{willReadFrequently:true}),source=chestPerson==null?brandLogo(256,true):avatar(chestPerson,256);
  ctx.clearRect(0,0,256,256);ctx.drawImage(source,0,0,256,256);logoTexture.needsUpdate=true;chestPortraitReady=avatar.isReady?.(chestPerson)??true;
 }
 function nextChestPortrait(){
  if(chestCursor>=chestQueue.length){
   chestQueue=[...getParticipants()];chestCursor=0;
   for(let i=chestQueue.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[chestQueue[i],chestQueue[j]]=[chestQueue[j],chestQueue[i]];}
   if(chestQueue.length>1&&chestQueue[0]===chestPerson)[chestQueue[0],chestQueue[1]]=[chestQueue[1],chestQueue[0]];
  }
  chestPerson=chestQueue[chestCursor++]??null;
  avatar.preload?.(chestQueue.slice(chestCursor,chestCursor+8));
  chestChanges++;refreshLogo();
 }

 // A tiny joint hierarchy drives the 24 instanced boxes; no skinned model or physics.
 const rig=new THREE.Object3D(),torso=new THREE.Object3D();rig.add(torso);
 const parts=[],shoulders=[],arms=[],elbows=[],thighs=[],knees=[],feet=[],chestPose=new THREE.Object3D();chestPose.position.set(0,1.65,.12);torso.add(chestPose);
 function part(bone,x,y,z=0){const p=new THREE.Object3D();p.position.set(x,y,z);p.scale.setScalar(1.7);bone.add(p);parts.push(p);return p;}
 for(const x of [-.53,.53])for(const y of [3.2,4.26])part(torso,x,y);
 for(const side of [-1,1])shoulders.push(part(torso,side*1.55,2));
 for(const side of [-1,1])part(torso,side*.55,0);
 for(const side of [-1,1]){
  const arm=new THREE.Object3D();arm.position.set(side*2.05,1.8,0);torso.add(arm);arms.push(arm);
  part(arm,0,-.55);
  const elbow=new THREE.Object3D();elbow.position.y=-1.1;arm.add(elbow);elbows.push(elbow);
  part(elbow,0,-.5);part(elbow,0,-1.55);
 }
 for(const side of [-1,1]){
  const thigh=new THREE.Object3D(),knee=new THREE.Object3D();thigh.position.set(side*.65,-.55,0);rig.add(thigh);thighs.push(thigh);
  part(thigh,0,-.55);part(thigh,0,-1.6);knee.position.y=-2.1;thigh.add(knee);knees.push(knee);
  part(knee,0,-.55);part(knee,0,-1.6);feet.push(part(knee,0,-2.35,.45));
 }
 // One colorful square ripple per footfall, reused in a fixed instance pool.
 const printCount=12,printLife=1.05,printGeometry=new THREE.PlaneGeometry(1.8,1.8);
 const printFade=new THREE.InstancedBufferAttribute(new Float32Array(printCount),1);printFade.setUsage(THREE.DynamicDrawUsage);printGeometry.setAttribute('stampFade',printFade);
 const printWave=new THREE.InstancedBufferAttribute(new Float32Array(printCount*2),2);printWave.setUsage(THREE.DynamicDrawUsage);printGeometry.setAttribute('stampWave',printWave);
 const printMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,
  vertexShader:`attribute float stampFade;attribute vec2 stampWave;varying vec2 vUv;varying vec2 vWave;varying float vFade;void main(){vUv=uv;vFade=stampFade;vWave=stampWave;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
  fragmentShader:`varying vec2 vUv;varying vec2 vWave;varying float vFade;void main(){vec2 p=abs(vUv-.5);float d=max(p.x,p.y);float edge=abs(d-.33);float ring=1.-smoothstep(.012,.038,edge);float glow=exp(-edge*edge/ .003)*.3;float imprint=(1.-smoothstep(.30,.34,d))*exp(-vWave.x*16.);vec3 color=.55+.45*cos(6.283185*(vWave.y+vUv.x*.32+vUv.y*.2+vWave.x*.12+vec3(0.,.67,.33)));gl_FragColor=vec4(color,(ring+glow+imprint*.55)*vFade);}`
 });
 const prints=new THREE.InstancedMesh(printGeometry,printMaterial,printCount);prints.name='robot-footprints';prints.frustumCulled=false;prints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(prints);
 const stamps=Array.from({length:printCount},()=>({age:printLife,foot:-1,hue:0,position:new THREE.Vector3()})),stampPose=new THREE.Object3D();
 let nextStamp=0,footfallCount=0,lastStride=0;
 function clearPrints(){nextStamp=0;footfallCount=0;lastStride=0;stamps.forEach(s=>s.age=printLife);printFade.array.fill(0);printFade.needsUpdate=true;prints.visible=false;}
 function footfall(foot){
  const stamp=stamps[nextStamp];nextStamp=(nextStamp+1)%printCount;footfallCount++;stamp.age=0;stamp.foot=foot;stamp.hue=random();
  stamp.position.setFromMatrixPosition(feet[foot].matrixWorld);stamp.position.y-=.57;
 }
 function updatePrints(dt){
  let live=0;
  stamps.forEach((stamp,i)=>{
   stamp.age=Math.min(printLife,stamp.age+dt);const life=stamp.age/printLife,visible=life<1;
   printFade.setX(i,visible?1-smooth(life):0);if(!visible)return;live++;
   printWave.setXY(i,life,stamp.hue);
   stampPose.position.copy(stamp.position);stampPose.rotation.set(-Math.PI/2,0,0);stampPose.scale.setScalar(1+life*1.8);stampPose.updateMatrix();prints.setMatrixAt(i,stampPose.matrix);
  });
  prints.visible=live>0;printFade.needsUpdate=true;printWave.needsUpdate=true;if(live)prints.instanceMatrix.needsUpdate=true;
 }
 const pose=()=>({position:new THREE.Vector3(),rotation:new THREE.Quaternion(),scale:new THREE.Vector3()});
 const origins=Array.from({length:ROBOT_COUNT},pose),frozen=Array.from({length:ROBOT_COUNT},pose);
 const scatter=Array.from({length:ROBOT_COUNT},()=>({velocity:new THREE.Vector3(),spin:new THREE.Vector3()}));
 const matrix=new THREE.Matrix4(),dummy=new THREE.Object3D(),target=pose(),chestFrozen=pose();
 const selected=new Set();let enabled=false,wasRolling=false,mode='hidden',age=0,burstAge=0,holdAge=0,people=[],wallIndices=[],view=null;
 function clear(){mode='hidden';age=0;burstAge=0;people=[];wallIndices=[];selected.clear();group.visible=false;wasRolling=false;clearPrints();chestQueue=[];chestCursor=0;chestElapsed=0;chestPerson=null;chestChanges=0;}
 function start(sources){
  if(sources.length<ROBOT_COUNT)return;
  age=0;burstAge=0;mode='gathering';selected.clear();clearPrints();group.visible=true;mesh.visible=true;chest.visible=true;
  mat.uniforms.opacity.value=1;logoMaterial.opacity=sideMaterial.opacity=1;
  people=sources.map(s=>s.person);wallIndices=sources.map(s=>s.index);
  context.clearRect(0,0,640,640);
  sources.forEach((source,i)=>{
   source.matrix.decompose(origins[i].position,origins[i].rotation,origins[i].scale);
   mesh.setMatrixAt(i,source.matrix);
   context.drawImage(source.person==null?brandLogo():avatar(source.person,128),i%5*128,Math.floor(i/5)*128,128,128);
   portraitReady[i]=avatar.isReady?.(source.person)??true;
   const side=i%2?-1:1;
   scatter[i].velocity.set(side*(4+random()*5),(random()-.3)*5,2+random()*6);
   scatter[i].spin.set((random()-.5)*5,(random()-.5)*5,(random()-.5)*5);
  });
  texture.needsUpdate=true;mesh.instanceMatrix.needsUpdate=true;chestQueue=[];chestCursor=0;chestElapsed=0;chestChanges=0;nextChestPortrait();
 }
 function stop(){
  if(mode!=='gathering'&&mode!=='running')return mode==='holding';
  for(let i=0;i<ROBOT_COUNT;i++){mesh.getMatrixAt(i,matrix);matrix.decompose(frozen[i].position,frozen[i].rotation,frozen[i].scale);}
  chest.matrix.decompose(chestFrozen.position,chestFrozen.rotation,chestFrozen.scale);holdAge=0;mode='holding';return true;
 }
 function explode(indices){
  if(mode!=='holding')return;
  selected.clear();indices.forEach(i=>selected.add(i));burstAge=0;mode='burst';
 }
 function runningPose(){
  const progress=smooth((age-ROBOT_GATHER_SECONDS)/ROBOT_RUN_SECONDS),stride=Math.max(0,age-ROBOT_GATHER_SECONDS)*9;
  const distance=Math.max(15,view.focal*11/Math.max(200,view.height-290),view.focal*6/Math.max(200,view.width*.5));
  rig.position.set(Math.sin(stride*.5)*.12,.25+Math.abs(Math.sin(stride))*.18,view.cameraZ-distance-(1-progress)*42);
  rig.rotation.set(-.045,Math.sin(stride)*.07,Math.sin(stride)*.025);torso.rotation.y=Math.sin(stride)*.09;
  arms.forEach((arm,i)=>{
   const swing=Math.sin(stride+i*Math.PI);arm.rotation.set(swing*.8-.15,0,i===0?-.10:.10);
   shoulders[i].rotation.x=arm.rotation.x*.65;
   elbows[i].rotation.x=-.85+swing*.30;
  });
  thighs.forEach((thigh,i)=>{const swing=Math.sin(stride+i*Math.PI);thigh.rotation.x=-swing*.72;knees[i].rotation.x=.18+Math.max(0,swing)*1.1;});
  rig.updateMatrixWorld(true);
  for(let i=0;i<2;i++){
   const offset=i*Math.PI-Math.PI;
   if(Math.floor((stride+offset)/(2*Math.PI))>Math.floor((lastStride+offset)/(2*Math.PI)))footfall(i);
  }
  lastStride=stride;
 }
 return {
  resize(next){view=next;},refreshLogo,stop,explode,
  refreshPortraits(urls=null){
   if(!group.visible)return;
   const brandChanged=urls===null||brandLogo.changed?.(urls)||urls.has(brandLogo.url?.());
   if(urls===null||urls.has(chestPerson?.avatarUrl)||brandChanged&&(chestPerson==null||!chestPortraitReady||avatar.usesBrand?.(chestPerson)))refreshLogo();
   let changed=false;
   people.forEach((person,i)=>{if(urls!==null&&!urls.has(person?.avatarUrl)&&!(brandChanged&&(person==null||!portraitReady[i]||avatar.usesBrand?.(person))))return;context.drawImage(person==null?brandLogo():avatar(person,128),i%5*128,Math.floor(i/5)*128,128,128);portraitReady[i]=avatar.isReady?.(person)??true;changed=true;});
   if(changed)texture.needsUpdate=true;
  },
  setEnabled(value){if(enabled!==value)clear();enabled=value;},
  update(dt,{rolling,reduced,revealing},getSources){
   if(!enabled||reduced){if(mode!=='hidden')clear();return;}
   if(rolling&&!wasRolling)start(getSources(ROBOT_COUNT));
   if(!rolling&&wasRolling)stop();wasRolling=rolling;
   if(mode==='hidden')return;
   updatePrints(dt);
   if(mode==='holding'){holdAge+=dt;if(!revealing&&holdAge>.6)explode([]);else return;}
   if(mode==='burst'){
    burstAge+=dt;const fade=1-smooth((burstAge-.25)/.8);
    for(let i=0;i<ROBOT_COUNT;i++){
     const p=frozen[i],flight=scatter[i];dummy.position.copy(p.position).addScaledVector(flight.velocity,burstAge);dummy.position.y-=burstAge*burstAge*1.4;
     dummy.quaternion.copy(p.rotation);dummy.rotateX(flight.spin.x*burstAge);dummy.rotateY(flight.spin.y*burstAge);dummy.rotateZ(flight.spin.z*burstAge);
     dummy.scale.copy(p.scale).multiplyScalar(selected.has(i)?0:1-smooth(burstAge/1.2)*.45);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
    }
    mat.uniforms.opacity.value=fade;
    dummy.position.copy(chestFrozen.position);dummy.position.y+=Math.max(0,burstAge-.18)*.65;dummy.quaternion.copy(chestFrozen.rotation);dummy.scale.copy(chestFrozen.scale);dummy.updateMatrix();chest.matrix.copy(dummy.matrix);
    logoMaterial.opacity=sideMaterial.opacity=1-smooth((burstAge-.18)/.85);
    mesh.instanceMatrix.needsUpdate=true;if(burstAge>=1.2){mode='hidden';group.visible=false;wallIndices=[];}return;
   }
   chestElapsed+=dt;if(chestElapsed>=.09){chestElapsed%=.09;nextChestPortrait();}
   age+=dt;runningPose();
   for(let i=0;i<ROBOT_COUNT;i++){
    parts[i].matrixWorld.decompose(target.position,target.rotation,target.scale);
    const u=smooth((age-i*.012)/(.85)),from=origins[i];
    dummy.position.lerpVectors(from.position,target.position,u);dummy.position.y+=Math.sin(u*Math.PI)*(1.2+i%3*.4);
    dummy.quaternion.slerpQuaternions(from.rotation,target.rotation,u);dummy.scale.lerpVectors(from.scale,target.scale,u);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
   }
   chestPose.matrixWorld.decompose(target.position,target.rotation,target.scale);
   dummy.position.copy(target.position);dummy.quaternion.copy(target.rotation);dummy.scale.copy(target.scale).multiplyScalar(smooth((age-.35)/.55));dummy.updateMatrix();chest.matrix.copy(dummy.matrix);
   mesh.instanceMatrix.needsUpdate=true;if(age>=ROBOT_GATHER_SECONDS)mode='running';
  },
  hideWall(index){return mode==='gathering'&&age<.85&&wallIndices.includes(index);},
  flightSources(records){return robotWinnerSources(people,records,random);},
  flightMatrix(index,out){const p=frozen[index];return out.compose(p.position,p.rotation,p.scale);},
  get ready(){return mode==='holding';},
  get state(){return {mode,age,count:ROBOT_COUNT,wallIndices:[...wallIndices],chestIsWinner:false,chestPerson:chestPerson?.id??chestPerson,chestPopulation:chestQueue.length,chestChanges,selected:[...selected],elbowAngles:elbows.map(e=>e.rotation.x),footfallCount,footprints:stamps.filter(s=>s.age<printLife).map(s=>({foot:s.foot,age:s.age,position:s.position.toArray()}))};}
 };
}
