import { Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service';
import { ActivitiesService } from './activities.service';
import { fail,validateWrite } from '../auth/security';
import { object,text,uuid } from './validation';
import { validateAnswers } from './configuration.validation';
import { publicParticipant } from './roster.excel';
@Injectable()
export class ParticipantManagementService{
 constructor(private db:DatabaseService,private activities:ActivitiesService){}
 private async context(c:PoolClient,req:Request,id:string,pid:string,mode:unknown,writing=false){
  if(!uuid(pid))fail(404,'NOT_FOUND','签到人员不存在');
  if(mode!=='formal'&&mode!=='rehearsal')fail(422,'INVALID_MODE','请选择名单模式');
  const user=await this.activities.identity(c,req),activity=await this.activities.access(c,user.id,id,writing);
  const run=(await c.query('SELECT * FROM activity_runs WHERE activity_id=$1 AND mode=$2 FOR UPDATE',[id,mode])).rows[0];
  if(!run)fail(404,'NOT_FOUND','名单不存在');
  const person=(await c.query('SELECT p.*,v.form FROM activity_participants p JOIN configuration_versions v ON v.activity_id=p.activity_id AND v.version=p.form_version WHERE p.id=$1 AND p.activity_id=$2 AND p.run_id=$3 AND p.generation=$4 FOR UPDATE OF p',[pid,id,run.id,run.generation])).rows[0];
  if(!person)fail(404,'NOT_FOUND','签到人员不存在或彩排已清空');
  const drawing=!!(await c.query("SELECT 1 FROM draw_rounds WHERE activity_id=$1 AND status='drawing'",[id])).rowCount;
  const lockedReason=activity.ended||activity.phase==='expired'?'活动已到期，只能查看':activity.phase!==mode?'只有当前活动模式可修改，其他模式为只读':mode==='formal'&&activity.first_formal_started_at?'首次正式开奖后，签到资料和手动资格调整已锁定':drawing?'正在抽取，请先完成本轮':'';
  return {user,activity,run,person,lockedReason};
 }
 async detail(req:Request,id:string,pid:string){
  const query=object(req.query,['mode']);
  return this.db.transaction(async c=>{
   const {person,run,lockedReason}=await this.context(c,req,id,pid,query.mode);
   const history=(await c.query('SELECT kind,reason,before_value AS before,after_value AS after,participant_version AS version,created_at AS "createdAt" FROM participant_changes WHERE participant_id=$1 ORDER BY participant_version DESC LIMIT 50',[pid])).rows;
   const reserved=(await c.query("SELECT count(*)::int n FROM designated_reservations WHERE participant_id=$1 AND status='reserved'",[pid])).rows[0].n;
   return {...publicParticipant(person),version:person.version,generation:run.generation,form:person.form,answers:person.answers,exclusionKind:person.exclusion_kind,exclusionReason:person.exclusion_reason,lockedReason,reserved,history};
  });
 }
 async change(req:Request,id:string,pid:string,kind:'answers'|'eligibility'){
  validateWrite(req);const body=object(req.body,kind==='answers'?['mode','generation','reason','answers']:['mode','generation','reason','eligible']);
  const reason=text(body.reason,300,true),expected=req.get('if-match');
  if(!expected||!/^\d+$/.test(expected)||!Number.isSafeInteger(body.generation))fail(422,'VERSION_REQUIRED','请重新打开人员资料后再操作');
  if(kind==='eligibility'&&typeof body.eligible!=='boolean')fail(422,'INVALID_ELIGIBILITY','资格设置不正确');
  return this.db.transaction(async c=>{
   // Identity and current generation are checked before receipt replay.
   const {user,activity,run,person,lockedReason}=await this.context(c,req,id,pid,body.mode);
   if(run.generation!==body.generation)fail(409,'GENERATION_CHANGED','彩排数据已更新，请刷新名单');
   return this.activities.receipt(c,user.id,req,'participant:'+id+':'+pid+':'+kind,{body,expected},async()=>{
    if(lockedReason)fail(activity.ended||activity.phase==='expired'?410:409,'PARTICIPANT_LOCKED',lockedReason);
    if(String(person.version)!==expected)fail(409,'VERSION_CONFLICT','该人员资料已变化，请关闭并重新打开后再修改');
    const before={answers:person.answers,eligible:person.eligible,exclusionKind:person.exclusion_kind,exclusionReason:person.exclusion_reason};
    let answers=person.answers,eligible=person.eligible,exclusionKind=person.exclusion_kind,exclusionReason=person.exclusion_reason,released=0;
    if(kind==='answers'){
     answers=validateAnswers(person.form,body.answers);
     if(isDeepStrictEqual(answers,person.answers))fail(422,'NO_CHANGE','填写内容未变化');
    }else{
     eligible=body.eligible;
     if(eligible===person.eligible)fail(422,'NO_CHANGE','资格状态未变化');
     if(eligible){
      const absent=person.exclusion_kind==='absent'||!!(await c.query("SELECT 1 FROM draw_awards WHERE participant_id=$1 AND status='void' AND reason IN ('absent','not_present','不在场')",[pid])).rowCount;
      if(absent)fail(409,'ABSENT_CANNOT_RESTORE','因不在场作废的人员不能恢复本场抽奖资格');
      exclusionKind=null;exclusionReason=null;
     }else{
      exclusionKind='manual';exclusionReason=reason;
      released=(await c.query("UPDATE designated_reservations SET status='cancelled' WHERE participant_id=$1 AND status='reserved'",[pid])).rowCount??0;
     }
    }
    const updated=(await c.query('UPDATE activity_participants SET answers=$2,eligible=$3,exclusion_kind=$4,exclusion_reason=$5,version=version+1 WHERE id=$1 RETURNING version',[pid,JSON.stringify(answers),eligible,exclusionKind,exclusionReason])).rows[0];
    const action=kind==='answers'?'answers':eligible?'restore':'exclude';
    await c.query('INSERT INTO participant_changes(activity_id,run_id,generation,participant_id,actor_id,kind,reason,before_value,after_value,participant_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,run.id,run.generation,pid,user.id,action,reason,JSON.stringify(before),JSON.stringify({answers,eligible,exclusionKind,exclusionReason,releasedReservations:released}),updated.version]);
    await c.query('UPDATE activity_runs SET version=version+1 WHERE id=$1',[run.id]);
    // Invalidates stale prize assignment editors after a release or restoration.
    await c.query('UPDATE activities SET version=version+1 WHERE id=$1',[id]);
    await this.activities.audit(c,user.id,user.id,'participant_'+action,{mode:run.mode,runId:run.id,participantId:pid,version:updated.version,generation:run.generation,reason,releasedReservations:released},id);
    return {version:updated.version,releasedReservations:released};
   });
  });
 }
}
