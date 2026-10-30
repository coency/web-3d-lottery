import {auditActions,auditView} from './audit-view';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { Request } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { DatabaseService } from '../database.service';
import { AuthService } from '../auth/auth.service';
import { cookie, fail, mac, validateWrite } from '../auth/security';
import { activityInput, object, text, uuid } from './validation';

@Injectable()
export class ActivitiesService {
 private processing=0;
 private storage=path.resolve(process.env.ASSET_DIRECTORY ?? path.join(process.cwd(),'.local','uploads'));
 constructor(private db:DatabaseService,private auth:AuthService){}
 async identity(c:PoolClient,req:Request,role='user'){
  const user=await this.auth.session(c,cookie(req,'starlit_session'));
  if(!user)fail(401,'SESSION_INVALID','登录已失效，请重新登录');
  if(user.role!==role)fail(403,'ROLE_REJECTED','没有此操作权限');
  return user;
 }
 async access(c:PoolClient,owner:string,id:string,write=false){
  if(!uuid(id))fail(404,'NOT_FOUND','活动不存在');
  const row=(await c.query('SELECT *,expires_at<=clock_timestamp() AS ended FROM activities WHERE owner_id=$1 AND id=$2 FOR UPDATE',[owner,id])).rows[0];
  if(!row)fail(404,'NOT_FOUND','活动不存在');
  if(write&&(row.ended||row.phase==='expired'))fail(410,'ACTIVITY_ENDED','活动已到期，只能查看，不能修改或延期');
  return row;
 }
 async receipt<T>(c:PoolClient,owner:string,req:Request,action:string,body:unknown,run:()=>Promise<T>):Promise<T>{
  const key=req.get('idempotency-key')!, hash=mac(action+':'+JSON.stringify(body));
  const old=(await c.query('SELECT * FROM business_operations WHERE owner_id=$1 AND key=$2',[owner,key])).rows[0];
  if(old){if(old.request_hash!==hash)fail(409,'OPERATION_CONFLICT','该操作编号已用于其他内容');return old.receipt;}
  const data=await run();
  await c.query('INSERT INTO business_operations(owner_id,key,request_hash,receipt) VALUES ($1,$2,$3,$4)',[owner,key,hash,JSON.stringify(data)]);
  return data;
 }
 async audit(c:PoolClient,actor:string,target:string,action:string,details:unknown,activity:string|null=null){
  if(activity&&details&&typeof details==='object'&&!('mode' in details)){
   const mode=(await c.query('SELECT phase FROM activities WHERE id=$1',[activity])).rows[0]?.phase;
   if(mode==='rehearsal'||mode==='formal')details={...details,mode};
  }
  await c.query('INSERT INTO business_audit(actor_id,target_user_id,activity_id,action,details) VALUES ($1,$2,$3,$4,$5)',[actor,target,activity,action,JSON.stringify(details)]);
  if(activity)await c.query('UPDATE activity_revisions SET revision=revision+1 WHERE activity_id=$1',[activity]);
 }
 private async entitlement(c:PoolClient,id:string){
  const row=(await c.query(`SELECT u.created_activity_count,e.paid_until,
   coalesce(e.paid_until>clock_timestamp(),false) AS paid,clock_timestamp() AS server_now
   FROM users u LEFT JOIN entitlements e ON e.user_id=u.id WHERE u.id=$1`,[id])).rows[0];
  return {...row,can_create:true,free_remaining:null,custom_wechat_allowed:true};
 }
 async operations(req:Request,id:string){
  const q=object(req.query,['page','category','mode','start','end']);
  const page=Number(q.page??1),category=String(q.category??'all'),mode=String(q.mode??'all');
  if(!Number.isSafeInteger(page)||page<1||page>1000000)fail(422,'INVALID_PAGE','页码不正确');
  if(!['all','settings','participants','draw','data'].includes(category)||!['all','rehearsal','formal'].includes(mode))fail(422,'INVALID_FILTER','请选择有效的筛选条件');
  const day=(v:unknown)=>{if(v===undefined||v==='')return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail(422,'INVALID_DATE','请选择有效日期');return v;};
  const start=day(q.start),end=day(q.end);if(start&&end&&start>end)fail(422,'INVALID_DATE','开始日期不能晚于结束日期');
  return this.db.transaction(async c=>{
   const user=await this.identity(c,req),activity=await this.access(c,user.id,id);
   const actions=Object.entries(auditActions).filter(([,v])=>category==='all'||v.category===category).map(([key])=>key);
   const params=[user.id,id,actions,mode,start?start+'T00:00:00+08:00':null,end?new Date(Date.parse(end+'T00:00:00+08:00')+86400000).toISOString():null];
   const sql=`FROM business_audit a
    JOIN users u ON u.id=a.actor_id
    LEFT JOIN activity_runs r ON r.id::text=a.details->>'runId' AND r.activity_id=a.activity_id
    WHERE a.target_user_id=$1 AND a.activity_id=$2 AND a.action=ANY($3::text[])
    AND ($4='all' OR coalesce(a.details->>'mode',r.mode)=$4)
    AND ($5::timestamptz IS NULL OR a.created_at>=$5) AND ($6::timestamptz IS NULL OR a.created_at<$6)`;
   const total=(await c.query('SELECT count(*)::int n '+sql,params)).rows[0].n;
   const rows=(await c.query(`SELECT a.id,a.created_at,a.action,a.details,u.role AS actor_role,
    CASE WHEN coalesce(a.details->>'mode',r.mode) IN ('rehearsal','formal') THEN coalesce(a.details->>'mode',r.mode) ELSE NULL END AS operation_mode `+sql+' ORDER BY a.created_at DESC,a.id DESC LIMIT 25 OFFSET $7',[...params,(page-1)*25])).rows;
   return {items:rows.map(auditView),total,page,pageSize:25,phase:activity.ended?'expired':activity.phase};
  });
 }
 async mine(req:Request){return this.db.transaction(async c=>this.entitlement(c,(await this.identity(c,req)).id));}
 async list(req:Request,id?:string){return this.db.transaction(async c=>{
  const user=await this.identity(c,req);
  if(id)return this.view(await this.access(c,user.id,id));
  return (await c.query("SELECT a.*,expires_at<=clock_timestamp() AS ended,(SELECT count(*)::int FROM activity_participants p JOIN activity_runs r ON r.id=p.run_id AND r.generation=p.generation WHERE p.activity_id=a.id AND r.mode=CASE WHEN a.phase='formal' OR a.first_formal_started_at IS NOT NULL THEN 'formal' ELSE 'rehearsal' END) AS participant_count FROM activities a WHERE owner_id=$1 ORDER BY created_at DESC,id DESC",[user.id])).rows.map(r=>this.view(r));
 });}
 private view(r:any){return {...r,owner_id:undefined,location:undefined,display:Object.fromEntries(Object.entries(r.display).filter(([key])=>key!=='location')),phase:r.ended?'expired':r.phase,mode:r.phase==='formal'||r.first_formal_started_at?'formal':'rehearsal',
  logoUrl:r.logo_asset_id?'/api/v1/assets/'+r.logo_asset_id+'/content':null,h5BackgroundUrl:r.h5_background_asset_id?'/api/v1/assets/'+r.h5_background_asset_id+'/content':null,
  stageBackgroundUrl:r.stage_background_asset_id?'/api/v1/assets/'+r.stage_background_asset_id+'/content':null};}
 async save(req:Request,id?:string){
  validateWrite(req);const input=activityInput(req.body);
  const expected=req.get('if-match');
  if(id&&(!expected||!/^\d+$/.test(expected)))fail(422,'VERSION_REQUIRED','缺少活动版本，请重新打开活动');
  return this.db.transaction(async c=>{
   const user=await this.identity(c,req);
   return this.receipt(c,user.id,req,id?'activity-update:'+id:'activity-create',{input,expected},async()=>{
    const existing=id?await this.access(c,user.id,id,true):null;
    if(existing&&String(existing.version)!==expected)fail(409,'VERSION_CONFLICT','活动已在其他页面修改，请重新加载后再编辑');
    const anchor=existing?.created_at??(await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
    const valid=(await c.query("SELECT $1::timestamptz>clock_timestamp() AND $1::timestamptz<=$2::timestamptz+interval '30 days' AS valid",[input.expiresAt,anchor])).rows[0].valid;
    if(!valid)fail(422,'INVALID_END_TIME','结束时间须晚于当前时间，且不超过原创建时间加 30 天');
    const activityId=id??randomUUID();
    for(const [assetId,purpose] of [[input.logoAssetId,'activity_logo'],[input.h5BackgroundAssetId,'h5_background'],[input.stageBackgroundAssetId,'stage_background']]){
     if(!assetId)continue;
     const asset=(await c.query('SELECT * FROM assets WHERE owner_id=$1 AND id=$2 FOR UPDATE',[user.id,assetId])).rows[0];
     if(!asset||asset.status!=='ready'||asset.purpose!==purpose||(asset.activity_id&&asset.activity_id!==activityId))
      fail(422,'ASSET_REJECTED','图片尚未完成上传、用途不匹配或不属于本场活动');
    }
    const values=[input.name,input.expiresAt,input.logoAssetId,input.h5BackgroundAssetId,input.stageBackgroundAssetId,input.tagline,input.organizer,input.coorganizer,JSON.stringify(input.display)];
    let row;
    if(existing){
     row=(await c.query(`UPDATE activities SET name=$3,expires_at=$4,logo_asset_id=$5,h5_background_asset_id=$6,stage_background_asset_id=$7,
      tagline=$8,organizer=$9,coorganizer=$10,display=$11,version=version+1 WHERE owner_id=$1 AND id=$2 RETURNING *`,[user.id,id,...values])).rows[0];
    }else{
     row=(await c.query(`INSERT INTO activities(owner_id,id,name,expires_at,logo_asset_id,h5_background_asset_id,stage_background_asset_id,tagline,organizer,coorganizer,display,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[user.id,activityId,...values,anchor])).rows[0];
     await c.query('UPDATE users SET created_activity_count=created_activity_count+1 WHERE id=$1',[user.id]);
     await c.query("INSERT INTO activity_runs(owner_id,activity_id,mode) VALUES ($1,$2,'rehearsal'),($1,$2,'formal')",[user.id,activityId]);
     await c.query('INSERT INTO activity_configurations(activity_id) VALUES($1)',[activityId]);
     await c.query('INSERT INTO configuration_versions(activity_id,version,form,rule,prizes) SELECT activity_id,$2,form,rule,prizes FROM activity_configurations WHERE activity_id=$1',[activityId,row.version]);
    }
    await c.query('UPDATE assets SET activity_id=$1 WHERE owner_id=$2 AND id=ANY($3::uuid[])',[activityId,user.id,[input.logoAssetId,input.h5BackgroundAssetId,input.stageBackgroundAssetId].filter(Boolean)]);
    await this.audit(c,user.id,user.id,existing?'activity_updated':'activity_created',{version:row.version,previousExpiresAt:existing?.expires_at??null,expiresAt:row.expires_at,changed:existing?Object.keys(input):['created']},activityId);
    return this.view(row);
   });
  });
 }

 async saveCheckin(req:Request,id:string){
  validateWrite(req);
  const b=object(req.body,['h5BackgroundAssetId','showBackground']);
  if((b.h5BackgroundAssetId!==null&&!uuid(b.h5BackgroundAssetId))||typeof b.showBackground!=='boolean')fail(422,'INVALID_SETTINGS','签到背景设置不正确');
  const expected=req.get('if-match');
  if(!expected||!/^\d+$/.test(expected))fail(422,'VERSION_REQUIRED','缺少活动版本，请重新打开签到设置');
  return this.db.transaction(async c=>{
   const user=await this.identity(c,req);
   return this.receipt(c,user.id,req,'checkin-settings:'+id,{...b,expected},async()=>{
    const current=await this.access(c,user.id,id,true);
    if(String(current.version)!==expected)fail(409,'VERSION_CONFLICT','活动已在其他页面修改，请重新打开签到设置');
    if(b.h5BackgroundAssetId){
     const asset=(await c.query('SELECT * FROM assets WHERE owner_id=$1 AND id=$2 FOR UPDATE',[user.id,b.h5BackgroundAssetId])).rows[0];
     if(!asset||asset.status!=='ready'||asset.purpose!=='h5_background'||asset.activity_id!==id)
      fail(422,'ASSET_REJECTED','请选择已上传到本场活动的 H5 背景');
    }
    const row=(await c.query(`UPDATE activities SET h5_background_asset_id=$3,
     display=jsonb_set(display,'{h5Background}',$4::jsonb),version=version+1 WHERE owner_id=$1 AND id=$2 RETURNING *`,
     [user.id,id,b.h5BackgroundAssetId,JSON.stringify(b.showBackground)])).rows[0];
    await this.audit(c,user.id,user.id,'checkin_settings_updated',{version:row.version,h5BackgroundAssetId:b.h5BackgroundAssetId,showBackground:b.showBackground},id);
    return this.view(row);
   });
  });
 }

 async authorizeUpload(req:Request){
  validateWrite(req);const b=object(req.body,['purpose','activityId']);
  if(!['activity_logo','h5_background','stage_background','activity_material'].includes(String(b.purpose))||(b.activityId!==null&&!uuid(b.activityId)))fail(422,'INVALID_UPLOAD','图片用途不正确');
  if(b.purpose==='activity_material'&&!b.activityId)fail(422,'INVALID_UPLOAD','请先选择资料所属的活动');
  return this.db.transaction(async c=>{
   const user=await this.identity(c,req);
   return this.receipt(c,user.id,req,'upload-authorize',b,async()=>{
    if(b.activityId)await this.access(c,user.id,b.activityId as string,true);
    // Bound abandoned upload metadata without defining an activity quota.
    const pending=(await c.query("SELECT count(*)::int n FROM assets WHERE owner_id=$1 AND status='pending' AND upload_expires_at>clock_timestamp()",[user.id])).rows[0].n;
    if(pending>=20)fail(429,'UPLOAD_LIMIT','待上传图片过多，请稍后再试');
    const row=(await c.query('INSERT INTO assets(owner_id,object_key,purpose,activity_id) VALUES ($1,$2,$3,$4) RETURNING id,upload_expires_at',[user.id,randomUUID()+'.webp',b.purpose,b.activityId])).rows[0];
    return {id:row.id,expiresAt:row.upload_expires_at};
   });
  });
 }
 private async uploadAccess(c:PoolClient,req:Request,id:string){
  const user=await this.identity(c,req);
  if(!uuid(id))fail(404,'NOT_FOUND','图片不存在');
  const row=(await c.query('SELECT *,upload_expires_at>clock_timestamp() AS active FROM assets WHERE owner_id=$1 AND id=$2 FOR UPDATE',[user.id,id])).rows[0];
  if(!row)fail(404,'NOT_FOUND','图片不存在');
  if(row.activity_id)await this.access(c,user.id,row.activity_id,true);
  if(row.status!=='ready'&&!row.active)fail(410,'UPLOAD_EXPIRED','上传凭据已过期，请重新选择图片');
  return {user,row};
 }
 async upload(req:Request,id:string){
  validateWrite(req,'application/octet-stream');
  const input=req.body;
  if(!Buffer.isBuffer(input)||!input.length)fail(422,'INVALID_IMAGE','请选择有效图片');
  const originalHash=createHash('sha256').update(input).digest('hex');
  const {row}=await this.db.transaction(c=>this.uploadAccess(c,req,id));
  const max=(row.purpose==='activity_logo'?5:10)*1024*1024;
  if(input.length>max)fail(422,'IMAGE_TOO_LARGE','Logo 最大 5MB，背景和资料图片最大 10MB');
  if(row.status==='ready'){
   if(row.content_hash!==originalHash)fail(409,'ASSET_IMMUTABLE','已上传图片不可覆盖，请重新上传');
   return {id:row.id,url:'/api/v1/assets/'+id+'/content'};
  }
  if(this.processing>=2)fail(429,'IMAGE_BUSY','图片处理中，请稍后重试');
  this.processing++;
  let encoded:Buffer,width:number,height:number;
  try{
   // Reject active/vector formats by magic bytes before giving input to a decoder.
   const png=input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
   const jpeg=input[0]===255&&input[1]===216&&input[2]===255;
   const webp=input.toString('ascii',0,4)==='RIFF'&&input.toString('ascii',8,12)==='WEBP';
   if(!png&&!jpeg&&!webp)fail(422,'INVALID_IMAGE','仅支持 PNG、JPEG、WebP 静态图片');
   const decoder=sharp(input,{limitInputPixels:8192*8192,failOn:'warning'}).timeout({seconds:15});
   const metadata=await decoder.metadata();
   if(!metadata.width||!metadata.height||metadata.width>8192||metadata.height>8192||(metadata.pages??1)>1)fail(422,'INVALID_IMAGE','图片单边不得超过 8192px，且不能是动图');
   const output=await decoder.rotate().webp({quality:90}).toBuffer({resolveWithObject:true});
   encoded=output.data;width=output.info.width;height=output.info.height;
  }catch{fail(422,'INVALID_IMAGE','图片无法解析，请选择 PNG、JPEG、WebP 静态图片（单边不超过 8192px）');}
  finally{this.processing--;}
  let createdFile:string|undefined;
  try{return await this.db.transaction(async c=>{
   const {user,row:current}=await this.uploadAccess(c,req,id);
   if(current.status==='ready'){
    if(current.content_hash!==originalHash)fail(409,'ASSET_IMMUTABLE','已上传图片不可覆盖');
    return {id,url:'/api/v1/assets/'+id+'/content'};
   }
   await mkdir(this.storage,{recursive:true});
   const file=path.join(this.storage,current.object_key);
   await writeFile(file,encoded,{flag:'wx'});createdFile=file;
   await c.query("UPDATE assets SET status='ready',content_hash=$2,width=$3,height=$4,bytes=$5 WHERE id=$1",[id,originalHash,width,height,encoded.length]);
   await this.audit(c,user.id,user.id,'asset_uploaded',{assetId:id,purpose:current.purpose},current.activity_id);
   return {id,url:'/api/v1/assets/'+id+'/content'};
  });}catch(e){if(createdFile)await unlink(createdFile).catch(()=>{});throw e;}
 }
 async image(req:Request,id:string){
  const file=await this.db.transaction(async c=>{
   const user=await this.identity(c,req);
   if(!uuid(id))fail(404,'NOT_FOUND','图片不存在');
   const row=(await c.query("SELECT object_key FROM assets WHERE owner_id=$1 AND id=$2 AND status='ready'",[user.id,id])).rows[0];
   if(!row||!/^[-0-9a-f]+\.webp$/.test(row.object_key))fail(404,'NOT_FOUND','图片不存在');
   return path.join(this.storage,row.object_key);
  });
  try{return await readFile(file);}catch{fail(404,'NOT_FOUND','图片暂不可用，请重新上传');}
 }
}
