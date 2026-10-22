import * as THREE from 'three';

// A reusable particle cloud: no per-frame random changes or growing object lists.
export function createMeteorTrail(scene,pixelRatio){
 const count=160,position=new Float32Array(count*3),sizes=new Float32Array(count),opacity=new Float32Array(count);
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(position,3));
 geometry.setAttribute('size',new THREE.BufferAttribute(sizes,1));
 geometry.setAttribute('opacity',new THREE.BufferAttribute(opacity,1));
 const material=new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,blending:THREE.AdditiveBlending,
  uniforms:{pixelRatio:{value:pixelRatio}},
  vertexShader:`attribute float size;attribute float opacity;varying float alpha;uniform float pixelRatio;
   void main(){alpha=opacity;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=max(1.,size*pixelRatio);}`,
  fragmentShader:`varying float alpha;void main(){float d=length(gl_PointCoord-.5)*2.;float glow=exp(-d*d*4.)*(1.-smoothstep(.5,1.,d));gl_FragColor=vec4(mix(vec3(1.,.48,.13),vec3(1.,.94,.73),exp(-d*d*12.)),glow*alpha);}`});
 const particles=new THREE.Points(geometry,material);particles.frustumCulled=false;scene.add(particles);
 const ribbonGeometry=new THREE.BufferGeometry(),ribbonVertices=new Float32Array(32*6);
 ribbonGeometry.setAttribute('position',new THREE.BufferAttribute(ribbonVertices,3));
 const uv=new Float32Array(32*4);for(let i=0;i<32;i++)uv.set([i/31,0,i/31,1],i*4);ribbonGeometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
 const glow=document.createElement('canvas');glow.width=glow.height=32;const ctx=glow.getContext('2d'),gradient=ctx.createLinearGradient(0,0,0,32);gradient.addColorStop(0,'rgba(255,255,255,0)');gradient.addColorStop(.5,'rgba(255,255,255,1)');gradient.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,32,32);const glowTexture=new THREE.CanvasTexture(glow);
 const indices=[];for(let i=0;i<31;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}ribbonGeometry.setIndex(indices);
 const ribbon=new THREE.Mesh(ribbonGeometry,new THREE.MeshBasicMaterial({color:0xffd18b,map:glowTexture,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending}));ribbon.frustumCulled=false;scene.add(ribbon);
 const seeds=Array.from({length:count},()=>({angle:Math.random()*Math.PI*2,drift:18+Math.random()*75,life:.35+Math.random()*.45,size:2+Math.random()*7}));
 const ease=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
 function hide(){particles.visible=false;ribbon.visible=false;}
 hide();
 return {hide,update(curve,elapsed,duration){
  if(elapsed<0||elapsed>duration+.8){hide();return;}
  particles.visible=true;const u=ease(elapsed/duration);
  ribbon.visible=elapsed<duration;ribbon.material.opacity=Math.sin(Math.PI*Math.min(1,elapsed/duration))*.52;
  for(let i=0;i<32;i++){const f=i/31,t=Math.max(0,u-.25*(1-f)-.018),p=curve.getPoint(t),v=curve.getTangent(t),width=Math.sin(f*Math.PI)*7;
   ribbonVertices.set([p.x-v.y*width,p.y+v.x*width,-120,p.x+v.y*width,p.y-v.x*width,-120],i*6);
  }
  ribbonGeometry.attributes.position.needsUpdate=true;
  for(let i=0;i<count;i++){
   const seed=seeds[i],trail=i<104,launch=i>=104&&i<132;
   const birth=trail?i/104*duration:launch?0:duration,age=elapsed-birth;
   if(age<0||age>seed.life){opacity[i]=0;continue;}
   const p=curve.getPoint(ease(birth/duration)),velocity=seed.drift*(trail?1:1.8),fade=1-age/seed.life;
   position.set([p.x+Math.cos(seed.angle)*velocity*age,p.y+Math.sin(seed.angle)*velocity*age-30*age*age,-100],i*3);
   sizes[i]=seed.size*(.5+fade);opacity[i]=fade*fade*(trail?.85:1);
  }
  geometry.attributes.position.needsUpdate=true;geometry.attributes.size.needsUpdate=true;geometry.attributes.opacity.needsUpdate=true;
 }};
}
