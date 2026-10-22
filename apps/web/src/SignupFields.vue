<script setup lang="ts">
import {ElInput,ElSelect,ElOption} from 'element-plus';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/select/style/css';
import {reactive} from 'vue';
type Field={id:string;name:string;type:string;required:boolean;hint:string;options:{id:string;label:string}[]};
const props=defineProps<{fields:Field[];modelValue?:Record<string,string>;preview?:boolean}>();
const emit=defineEmits<{'update:modelValue':[value:Record<string,string>]}>();
const draft=reactive<Record<string,string>>({});
// An explicitly supplied model is authoritative, including removed/reset answers.
// Only the editor preview (without v-model) keeps a local draft.
function value(id:string){return (props.modelValue===undefined?draft[id]:props.modelValue[id])??'';}
function update(id:string,value:string){draft[id]=value;emit('update:modelValue',{...props.modelValue,[id]:value});}
function validate(){
 for(const f of props.fields){const answer=value(f.id).trim();if(!answer){if(f.required)return (f.type==='single'?'请选择：':'请填写：')+f.name;continue;}if(f.type==='number'&&!/^[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(answer))return '请填写有效数字：'+f.name;if(f.type==='single'&&!f.options.some(o=>o.id===answer))return '请选择有效选项：'+f.name;}return '';
}
defineExpose({validate});
</script>
<template><div class="signup-fields"><div v-for="f in fields" :key="f.id" class="signup-field">
<ElInput v-if="f.type==='text'||f.type==='number'" :model-value="value(f.id)" @update:model-value="v=>update(f.id,v)" :aria-label="f.name" :placeholder="f.name" :aria-required="f.required" :inputmode="f.type==='number'?'decimal':'text'" :pattern="f.type==='number'?'(?:[+]|-)?([0-9]+([.][0-9]+)?|[.][0-9]+)':undefined" maxlength="200"/>
<ElSelect v-else :model-value="value(f.id)" @update:model-value="v=>update(f.id,v??'')" :aria-label="f.name" :placeholder="f.name" :clearable="!f.required"><ElOption v-for="o in f.options" :key="o.id" :label="o.label||'选项'" :value="o.id"/></ElSelect>
</div></div></template>
<style scoped>
.signup-fields{display:grid;gap:14px;margin:22px 0}.signup-field{min-width:0}.signup-field :deep(.el-input),.signup-field :deep(.el-select){width:100%;margin:0;--el-fill-color-blank:rgba(255,255,255,.22);--el-border-color:rgba(255,255,255,.65);--el-border-color-hover:#fff;--el-text-color-regular:#fff;--el-text-color-placeholder:#f0eef6;--el-input-text-color:#fff;--el-input-placeholder-color:#f0eef6;--el-select-input-color:#fff}.signup-field :deep(.el-input__wrapper),.signup-field :deep(.el-select__wrapper){min-height:44px;border:1px solid #ffffff99;box-shadow:none;border-radius:9px;background:#ffffff38;padding:0 12px}.signup-field :deep(.el-input__inner){margin:0;padding:0;border:0;background:transparent;box-shadow:none;color:#fff;font-size:14px;height:42px}.signup-field :deep(.el-select__placeholder){color:#fff;font-size:14px}.signup-field :deep(.el-select__caret){color:#fff}

</style>
