<script setup lang="ts">
import {ref,computed,watch} from 'vue';
import {ElButton,ElInput,ElRadioGroup,ElRadioButton,ElImageViewer} from 'element-plus';
import 'element-plus/es/components/radio-group/style/css';
import 'element-plus/es/components/radio-button/style/css';
import 'element-plus/es/components/image-viewer/style/css';
import {write,RequestError} from './api';
import {safeMaterialLink,type ActivityMaterials} from './materials';
const props=defineProps<{activityId:string;modelValue:ActivityMaterials;disabled?:boolean}>();
const emit=defineEmits<{expired:[];busy:[value:boolean];preview:[value:ActivityMaterials|null]}>();
const data=computed(()=>props.modelValue),busy=ref(false),error=ref(''),preview=ref<number|null>(null),dragged=ref<number|null>(null),root=ref<HTMLElement|null>(null);
const disabled=computed(()=>props.disabled||busy.value),link=computed(()=>safeMaterialLink(data.value.link));
watch(busy,value=>emit('busy',value));
watch(data,d=>{emit('preview',((d.type==='images'&&d.images.length)||(d.type==='link'&&safeMaterialLink(d.link)))?{buttonText:d.buttonText||'查看活动流程',type:d.type,link:d.link,images:d.images.map(i=>({...i}))}:null);},{deep:true,immediate:true});
watch(()=>props.activityId,()=>{error.value='';preview.value=null;});
function failure(e:unknown){if(e instanceof RequestError&&e.status===401)emit('expired');error.value=e instanceof Error?e.message:'操作失败';}
function validate(){
 error.value='';const label=data.value.buttonText.trim();
 if(!label||[...label].length>12)error.value='按钮文字须为 1–12 个字';
 else if(data.value.type==='link'&&data.value.link.trim()&&!link.value)error.value='请填写完整的 http:// 或 https:// 网页链接';
 return !error.value;
}
function focusError(){root.value?.querySelector<HTMLInputElement>(error.value.includes('按钮文字')?'input[aria-label="按钮文字"]':'input[aria-label="跳转链接"]')?.focus();}
defineExpose({validate,focusError});
function move(from:number,to:number){if(disabled.value||!data.value||to<0||to>=data.value.images.length||from===to)return;const [image]=data.value.images.splice(from,1);if(image)data.value.images.splice(to,0,image);}
function drop(index:number){if(dragged.value!==null)move(dragged.value,index);dragged.value=null;}
async function upload(event:Event){
 const input=event.target as HTMLInputElement,files=Array.from(input.files??[]);input.value='';if(!data.value||disabled.value||!files.length)return;
 error.value='';
 if(files.length+data.value.images.length>10){error.value='每场活动最多 10 张资料图片';return;}
 if(files.some(f=>f.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(f.type))){error.value='请选择 PNG、JPEG、WebP 图片，每张不超过 10MB';return;}
 busy.value=true;const activityId=props.activityId;
 try{for(const file of files){
  if(activityId!==props.activityId)return;
  const ticket=await write<{id:string}>('/api/v1/assets/uploads','POST',{purpose:'activity_material',activityId});
  const image=await write<{id:string;url:string}>('/api/v1/assets/'+ticket.id+'/content','PUT',file);
  if(activityId!==props.activityId||!data.value)return;
  data.value.images.push({...image,name:file.name.slice(0,160)});
 }}catch(e){if(activityId===props.activityId)failure(e);}finally{busy.value=false;}
}
</script>
<template>
<section ref="root" class="materials-settings">
 <h3>活动资料</h3><p>签到成功后展示入口</p>
 <p v-if="error" class="materials-feedback error" role="alert">{{error}}</p>
 <template v-if="data">
 <label>按钮文字<ElInput v-model="data.buttonText" aria-label="按钮文字" maxlength="12" show-word-limit :disabled="disabled"/></label>
 <div class="material-type"><span>内容类型</span><ElRadioGroup v-model="data.type" :disabled="disabled" aria-label="内容类型"><ElRadioButton value="images">图片</ElRadioButton><ElRadioButton value="link">链接</ElRadioButton></ElRadioGroup></div>
 <template v-if="data.type==='images'">
  <div class="material-upload-list"><div v-for="(image,index) in data.images" :key="image.id" class="material-upload-row" :draggable="!disabled" @dragstart="dragged=index" @dragover.prevent @drop.prevent="drop(index)" @dragend="dragged=null">
   <span class="drag-handle" aria-hidden="true">⠿</span><img :src="image.url" :alt="image.name"><span class="material-name">{{image.name}}</span>
   <div class="material-actions"><ElButton native-type="button" @click="preview=index">预览</ElButton><ElButton native-type="button" :disabled="disabled||index===0" @click="move(index,index-1)">上移</ElButton><ElButton native-type="button" :disabled="disabled||index===data.images.length-1" @click="move(index,index+1)">下移</ElButton><ElButton native-type="button" :disabled="disabled" @click="data.images.splice(index,1)">移除</ElButton></div>
  </div></div>
  <label class="materials-upload" :class="{disabled}">{{busy?'处理中…':'＋ 上传图片'}}<input type="file" multiple accept="image/png,image/jpeg,image/webp" :disabled="disabled||data.images.length>=10" aria-label="上传资料图片" @change="upload"></label>
  <p class="material-help">支持 PNG、JPEG、WebP，最多 10 张，每张不超过 10MB，单边不超过 8192px。拖动或使用上移、下移调整顺序。</p>
 </template>
 <template v-else><label>跳转链接<ElInput v-model="data.link" aria-label="跳转链接" placeholder="https://" maxlength="2048" :disabled="disabled"/></label><a v-if="link" class="material-check-link" :href="link" target="_blank" rel="noopener noreferrer">打开检查 ↗</a><p class="material-help">保存前可打开链接，确认内容正确。</p></template>
 <p class="material-help">{{data.type==='images'?'未上传图片':'未填写链接'}}时，保存后签到成功页不显示入口。</p>
 <ElImageViewer v-if="preview!==null" :url-list="data.images.map(i=>i.url)" :initial-index="preview" show-progress :infinite="false" teleported @close="preview=null"/>
 </template>
</section>
</template>
<style scoped>
.materials-settings{padding:6px 0 12px}.materials-settings h3{margin:0 0 8px}.materials-settings>p{color:#bcb2cc;font-size:13px;line-height:1.6}.materials-settings>label{display:grid;gap:10px;margin:20px 0}.material-type{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin:24px 0}.material-upload-list{display:grid;gap:10px}.material-upload-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid #ffffff20;background:#ffffff06;border-radius:10px;padding:12px}.material-upload-row img{width:40px;height:52px;object-fit:contain}.material-name{min-width:0;flex:1;overflow-wrap:anywhere;font-size:13px}.drag-handle{color:#bcb2cc;cursor:grab}.material-actions{display:flex;gap:6px;flex-wrap:wrap}.material-actions :deep(.el-button){margin:0;padding:7px;font-size:12px}.materials-settings .materials-upload{display:flex;position:relative;align-items:center;justify-content:center;min-height:46px;border:1px dashed #baa4e888;border-radius:8px;cursor:pointer}.materials-upload input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer}.materials-upload.disabled{opacity:.5}.material-check-link{color:#dac4ff;text-decoration:none;border:1px solid #baa4e866;border-radius:8px;padding:9px 14px;display:inline-block;font-size:13px}.materials-settings .material-help{font-size:12px;color:#a99fbe}.materials-settings .error{color:#ffb4bf}.materials-feedback{overflow-wrap:anywhere}
</style>
