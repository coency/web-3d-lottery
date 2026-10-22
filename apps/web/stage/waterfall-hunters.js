import * as THREE from 'three';
export const WATERFALL_LIGHT_COLORS=['#ffd16a','#8edbff','#dab2ff','#a5ffe0','#ffba8d'];

// One reusable light per draw slot. Only attached lights request a larger collider.
export function createWaterfallHunters(parent,material,{candidates,anchor,available=()=>true,eligible=null,random=Math.random}){
 const tail=10,capacity=10,points=new Float32Array(capacity*tail*3),alpha=new Float32Array(capacity*tail),sizes=new Float32Array(capacity*tail),colors=new Float32Array(capacity*tail*3);
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(points,3).setUsage(THREE.DynamicDrawUsage));
 geometry.setAttribute('alpha',new THREE.BufferAttribute(alpha,1).setUsage(THREE.DynamicDrawUsage));
 geometry.setAttribute('size',new THREE.BufferAttribute(sizes,1));
 geometry.setAttribute('tint',new THREE.BufferAttribute(colors,3));
 for(let i=0;i<capacity;i++)for(let k=0;k<tail;k++){
  const index=i*tail+k;sizes[index]=k===0?1.15:.36*(1-k/tail);
  new THREE.Color(WATERFALL_LIGHT_COLORS[i%WATERFALL_LIGHT_COLORS.length]).toArray(colors,index*3);
 }
 const lightMaterial=material.clone();lightMaterial.uniforms=material.uniforms;
 lightMaterial.vertexShader=material.vertexShader.replace('gl_PointSize=size*focal/max(.1,-p.z)*pixelRatio;', 'float pixels=size*focal/max(.1,-p.z);gl_PointSize=(size>.8?clamp(pixels,30.,58.):pixels)*pixelRatio;');
 lightMaterial.fragmentShader='varying vec3 color;varying float opacity;void main(){float r=length(gl_PointCoord-.5)*2.;float core=1.-smoothstep(.06,.28,r);float halo=exp(-r*r*3.)*(1.-smoothstep(.65,1.,r));gl_FragColor=vec4(mix(color,vec3(1.),core*.9),max(core,halo)*opacity);}';
 const mesh=new THREE.Points(geometry,lightMaterial);mesh.frustumCulled=false;mesh.renderOrder=2;parent.add(mesh);
 const actors=[];let locked=false,fade=1,chasePair=null,chaseClock=0,nextChase=8;
 function actor(){return {target:-1,age:0,jump:.5,hold:1,chase:null,from:new THREE.Vector3(),point:new THREE.Vector3(),history:[],visible:false};}
 function cancelChase(){
  if(!chasePair)return;
  for(const a of chasePair){if(a.chase&&a.age<a.jump){a.from.copy(a.point);a.age=0;a.jump=.5;}a.chase=null;}
  chasePair=null;
 }
 function reset(){actors.length=0;locked=false;fade=1;chasePair=null;chaseClock=0;nextChase=8;alpha.fill(0);mesh.visible=false;}
 function lock(indices){
  cancelChase();
  while(actors.length<indices.length)actors.push(actor());actors.length=indices.length;
  actors.forEach((a,i)=>{a.from.copy(a.point);a.target=indices[i];a.age=0;a.jump=.24;a.hold=Infinity;if(!a.visible)a.from.copy(anchor(a.target));a.visible=true;});locked=true;fade=1;
 }
 function update(dt,{rolling,count,reduced,phase}){
  if(reduced||(!rolling&&!phase)){reset();return;}
  if(rolling){if(actors.length!==Math.min(capacity,count))cancelChase();locked=false;fade=1;while(actors.length<count)actors.push(actor());actors.length=Math.min(capacity,count);chaseClock+=dt;}
  if(phase==='flying')fade=Math.max(0,fade-dt*6);
  const pool=rolling?candidates():[],valid=new Set(pool),used=new Set(actors.filter(a=>a.target>=0).map(a=>a.target));
  const isEligible=index=>eligible?eligible(index):valid.has(index);
  if(chasePair&&(chasePair.every(a=>a.age>=a.jump)||rolling&&chasePair.some(a=>!isEligible(a.target))))cancelChase();
  for(const a of actors){
   a.age+=dt;
   if(rolling&&(a.target<0||!isEligible(a.target)||a.age>a.jump+a.hold)){
    const previous=a.target;used.delete(previous);
    const choices=pool.filter(i=>!used.has(i)&&i!==previous);
    a.target=-1;
    while(choices.length){const at=Math.floor(random()*choices.length),candidate=choices.splice(at,1)[0];if(available(candidate)){a.target=candidate;break;}}
    if(a.target>=0){if(!a.visible)a.point.copy(anchor(a.target));a.from.copy(a.point);a.age=0;a.jump=.45+random()*.15;a.hold=.9+random()*.3;a.visible=true;used.add(a.target);}else a.visible=false;
   }
  }
  // Pair only lights already in transit: never shorten an avatar's illuminated dwell.
  if(rolling&&!chasePair&&actors.length>=2&&chaseClock>=nextChase){
   const moving=actors.filter(a=>a.visible&&a.target>=0&&a.age<Math.min(.3,a.jump));
   if(moving.length>=2){
    const first=moving[Math.floor(random()*moving.length)],others=moving.filter(a=>a!==first);
    const second=others.reduce((a,b)=>a.point.distanceToSquared(first.point)<b.point.distanceToSquared(first.point)?a:b);
    const pair=[first,second],cross=new THREE.Vector3();
    for(const a of pair)cross.add(a.point).add(anchor(a.target));cross.multiplyScalar(.25);cross.y+=.7;
    const duration=.9+random()*.15;
    pair.forEach((a,i)=>{a.from.copy(a.point);a.age=0;a.jump=duration;a.chase={cross:cross.clone(),side:i===0?1:-1};});
    chasePair=pair;chaseClock=0;nextChase=8+random()*4;
   }
  }
  for(const a of actors){
   if(a.target<0)continue;
   const destination=anchor(a.target),u=Math.min(1,a.age/a.jump),ease=u*u*(3-2*u);
   if(a.chase&&u<1){
    const control=a.chase.cross.clone().multiplyScalar(2).addScaledVector(a.from,-.5).addScaledVector(destination,-.5);
    a.point.copy(a.from).multiplyScalar((1-ease)**2).addScaledVector(control,2*(1-ease)*ease).addScaledVector(destination,ease*ease);
    a.point.x+=Math.sin(ease*Math.PI*2)*.55*a.chase.side;
    a.point.z+=Math.sin(ease*Math.PI)*.55*a.chase.side;
   }else{a.point.copy(a.from).lerp(destination,ease);a.point.y+=Math.sin(u*Math.PI)*.8;}
   a.history.unshift(a.point.clone());if(a.history.length>tail)a.history.pop();
  }
  alpha.fill(0);
  actors.forEach((a,i)=>{if(!a.visible)return;for(let k=0;k<tail;k++){
   const index=i*tail+k,p=a.history[k]??a.point;p.toArray(points,index*3);
   alpha[index]=fade*(k===0?1:Math.pow(1-k/tail,1.5)*.9);
  }});
  mesh.visible=fade>0&&actors.some(a=>a.visible);geometry.attributes.position.needsUpdate=true;geometry.attributes.alpha.needsUpdate=true;
 }
 return {update,lock,reset,
  get highlights(){return actors.filter(a=>a.visible&&a.age>=a.jump).map(a=>a.target);},
  get illumination(){return actors.flatMap((a,i)=>a.visible&&a.age>=a.jump?[{target:a.target,color:WATERFALL_LIGHT_COLORS[i%WATERFALL_LIGHT_COLORS.length]}]:[]);},
  get targets(){return actors.filter(a=>a.visible).map(a=>a.target);},
  get state(){return actors.map(a=>({target:a.target,attached:a.visible&&a.age>=a.jump,visible:a.visible,locked,chasing:!!a.chase&&a.age<a.jump}));}
 };
}
