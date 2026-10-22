import {initWaterfallPhysics,createWaterfallPhysics} from './waterfall-physics.js';

let simulation;
self.onmessage=async({data:message})=>{
 try{
  if(message.type==='warmup'){
   await initWaterfallPhysics();self.postMessage({type:'prepared'});return;
  }else if(message.type==='init'){
   await initWaterfallPhysics();simulation?.dispose();simulation=createWaterfallPhysics(message);
  }else if(message.type==='step'){simulation.setHighlights(message.highlights,message.rate);simulation.advance(message.dt);}
  else if(message.type==='resize')simulation.resize(message.view);
  else return;
  const {data,falling,stats}=simulation.snapshot();self.postMessage({type:'snapshot',kind:message.type,data,falling,stats},[data.buffer,falling.buffer]);
 }catch(error){self.postMessage({type:'error',message:error.message});}
};
