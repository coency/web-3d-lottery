<script setup lang="ts">
import {ElTag,ElEmpty} from 'element-plus';
import 'element-plus/es/components/tag/style/css';
import 'element-plus/es/components/empty/style/css';
import {ElForm} from 'element-plus';
import 'element-plus/es/components/form/style/css';
import {ElTable,ElTableColumn} from 'element-plus';
import 'element-plus/es/components/table/style/css';
import {ref,watch,onUnmounted} from 'vue';
import {ElButton,ElDatePicker,ElOption,ElPagination,ElSelect} from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/date-picker/style/css';
import 'element-plus/es/components/select/style/css';
import 'element-plus/es/components/pagination/style/css';
import {get,RequestError} from './api';
import {subscribeUpdates} from './realtime';
import TopNotice from './TopNotice.vue';
type Entry={id:string;createdAt:string;title:string;category:string;mode:string|null;actor:string;lines:string[]};
type Result={items:Entry[];total:number;page:number;pageSize:number;phase:string};
const props=defineProps<{activityId:string}>();
const emit=defineEmits<{expired:[]}>();
const data=ref<Result|null>(null),loading=ref(false),error=ref(''),page=ref(1);
const category=ref('all'),mode=ref('all'),start=ref(''),end=ref(''),changed=ref(false);
let applied={category:'all',mode:'all',start:'',end:''},sequence=0,alive=true;
const labels:Record<string,string>={settings:'活动设置',participants:'人员管理',draw:'抽奖操作',data:'数据与模式'};
const time=(value:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium',hour12:false}).format(new Date(value));
async function load(){
 const seq=++sequence;loading.value=true;error.value='';changed.value=false;
 try{
  const result=await get<Result>('/api/v1/activities/'+props.activityId+'/audit?'+new URLSearchParams({...applied,page:String(page.value)}));
  if(alive&&seq===sequence)data.value=result;
 }catch(e){if(alive&&seq===sequence){if(e instanceof RequestError&&e.status===401)emit('expired');error.value=e instanceof Error?e.message:'暂时无法读取操作记录';}}
 finally{if(alive&&seq===sequence)loading.value=false;}
}
function search(){applied={category:category.value,mode:mode.value,start:start.value||'',end:end.value||''};page.value=1;void load();}
function reset(){category.value='all';mode.value='all';start.value='';end.value='';search();}
watch(()=>props.activityId,()=>{data.value=null;reset();},{immediate:true});
// Keep the current page still while the user is reading historical operations.
const unsubscribe=subscribeUpdates(change=>{if(data.value&&(change.all||change.ids.includes(props.activityId)))changed.value=true;});
onUnmounted(()=>{alive=false;sequence++;unsubscribe();});
</script>
<template>
<section class="audit-page">
 <div class="audit-heading tw:flex tw:items-center tw:justify-between tw:gap-4"><div><h2>操作记录</h2><p>查看本场活动已成功保存的操作，活动结束后仍可查询。</p></div></div>
 <TopNotice v-if="error" :text="error" kind="error" />
 <ElForm class="audit-filters tw:my-6 tw:grid tw:grid-cols-2 tw:items-end tw:gap-3 tw:rounded-xl tw:p-5 tw:xl:grid-cols-[1fr_1fr_1.2fr_1.2fr_auto]" @submit.prevent="search">
  <div class="tw:grid tw:gap-2"><label for="audit-category">操作类型</label><ElSelect id="audit-category" v-model="category" aria-label="操作类型"><ElOption label="全部类型" value="all"/><ElOption v-for="(label,key) in labels" :key="key" :label="label" :value="key"/></ElSelect></div>
  <div class="tw:grid tw:gap-2"><label for="audit-mode">活动模式</label><ElSelect id="audit-mode" v-model="mode" aria-label="活动模式"><ElOption label="全部模式" value="all"/><ElOption label="彩排" value="rehearsal"/><ElOption label="正式" value="formal"/></ElSelect></div>
  <div class="tw:grid tw:gap-2"><label for="audit-start">开始日期</label><ElDatePicker id="audit-start" v-model="start" type="date" value-format="YYYY-MM-DD" format="YYYY年MM月DD日" placeholder="选择开始日期" :editable="false" aria-label="开始日期" /></div>
  <div class="tw:grid tw:gap-2"><label for="audit-end">结束日期</label><ElDatePicker id="audit-end" v-model="end" type="date" value-format="YYYY-MM-DD" format="YYYY年MM月DD日" placeholder="选择结束日期" :editable="false" :disabled-date="(date:Date)=>!!start&&date.getTime()<new Date(start+'T00:00:00').getTime()" aria-label="结束日期" /></div>
  <div class="tw:flex tw:gap-2"><ElButton native-type="submit" type="primary" :disabled="loading">筛选</ElButton><ElButton @click="reset" :disabled="loading">重置</ElButton></div>
 </ElForm>
 <div class="audit-summary tw:my-4 tw:flex tw:items-center tw:justify-between tw:gap-4"><span>共 {{data?.total??0}} 条 · 每页 25 条</span><ElButton v-if="changed" @click="page=1;load()" :disabled="loading">活动有更新，查看最新记录</ElButton></div>
 <p class="hint">未区分模式的早期记录会标为“未记录”；未保存的历史细节不会补造。清空彩排后仍保留操作记录，相关人员信息会移除。</p>
 <div class="audit-table" :aria-busy="loading"><ElTable :data="data?.items??[]" row-key="id" style="width:100%" empty-text="暂无记录"><ElTableColumn label="操作时间" min-width="180"><template #default="{row:item}">{{time(item.createdAt)}}</template></ElTableColumn><ElTableColumn label="操作" min-width="200"><template #default="{row:item}"><strong>{{item.title}}</strong><small>{{labels[item.category]||'历史操作'}}</small></template></ElTableColumn><ElTableColumn label="模式" min-width="80"><template #default="{row:item}"><ElTag size="small" type="info">{{item.mode==='rehearsal'?'彩排':item.mode==='formal'?'正式':'未记录'}}</ElTag></template></ElTableColumn><ElTableColumn label="操作账号" min-width="150"><template #default="{row:item}">{{item.actor}}</template></ElTableColumn><ElTableColumn label="内容" min-width="320"><template #default="{row:item}"><p v-for="(line,index) in item.lines" :key="index">{{line}}</p></template></ElTableColumn><template #empty><ElEmpty description="暂无符合条件的操作记录" :image-size="72" /></template></ElTable></div>
 
 <div class="audit-pagination tw:my-5 tw:flex tw:justify-end"><ElPagination v-model:current-page="page" :page-size="25" :total="data?.total??0" :disabled="loading" layout="prev, pager, next" background @current-change="load" /></div>
</section>
</template>
<style scoped>
.audit-heading h2{margin:0 0 8px}.audit-heading p,.hint,.audit-empty p{color:#9daac2;font-size:13px;line-height:1.7}.audit-filters{background:#151d2e}.audit-filters>div{min-width:0}.audit-filters label{font-size:12px;color:#b8c4d9}.audit-filters :deep(.el-date-editor.el-input){width:100%}.audit-filters :deep(.el-button+.el-button){margin-left:0}.audit-summary{font-size:13px}.audit-table{overflow:auto;border:1px solid #303c51;border-radius:12px}table{width:100%;border-collapse:collapse;min-width:780px;text-align:left;font-size:12px}th{color:#9faec7;background:#151e30}td,th{padding:16px;border-bottom:1px solid #303c51;vertical-align:top}td p{margin:0 0 7px;overflow-wrap:anywhere;line-height:1.6}td small{display:block;color:#94a4bf;margin-top:7px}.audit-time{white-space:nowrap}.audit-mode{background:#29344b;border-radius:5px;padding:4px 7px;white-space:nowrap}.audit-empty{text-align:center;padding:36px}

:deep(.el-table){--el-table-bg-color:transparent;--el-table-tr-bg-color:transparent;--el-table-header-bg-color:#151e30;--el-table-border-color:#30394e;--el-table-row-hover-bg-color:#222d43;font-size:12px}:deep(.el-table .cell){line-height:1.8;overflow-wrap:anywhere}:deep(.el-table small){display:block;color:#9daac2;font-size:11px}:deep(.el-table td.el-table__cell){padding:14px 0}:deep(.el-table p){margin:0 0 6px}
</style>
