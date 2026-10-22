// Files are scoped by account, activity, mode and reset generation. Avatar URLs
// contain immutable IDs; a replacement avatar therefore has a different key.
const gracePeriod=7*86400000;
const expiry=value=>{const date=Date.parse(value);return Number.isFinite(date)?date+gracePeriod:null;};
export function createPortraitStore(scope, {indexedDB=globalThis.indexedDB, now=Date.now,activityExpiresAt,activityExpiries=new Map()}={}) {
 const family=scope.slice(0,scope.lastIndexOf(':')+1);
 const activityKey=scope.split(':').slice(0,2).join(':');
 if(expiry(activityExpiresAt)!==null)activityExpiries.set(activityKey,expiry(activityExpiresAt));
 let connection, closed=false;
 const opened=new Promise((resolve,reject)=>{
  if(!indexedDB){reject(new Error('Local storage unavailable'));return;}
  const request=indexedDB.open('starlit-portraits-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'key'});
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(new Error('Local storage blocked'));
  request.onsuccess=()=>{connection=request.result;connection.onversionchange=()=>connection.close();if(closed)connection.close();resolve(connection);};
 });
 // Attach a handler immediately; browsers without storage still render online.
 opened.catch(()=>{});
 async function transaction(mode,run){
  const db=await opened;if(closed)throw new Error('Store closed');
  return new Promise((resolve,reject)=>{
   const tx=db.transaction('files',mode),store=tx.objectStore('files');let value;
   tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Local storage failed'));
   run(store,result=>{value=result;});
  });
 }
 return {
  async get(url){return transaction('readonly',(store,done)=>{const req=store.get(scope+'|'+url);req.onsuccess=()=>done(req.result?.blob??null);});},
  async put(url,blob){return transaction('readwrite',store=>store.put({key:scope+'|'+url,scope,blob,savedAt:now(),expiresAt:activityExpiries.get(activityKey)??null}));},
  async remove(url){return transaction('readwrite',store=>store.delete(scope+'|'+url));},
  async prune(){return transaction('readwrite',store=>{
   const req=store.openCursor(),time=now();
   req.onsuccess=()=>{const cursor=req.result;if(!cursor)return;const row=cursor.value;
    // Refresh known dates before pruning: an activity may have been extended.
    // Legacy/unrecognised entries retain the previous 30-day fallback.
    const expiresAt=activityExpiries.get(row.scope.split(':').slice(0,2).join(':'))??row.expiresAt??row.savedAt+30*86400000;
    if(time>=expiresAt||(scope&&row.scope.startsWith(family)&&row.scope!==scope))cursor.delete();
    else if(row.expiresAt!==expiresAt)cursor.update({...row,expiresAt});
    cursor.continue();};
  });},
  close(){closed=true;connection?.close();},
 };
}

// Called after loading the activity list, so cleanup also runs without opening a stage.
export async function prunePortraitCaches(accountId,activities,options={}){
 const activityExpiries=new Map();
 for(const activity of activities){const end=expiry(activity.expires_at);if(end!==null)activityExpiries.set(accountId+':'+activity.id,end);}
 const store=createPortraitStore('',{...options,activityExpiries});
 try{await store.prune();}finally{store.close();}
}
