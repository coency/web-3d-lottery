import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { createHash,randomInt,randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { DatabaseService } from '../database.service';
import { ActivitiesService } from './activities.service';
import { cookie,digest,fail,validateWrite } from '../auth/security';
import { object,uuid } from './validation';
import { answerLabel,beijing } from './roster.excel';
@Injectable()
export class DrawService{
 constructor(private db:DatabaseService,private activities:ActivitiesService){}
 private async context(c:PoolClient,req:Request,id:string,mode:unknown){
  if(mode!=='rehearsal'&&mode!=='formal')fail(422,'INVALID_MODE','请选择彩排或正式模式');
  const user=await this.activities.identity(c,req),activity=await this.activities.access(c,user.id,id);
  const run=(await c.query('SELECT * FROM activity_runs WHERE activity_id=$1 AND mode=$2 FOR UPDATE',[id,mode])).rows[0];
  if(!run)fail(404,'NOT_FOUND','活动运行数据不存在');
  return {user,activity,run};
 }
 private async group(c:PoolClient,run:any){
  if(!run.active_root_id)return {rounds:[],awards:[],vacancies:[]};
  const rounds=(await c.query('SELECT id,prize_id,status,draw_count,root_round_id,snapshot,created_at,completed_at FROM draw_rounds WHERE run_id=$1 AND generation=$2 AND root_round_id=$3 ORDER BY created_at,id',[run.id,run.generation,run.active_root_id])).rows;
  const awards=(await c.query('SELECT a.id,a.participant_id,a.round_id,a.prize_id,a.status,a.reason,a.display_snapshot,a.replaces_award_id,a.created_at FROM draw_awards a JOIN draw_rounds r ON r.id=a.round_id WHERE r.run_id=$1 AND r.root_round_id=$2 ORDER BY a.created_at,a.id',[run.id,run.active_root_id])).rows;
  return {rounds,awards,vacancies:awards.filter(a=>a.status==='void'&&!awards.some(b=>b.replaces_award_id===a.id))};
 }
 async people(req:Request,id:string){
  const q=object(req.query,['mode','revision']);
  if(q.revision!==undefined&&(typeof q.revision!=='string'||!/^\d+:\d+$/.test(q.revision)||q.revision.length>50))fail(422,'INVALID_REVISION','名单版本不正确');
  return this.db.transaction(async c=>{
   const {run}=await this.context(c,req,id,q.mode);
   const revision=await this.rosterRevision(c,run);
   if(q.revision===revision)return {generation:run.generation,revision,unchanged:true};
   const items=(await c.query('SELECT id,nickname,avatar_url AS "avatarUrl" FROM activity_participants WHERE run_id=$1 AND generation=$2 AND eligible=true ORDER BY created_at,id',[run.id,run.generation])).rows;
   return {generation:run.generation,revision,items};
  });
 }
 private async rosterRevision(c:PoolClient,run:any){
  const revision=(await c.query('SELECT revision::text FROM roster_revisions WHERE run_id=$1',[run.id])).rows[0]?.revision??'0';
  return run.generation+':'+revision;
 }
 async state(req:Request,id:string,preflight=false){
  const q=object(req.query,['mode']);
  return this.db.transaction(async c=>{
   const {activity,run}=await this.context(c,req,id,q.mode);
   if(activity.ended)await c.query("UPDATE draw_rounds SET status='expired' WHERE run_id=$1 AND status='drawing'",[run.id]);
   const config=(await c.query('SELECT form,rule,prizes FROM activity_configurations WHERE activity_id=$1',[id])).rows[0]??{form:{fields:[]},rule:{mode:'once'},prizes:[]};
   const counts=(await c.query("SELECT prize_id,count(*)::int n FROM draw_awards WHERE run_id=$1 AND generation=$2 AND status='valid' GROUP BY prize_id",[run.id,run.generation])).rows;
   const group=await this.group(c,run);
   const readiness=[];
   if(preflight)for(const prize of config.prizes){
    const used=counts.find(x=>x.prize_id===prize.id)?.n??0;
    const current=group.rounds[0]?.prize_id===prize.id;
    const required=run.active_root_id&&current?Math.min(group.vacancies.length,10):Math.max(0,Math.min(prize.batch,prize.total-used));
    const status=group.rounds.some(r=>r.status==='drawing')?'drawing':run.active_root_id&&!current?'blocked':run.active_root_id&&!group.vacancies.length?'result':!required||used+required>prize.total?'full':run.active_root_id?'replacement':'normal';
    const {pool}=required&&['normal','replacement'].includes(status)?await this.candidatePool(c,run,config,prize,required):{pool:[]};
    readiness.push({prizeId:prize.id,required,available:pool.length,status});
   }
   const totals=(await c.query('SELECT count(*)::int AS signed, count(*) FILTER (WHERE eligible)::int AS eligible FROM activity_participants WHERE run_id=$1 AND generation=$2',[run.id,run.generation])).rows[0];
   return {mode:q.mode,generation:run.generation,version:run.version,phase:activity.ended?'expired':activity.phase,
    rosterRevision:await this.rosterRevision(c,run),eligibleCount:totals.eligible,
    appearanceRevision:createHash('sha256').update(JSON.stringify([activity.name,activity.tagline,activity.organizer,activity.coorganizer,activity.logo_asset_id,activity.stage_background_asset_id,activity.h5_background_asset_id,activity.display,activity.expires_at])).digest('hex'),
    ...(preflight?{readiness}:{}),
    activeRootId:run.active_root_id,prizes:config.prizes.map((p:any)=>({id:p.id,name:p.name,mode:p.mode,theme:p.theme??'dream-planet',total:p.total,batch:p.batch,awarded:counts.find(x=>x.prize_id===p.id)?.n??0})),...group,rounds:group.rounds.map(({snapshot,...round}:any)=>round),
    signedIn:totals.signed};
  });
 }
 private async control(c:PoolClient,req:Request,run:any,b:any,claim=false){
  if(!uuid(b.tabId))fail(422,'INVALID_TAB','请重新打开抽奖操作页面');
  const session=digest(cookie(req,'starlit_session'));
  const old=(await c.query('SELECT *,lease_until>clock_timestamp() AS active FROM draw_controls WHERE run_id=$1 FOR UPDATE',[run.id])).rows[0];
  if(claim){
   if(old?.active&&old.generation===run.generation&&old.session_hash===session&&old.tab_id!==b.tabId)fail(409,'CONTROL_BUSY','另一个页面正在控制本场抽奖，请在该页面操作');
   const same=old?.active&&old.generation===run.generation&&old.session_hash===session&&old.tab_id===b.tabId;
   const row=(await c.query("INSERT INTO draw_controls(run_id,generation,session_hash,tab_id,fence,lease_until) VALUES($1,$2,$3,$4,1,clock_timestamp()+interval '15 seconds') ON CONFLICT(run_id) DO UPDATE SET generation=$2,session_hash=$3,tab_id=$4,fence=CASE WHEN $5 THEN draw_controls.fence ELSE draw_controls.fence+1 END,lease_until=clock_timestamp()+interval '15 seconds' RETURNING fence,lease_until",[run.id,run.generation,session,b.tabId,!!same])).rows[0];
   return row;
  }
  if(!old?.active||old.generation!==run.generation||old.session_hash!==session||old.tab_id!==b.tabId||String(old.fence)!==String(b.fence))fail(409,'CONTROL_LOST','抽奖控制已失效，请重新取得控制');
  await c.query("UPDATE draw_controls SET lease_until=clock_timestamp()+interval '15 seconds' WHERE run_id=$1",[run.id]);
  return {fence:old.fence};
 }
 async act(req:Request,id:string,action:string){
  validateWrite(req);
  if(!['claim','release','heartbeat','start','stop','void','next'].includes(action))fail(404,'NOT_FOUND','操作不存在');
  const b=object(req.body,['mode','generation','tabId','fence',...(action==='start'?['prizeId','version']:action==='stop'?['roundId']:action==='void'?['awardId','confirmed']:action==='next'?['rootId']:[])]);
  return this.db.transaction(async c=>{
   const {user,activity,run}=await this.context(c,req,id,b.mode);
   if(!Number.isSafeInteger(b.generation)||b.generation!==run.generation)fail(409,'GENERATION_CHANGED','彩排数据已清空，请刷新页面');
   if(action==='release'){
    if(!uuid(b.tabId)||typeof b.fence!=='string'||!/^\d{1,20}$/.test(b.fence))fail(422,'INVALID_CONTROL','页面控制信息不正确');
    // Best-effort page exit is idempotent. A delayed release must never revoke
    // another tab, login session, generation or newer claim (even in this tab).
    const released=await c.query("UPDATE draw_controls SET fence=fence+1,lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1 AND generation=$2 AND session_hash=$3 AND tab_id=$4 AND fence::text=$5",[run.id,run.generation,digest(cookie(req,'starlit_session')),b.tabId,b.fence]);
    return {released:!!released.rowCount};
   }
   if(activity.ended||activity.phase==='expired')fail(410,'ACTIVITY_ENDED','活动已到期，只能查看中奖记录');
   if(activity.phase!==b.mode)fail(409,'MODE_LOCKED','当前模式已不是活动运行模式，请从后台重新打开大屏');
   if(action==='claim')return this.control(c,req,run,b,true);
   await this.control(c,req,run,b);
   if(action==='heartbeat')return {ok:true};
   return this.activities.receipt(c,user.id,req,'draw:'+id+':'+action,b,async()=>{
    let result:unknown;
    if(action==='start')result=await this.start(c,activity,run,b);
    else if(action==='stop')result=await this.stop(c,activity,run,b);
    else if(action==='void')result=await this.voidAward(c,run,b);
    else{
     if(!uuid(b.rootId)||run.active_root_id!==b.rootId)fail(409,'ROOT_CHANGED','当前轮次已变化');
     const group=await this.group(c,run);
     if(group.rounds.some(r=>r.status==='drawing')||group.vacancies.length)fail(409,'GROUP_UNFINISHED','请先完成本组抽取与补抽');
     await c.query('UPDATE activity_runs SET active_root_id=NULL WHERE id=$1',[run.id]);result={advanced:true};
    }
    await c.query('UPDATE activity_runs SET version=version+1 WHERE id=$1',[run.id]);
    await c.query('UPDATE activities SET version=version+1 WHERE id=$1',[id]);
    await this.activities.audit(c,user.id,user.id,'draw_'+action,{mode:run.mode,runId:run.id,generation:run.generation,...(result as object)},id);
    return result;
   });
  });
 }
 private async start(c:PoolClient,activity:any,run:any,b:any){
  if(String(b.version)!==String(run.version))fail(409,'VERSION_CONFLICT','抽奖进度刚刚更新，本次未开始。请稍后再次开始抽奖');
  if(!uuid(b.prizeId))fail(422,'INVALID_PRIZE','请选择奖项');
  const group=await this.group(c,run);
  if((await c.query("SELECT 1 FROM draw_rounds WHERE activity_id=$1 AND status='drawing'",[activity.id])).rowCount)fail(409,'ROUND_ACTIVE','已有轮次正在抽取，请先停止并完成揭晓');
  if(run.active_root_id&&!group.vacancies.length)fail(409,'RESULT_VISIBLE','请先进入下一轮');
  const config=(await c.query('SELECT form,rule,prizes FROM activity_configurations WHERE activity_id=$1',[activity.id])).rows[0];
  const prize=config?.prizes.find((p:any)=>p.id===b.prizeId);
  if(!prize)fail(422,'INVALID_PRIZE','奖项不存在');
  if(run.active_root_id&&group.rounds[0]?.prize_id!==prize.id)fail(409,'REPLACEMENT_PRIZE','请先补齐当前奖项');
  const used=(await c.query("SELECT count(*)::int n FROM draw_awards WHERE run_id=$1 AND prize_id=$2 AND status='valid'",[run.id,prize.id])).rows[0].n;
  const count=run.active_root_id?Math.min(group.vacancies.length,10):Math.min(prize.batch,prize.total-used);
  if(count<=0||used+count>prize.total)fail(409,'PRIZE_FULL','该奖项名额已全部发放，请切换其他奖项');
  const {pool,forced}=await this.candidatePool(c,run,config,prize,count);
  if(pool.length<count)fail(409,'NOT_ENOUGH_CANDIDATES','本轮需 '+count+' 人，当前合资格人数仅 '+pool.length+' 人。请减少每轮人数，或在后台增加合资格参与人员。');
  const id=randomUUID(),root=run.active_root_id??id;
  await c.query('INSERT INTO configuration_versions(activity_id,version,form,rule,prizes) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[activity.id,activity.version,JSON.stringify(config.form),JSON.stringify(config.rule),JSON.stringify(config.prizes)]);
  await c.query("INSERT INTO draw_rounds(id,activity_id,run_id,generation,prize_id,config_version,status,root_round_id,candidates,snapshot,draw_count,replacements) VALUES($1,$2,$3,$4,$5,$6,'drawing',$7,$8,$9,$10,$11)",[id,activity.id,run.id,run.generation,prize.id,activity.version,root,JSON.stringify(pool),JSON.stringify({prize,rule:config.rule,form:config.form,forced,drawPolicy:'reserved-first'}),count,JSON.stringify(group.vacancies.slice(0,count).map(a=>a.id))]);
  await c.query('UPDATE activity_runs SET active_root_id=$2,first_started_at=coalesce(first_started_at,clock_timestamp()) WHERE id=$1',[run.id,root]);
  if(run.mode==='formal')await c.query('UPDATE activities SET first_formal_started_at=coalesce(first_formal_started_at,clock_timestamp()) WHERE id=$1',[activity.id]);
  return {roundId:id,rootId:root,count,candidateCount:pool.length,prizeName:prize.name,replacement:!!group.vacancies.length};
 }
 // The preflight and actual draw share this exact eligibility/reservation policy.
 private async candidatePool(c:PoolClient,run:any,config:any,prize:any,count:number){
  const candidates=(await c.query(`SELECT p.id,
   (SELECT count(*)::int FROM draw_awards a WHERE a.run_id=$1 AND a.participant_id=p.id AND a.status='valid') wins,
   (SELECT count(*)::int FROM designated_reservations d WHERE d.run_id=$1 AND d.participant_id=p.id AND d.status='reserved') reserved,
   EXISTS(SELECT 1 FROM designated_reservations d WHERE d.run_id=$1 AND d.participant_id=p.id AND d.prize_id=$3 AND d.status='reserved') designated
   FROM activity_participants p WHERE p.run_id=$1 AND p.generation=$2 AND p.eligible AND NOT EXISTS(SELECT 1 FROM draw_awards a WHERE a.run_id=$1 AND a.prize_id=$3 AND a.participant_id=p.id AND a.status='valid') ORDER BY p.created_at,p.id`,[run.id,run.generation,prize.id])).rows;
  const limit=config.rule.mode==='across'?Infinity:config.rule.mode==='once'?1:config.rule.maxWins;
  const designatedPool=candidates.filter(p=>p.designated&&p.wins+p.reserved<=limit).map(p=>p.id);
  const forced=prize.mode!=='random'?designatedPool.slice(0,count):[];
  const randomPool=candidates.filter(p=>!forced.includes(p.id)&&p.wins+p.reserved<limit&&(prize.mode==='random'||!p.designated)).map(p=>p.id);
  const pool=[...forced,...randomPool];
  return {pool,forced};
 }
 private async stop(c:PoolClient,activity:any,run:any,b:any){
  if(!uuid(b.roundId))fail(422,'INVALID_ROUND','轮次编号不正确');
  const round=(await c.query('SELECT * FROM draw_rounds WHERE id=$1 AND run_id=$2 AND generation=$3',[b.roundId,run.id,run.generation])).rows[0];
  if(!round)fail(404,'NOT_FOUND','轮次不存在');
  if(round.status==='completed')return {roundId:round.id};
  if(round.status!=='drawing'||round.root_round_id!==run.active_root_id)fail(409,'ROUND_CLOSED','本轮已结束或已到期，不能再次开奖，请刷新查看最新进度');
  if(!round.draw_count||!round.snapshot.prize)fail(409,'LEGACY_ROUND','旧轮次不能继续开奖');
  const pool=[...round.candidates],chosen:string[]=[];
  for(let i=0;i<round.draw_count;i++){
   const n=(round.snapshot.prize.mode==='designated'&&round.snapshot.drawPolicy!=='reserved-first')||(round.snapshot.forced??[]).includes(pool[0])?0:randomInt(pool.length);
   chosen.push(pool.splice(n,1)[0]);
  }
  for(let i=0;i<chosen.length;i++){
   const person=(await c.query('SELECT p.id,p.nickname,p.avatar_url,p.answers,p.eligible,v.form AS signup_form FROM activity_participants p JOIN configuration_versions v ON v.activity_id=p.activity_id AND v.version=p.form_version WHERE p.id=$1 AND p.run_id=$2',[chosen[i],run.id])).rows[0];
   if(!person?.eligible)fail(409,'CANDIDATE_CHANGED','本轮候选资格发生变化，不能继续开奖');
   const form=round.snapshot.form,fieldValue=(id:string)=>{const f=person.signup_form.fields.find((x:any)=>x.id===id);return f?answerLabel(f,person.answers[id]):'';};
   const display={nickname:person.nickname,avatarUrl:person.avatar_url,title:fieldValue(form.titleFieldId)||person.nickname,auxiliary:[],prizeName:round.snapshot.prize.name,method:(round.snapshot.prize.mode==='designated'&&round.snapshot.drawPolicy!=='reserved-first')||(round.snapshot.forced??[]).includes(person.id)?'designated':'random'};
   await c.query("INSERT INTO draw_awards(activity_id,run_id,generation,round_id,participant_id,prize_id,status,display_snapshot,replaces_award_id) VALUES($1,$2,$3,$4,$5,$6,'valid',$7,$8)",[activity.id,run.id,run.generation,round.id,person.id,round.prize_id,JSON.stringify(display),round.replacements[i]??null]);
   if(display.method==='designated')await c.query("UPDATE designated_reservations SET status='issued' WHERE participant_id=$1 AND prize_id=$2 AND status='reserved'",[person.id,round.prize_id]);
  }
  if(!(await c.query('SELECT expires_at>clock_timestamp() AS active FROM activities WHERE id=$1',[activity.id])).rows[0].active)fail(410,'ACTIVITY_ENDED','活动已到期，本轮未产生结果');
  await c.query("UPDATE draw_rounds SET status='completed',completed_at=clock_timestamp() WHERE id=$1",[round.id]);
  return {roundId:round.id};
 }
 private async voidAward(c:PoolClient,run:any,b:any){
  if(!uuid(b.awardId)||b.confirmed!==true)fail(422,'CONFIRM_REQUIRED','请确认不在场人员');
  const group=await this.group(c,run);
  if(group.rounds.some(r=>r.status==='drawing'))fail(409,'ROUND_ACTIVE','抽取中不能作废');
  const award=group.awards.find(a=>a.id===b.awardId);
  if(!award)fail(409,'HISTORY_READ_ONLY','只能处理当前展示组的中奖者');
  if(award.status==='void')return {awardId:award.id};
  await c.query("UPDATE draw_awards SET status='void',reason='absent' WHERE id=$1",[award.id]);
  await c.query("UPDATE activity_participants SET eligible=false,exclusion_kind='absent',exclusion_reason='中奖后不在场',version=version+1 WHERE id=$1",[award.participant_id]);
  await c.query("UPDATE designated_reservations SET status='cancelled' WHERE participant_id=$1 AND status='reserved'",[award.participant_id]);
  return {awardId:award.id};
 }
 async records(req:Request,id:string){
  const q=object(req.query,['mode','page']);const page=Number(q.page??1);
  if(!Number.isSafeInteger(page)||page<1)fail(422,'INVALID_PAGE','页码不正确');
  return this.db.transaction(async c=>{
   const {run}=await this.context(c,req,id,q.mode);
   const total=(await c.query('SELECT count(*)::int n FROM draw_awards WHERE run_id=$1 AND generation=$2',[run.id,run.generation])).rows[0].n;
   const items=(await c.query(`SELECT a.id,a.participant_id,a.round_id,a.prize_id,a.status,a.reason,a.display_snapshot,a.replaces_award_id,a.created_at,previous.display_snapshot->>'nickname' AS replaced_nickname FROM draw_awards a LEFT JOIN draw_awards previous ON previous.id=a.replaces_award_id AND previous.run_id=a.run_id AND previous.generation=a.generation WHERE a.run_id=$1 AND a.generation=$2 ORDER BY a.created_at DESC,a.id DESC LIMIT 25 OFFSET $3`,[run.id,run.generation,(page-1)*25])).rows;
   return {items,total,page,pageSize:25};
  });
 }
 async export(req:Request,id:string){
  const q=object(req.query,['mode']);
  const snapshot=await this.db.transaction(async c=>{
   const {run}=await this.context(c,req,id,q.mode);
   const rows=(await c.query('SELECT id,participant_id,round_id,status,reason,display_snapshot,replaces_award_id,created_at FROM draw_awards WHERE run_id=$1 AND generation=$2 ORDER BY created_at,id LIMIT 10001',[run.id,run.generation])).rows;
   if(rows.length>10000)fail(422,'EXPORT_TOO_LARGE','本次记录超过 10000 条，暂不支持导出');
   return {rows,generation:run.generation,version:run.version};
  });
  const rows=snapshot.rows;
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet(q.mode==='formal'?'正式中奖名单':'彩排中奖名单',{views:[{state:'frozen',ySplit:1}]});
  sheet.addRow(['序号','微信昵称','奖项','中奖状态','抽取时间','补抽说明']);
  const byId=new Map(rows.map(r=>[r.id,r]));
  rows.forEach((r,index)=>{
   const previous=r.replaces_award_id?byId.get(r.replaces_award_id):null;
   const replacement=r.replaces_award_id?'补抽，替代'+(previous?.display_snapshot.nickname||'原中奖者'):'正常抽取';
   const status=r.status==='valid'?'有效中奖':r.reason==='absent'?'作废（不在场）':'作废';
   sheet.addRow([index+1,r.display_snapshot.nickname??'',r.display_snapshot.prizeName??'',status,beijing(r.created_at),replacement]);
  });
  sheet.getRow(1).font={bold:true};
  [8,24,20,20,24,36].forEach((width,index)=>{sheet.getColumn(index+1).width=width;});
  sheet.autoFilter='A1:F1';
  const bytes=Buffer.from(await book.xlsx.writeBuffer());
  await this.db.transaction(async c=>{
   const {user,run}=await this.context(c,req,id,q.mode);
   if(run.generation!==snapshot.generation||run.version!==snapshot.version)fail(409,'EXPORT_CHANGED','名单在生成期间发生变化，请重新导出');
   await this.activities.audit(c,user.id,user.id,'awards_export_generated',{mode:run.mode,runId:run.id,count:rows.length},id);
  });
  return bytes;
 }
}
