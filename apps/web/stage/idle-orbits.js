import * as THREE from 'three';
import {orbitTrailAngle} from './idle-motion.js';

// Two short trails share one draw call. Reuse the existing rings and allocate once.
export function createIdleOrbits(orbit,pixelRatio){
 const rings=orbit.children.slice(0,2),saved=rings.map(r=>({rotation:r.rotation.clone(),opacity:r.material.opacity,color:r.material.color.clone()}));
 const perRing=28,count=perRing*2,positions=new Float32Array(count*3),alpha=new Float32Array(count),sizes=new Float32Array(count);
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
 for(let i=0;i<count;i++){const k=i%perRing,u=k/(perRing-1);alpha[i]=(1-u)**2;sizes[i]=k===0?8:1.5+3.5*(1-u);}
 geometry.setAttribute('alpha',new THREE.BufferAttribute(alpha,1));geometry.setAttribute('size',new THREE.BufferAttribute(sizes,1));
 const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
 uniforms:{strength:{value:0},pixelRatio:{value:pixelRatio}},
 vertexShader:'attribute float alpha;attribute float size;varying float opacity;uniform float strength;uniform float pixelRatio;void main(){opacity=alpha*strength;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size*pixelRatio;}',
 fragmentShader:'varying float opacity;void main(){float d=length(gl_PointCoord-.5)*2.;float light=exp(-d*d*3.)*(1.-smoothstep(.65,1.,d));gl_FragColor=vec4(1.,.9,.72,light*opacity);}'
 });
 const dots=new THREE.Points(geometry,material);dots.visible=false;dots.frustumCulled=false;orbit.add(dots);
 const p=new THREE.Vector3(),colors=[new THREE.Color(0xe6c796),new THREE.Color(0xc8dafa)];
 return {update(time,strength){
  dots.visible=strength>.01;material.uniforms.strength.value=strength*.95;
  rings.forEach((ring,j)=>{
   ring.visible=false; // Retain the orbit geometry and transforms without drawing the lines.
   ring.scale.setScalar(THREE.MathUtils.lerp(1,j?1.32:1.25,strength));
   ring.rotation.copy(saved[j].rotation);if(j===1){ring.rotation.x=.78*strength;ring.rotation.y=-.32*strength;}
   ring.material.opacity=THREE.MathUtils.lerp(saved[j].opacity,.3+(j===0?.04:0)*Math.sin(time*.32),strength);
   ring.material.color.copy(saved[j].color).lerp(colors[j],strength);
   if(!dots.visible)return;
   for(let k=0;k<perRing;k++){const angle=orbitTrailAngle(time,j?.24:-.3,j*2.3,k/(perRing-1)),r=(1.12+j*.055)*ring.scale.x;
    p.set(Math.cos(angle)*r,Math.sin(angle)*r,0).applyEuler(ring.rotation);geometry.attributes.position.setXYZ(j*perRing+k,p.x,p.y,p.z);
   }
  });
  if(dots.visible)geometry.attributes.position.needsUpdate=true;
 }};
}
