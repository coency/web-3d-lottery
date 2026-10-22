import {createHash} from 'node:crypto';
import {lstat,open,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
import type {PoolClient} from 'pg';
import {fail} from '../auth/security';

const validName=(name:string)=>name.length<=128&&/^MP_verify_[A-Za-z0-9_]+\.txt$/.test(name);
const directory=()=>process.env.WECHAT_VERIFICATION_DIRECTORY??(process.env.NODE_ENV==='development'?path.resolve('.local/verification'):'/var/lib/starlit/verification');
export async function uploadVerificationFile(filename:unknown,content:unknown){
 if(typeof filename!=='string'||!validName(filename))fail(422,'INVALID_VERIFICATION_FILE','请选择微信提供的 MP_verify_*.txt 原文件');
 if(typeof content!=='string'||Buffer.byteLength(content)>4096||!/^[A-Za-z0-9_-]{8,256}$/.test(content.trim()))fail(422,'INVALID_VERIFICATION_CONTENT','校验文件内容不正确，请上传微信提供的原文件');
 await mkdir(directory(),{recursive:true,mode:0o755});
 let handle;
 try{handle=await open(path.join(directory(),filename),'wx',0o644);}catch(e){
  if((e as NodeJS.ErrnoException).code==='EEXIST'){
   const existing=await verificationFile(filename);
   if(!existing.bytes.equals(Buffer.from(content)))fail(409,'VERIFICATION_FILE_CONFLICT','服务器已有同名但内容不同的校验文件，请核对原文件');
   return {filename};
  }
  fail(503,'VERIFICATION_UPLOAD_UNAVAILABLE','校验文件目录无法写入，请联系维护人员检查部署目录权限');
 }
 try{await handle.writeFile(content);}finally{await handle.close();}
 return {filename};
}
export function verificationOrigin(){
 try{const u=new URL(process.env.APP_ORIGIN??'');if(u.protocol==='https:'&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&process.env.WECHAT_OAUTH_PROVIDER==='wechat')return u.origin;}catch{}
 return null;
}
export async function verificationFiles(){
 try{return (await readdir(directory(),{withFileTypes:true})).filter(e=>e.isFile()&&validName(e.name)).map(e=>e.name).sort().slice(0,100);}catch{return [];}
}
export async function verificationFile(filename:string){
 if(!validName(filename))fail(422,'INVALID_VERIFICATION_FILE','请填写微信提供的完整 MP_verify_*.txt 文件名');
 const file=path.join(directory(),filename);
 try{
  const stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw new Error();
  const handle=await open(file,'r');
  try{
   const buffer=Buffer.alloc(4097),{bytesRead}=await handle.read(buffer,0,4097,0);
   const bytes=buffer.subarray(0,bytesRead);
   if(bytesRead>4096||!bytesRead||!/^[A-Za-z0-9_-]{8,256}$/.test(bytes.toString('utf8').trim()))throw new Error();
   return {bytes,hash:createHash('sha256').update(bytes).digest('hex')};
  }finally{await handle.close();}
 }catch{fail(422,'VERIFICATION_FILE_UNAVAILABLE','校验文件不存在、无法读取或内容不正确，请将微信原文件上传到部署目录的 data/verification/');}
}
// The origin comes only from deployment configuration, never from a request URL.
export async function checkVerificationFile(filename:string,fetcher:typeof fetch=fetch){
 const origin=verificationOrigin();
 if(!origin)fail(409,'WECHAT_DEPLOYMENT_NOT_READY','请配置公网 HTTPS 域名并启用微信接入后再检查');
 const local=await verificationFile(filename);
 try{
  const response=await fetcher(origin+'/'+filename,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Cache-Control':'no-cache'}});
  if(!response.ok||!response.body)throw new Error();
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096)throw new Error();parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  if(!Buffer.concat(parts).equals(local.bytes))throw new Error();
 }catch{fail(422,'VERIFICATION_FILE_UNREACHABLE','无法通过公网 HTTPS 域名读取一致的校验文件，请检查域名、证书和文件存放位置');}
 return {origin,filename,hash:local.hash};
}
export async function wechatReadiness(c:PoolClient,id:string){
 const result=(await c.query(`SELECT w.credential_id,
  EXISTS(SELECT 1 FROM activity_wechat_verifications v WHERE v.activity_id=$1::text::uuid
   AND v.credential_id=w.credential_id AND v.verified_at<=clock_timestamp() AND v.valid_until>clock_timestamp()) AS oauth_verified,
  r.origin,r.filename,r.file_hash,r.checked_at
  FROM wechat_configurations w LEFT JOIN activity_wechat_readiness r
   ON r.activity_id=$1::text::uuid AND r.credential_id=w.credential_id
  WHERE w.scope=$1::text`,[id])).rows[0];
 let fileReady=false;
 if(result?.filename&&result.origin===verificationOrigin()){
  try{fileReady=(await verificationFile(result.filename)).hash===result.file_hash;}catch{}
 }
 const oauthVerified=!!result?.oauth_verified;
 return {ready:fileReady||oauthVerified,oauthVerified,domainConfirmed:fileReady,
  filename:result?.filename??'',checkedAt:fileReady?result.checked_at:null};
}
