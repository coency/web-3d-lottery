<script setup lang="ts">
import 'element-plus/es/components/tabs/style/css';
import {ElTabs,ElTabPane,ElAlert} from 'element-plus';
import 'element-plus/es/components/alert/style/css';
import {ElAvatar,ElTag,ElEmpty} from 'element-plus';
import 'element-plus/es/components/avatar/style/css';
import 'element-plus/es/components/tag/style/css';
import 'element-plus/es/components/empty/style/css';
import {ElForm} from 'element-plus';
import 'element-plus/es/components/form/style/css';
import {ElTable,ElTableColumn} from 'element-plus';
import 'element-plus/es/components/table/style/css';
import {ElPagination,ElButton,ElInput,ElSelect,ElOption} from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/select/style/css';
import 'element-plus/es/components/pagination/style/css';
import {subscribeUpdates} from './realtime';
import TopNotice from './TopNotice.vue';
import {ref,watch,onUnmounted} from 'vue';
import {get,write,download,RequestError} from './api';
type Person={id:string;avatarUrl:string|null;nickname:string;createdAt:string;eligible:boolean;fields:{id:string;name:string;value:string}[]};
type Roster={phase:string;generation:number;total:number;stats:{total:number;eligible:number};items:Person[]};
type Job={id:string;status:string;filename?:string};
type Details=Person&{version:string;generation:number;lockedReason:string;exclusionKind:string|null;reserved:number};
const props=defineProps<{activityId:string;initialMode:'formal'|'rehearsal';phase:string}>();
const emit=defineEmits<{expired:[];changed:[]}>();
const mode=ref<string>(props.initialMode),search=ref(''),appliedSearch=ref(''),eligibility=ref('all'),page=ref(1),data=ref<Roster|null>(null),error=ref(''),notice=ref(''),loading=ref(false),exporting=ref(false),action=ref<Details|null>(null),reason=ref(''),saving=ref(false),opening=ref('');
let sequence=0,alive=true,exportSequence=0;
const base=()=>'/api/v1/activities/'+props.activityId;
const time=(v:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date(v));
function fail(e:unknown){if(e instanceof RequestError&&e.status===401)emit('expired');return e instanceof Error?e.message:'暂时无法连接，请重试';}
async function load(silent=false){
 const seq=++sequence;if(!silent){loading.value=true;error.value='';}
 try{const result=await get<Roster>(base()+'/participants?'+new URLSearchParams({mode:mode.value,page:String(page.value),search:appliedSearch.value,eligibility:eligibility.value}));
 if(!alive||seq!==sequence)return;data.value=result;
 }catch(e){if(alive&&seq===sequence)error.value=fail(e);}finally{if(seq===sequence)loading.value=false;}
}
function filter(){appliedSearch.value=search.value.trim();page.value=1;void load();}
function switchMode(value:string){if(value===mode.value)return;mode.value=value;page.value=1;search.value='';appliedSearch.value='';eligibility.value='all';data.value=null;notice.value='';action.value=null;void load();}
async function changeEligibility(person:Person){
 if(opening.value)return;opening.value=person.id;error.value='';
 const target=base(),selectedMode=mode.value;
 try{
 const result=await get<Details>(target+'/participants/'+person.id+'?mode='+selectedMode);
 if(!alive||target!==base()||selectedMode!==mode.value)return;
 if(result.lockedReason)throw new Error(result.lockedReason);
 if(!result.eligible&&result.exclusionKind==='absent')throw new Error('因不在场作废的人员不能恢复本场抽奖资格');
 action.value=result;reason.value=result.eligible?'管理员在签到名单直接排除':'管理员在签到名单直接恢复';await confirm();
 }catch(e){error.value=fail(e);}finally{opening.value='';}
}
async function confirm(){
 if(!action.value||saving.value)return;saving.value=true;
 try{
 await write(base()+'/participants/'+action.value.id+'/eligibility','POST',{mode:mode.value,generation:action.value.generation,reason:reason.value,eligible:!action.value.eligible},{'If-Match':action.value.version});
 notice.value=action.value.eligible?'已排除该人员的抽奖资格。':'已恢复该人员的抽奖资格。';action.value=null;emit('changed');await load();
 }catch(e){error.value=fail(e);action.value=null;}finally{saving.value=false;}
}
async function exportAll(){
 if(!data.value||exporting.value)return;exporting.value=true;error.value='';notice.value='正在生成名单，完成后将自动下载…';
 const target=base(),token=++exportSequence;
 try{
 let job=await write<Job>(target+'/exports','POST',{mode:mode.value,generation:data.value.generation});
 const deadline=Date.now()+180000;
 while(alive&&token===exportSequence){
 job=await get<Job>(target+'/exports/'+job.id);
 if(!alive||token!==exportSequence)return;
 if(job.status==='ready'){await download(target+'/exports/'+job.id+'/download',job.filename||'签到名单.xlsx');if(alive&&token===exportSequence)notice.value='名单已生成，已发起下载。';return;}
 if(job.status==='failed'||job.status==='expired')throw new Error('名单生成失败或已过期，请重新导出。');
 if(Date.now()>deadline)throw new Error('名单生成时间较长，请稍后重新导出。');
 await new Promise(resolve=>setTimeout(resolve,1000));
 }
 }catch(e){if(alive&&token===exportSequence){notice.value='';error.value=fail(e);}}finally{if(token===exportSequence)exporting.value=false;}
}
watch(()=>props.activityId,()=>{exportSequence++;exporting.value=false;action.value=null;mode.value=props.initialMode;page.value=1;data.value=null;void load();},{immediate:true});
let syncPending=false;
const unsubscribe=subscribeUpdates(change=>{if(change.all||change.ids.includes(props.activityId))syncPending=true;});
const syncTimer=setInterval(()=>{if(syncPending&&!loading.value&&!saving.value&&!opening.value&&!exporting.value){syncPending=false;void load(true);}},300);
const poll=setInterval(()=>{if(!document.hidden&&!loading.value&&!saving.value&&!opening.value&&!exporting.value)void load(true);},30000);
onUnmounted(()=>{unsubscribe();clearInterval(syncTimer);clearInterval(poll);alive=false;sequence++;exportSequence++;});
</script>
<template>
<section class="roster">
<div class="page-heading"><h2>签到名单</h2><p>查看签到人员与填写资料，管理抽奖资格。彩排、正式名单分别保存，实时同步更新。</p></div>
<TopNotice v-if="error" :text="error" kind="error"></TopNotice><TopNotice v-if="notice" :text="notice" kind="success"></TopNotice>
<div class="list-tabs-row"><ElTabs :model-value="mode" class="list-mode-tabs" @update:model-value="value=>switchMode(String(value))"><ElTabPane label="彩排名单" name="rehearsal" :disabled="exporting||saving||!!opening"/><ElTabPane label="正式名单" name="formal" :disabled="exporting||saving||!!opening"/></ElTabs></div>
<ElAlert v-if="data?.phase==='expired'" class="notice" type="info" :closable="false" show-icon><template #title>活动已到期，仍可查看和导出名单。</template></ElAlert>
<div class="summary"><div><small>已签到</small><strong>{{data?.stats.total??'—'}}</strong></div><div><small>未被排除</small><strong>{{data?.stats.eligible??'—'}}</strong></div><div><small>已排除</small><strong>{{data?data.stats.total-data.stats.eligible:'—'}}</strong></div><p>“未被排除”不代表每个奖项都有中奖资格，抽取时仍需检查中奖次数与指定预留。</p></div>
<section class="list-panel">
<ElForm class="filters tw:flex tw:flex-wrap tw:items-end tw:gap-3" @submit.prevent="filter"><label>查找人员<ElInput v-model="search" maxlength="100" placeholder="输入昵称或人员编号" aria-label="查找人员" /></label><label>资格状态<ElSelect v-model="eligibility" @change="filter" aria-label="资格状态"><ElOption value="all" :label="'全部'" /><ElOption value="eligible" :label="'未被排除'" /><ElOption value="excluded" :label="'已排除'" /></ElSelect></label><ElButton :disabled="loading" native-type="submit">搜索</ElButton><ElButton class="primary export-button" @click="exportAll" :disabled="loading||exporting||!data" native-type="button" type="primary">{{exporting?'正在导出…':'导出名单'}}</ElButton></ElForm>
<p class="hint">Excel 包含当前模式的全部人员，不受搜索和筛选影响。</p>
<div class="table-wrap" :aria-busy="loading"><ElTable :data="data?.items??[]" row-key="id" style="width:100%" empty-text="暂无记录"><ElTableColumn label="微信头像 / 昵称" min-width="260"><template #default="{row:person}"><div class="identity"><ElAvatar class="avatar" :size="44" shape="square" :src="person.avatarUrl||''" :alt="person.nickname+'的头像'" @error="()=>true">{{person.nickname.slice(0,1)}}</ElAvatar><div><strong>{{person.nickname}}</strong><small class="identifier">{{person.id}}</small></div></div></template></ElTableColumn><ElTableColumn label="签到时间" min-width="170"><template #default="{row:person}">{{time(person.createdAt)}}</template></ElTableColumn><ElTableColumn label="资格状态" min-width="110"><template #default="{row:person}"><ElTag :type="person.eligible?'success':'danger'" size="small">{{person.eligible?'未被排除':'已排除'}}</ElTag></template></ElTableColumn><ElTableColumn label="填写资料" min-width="200"><template #default="{row:person}"><span v-if="!person.fields.length" class="hint">无自定义字段</span><span v-for="field in person.fields" :key="field.id" class="answer">{{field.name}}：{{field.value||'未填写'}}</span></template></ElTableColumn><ElTableColumn label="操作" min-width="130"><template #default="{row:person}"><ElButton :disabled="!!opening||data?.phase==='expired'" @click="changeEligibility(person as Person)" native-type="button">{{opening===person.id?'读取中…':person.eligible?'排除抽奖':'恢复抽奖'}}</ElButton></template></ElTableColumn><template #empty><ElEmpty :description="data?.stats.total?'没有匹配的人员':'暂无'+(mode==='formal'?'正式':'彩排')+'签到人员'" :image-size="72" /></template></ElTable></div>

