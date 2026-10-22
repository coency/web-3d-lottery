<script setup lang="ts">
import {ElDatePicker} from 'element-plus';
import 'element-plus/es/components/date-picker/style/css';
const props=defineProps<{modelValue:string;min:string;max:string;disabled?:boolean}>();
const emit=defineEmits<{'update:modelValue':[value:string]}>();
function disabledDate(date:Date){
 const day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
 return day<props.min||day>props.max;
}
</script>
<template>
<div class="date-picker">
 <ElDatePicker :model-value="modelValue" @update:model-value="value=>emit('update:modelValue',value||'')" :disabled="disabled" :disabled-date="disabledDate" :default-value="new Date(min+'T00:00:00')" type="date" value-format="YYYY-MM-DD" format="YYYY年MM月DD日" :editable="false" :clearable="false" aria-label="选择活动结束日期" placeholder="请选择结束日期" />
 <input type="hidden" name="expiresAt" :value="modelValue">
</div>
</template>
<style scoped>
.date-picker{margin:9px 0}.date-picker :deep(.el-date-editor){width:100%}.date-picker :deep(.el-input__wrapper){min-height:42px}
</style>
