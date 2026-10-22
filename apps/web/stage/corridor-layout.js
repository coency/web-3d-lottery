export const CORRIDOR_ROWS=10;
export const CORRIDOR_COLUMNS=15;
export const CORRIDOR_PER_COLUMN=CORRIDOR_ROWS*2;
export const CORRIDOR_COUNT=CORRIDOR_COLUMNS*CORRIDOR_PER_COLUMN;
export const CORRIDOR_WALL_X=9;
export const CORRIDOR_SCALE=1.85;
export const CORRIDOR_DEPTH=1;
export const CORRIDOR_ROW_PITCH=1.26;
export function corridorSlots(){
 return Array.from({length:CORRIDOR_COUNT},(_,i)=>({column:Math.floor(i/CORRIDOR_PER_COLUMN),side:i%CORRIDOR_PER_COLUMN<CORRIDOR_ROWS?-1:1,row:i%CORRIDOR_ROWS}));
}
export function corridorView(width,height){
 const focal=height/(2*Math.tan(Math.PI/9)),halfHeight=(CORRIDOR_ROWS-1)*CORRIDOR_ROW_PITCH/2+.7;
 const cameraZ=Math.max(focal*halfHeight/Math.max(110,(height-290)/2),focal*(CORRIDOR_WALL_X+1)/(width*.43))+1.5;
 const exit=Math.max(2,focal*(CORRIDOR_WALL_X-.5)/(width/2+70)-.8);
 return {width,height,focal,cameraZ,far:cameraZ+52,exit,centerY:-5*cameraZ/focal};
}
export function corridorColumn(column,travel){
 // Signed travel lets the walls recede while the robot runs toward the camera.
 const distance=CORRIDOR_COLUMNS-1-column+travel,age=((distance%CORRIDOR_COLUMNS)+CORRIDOR_COLUMNS)%CORRIDOR_COLUMNS;
 const enter=Math.min(1,age/.3);
 return {age,generation:Math.floor(distance/CORRIDOR_COLUMNS),scale:enter*enter*(3-2*enter)};
}
export function corridorDistance(age,view){
 const last=CORRIDOR_COLUMNS-1,a=Math.log(view.far/view.cameraZ)/last;
 if(age<=last)return view.far*Math.exp(-a*age);
 const u=age-last,b=Math.log(view.cameraZ/view.exit)-a;
 return view.cameraZ*Math.exp(-a*u-b*u*u*u);
}
export function corridorPosition(slot,column,view,out){
 out.x=slot.side*CORRIDOR_WALL_X;
 out.y=((CORRIDOR_ROWS-1)/2-slot.row)*CORRIDOR_ROW_PITCH;
 out.z=view.cameraZ-corridorDistance(column.age,view);
 return out;
}
export function corridorFlightSources(people,records,isVisible,random=Math.random){
 const used=new Set(),pool=Array.from({length:CORRIDOR_COUNT},(_,i)=>i).filter(isVisible);
 const matches=records.map(r=>{
  const id=r.participant_id??r.person?.id;
  const index=people.findIndex((p,i)=>isVisible(i)&&!used.has(i)&&(typeof r.person==='number'?p===r.person:id!=null&&p?.id===id));
  if(index>=0)used.add(index);return index;
 });
 const remaining=pool.filter(i=>!used.has(i));
 for(let i=remaining.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[remaining[i],remaining[j]]=[remaining[j],remaining[i]];}
 return matches.map((match,order)=>{
  if(match>=0)return match;
  const preferred=remaining.findIndex(i=>(i%CORRIDOR_PER_COLUMN<CORRIDOR_ROWS?0:1)===order%2);
  return remaining.splice(preferred>=0?preferred:remaining.length-1,1)[0];
 });
}