<p v-if="loading" role="status">正在读取名单…</p>
<div class="pagination tw:flex tw:items-center tw:justify-between"><small>共 {{data?.total??0}} 人 · 每页 25 人</small><ElPagination v-model:current-page="page" :total="data?.total??0" :page-size="25" :disabled="loading" layout="prev, pager, next" background @current-change="load()" /></div>
</section>

</section>
</template>
<style scoped>
.list-tabs-row{display:flex;align-items:center;gap:24px;margin-bottom:20px}.list-mode-tabs{flex:1;min-width:0}.list-mode-tabs :deep(.el-tabs__header){margin:0}.list-mode-tabs :deep(.el-tabs__item){height:52px;font-size:14px}.list-mode-tabs :deep(.el-tabs__nav-wrap:after){height:1px;background:#30394e}

.roster{color:#e4e8f5}.page-heading{border-bottom:1px solid #2c3448;margin-bottom:24px;padding-bottom:22px}.page-heading h2{font-size:24px;margin:0 0 8px}.roster p,.hint{font-size:12px;color:#a1aecb;line-height:1.8}button:not(.el-button),input,select{font:inherit;border:1px solid #3c465e;border-radius:8px;color:#e4e8f5;background:#1c2438;padding:10px 14px}button:not(.el-button){font-size:12px;cursor:pointer}button:not(.el-button):disabled{opacity:.45;cursor:default}button:not(.el-button):focus-visible{outline:2px solid #cbb1ed;outline-offset:2px}.roster-toolbar,.section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.segmented{display:flex;padding:4px;border-radius:11px;background:#141b2b;border:1px solid #30394e}.segmented button:not(.el-button){border:0;background:transparent;min-width:110px}.segmented button:not(.el-button).active{background:#3a2e50;color:#e1c7ff}.summary{display:grid;grid-template-columns:repeat(3,130px) 1fr;gap:20px;border:1px solid #30394e;border-radius:14px;background:#181f30;padding:22px;margin:20px 0}.summary small{display:block;color:#a1aecb;font-size:12px}.summary strong{display:block;font-size:28px;margin-top:8px;font-weight:500}.summary p{margin:auto 0}.list-panel,.exports-panel{background:#181f30;border:1px solid #30394e;border-radius:14px;padding:22px;margin-bottom:22px;min-width:0}.filters label{display:grid;gap:8px;font-size:12px}.filters label:first-child{flex:1;min-width:200px}.filters input{width:100%;box-sizing:border-box}.primary:not(.el-button){background:#cbb1ed;color:#241b35;border-color:#cbb1ed;font-weight:600}.table-wrap{overflow:auto;margin-top:20px}table{border-collapse:collapse;min-width:760px;width:100%;font-size:12px;text-align:left}th{background:#111929;color:#a7b3ce;font-weight:400;white-space:nowrap}th,td{padding:16px 12px;border-bottom:1px solid #30394e;vertical-align:top}td strong{font-size:13px;font-weight:500;overflow-wrap:anywhere}.identifier{display:block;color:#8795b2;font-size:10px;margin-top:6px}.answer{display:block;overflow-wrap:anywhere;max-width:230px;line-height:1.8}.status-badge{display:inline-block;background:#203a35;color:#9dd3bd;padding:4px 8px;border-radius:6px;white-space:nowrap}.status-badge.excluded{background:#3c2b34;color:#d9acb7}.empty{text-align:center;padding:36px 16px}.empty h3{font-size:16px;font-weight:500}.pagination{display:flex;align-items:center;gap:14px;margin-top:20px;font-size:12px}.pagination small{margin-right:auto;color:#a1aecb}.section-heading h3{font-size:16px;margin:0}.export-row{display:flex;align-items:center;gap:24px;border-top:1px solid #30394e;padding:18px 0;font-size:12px}.export-row>div{flex:1}.export-row small{display:block;color:#a1aecb;margin-top:8px}.notice{background:#20352f;border-radius:8px;padding:12px;color:#bbe5d3!important}.error{color:#ffb1be!important}.modal-backdrop{position:fixed;inset:0;z-index:40;background:#080d1dc9;display:grid;place-items:center;padding:24px}.detail-dialog{width:min(600px,90vw);max-height:85vh;overflow:auto;background:#181f30;border:1px solid #46506a;border-radius:16px;padding:24px}.detail-dialog dl{display:grid;grid-template-columns:130px 1fr;gap:16px;font-size:13px}.detail-dialog dt{color:#a1aecb}.detail-dialog dd{margin:0;overflow-wrap:anywhere}@media(max-width:1200px){.summary{grid-template-columns:repeat(3,1fr)}.summary p{grid-column:1/-1}}
.identity{display:flex;gap:12px;align-items:center}.avatar{width:44px;height:44px;object-fit:cover;border-radius:12px;flex-shrink:0}.placeholder{display:grid;place-items:center;background:#42375b;color:#e7d5ff;font-size:20px}.detail-dialog label{display:grid;gap:10px;font-size:13px}.detail-dialog textarea{width:100%;box-sizing:border-box;border:1px solid #46506a;border-radius:8px;background:#111929;color:#e4e8f5;padding:12px;font:inherit}.dialog-actions{display:flex;justify-content:flex-end;gap:12px;margin-top:20px}
:deep(.el-input__wrapper),:deep(.el-select__wrapper){min-height:40px}:deep(.el-button){height:auto;min-height:38px;margin:0}:deep(.el-button+.el-button){margin-left:0}:deep(.el-button.active){background:var(--el-color-primary);border-color:var(--el-color-primary);color:#211d25}.filters :deep(.el-select){width:160px}.wechat-settings :deep(.el-input),.wechat-settings :deep(.el-select){margin-top:8px}.code :deep(.el-input){flex:1;min-width:0}.code :deep(.el-button){flex-shrink:0}.segmented,.toolbar>div{display:flex;gap:8px}.record-heading>.el-button:first-of-type{margin-left:auto}

:deep(.el-table){--el-table-bg-color:transparent;--el-table-tr-bg-color:transparent;--el-table-header-bg-color:#151e30;--el-table-border-color:#30394e;--el-table-row-hover-bg-color:#222d43;font-size:12px}:deep(.el-table .cell){line-height:1.8;overflow-wrap:anywhere}:deep(.el-table small){display:block;color:#9daac2;font-size:11px}:deep(.el-table td.el-table__cell){padding:14px 0}:deep(.el-table p){margin:0 0 6px}
</style>
