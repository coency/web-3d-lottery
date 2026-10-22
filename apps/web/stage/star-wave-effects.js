import * as THREE from 'three';
import {STAR_WAVE_RADIUS,starWaveProjectedRadius} from './star-wave-layout.js';

// Fixed buffers: five visible spiral heads with short trailing points.
// No bloom pass, lights, shadows, textures or growing particle lists.
export function createStarWaveEffects(cluster,pixelRatio,random=Math.random){
 const group=new THREE.Group();group.name='star-wave-effects';group.visible=false;cluster.add(group);
 const trails=5,perTrail=24,count=trails*perTrail;
 const positions=new Float32Array(count*3),alpha=new Float32Array(count),sizes=new Float32Array(count),colors=new Float32Array(count*3);
 const generations=new Int32Array(trails).fill(-1),trailColor=new THREE.Color();
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
 geometry.setAttribute('alpha',new THREE.BufferAttribute(alpha,1).setUsage(THREE.DynamicDrawUsage));
 geometry.setAttribute('size',new THREE.BufferAttribute(sizes,1).setUsage(THREE.DynamicDrawUsage));
 geometry.setAttribute('tint',new THREE.BufferAttribute(colors,3).setUsage(THREE.DynamicDrawUsage));
 const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
  uniforms:{strength:{value:0},pixelRatio:{value:pixelRatio},focal:{value:1}},
  vertexShader:`attribute float alpha;attribute float size;attribute vec3 tint;varying float opacity;varying vec3 color;uniform float strength;uniform float pixelRatio;uniform float focal;
   void main(){vec4 p=modelViewMatrix*vec4(position,1.);opacity=alpha*strength;color=tint;gl_Position=projectionMatrix*p;gl_PointSize=size*focal/max(.1,-p.z)*pixelRatio;}`,
  fragmentShader:`varying float opacity;varying vec3 color;void main(){float d=length(gl_PointCoord-.5)*2.;float glow=exp(-d*d*3.5)*(1.-smoothstep(.6,1.,d));gl_FragColor=vec4(mix(color,vec3(1.),exp(-d*d*20.)*.65),glow*opacity);}`
 });
 const dots=new THREE.Points(geometry,material);dots.name='spiral-trails';dots.frustumCulled=false;group.add(dots);
 let strength=0,time=0;
 return {
  update(dt,{enabled,active,energy,quality,view}){
   if(!enabled){group.visible=false;strength=0;return;}
   strength+=((active?quality:0)-strength)*(1-Math.exp(-dt*4));
   group.visible=strength>.005;
   if(!group.visible)return;
   time+=dt*(1+energy*1.7);
   material.uniforms.focal.value=view.focal;
   material.uniforms.strength.value=strength*(1.35+energy*.2);
   const allowed=quality<.75?1:trails;
   geometry.setDrawRange(0,allowed*perTrail);
   for(let trail=0;trail<allowed;trail++){
    const cycle=time/7.2+trail/trails,generation=Math.floor(cycle),head=(cycle%1)*7;
    if(generations[trail]!==generation){
     // One random hue for the whole trail; change it only at the hidden wrap point.
     trailColor.setHSL(random(),.6+random()*.2,.62+random()*.12);
     for(let k=0;k<perTrail;k++)trailColor.toArray(colors,(trail*perTrail+k)*3);
     geometry.attributes.tint.needsUpdate=true;generations[trail]=generation;
    }
    for(let k=0;k<perTrail;k++){
     const i=trail*perTrail+k,age=head-k*.022,tail=1-k/perTrail;
     if(age<0){alpha[i]=0;continue;}
     const radius=STAR_WAVE_RADIUS*(.70+trail/(trails-1)*.10),angle=trail*2.39996+age*1.65+time*.075;
     const projected=starWaveProjectedRadius(age,view);
     positions[i*3]=Math.cos(angle)*radius;positions[i*3+1]=Math.sin(angle)*radius;
     positions[i*3+2]=view.cameraZ-view.focal*STAR_WAVE_RADIUS/projected;
     const fade=THREE.MathUtils.smoothstep(age,0,.32)*(1-THREE.MathUtils.smoothstep(age,6.25,7));
     alpha[i]=fade*tail**1.35*(k===0?1:.9);sizes[i]=k===0?.72:.08+.18*tail;
    }
   }
   geometry.attributes.position.needsUpdate=true;geometry.attributes.alpha.needsUpdate=true;geometry.attributes.size.needsUpdate=true;

  }
 };
}
