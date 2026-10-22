// Explicit display allowlist: never return the stored JSON payload to the browser.
export const auditActions:Record<string,{title:string;category:string}>={
 activity_created:{title:'创建活动',category:'settings'},activity_updated:{title:'修改基本信息',category:'settings'},
 checkin_settings_updated:{title:'修改签到背景',category:'settings'},asset_uploaded:{title:'上传图片',category:'settings'},
 configuration_form:{title:'修改签到字段',category:'settings'},configuration_checkin:{title:'保存签到设置',category:'settings'},
 configuration_rule:{title:'修改中奖规则',category:'settings'},configuration_prizes:{title:'修改奖项',category:'settings'},
 'configuration_prize-settings':{title:'保存奖项设置',category:'settings'},
 wechat_configuration_saved:{title:'更新微信接入配置',category:'settings'},
 wechat_verification_uploaded:{title:'上传微信校验文件',category:'settings'},
 wechat_readiness_checked:{title:'检查微信接入',category:'settings'},
 participant_exclude:{title:'排除抽奖资格',category:'participants'},participant_restore:{title:'恢复抽奖资格',category:'participants'},participant_answers:{title:'修改签到资料',category:'participants'},
 draw_start:{title:'开始抽奖',category:'draw'},draw_stop:{title:'保存中奖结果',category:'draw'},draw_void:{title:'中奖者不在场，空出名额',category:'draw'},draw_next:{title:'进入下一轮',category:'draw'},
 'clear-rehearsal':{title:'清空全部彩排数据',category:'data'},'reset-draw':{title:'清空彩排抽奖',category:'data'},promote:{title:'启用正式活动',category:'data'},
 rehearsal_simulated:{title:'生成彩排模拟参与者',category:'participants'},
 participants_export_created:{title:'生成签到名单',category:'data'},participants_export_downloaded:{title:'下载签到名单',category:'data'},
 awards_export_generated:{title:'生成中奖名单下载文件',category:'data'},
};
export function auditView(row:any){
 const action=auditActions[row.action]??{title:'历史操作',category:'other'},d=row.details??{},lines:string[]=[];
 const count=(key:string,label:string)=>{if(typeof d[key]==='number'&&Number.isSafeInteger(d[key])&&d[key]>=0)lines.push(label+'：'+d[key]);};
 if(d.historyCleared===true)lines.push('关联彩排数据已清空，仅保留操作时间与类型');
 else{
  count('count','人数');count('participants','签到人数');count('rounds','轮次数');count('awards','中奖记录数');if(['configuration_form','configuration_checkin'].includes(row.action))count('fieldCount','字段数');if(['configuration_prizes','configuration_prize-settings'].includes(row.action))count('prizeCount','奖项数');
  for(const [key,label] of [['participantId','人员编号'],['roundId','轮次编号'],['awardId','中奖记录编号']] as const){
   if(typeof d[key]==='string'&&/^[0-9a-f-]{36}$/i.test(d[key]))lines.push(label+'：'+d[key]);
  }
  if(typeof d.prizeName==='string')lines.push('奖项：'+d.prizeName.slice(0,100));
  if(row.action.startsWith('configuration_')&&typeof d.reason==='string'&&d.reason.trim())lines.push('修改原因：'+d.reason.slice(0,300));
  if(row.action==='draw_start'&&d.replacement===true)lines.push('本轮为补抽，仅补空缺名额');
  if(row.action==='draw_void')lines.push('原因：不在场。须在大屏重新开始、停止补抽');
  if(row.action==='reset-draw')lines.push('保留签到名单和活动配置');
  if(row.action==='clear-rehearsal')lines.push('保留活动配置，彩排签到与中奖数据已清空');
  if(row.action==='rehearsal_simulated')count('simulated','模拟参与者总数');
  if(row.action==='asset_uploaded')lines.push(({activity_logo:'品牌 Logo',h5_background:'签到 H5 背景',stage_background:'大屏背景'} as Record<string,string>)[d.purpose]??'活动图片');
  if(row.action==='wechat_configuration_saved')lines.push(d.source==='custom'?'使用自定义服务号':'使用平台服务号');
 }
 return {id:row.id,createdAt:row.created_at,title:action.title,category:action.category,
  mode:row.operation_mode??null,actor:row.actor_role==='platform_admin'?'平台管理员':'活动所属账号',
  lines:lines.length?lines:['操作已成功保存；此条记录未保存更详细的修改内容。']};
}
