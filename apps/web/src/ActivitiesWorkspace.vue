<script setup lang="ts">

import {ElRadioGroup,ElRadioButton,ElTable,ElTableColumn,ElIcon,ElAvatar,ElAlert} from 'element-plus';
import 'element-plus/es/components/alert/style/css';
import 'element-plus/es/components/avatar/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/radio-group/style/css';
import 'element-plus/es/components/radio-button/style/css';
import 'element-plus/es/components/table/style/css';
import {ElTabs,ElTabPane,ElCard} from 'element-plus';
import 'element-plus/es/components/card/style/css';
import 'element-plus/es/components/tabs/style/css';
import {ElMenu,ElMenuItem,ElDropdown,ElDropdownMenu,ElDropdownItem,ElUpload,ElImage,ElEmpty,ElTag} from 'element-plus';
import 'element-plus/es/components/menu/style/css';
import 'element-plus/es/components/dropdown/style/css';
import 'element-plus/es/components/upload/style/css';
import 'element-plus/es/components/image/style/css';
import 'element-plus/es/components/empty/style/css';
import 'element-plus/es/components/tag/style/css';
import {ElForm} from 'element-plus';
import 'element-plus/es/components/form/style/css';
import {ElButton,ElInput,ElCheckbox} from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/checkbox/style/css';
import {subscribeUpdates} from './realtime';
import {prunePortraitCaches} from '../stage/portrait-store.js';
const ActivityAudit=defineAsyncComponent(()=>import('./ActivityAudit.vue'));
import WechatSettings from './WechatSettings.vue';
import JoinEntry from './JoinEntry.vue';
import StageEntry from './StageEntry.vue';
import TopNotice from './TopNotice.vue';
import { computed,onMounted,onUnmounted,reactive,ref,nextTick,defineAsyncComponent,watch } from 'vue';
import { get,write,RequestError } from './api';
import EndDatePicker from './EndDatePicker.vue';
import DrawWorkspace from './DrawWorkspace.vue';
import PersonalCenter from './PersonalCenter.vue';
import ParticipantRoster from './ParticipantRoster.vue';
import ActivityConfiguration from './ActivityConfiguration.vue';
const props=defineProps<{user:{id:string;account:string;role:string};loggingOut:boolean}>();
const emit=defineEmits<{logout:[];expired:[];profileUpdated:[]}>();
type Entitlement={created_activity_count:number;can_create:boolean;server_now:string};
type Activity={participant_count?:number;id:string;name:string;phase:string;mode:'formal'|'rehearsal';created_at:string;expires_at:string;version:string;logo_asset_id:string|null;h5_background_asset_id:string|null;stage_background_asset_id:string|null;logoUrl:string|null;h5BackgroundUrl:string|null;stageBackgroundUrl:string|null;tagline:string;organizer:string;coorganizer:string;display:Record<string,boolean>};
const rows=ref<Activity[]>([]),rights=ref<Entitlement|null>(null),error=ref(''),message=ref(''),loading=ref(false),saving=ref(false),uploads=ref(0);
const tab=ref<'basic'|'checkin'|'prizes'|'mode'|'roster'|'draw'|'awards'|'audit'>('basic');
const uploadStates=reactive({activity_logo:{kind:'',message:''},h5_background:{kind:'',message:''},stage_background:{kind:'',message:''}});
const activityView=ref('cards');
const basicTab=ref('details');
function revealBasicInvalid(event:Event){if(basicTab.value==='details')return;event.preventDefault();basicTab.value='details';const input=event.target as HTMLInputElement;void nextTick(()=>{input.focus();input.reportValidity();});}
const accountPopperOptions={modifiers:[{name:'sameWidth',enabled:true,phase:'beforeWrite' as const,requires:['computeStyles'],fn:({state}:{state:{rects:{reference:{width:number}};styles:{[key:string]:Partial<CSSStyleDeclaration>}}})=>{state.styles.popper={...state.styles.popper,width:state.rects.reference.width+'px'};}}]};
const personal=ref(false);
const editing=ref(false),selected=ref<Activity|null>(null),clock=ref(Date.now());
let alive=true,editorEpoch=0,refreshSequence=0,formActivityId:string|null=null;
function leaveEditor(){editorEpoch++;editing.value=false;personal.value=false;}
watch(personal,()=>{editorEpoch++;},{flush:'sync'});
let anchor=Date.now(),tick=performance.now(),timer:ReturnType<typeof setInterval>;
const displayLabels:Record<string,string>={logo:'品牌 Logo',tagline:'宣传语',organizer:'主办方',coorganizer:'协办方',stageBackground:'大屏背景'};
const empty=()=>({name:'',end:'',logoAssetId:null as string|null,h5BackgroundAssetId:null as string|null,stageBackgroundAssetId:null as string|null,tagline:'',organizer:'',coorganizer:'',display:{...Object.fromEntries(Object.keys(displayLabels).map(k=>[k,true])),h5Background:true} as Record<string,boolean>});
const form=reactive(empty()),previews=reactive({activity_logo:'',h5_background:'',stage_background:''});
const ended=(a:Activity)=>a.phase==='expired'||Date.parse(a.expires_at)<=clock.value;
const readOnly=computed(()=>!!selected.value&&ended(selected.value));
const canCreate=computed(()=>!!rights.value);
const local=(value:string|number)=>new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,16);
const minTime=computed(()=>local(clock.value).slice(0,10));
const maxTime=computed(()=>local((selected.value?Date.parse(selected.value.created_at):clock.value)+29*86400000).slice(0,10));
function fail(e:unknown){if(e instanceof RequestError&&e.status===401){emit('expired');return;}error.value=e instanceof Error?e.message:'操作失败，请稍后重试';}
let workspaceLoadFailed=false;
async function load(){
 loading.value=true;error.value='';
 try{const [list,entitlement]=await Promise.all([get<Activity[]>('/api/v1/activities'),get<Entitlement>('/api/v1/entitlements/me')]);rows.value=list;rights.value=entitlement;workspaceLoadFailed=false;anchor=Date.parse(entitlement.server_now);tick=performance.now();clock.value=anchor;void prunePortraitCaches(props.user.id,list).catch(()=>{});}
 catch(e){workspaceLoadFailed=true;fail(e);}finally{loading.value=false;}
}
function create(){editorEpoch++;formActivityId=null;basicTab.value='details';tab.value='basic';resetUploads();selected.value=null;Object.assign(form,empty());Object.keys(previews).forEach(k=>previews[k as keyof typeof previews]='');editing.value=true;error.value='';message.value='';}
async function open(a:Activity,section:'basic'|'checkin'='basic'){
 const epoch=++editorEpoch;resetUploads();
 error.value='';message.value='';
 try{const current=await get<Activity>('/api/v1/activities/'+a.id);
 if(!alive||epoch!==editorEpoch)return false;
 tab.value=section;selected.value=current;formActivityId=current.id;
 Object.assign(form,{name:current.name,end:local(current.expires_at).slice(0,10),logoAssetId:current.logo_asset_id,h5BackgroundAssetId:current.h5_background_asset_id,stageBackgroundAssetId:current.stage_background_asset_id,tagline:current.tagline,organizer:current.organizer,coorganizer:current.coorganizer,display:{...Object.fromEntries(Object.entries(current.display).filter(([key])=>key!=='location')),h5Background:true}});
 Object.assign(previews,{activity_logo:current.logoUrl??'',h5_background:current.h5BackgroundUrl??'',stage_background:current.stageBackgroundUrl??''});editing.value=true;
 return true;
 }catch(e){if(alive&&epoch===editorEpoch)fail(e);return false;}
}
async function upload(file:File|undefined,purpose:keyof typeof previews){
 if(!file)return;
 // Each attempt is a new event, even when its error text matches the last one.
 error.value='';message.value='';await nextTick();
 const max=purpose==='activity_logo'?5:10;
 if(file.size>max*1024*1024){uploadStates[purpose]={kind:'failed',message:'图片不能超过 '+max+'MB'};error.value=uploadStates[purpose].message;return;}
 uploads.value++;error.value='';uploadStates[purpose]={kind:'uploading',message:'正在上传 '+file.name+'…'};
 try{
 const ticket=await write<{id:string}>('/api/v1/assets/uploads','POST',{purpose,activityId:selected.value?.id??null});
 const result=await write<{id:string;url:string}>('/api/v1/assets/'+ticket.id+'/content','PUT',file);
 if(purpose==='activity_logo')form.logoAssetId=result.id;else if(purpose==='h5_background')form.h5BackgroundAssetId=result.id;else form.stageBackgroundAssetId=result.id;
 previews[purpose]=result.url;uploadStates[purpose]={kind:'done',message:'已上传：'+file.name};message.value=uploadStates[purpose].message;
 }catch(e){fail(e);uploadStates[purpose]={kind:'failed',message:e instanceof RequestError?e.message:'上传失败：无法连接服务，请稍后重试。'};}finally{uploads.value--;}
}
async function save(){
 if(saving.value||uploads.value||readOnly.value)return;
 if(formActivityId!==(selected.value?.id??null)){error.value='活动已切换，请重新打开活动后保存';return;}
 if(!form.end){basicTab.value='details';error.value='请选择活动结束日期';return;}
 saving.value=true;error.value='';message.value='';
 try{
 const {end,...body}=form;
 const target=selected.value,wasEditing=!!target;
 const saved=await write<Activity>('/api/v1/activities'+(target?'/'+target.id:''),target?'PATCH':'POST',{...body,expiresAt:new Date(end+'T23:59:59.999+08:00').toISOString()},target?{'If-Match':target.version}:{});
 if(wasEditing)selected.value=saved;else editing.value=false;message.value=wasEditing?'活动资料已保存':'活动已创建，当前处于彩排模式';await load();
 }catch(e){fail(e);}finally{saving.value=false;}
}

