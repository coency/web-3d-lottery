import {Injectable} from '@nestjs/common';
import type {Request,Response} from 'express';
import type {PoolClient} from 'pg';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {joinPerson} from './signup-display';
import {snapshotJoinForm,matchesJoinForm,normalizeJoinForm} from './join-form-version';
import {DatabaseService} from '../database.service';
import {ActivitiesService} from './activities.service';
import {AuthService} from '../auth/auth.service';
import {cookie,cookieOptions,digest,equal,fail,mac,validateWrite,AuthError} from '../auth/security';
import {object} from './validation';
import {validateAnswers} from './configuration.validation';
import {openSecret} from './wechat-vault';
import {oauthProvider,oauthReady,authorizeUrl,exchangeIdentity} from './wechat-provider';

@Injectable()
export class WechatJoinService {
 constructor(private db:DatabaseService,private activities:ActivitiesService,private auth:AuthService){}
 private async binding(c:PoolClient,a:any){
  const config=(await c.query('SELECT * FROM wechat_configurations WHERE scope=$1 FOR UPDATE',[a.id])).rows[0];
  const credential=config?.credential_id?(await c.query('SELECT * FROM wechat_credentials WHERE id=$1',[config.credential_id])).rows[0]:null;
  if(credential&&config.source==='custom'&&(credential.owner_id!==a.owner_id||credential.activity_id!==a.id))fail(403,'WECHAT_SCOPE_REJECTED','服务号配置不属于本场活动');
  return credential;
 }
 private async context(c:PoolClient,code:string){
  if(!/^[0-9a-f]{48}$/.test(code))fail(404,'JOIN_NOT_FOUND','签到链接不存在，请重新扫码');
  const entry=(await c.query('SELECT e.*,a.owner_id FROM join_entries e JOIN activities a ON a.id=e.activity_id WHERE e.code=$1',[code])).rows[0];
  if(!entry)fail(404,'JOIN_NOT_FOUND','签到链接不存在，请重新扫码');
  const owner=(await c.query('SELECT status FROM users WHERE id=$1 FOR UPDATE',[entry.owner_id])).rows[0];
  if(owner?.status!=='active')fail(403,'ACTIVITY_UNAVAILABLE','活动暂不可用，请联系主办方');
  const activity=(await c.query('SELECT *,expires_at<=clock_timestamp() AS ended FROM activities WHERE id=$1 FOR UPDATE',[entry.activity_id])).rows[0];
  const run=(await c.query('SELECT * FROM activity_runs WHERE id=$1 AND activity_id=$2 FOR UPDATE',[entry.run_id,activity.id])).rows[0];
  if(!run)fail(404,'JOIN_NOT_FOUND','签到链接不存在');
  const provider=oauthProvider();
  if(provider==='mock'&&run.mode!=='rehearsal')fail(403,'MOCK_FORMAL_FORBIDDEN','模拟微信接口不能用于正式活动');
  const credential=await this.binding(c,activity);
  await c.query('INSERT INTO activity_configurations(activity_id) VALUES($1) ON CONFLICT DO NOTHING',[activity.id]);
  const cfg=(await c.query('SELECT * FROM activity_configurations WHERE activity_id=$1',[activity.id])).rows[0];
  cfg.form=normalizeJoinForm(cfg.form);
  return {entry,activity,run,credential,cfg,provider};
 }
 private sessionName(code:string){return 'starlit_join_'+code;}
 private async session(c:PoolClient,req:Request,x:Awaited<ReturnType<WechatJoinService['context']>>){
  return (await c.query('SELECT * FROM participant_sessions WHERE token_hash=$1 AND entry_code=$2 AND generation=$3 AND credential_id=$4 AND provider=$5 AND expires_at>clock_timestamp()',[digest(cookie(req,this.sessionName(x.entry.code))),x.entry.code,x.run.generation,x.credential?.id??null,x.provider])).rows[0]??null;
 }
 async entry(req:Request,id:string){
  const b=object(req.query,['mode']);if(b.mode!=='rehearsal'&&b.mode!=='formal')fail(422,'INVALID_MODE','请选择签到模式');
  return this.db.transaction(async c=>{
   const owner=await this.activities.identity(c,req),a=await this.activities.access(c,owner.id,id);
   const run=(await c.query('SELECT * FROM activity_runs WHERE activity_id=$1 AND mode=$2 FOR UPDATE',[id,b.mode])).rows[0];
   const code=(await c.query('INSERT INTO join_entries(code,activity_id,run_id) VALUES($1,$2,$3) ON CONFLICT(run_id) DO UPDATE SET run_id=EXCLUDED.run_id RETURNING code',[randomBytes(24).toString('hex'),id,run.id])).rows[0].code;
   const credential=await this.binding(c,a),provider=oauthProvider();
   const available=oauthReady()&&!!credential&&(provider!=='mock'||(b.mode==='rehearsal'&&credential.app_id.startsWith('mock_')));
   return {url:process.env.APP_ORIGIN+'/join.html?code='+code,code,mode:b.mode,available,provider:provider??'disabled',reason:!provider?'微信授权尚未启用':!oauthReady()?'需先配置可访问的 HTTPS 部署地址':!credential?'请先配置本场微信服务号':!available?'测试授权仅支持专用彩排测试服务号':'',demoUrl:process.env.NODE_ENV==='development'&&b.mode==='rehearsal'?process.env.APP_ORIGIN+'/join.html?activity='+id:null};
  });
 }
 async me(req:Request,code:string){return this.db.transaction(async c=>{
  const x=await this.context(c,code),session=await this.session(c,req,x);
  const p=session?(await c.query('SELECT * FROM activity_participants WHERE run_id=$1 AND generation=$2 AND identity_key=$3',[x.run.id,x.run.generation,session.identity_key])).rows[0]:null;
  const a=x.activity,base='/api/v1/join/'+code;
  await snapshotJoinForm(c,a,x.cfg);
  return {development:x.provider==='mock',mode:x.run.mode,generation:x.run.generation,version:a.version,ended:a.ended||a.phase==='expired',readOnly:a.phase!==x.run.mode,
   name:a.name,tagline:a.display.tagline?a.tagline:'',organizer:a.display.organizer?a.organizer:'',logoUrl:a.display.logo&&a.logo_asset_id?base+'/image/logo':null,backgroundUrl:a.display.h5Background&&a.h5_background_asset_id?base+'/image/background':null,
   form:x.cfg.form,person:await joinPerson(c,p,x.cfg.form),authenticated:!!session,profile:session?{nickname:session.nickname,avatarUrl:session.avatar_id?base+'/avatar/'+session.avatar_id:'/avatar-placeholder.svg'}:null,
   authorizationAvailable:oauthReady()&&!!x.credential,requiresWechat:x.provider==='wechat'&&!/MicroMessenger/i.test(req.get('user-agent')??'')};
 });}
 async start(req:Request,res:Response,code:string){
  validateWrite(req);object(req.body,[]);await this.auth.rate('wechat-start',req.ip??'unknown',12000,60);
  if(!oauthReady())fail(503,'WECHAT_NOT_READY','微信授权尚未启用，请联系主办方完成接入');
  return this.db.transaction(async c=>{
   const x=await this.context(c,code);if(!x.credential||!x.provider)fail(503,'WECHAT_NOT_READY','本场服务号尚未配置，请联系主办方');
   if(x.provider==='wechat'&&!/MicroMessenger/i.test(req.get('user-agent')??''))fail(403,'WECHAT_BROWSER_REQUIRED','请使用微信扫码打开签到页面');
   let browser=cookie(req,'starlit_oauth_browser');const parts=browser.split('.');
   if(parts.length!==2||!equal(parts[1]??'',mac('oauth-browser:'+parts[0]))){const nonce=randomBytes(32).toString('hex');browser=nonce+'.'+mac('oauth-browser:'+nonce);res.cookie('starlit_oauth_browser',browser,cookieOptions(86400000));}
   const state=randomBytes(32).toString('hex'),url=authorizeUrl(x.provider,x.credential.app_id,state);
   await c.query('INSERT INTO wechat_oauth_states(token_hash,entry_code,generation,credential_id,browser_hash,provider) VALUES($1,$2,$3,$4,$5,$6)',[digest(state),code,x.run.generation,x.credential.id,digest(browser),x.provider]);
   return {authorizationUrl:url};
  });
 }
 async callback(req:Request,res:Response){
  res.setHeader('Referrer-Policy','no-referrer');
  let code:string|undefined;
  try{
   await this.auth.rate('wechat-callback',req.ip??'unknown',12000,60);
   const state=typeof req.query.state==='string'?req.query.state:'';
   if(!/^[0-9a-f]{64}$/.test(state))fail(401,'OAUTH_STATE_INVALID','授权状态无效，请重新扫码');
   const snapshot=await this.db.transaction(async c=>{
    // Locate without taking a state lock. All writers lock owner/run before
    // state, including rehearsal reset and expired-data cleanup.
    const locate=(await c.query('SELECT entry_code,browser_hash FROM wechat_oauth_states WHERE token_hash=$1',[digest(state)])).rows[0];
    if(!locate||!equal(locate.browser_hash,digest(cookie(req,'starlit_oauth_browser'))))fail(401,'OAUTH_STATE_INVALID','授权已失效，请重新扫码');
    code=locate.entry_code;
    const x=await this.context(c,locate.entry_code);
    // Reset/cleanup or another callback may have consumed/deleted it while we
    // waited for the owner. Revalidate only after acquiring the common locks.
    const row=(await c.query('SELECT *,expires_at>clock_timestamp() AS active FROM wechat_oauth_states WHERE token_hash=$1 FOR UPDATE',[digest(state)])).rows[0];
    if(!row||!row.active||row.consumed_at||row.entry_code!==locate.entry_code||!equal(row.browser_hash,digest(cookie(req,'starlit_oauth_browser'))))fail(401,'OAUTH_STATE_INVALID','授权已失效，请重新扫码');
    if(x.run.generation!==row.generation||x.credential?.id!==row.credential_id||x.provider!==row.provider)fail(409,'OAUTH_CONTEXT_CHANGED','活动配置已更新，请重新扫码');
    await c.query('UPDATE wechat_oauth_states SET consumed_at=clock_timestamp() WHERE token_hash=$1',[digest(state)]);
    return {...row,appId:x.credential.app_id,sealed:x.credential.sealed_secret};
   });
   const authCode=typeof req.query.code==='string'?req.query.code:'';
   if(!authCode||authCode.length>512)fail(401,'WECHAT_AUTH_DENIED','授权未完成，请重新授权');
   // A mock provider can never receive a saved real account's secret.
   if(snapshot.provider==='mock'&&!snapshot.appId.startsWith('mock_'))fail(403,'MOCK_CREDENTIAL_REJECTED','不能用真实服务号进行模拟授权');
   const profile=await exchangeIdentity(snapshot.provider,snapshot.appId,openSecret(snapshot.sealed,snapshot.credential_id),authCode);
   const sessionToken=randomBytes(32).toString('hex');
   await this.db.transaction(async c=>{
    const x=await this.context(c,snapshot.entry_code);
    if(x.run.generation!==snapshot.generation||x.credential?.id!==snapshot.credential_id||x.provider!==snapshot.provider)fail(409,'OAUTH_CONTEXT_CHANGED','活动配置已更新，请重新扫码');
    const avatarId=profile.avatar?randomUUID():null;
    if(avatarId)await c.query('INSERT INTO join_avatars(id,entry_code,bytes) VALUES($1,$2,$3)',[avatarId,snapshot.entry_code,profile.avatar]);
    const identity=(snapshot.provider==='mock'?'mock-wechat:':'wechat:')+digest(JSON.stringify([snapshot.appId,profile.openid]));
    await c.query('INSERT INTO participant_sessions(token_hash,entry_code,generation,credential_id,provider,identity_key,nickname,avatar_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[digest(sessionToken),snapshot.entry_code,snapshot.generation,snapshot.credential_id,snapshot.provider,identity,profile.nickname,avatarId]);
    // Only an actual successful WeChat profile round-trip can supply verification evidence.
    if(snapshot.provider==='wechat'&&profile.nickname&&avatarId&&!x.activity.ended&&x.activity.phase==='rehearsal')await c.query("INSERT INTO activity_wechat_verifications(activity_id,verified_at,valid_until,evidence_reference,credential_id) VALUES($1,clock_timestamp(),clock_timestamp()+interval '24 hours',$2,$3) ON CONFLICT(activity_id) DO UPDATE SET verified_at=EXCLUDED.verified_at,valid_until=EXCLUDED.valid_until,evidence_reference=EXCLUDED.evidence_reference,credential_id=EXCLUDED.credential_id",[x.activity.id,'oauth:'+digest(state),snapshot.credential_id]);
   });
   res.cookie(this.sessionName(snapshot.entry_code),sessionToken,cookieOptions(2*3600000));
   return '/join.html?code='+snapshot.entry_code;
  }catch(e){const reason=e instanceof AuthError?(e.getResponse() as {code:string}).code:'WECHAT_UNAVAILABLE';return '/join.html?'+(code?'code='+code+'&':'')+'authError='+encodeURIComponent(reason);}
 }
 async checkin(req:Request,code:string){
  validateWrite(req);const body=object(req.body,['generation','version','nickname','answers']);await this.auth.rate('wechat-signup',req.ip??'unknown',12000,60);
  return this.db.transaction(async c=>{
   const x=await this.context(c,code),session=await this.session(c,req,x);
   if(!session)fail(401,'PARTICIPANT_AUTH_REQUIRED','身份已过期，请重新授权');
   if(body.generation!==x.run.generation)fail(409,'GENERATION_CHANGED','彩排数据已清空，请重新扫码');
   const old=(await c.query('SELECT * FROM activity_participants WHERE run_id=$1 AND generation=$2 AND identity_key=$3',[x.run.id,x.run.generation,session.identity_key])).rows[0];
   if(old)return joinPerson(c,old,x.cfg.form);
   if(x.activity.ended||x.activity.phase==='expired')fail(410,'ACTIVITY_ENDED','活动已结束，不能新增签到');
   if(x.activity.phase!==x.run.mode)fail(409,'MODE_CHANGED','活动模式已切换，请扫描当前模式的签到二维码');
   if(!await matchesJoinForm(c,x.activity.id,body.version,x.cfg.form))fail(409,'FORM_VERSION_CHANGED','签到设置已更新，请重新加载并核对填写内容');
   const nickname=session.nickname||(typeof body.nickname==='string'?body.nickname.trim():'');
   if(!nickname||nickname.length>64)fail(422,'NICKNAME_REQUIRED','微信未返回昵称，请补充昵称（最多 64 个字）');
   const answers=validateAnswers(x.cfg.form,body.answers);
   await c.query('INSERT INTO configuration_versions(activity_id,version,form,rule,prizes) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[x.activity.id,x.activity.version,JSON.stringify(x.cfg.form),JSON.stringify(x.cfg.rule),JSON.stringify(x.cfg.prizes)]);
   const avatar=session.avatar_id?'/api/v1/join/'+code+'/avatar/'+session.avatar_id:'/avatar-placeholder.svg';
   const p=(await c.query('INSERT INTO activity_participants(activity_id,run_id,generation,identity_key,nickname,answers,form_version,avatar_url,profile_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[x.activity.id,x.run.id,x.run.generation,session.identity_key,nickname,JSON.stringify(answers),x.activity.version,avatar,x.provider==='mock'?'mock':session.nickname?'wechat':'supplemented'])).rows[0];
   await c.query('UPDATE activity_runs SET version=version+1 WHERE id=$1',[x.run.id]);return joinPerson(c,p,x.cfg.form);
  });
 }
 async image(code:string,kind:string){
  const key=await this.db.transaction(async c=>{const {activity:a}=await this.context(c,code);const id=kind==='logo'&&a.display.logo?a.logo_asset_id:kind==='background'&&a.display.h5Background?a.h5_background_asset_id:null;const row=(await c.query("SELECT object_key FROM assets WHERE id=$1 AND owner_id=$2 AND activity_id=$3 AND status='ready'",[id,a.owner_id,a.id])).rows[0];if(!row||!/^[-0-9a-f]+\.webp$/.test(row.object_key))fail(404,'NOT_FOUND','图片不存在');return row.object_key;});
  try{return await readFile(path.join(path.resolve(process.env.ASSET_DIRECTORY??path.join(process.cwd(),'.local','uploads')),key));}catch{fail(404,'NOT_FOUND','图片暂不可用');}
 }
 async avatar(code:string,id:string){return this.db.transaction(async c=>{
  await this.context(c,code);if(!/^[a-f0-9-]{36}$/.test(id))fail(404,'NOT_FOUND','头像不存在');
  const row=(await c.query('SELECT bytes FROM join_avatars WHERE entry_code=$1 AND id=$2',[code,id])).rows[0];if(!row)fail(404,'NOT_FOUND','头像不存在');return row.bytes;
 });}
}
