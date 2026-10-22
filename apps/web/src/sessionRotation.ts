// Credential updates replace the session cookie. Reads and SSE must not report
// the deliberately retired cookie as a logout while that response is in flight.
let pending:Promise<void>|null=null,release:(()=>void)|null=null,revision=0;
const listeners=new Set<(rotating:boolean)=>void>();
export const sessionRevision=()=>revision;
export const sessionRotating=()=>pending!==null;
export async function waitForSession(){await pending;}
export function beginSessionRotation(){
 revision++;
 pending=new Promise<void>(resolve=>{release=resolve;});
 for(const listener of listeners)listener(true);
 return ()=>{
  release?.();pending=null;release=null;
  for(const listener of listeners)listener(false);
 };
}
export function onSessionRotation(listener:(rotating:boolean)=>void){listeners.add(listener);return()=>listeners.delete(listener);}