async function configureStage(activity:Activity,section:'mode'|'checkin'|'roster'|'prizes'){if(await open(activity))tab.value=section;}
async function refreshSelected(){
 const activityId=selected.value?.id,epoch=editorEpoch,sequence=++refreshSequence;
 if(!activityId||!editing.value||personal.value)return;
 const current=()=>alive&&epoch===editorEpoch&&sequence===refreshSequence&&editing.value&&!personal.value&&selected.value?.id===activityId;
 try{const result=await get<Activity>('/api/v1/activities/'+activityId);
 if(current()&&BigInt(result.version)>=BigInt(selected.value!.version))selected.value=result;
 }catch(e){if(current())fail(e);}
}
function resetUploads(){for(const key of Object.keys(uploadStates) as (keyof typeof uploadStates)[])uploadStates[key]={kind:'',message:''};}
// These views share the workspace instance: leaving a view must consume its notices.
watch([tab,basicTab,editing,personal],()=>{error.value='';message.value='';resetUploads();},{flush:'sync'});

onMounted(()=>{void load();timer=setInterval(()=>clock.value=anchor+performance.now()-tick,1000);});
let syncPending=false;
const connectionNotice=ref('');
const unsubscribe=subscribeUpdates(()=>{syncPending=true;},status=>{
 connectionNotice.value=status==='reconnecting'?'实时连接中断，正在重连；恢复后将自动更新。':'';
 if(status==='expired')emit('expired');
});
const syncTimer=setInterval(async()=>{
 if(!syncPending||loading.value||saving.value||uploads.value)return;
 syncPending=false;
 // A failed initial load also needs entitlements and notice state restored.
 if(workspaceLoadFailed){await load();return;}
 try{rows.value=await get<Activity[]>('/api/v1/activities');
 // Preserve unsaved inputs and their original version. Only expiry/mode may update immediately.
 if(selected.value){const current=rows.value.find(a=>a.id===selected.value!.id);if(current){selected.value={...selected.value,phase:current.phase,mode:current.mode,expires_at:current.expires_at};}}
 }catch(e){fail(e);}
},300);
const participantPoll=setInterval(async()=>{if(!document.hidden&&!editing.value&&!loading.value){try{rows.value=await get<Activity[]>('/api/v1/activities');}catch(e){fail(e);}}},30000);
onUnmounted(()=>{alive=false;editorEpoch++;unsubscribe();clearInterval(syncTimer);clearInterval(participantPoll);clearInterval(timer);});
</script>
<template>
<div class="workspace activity-workspace">
 <aside>
 <div class="brand"><span class="brand-mark">✦</span><span>星遇<small>STARLIT</small></span></div>
 <ElMenu class="activity-menu" :default-active="personal?'':editing?tab:'activities'">
 <p class="nav-title">工作空间</p><ElMenuItem index="activities" @click="leaveEditor" :disabled="saving||uploads>0">我的活动</ElMenuItem>
 <template v-if="editing&&!personal"><p class="nav-title">本场活动</p>
 <ElMenuItem index="basic" @click="tab='basic'" :disabled="saving||uploads>0">基本信息</ElMenuItem>
 <ElMenuItem index="checkin" @click="tab='checkin'" :disabled="!selected||saving||uploads>0">签到设置</ElMenuItem>
 <ElMenuItem v-for="item in ([{key:'prizes',label:'奖项设置'},{key:'mode',label:'模式切换'},{key:'roster',label:'签到名单'},{key:'awards',label:'中奖名单'},{key:'audit',label:'操作记录'}] as const)" :key="item.key" :index="item.key" :disabled="!selected||saving||uploads>0" @click="tab=item.key">{{item.label}}</ElMenuItem>
 <p v-if="!selected" class="hint">创建活动后可设置签到页面</p></template></ElMenu>
 <div class="sidebar-note"><ElDropdown trigger="click" placement="top-start" popper-class="account-dropdown" :popper-options="accountPopperOptions" @command="command=>command==='profile'?personal=true:emit('logout')">
 <ElButton class="account-trigger" aria-label="账户菜单"><ElAvatar :size="32" class="account-avatar" aria-label="默认用户头像"><ElIcon :size="19"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.7"/><path d="M5 20v-2a7 7 0 0 1 14 0v2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></ElIcon></ElAvatar><strong class="account-phone" :title="user.account">{{user.account}}</strong><ElIcon class="account-chevron" :size="16"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8 9 4-4 4 4M8 15l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></ElIcon></ElButton>
 <template #dropdown><ElDropdownMenu><ElDropdownItem command="profile" :disabled="saving||uploads>0">个人中心</ElDropdownItem><ElDropdownItem divided command="logout" :disabled="loggingOut||saving||uploads>0">退出登录</ElDropdownItem></ElDropdownMenu></template>
 </ElDropdown></div>
 </aside>
 <main>
  <TopNotice v-if="connectionNotice" :text="connectionNotice" kind="error" />
  <header><span>工作空间 / 我的活动</span></header>
  <div v-if="!editing&&!personal" class="intro"><div class="eyebrow">YOUR MOMENTS</div><h1>你好，{{user.account}}。</h1><p>为每一场活动，准备独一份品牌舞台。</p></div>
  <TopNotice v-if="error" :text="error" kind="error">{{error}} <ElButton v-if="!editing" @click="load" native-type="button">重新加载</ElButton></TopNotice>
  <TopNotice v-if="message" :text="message" kind="success">{{message}}</TopNotice>
  <PersonalCenter v-if="personal" :account="user.account" @expired="emit('expired')" @updated="emit('profileUpdated')" /><template v-else>
   <section v-if="rights&&!editing" class="rights-strip"><div><span class="eyebrow">活动工作台</span><strong>自由创建每一场活动</strong><small>不限制活动数量 · 已累计创建 {{rights.created_activity_count}} 场</small></div><ElButton class="create-button" @click="create" :disabled="!canCreate||loading" native-type="button" type="primary">创建活动</ElButton></section>
   <template v-if="!editing">
    <div class="section-heading"><h2>我的活动 <small>{{rows.length}}</small></h2><div class="activity-list-tools"><ElRadioGroup v-model="activityView" aria-label="活动展示方式"><ElRadioButton value="cards">卡片</ElRadioButton><ElRadioButton value="list">列表</ElRadioButton></ElRadioGroup></div></div>
    <section class="activity-grid" v-if="rows.length&&activityView==='cards'"><article v-for="a in rows" :key="a.id" class="activity-card">
     <div class="activity-cover" :style="{backgroundImage:a.stageBackgroundUrl||a.h5BackgroundUrl?'linear-gradient(180deg,#10152333,#101523ed),url('+ (a.stageBackgroundUrl||a.h5BackgroundUrl) +')':'radial-gradient(ellipse at top left,#65517f,#202c45 65%,#131c2d)'}">
      <div class="cover-heading"><div class="cover-logo"><ElImage v-if="a.logoUrl" :src="a.logoUrl" alt="活动品牌 Logo" fit="cover"/><span v-else aria-label="系统样式">✦</span></div><ElTag class="state-pill" :type="ended(a)?'info':a.phase==='formal'?'success':'warning'">{{ended(a)?'已到期':a.phase==='formal'?'正式活动':'彩排模式'}}</ElTag></div>
      <div class="cover-metrics"><div><span>参与人数</span><strong>{{a.participant_count??0}} <small>人</small></strong></div><div><span>结束日期</span><time :datetime="a.expires_at">{{local(a.expires_at).slice(0,10)}}</time></div></div>
     </div>
     <div class="card-body"><h3>{{a.name}}</h3><p class="card-tagline">{{a.tagline||'每一次期待，都值得被看见'}}</p><div class="card-actions"><ElButton @click="open(a)" native-type="button">{{ended(a)?'查看活动':'编辑活动'}}</ElButton><JoinEntry :activity-id="a.id"  :mode="a.mode"/><StageEntry :activity-id="a.id" @configure="section=>configureStage(a as Activity,section)" @expired="emit('expired')"/></div><p class="entry-note">扫码入口按活动模式提供，接入状态见签到设置</p></div>
    </article></section>
    <ElTable v-else-if="rows.length" class="activity-list-table" :data="rows" row-key="id">
     <ElTableColumn label="活动" min-width="270"><template #default="{row:a}"><div class="list-activity-identity"><div class="cover-logo"><ElImage v-if="a.logoUrl" :src="a.logoUrl" alt="活动品牌 Logo" fit="cover"/><span v-else aria-label="系统样式">✦</span></div><div><strong>{{a.name}}</strong><p>{{a.tagline||'每一次期待，都值得被看见'}}</p></div></div></template></ElTableColumn>
     <ElTableColumn label="状态" width="110"><template #default="{row:a}"><ElTag :type="ended(a as Activity)?'info':a.phase==='formal'?'success':'warning'">{{ended(a as Activity)?'已到期':a.phase==='formal'?'正式活动':'彩排模式'}}</ElTag></template></ElTableColumn>
     <ElTableColumn label="参与人数" width="100"><template #default="{row:a}">{{a.participant_count??0}} 人</template></ElTableColumn>
     <ElTableColumn label="结束日期" width="120"><template #default="{row:a}"><time :datetime="a.expires_at">{{local(a.expires_at).slice(0,10)}}</time></template></ElTableColumn>
     <ElTableColumn label="操作" width="310" fixed="right"><template #default="{row:a}"><div class="list-activity-actions"><ElButton @click="open(a as Activity)" native-type="button">{{ended(a as Activity)?'查看活动':'编辑活动'}}</ElButton><JoinEntry :activity-id="a.id"  :mode="a.mode"/><StageEntry :activity-id="a.id" @configure="section=>configureStage(a as Activity,section)" @expired="emit('expired')"/></div></template></ElTableColumn>
    </ElTable>
    <ElEmpty class="empty-activities" v-else-if="!loading" description="准备迎接你的第一场活动"><p>填写活动名称，设置结束时间，按需上传本场 Logo。</p><ElButton @click="create" :disabled="!canCreate" type="primary">新建活动</ElButton></ElEmpty>
   </template>

   <section v-else-if="tab==='checkin'" class="activity-editor checkin-editor">
    <div class="editor-heading"><div><h2>签到设置</h2><p class="hint">最多 3 个字段，名称最多 8 个字；支持文本、数字与下拉单选，默认选填，可设为必填。</p></div></div>
    <ElAlert v-if="readOnly" class="readonly-note" type="info" :closable="false" show-icon><template #title>活动已到期，签到设置仅供查看。</template></ElAlert>
    <WechatSettings v-if="selected" :activity-id="selected.id" @expired="emit('expired')"/>
    <ActivityConfiguration v-if="selected" :activity-id="selected.id" :revision="selected.version" section="form" :activity-name="form.name" :logo-url="previews.activity_logo" :background-url="previews.h5_background" :background-id="form.h5BackgroundAssetId" :show-background="form.display.h5Background" :organizer="form.organizer" :uploading="uploads>0" @expired="emit('expired')" @changed="refreshSelected"><template #background>
     <fieldset class="settings-group background-group" :disabled="readOnly||saving||uploads>0">
      <p class="hint background-hint">上传竖版图片，右侧实时查看效果。未上传时使用系统背景。</p>
      <div class="upload-tile checkin-upload"><ElUpload class="upload-select" name="h5_background" accept="image/png,image/jpeg,image/webp" :auto-upload="false" :show-file-list="false" :disabled="readOnly||saving||uploads>0" :on-change="file=>upload(file.raw,'h5_background')">
       <span>H5 背景图</span><div class="upload-preview h5_background"><ElImage v-if="previews.h5_background" :src="previews.h5_background" alt="H5 背景" fit="contain" /><span v-else>＋<small>选择图片</small></span></div>
       <span class="file-action">{{previews.h5_background?'更换图片':'选择图片'}}</span>
       
       <small>建议 1080 × 1920px，PNG / JPEG / WebP，最大 10MB</small>
       <small v-if="uploadStates.h5_background.kind==='uploading'" role="status">{{uploadStates.h5_background.message}}</small>
      </ElUpload>
      <ElButton v-if="form.h5BackgroundAssetId" class="text-button" @click="form.h5BackgroundAssetId=null;previews.h5_background='';uploadStates.h5_background={kind:'',message:''}" :disabled="(readOnly||saving||uploads>0)" native-type="button">移除背景，使用系统样式</ElButton></div>
     </fieldset>
    </template></ActivityConfiguration>
   </section>

   <section v-else-if="selected&&(tab==='prizes'||tab==='mode')" class="activity-editor"><ActivityConfiguration :activity-id="selected.id" :revision="selected.version" :section="tab" @expired="emit('expired')" @changed="refreshSelected" /></section>
   <section v-else-if="selected&&tab==='roster'" class="activity-editor"><ParticipantRoster :activity-id="selected.id" :phase="selected.phase" :initial-mode="selected.mode" @expired="emit('expired')" @changed="refreshSelected" /></section>
   <section v-else-if="selected&&tab==='audit'" class="activity-editor"><ActivityAudit :activity-id="selected.id" @expired="emit('expired')" /></section>
   <section v-else-if="selected&&tab==='awards'" class="activity-editor"><DrawWorkspace :activity-id="selected.id" :phase="selected.phase" :initial-mode="selected.mode" :section="tab" @expired="emit('expired')" @changed="refreshSelected" /></section>
   <ElForm v-else class="activity-editor" @submit.prevent="save" @invalid.capture="revealBasicInvalid">
    <div class="editor-heading"><div><h2>{{selected?'基本信息':'新建活动'}}</h2><p class="hint">设置活动资料与品牌视觉，手机签到页和抽奖大屏共用本场信息。</p></div></div>
    <ElAlert v-if="readOnly" class="readonly-note" type="info" :closable="false" show-icon><template #title>活动已到期，资料仅供查看，无法修改、延期或重新开启。</template></ElAlert>
    <fieldset :disabled="readOnly||saving||uploads>0">
     <ElTabs v-model="basicTab" class="basic-tabs"><ElTabPane label="活动资料" name="details"><ElCard class="settings-group" shadow="never" :body-style="{padding:'0'}"><div class="group-heading"><div><h3>活动资料</h3><p class="hint">名称与结束日期为必填，其余信息按需填写。</p></div></div><div class="form-grid tw:grid tw:grid-cols-2 tw:gap-x-6 tw:gap-y-5">
      <label>活动名称 *<ElInput v-model="form.name" name="activityName" maxlength="100" required placeholder="例如：2026 星光年度盛典" :disabled="(readOnly||saving||uploads>0)" aria-label="活动名称 *" /></label>
      <div class="end-date-label">活动结束日期 *<EndDatePicker v-model="form.end" :min="minTime" :max="maxTime" :disabled="readOnly||saving||uploads>0" /><small>所选日期 23:59:59 结束；最晚 {{maxTime}}。</small></div>
      <label class="wide">宣传语<ElInput v-model="form.tagline" maxlength="200" placeholder="让每一份期待，都被看见" :disabled="(readOnly||saving||uploads>0)" aria-label="宣传语" /></label>
      <label>主办方<ElInput v-model="form.organizer" maxlength="100" :disabled="(readOnly||saving||uploads>0)" aria-label="主办方" /></label><label>协办方<ElInput v-model="form.coorganizer" maxlength="100" :disabled="(readOnly||saving||uploads>0)" aria-label="协办方" /></label>

     </div></ElCard></ElTabPane><ElTabPane label="品牌视觉" name="visual">
     <ElCard class="settings-group" shadow="never" :body-style="{padding:'0'}"><div class="group-heading"><div><h3>品牌视觉</h3><p class="hint">图片完整等比显示。支持 PNG / JPEG / WebP，单边不超过 8192px。</p></div></div>
     <div class="upload-grid tw:grid tw:grid-cols-2 tw:gap-5">
      <div v-for="(title,purpose) in {activity_logo:'品牌 Logo',stage_background:'大屏背景'}" :key="purpose" class="upload-tile"><ElUpload class="upload-select" :name="purpose" accept="image/png,image/jpeg,image/webp" :auto-upload="false" :show-file-list="false" :disabled="readOnly||saving||uploads>0" :on-change="file=>upload(file.raw,purpose)">
       <span>{{title}}</span><div class="upload-preview" :class="purpose"><ElImage v-if="previews[purpose]" :src="previews[purpose]" :alt="title" fit="contain" /><span v-else>＋<small>选择图片</small></span></div>
       <span class="file-action">{{previews[purpose]?'更换图片':'选择图片'}}</span>
       <small>{{purpose==='activity_logo'?'推荐 512 × 512px，非上限；最大 5MB':'推荐 1920 × 1080px，非上限；最大 10MB'}}</small><small v-if="uploadStates[purpose].kind==='uploading'" role="status">{{uploadStates[purpose].message}}</small>
      </ElUpload>
      <ElButton v-if="purpose==='activity_logo'&&form.logoAssetId" class="text-button" @click="form.logoAssetId=null;previews.activity_logo='';uploadStates.activity_logo={kind:'',message:'已移除，保存后使用系统样式'}" :disabled="(readOnly||saving||uploads>0)" native-type="button">移除品牌Logo，使用系统样式</ElButton>
      <ElButton v-if="purpose==='stage_background'&&form.stageBackgroundAssetId" class="text-button" @click="form.stageBackgroundAssetId=null;previews.stage_background='';uploadStates.stage_background={kind:'',message:''}" :disabled="(readOnly||saving||uploads>0)" native-type="button">移除大屏背景，使用系统样式</ElButton>
      </div>
     </div>
     </ElCard></ElTabPane><ElTabPane label="展示内容" name="display"><ElCard class="settings-group" shadow="never" :body-style="{padding:'0'}"><div class="group-heading"><div><h3>展示内容</h3><p class="hint">选择在活动页面中显示的信息。</p></div></div><div class="display-toggles"><ElCheckbox v-for="(label,key) in displayLabels" :key="key" v-model="form.display[key]" :disabled="readOnly||saving||uploads>0" border>显示{{label}}</ElCheckbox></div></ElCard>
