export const WATERFALL_LAYERS=3;
export const WATERFALL_COLUMNS=10;
export const WATERFALL_ROWS=10;
export const WATERFALL_COUNT=WATERFALL_LAYERS*WATERFALL_COLUMNS*WATERFALL_ROWS;
export const WATERFALL_SCALE=1.25;
export const WATERFALL_GRAVITY=3.8;
export const WATERFALL_HALF=.3*WATERFALL_SCALE;
export const WATERFALL_ENTRY_WIDTH=.85;
export function waterfallView(width,height){
 const focal=height/(2*Math.tan(Math.PI/9)),top=145,bottom=Math.max(top+160,height-135);
 const cameraZ=Math.max(24,focal*15/(bottom-top));
 // Leave footer clearance even for cubes pushed towards the front collision boundary.
 return {width,height,focal,top,bottom,span:bottom-top,cameraZ,ground:(height/2-bottom)*(cameraZ-3.2)/focal};
}
export function waterfallSlots(random=Math.random){
 return Array.from({length:WATERFALL_COUNT},(_,index)=>{
  const lane=Math.floor(index/WATERFALL_ROWS),layer=Math.floor(lane/WATERFALL_COLUMNS);
  return {layer,column:lane%WATERFALL_COLUMNS,row:index%WATERFALL_ROWS,restitution:.35+random()*.12,spin:[(random()-.5)*.9,(random()-.5)*1.2,(random()-.5)*.7],angle:[random()*.7,random()*Math.PI*2,random()*.4]};
 });
}
export function waterfallSeed(slot,view){
 const z=-slot.layer*8+(slot.row-4.5)*.08,depth=view.cameraZ-z;
 const x=(slot.column-(WATERFALL_COLUMNS-1)/2+(slot.layer-1)*.32)*view.width*.86/WATERFALL_COLUMNS*depth/view.focal;
 const top=(view.height/2-view.top)*depth/view.focal;
 const y=view.ground+.85+(slot.row+.5)/WATERFALL_ROWS*(top-view.ground-.85);
 return {x,y,z,top};
}
export function waterfallQuaternion([x,y,z]){
 const a=Math.cos(x/2),b=Math.sin(x/2),c=Math.cos(y/2),d=Math.sin(y/2),e=Math.cos(z/2),f=Math.sin(z/2);
 return {x:b*c*e+a*d*f,y:a*d*e-b*c*f,z:a*c*f+b*d*e,w:a*c*e-b*d*f};
}
export function waterfallFlightSources(people,records,isVisible,random=Math.random,preferred=[]){
 const used=new Set(),matches=records.map(r=>{
  const id=r.participant_id??r.person?.id;
  const index=people.findIndex((p,i)=>isVisible(i)&&!used.has(i)&&(typeof r.person==='number'?p===r.person:id!=null&&p?.id===id));
  if(index>=0)used.add(index);return index;
 });
 const pool=Array.from({length:WATERFALL_COUNT},(_,i)=>i).filter(i=>isVisible(i)&&!used.has(i));
 for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 for(const index of preferred){const at=pool.indexOf(index);if(at>=0){pool.splice(at,1);pool.push(index);}}
 const fallback=Array.from({length:WATERFALL_COUNT},(_,i)=>i).filter(i=>!isVisible(i)&&!used.has(i));
 return matches.map(i=>i>=0?i:(pool.pop()??fallback.pop()));
}
