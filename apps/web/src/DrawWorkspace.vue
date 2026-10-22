<script setup lang="ts">
import 'element-plus/es/components/tabs/style/css';
import {ElTabs,ElTabPane,ElEmpty} from 'element-plus';
import 'element-plus/es/components/empty/style/css';
import {ElTable,ElTableColumn} from 'element-plus';
import 'element-plus/es/components/table/style/css';
import 'element-plus/es/components/dialog/style/css';
import {ElDialog,ElPagination,ElButton} from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/pagination/style/css';
import {subscribeUpdates} from './realtime';
import TopNotice from './TopNotice.vue';
import {ref,computed,watch,onMounted,onUnmounted} from 'vue';
import {get,write,download,RequestError} from './api';
type Award={id:string;participant_id:string;round_id:string;status:string;reason:string|null;replaces_award_id:string|null;replaced_nickname?:string|null;created_at:string;display_snapshot:{nickname?:string;title?:string;avatarUrl?:string;prizeName?:string;method?:string;auxiliary?:string[]}};
type State={generation:number;version:string;phase:string;activeRootId:string|null;signedIn:number;prizes:{id:string;name:string;mode:string;total:number;batch:number;awarded:number}[];rounds:{id:string;prize_id:string;status:string;draw_count:number}[];awards:Award[];vacancies:Award[]};
const props=defineProps<{activityId:string;initialMode:'formal'|'rehearsal';phase:string;section:'awards'}>();
const emit=defineEmits<{expired:[];changed:[]}>();
const mode=ref<string>(props.initialMode),data=ref<State|null>(null),records=ref<{items:Award[];total:number}>({items:[],total:0}),page=ref(1),error=ref(''),notice=ref(''),busy=ref(false),exporting=ref(false);
const resetConfig=ref<{version:string;generation:number}|null>(null);
const base=()=>'/api/v1/activities/'+props.activityId;
let alive=true,seq=0,timer:ReturnType<typeof setInterval>;
const drawing=computed(()=>data.value?.rounds.find(r=>r.status==='drawing'));
const time=(v:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date(v));
function fail(e:unknown){if(e instanceof RequestError){if(e.status===401)emit('expired');}error.value=e instanceof Error?e.message:'暂时无法连接，请刷新重试';}
async function load(){
 const token=++seq,target=base(),m=mode.value;
 try{
 const state=await get<State>(target+'/draw?mode='+m);
 if(!alive||token!==seq)return;
 data.value=state;
 if(props.section==='awards'){const list=await get<{items:Award[];total:number}>(target+'/awards?mode='+m+'&page='+page.value);if(alive&&token===seq)records.value=list;}
 }catch(e){if(alive&&token===seq)fail(e);}
}
async function requestReset(){
 if(busy.value||mode.value!=='rehearsal'||props.phase!=='rehearsal')return;
 busy.value=true;error.value='';
 try{const config=await get<{version:string;phase:string;runs:{mode:string;generation:number;drawing:boolean}[]}>(base()+'/configuration');
 if(config.phase!=='rehearsal'||config.runs.some(r=>r.drawing))throw new Error('当前正在抽奖或已不在彩排模式，暂不能清空。请先完成抽取。');
 resetConfig.value={version:config.version,generation:config.runs.find(r=>r.mode==='rehearsal')!.generation};
 }catch(e){fail(e);}finally{busy.value=false;}
}
async function resetDraw(){
 if(busy.value||!resetConfig.value)return;busy.value=true;error.value='';notice.value='';
 try{await write(base()+'/mode/reset-draw','POST',{confirmation:'reset-draw',generation:resetConfig.value.generation},{'If-Match':resetConfig.value.version});
 resetConfig.value=null;page.value=1;await load();emit('changed');notice.value='彩排抽奖已清空，签到名单和奖项设置已保留，可重新试抽。';
 }catch(e){resetConfig.value=null;fail(e);}finally{busy.value=false;}
}
async function exportRecords(){if(exporting.value)return;exporting.value=true;error.value='';try{await download(base()+'/awards/download?mode='+mode.value,(mode.value==='formal'?'正式':'彩排')+'中奖名单.xlsx');}catch(e){fail(e);}finally{exporting.value=false;}}
function switchMode(m:string){if(busy.value||m===mode.value)return;mode.value=m;data.value=null;records.value={items:[],total:0};page.value=1;notice.value='';error.value='';void load();}
watch(()=>[props.activityId,props.section],()=>{data.value=null;page.value=1;notice.value='';error.value='';void load();},{immediate:true});
let syncPending=false;const unsubscribe=subscribeUpdates(change=>{if(change.all||change.ids.includes(props.activityId))syncPending=true;});
const syncTimer=setInterval(()=>{if(syncPending&&!busy.value){syncPending=false;void load();}},300);
onMounted(()=>{timer=setInterval(()=>{if(!busy.value)void load();},30000);});
onUnmounted(()=>{unsubscribe();clearInterval(syncTimer);alive=false;seq++;clearInterval(timer);});
</script>
<template>
<section class="draw-page">
<div class="heading"><h2>中奖名单</h2><p>彩排、正式记录独立保存，作废与补抽保留完整关联。</p></div>
<div class="list-tabs-row"><ElTabs :model-value="mode" class="list-mode-tabs" @update:model-value="value=>switchMode(String(value))"><ElTabPane label="彩排名单" name="rehearsal" :disabled="busy||exporting||!!resetConfig"/><ElTabPane label="正式名单" name="formal" :disabled="busy||exporting||!!resetConfig"/></ElTabs></div>
<TopNotice v-if="error" :text="error" kind="error"></TopNotice><TopNotice v-if="notice" :text="notice" kind="success"></TopNotice>
<p v-if="data&&data.phase!==mode" class="hint">{{data.phase==='expired'?'活动已到期，仅可查看与导出记录。':'非当前活动模式，仅可查看。'}}</p>
<div class="record-heading"><span>共 {{records.total}} 条记录</span><ElButton v-if="mode==='rehearsal'&&phase==='rehearsal'" :disabled="busy||!!drawing" @click="requestReset" native-type="button">清空抽奖</ElButton><ElButton @click="exportRecords" :disabled="exporting" native-type="button">{{exporting?'正在导出…':'导出名单'}}</ElButton></div><div class="table-wrap"><ElTable :data="records.items??[]" row-key="id" style="width:100%" empty-text="暂无记录"><ElTableColumn label="中奖者" min-width="220"><template #default="{row:a}">{{a.display_snapshot.nickname||'历史记录'}}<small>{{a.participant_id}}</small></template></ElTableColumn><ElTableColumn label="奖项" min-width="130"><template #default="{row:a}">{{a.display_snapshot.prizeName}}</template></ElTableColumn><ElTableColumn label="颁发方式" min-width="110"><template #default="{row:a}">{{a.display_snapshot.method==='designated'?'指定颁发':'随机抽奖'}}</template></ElTableColumn><ElTableColumn label="状态" min-width="140"><template #default="{row:a}">{{a.status==='valid'?'有效':'作废 · 不在场'}}</template></ElTableColumn><ElTableColumn label="抽取时间" min-width="170"><template #default="{row:a}">{{time(a.created_at)}}</template></ElTableColumn><ElTableColumn label="补抽说明" min-width="200"><template #default="{row:a}">{{a.replaces_award_id?(a.replaced_nickname?'补抽，替代'+a.replaced_nickname:'补抽，替代原中奖者'):'正常抽取'}}</template></ElTableColumn><template #empty><ElEmpty description="暂无中奖名单，停止抽奖并保存结果后将出现在这里。" :image-size="72" /></template></ElTable></div><div class="pagination tw:flex tw:justify-end"><ElPagination v-model:current-page="page" :total="records.total" :page-size="25" :disabled="busy" layout="prev, pager, next" background @current-change="load()" /></div>
<ElDialog :model-value="!!resetConfig" title="确认清空彩排抽奖" width="560px" append-to-body :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy" @close="resetConfig=null"><h3>确认清空彩排抽奖？</h3><p>将删除彩排中奖、作废、补抽记录和抽奖进度，无法撤销。签到名单、活动资料与奖项设置保留，正式数据不受影响。</p><p>因不在场而排除的人员恢复资格，手动排除保持不变。当前未颁发的指定名单保留；已颁发人员如需再次指定，请重新选择。</p><ElButton :disabled="busy" @click="resetConfig=null" native-type="button">取消</ElButton><ElButton type="primary" :disabled="busy" @click="resetDraw" native-type="button">{{busy?'清空中…':'确认清空'}}</ElButton></ElDialog>
</section>
</template>
<style scoped>
.list-tabs-row{display:flex;align-items:center;gap:24px;margin-bottom:20px}.list-mode-tabs{flex:1;min-width:0}.list-mode-tabs :deep(.el-tabs__header){margin:0}.list-mode-tabs :deep(.el-tabs__item){height:52px;font-size:14px}.list-mode-tabs :deep(.el-tabs__nav-wrap:after){height:1px;background:#30394e}

.draw-page{color:#e4e8f5}.heading{padding-bottom:22px;border-bottom:1px solid #30384d;margin-bottom:24px}h2{font-size:24px;margin:0 0 8px}p,.hint,small{font-size:12px;color:#a4b1ca;line-height:1.8}button:not(.el-button),select{border:1px solid #454d65;border-radius:8px;padding:11px 16px;background:#20293d;color:#e4e8f5;font:inherit;font-size:13px}button:not(.el-button){cursor:pointer}button:not(.el-button):disabled{opacity:.45;cursor:default}.toolbar,.record-heading,.pagination{display:flex;justify-content:space-between;align-items:center;gap:12px}.toolbar{margin:20px 0}.toolbar button:not(.el-button){margin-right:8px}.active,.primary:not(.el-button){background:#cbb1ed;color:#291e3a}.actions{justify-content:flex-start;margin-top:20px}.record-heading{margin:20px 0;font-size:13px}.table-wrap{overflow:auto}table{width:100%;min-width:750px;border-collapse:collapse;font-size:12px;text-align:left}th,td{padding:14px;border-bottom:1px solid #30384d}th{color:#a4b1ca}td small{display:block;font-size:10px;max-width:240px;overflow-wrap:anywhere}.pagination{justify-content:flex-end;margin-top:20px;font-size:12px}.notice{padding:12px;background:#203a35;border-radius:8px}.error{color:#ffb4c1}.overlay{position:fixed;inset:0;background:#080d1dcc;z-index:40;display:grid;place-items:center}.overlay section{width:min(520px,90vw);background:#1b2436;border:1px solid #51556c;border-radius:16px;padding:28px}.overlay button:not(.el-button){margin:12px 12px 0 0}@keyframes pulse{to{opacity:.3}}@media(prefers-reduced-motion:reduce){}
.record-heading>button:not(.el-button):first-of-type{margin-left:auto}
:deep(.el-input__wrapper),:deep(.el-select__wrapper){min-height:40px}:deep(.el-button){height:auto;min-height:38px;margin:0}:deep(.el-button+.el-button){margin-left:0}:deep(.el-button.active){background:var(--el-color-primary);border-color:var(--el-color-primary);color:#211d25}.filters :deep(.el-select){width:160px}.wechat-settings :deep(.el-input),.wechat-settings :deep(.el-select){margin-top:8px}.code :deep(.el-input){flex:1;min-width:0}.code :deep(.el-button){flex-shrink:0}.segmented,.toolbar>div{display:flex;gap:8px}.record-heading>.el-button:first-of-type{margin-left:auto}

:deep(.el-table){--el-table-bg-color:transparent;--el-table-tr-bg-color:transparent;--el-table-header-bg-color:#151e30;--el-table-border-color:#30394e;--el-table-row-hover-bg-color:#222d43;font-size:12px}:deep(.el-table .cell){line-height:1.8;overflow-wrap:anywhere}:deep(.el-table small){display:block;color:#9daac2;font-size:11px}:deep(.el-table td.el-table__cell){padding:14px 0}:deep(.el-table p){margin:0 0 6px}
</style>
