// Stable texture cells are independent of box positions. A shuffle changes UV
// indices, not image pixels. Never evict a cell still used by the next frame.
export function createPortraitTiles(capacity=441){
 const entries=new Map();
 return {
  prepared(key){const entry=entries.get(key);return !!entry?.painted&&!entry.dirty;},
  update(keys,dirty=new Set(),isReady=()=>true,maxUpdates=Infinity){
   const needed=new Set(keys);
   if(needed.size>capacity)throw new Error('Portrait texture capacity exceeded');
   for(const [key,entry] of entries)if(dirty===null||dirty.has(key))entry.dirty=true;
   const occupied=new Set([...entries.values()].map(entry=>entry.tile)),updates=[];
   for(const key of needed){
    let entry=entries.get(key);
    if(!entry){
     let tile;
     if(entries.size<capacity){for(tile=0;occupied.has(tile);tile++);}
     else{const evicted=[...entries.keys()].find(key=>!needed.has(key));tile=entries.get(evicted).tile;entries.delete(evicted);}
     entry={tile,dirty:true,painted:false};entries.set(key,entry);occupied.add(tile);
    }
    if(entry.dirty&&updates.length<maxUpdates){
     const ready=isReady(key);
     // A decoded bitmap can be evicted before its load notification is handled.
     // Retain good GPU pixels until it is available again. New cells still need
     // one initial paint, and must remain dirty until their real image arrives.
     if(ready||!entry.painted){updates.push({key,tile:entry.tile});entry.painted=true;entry.dirty=!ready;}
    }
    entries.delete(key);entries.set(key,entry);
   }
   return {indices:keys.map(key=>entries.get(key).tile),updates};
  }
 };
}