</ElTabPane></ElTabs>
    </fieldset>
    <div class="editor-actions"><small>{{uploads?'正在校验和上传图片…':readOnly?'活动已到期':'新建活动默认彩排模式，可在模式切换中按需生成模拟参与者。'}}</small><ElButton v-if="!readOnly" class="create-button" :disabled="saving||uploads>0" native-type="submit" type="primary">{{saving?'保存中…':selected?'保存':'创建活动'}}</ElButton></div>
   </ElForm>
  </template>

  <footer>星遇 · 3D 抽奖平台 </footer>
 </main>
</div>
</template>
<style scoped>
.basic-tabs :deep(.el-tabs__item){height:52px;font-size:14px}.basic-tabs :deep(.el-tabs__nav-wrap:after){height:1px;background:#30394e}.basic-tabs :deep(.el-tabs__header){margin-bottom:20px}

.settings-group.background-group{border:0;background:transparent;padding:0;margin:0}.background-hint{margin:0 0 18px}

.activity-workspace main{margin:0 auto;max-width:1450px}.intro{padding:34px 0}.rights-strip{display:flex;justify-content:space-between;align-items:center;padding:26px 30px;background:linear-gradient(110deg,#27223b,#181d2c);border:1px solid #423750;border-radius:13px;margin-bottom:28px}.rights-strip strong{display:block;font-size:22px;font-weight:500;margin:10px 0}.rights-strip small,.hint{font-size:12px;color:#99a2b8;line-height:1.9}.create-button:not(.el-button){background:#c6b0e7;color:#20192c;border:0}.create-button:not(.el-button):hover{background:#dfcbfa}button:not(.el-button):disabled{cursor:not-allowed}.section-heading small{color:#8c86a4;font-size:13px;margin-left:10px}.activity-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin:24px 0}.activity-card{border:1px solid #32354c;background:#151a28;border-radius:13px;overflow:hidden}.activity-cover{height:205px;background-size:cover;background-position:center;padding:20px;display:flex;flex-direction:column;justify-content:space-between}.cover-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.cover-logo{height:62px;width:62px;border:1px solid #ffffff30;border-radius:14px;background:#151a28aa;display:grid;place-items:center;padding:0;overflow:hidden}.cover-logo :deep(.el-image){width:100%;height:100%}.cover-logo>span{color:#e5c892;font-size:36px}.cover-metrics{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}.cover-metrics>div{display:flex;flex-direction:column;gap:8px}.cover-metrics>div:last-child{text-align:right}.cover-metrics span{font-size:11px;color:#c1cadb}.cover-metrics strong{font-size:26px;font-weight:500;color:#fff;line-height:1}.cover-metrics small{font-size:12px;color:#c1cadb}.cover-metrics time{font-size:14px;color:#f1e7d6;font-variant-numeric:tabular-nums}.state-pill{float:right;background:#27213de6;color:#d6c5f4;border:1px solid #73658b;padding:5px 10px;border-radius:20px;font-size:10px}.state-pill.ended{background:#242731;color:#a1a6b6;border-color:#555a69}.card-body{padding:18px 20px 20px}.card-body h3{margin-top:0}.card-body .card-tagline{min-height:36px;line-height:18px;margin-bottom:18px}.card-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.card-actions :deep(.el-button){width:100%;height:38px;margin:0;padding:0 8px;font-size:12px;text-decoration:none}.card-actions :deep(.el-button+.el-button){margin-left:0}.card-body h3{font-size:18px;overflow-wrap:anywhere;margin-bottom:8px}.card-body p{font-size:11px;color:#9ba3bb;min-height:18px;overflow-wrap:anywhere}.end-label{font-size:10px;color:#767f97;margin:24px 0 7px}.card-body time{font-size:12px;color:#b9c1d4}.card-body button:not(.el-button){width:100%;text-align:left;margin-top:22px}.card-body button:not(.el-button) span{float:right}.activity-editor{background:#161b2b;border:1px solid #32384e;border-radius:14px;padding:30px;margin-bottom:24px}.editor-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:25px}.activity-editor h3{margin-top:30px;font-size:14px;color:#c5b1e3}.wide{grid-column:1/-1}label{font-size:12px;color:#bdc7da}input:not([type=checkbox]),textarea{display:block;width:100%;border:1px solid #394159;background:#101625;color:#e8eaf6;border-radius:7px;padding:12px;margin:9px 0;font:inherit;color-scheme:dark}input:focus,textarea:focus{outline:1px solid #b59acf}label>small{font-size:10px;color:#909ab1;line-height:1.7}fieldset:disabled{opacity:.8}.upload-tile{border:1px dashed #55506a;padding:15px;border-radius:9px;min-width:0}.upload-preview{height:145px;display:grid;place-items:center;margin:12px 0;background:#101421;border-radius:6px;overflow:hidden}.upload-preview img{display:block;min-height:0;min-width:0;height:145px;max-height:100%;width:100%;object-fit:contain}.upload-grid .upload-preview{height:220px}.upload-grid .upload-preview img{height:220px;max-height:100%}.upload-preview>span{font-size:30px;color:#bdacd3;text-align:center}.upload-preview small{display:block;font-size:11px;margin-top:7px}.upload-tile input{font-size:10px;padding:6px;max-width:100%}.display-toggles{display:flex;gap:18px;flex-wrap:wrap}.display-toggles input{accent-color:#b7a0da}.editor-actions{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #33394b;padding-top:25px;margin-top:30px;gap:15px}.editor-actions small{font-size:11px;color:#a0abc1}.readonly-note{background:#282a35;padding:15px;color:#bfc4d3;font-size:12px;line-height:1.8}.text-button:not(.el-button){background:none;border:0;color:#bda7d6;font-size:11px}footer a{float:right}@media(max-width:1400px){.activity-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.activity-workspace main{padding-left:28px;padding-right:28px}.upload-grid{gap:10px}.upload-tile{padding:10px}.rights-strip strong{font-size:18px}}
.activity-workspace aside{position:sticky;top:0;height:100vh;align-self:flex-start;overflow-y:auto;z-index:3}.nav-item{width:100%;text-align:left;border:0;background:transparent}.nav-item.active{background:#26283e}.upload-tile{display:block;position:relative;cursor:pointer}.upload-tile:focus-within{outline:2px solid #c6b0e7;outline-offset:3px}.upload-tile .file-input{position:absolute;width:1px;height:1px;padding:0;margin:0;opacity:0;overflow:hidden}.file-action{display:block;padding:10px;margin-bottom:10px;background:#2b3046;border-radius:6px;text-align:center;font-size:12px}.upload-feedback{display:block;white-space:normal;overflow-wrap:anywhere;line-height:1.8;font-size:12px;margin-top:10px}.upload-feedback.done{color:#a2d8b9}.upload-feedback.failed{color:#ffb1b1}.upload-feedback.uploading{color:#ddc9fc}.checkin-upload{width:min(100%,270px);margin:22px 0}.checkin-upload .upload-preview{height:auto;aspect-ratio:9/16;position:relative}.checkin-upload .upload-preview img{position:absolute;inset:0;height:100%;width:100%;object-fit:contain}.upload-select{display:block;cursor:pointer}.upload-tile>.text-button:not(.el-button){display:block;margin-top:12px;line-height:1.7;text-align:left}.activity-editor{margin-top:24px}.checkin-editor .display-toggles{align-items:center}
.end-date-label{font-size:13px;color:#bdc7da}.end-date-label small{color:#909ab1;font-size:10px;line-height:1.7}

/* Activity settings share one page rhythm and clear groups. */
.activity-editor{padding:28px;background:transparent;border:0;border-radius:0}.editor-heading{margin:0 0 26px;padding-bottom:22px;border-bottom:1px solid #2c3448}.editor-heading h2{font-size:24px;margin:0 0 8px;font-weight:600;letter-spacing:.3px}.editor-heading .hint{margin:0;font-size:13px}.settings-group{padding:24px;border:1px solid #30394e;border-radius:14px;background:#181f30;margin:0 0 20px;min-width:0}.group-heading{display:flex;align-items:flex-start;gap:12px;margin-bottom:22px}.step-number{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;background:#302b46;color:#d5bdf3;font-size:12px;flex-shrink:0}.activity-editor .group-heading h3{margin:2px 0 6px;color:#e3e7f4;font-size:16px}.group-heading p{margin:0}.form-grid label{font-size:13px}.upload-grid .upload-tile{background:#111827;border-style:solid;border-color:#303b53;padding:16px}.upload-grid .upload-preview{height:180px;background:#0c1220}.upload-grid .upload-preview img{height:180px}.display-toggles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.display-toggles label{display:flex;align-items:center;gap:8px;padding:12px;border:1px solid #34405a;border-radius:9px;background:#121a2a}.editor-actions{position:sticky;bottom:0;z-index:4;background:#192133f5;backdrop-filter:blur(12px);padding:16px 20px;border:1px solid #3b415a;border-radius:12px;margin-top:24px}.editor-actions .create-button:not(.el-button){padding:12px 26px;font-weight:600}.background-group{margin:0;padding:20px}.checkin-upload{width:190px;max-width:100%;margin:0;background:#111827}.checkin-upload .upload-preview{margin:10px 0}.checkin-upload .file-action{padding:8px}.upload-feedback:empty{display:none}@media(max-width:1200px){.activity-editor{padding:22px}.settings-group{padding:18px}.display-toggles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.activity-workspace aside{display:flex;flex-direction:column}.activity-workspace aside>*{flex-shrink:0}.sidebar-note{position:static;margin-top:auto;padding-top:24px;width:100%}.theme-choice{display:flex;align-items:center;gap:14px;padding:24px;border:1px solid #b99cd7;border-radius:12px;background:radial-gradient(ellipse at right,#453560,#192236);font-size:18px}.theme-choice input{width:auto}.theme-choice span{font-size:12px;color:#d0b8ed;margin-left:auto}.sidebar-note{position:relative}.account-trigger{width:100%;display:flex;justify-content:space-between;align-items:center;background:transparent;border:1px solid #343a51;font-size:12px}.account-menu{position:absolute;bottom:calc(100% - 16px);left:0;right:0;padding:8px;background:#20263b;border:1px solid #454a65;border-radius:12px;box-shadow:0 12px 35px #0006;z-index:10}.account-menu .nav-item{margin:0}.system-logo{display:grid;place-items:center;width:64px;height:64px;color:#dbc391;font-size:48px;margin:auto}.participation{display:flex;justify-content:space-between;align-items:center;margin:18px 0;color:#a9b4cd;font-size:12px}.participation strong{font-size:24px;font-weight:500;color:#e8ddff}.participation small{font-size:12px}.card-entries{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.card-entries a{display:grid;place-items:center;text-decoration:none;color:#e3d4fc;border:1px solid #554765;border-radius:8px;background:#342842;font-size:12px;padding:10px 4px}.card-entries button:not(.el-button){font-size:12px;padding:10px 4px}.card-body .entry-note{font-size:11px;color:#909bb4;margin:10px 0 0}
.form-grid :deep(.el-input){margin:9px 0}.form-grid :deep(.date-picker .el-input){margin:0}.form-grid :deep(.el-input__wrapper){min-height:42px}.activity-editor :deep(.el-button){height:auto;min-height:38px}.activity-editor :deep(.el-button+.el-button){margin-left:0}.activity-editor :deep(.el-button.text-button){white-space:normal;text-align:left;line-height:1.7;background:transparent;border:0;color:var(--el-color-primary);padding:6px 0}.display-toggles :deep(.el-checkbox){margin:0;height:44px;gap:0}.card-body>.el-button{width:100%;margin-top:22px;justify-content:space-between}.card-body>.el-button :deep(span){width:100%}

.activity-menu{border:0;background:transparent;--el-menu-bg-color:transparent;--el-menu-hover-bg-color:#26283e}.activity-menu :deep(.el-menu-item){height:48px;margin-bottom:10px;border-radius:9px;font-size:13px;padding:0 12px}.activity-menu :deep(.el-menu-item.is-active){background:#26283e}.sidebar-note :deep(.el-dropdown){width:100%}.sidebar-note .account-trigger{width:100%;height:40px}.upload-select :deep(.el-upload){display:block;width:100%;white-space:normal}.upload-preview :deep(.el-image){width:100%;height:100%;display:block}.checkin-upload .upload-preview :deep(.el-image){position:absolute;inset:0}.upload-preview :deep(.el-image__inner){width:100%;height:100%;object-fit:contain}.upload-tile .el-button{font-size:12px}
.upload-select small{display:block;font-size:11px;color:#9daac2;line-height:1.8}.sidebar-note .account-trigger :deep(>span){display:flex;align-items:center;justify-content:space-between;width:100%}

.sidebar-note :deep(.el-dropdown){width:100%}.sidebar-note .account-trigger{height:56px;width:100%;padding:10px;border:1px solid #343e53;border-radius:12px;background:#1a2233}.account-trigger :deep(>span){display:flex;align-items:center;gap:10px;width:100%}.account-avatar{flex-shrink:0;background:#393047;color:#e2c795;font-size:12px}.account-details{display:flex;flex-direction:column;align-items:flex-start;gap:5px;min-width:0}.account-details strong{font-size:12px;font-weight:500}.account-details small{font-size:10px;color:#99a6bf}.account-chevron{margin-left:auto;color:#b9a780}

.account-phone{font-size:12px;font-weight:500;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}.intro h1{overflow-wrap:anywhere}.account-trigger .account-chevron{flex-shrink:0}.account-trigger :deep(>span){gap:8px;min-width:0;width:100%}
:global(.account-dropdown){box-sizing:border-box;border-radius:12px!important}:global(.account-dropdown .el-dropdown-menu){padding:6px}:global(.account-dropdown .el-dropdown-menu__item){min-height:40px;border-radius:7px;padding:0 12px}

.activity-list-tools{display:flex;align-items:center;gap:14px}.activity-list-table{margin:24px 0;border:1px solid #323b50;border-radius:12px;--el-table-bg-color:#151a28;--el-table-tr-bg-color:#151a28;--el-table-header-bg-color:#1d2638;--el-table-border-color:#30394e;--el-table-row-hover-bg-color:#222d43}.activity-list-table :deep(.el-table__cell){padding:18px 0}.list-activity-identity{display:flex;align-items:center;gap:14px}.list-activity-identity .cover-logo{width:48px;height:48px;flex-shrink:0;border-radius:10px}.list-activity-identity strong{font-size:14px;font-weight:500;overflow-wrap:anywhere}.list-activity-identity p{font-size:11px;color:#99a6bc;line-height:1.6;margin:5px 0 0}.list-activity-actions{display:flex;gap:8px}.list-activity-actions :deep(.el-button){margin:0;height:34px;padding:0 10px;font-size:12px;text-decoration:none}

/* Activity pages share the workspace content edges; headings use spacing only. */
.activity-workspace main>.activity-editor{padding:24px 0 0;border:0;background:transparent}

.activity-workspace .activity-editor :deep(.editor-heading),.activity-workspace .activity-editor :deep(.page-heading),.activity-workspace .activity-editor :deep(.draw-page>.heading){border-bottom:0;padding-bottom:0;margin-bottom:24px}
.activity-workspace .activity-editor :deep(.el-tabs__nav-wrap:after){display:none}
</style>
