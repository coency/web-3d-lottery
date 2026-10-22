<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import * as THREE from 'three';
const host = ref<HTMLDivElement|null>(null);
const failed = ref(false);
const motion = ref('loading');
let cleanup = () => {};
onMounted(() => {
  const element = host.value!;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'}); }
  catch { failed.value=true;motion.value='fallback';return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.setClearColor(0x000000,0);
  element.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden','true');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42,1,0.1,30);
  camera.position.set(0,1.1,6.9);camera.lookAt(0,0,0);
  const world = new THREE.Group();world.position.y=-.30;scene.add(world);
  scene.add(new THREE.AmbientLight(0x8c7ac9,1.2));
  const purple = new THREE.DirectionalLight(0xb2a0ff,2.8);purple.position.set(-3,3,4);scene.add(purple);
  const gold = new THREE.DirectionalLight(0xffd58a,1.6);gold.position.set(3,1,2);scene.add(gold);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.08,64,40),
    new THREE.MeshPhongMaterial({color:0x272647,emissive:0x131025,shininess:65,specular:0x756497}));
  world.add(sphere);
  // An opaque sphere and depth-tested orbit objects provide real front/back occlusion.
  const grid = new THREE.Group();grid.rotation.z=0.2;world.add(grid);
  const gridMaterial = new THREE.LineBasicMaterial({color:0xada0e3,transparent:true,opacity:0.15,depthWrite:false});
  for(let row=-2;row<=2;row++){
    const latitude=row*0.39, y=Math.sin(latitude)*1.089, radius=Math.cos(latitude)*1.089;
    const points=Array.from({length:97},(_,i)=>new THREE.Vector3(radius*Math.cos(i/96*Math.PI*2),y,radius*Math.sin(i/96*Math.PI*2)));
    grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),gridMaterial));
  }
  for(let meridian=0;meridian<6;meridian++){
    const points=Array.from({length:97},(_,i)=>new THREE.Vector3(1.089*Math.cos(i/96*Math.PI*2),1.089*Math.sin(i/96*Math.PI*2),0));
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),gridMaterial);line.rotation.y=meridian*Math.PI/6;grid.add(line);
  }
  const textureCanvas=document.createElement('canvas');textureCanvas.width=128;textureCanvas.height=128;
  const ctx=textureCanvas.getContext('2d')!;
  const gradient=ctx.createRadialGradient(64,64,0,64,64,62);
  gradient.addColorStop(0,'rgba(255,241,190,1)');gradient.addColorStop(.15,'rgba(255,212,116,.7)');gradient.addColorStop(.48,'rgba(240,166,63,.14)');gradient.addColorStop(1,'rgba(240,166,63,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  ctx.fillStyle='#fff0b3';ctx.beginPath();ctx.moveTo(64,17);ctx.lineTo(71,57);ctx.lineTo(111,64);ctx.lineTo(71,71);ctx.lineTo(64,111);ctx.lineTo(57,71);ctx.lineTo(17,64);ctx.lineTo(57,57);ctx.closePath();ctx.fill();
  const starTexture=new THREE.CanvasTexture(textureCanvas);
  const starShape=new THREE.Shape();
  starShape.moveTo(0,.30);starShape.lineTo(.082,.082);starShape.lineTo(.30,0);starShape.lineTo(.082,-.082);
  starShape.lineTo(0,-.30);starShape.lineTo(-.082,-.082);starShape.lineTo(-.30,0);starShape.lineTo(-.082,.082);starShape.closePath();
  const emblem=new THREE.Mesh(new THREE.ExtrudeGeometry(starShape,{depth:.035,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.018,bevelThickness:.018}),
    new THREE.MeshPhongMaterial({color:0xe7c47f,emissive:0x493313,shininess:85}));
  emblem.position.set(0,.12,1.10);emblem.quaternion.copy(camera.quaternion);world.add(emblem);
  const starGeometry=new THREE.SphereGeometry(.043,12,10);
  const starMaterial=new THREE.MeshBasicMaterial({color:0xffda86});
  const satellites: {mesh:THREE.Mesh;glow:THREE.Sprite;angle:number;speed:number;radius:number;trail:THREE.Points;buffer:THREE.BufferAttribute}[]=[];
  const tilts=[[.26,0,.4],[.96,.12,-.60],[-.65,-.2,.82]];
  tilts.forEach((tilt,index)=>{
    const orbit=new THREE.Group();orbit.rotation.set(tilt[0]!,tilt[1]!,tilt[2]!);world.add(orbit);
    const radius=1.7+index*.20;
    const points=Array.from({length:181},(_,i)=>new THREE.Vector3(radius*Math.cos(i/180*Math.PI*2),0,radius*Math.sin(i/180*Math.PI*2)));
    orbit.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:index===1?0xccac70:0x9584c8,transparent:true,opacity:.45,depthWrite:false})));
    for(let j=0;j<2;j++){
      const mesh=new THREE.Mesh(starGeometry,starMaterial);orbit.add(mesh);
      const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:starTexture,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
      glow.scale.setScalar(j===0?.29:.21);orbit.add(glow);
      const array=new Float32Array(24*3),colors=new Float32Array(24*3);
      for(let k=0;k<24;k++){const fade=(1-k/24)*.6;colors.set([fade,fade*.72,fade*.35],k*3);}
      const geometry=new THREE.BufferGeometry();
      const buffer=new THREE.BufferAttribute(array,3);geometry.setAttribute('position',buffer);geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
      const trail=new THREE.Points(geometry,new THREE.PointsMaterial({size:.025,vertexColors:true,transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending}));orbit.add(trail);
      satellites.push({mesh,glow,angle:index*1.1+j*Math.PI,speed:.30+index*.055,radius,trail,buffer});
    }
  });
  const stars=new Float32Array(100*3);
  for(let i=0;i<100;i++){
    const angle=i*2.399963,r=1.9+(i%19)/19*1.1;
    stars.set([Math.cos(angle)*r,Math.sin(angle)*r*.82,-1.2-(i%13)/13*1.2],i*3);
  }
  const dustGeometry=new THREE.BufferGeometry();dustGeometry.setAttribute('position',new THREE.BufferAttribute(stars,3));
  world.add(new THREE.Points(dustGeometry,new THREE.PointsMaterial({color:0xc0afdf,size:.014,transparent:true,opacity:.48,depthWrite:false})));
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,previous=0,lastDraw=0,elapsed=0,disposed=false;
  let pointerX=0,pointerY=0;
  function draw(){
    satellites.forEach(star=>{
      const angle=star.angle+elapsed*star.speed;
      star.mesh.position.set(star.radius*Math.cos(angle),0,star.radius*Math.sin(angle));star.glow.position.copy(star.mesh.position);
      for(let k=0;k<24;k++){
        const tailAngle=angle-k*.018;
        star.buffer.setXYZ(k,star.radius*Math.cos(tailAngle),0,star.radius*Math.sin(tailAngle));
      }
      star.buffer.needsUpdate=true;
    });
    renderer.render(scene,camera);
  }
  function tick(time:number){
    if(disposed||failed.value)return;
    if(document.hidden||preference.matches){resume();return;}
    frame=requestAnimationFrame(tick);
    if(time-lastDraw<32)return;
    if(previous)elapsed+=Math.min((time-previous)/1000,.1);
    previous=time;lastDraw=time;
    world.rotation.y+=(pointerX-world.rotation.y)*.035;world.rotation.x+=(pointerY-world.rotation.x)*.035;
    draw();
  }
  function resume(){
    cancelAnimationFrame(frame);previous=0;
    if(failed.value||disposed)return;
    motion.value=preference.matches?'reduced':document.hidden?'paused':'running';
    if(preference.matches){world.rotation.set(0,0,0);draw();}
    else if(!document.hidden)frame=requestAnimationFrame(tick);
  }
  function resize(){
    const {width,height}=element.getBoundingClientRect();if(!width||!height)return;
    camera.aspect=width/height;
    // Fit the outer orbit in both dimensions, with space for glowing stars and pointer tilt.
    const halfFov=THREE.MathUtils.degToRad(camera.fov/2);
    const limitingAngle=Math.min(halfFov,Math.atan(Math.tan(halfFov)*camera.aspect));
    const distance=2.55/Math.sin(limitingAngle);
    camera.position.set(0,.157, .988).normalize().multiplyScalar(distance);camera.lookAt(0,0,0);
    camera.updateProjectionMatrix();renderer.setSize(width,height);draw();
  }
  function pointer(event:PointerEvent){
    if(preference.matches)return;
    const rect=element.getBoundingClientRect();pointerX=((event.clientX-rect.left)/rect.width-.5)*.18;pointerY=((event.clientY-rect.top)/rect.height-.5)*.12;
  }
  function lost(event:Event){event.preventDefault();cancelAnimationFrame(frame);failed.value=true;motion.value='fallback';}
  const observer=new ResizeObserver(resize);observer.observe(element);
  element.addEventListener('pointermove',pointer);renderer.domElement.addEventListener('webglcontextlost',lost);
  preference.addEventListener('change',resume);document.addEventListener('visibilitychange',resume);
  resize();resume();
  // Some browsers update media.matches without dispatching change reliably.
  let reduced = preference.matches;
  const preferenceTimer = window.setInterval(() => {
    if (reduced !== preference.matches) { reduced = preference.matches; resume(); }
  }, 500);
  cleanup=()=>{
    disposed=true;clearInterval(preferenceTimer);cancelAnimationFrame(frame);observer.disconnect();
    element.removeEventListener('pointermove',pointer);preference.removeEventListener('change',resume);document.removeEventListener('visibilitychange',resume);
    renderer.domElement.removeEventListener('webglcontextlost',lost);
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
    scene.traverse(object=>{
      const drawable=object as THREE.Mesh;
      if(drawable.geometry)geometries.add(drawable.geometry);
      if(drawable.material)(Array.isArray(drawable.material)?drawable.material:[drawable.material]).forEach(material=>materials.add(material));
    });
    geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());starTexture.dispose();
    renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
  };
});
onUnmounted(()=>cleanup());
</script>
<template>
  <div ref="host" class="auth-orbit" :data-motion="motion" aria-hidden="true">
    <div v-if="failed" class="orbit-fallback"><span>✦</span><i></i><i></i></div>
  </div>
</template>
<style scoped>
.auth-orbit{position:absolute;inset:0;width:100%;height:100%;margin:0;isolation:isolate;z-index:0}
.auth-orbit:before{content:'';position:absolute;inset:8%;z-index:-1;border-radius:50%;background:radial-gradient(ellipse,#69519538,transparent 67%);filter:blur(12px)}
.auth-orbit :deep(canvas){display:block;width:100%;height:100%}
.orbit-fallback{position:absolute;width:82%;aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 30% 25%,#514668,#18172d 70%);border:1px solid #797096;left:50%;top:60%;transform:translate(-50%,-50%);display:grid;place-items:center}
.orbit-fallback span{font-size:54px;color:#e0c089}.orbit-fallback i{position:absolute;border:1px solid #bd9d6866;width:145%;height:48%;border-radius:50%;transform:rotate(-28deg)}.orbit-fallback i:last-child{transform:rotate(38deg)}
</style>
