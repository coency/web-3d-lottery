import {get,RequestError} from './api';
import {onSessionRotation,sessionRotating} from './sessionRotation';
export type Update={all:boolean;ids:string[];activities?:{id:string;ended:boolean;phase:string}[]};
type Listener={update:(change:Update)=>void;status?:(state:'connected'|'reconnecting'|'expired')=>void};
const listeners=new Set<Listener>();
let source:EventSource|null=null,previous=new Map<string,string>(),online=false;
onSessionRotation(rotating=>{
 if(rotating){source?.close();source=null;online=false;}
 else if(listeners.size)start();
});
// A brief offline/online cycle may leave EventSource open without emitting a new
// message. Reopen it explicitly so recovery does not wait for a business change.
window.addEventListener('offline',()=>{
 source?.close();source=null;online=false;
 for(const listener of listeners)listener.status?.('reconnecting');
});
window.addEventListener('online',()=>{if(listeners.size)start();});
function start(){
 if(source||sessionRotating())return;
 source=new EventSource('/api/v1/events');
 const currentSource=source;
 source.addEventListener('sync',event=>{
  if(source!==currentSource)return;
  const rows=JSON.parse((event as MessageEvent).data).activities as {id:string;revision:string;ended:boolean;phase:string}[];
  const next=new Map(rows.map(row=>[row.id,row.revision+':'+row.ended+':'+row.phase]));
  const all=!online,ids=[...new Set([...previous.keys(),...next.keys()])].filter(id=>previous.get(id)!==next.get(id));
  previous=next;online=true;
  for(const listener of listeners){listener.status?.('connected');listener.update({all,ids,activities:rows});}
 });
 const disconnected=()=>{if(source!==currentSource)return;online=false;for(const listener of listeners)listener.status?.('reconnecting');};
 source.onerror=()=>{
  if(source!==currentSource)return;
  disconnected();const failedSource=source;
  void get('/api/v1/auth/me').catch(error=>{
   if(source!==failedSource)return;
   if(error instanceof RequestError&&error.status===401){source?.close();source=null;online=false;for(const listener of listeners)listener.status?.('expired');}
  });
 };
 source.addEventListener('unavailable',disconnected);
 source.addEventListener('session-expired',()=>{if(source!==currentSource)return;source?.close();source=null;online=false;for(const listener of listeners)listener.status?.('expired');});
}
export function subscribeUpdates(update:Listener['update'],status?:Listener['status']){
 const listener={update,status};listeners.add(listener);start();
 if(online){status?.('connected');queueMicrotask(()=>{if(listeners.has(listener))update({all:true,ids:[]});});}
 return ()=>{listeners.delete(listener);if(!listeners.size){source?.close();source=null;online=false;previous.clear();}};
}
