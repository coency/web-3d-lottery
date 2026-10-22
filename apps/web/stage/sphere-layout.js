// 100 design pixels per world unit; the complete stage scales to the viewport.
export const CUBE_DESIGN_PX=60;
export const CUBE_SIDE=CUBE_DESIGN_PX/100;
export const SPHERE_COUNT=300;
export const MAX_HIGHLIGHT_SCALE=1.10;
export const SPHERE_RADIUS=6.8*Math.sqrt(420/300);
export function sphereLayout(){return {count:SPHERE_COUNT,radius:SPHERE_RADIUS};}
// null is a brand Logo. Display assignment never changes lottery eligibility.
export function displayPeople(population,previous=[],random=Math.random){
 if(population<=SPHERE_COUNT){
  const assigned=previous.filter(id=>id!==null);
  if(previous.length===SPHERE_COUNT&&assigned.length===population&&new Set(assigned).size===population&&assigned.every(id=>Number.isInteger(id)&&id>=0&&id<population))return [...previous];
  const slots=Array.from({length:SPHERE_COUNT},(_,i)=>i<population?i:null);
  for(let i=slots.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[slots[i],slots[j]]=[slots[j],slots[i]];}
  return slots;
 }
 const pool=Array.from({length:population},(_,i)=>i);
 for(let i=0;i<SPHERE_COUNT;i++){const j=i+Math.floor(random()*(population-i));[pool[i],pool[j]]=[pool[j],pool[i]];}
 const result=pool.slice(0,SPHERE_COUNT);
 for(let i=0;i<result.length;i++)if(result[i]===previous[i]){const j=(i+1)%result.length;[result[i],result[j]]=[result[j],result[i]];}
 return result;
}
export function spherePoints(count){return Array.from({length:count},(_,i)=>{const y=1-2*(i+.5)/count,r=Math.sqrt(1-y*y),theta=i*Math.PI*(3-Math.sqrt(5));return {x:Math.cos(theta)*r,y,z:Math.sin(theta)*r};});}

// Visual placement only: sample the visible face without fixed directional regions.
export function flightSources(points,rotation,count,random=Math.random,isVisible=()=>true){
 const cs=Math.cos(rotation),sn=Math.sin(rotation),pool=[],selected=[];
 points.forEach((p,index)=>{const x=p.x*cs+p.z*sn,z=p.z*cs-p.x*sn;
  if(z<.4||!isVisible(index))return;
  pool.push({index,x,y:p.y});
 });
 for(let i=pool.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
 // Prefer separated origins so simultaneous winner flights remain readable.
 for(const p of pool){if(selected.length>=count)break;if(selected.every(s=>Math.hypot(p.x-s.x,p.y-s.y)>.3))selected.push(p);}
 for(const p of pool){if(selected.length>=count)break;if(!selected.includes(p))selected.push(p);}
 return selected.map(p=>p.index);
}

// Shared pixel anchors keep persistent 3D cubes and accessible captions aligned.
export function winnerLayout(width,height,count,auxiliaryCount=0){
 if(!count)return [];
 const narrow=width<=600,balanced=!narrow&&count>5&&count<=10;
 const columns=balanced?Math.ceil(count/2):Math.min(count,narrow?3:5),rows=Math.ceil(count/columns);
 const top=narrow?225:Math.max(170,height*.20),bottom=height-(narrow?250:210),gap=24;
 const rowHeight=(bottom-top-gap*(rows-1))/rows,cellWidth=Math.min(280,(width-48)/columns);
 // Reserve the complete caption (including optional fields and card border),
 // not just the avatar, before fitting and vertically centering each row.
 const captionSpace=(rows>1?96:110)+Math.min(2,Math.max(0,auxiliaryCount))*16;
 const size=Math.max(20,Math.min(narrow?80:184,cellWidth*.62,(rowHeight-captionSpace)/1.24));
 const cardHeight=size*1.24+captionSpace;
 return Array.from({length:count},(_,i)=>{
  const firstRow=balanced?Math.floor(count/2):columns;
  const row=balanced?(i<firstRow?0:1):Math.floor(i/columns);
  const start=balanced?(row===0?0:firstRow):row*columns;
  const items=balanced?(row===0?firstRow:count-firstRow):Math.min(columns,count-start);
  return {x:width/2+(i-start-(items-1)/2)*cellWidth,y:top+row*(rowHeight+gap)+Math.max(0,(rowHeight-cardHeight)/2)+10+size*.62,size,cardWidth:Math.min(cellWidth-6,Math.max(narrow?108:144,size*1.45))};
 });
}
