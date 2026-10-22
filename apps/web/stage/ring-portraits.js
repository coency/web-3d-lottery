import {retainPortraitSlots} from './portrait-rotation.js';
// Presentation queue only: replace a whole ring after it leaves the viewport.
export function createRingPortraitRotation(layers,perRing,random=Math.random,{shuffleLayer=false}={}){
 const capacity=layers*perRing;
 let slots=Array(capacity).fill(null);
 let known=new Set(),pending=[];
 const shuffle=values=>{const a=[...values];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 function fill(indices){
  const visible=new Set(slots.filter(id=>id!==null));
  for(const i of indices){
   if(slots[i]!==null)continue;
   if(!pending.length)pending=shuffle([...known].filter(id=>!visible.has(id)));
   while(pending.length&&visible.has(pending[0]))pending.shift();
   const id=pending.shift();if(id===undefined)continue;
   slots[i]=id;visible.add(id);
  }
 }
 function update(ids,visibleSlots){
  const next=new Set(ids),added=[...next].filter(id=>!known.has(id));
  slots=retainPortraitSlots(visibleSlots??slots,next,capacity);
  const visible=new Set(slots);
  pending=[...shuffle(added),...pending.filter(id=>next.has(id))].filter(id=>!visible.has(id));known=next;
  fill(shuffle(Array.from({length:capacity},(_,i)=>i)));
  return [...slots];
 }
 function advanceLayer(layer){
  if(!Number.isInteger(layer)||layer<0||layer>=layers)throw new RangeError('Invalid ring layer');
  const indices=Array.from({length:perRing},(_,i)=>layer*perRing+i);
  for(const i of indices)slots[i]=null;
  // Corridor columns contain left slots followed by right slots. Randomize the
  // refill order so sparse populations do not accumulate on the left wall.
  fill(shuffleLayer?shuffle(indices):indices);return [...slots];
 }
 function upcoming(){if(!pending.length){const visible=new Set(slots);pending=shuffle([...known].filter(id=>!visible.has(id)));}return pending.slice(0,Math.max(perRing,60));}
 return {update,advanceLayer,upcoming};
}
