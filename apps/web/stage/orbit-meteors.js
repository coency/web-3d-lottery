import * as THREE from 'three';

// Real 3D orbits share the sphere camera, including perspective and occlusion.
export function createOrbitMeteors(scene,pixelRatio){
 const paths=6,perPath=181,count=paths*perPath,positions=new Float32Array(count*3),sizes=new Float32Array(count),alphas=new Float32Array(count),colors=new Float32Array(count*3);
 const geometry=new THREE.BufferGeometry();
 for(const [name,array,width] of [['position',positions,3],['size',sizes,1],['alpha',alphas,1],['color',colors,3]])geometry.setAttribute(name,new THREE.BufferAttribute(array,width));
 const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
  uniforms:{strength:{value:0},focal:{value:800},pixelRatio:{value:pixelRatio}},
  vertexShader:`attribute float size;attribute float alpha;attribute vec3 color;varying float opacity;varying vec3 tint;uniform float focal;uniform float pixelRatio;uniform float strength;
   void main(){vec4 view=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*view;gl_PointSize=clamp(size*focal*pixelRatio/max(.1,-view.z),1.,100.);opacity=alpha*strength;tint=color;}`,
  fragmentShader:`varying float opacity;varying vec3 tint;void main(){float d=length(gl_PointCoord-.5)*2.;float light=exp(-d*d*4.)*(1.-smoothstep(.6,1.,d));gl_FragColor=vec4(mix(tint,vec3(1.),exp(-d*d*20.)*.6),light*opacity);}`});
 const cloud=new THREE.Points(geometry,material);cloud.frustumCulled=false;cloud.visible=false;scene.add(cloud);
 const seeds=Array.from({length:count},()=>({x:Math.random()-.5,y:Math.random()-.5,z:Math.random()-.5}));
 const rotations=Array.from({length:paths},(_,j)=>new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(.45+j*.42,j*.82,.25-j*.32)));
 const p=new THREE.Vector3(),color=new THREE.Color();
 return {update(time,strength,radius,centerY,focal){
  cloud.visible=strength>.01;if(!cloud.visible)return;
  material.uniforms.strength.value=strength;material.uniforms.focal.value=focal;
  for(let j=0;j<paths;j++){
   color.set(j%2?0xc5b1ff:0xffce83);
   for(let k=0;k<perPath;k++){
    const i=j*perPath+k,age=k/(perPath-1),angle=time*(1.25+j*.14)+j*2.1-age*1.4,r=radius*(1.02+j*.012),seed=seeds[i],drift=age*age*1.3;
    p.set(Math.cos(angle)*r,Math.sin(angle)*r,0).applyMatrix4(rotations[j]);
    positions.set([p.x+seed.x*drift,p.y+centerY+seed.y*drift,p.z+seed.z*drift],i*3);
    sizes[i]=k===0?.55:(.065+.18*(1-age))*(k%3===0?1.6:1);
    alphas[i]=k===0?1:(1-age)**1.8*1.1;
    colors.set([color.r,color.g,color.b],i*3);
   }
  }
  for(const attribute of Object.values(geometry.attributes))attribute.needsUpdate=true;
 }};
}
