// Shared by every theme: only decoded participant photos replace the brand.
export function createStagePortraits({images,getPortraits,getLogoUrl,raster,createCanvas=()=>document.createElement('canvas')}){
 const systemLogo='/favicon.svg';images.load(systemLogo);
 const usesBrand=person=>!person?.avatarUrl||person.avatarUrl==='/avatar-placeholder.svg';
 const brandImage=()=>images.get(getLogoUrl())||images.get(systemLogo);
 let cachedSource,cachedCanvas;
 function logo(size=128,transparent=false,target){
  const image=brandImage();
  if(!target&&!transparent&&size===128&&cachedCanvas&&cachedSource===image)return cachedCanvas;
  const canvas=target||createCanvas();canvas.width=canvas.height=size;const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!transparent){ctx.fillStyle='#211b39';ctx.fillRect(0,0,size,size);}
  if(image){const scale=size*.9/Math.max(image.width,image.height),w=image.width*scale,h=image.height*scale;ctx.drawImage(image,(size-w)/2,(size-h)/2,w,h);}
  else{
   // Draw the bundled brand mark synchronously, even before its SVG loads.
   ctx.save();ctx.scale(size/64,size/64);ctx.fillStyle='#efd5a5';ctx.beginPath();ctx.moveTo(32,2);
   ctx.bezierCurveTo(36,22,42,28,62,32);ctx.bezierCurveTo(42,36,36,42,32,62);
   ctx.bezierCurveTo(28,42,22,36,2,32);ctx.bezierCurveTo(22,28,28,22,32,2);ctx.closePath();ctx.fill();ctx.restore();
  }
  if(!target&&!transparent&&size===128){cachedSource=image;cachedCanvas=canvas;}return canvas;
 }
 function avatar(person,size=128,target){
  if(usesBrand(person)||person.avatarUrl===getLogoUrl())return logo(size,false,target);
  const image=getPortraits()?.get(person.avatarUrl);
  return image?raster.draw(image,'',size,target):logo(size,false,target);
 }
 avatar.usesBrand=usesBrand;
 avatar.preload=persons=>persons.forEach(person=>{if(!usesBrand(person))getPortraits()?.preload(person.avatarUrl);});
 avatar.isReady=person=>{if(usesBrand(person))return true;const url=person.avatarUrl;if(url===getLogoUrl())return !!images.get(url);const portraits=getPortraits();if(portraits?.isReady(url))return true;portraits?.preload(url);return false;};
 logo.url=getLogoUrl;logo.version=brandImage;logo.changed=urls=>urls===null||urls.has(getLogoUrl())||urls.has(systemLogo);
 return {avatar,logo};
}
