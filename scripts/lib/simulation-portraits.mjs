import {renderSimulationPortrait} from '../../apps/api/build/activities/simulation-portrait.js';

// Isolated browser benchmarks generate their own images, not repository assets.
// Run the API build first. Fixtures stay in memory and never enter public/.
export async function simulationPortraits(count){
 if(!Number.isInteger(count)||count<1||count>5000)throw new RangeError('Invalid fixture count');
 const images=new Array(count);let next=0;
 await Promise.all(Array.from({length:2},async()=>{
  while(next<count){const index=next++;images[index]=await renderSimulationPortrait(index+1);}
 }));
 return images;
}
export async function fulfillSimulationPortrait(route,images){
 const filename=new URL(route.request().url()).pathname.split('/').at(-1);
 const id=/^[1-9]\d{0,3}\.webp$/.test(filename)?Number(filename.slice(0,-5)):0;
 const bytes=images[id-1];
 await route.fulfill(bytes?{contentType:'image/webp',body:bytes}:{status:404,body:''});
}
