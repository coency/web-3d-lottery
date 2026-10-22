import { isDeepStrictEqual } from 'node:util';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database.service';
import { ActivitiesService } from './activities.service';
import { fail,validateWrite } from '../auth/security';
import { object,text,uuid } from './validation';
import { formInput,ruleInput,prizesInput,validateAnswers,simulationTarget,Form,Rule,Prize } from './configuration.validation';
import {wechatReadiness} from './wechat-readiness';
@Injectable()
export class ConfigurationService{
 constructor(private db:DatabaseService,private activities:ActivitiesService){}
 private async config(c:PoolClient,id:string,version:string){
  await c.query('INSERT INTO activity_configurations(activity_id) VALUES($1) ON CONFLICT DO NOTHING',[id]);
  const row=(await c.query('SELECT * FROM activity_configurations WHERE activity_id=$1',[id])).rows[0];
  await c.query('INSERT INTO configuration_versions(activity_id,version,form,rule,prizes) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,version,JSON.stringify(row.form),JSON.stringify(row.rule),JSON.stringify(row.prizes)]);
  row.form={...row.form,auxiliaryFieldIds:[],signupFieldIds:row.form.signupFieldIds??[]};
  row.prizes=row.prizes.map((p:Prize)=>({...p,theme:p.theme??'dream-planet',mode:p.mode==='mixed'?'designated':p.mode}));
  return row as {form:Form;rule:Rule;prizes:Prize[]};
 }
 private async runs(c:PoolClient,id:string){
  return (await c.query(`SELECT r.id,r.mode,r.generation,r.version,r.first_started_at,
   (SELECT count(*)::int FROM activity_participants p WHERE p.run_id=r.id) AS participants,
   (SELECT count(*)::int FROM activity_participants p WHERE p.run_id=r.id AND p.generation=r.generation AND p.identity_key LIKE 'rehearsal-simulation-%') AS simulated,
   (SELECT count(*)::int FROM draw_rounds d WHERE d.run_id=r.id) AS rounds,
   (SELECT count(*)::int FROM draw_awards a WHERE a.run_id=r.id) AS awards,
   EXISTS(SELECT 1 FROM draw_rounds d WHERE d.run_id=r.id AND d.status='drawing') AS drawing
   FROM activity_runs r WHERE r.activity_id=$1 ORDER BY r.mode FOR UPDATE`,[id])).rows;
 }
 private async busy(c:PoolClient,id:string){
  if((await c.query("SELECT 1 FROM draw_rounds WHERE activity_id=$1 AND status='drawing'",[id])).rowCount)fail(409,'ROUND_ACTIVE','当前正在抽奖，暂时不能修改。请在大屏停止抽取并完成揭晓后，再返回保存');
 }
 async get(req:Request,id:string){return this.db.transaction(async c=>{
  const user=await this.activities.identity(c,req),activity=await this.activities.access(c,user.id,id);
  const config=await this.config(c,id,activity.version),runs=await this.runs(c,id);
  const verified=(await wechatReadiness(c,id)).ready;
  const participants=(await c.query("SELECT p.id,p.nickname,p.eligible FROM activity_participants p JOIN activity_runs r ON r.id=p.run_id WHERE p.activity_id=$1 AND r.mode=$2 AND EXISTS(SELECT 1 FROM designated_reservations d WHERE d.participant_id=p.id AND d.status='reserved') ORDER BY p.created_at,p.id",[id,activity.phase])).rows;
  const reservations=(await c.query("SELECT d.prize_id,d.participant_id FROM designated_reservations d JOIN activity_runs r ON r.id=d.run_id WHERE d.activity_id=$1 AND r.mode=$2 AND d.status='reserved'",[id,activity.phase])).rows;
  const lockedPrizeIds=(await c.query('SELECT DISTINCT d.prize_id FROM draw_rounds d JOIN activity_runs r ON r.id=d.run_id WHERE d.activity_id=$1 AND r.mode=$2',[id,activity.phase])).rows.map(r=>r.prize_id);
  return {...config,lockedPrizeIds,participants,reservations,version:activity.version,name:activity.name,phase:activity.ended?'expired':activity.phase,firstFormalStarted:!!activity.first_formal_started_at,runs,wechatVerified:verified};
 });}
 async save(req:Request,id:string,section:'form'|'rule'|'prizes'|'checkin'|'prize-settings'){
  validateWrite(req);
  const body=object(req.body,['value','confirmed','reason']);
  if(body.confirmed!==undefined&&typeof body.confirmed!=='boolean')fail(422,'INVALID_CONFIRMATION','确认信息不正确');
  const bundle=section==='checkin'?object(body.value,['form','h5BackgroundAssetId','showBackground']):section==='prize-settings'?object(body.value,['rule','prizes','reservations']):null;
  const form=section==='form'?formInput(body.value):section==='checkin'?formInput(bundle!.form):null;
  const rule=section==='rule'?ruleInput(body.value):section==='prize-settings'?ruleInput(bundle!.rule):null;
  const prizes=section==='prizes'?prizesInput(body.value):section==='prize-settings'?prizesInput(bundle!.prizes):null;
  if(section==='checkin'&&((bundle!.h5BackgroundAssetId!==null&&!uuid(bundle!.h5BackgroundAssetId))||typeof bundle!.showBackground!=='boolean'))fail(422,'INVALID_SETTINGS','签到背景设置不正确');
  return this.db.transaction(async c=>{
   const user=await this.activities.identity(c,req);
   return this.activities.receipt(c,user.id,req,'configuration:'+id+':'+section,{body,version:req.get('if-match')},async()=>{
    const activity=await this.activities.access(c,user.id,id,true);
    if(req.get('if-match')!==String(activity.version))fail(409,'VERSION_CONFLICT','活动进度或配置已更新，本次修改未保存。请先复制未保存的内容，重新进入当前设置后再保存');
    await this.busy(c,id);await this.runs(c,id);
    const current=await this.config(c,id,activity.version);
    if(form&&activity.first_formal_started_at&&(section==='form'||!isDeepStrictEqual(form,current.form)))fail(409,'FORM_LOCKED','首次正式开奖后，签到字段结构已锁定');
    if(rule){
     if(activity.first_formal_started_at&&!isDeepStrictEqual(rule,current.rule)&&(body.confirmed!==true||!text(body.reason??'',300)))fail(422,'CONFIRMATION_REQUIRED','正式开奖后调整规则须确认并填写原因');
     const limit=rule.mode==='across'?null:rule.mode==='once'?1:rule.maxWins;
     if(limit!==null&&section!=='prize-settings'){
      const conflict=await c.query(`SELECT p.id FROM activity_participants p JOIN activity_runs r ON r.id=p.run_id
       WHERE p.activity_id=$1 AND r.mode=$2 AND
       (SELECT count(*) FROM designated_reservations d WHERE d.participant_id=p.id AND d.status='reserved')>0 AND
       ((SELECT count(*) FROM designated_reservations d WHERE d.participant_id=p.id AND d.status='reserved')+
       (SELECT count(*) FROM draw_awards a WHERE a.participant_id=p.id AND a.status='valid'))>$3 LIMIT 1`,[id,activity.phase,limit]);
      if(conflict.rowCount)fail(409,'RESERVATION_CONFLICT','新中奖上限与指定预留冲突，请先处理指定预留');
     }
    }
    if(prizes){
     const next=prizes;
     for(const old of current.prizes){
      const replacement=next.find(p=>p.id===old.id);
      const coreChanged=!replacement||['name','total','mode'].some(k=>old[k as keyof Prize]!==replacement[k as keyof Prize]);
      if(coreChanged){
       const used=await c.query('SELECT 1 FROM draw_rounds d JOIN activity_runs r ON r.id=d.run_id WHERE d.activity_id=$1 AND d.prize_id=$2 AND r.mode=$3 LIMIT 1',[id,old.id,activity.phase]);
       if(used.rowCount)fail(409,'PRIZE_LOCKED',activity.phase==='rehearsal'?'该奖项已经彩排试抽，请先清空彩排再修改核心配置':'该奖项已经正式抽取，名称、名额与颁发方式已锁定');
       if(section!=='prize-settings'&&(await c.query("SELECT 1 FROM designated_reservations d JOIN activity_runs r ON r.id=d.run_id WHERE d.activity_id=$1 AND d.prize_id=$2 AND d.status='reserved' AND r.mode=$3",[id,old.id,activity.phase])).rowCount)
        fail(409,'RESERVATION_CONFLICT','该奖项有指定预留，请先处理预留');
      }
     }
     for(const prize of next){
      if(!current.prizes.some(p=>p.id===prize.id)){
       if((await c.query('SELECT 1 FROM prize_identities WHERE id=$1',[prize.id])).rowCount)fail(409,'PRIZE_ID_USED','奖项编号已使用，请新建奖项');
       await c.query('INSERT INTO prize_identities(id,activity_id) VALUES($1,$2)',[prize.id,id]);
      }
     }
    }
    if(section==='checkin'){
     if(bundle!.h5BackgroundAssetId){
      const asset=(await c.query("SELECT 1 FROM assets WHERE id=$1 AND owner_id=$2 AND activity_id=$3 AND purpose='h5_background' AND status='ready'",[bundle!.h5BackgroundAssetId,user.id,id])).rowCount;
      if(!asset)fail(422,'ASSET_REJECTED','请选择已上传到本场活动的 H5 背景');
     }
     await c.query("UPDATE activities SET h5_background_asset_id=$2,display=jsonb_set(display,'{h5Background}',$3::jsonb) WHERE id=$1",[id,bundle!.h5BackgroundAssetId,JSON.stringify(bundle!.showBackground)]);
    }
    if(section==='prize-settings'){
     const input=bundle!.reservations;
     if(!Array.isArray(input)||input.length>200)fail(422,'INVALID_RESERVATIONS','指定名单不正确');
     const run=(await c.query('SELECT * FROM activity_runs WHERE activity_id=$1 AND mode=$2',[id,activity.phase])).rows[0];
     const counts=new Map<string,number>(),seen=new Set<string>();
     const selections:{prizeId:string;participantIds:string[]}[]=[];
     for(const entry of input){
      const item=object(entry,['prizeId','participantIds']);
      if(!uuid(item.prizeId)||seen.has(item.prizeId)||!Array.isArray(item.participantIds)||item.participantIds.some(x=>!uuid(x))||new Set(item.participantIds).size!==item.participantIds.length)fail(422,'INVALID_RESERVATIONS','指定名单包含重复或无效人员');
      seen.add(item.prizeId);
      const prize=prizes!.find(p=>p.id===item.prizeId);
      if(!prize||!['designated','mixed'].includes(prize.mode)||item.participantIds.length>prize.total)fail(422,'INVALID_RESERVATIONS','指定人数不得超过该奖项名额');
      const used=(await c.query("SELECT count(*)::int n FROM draw_awards WHERE run_id=$1 AND prize_id=$2 AND status='valid'",[run.id,prize.id])).rows[0].n;
      if(used+item.participantIds.length>prize.total)fail(409,'RESERVATION_CONFLICT','已中奖与指定预留人数超过奖项名额');
      for(const person of item.participantIds){
       const eligible=(await c.query("SELECT 1 FROM activity_participants p WHERE p.id=$1 AND p.run_id=$2 AND p.eligible AND NOT EXISTS(SELECT 1 FROM draw_awards a WHERE a.participant_id=p.id AND a.prize_id=$3 AND a.status='valid')",[person,run.id,prize.id])).rowCount;
       if(!eligible)fail(422,'INELIGIBLE_PARTICIPANT','指定人员未签到、不属于当前模式或已失去资格');
       counts.set(person,(counts.get(person)??0)+1);
      }
      selections.push({prizeId:prize.id,participantIds:item.participantIds as string[]});
     }
     const limit=rule!.mode==='across'?null:rule!.mode==='once'?1:rule!.maxWins;
     for(const [person,count] of counts){
      const wins=(await c.query("SELECT count(*)::int n FROM draw_awards WHERE run_id=$1 AND participant_id=$2 AND status='valid'",[run.id,person])).rows[0].n;
      if(limit!==null&&wins+count>limit)fail(409,'RESERVATION_CONFLICT','指定名单与整场中奖次数上限冲突');
     }
     await c.query("UPDATE designated_reservations SET status='cancelled' WHERE run_id=$1 AND status='reserved'",[run.id]);
     for(const entry of selections)for(const person of entry.participantIds)await c.query("INSERT INTO designated_reservations(activity_id,run_id,generation,participant_id,prize_id,status) VALUES($1,$2,$3,$4,$5,'reserved')",[id,run.id,run.generation,person,entry.prizeId]);
    }
    const next={form:form??current.form,rule:rule??current.rule,prizes:prizes??current.prizes};
    await c.query('UPDATE activity_configurations SET form=$2,rule=$3,prizes=$4 WHERE activity_id=$1',[id,JSON.stringify(next.form),JSON.stringify(next.rule),JSON.stringify(next.prizes)]);
    const version=(await c.query('UPDATE activities SET version=version+1 WHERE id=$1 RETURNING version',[id])).rows[0].version;
    await c.query('INSERT INTO configuration_versions(activity_id,version,form,rule,prizes) VALUES($1,$2,$3,$4,$5)',[id,version,JSON.stringify(next.form),JSON.stringify(next.rule),JSON.stringify(next.prizes)]);
    await this.activities.audit(c,user.id,user.id,'configuration_'+section,{mode:activity.phase,version,reason:body.reason??null,fieldCount:next.form.fields.length,prizeCount:next.prizes.length},id);
    return {version};
   });
  });
 }
 async preview(req:Request,id:string){
  validateWrite(req);const b=object(req.body,['version','answers']);
  return this.db.transaction(async c=>{
   const user=await this.activities.identity(c,req),activity=await this.activities.access(c,user.id,id);
   if(String(b.version)!==String(activity.version))fail(409,'FORM_VERSION_CHANGED','表单已变化，请重新加载后预览');
   const config=await this.config(c,id,activity.version);
   validateAnswers(config.form,b.answers);return {valid:true,message:'表单校验通过；此预览不会创建签到记录'};
  });
 }
 async simulate(req:Request,id:string){
  validateWrite(req);
  const b=object(req.body,['target','generation']),target=simulationTarget(b.target);
  if(!Number.isSafeInteger(b.generation))fail(422,'INVALID_GENERATION','请重新加载彩排数据');
  return this.db.transaction(async c=>{
   const user=await this.activities.identity(c,req);
   return this.activities.receipt(c,user.id,req,'rehearsal-simulation:'+id,{b,version:req.get('if-match')},async()=>{
    const activity=await this.activities.access(c,user.id,id,true);
    if(activity.phase!=='rehearsal')fail(409,'MODE_LOCKED','仅彩排模式可以生成模拟参与者');
    if(req.get('if-match')!==String(activity.version))fail(409,'VERSION_CONFLICT','活动已变化，请重新加载');
    const run=(await this.runs(c,id)).find(r=>r.mode==='rehearsal');
    if(!run||run.generation!==b.generation)fail(409,'GENERATION_CHANGED','彩排数据已更新，请重新加载');
    await this.busy(c,id);
    if(target<run.simulated)fail(422,'SIMULATION_COUNT_DECREASE','已有模拟参与者超过目标人数；如需减少，请先清空彩排数据');
    // Keep an immutable form snapshot even when a basic-information edit advanced the version.
    await this.config(c,id,activity.version);
    const added=(await c.query(`INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,form_version,avatar_url)
     SELECT $1,$2,$3,'rehearsal-simulation-'||n,'模拟用户 '||CASE WHEN n<1000 THEN lpad(n::text,3,'0') ELSE n::text END,$4,
      '/demo-avatars/portraits-v1/'||n||'.webp' FROM generate_series(1,$5::int)n
     ON CONFLICT(run_id,generation,identity_key) DO NOTHING`,[id,run.id,run.generation,activity.version,target])).rowCount??0;
    // Re-running generation upgrades legacy simulation portraits without clearing
    // participants, check-in answers or existing draw records. Real identities are excluded.
    const refreshed=(await c.query(`UPDATE activity_participants p
     SET avatar_url='/demo-avatars/portraits-v1/'||n||'.webp'
     FROM generate_series(1,$4::int)n
     WHERE p.activity_id=$1 AND p.run_id=$2 AND p.generation=$3
      AND p.identity_key='rehearsal-simulation-'||n AND p.avatar_url ~ '^/demo-avatars/[1-8]\\.svg$'`,
     [id,run.id,run.generation,target])).rowCount??0;
    if(added||refreshed){
     await c.query('UPDATE activity_runs SET version=version+1 WHERE id=$1',[run.id]);
     await c.query('UPDATE activities SET version=version+1 WHERE id=$1',[id]);
     await this.activities.audit(c,user.id,user.id,'rehearsal_simulated',{mode:'rehearsal',count:added,simulated:target,avatarsUpdated:refreshed},id);
    }
    return {added,simulated:target,participants:run.participants+added};
   });
  });
 }
 async mode(req:Request,id:string,action:'clear-rehearsal'|'reset-draw'|'promote'){
  validateWrite(req);const b=object(req.body,['confirmation','generation']);
  if(b.confirmation!==action||!Number.isSafeInteger(b.generation))fail(422,'CONFIRMATION_REQUIRED','请确认本次操作');
  return this.db.transaction(async c=>{
   const user=await this.activities.identity(c,req);
   return this.activities.receipt(c,user.id,req,'mode:'+id+':'+action,{b,version:req.get('if-match')},async()=>{
    const activity=await this.activities.access(c,user.id,id,true);
    if(req.get('if-match')!==String(activity.version))fail(409,'VERSION_CONFLICT','活动已变化，请重新加载');
    if(activity.phase!=='rehearsal')fail(409,'MODE_LOCKED','正式活动不能切回或清空彩排');
    const runs=await this.runs(c,id),rehearsal=runs.find(r=>r.mode==='rehearsal');
    if(!rehearsal||rehearsal.generation!==b.generation)fail(409,'GENERATION_CHANGED','彩排数据已更新，请重新加载');
    await this.busy(c,id);
    if(action==='promote'){
     if(!(await wechatReadiness(c,id)).ready)fail(409,'WECHAT_NOT_VERIFIED','微信接入尚未就绪，请在签到设置中完成域名设置并检查微信接入');
     const formal=runs.find(r=>r.mode==='formal');
     if(!formal||formal.participants||formal.rounds||formal.awards)fail(409,'FORMAL_NOT_EMPTY','正式数据状态异常，无法启用');
     await c.query("UPDATE activities SET phase='formal',version=version+1 WHERE id=$1",[id]);
    }else if(action==='reset-draw'){
     await c.query("UPDATE participant_exports SET status='expired',snapshot=NULL,file_bytes=NULL,lease_token=NULL WHERE run_id=$1 AND status<>'expired'",[rehearsal.id]);
     await c.query('UPDATE activity_runs SET active_root_id=NULL WHERE id=$1',[rehearsal.id]);
     // Preserve the roster generation and advance the control fence to reject stale pages.
     await c.query("UPDATE draw_controls SET fence=fence+1,lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[rehearsal.id]);
     await c.query('DELETE FROM draw_awards WHERE run_id=$1',[rehearsal.id]);
     await c.query('DELETE FROM draw_rounds WHERE run_id=$1',[rehearsal.id]);
     await c.query("DELETE FROM designated_reservations WHERE run_id=$1 AND status<>'reserved'",[rehearsal.id]);
     await c.query("UPDATE activity_participants SET eligible=true,exclusion_kind=NULL,exclusion_reason=NULL,version=version+1 WHERE run_id=$1 AND exclusion_kind='absent'",[rehearsal.id]);
     await c.query('UPDATE activity_runs SET version=version+1,first_started_at=NULL WHERE id=$1',[rehearsal.id]);
     await c.query('UPDATE activities SET version=version+1 WHERE id=$1',[id]);
    }else{
     await c.query("UPDATE participant_exports SET status='expired',snapshot=NULL,file_bytes=NULL,lease_token=NULL WHERE run_id=$1 AND status<>'expired'",[rehearsal.id]);
     await c.query('UPDATE activity_runs SET active_root_id=NULL WHERE id=$1',[rehearsal.id]);
     await c.query('DELETE FROM draw_controls WHERE run_id=$1',[rehearsal.id]);
     await c.query('DELETE FROM designated_reservations WHERE run_id=$1',[rehearsal.id]);
     await c.query('DELETE FROM draw_awards WHERE run_id=$1',[rehearsal.id]);
     await c.query('DELETE FROM draw_rounds WHERE run_id=$1',[rehearsal.id]);
     await c.query(`UPDATE business_audit SET details=jsonb_build_object('mode','rehearsal','historyCleared',true)
       WHERE activity_id=$1 AND (details->>'runId'=$2 OR details->>'participantId' IN
       (SELECT id::text FROM activity_participants WHERE run_id=$2::uuid)) AND action=ANY($3::text[])`,
       [id,rehearsal.id,['participant_exclude','participant_restore','participant_answers','draw_start','draw_stop','draw_void','draw_next']]);
     await c.query('DELETE FROM activity_participants WHERE run_id=$1',[rehearsal.id]);
     await c.query('DELETE FROM participant_sessions WHERE entry_code IN (SELECT code FROM join_entries WHERE run_id=$1)',[rehearsal.id]);
    await c.query('DELETE FROM wechat_oauth_states WHERE entry_code IN (SELECT code FROM join_entries WHERE run_id=$1)',[rehearsal.id]);
    await c.query('DELETE FROM join_avatars WHERE entry_code IN (SELECT code FROM join_entries WHERE run_id=$1)',[rehearsal.id]);
    await c.query('UPDATE activity_runs SET generation=generation+1,version=version+1,first_started_at=NULL WHERE id=$1',[rehearsal.id]);
     await c.query('UPDATE activities SET version=version+1 WHERE id=$1',[id]);
    }
    await this.activities.audit(c,user.id,user.id,action,{mode:action==='promote'?'formal':'rehearsal',generation:rehearsal.generation,participants:rehearsal.participants,rounds:rehearsal.rounds,awards:rehearsal.awards},id);
    return {action};
   });
  });
 }
}
