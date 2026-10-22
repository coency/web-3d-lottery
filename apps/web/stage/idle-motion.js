// Presentation-only motion. No participant assignment or lottery selection occurs here.
export function matrixIdleWave(x,y,width,time){
 const phase=((time%12)+12)%12;if(phase>=6)return 0;
 const direction=Math.floor(time/12)%2===0?1:-1;
 const center=-width*.65+phase/6*width*1.3;
 const band=Math.max(0,1-Math.abs(direction*(x+y*.18)-center)/1.35);
 return .5-.5*Math.cos(band*Math.PI);
}
export function sphereIdleLight(y,z,time){
 const phase=((time%14)+14)%14;if(phase>=8)return 0;
 const band=Math.max(0,1-Math.abs(y-(1.35-phase/8*2.7))/.22);
 return band*band*Math.max(0,z)*.65;
}
// Ignore occasional stalls; reduce only after sustained slow frames, then recover slowly.
export function createIdleBudget(){
 let slow=0,healthy=0,level=1;
 return {update(ms,enabled){
  if(!enabled||ms>250)return level;
  const dt=Math.min(ms/1000,.1);
  if(ms>28){slow+=dt;healthy=0;}else{slow=Math.max(0,slow-dt*.4);healthy+=dt;}
  if(slow>=2){level=Math.max(0,level-.5);slow=0;healthy=0;}
  if(healthy>=10){level=Math.min(1,level+.5);healthy=0;}
  return level;
 }};
}

// Offset the trail opposite the signed angular velocity so its largest point leads.
export function orbitTrailAngle(time,speed,phase,age){return time*speed+phase-Math.sign(speed)*age*.62;}
