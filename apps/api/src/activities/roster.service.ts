import { Injectable,OnModuleInit,OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service';
import { ActivitiesService } from './activities.service';
import { fail,validateWrite } from '../auth/security';
import { object,uuid } from './validation';
import { publicParticipant,rosterWorkbook,Participant,Snapshot } from './roster.excel';
@Injectable()
export class RosterService implements OnModuleInit,OnModuleDestroy{
 constructor(private db:DatabaseService,private activities:ActivitiesService){}
 private timer?:ReturnType<typeof setInterval>;private working=false;
 onModuleInit(){this.timer=setInterval(()=>void this.process(),1000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 private async context(c:PoolClient,req:Request,id:string,mode:unknown){
  if(mode!=='rehearsal'&&mode!=='formal')fail(422,'INVALID_MODE','请选择彩排或正式名单');
  const user=await this.activities.identity(c,req),activity=await this.activities.access(c,user.id,id);
  const run=(await c.query('SELECT id,mode,generation FROM activity_runs WHERE activity_id=$1 AND mode=$2',[id,mode])).rows[0];
  if(!run)fail(404,'NOT_FOUND','名单不存在');
  return {user,activity,run};
 }
 async list(req:Request,id:string){
  const q=object(req.query,['mode','page','search','eligibility']);
  const page=q.page===undefined?1:Number(q.page);
  if(!Number.isSafeInteger(page)||page<1||page>100000)fail(422,'INVALID_PAGE','页码不正确');
  const search=q.search??'',eligibility=q.eligibility??'all';
  if(typeof search!=='string'||search.length>100||!['all','eligible','excluded'].includes(String(eligibility)))fail(422,'INVALID_FILTER','查询条件不正确');
  return this.db.transaction(async c=>{
   const {activity,run}=await this.context(c,req,id,q.mode);
   const stats=(await c.query('SELECT count(*)::int total,count(*) FILTER(WHERE eligible)::int eligible FROM activity_participants WHERE run_id=$1 AND generation=$2',[run.id,run.generation])).rows[0];
   const params=[run.id,run.generation,search.trim(),eligibility];
   const where="p.run_id=$1 AND p.generation=$2 AND ($3='' OR strpos(lower(p.nickname),lower($3))>0 OR strpos(p.id::text,lower($3))>0) AND ($4='all' OR p.eligible=($4='eligible'))";
   const total=(await c.query('SELECT count(*)::int n FROM activity_participants p WHERE '+where,params)).rows[0].n;
   const rows=(await c.query('SELECT p.avatar_url,p.id,p.nickname,p.created_at,p.eligible,p.form_version,p.answers,v.form FROM activity_participants p JOIN configuration_versions v ON v.activity_id=p.activity_id AND v.version=p.form_version WHERE '+where+' ORDER BY p.created_at DESC,p.id DESC LIMIT 25 OFFSET $5',[...params,(page-1)*25])).rows;
   return {activityName:activity.name,phase:activity.ended?'expired':activity.phase,mode:run.mode,generation:run.generation,page,pageSize:25,total,stats,items:rows.map(publicParticipant)};
  });
 }
 async exports(req:Request,id:string){
  const q=object(req.query,['mode']);
  return this.db.transaction(async c=>{
   const {user,run}=await this.context(c,req,id,q.mode);
   return (await c.query("SELECT id,CASE WHEN expires_at<=clock_timestamp() THEN 'expired' ELSE status END status,filename,row_count AS count,created_at AS \"createdAt\",expires_at AS \"expiresAt\" FROM participant_exports WHERE owner_id=$1 AND activity_id=$2 AND run_id=$3 AND generation=$4 ORDER BY created_at DESC LIMIT 10",[user.id,id,run.id,run.generation])).rows;
  });
 }
 async createExport(req:Request,id:string){
  validateWrite(req);const b=object(req.body,['mode','generation']);
  if(!Number.isSafeInteger(b.generation))fail(422,'INVALID_GENERATION','请刷新名单后重试');
  return this.db.transaction(async c=>{
   const {user,activity,run}=await this.context(c,req,id,b.mode);
   if(run.generation!==b.generation)fail(409,'GENERATION_CHANGED','彩排名单已清空，请刷新后重新导出');
   return this.activities.receipt(c,user.id,req,'participant-export:'+id,b,async()=>{
    const pending=(await c.query("SELECT count(*)::int n FROM participant_exports WHERE owner_id=$1 AND status IN ('pending','processing') AND expires_at>clock_timestamp()",[user.id])).rows[0].n;
    if(pending>=2)fail(429,'EXPORT_BUSY','已有导出正在生成，请稍后再试');
    const total=(await c.query('SELECT count(*)::int n FROM activity_participants WHERE run_id=$1 AND generation=$2',[run.id,run.generation])).rows[0].n;
    if(total>10000)fail(422,'EXPORT_TOO_LARGE','本次导出超过 10000 人，暂不支持，名单数据不会截断');
    const rows=(await c.query('SELECT p.avatar_url,p.id,p.nickname,p.created_at,p.eligible,p.form_version,p.answers,v.form FROM activity_participants p JOIN configuration_versions v ON v.activity_id=p.activity_id AND v.version=p.form_version WHERE p.run_id=$1 AND p.generation=$2 ORDER BY p.created_at,p.id',[run.id,run.generation])).rows as Participant[];
    const now=(await c.query('SELECT clock_timestamp() now')).rows[0].now.toISOString();
    const snapshot:Snapshot={activityName:activity.name,mode:run.mode,generation:run.generation,createdAt:now,rows};
    const filename=(run.mode==='formal'?'正式':'彩排')+'签到名单-'+now.slice(0,10)+'.xlsx';
    const job=(await c.query('INSERT INTO participant_exports(owner_id,activity_id,run_id,generation,snapshot,filename,row_count) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,status,created_at,expires_at',[user.id,id,run.id,run.generation,JSON.stringify(snapshot),filename,rows.length])).rows[0];
    await this.activities.audit(c,user.id,user.id,'participants_export_created',{jobId:job.id,mode:run.mode,generation:run.generation,count:rows.length},id);
    return job;
   });
  });
 }
 async exportStatus(req:Request,id:string,jobId:string,download=false){
  if(!uuid(jobId))fail(404,'NOT_FOUND','导出不存在');
  return this.db.transaction(async c=>{
   const user=await this.activities.identity(c,req);await this.activities.access(c,user.id,id);
   const job=(await c.query("SELECT e.id,e.status,e.filename,e.row_count,e.created_at,e.expires_at,e.error_code,e.generation,r.generation current_generation,r.mode,e.expires_at<=clock_timestamp() expired"+(download?',e.file_bytes':'')+" FROM participant_exports e JOIN activity_runs r ON r.id=e.run_id WHERE e.id=$1 AND e.activity_id=$2 AND e.owner_id=$3",[jobId,id,user.id])).rows[0];
   if(!job)fail(404,'NOT_FOUND','导出不存在');
   if(job.expired||job.generation!==job.current_generation||job.status==='expired')fail(410,'EXPORT_EXPIRED','导出已过期或彩排已清空，请重新导出');
   if(download){
    if(job.status!=='ready'||!job.file_bytes)fail(409,'EXPORT_NOT_READY','文件尚未生成，请稍后再试');
    await this.activities.audit(c,user.id,user.id,'participants_export_downloaded',{jobId,count:job.row_count},id);
    return {filename:job.filename,bytes:job.file_bytes};
   }
   return {id:job.id,status:job.status,filename:job.filename,count:job.row_count,createdAt:job.created_at,expiresAt:job.expires_at,mode:job.mode,message:job.status==='failed'?'生成失败，请重新导出':undefined};
  });
 }
 private async process(){
  if(this.working)return;this.working=true;let job:any;
  try{
   job=await this.db.transaction(async c=>{
    await c.query("UPDATE participant_exports SET status='expired',snapshot=NULL,file_bytes=NULL,lease_token=NULL WHERE status<>'expired' AND (expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM activity_runs r WHERE r.id=run_id AND r.generation=participant_exports.generation))");
    await c.query("UPDATE participant_exports SET status='failed',snapshot=NULL,error_code='GENERATION_FAILED' WHERE status='processing' AND lease_until<clock_timestamp() AND attempts>=3");
    const pending=(await c.query("SELECT id,snapshot FROM participant_exports WHERE expires_at>clock_timestamp() AND (status='pending' OR (status='processing' AND lease_until<clock_timestamp() AND attempts<3)) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
    if(!pending)return null;
    const token=randomUUID();await c.query("UPDATE participant_exports SET status='processing',attempts=attempts+1,lease_token=$2,lease_until=clock_timestamp()+interval '2 minutes' WHERE id=$1",[pending.id,token]);
    return {...pending,token};
   });
   if(!job)return;
   const bytes=await rosterWorkbook(job.snapshot);
   await this.db.transaction(async c=>{await c.query("UPDATE participant_exports SET status='ready',file_bytes=$3,snapshot=NULL,completed_at=clock_timestamp(),lease_token=NULL WHERE id=$1 AND lease_token=$2 AND status='processing' AND expires_at>clock_timestamp()",[job.id,job.token,bytes]);});
  }catch{
   if(job)try{await this.db.transaction(async c=>{await c.query("UPDATE participant_exports SET status='failed',snapshot=NULL,error_code='GENERATION_FAILED',lease_token=NULL WHERE id=$1 AND lease_token=$2 AND status='processing'",[job.id,job.token]);});}catch{/* Retry recovery on the next poll after database returns. */}
  }finally{this.working=false;}
 }
}
