import * as THREE from 'three';

// Generated sample surface: remove this override to return to activity branding.
const sampleSurfaceUrl=new URL('./assets/planet-nebula-sample-v1.png',import.meta.url).href;

// One sphere with analytic surface lighting: no halo, shadows or reflections.
export function createBrandPlanet(parent,brandLogo,{name='corridor-brand-planet'}={}){
 const group=new THREE.Group();group.name=name;parent.add(group);
 const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
 const context=canvas.getContext('2d',{willReadFrequently:true});
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 const uniforms={surface:{value:texture},useSurface:{value:0},logo:{value:texture},bodyColor:{value:new THREE.Color('#445a80')},time:{value:0},motion:{value:1},brightness:{value:1}};
 const material=new THREE.ShaderMaterial({uniforms,
  vertexShader:`varying vec2 surfaceUv;varying vec3 localPoint;varying vec3 worldNormal;varying vec3 toEye;
   void main(){surfaceUv=uv;localPoint=position;vec4 world=modelMatrix*vec4(position,1.);worldNormal=normalize(mat3(modelMatrix)*normal);toEye=cameraPosition-world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
  fragmentShader:`uniform sampler2D surface;uniform float useSurface;varying vec2 surfaceUv;uniform sampler2D logo;uniform vec3 bodyColor;uniform float time;uniform float motion;uniform float brightness;
   varying vec3 localPoint;varying vec3 worldNormal;varying vec3 toEye;
   void main(){
    vec3 n=normalize(worldNormal),eye=normalize(toEye),p=normalize(localPoint);
    // Separate front/back planar projections preserve logo proportions and avoid pole seams.
    vec2 uv=vec2(p.x*(p.z<0.?-1.:1.),p.y)/1.32+.5;
    float inside=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);
    float facing=smoothstep(.52,.7,abs(p.z));
    vec4 mark=texture2D(logo,clamp(uv,0.,1.));
    vec3 color=mix(bodyColor,mark.rgb,mark.a*inside*facing);
    if(useSurface>.5)color=texture2D(surface,surfaceUv).rgb;
    vec3 light=normalize(vec3(-.6,.85,1.));
    float diffuse=max(0.,dot(n,light));
    float spec=pow(max(0.,dot(n,normalize(light+eye))),38.);
    float sweep=exp(-pow((dot(n,normalize(vec3(.85,.3,.2)))-sin(time*.28))/.23,2.))*motion;
    color*=.45+.55*diffuse;
    color+=vec3(.85,.9,1.)*spec*.22+vec3(.75,.8,.94)*sweep*.065;
    gl_FragColor=vec4(color*brightness,1.);
    #include <colorspace_fragment>
   }`
 });
 new THREE.TextureLoader().load(sampleSurfaceUrl,map=>{
  map.colorSpace=THREE.SRGBColorSpace;map.wrapS=THREE.RepeatWrapping;map.wrapT=THREE.ClampToEdgeWrapping;
  uniforms.surface.value=map;uniforms.useSurface.value=1;
 },undefined,()=>{console.warn('球体示例贴图加载失败，已保留品牌材质');});
 const sphere=new THREE.Mesh(new THREE.SphereGeometry(1,48,32),material);sphere.name='brand-sphere';group.add(sphere);
 let time=0,turnSpeed=.095;
 function refresh(){
  context.clearRect(0,0,512,512);context.drawImage(brandLogo(512,true),0,0,512,512);texture.needsUpdate=true;
  // A subdued tint derived from the logo connects the ceramic body to the brand.
  const pixels=context.getImageData(0,0,512,512).data;let red=0,green=0,blue=0,weight=0;
  for(let i=0;i<pixels.length;i+=64){const r=pixels[i]/255,g=pixels[i+1]/255,b=pixels[i+2]/255,a=pixels[i+3]/255,chroma=Math.max(r,g,b)-Math.min(r,g,b);
   if(a<.1||chroma<.12)continue;const w=chroma*a;red+=r*w;green+=g*w;blue+=b*w;weight+=w;
  }
  const color=uniforms.bodyColor.value;
  if(weight){color.setRGB(red/weight,green/weight,blue/weight,THREE.SRGBColorSpace);const hsl={};color.getHSL(hsl);color.setHSL(hsl.h,Math.min(.45,hsl.s),.16);}
  else color.set('#445a80');
 }
 refresh();
 return {
  refresh,
  resize(view,{projectedRadius=view.height*.11,centerY=.5}={}){
   const depth=view.cameraZ+24,halfHeight=projectedRadius;
   const radius=Math.min(5.8,depth*halfHeight/Math.sqrt(view.focal**2+halfHeight**2));
   group.position.set(0,centerY,-24);sphere.scale.setScalar(radius);
  },
  update(dt,{phase,reduced,revealing}){
   const ease=1-Math.exp(-dt*3),dim=phase==='result'||revealing;
   turnSpeed+=((phase==='rolling'?.23:.095)-turnSpeed)*ease;
   if(!reduced){time+=dt;sphere.rotation.y=(sphere.rotation.y+turnSpeed*dt)%(Math.PI*2);}
   uniforms.time.value=time;uniforms.motion.value=reduced?0:1;
   uniforms.brightness.value+=((dim?.24:1)-uniforms.brightness.value)*ease;
  }
 };
}
