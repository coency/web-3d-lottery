import type { ApiResponse, ApiError } from '@starlit/contracts';
import {beginSessionRotation,sessionRevision,sessionRotating,waitForSession} from './sessionRotation';
export class RequestError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const explanations:Record<string,string>={
 INELIGIBLE_PARTICIPANT:'所选人员未签到、不属于当前活动模式、已失去资格或已获得该奖项。请移除该人员，再选择合资格人员。',
};
async function requestFetch(input:RequestInfo|URL,init?:RequestInit){try{return await fetch(input,init);}catch{throw new RequestError(503,'NETWORK_ERROR','无法连接服务，本次操作结果尚未确认。请检查网络，恢复后刷新查看最新状态再重试。');}}
let csrf = '';
const operations = new Map<string,string>();
async function decode<T>(response: Response): Promise<T> {
  let body: ApiResponse<T> | ApiError;
  try { body = await response.json(); } catch { throw new RequestError(response.status,'NETWORK_ERROR','服务暂时不可用，请稍后重试'); }
  if ('error' in body) throw new RequestError(response.status,body.error.code,explanations[body.error.code]??body.error.message);
  if (!response.ok) throw new RequestError(response.status,'NETWORK_ERROR','请求失败，请重试');
  return body.data;
}
export async function get<T>(path: string) {
  // CSRF preparation may be needed by the credential update itself.
  const sessionRead=path!=='/api/v1/auth/csrf';
  if(sessionRead)await waitForSession();
  const revision=sessionRevision();
  const read=()=>requestFetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
  let response=await read();
  if(sessionRead&&(sessionRotating()||revision!==sessionRevision())){
    await waitForSession();response=await read();
  }
  return decode<T>(response);
}
export async function prepare() {
  const settings = await get<{csrfToken:string}>('/api/v1/auth/csrf');
  csrf = settings.csrfToken;
  return settings;
}
/** Best effort only: page exit cannot wait for token refresh or retries. */
export function releaseOnExit(path:string,body:unknown){
 if(!csrf)return;
 void fetch(path,{
  method:'POST',credentials:'same-origin',keepalive:true,
  headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':crypto.randomUUID()},
  body:JSON.stringify(body),
 }).catch(()=>{/* The server lease still expires if the browser cannot deliver. */});
}
export async function post<T>(action: string, body: Record<string,string>): Promise<T> {
  if (!csrf) await prepare();
  const signature = action + JSON.stringify(body);
  let key = operations.get(signature);
  if (!key) { key = crypto.randomUUID(); operations.set(signature,key); }
  const finishRotation=action==='change-password'?beginSessionRotation():undefined;
  // Retain key only while a response is unknown, so retry cannot repeat a write.
  try {
    let response = await requestFetch('/api/v1/auth/' + action,{
      method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key},
      body:JSON.stringify(body),signal:AbortSignal.timeout(15000),
    });
    if (response.status === 403) {
      await prepare();
      response = await requestFetch('/api/v1/auth/' + action,{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key},
        body:JSON.stringify(body),signal:AbortSignal.timeout(15000),
      });
    }
    const data = await decode<T>(response);
    operations.delete(signature);
    return data;
  } catch (error) {
    if (error instanceof RequestError && error.status>=400 && error.status<500 && error.code!=='NETWORK_ERROR') operations.delete(signature);
    throw error;
  } finally {finishRotation?.();}
}

/** Business writes keep their UUID after an unknown response; server scopes it to the user. */
const fileOperations = new WeakMap<Blob,string>();
export async function write<T>(path:string,method:'POST'|'PATCH'|'PUT',body:unknown,extra:Record<string,string>={}):Promise<T>{
 if(!csrf)await prepare();
 const binary=body instanceof Blob;
 const signature=method+path+JSON.stringify(extra)+(binary?'':JSON.stringify(body));
 let key=binary?fileOperations.get(body as Blob):operations.get(signature);
 if(!key){key=crypto.randomUUID();if(binary)fileOperations.set(body as Blob,key);else operations.set(signature,key);}
 const send=()=>requestFetch(path,{method,credentials:'same-origin',headers:{...extra,'Content-Type':binary?'application/octet-stream':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':key!},body:binary?body as Blob:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const clear=()=>{if(binary)fileOperations.delete(body as Blob);else operations.delete(signature);};
 try{
  let response=await send();
  if(response.status===403){await prepare();response=await send();}
  const result=await decode<T>(response);clear();return result;
 }catch(error){if(error instanceof RequestError&&error.status>=400&&error.status<500&&error.code!=='NETWORK_ERROR')clear();throw error;}
}

export async function download(path:string,filename:string){
 const response=await requestFetch(path,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});
 if(!response.ok){await decode(response);return;}
 const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
}
