import sharp from 'sharp';
import {fail} from '../auth/security';
export type Provider='wechat'|'mock';
export function oauthProvider():Provider|null{
 const mode=process.env.WECHAT_OAUTH_PROVIDER??'disabled';
 if(mode==='disabled')return null;
 if(mode==='wechat')return 'wechat';
 if(mode==='mock'&&process.env.NODE_ENV==='development'){
  try{const url=new URL(process.env.WECHAT_MOCK_ORIGIN??'');if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.origin===process.env.WECHAT_MOCK_ORIGIN)return 'mock';}catch{}
 }
 fail(503,'WECHAT_PROVIDER_INVALID','微信授权服务配置不正确，请联系管理员');
}
export function oauthReady(){const provider=oauthProvider();if(!provider)return false;if(provider==='mock')return true;try{return new URL(process.env.APP_ORIGIN??'').protocol==='https:';}catch{return false;}}
export function providerOrigin(provider:Provider){return provider==='mock'?process.env.WECHAT_MOCK_ORIGIN!:'https://api.weixin.qq.com';}
export function authorizeUrl(provider:Provider,appId:string,state:string){
 if(provider==='mock'&&!appId.startsWith('mock_'))fail(403,'MOCK_CREDENTIAL_REJECTED','模拟接口只接受专用测试服务号，不能使用真实服务号配置');
 const url=new URL(provider==='mock'?providerOrigin(provider)+'/authorize':'https://open.weixin.qq.com/connect/oauth2/authorize');
 url.search=new URLSearchParams({appid:appId,redirect_uri:process.env.APP_ORIGIN+'/api/v1/wechat/callback',response_type:'code',scope:'snsapi_userinfo',state}).toString();url.hash='wechat_redirect';return url.toString();
}
async function boundedResponse(url:URL,max:number){
 const response=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error'});
 if(!response.ok||Number(response.headers.get('content-length')??0)>max||!response.body)throw new Error();
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error();parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(parts);
}
async function json(provider:Provider,route:string,query:Record<string,string>){
 const url=new URL(route,providerOrigin(provider));url.search=new URLSearchParams(query).toString();
 try{const body=JSON.parse((await boundedResponse(url,65536)).toString('utf8'));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body;}catch{fail(503,'WECHAT_UNAVAILABLE','微信授权服务暂时不可用，请稍后重新授权');}
}
export async function exchangeIdentity(provider:Provider,appId:string,secret:string,code:string){
 if(provider==='mock'&&!appId.startsWith('mock_'))fail(403,'MOCK_CREDENTIAL_REJECTED','模拟接口不能使用真实服务号配置');
 const token=await json(provider,'/sns/oauth2/access_token',{appid:appId,secret,code,grant_type:'authorization_code'});
 if(token.errcode||typeof token.openid!=='string'||!token.openid||token.openid.length>256||typeof token.access_token!=='string'||!token.access_token)
  fail(401,'WECHAT_AUTH_FAILED','微信授权未成功或已失效，请重新授权');
 let profile:any=null;
 try{profile=await json(provider,'/sns/userinfo',{access_token:token.access_token,openid:token.openid,lang:'zh_CN'});}catch{}
 if(profile&&!profile.errcode&&profile.openid!==token.openid)fail(401,'WECHAT_IDENTITY_MISMATCH','微信身份校验未通过，请重新授权');
 const available=profile&&!profile.errcode;
 const nickname=available&&typeof profile.nickname==='string'?profile.nickname.trim().slice(0,64):null;
 let avatar:Buffer|null=null;
 if(available&&typeof profile.headimgurl==='string'){
  try{
   const url=new URL(profile.headimgurl);
   if(provider==='wechat'&&url.protocol==='http:')url.protocol='https:';
   const allowed=provider==='mock'?url.origin===providerOrigin(provider):url.protocol==='https:'&&!url.port&&(url.hostname==='qlogo.cn'||url.hostname.endsWith('.qlogo.cn'));
   if(allowed&&!url.username&&!url.password){const bytes=await boundedResponse(url,2*1024*1024);avatar=await sharp(bytes,{limitInputPixels:4096*4096}).timeout({seconds:5}).rotate().resize(256,256,{fit:'cover'}).webp({quality:90}).toBuffer();if(avatar.length>524288)avatar=null;}
  }catch{avatar=null;}
 }
 return {openid:token.openid as string,nickname:nickname||null,avatar};
}
