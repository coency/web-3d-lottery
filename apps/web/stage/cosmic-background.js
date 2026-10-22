import * as THREE from 'three';

// Procedural deep-space layers. Geometry and cloud texture are allocated once.
export function createCosmicBackground(scene,pixelRatio){
 const root=new THREE.Group();scene.add(root);
 let seed=7321;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const cloudCanvas=document.createElement('canvas');cloudCanvas.width=1024;cloudCanvas.height=512;
 const ctx=cloudCanvas.getContext('2d');ctx.globalCompositeOperation='lighter';
 for(let i=0;i<100;i++){
  const u=random(),angle=u*Math.PI*3.6,r=85+u*250,x=512+Math.cos(angle)*r,y=256+Math.sin(angle)*r*.45;
  const radius=45+random()*130,palette=['82,48,150','31,79,139','82,40,116','24,102,122'],color=palette[i%4];
  const gradient=ctx.createRadialGradient(x,y,0,x,y,radius);gradient.addColorStop(0,`rgba(${color},0.20)`);gradient.addColorStop(.4,`rgba(${color},0.09)`);gradient.addColorStop(1,`rgba(${color},0)`);ctx.fillStyle=gradient;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
 }
 const cloudTexture=new THREE.CanvasTexture(cloudCanvas);cloudTexture.colorSpace=THREE.SRGBColorSpace;
 const nebula=new THREE.Mesh(new THREE.PlaneGeometry(110,64),new THREE.MeshBasicMaterial({map:cloudTexture,transparent:true,opacity:.8,depthWrite:false}));nebula.position.z=-46;root.add(nebula);
 const makeMaterial=()=>new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
  uniforms:{time:{value:0},strength:{value:1},focal:{value:900},pixelRatio:{value:pixelRatio}},
  vertexShader:`attribute float size;attribute float phase;attribute float alpha;attribute vec3 tint;varying float opacity;varying vec3 color;uniform float time;uniform float strength;uniform float focal;uniform float pixelRatio;
   void main(){vec4 view=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*view;gl_PointSize=clamp(size*focal*pixelRatio/max(1.,-view.z),1.,32.);opacity=alpha*strength*(.78+.22*sin(time*.7+phase));color=tint;}`,
  fragmentShader:`varying float opacity;varying vec3 color;void main(){float r=length(gl_PointCoord-.5)*2.;float glow=exp(-r*r*4.)*(1.-smoothstep(.65,1.,r));gl_FragColor=vec4(color,glow*opacity);}`});
 function field(count,place){const geo=new THREE.BufferGeometry(),p=new Float32Array(count*3),size=new Float32Array(count),phase=new Float32Array(count),alpha=new Float32Array(count),tint=new Float32Array(count*3);
  for(let i=0;i<count;i++){const value=place(i);p.set(value.position,i*3);size[i]=value.size;phase[i]=random()*Math.PI*2;alpha[i]=value.alpha;tint.set(value.color,i*3);}
  for(const [name,array,width] of [['position',p,3],['size',size,1],['phase',phase,1],['alpha',alpha,1],['tint',tint,3]])geo.setAttribute(name,new THREE.BufferAttribute(array,width));
  const mesh=new THREE.Points(geo,makeMaterial());mesh.frustumCulled=false;root.add(mesh);return mesh;
 }
 const stars=field(1500,()=>({position:[(random()-.5)*105,(random()-.5)*65,-12-random()*58],size:.035+random()**5*.20,alpha:.3+random()*.65,color:random()>.75?[1,.85,.62]:[.66,.77,1]}));
 const galaxy=field(5000,i=>{const radius=3+Math.sqrt(random())*27,angle=(i%3)*Math.PI*2/3+radius*.23+(random()-.5)*.32,width=(random()-.5)*2.0;
  return {position:[Math.cos(angle)*radius+width,Math.sin(angle)*radius*.62+width*.5,(random()-.5)*2],size:.025+random()*.10,alpha:.15+random()*.55,color:i%4===0?[1,.72,.44]:[.58,.48,.94]};
 });galaxy.position.set(0,-1,-27);galaxy.rotation.z=-.35;
 // A tilted spiral beneath the sphere: rotate in its own plane, preserving the ellipse.
 const vortex=field(3000,i=>{const radius=1.3+Math.sqrt(random())*11.8,angle=(i%3)*Math.PI*2/3+radius*.49+(random()-.5)*.85,scatter=(random()-.5)*1.3;
  const fade=1-THREE.MathUtils.smoothstep(radius,9,13.1)*.7;
  return {position:[Math.cos(angle)*radius+scatter,Math.sin(angle)*radius+scatter*.6,(random()-.5)*.55],size:.04+random()*.10,alpha:(.24+random()*.5)*fade,color:i%5===0?[1,.78,.48]:[.42,.63,1]};
 });
 const vortexPlane=new THREE.Group();root.add(vortexPlane);vortexPlane.add(vortex);vortexPlane.rotation.x=-1.28;vortexPlane.position.set(0,-7.6,-1.5);
 // Sparse dust extends beyond the arms with a soft edge and independent drift.
 const outskirts=field(1400,i=>{const radius=3+Math.sqrt(random())*13.5,angle=random()*Math.PI*2,fade=1-THREE.MathUtils.smoothstep(radius,10,16.5)*.85;
  return {position:[Math.cos(angle)*radius,Math.sin(angle)*radius,(random()-.5)*2],size:.035+random()**3*.13,alpha:(.16+random()*.38)*fade,color:i%6===0?[1,.83,.59]:[.52,.67,1]};
 });vortexPlane.add(outskirts);
 const meteors=field(180,()=>({position:[0,0,-18],size:.14,alpha:0,color:[.76,.85,1]}));
 return {setVisible(visible){root.visible=visible;},update(time,{focal,energy,dim=1,reduced=false,customBackground=false}){
  const t=reduced?0:time;
  for(const mesh of [stars,galaxy,vortex,outskirts,meteors]){mesh.material.uniforms.time.value=t;mesh.material.uniforms.focal.value=focal;mesh.material.uniforms.strength.value=dim;}
  nebula.visible=!customBackground;
  nebula.material.opacity=.68*dim;nebula.rotation.z=Math.sin(t*.015)*.035;
  galaxy.rotation.z=-.35+t*.007;galaxy.material.uniforms.strength.value=dim*(.8+energy*.25);
  // Arms wind toward increasing angles, so negative rotation makes them trail.
  vortex.rotation.z=-t*.09;
  outskirts.rotation.z=-t*.035;
  stars.rotation.z=Math.sin(t*.008)*.008;
  meteors.visible=!reduced;const p=meteors.geometry.attributes.position,a=meteors.geometry.attributes.alpha,s=meteors.geometry.attributes.size;
  for(let j=0;j<3;j++){const cycle=(t+j*6)%19,active=cycle<1.6,progress=cycle/1.6;
   for(let k=0;k<60;k++){const i=j*60+k,tail=k/59,u=progress-tail*.23;p.setXYZ(i,-28+u*48,13-j*6-u*13,-17-j*7);a.setX(i,active&&u>=0?Math.sin(progress*Math.PI)*(1-tail)**1.7:0);s.setX(i,k===0?.46:.21*(1-tail)+.05);}
  }
  p.needsUpdate=true;a.needsUpdate=true;s.needsUpdate=true;
 }};
}
