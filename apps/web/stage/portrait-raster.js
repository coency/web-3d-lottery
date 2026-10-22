// Reuse immutable 128px portraits. Read-friendly canvases avoid GPU readback
// stalls when the box material samples the portrait's dominant colour.
export function createPortraitRasterizer({maxEntries=384,createCanvas=()=>document.createElement('canvas')}={}){
 const entries=new Map();
 return {
  draw(image,label,size=128,target){
   const cached=!target&&size===128,key=image||'fallback:'+label;
   if(cached&&entries.has(key)){const canvas=entries.get(key);entries.delete(key);entries.set(key,canvas);return canvas;}
   const canvas=target||createCanvas();canvas.width=canvas.height=size;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   ctx.fillStyle='#211b39';ctx.fillRect(0,0,size,size);
   if(image){const edge=Math.min(image.width,image.height);ctx.drawImage(image,(image.width-edge)/2,(image.height-edge)/2,edge,edge,0,0,size,size);}
   else{ctx.fillStyle='#efd5a5';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=(size*.42)+'px sans-serif';ctx.fillText(label,size/2,size/2);}
   if(cached){entries.set(key,canvas);while(entries.size>maxEntries)entries.delete(entries.keys().next().value);}
   return canvas;
  },
  clear(){entries.clear();},
 };
}
