<script setup lang="ts">

import {ElButton,ElInput} from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/input/style/css';
import {ElForm} from 'element-plus';
import 'element-plus/es/components/form/style/css';
import TopNotice from './TopNotice.vue';
import { defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue';

const ActivitiesWorkspace=defineAsyncComponent(()=>import('./ActivitiesWorkspace.vue'));
const AuthOrbit = defineAsyncComponent(() => import('./AuthOrbit.vue'));
import { get, post, prepare, RequestError } from './api';
type User = { id:string; account:string; role:string };
const user = ref<User|null>(null);
const checking = ref(true);
const account = ref(''), password = ref('');
const message = ref(''), error = ref(''), busy = ref(false), recovery = ref(false);
let poll: ReturnType<typeof setInterval>;

function showError(cause: unknown){error.value=cause instanceof RequestError?cause.message:'网络暂时不可用，请稍后重试';}
let sessionEpoch=0;
function loseSession(){
  sessionEpoch++;
  user.value=null;password.value='';
  error.value='登录已失效，可能已在其他地方登录、密码已重置或会话已过期，请重新登录。';
}
async function checkSession(initial=false){
  const epoch=sessionEpoch;
  try {const current=await get<User>('/api/v1/auth/me');if(epoch===sessionEpoch)user.value=current;}
  catch(cause){if(epoch!==sessionEpoch)return;if(cause instanceof RequestError && cause.status===401){if(user.value)loseSession();}else if(initial)showError(cause);}
  finally{checking.value=false;}
}
async function submit(){
  if(busy.value)return;
  error.value='';message.value='';busy.value=true;
  try{
    sessionEpoch++;user.value=await post<User>('login',{account:account.value,password:password.value});
    password.value='';recovery.value=false;
  }catch(cause){showError(cause);}finally{busy.value=false;}
}
async function logout(){
  busy.value=true;error.value='';
  try{await post('logout',{});sessionEpoch++;user.value=null;message.value='已退出登录';}
  catch(cause){showError(cause);}finally{busy.value=false;}
}
onMounted(async()=>{
  
  window.addEventListener('focus',focusCheck);
  poll=setInterval(()=>{if(user.value)void checkSession();},5000);
  try{await prepare();}catch(cause){showError(cause);}
  await checkSession(true);
});
function focusCheck(){if(user.value)void checkSession();}
onUnmounted(()=>{clearInterval(poll);window.removeEventListener('focus',focusCheck);});
</script>
<template>

  <div v-if="checking" class="loading-screen" role="status">正在连接星遇…</div>
  <div v-else-if="!user" class="auth-layout">
    <section class="auth-story">
      <a class="auth-brand" href="#">✦ <span>星遇<small>STARLIT</small></span></a>
      <div class="story-copy"><div class="eyebrow">让每一份期待，都被看见</div><h1>下一位幸运的人，<br>就在星海之间。</h1><p>为你的品牌活动，创造值得记住的揭晓时刻。</p></div>
      <AuthOrbit/>
      <div class="story-footer">3D 抽奖 · 品牌活动 · 现场仪式感</div>
    </section>
    <main class="auth-panel">
      <div class="auth-box">
        <div class="eyebrow">你的活动，从这里开始</div><h2>欢迎回来</h2><p class="auth-description">登录后管理你的活动与账号。</p>
        <ElForm @submit.prevent="submit">
          <fieldset :disabled="busy">
            <label>登录账号<ElInput v-model="account" name="account" autocomplete="username" required minlength="4" maxlength="32" placeholder="请输入登录账号" :disabled="busy" /></label>
            <label>密码<ElInput v-model="password" name="password" type="password" autocomplete="current-password" required minlength="10" maxlength="128" placeholder="10–128 个字符" :disabled="busy" /></label>
            <TopNotice v-if="error" :text="error" kind="error"/><TopNotice v-if="message" :text="message" kind="success"/>
            <ElButton class="primary-action" :disabled="busy" native-type="submit" type="primary">{{busy?'正在登录…':'登录'}}</ElButton>
          </fieldset>
        </ElForm>
        <div class="auth-links"><ElButton @click="recovery=!recovery" :disabled="busy" native-type="button" :aria-expanded="recovery">忘记密码？</ElButton></div>
        <p v-if="recovery" class="auth-description" role="status">请联系此系统的部署者重置密码，再使用新密码登录。</p>
      </div>
    </main>
  </div>
  <ActivitiesWorkspace v-else :user="user" :logging-out="busy" @logout="logout" @expired="loseSession" @profile-updated="checkSession()"/>
</template>
