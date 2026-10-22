export const PORTRAIT_INTERVAL=3000;
export const PORTRAIT_ROLLING_INTERVAL=180;
export const PORTRAIT_BATCH=60;

// Carry already displayed people into another layout. Validate against the
// current roster, preserve positions, and leave holes for the normal queue.
export function retainPortraitSlots(visible,known,capacity){
 const used=new Set();
 return Array.from({length:capacity},(_,index)=>{
  const id=visible[index];
  if(id===null||!known.has(id)||used.has(id))return null;
  used.add(id);return id;
 });
}

// Stable participant IDs keep the queue intact when the roster is reordered.
// This queue controls presentation only and never selects lottery winners.
export function createPortraitRotation(capacity=300,random=Math.random){
 const shuffle=values=>{const a=[...values];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 let known=new Set(),pending=[],slots=Array(capacity).fill(null),order=shuffle(Array.from({length:capacity},(_,i)=>i));
 function update(ids,visibleSlots){
  const next=new Set(ids),added=shuffle([...next].filter(id=>!known.has(id)));
  slots=retainPortraitSlots(visibleSlots??slots,next,capacity);
  pending=[...added,...pending.filter(id=>next.has(id))];known=next;
  const visible=new Set(slots.filter(id=>id!==null));
  pending=[...new Set(pending)].filter(id=>!visible.has(id));
  // Removed participants leave holes; fill these without replacing other slots.
  const empty=order.filter(i=>slots[i]===null),filled=[];
  const waiting=new Set(pending);
  const available=empty.length?shuffle([...known].filter(id=>!visible.has(id)&&!waiting.has(id))):[];
  for(const index of empty){const id=pending.length?pending.shift():available.shift();if(id===undefined)break;slots[index]=id;filled.push(index);}
  const renewed=new Set(filled);order=[...order.filter(i=>!renewed.has(i)),...filled];
  return [...slots];
 }
 function shuffleSlots(){
   if(known.size){
    const indices=shuffle(Array.from({length:capacity},(_,i)=>i)).slice(0,PORTRAIT_BATCH);
    const first=slots[indices[0]];
    for(let i=0;i<indices.length-1;i++)slots[indices[i]]=slots[indices[i+1]];
    slots[indices.at(-1)]=first;
   }
 }
 function advance({shuffleVisible=false,isReady=()=>true}={}){
  if(known.size<=capacity){
   if(shuffleVisible)shuffleSlots();
   return [...slots];
  }
  if(!pending.length){const visible=new Set(slots);pending=shuffle([...known].filter(id=>!visible.has(id)));}
  // Near capacity there may be fewer than 60 off-screen people. Never duplicate
  // a visible person or cycle the same person twice within a single update.
  // Keep unprepared portraits queued. Disk caching alone does not mean a bitmap
  // can be painted yet. Other ready people may advance past a slow/failed image.
  const next=pending.slice(0,PORTRAIT_BATCH).filter(isReady),selected=new Set(next),count=next.length;
  pending=pending.filter(id=>!selected.has(id));
  for(const id of next){const index=order.shift();slots[index]=id;order.push(index);}
  if(shuffleVisible&&count<PORTRAIT_BATCH)shuffleSlots();
  return [...slots];
 }
 function upcoming(){if(!pending.length&&known.size>capacity){const visible=new Set(slots);pending=shuffle([...known].filter(id=>!visible.has(id)));}return pending.slice(0,PORTRAIT_BATCH);}
 return {update,advance,upcoming};
}
