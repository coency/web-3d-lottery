// Seven reusable rings carry successive batches towards a fixed camera.
export const STAR_WAVE_LAYERS=7;
export const STAR_WAVE_PER_RING=28;
export const STAR_WAVE_COUNT=STAR_WAVE_LAYERS*STAR_WAVE_PER_RING;
export const STAR_WAVE_CARD_DEPTH=1;
export const STAR_WAVE_CARD_SCALE=1.3;
export const STAR_WAVE_OUTER_SCALE=STAR_WAVE_CARD_SCALE*1.18;
export function starWaveBoxScale(age){const u=Math.max(0,Math.min(1,age-(STAR_WAVE_LAYERS-2)));return STAR_WAVE_CARD_SCALE+(STAR_WAVE_OUTER_SCALE-STAR_WAVE_CARD_SCALE)*u*u*(3-2*u); }
export const STAR_WAVE_RADIUS=7.4;
export const STAR_WAVE_PERIOD=4.8;
export const STAR_WAVE_RINGS=Object.freeze(Array.from({length:STAR_WAVE_LAYERS},(_,layer)=>Object.freeze({
 count:STAR_WAVE_PER_RING,layer,radius:STAR_WAVE_RADIUS,direction:layer%2?-1:1,speed:1+layer*.13
})));
export function starWaveSlots(){return STAR_WAVE_RINGS.flatMap(r=>Array.from({length:r.count},(_,i)=>({...r,angle:i/r.count*Math.PI*2+r.layer*.19})));}
// Each pulse advances one position, easing to rest before the next pulse.
export function starWaveTravel(time){const n=Math.max(0,time)/STAR_WAVE_PERIOD,u=n%1;return Math.floor(n)+u-Math.sin(u*Math.PI*2)/(Math.PI*2);}
// Integrate forward displacement when blending pulse and continuous travel.
// Blending absolute positions would jump backwards when switching modes.
export function starWaveStep(fromTime,toTime,continuous){
 const blend=Math.max(0,Math.min(1,continuous));
 return (starWaveTravel(toTime)-starWaveTravel(fromTime))*(1-blend)+(toTime-fromTime)/STAR_WAVE_PERIOD*blend;
}
export function starWaveLayer(layer,travel){
 const distance=STAR_WAVE_LAYERS-1-layer+travel;
 const age=distance%STAR_WAVE_LAYERS;
 const enter=Math.min(1,age/.28);
 return {age,generation:Math.floor(distance/STAR_WAVE_LAYERS),scale:enter*enter*(3-2*enter)};
}
export function starWaveView(width,height){
 const focal=height/(2*Math.tan(Math.PI/9));
 const front=Math.max(90,Math.min(width*.43,Math.max(160,height-260)*.55));
 const center=(135+height-125)/2;
 // Even the rotating cube's inner corner must leave the furthest screen corner.
 const halfDiagonal=.3*STAR_WAVE_OUTER_SCALE*Math.sqrt(3);
 const cameraZ=focal*STAR_WAVE_RADIUS/front+6,centerY=(height/2-center)*cameraZ/focal;
 const exitDistance=focal*(STAR_WAVE_RADIUS-halfDiagonal-Math.abs(centerY))/(Math.hypot(width/2,height/2)+40)-halfDiagonal;
 const exit=focal*STAR_WAVE_RADIUS/Math.max(.8,exitDistance)*1.03;
 return {focal,front,inner:front*.18,exit,cameraZ};
}
export function starWaveCameraDistance(focal,width,height){return starWaveView(width,height+260).cameraZ;}
export function starWaveProjectedRadius(age,view){
 const frontAge=STAR_WAVE_LAYERS-1;
 if(age<=frontAge)return view.inner*Math.pow(view.front/view.inner,age/frontAge);
 // Continue the same incoming velocity before accelerating completely off-screen.
 const u=age-frontAge,a=Math.log(view.front/view.inner)/frontAge,b=Math.log(view.exit/view.front)-a;
 return view.front*Math.exp(a*u+b*u*u*u);
}
export function starWavePosition(slot,rotation,layer,view,out){
 const direction=slot.direction*((STAR_WAVE_LAYERS%2&&layer.generation%2)?-1:1);
 const angle=slot.angle+rotation*direction*slot.speed;
 out.x=Math.cos(angle)*slot.radius;out.y=Math.sin(angle)*slot.radius;
 const projected=starWaveProjectedRadius(layer.age,view);
 out.z=view.cameraZ-view.focal*slot.radius/projected;
}

// Off-screen outgoing and just-emerging slots cannot be winner flight origins.
export function starWaveFlightSources(people,records,random=Math.random,isVisible=()=>true){
 const used=new Set();
 const matches=records.map(r=>{
  const id=r.participant_id??r.person?.id;
  const index=people.findIndex((p,i)=>isVisible(i)&&!used.has(i)&&(typeof r.person==='number'?p===r.person:id!=null&&p?.id===id));
  if(index>=0)used.add(index);return index;
 });
 const pool=Array.from({length:STAR_WAVE_COUNT},(_,i)=>i).filter(i=>isVisible(i)&&!used.has(i));
 for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 return matches.map(i=>i>=0?i:pool.pop());
}
