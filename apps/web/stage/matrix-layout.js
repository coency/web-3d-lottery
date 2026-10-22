import {CUBE_SIDE} from './sphere-layout.js';
export const MATRIX_COUNT=300;
export const MATRIX_BOX_DEPTH=8;
export const MATRIX_PUSH_MAX=4.2;
export const MATRIX_COLUMN_GAP=CUBE_SIDE*.2;
export const MATRIX_ROW_GAP=MATRIX_COLUMN_GAP;
// Presentation coordinates only; this module never selects lottery winners.
export function matrixLayout(count,width,height,fixedColumns,spacing=MATRIX_COLUMN_GAP){
 const aspect=Math.max(.45,Math.min(4,width/Math.max(1,height)));
 const candidates=Array.from({length:count},(_,i)=>i+1).filter(n=>count%n===0);
 const columns=fixedColumns??candidates.reduce((best,n)=>Math.abs(Math.log(n*n/count/aspect))<Math.abs(Math.log(best*best/count/aspect))?n:best,1),rows=Math.ceil(count/columns);
 const columnPitch=CUBE_SIDE+spacing,rowPitch=columnPitch;
 const points=Array.from({length:count},(_,index)=>{
  const row=Math.floor(index/columns),items=Math.min(columns,count-row*columns);
  return {x:(index%columns-(items-1)/2)*columnPitch,y:((rows-1)/2-row)*rowPitch,z:0};
 });
 return {points,columns,rows,width:(columns-1)*columnPitch+CUBE_SIDE,height:(rows-1)*rowPitch+CUBE_SIDE};
}
// Reflow into more rows to make room for equal gaps without shrinking the boxes.
// The camera still uses the original, gapless 300-cell framing.
export function expandedMatrixLayout(width,height){
 const framing=matrixLayout(MATRIX_COUNT,width,height,undefined,0);
 const matrix=matrixLayout(MATRIX_COUNT,width*.8,height);
 return {...matrix,framing};
}
export function matrixFlightSources(count,winners,random=Math.random){
 const slots=Array.from({length:count},(_,i)=>i);
 for(let i=slots.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[slots[i],slots[j]]=[slots[j],slots[i]];}
 return slots.slice(0,Math.min(count,winners));
}

// Each slot has its own timing and distance, independent of lottery results.
export function matrixPushSeeds(count,random=Math.random){
 return Array.from({length:count},()=>({period:4+random()*5,offset:random()*16,distance:1.2+random()*(MATRIX_PUSH_MAX-1.2)}));
}
export function matrixPushDepth(time,seed){
 const phase=((time+seed.offset)%seed.period+seed.period)%seed.period;
 return Math.sin(Math.PI*phase/seed.period)**2*seed.distance;
}
