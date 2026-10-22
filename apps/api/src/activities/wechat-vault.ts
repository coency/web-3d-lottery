import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {fail} from '../auth/security';
type Box={iv:string;tag:string;data:string};
export type SealedSecret={v:1;key:Box;secret:Box};
export function vaultReady(){return /^[0-9a-f]{64}$/i.test(process.env.WECHAT_MASTER_KEY??'');}
function master(){if(!vaultReady())fail(503,'WECHAT_VAULT_UNAVAILABLE','服务号密钥存储尚未配置，请联系部署维护人员');return Buffer.from(process.env.WECHAT_MASTER_KEY!,'hex');}
function encrypt(key:Buffer,value:Buffer,aad:string):Box{
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));
 const bytes=Buffer.concat([cipher.update(value),cipher.final()]);
 return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')};
}
function decrypt(key:Buffer,box:Box,aad:string){
 const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(box.iv,'base64'));cipher.setAAD(Buffer.from(aad));cipher.setAuthTag(Buffer.from(box.tag,'base64'));
 return Buffer.concat([cipher.update(Buffer.from(box.data,'base64')),cipher.final()]);
}
export function sealSecret(value:string,id:string):SealedSecret{
 const key=randomBytes(32);try{return {v:1,key:encrypt(master(),key,'wechat-key:'+id),secret:encrypt(key,Buffer.from(value),'wechat-secret:'+id)};}finally{key.fill(0);}
}
export function openSecret(box:SealedSecret,id:string){
 const root=master();let key:Buffer|undefined;
 try{if(box.v!==1)throw new Error();key=decrypt(root,box.key,'wechat-key:'+id);return decrypt(key,box.secret,'wechat-secret:'+id).toString('utf8');}
 catch{fail(503,'WECHAT_VAULT_UNAVAILABLE','服务号密钥无法读取，请联系部署维护人员检查密钥配置');}
 finally{root.fill(0);key?.fill(0);}
}
