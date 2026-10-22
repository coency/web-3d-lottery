<script setup lang="ts">
import {ElForm,ElButton,ElInput} from 'element-plus';
import 'element-plus/es/components/form/style/css';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/input/style/css';
import TopNotice from './TopNotice.vue';
import {ref} from 'vue';
import {post,RequestError} from './api';
const props=defineProps<{account:string}>();
const emit=defineEmits<{updated:[];expired:[]}>();
const current=ref(''),password=ref(''),confirm=ref(''),error=ref(''),message=ref(''),busy=ref(false);
async function save(){
  if(busy.value)return;
  error.value='';message.value='';
  if(password.value!==confirm.value){error.value='两次新密码不一致';return;}
  busy.value=true;
  try{
    await post('change-password',{currentPassword:current.value,newPassword:password.value});
    current.value='';password.value='';confirm.value='';emit('updated');
    message.value='密码已修改，下次登录请使用新密码。';
  }catch(e){
    if(e instanceof RequestError&&e.status===401)emit('expired');
    error.value=e instanceof Error?e.message:'操作失败';
  }finally{busy.value=false;}
}
</script>
<template>
<section class="profile-page">
  <h2>个人中心</h2><p>当前登录账号：{{props.account}}</p><h3>修改密码</h3>
  <ElForm @submit.prevent="save"><fieldset :disabled="busy">
    <label>当前密码<ElInput v-model="current" name="currentPassword" type="password" autocomplete="current-password" required minlength="10" maxlength="128" :disabled="busy" aria-label="当前密码" /></label>
    <label>新密码<ElInput v-model="password" name="newPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="128" placeholder="10–128 个字符" :disabled="busy" aria-label="新密码" /></label>
    <label>确认新密码<ElInput v-model="confirm" name="confirmPassword" type="password" autocomplete="new-password" required minlength="10" maxlength="128" :disabled="busy" aria-label="确认新密码" /></label>
    <TopNotice v-if="error" :text="error" kind="error"/><TopNotice v-if="message" :text="message" kind="success"/>
    <ElButton :disabled="busy" native-type="submit" type="primary">{{busy?'保存中…':'保存'}}</ElButton>
  </fieldset></ElForm><p class="hint">修改后当前设备保持登录，旧会话失效。</p>
</section>
</template>
<style scoped>
.profile-page{max-width:650px;padding:34px 24px;color:#e4e8f5}h2{font-size:24px}h3{margin-top:28px;font-size:16px;font-weight:500}p{font-size:13px;color:#a7b3cd;line-height:1.8;overflow-wrap:anywhere}fieldset{border:0;padding:0}label{display:grid;gap:10px;margin:20px 0;font-size:13px}
:deep(.el-input__wrapper){min-height:40px}:deep(.el-button){min-height:38px;margin:0}
</style>
