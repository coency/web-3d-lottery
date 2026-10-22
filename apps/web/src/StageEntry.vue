<script setup lang="ts">
import {computed,onUnmounted,ref} from 'vue';
import {ElButton,ElDialog} from 'element-plus';
import 'element-plus/es/components/dialog/style/css';
import 'element-plus/es/components/button/style/css';
import {get,RequestError} from './api';
type Section='mode'|'checkin'|'roster'|'prizes';
type Activity={id:string;name:string;mode:'formal'|'rehearsal';phase:string};
type Draw={generation:number;phase:string;signedIn:number;eligibleCount:number;prizes:{id:string;name:string;total:number;awarded:number}[];rounds:{status:string}[]};
const props=defineProps<{activityId:string}>();
const emit=defineEmits<{configure:[section:Section];expired:[]}>();
const visible=ref(false),busy=ref(false),error=ref('');
const result=ref<{activity:Activity;draw:Draw;wechat:boolean;eligible:number}|null>(null);
let request=0;
async function check(){
 const token=++request;busy.value=true;error.value='';result.value=null;
 try{
  const base='/api/v1/activities/'+props.activityId;
  const activity=await get<Activity>(base);
  const [config,draw]=await Promise.all([
   get<{phase:string;wechatVerified:boolean}>(base+'/configuration'),
   get<Draw>(base+'/draw?mode='+activity.mode)
  ]);
  if(token!==request)return;
  if(config.phase!==draw.phase||draw.phase!=='expired'&&draw.phase!==activity.mode)throw new Error('活动状态刚刚变化，请重新检查。');
  result.value={activity,draw,wechat:config.wechatVerified,eligible:draw.eligibleCount};
 }catch(e){if(token===request){error.value=e instanceof Error?e.message:'检查失败，请重试';if(e instanceof RequestError&&e.status===401)emit('expired');}}
 finally{if(token===request)busy.value=false;}
}
const checks=computed(()=>{
 const r=result.value;if(!r)return [];
 const remaining=r.draw.prizes.reduce((n,p)=>n+Math.max(0,p.total-p.awarded),0);
 return [
  {title:'活动模式',ok:r.draw.phase==='formal',text:r.draw.phase==='expired'?'活动已到期，只能查看记录':r.activity.mode==='formal'?'正式活动':'彩排模式，结果不计入正式活动',action:r.draw.phase==='rehearsal'?'查看模式':'',section:'mode' as Section},
  {title:'微信接入',ok:r.wechat,text:r.wechat?'接入已就绪':'尚未就绪，微信签到前需完成配置',action:r.wechat?'':'前往配置',section:'checkin' as Section},
  {title:'有效参与人数',ok:r.eligible>0,text:r.eligible+' 人 · 已签到 '+r.draw.signedIn+' 人',action:r.eligible?'查看名单':r.activity.mode==='rehearsal'?'添加模拟参与者':'查看名单',section:(r.eligible||r.activity.mode==='formal'?'roster':'mode') as Section},
  {title:'奖项名额',ok:remaining>0,text:r.draw.prizes.length?r.draw.prizes.length+' 个奖项 · 剩余 '+remaining+' 个名额':'尚未设置奖项',action:'查看奖项',section:'prizes' as Section}
 ];
});
function configure(section:Section){visible.value=false;emit('configure',section);}
function close(){request++;busy.value=false;}
onUnmounted(close);
</script>
<template>
 <ElButton type="primary" @click="visible=true;check()">大屏抽奖</ElButton>
 <ElDialog v-model="visible" title="活动开始前检查" width="560px" align-center append-to-body @close="close">
  <p v-if="busy" role="status">正在检查活动状态…</p>
  <p v-else-if="error" role="alert" class="check-error">{{error}}</p>
  <template v-else-if="result">
   <p class="check-name">{{result.activity.name}}</p>
   <ul class="entry-checks">
    <li v-for="item in checks" :key="item.title"><span :class="item.ok?'check-ok':'check-warn'" :aria-label="item.ok?'通过':'提示'">{{item.ok?'✓':'!'}}</span><div><strong>{{item.title}}</strong><p>{{item.text}}</p></div><ElButton v-if="item.action" link @click="configure(item.section)">{{item.action}}</ElButton></li>
   </ul>
   <p v-if="result.draw.rounds.some(r=>r.status==='drawing')" class="check-warn">已有轮次正在抽取，请使用原大屏操作。</p>
   <p class="check-note">进入大屏后检查本机头像、主题资源、网络和控制权限。各奖项中奖资格由服务器在开始抽奖时再次核验。</p>
  </template>
  <template #footer><ElButton :loading="busy" @click="check">重新检查</ElButton><ElButton v-if="result&&!busy&&!error" type="primary" tag="a" :href="'/stage.html?activity='+activityId+'&mode='+result.activity.mode" target="_blank" rel="noopener" @click="visible=false">进入大屏</ElButton></template>
 </ElDialog>
</template>
<style scoped>
.check-name{margin:0 0 10px;color:#d4bd91}.entry-checks{list-style:none;padding:0;margin:0}.entry-checks li{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid #ffffff12}.entry-checks li>span{width:20px;flex-shrink:0;text-align:center}.entry-checks li>div{flex:1;min-width:0}.entry-checks strong{font-weight:500}.entry-checks p{margin:5px 0 0;font-size:12px;color:#abb6ca;line-height:1.6}.check-ok{color:#9ed5b2}.check-warn{color:#e6c796}.check-error{color:#f4b4ba}.check-note{font-size:12px;line-height:1.7;color:#abb6ca;margin:16px 0 0}
</style>
