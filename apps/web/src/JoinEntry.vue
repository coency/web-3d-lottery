<script setup lang="ts">
import {ElButton,ElDialog,ElImage,ElLink} from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/dialog/style/css';
import 'element-plus/es/components/image/style/css';
import 'element-plus/es/components/link/style/css';
import {ref} from 'vue';
import {get} from './api';
import TopNotice from './TopNotice.vue';
import {joinQr} from './join-qr';
const props=defineProps<{activityId:string;available?:boolean;mode?:string}>();
const dialog=ref(false),qr=ref(''),url=ref(''),error=ref(''),reason=ref(''),busy=ref(false);
async function open(){busy.value=true;error.value='';try{const entry=await get<{url:string;available:boolean;demoUrl:string|null;reason:string;provider:string}>('/api/v1/activities/'+props.activityId+'/join-entry?mode='+(props.mode||'rehearsal'));url.value=entry.available&&entry.provider==='wechat'?entry.url:'';reason.value=url.value?'':entry.reason||'请在签到设置中完成已认证服务号配置。';qr.value=url.value?await joinQr(url.value):'';dialog.value=true;}catch(e){error.value=e instanceof Error?e.message:'签到入口加载失败';}finally{busy.value=false;}}
</script>
<template>
<ElButton :loading="busy" :disabled="busy" @click="open">报名二维码</ElButton>
<TopNotice :text="error" kind="error"/>
<ElDialog v-model="dialog" class="join-entry" :title="mode==='formal'?'正式签到':'彩排签到'" width="390px" append-to-body align-center>
 <p>{{url?'请使用微信扫码签到':'签到暂不可用'}}</p>
 <ElImage v-if="qr" :src="qr" alt="签到二维码" fit="contain" class="qr-image" />
 <ElLink v-if="qr" :href="qr" download="签到二维码.png" type="primary">下载二维码</ElLink>
 <small v-if="reason">{{reason}}</small>
</ElDialog>
</template>
<style scoped>
.qr-image{width:240px;height:240px;display:block;margin:20px auto}.join-entry p,.join-entry small{text-align:center}.join-entry small{display:block;line-height:1.7;color:#a5adc1;margin-top:12px}.join-entry .el-link{display:flex;margin:14px}
</style>
