import {Controller,Get,Put,Post,HttpCode,Param,Req,Res} from '@nestjs/common';
import type {Request,Response} from 'express';
import type {PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {DatabaseService} from '../database.service';
import {ActivitiesService} from './activities.service';
import {envelope} from '../http';
import {fail,validateWrite} from '../auth/security';
import {object} from './validation';
import {openSecret,sealSecret,vaultReady} from './wechat-vault';
import {checkVerificationFile,verificationFile,verificationFiles,verificationOrigin,wechatReadiness,uploadVerificationFile} from './wechat-readiness';

@Controller('api/v1')
export class WechatConfigurationController {
 constructor(private db:DatabaseService,private activities:ActivitiesService){}
 private async context(c:PoolClient,req:Request,id:string){
  const user=await this.activities.identity(c,req,'user');
  const activity=await this.activities.access(c,user.id,id);
  let config=(await c.query('SELECT * FROM wechat_configurations WHERE scope=$1 FOR UPDATE',[id])).rows[0];
  if(!config){
   config={scope:id,source:'custom',credential_id:null,version:'1'};
   if(!activity.ended)await c.query("INSERT INTO wechat_configurations(scope,source) VALUES($1,'custom')",[id]);
  }
  const credential=config.credential_id?(await c.query('SELECT * FROM wechat_credentials WHERE id=$1',[config.credential_id])).rows[0]:null;
  if(credential&&config.source==='custom'&&(credential.owner_id!==user.id||credential.activity_id!==id))fail(403,'WECHAT_SCOPE_REJECTED','服务号配置不属于本场活动');
  const formalPeople=id?!!(await c.query("SELECT 1 FROM activity_participants p JOIN activity_runs r ON r.id=p.run_id WHERE p.activity_id=$1 AND r.mode='formal' LIMIT 1",[id])).rowCount:false;
  const drawing=id?!!(await c.query("SELECT 1 FROM draw_rounds WHERE activity_id=$1 AND status='drawing'",[id])).rowCount:false;
  const lockedReason=activity?.ended||activity?.phase==='expired'?'活动已到期，服务号配置仅供查看':formalPeople?'已有正式签到人员，服务号配置已锁定':drawing?'当前正在抽奖，请完成本轮后再修改':'';
  const readiness=await wechatReadiness(c,id);
  return {user,activity,config,credential,lockedReason,readiness};
 }
 private view(x:Awaited<ReturnType<WechatConfigurationController['context']>>){return {
  source:x.config.source,version:x.config.version,appId:x.credential?.app_id??'',accountName:x.credential?.account_name??'',secretConfigured:!!x.credential,
  status:x.readiness.ready?'ready':x.credential?'pending_validation':'not_configured',customAllowed:true,lockedReason:x.lockedReason,vaultReady:vaultReady(),legacyBinding:x.config.source==='platform'&&!!x.credential,
  ...x.readiness,origin:verificationOrigin(),
  message:x.readiness.ready?'微信接入已就绪':x.credential?'配置已保存，请完成域名设置后检查微信接入':'尚未配置服务号，正式微信签到暂不可用',
 };}
 private async get(req:Request,res:Response,id:string){res.setHeader('Cache-Control','no-store');const config=await this.db.transaction(async c=>this.view(await this.context(c,req,id)));return envelope({...config,verificationFiles:await verificationFiles()},res);}
 private async save(req:Request,res:Response,id:string){
  validateWrite(req);const body=object(req.body,['source','appId','accountName','appSecret']);
  if(body.source!=='custom')fail(422,'INVALID_WECHAT_SOURCE','请配置本场活动自己的微信服务号');
  return envelope(await this.db.transaction(async c=>{
   const x=await this.context(c,req,id);
   return this.activities.receipt(c,x.user.id,req,'wechat-config:'+id,{body,version:req.get('if-match')},async()=>{
    if(x.lockedReason)fail(409,'WECHAT_CONFIG_LOCKED',x.lockedReason);
    if(req.get('if-match')!==String(x.config.version))fail(409,'VERSION_CONFLICT','服务号配置已更新，请重新加载后再保存');
    let credentialId:string;
    {
     const appId=typeof body.appId==='string'?body.appId.trim():'',name=typeof body.accountName==='string'?body.accountName.trim():'',secret=typeof body.appSecret==='string'?body.appSecret.trim():'';
     if(!appId||appId.length>64||/\s/.test(appId))fail(422,'INVALID_APP_ID','请输入有效 AppID，最多 64 个字符且不能含空格');
     if(!name||name.length>80)fail(422,'INVALID_ACCOUNT_NAME','请输入服务号名称，最多 80 个字');
     if(secret.length>256)fail(422,'INVALID_APP_SECRET','AppSecret 长度不正确');
     const reusable=x.credential&&x.config.source===body.source&&x.credential.app_id===appId;
     if(!secret&&!reusable)fail(422,'APP_SECRET_REQUIRED','首次配置或更换 AppID 时，请填写 AppSecret');
     credentialId=randomUUID();
     const sealed=sealSecret(secret||(openSecret(x.credential.sealed_secret,x.credential.id)),credentialId);
     await c.query('INSERT INTO wechat_credentials(id,owner_id,activity_id,app_id,account_name,sealed_secret) VALUES($1,$2,$3,$4,$5,$6)',[credentialId,x.user.id,id,appId,name,JSON.stringify(sealed)]);
    }
    const updated=(await c.query('UPDATE wechat_configurations SET source=$2,credential_id=$3,version=version+1,updated_at=clock_timestamp() WHERE scope=$1 RETURNING *',[id,body.source,credentialId])).rows[0];
    if(id)await c.query('DELETE FROM activity_wechat_verifications WHERE activity_id=$1',[id]);
    await c.query('DELETE FROM activity_wechat_readiness WHERE activity_id=$1',[id]);
    await this.activities.audit(c,x.user.id,x.user.id,'wechat_configuration_saved',{source:body.source,credentialId,version:updated.version},id);
    return this.view(await this.context(c,req,id));
   });
  }),res);
 }
 private async check(req:Request,res:Response,id:string){
  validateWrite(req);const body=object(req.body,['filename','domainConfirmed']);
  const snapshot=await this.db.transaction(async c=>{
   const x=await this.context(c,req,id);
   if(!x.credential)fail(409,'WECHAT_NOT_CONFIGURED','请先保存服务号配置');
   if(x.activity.ended)fail(410,'ACTIVITY_ENDED','活动已到期，仅供查看');
   if(req.get('if-match')!==String(x.config.version))fail(409,'VERSION_CONFLICT','服务号配置已更新，请重新打开配置后检查');
   openSecret(x.credential.sealed_secret,x.credential.id);
   if(body.domainConfirmed!==true)fail(422,'DOMAIN_CONFIRMATION_REQUIRED','请先在微信后台保存网页授权域名，并勾选完成确认');
   if(typeof body.filename!=='string')fail(422,'INVALID_VERIFICATION_FILE','请填写微信校验文件名');
   return {credentialId:x.credential.id,version:String(x.config.version)};
  });
  let checked:Awaited<ReturnType<typeof checkVerificationFile>>;
  try{checked=await checkVerificationFile(body.filename as string);}catch(error){
   await this.db.transaction(async c=>{
    const x=await this.context(c,req,id);
    if(x.credential?.id===snapshot.credentialId)await c.query('DELETE FROM activity_wechat_readiness WHERE activity_id=$1 AND credential_id=$2',[id,snapshot.credentialId]);
   });throw error;
  }
  return envelope(await this.db.transaction(async c=>{
   const x=await this.context(c,req,id);
   if(x.activity.ended)fail(410,'ACTIVITY_ENDED','活动已到期，仅供查看');
   if(x.credential?.id!==snapshot.credentialId||String(x.config.version)!==snapshot.version||verificationOrigin()!==checked.origin||(await verificationFile(checked.filename)).hash!==checked.hash)fail(409,'VERSION_CONFLICT','接入配置或文件已变化，请重新检查');
   await c.query(`INSERT INTO activity_wechat_readiness(activity_id,credential_id,origin,filename,file_hash,confirmed_by)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(activity_id) DO UPDATE SET credential_id=EXCLUDED.credential_id,
    origin=EXCLUDED.origin,filename=EXCLUDED.filename,file_hash=EXCLUDED.file_hash,confirmed_by=EXCLUDED.confirmed_by,checked_at=clock_timestamp()`,[id,snapshot.credentialId,checked.origin,checked.filename,checked.hash,x.user.id]);
   await this.activities.audit(c,x.user.id,x.user.id,'wechat_readiness_checked',{filename:checked.filename,origin:checked.origin},id);
   return {status:'ready',message:'微信接入已就绪，可前往模式切换启用正式活动'};
  }),res);
 }
 @Post('activities/:id/wechat/verification-file') @HttpCode(200)
 async upload(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){
  validateWrite(req);const body=object(req.body,['filename','content']);
  return envelope(await this.db.transaction(async c=>{
   const x=await this.context(c,req,id);
   if(!x.credential)fail(409,'WECHAT_NOT_CONFIGURED','请先保存服务号配置');
   if(x.activity.ended)fail(410,'ACTIVITY_ENDED','活动已到期，仅供查看');
   if(req.get('if-match')!==String(x.config.version))fail(409,'VERSION_CONFLICT','服务号配置已更新，请重新打开配置后上传');
   const result=await uploadVerificationFile(body.filename,body.content);
   await this.activities.audit(c,x.user.id,x.user.id,'wechat_verification_uploaded',{filename:result.filename},id);
   return result;
  }),res);
 }
 @Get('activities/:id/wechat') getActivity(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return this.get(r,s,id);}
 @Put('activities/:id/wechat') saveActivity(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return this.save(r,s,id);}
 @Post('activities/:id/wechat/check') @HttpCode(200) checkActivity(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return this.check(r,s,id);}
}
