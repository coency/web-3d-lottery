import {publishedMaterials,materialImage} from './materials';
import { Controller,Get,Post,Param,Req,Res,HttpCode } from '@nestjs/common';
import type { Request,Response } from 'express';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {joinPerson} from './signup-display';
import {snapshotJoinForm,matchesJoinForm,normalizeJoinForm} from './join-form-version';
import { DatabaseService } from '../database.service';
import { cookie,cookieOptions,equal,fail,mac,validateWrite } from '../auth/security';
import { envelope } from '../http';
import { object,text,uuid } from './validation';
import { validateAnswers } from './configuration.validation';

// Registered only in development. This adapter never authenticates a WeChat identity.
@Controller('api/v1/dev-join/:id')
export class DevelopmentJoinController {
 constructor(private db:DatabaseService){}
 private async context(c:any,id:string){
  if(!uuid(id))fail(404,'NOT_FOUND','活动不存在');
  const owner=(await c.query('SELECT owner_id FROM activities WHERE id=$1',[id])).rows[0];
  if(!owner)fail(404,'NOT_FOUND','活动不存在');
  const user=(await c.query('SELECT status FROM users WHERE id=$1 FOR UPDATE',[owner.owner_id])).rows[0];
  if(user?.status!=='active')fail(403,'ACCOUNT_DISABLED','活动暂不可用');
  const a=(await c.query('SELECT *,expires_at<=clock_timestamp() AS ended FROM activities WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(a.phase==='formal'||a.first_formal_started_at)fail(403,'MOCK_FORBIDDEN','正式活动不能使用模拟身份，请等待微信接入');
  const run=(await c.query("SELECT * FROM activity_runs WHERE activity_id=$1 AND mode='rehearsal' FOR UPDATE",[id])).rows[0];
  await c.query('INSERT INTO activity_configurations(activity_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
  const cfg=(await c.query('SELECT * FROM activity_configurations WHERE activity_id=$1',[id])).rows[0];
  cfg.form=normalizeJoinForm(cfg.form);
  return {a,run,cfg};
 }
 private identity(req:Request,res:Response,id:string,generation:number,create=false){
  const name='starlit_demo_'+id.replaceAll('-',''),value=cookie(req,name),parts=value.split('.');
  if(parts.length===3&&uuid(parts[0])&&Number(parts[1])===generation&&equal(parts[2]!,mac('demo:'+id+':'+parts[0]+'.'+parts[1])))return 'demo:'+parts[0];
  if(!create)fail(409,'IDENTITY_EXPIRED','测试身份或彩排数据已更新，请重新打开签到页面');
  const payload=randomUUID()+'.'+generation;
  res.cookie(name,payload+'.'+mac('demo:'+id+':'+payload),cookieOptions(31*86400000));
  return 'demo:'+payload.split('.')[0];
 }
 @Get()
 async get(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){
  res.setHeader('Cache-Control','no-store');
  return envelope(await this.db.transaction(async c=>{
   const {a,run,cfg}=await this.context(c,id),identity=this.identity(req,res,id,run.generation,true);
   const p=(await c.query('SELECT * FROM activity_participants WHERE run_id=$1 AND generation=$2 AND identity_key=$3',[run.id,run.generation,identity])).rows[0];
   await snapshotJoinForm(c,a,cfg);
   return {development:true,generation:run.generation,version:a.version,ended:a.ended||a.phase==='expired',name:a.name,tagline:a.display.tagline?a.tagline:'',organizer:a.display.organizer?a.organizer:'',logoUrl:a.display.logo&&a.logo_asset_id?'/api/v1/dev-join/'+id+'/image/logo':null,backgroundUrl:a.display.h5Background&&a.h5_background_asset_id?'/api/v1/dev-join/'+id+'/image/background':null,form:cfg.form,person:await joinPerson(c,p,cfg.form)};
  }),res);
 }
 @Post('checkins') @HttpCode(200)
 async checkin(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){
  validateWrite(req);const b=object(req.body,['generation','version','nickname','answers']);
  return envelope(await this.db.transaction(async c=>{
   const {a,run,cfg}=await this.context(c,id);
   if(b.generation!==run.generation)fail(409,'GENERATION_CHANGED','彩排已清空，请重新打开签到页面');
   const identity=this.identity(req,res,id,run.generation);
   const old=(await c.query('SELECT * FROM activity_participants WHERE run_id=$1 AND generation=$2 AND identity_key=$3',[run.id,run.generation,identity])).rows[0];
   if(old)return joinPerson(c,old,cfg.form);
   if(a.ended||a.phase==='expired')fail(410,'ACTIVITY_ENDED','活动已结束，不能新增签到');
   if(!await matchesJoinForm(c,id,b.version,cfg.form))fail(409,'FORM_CHANGED','活动设置已更新，请重新加载签到页面后填写');
   const nickname=text(b.nickname,30,true),answers=validateAnswers(cfg.form,b.answers);
   await c.query('INSERT INTO configuration_versions(activity_id,version,form,rule,prizes) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,a.version,JSON.stringify(cfg.form),JSON.stringify(cfg.rule),JSON.stringify(cfg.prizes)]);
   const avatar='/demo-avatar.svg';
   const p=(await c.query('INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,answers,form_version,avatar_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,run.id,run.generation,identity,nickname,JSON.stringify(answers),a.version,avatar])).rows[0];
   await c.query('UPDATE activity_runs SET version=version+1 WHERE id=$1',[run.id]);
   return joinPerson(c,p,cfg.form);
  }),res);
 }
 private async materials(req:Request,res:Response,id:string,imageId?:string){
  return this.db.transaction(async c=>{
   const {a,run}=await this.context(c,id),identity=this.identity(req,res,id,run.generation);
   const person=await c.query('SELECT 1 FROM activity_participants WHERE run_id=$1 AND generation=$2 AND identity_key=$3',[run.id,run.generation,identity]);
   if(!person.rowCount)fail(403,'CHECKIN_REQUIRED','请先完成签到');
   return imageId?materialImage(c,a,imageId):publishedMaterials(c,id,'/api/v1/dev-join/'+id);
  });
 }
 @Get('materials') async getMaterials(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){res.setHeader('Cache-Control','no-store');return envelope(await this.materials(req,res,id),res);}
 @Get('materials/images/:imageId') async getMaterialImage(@Param('id') id:string,@Param('imageId') imageId:string,@Req() req:Request,@Res() res:Response){res.setHeader('Cache-Control','no-store');res.type('image/webp').send(await this.materials(req,res,id,imageId));}
 @Get('image/:kind')
 async image(@Param('id') id:string,@Param('kind') kind:string,@Res() res:Response){
  const key=await this.db.transaction(async c=>{
   const {a}=await this.context(c,id);
   const asset=kind==='logo'&&a.display.logo?a.logo_asset_id:kind==='background'&&a.display.h5Background?a.h5_background_asset_id:null;
   const row=(await c.query("SELECT object_key FROM assets WHERE id=$1 AND owner_id=$2 AND activity_id=$3 AND status='ready'",[asset,a.owner_id,id])).rows[0];
   if(!row||!/^[-0-9a-f]+\.webp$/.test(row.object_key))fail(404,'NOT_FOUND','图片不存在');return row.object_key;
  });
  const storage=path.resolve(process.env.ASSET_DIRECTORY??path.join(process.cwd(),'.local','uploads'));
  try{res.setHeader('Cache-Control','no-store');res.type('image/webp').send(await readFile(path.join(storage,key)));}catch{fail(404,'NOT_FOUND','图片暂不可用');}
 }
}
