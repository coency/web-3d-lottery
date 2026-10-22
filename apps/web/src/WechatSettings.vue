<script setup lang="ts">
import {ElDialog,ElTag} from 'element-plus';
import 'element-plus/es/components/dialog/style/css';
import 'element-plus/es/components/tag/style/css';
import {ElForm} from 'element-plus';
import 'element-plus/es/components/form/style/css';
import {ElInput,ElButton,ElCheckbox} from 'element-plus';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/checkbox/style/css';
import {ref,watch,computed} from 'vue';
import {get,write,RequestError} from './api';
import TopNotice from './TopNotice.vue';
const props=defineProps<{activityId:string}>(),emit=defineEmits<{expired:[]}>();
const configOpen=ref(false),guideOpen=ref(false);
type Config={source:'platform'|'custom';version:string;appId:string;accountName:string;secretConfigured:boolean;status:string;customAllowed:boolean;lockedReason:string;vaultReady:boolean;legacyBinding:boolean;message:string;filename:string;verificationFiles:string[];domainConfirmed:boolean;origin:string|null};
const data=ref<Config|null>(null),appId=ref(''),name=ref(''),secret=ref(''),busy=ref(false),error=ref(''),message=ref('');
const filename=ref(''),domainConfirmed=ref(false),fileInput=ref<HTMLInputElement|null>(null);
async function uploadFile(event:Event){
 const input=event.target as HTMLInputElement,file=input.files?.[0];input.value='';
 if(!file||!data.value||unsaved.value||busy.value)return;
 if(!/^MP_verify_[A-Za-z0-9_]+\.txt$/.test(file.name)||file.name.length>128||file.size>4096){error.value='请选择微信提供的 MP_verify_*.txt 原文件（不超过 4KB）';return;}
 busy.value=true;error.value='';message.value='';
 try{const uploaded=await write<{filename:string}>(base()+'/verification-file','POST',{filename:file.name,content:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer())},{'If-Match':data.value.version});await load();filename.value=uploaded.filename;domainConfirmed.value=false;message.value='校验文件已上传，请在微信后台保存网页授权域名后检查微信接入';}catch(e){failure(e);}finally{busy.value=false;}
}
const unsaved=computed(()=>!!data.value&&(appId.value!==data.value.appId||name.value!==data.value.accountName||!!secret.value));
const base=()=>'/api/v1/activities/'+props.activityId+'/wechat';
function failure(e:unknown){error.value=e instanceof Error?e.message:'服务号配置暂不可用';if(e instanceof RequestError&&e.status===401)emit('expired');}
async function load(){busy.value=true;error.value='';secret.value='';try{const c=await get<Config>(base());data.value=c;appId.value=c.appId;name.value=c.accountName;filename.value=c.filename||(c.verificationFiles.length===1?c.verificationFiles[0]!:filename.value);domainConfirmed.value=c.domainConfirmed;}catch(e){failure(e);}finally{busy.value=false;}}
async function openConfig(){await load();configOpen.value=true;}
async function save(){if(!data.value)return;busy.value=true;error.value='';message.value='';try{await write(base(),'PUT',{source:'custom',appId:appId.value,accountName:name.value,appSecret:secret.value},{'If-Match':data.value.version});secret.value='';await load();message.value='服务号配置已保存，请检查微信接入';}catch(e){failure(e);}finally{secret.value='';busy.value=false;}}
async function check(){if(!data.value||unsaved.value)return;busy.value=true;error.value='';message.value='';try{const result=await write<{message:string}>(base()+'/check','POST',{filename:filename.value.trim(),domainConfirmed:domainConfirmed.value},{'If-Match':data.value.version});await load();message.value=result.message;}catch(e){await load();failure(e);}finally{busy.value=false;}}
watch(()=>props.activityId,()=>{configOpen.value=false;guideOpen.value=false;data.value=null;filename.value='';domainConfirmed.value=false;void load();},{immediate:true});
</script>
<template>
<TopNotice :text="error" kind="error"/><TopNotice :text="message" kind="success"/>
<section class="wechat-settings" aria-label="已认证服务号">
 <div class="wechat-overview">
  <div class="wechat-symbol" aria-hidden="true">微</div>
  <div class="wechat-summary">
   <div class="wechat-heading"><h3>已认证服务号</h3><ElTag size="small" :type="data?.status==='ready'?'success':'info'">{{busy&&!data?'加载中':!data?'加载失败':data.status==='ready'?'接入已就绪':data.secretConfigured?'已保存 · 待检查':'未配置'}}</ElTag></div>
   <p>{{data?.secretConfigured ? data.accountName || '本场活动服务号' : '连接本场活动的微信授权，获取参与者昵称与头像。'}}</p>
   <small v-if="data?.secretConfigured">AppID：{{data.appId}}</small>
  </div>
  <div class="overview-actions"><ElButton @click="guideOpen=true" native-type="button">接入步骤</ElButton><ElButton type="primary" :disabled="busy" @click="openConfig" native-type="button">{{data?.lockedReason?'查看配置':data?.secretConfigured?'修改配置':'配置服务号'}}</ElButton></div>
 </div>
 <p v-if="data?.lockedReason" class="locked-note">{{data.lockedReason}}</p>
</section>
<ElDialog v-model="configOpen" title="配置服务号" class="wechat-dialog" width="min(860px, calc(100vw - 32px))" align-center append-to-body :close-on-click-modal="false" @closed="secret=''">
 <div class="wechat-content" v-if="data">
  <p class="state">{{data.message}}</p>
  <p v-if="data.lockedReason" class="help">{{data.lockedReason}}</p>
  <div class="setup-columns">
   <ElForm @submit.prevent="save" class="credentials-panel"><fieldset :disabled="busy||!!data.lockedReason">
    <h3 class="panel-title">1. 服务号信息</h3>
    <p v-if="data.legacyBinding" class="help">保留历史绑定；更换服务号需填写新密钥，已有正式签到人员时不可更换。</p>
    <label>服务号名称<ElInput v-model="name" maxlength="80" required placeholder="填写服务号名称" :disabled="busy||!!data.lockedReason" aria-label="服务号名称" /></label>
    <label>AppID<ElInput v-model="appId" maxlength="64" required placeholder="填写 AppID" autocomplete="off" spellcheck="false" :disabled="busy||!!data.lockedReason" aria-label="AppID" /></label>
    <label>AppSecret<ElInput v-model="secret" type="password" maxlength="256" autocomplete="new-password" :placeholder="data.secretConfigured&&data.source==='custom'&&data.appId===appId?'已保存，留空不修改':'填写 AppSecret'" :required="!data.secretConfigured||data.source!=='custom'||data.appId!==appId" :disabled="busy||!!data.lockedReason" aria-label="AppSecret" /></label>
    <p class="help">更换 AppID 时需填写对应密钥。</p>
    <p v-if="!data.vaultReady" class="help">密钥存储未就绪，请联系部署人员。</p>
    <ElButton type="primary" :disabled="busy||!!data.lockedReason||!data.vaultReady" native-type="submit">{{busy?'处理中…':'保存配置'}}</ElButton>
   </fieldset></ElForm>
   <section class="check-panel" aria-label="授权域名与校验">
    <h3 class="panel-title">2. 授权域名与校验</h3>
    <p class="domain-line">网页授权域名<strong>{{data.origin?data.origin.replace('https://',''):'请先配置公网 HTTPS 域名'}}</strong></p>
    <label>微信校验文件<div class="file-row"><ElInput v-model="filename" maxlength="128" placeholder="MP_verify_*.txt" :disabled="busy" aria-label="微信校验文件名" /><ElButton native-type="button" :disabled="busy||unsaved||!data.secretConfigured||!!data.lockedReason" @click="fileInput?.click()">上传文件</ElButton></div></label>
    <input ref="fileInput" type="file" accept=".txt,text/plain" hidden aria-label="上传微信校验文件" @change="uploadFile">
    <p class="help">上传微信下载的原文件，自动部署，无需重启。</p>
    <ElCheckbox v-model="domainConfirmed" :disabled="busy">已在微信后台保存网页授权域名</ElCheckbox>
    <p class="help">检查配置和文件可访问性；域名需在微信后台保存。</p>
    <ElButton type="primary" @click="check" :loading="busy" :disabled="busy||!data.secretConfigured||unsaved||!filename.trim()||!domainConfirmed" native-type="button">检查微信接入</ElButton>
    <small v-if="unsaved" class="help">请先保存左侧配置。</small>
   </section>
  </div>
 </div>
 <p v-else class="help">{{busy?'正在加载配置…':'配置加载失败'}} <ElButton v-if="!busy" @click="load" native-type="button">重试</ElButton></p>
</ElDialog>
<ElDialog v-model="guideOpen" title="服务号接入 · 3 步完成" class="wechat-dialog" width="min(720px, calc(100vw - 32px))" align-center append-to-body>
 <div class="wechat-guide">
  <ol class="guide-steps">
   <li><h4>准备已认证服务号</h4><p>登录 <a href="https://mp.weixin.qq.com/" target="_blank" rel="noopener noreferrer">微信公众平台</a>，确认服务号认证有效，具备网页授权权限。</p></li>
   <li><h4>保存服务号配置</h4><p>在微信后台找到 AppID 和 AppSecret，填写到本系统「配置服务号」并保存。</p><p class="help">使用已有密钥即可；重置会影响其他已接入系统。</p></li>
   <li><h4>设置授权域名并检查</h4><p>在微信后台「公众号设置 → 功能设置 → 网页授权域名」填写下方域名，不带协议和路径。</p>
    <div class="guide-example">{{data?.origin?data.origin.replace('https://',''):'你的部署域名，例如 lottery.example.com'}}</div>
    <p>下载 MP_verify_*.txt，在本系统「配置服务号」上传；返回微信后台验证并保存域名。</p>
    <p>最后勾选「已在微信后台保存网页授权域名」，点击「检查微信接入」。</p>
   </li>
  </ol>
  <p class="guide-result">检查通过后即可启用正式活动，无需先扫码签到。</p>
 </div>
 <template #footer><ElButton type="primary" @click="guideOpen=false">知道了</ElButton></template>
</ElDialog>
</template>
<style scoped>
.wechat-settings{margin:0 0 24px;padding:22px 24px;border:1px solid #333d52;border-radius:14px;background:linear-gradient(115deg,#1a2132,#151b29)}
.wechat-overview{display:flex;align-items:center;gap:18px}.wechat-symbol{width:46px;height:46px;display:grid;place-items:center;flex-shrink:0;border-radius:13px;background:#2e3044;color:#dac094;font-size:21px}.wechat-summary{flex:1;min-width:0}.wechat-heading{display:flex;align-items:center;gap:14px}.wechat-heading h3{margin:0;font-size:16px;font-weight:600;color:#edf0f8}.wechat-summary p{margin:8px 0 0;color:#adb8ce;font-size:13px;overflow-wrap:anywhere}.wechat-summary small{display:block;margin-top:5px;color:#8d9bb3;font-size:12px}.overview-actions{display:flex;gap:10px;flex-shrink:0}.locked-note{margin:14px 0 0 64px;color:#c8b38e;font-size:12px;line-height:1.7}
.wechat-content{padding:0}.help{font-size:12px;color:#aab3c8;line-height:1.6;margin:8px 0}.state{font-size:13px;color:#d5bedf;line-height:1.6;margin:0 0 16px}.setup-columns{display:grid;grid-template-columns:1fr 1fr;gap:24px}.check-panel{border-left:1px solid #303a50;padding-left:24px;min-width:0}.credentials-panel{min-width:0}.panel-title{font-size:14px;color:#ede7f4;margin:0 0 12px}.wechat-content label{display:block;font-size:13px;color:#c6cde0;margin:10px 0}.wechat-content fieldset{border:0;padding:0;margin:0;min-width:0}.wechat-content :deep(.el-input){margin-top:5px}.wechat-content :deep(.el-input__wrapper){min-height:34px}.wechat-content :deep(.el-button){min-height:34px;margin:0}.wechat-content :deep(.el-checkbox){height:auto;min-height:32px;white-space:normal;margin:4px 0}.wechat-content :deep(.el-checkbox__label){font-size:12px;line-height:1.6}.file-row{display:flex;gap:8px;align-items:flex-end}.file-row .el-input{min-width:0}.file-row .el-button{flex-shrink:0}.domain-line{font-size:12px;color:#aab3c8;line-height:1.6;margin:10px 0}.domain-line strong{display:block;color:#e1ca9c;font-size:13px;font-weight:500;overflow-wrap:anywhere}.check-panel>small{display:block}.wechat-guide{color:#c2cbdd;font-size:13px;line-height:1.65}.guide-steps{list-style:none;counter-reset:step;padding:0;margin:0}.guide-steps li{position:relative;counter-increment:step;padding:0 0 16px 40px}.guide-steps li:last-child{padding-bottom:0}.guide-steps li:before{content:counter(step);position:absolute;left:0;top:0;display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:#343044;color:#e2c995;font-size:13px}.guide-steps h4{margin:0 0 6px;color:#f0edf6;font-size:14px}.guide-steps p{margin:5px 0}.wechat-guide a{color:#e2c995;text-decoration:underline;text-underline-offset:3px}.guide-example{padding:8px 12px;margin:8px 0;background:#111827;border:1px solid #333c50;border-radius:8px;overflow-wrap:anywhere;color:#e1ca9c}.guide-result{margin:16px 0 0;padding-top:12px;border-top:1px solid #333c50;color:#cbb58e;font-size:12px}
@media(max-width:620px){.setup-columns{grid-template-columns:1fr;gap:14px}.check-panel{border-left:0;border-top:1px solid #303a50;padding:14px 0 0}.state{margin-bottom:10px}.panel-title{margin-bottom:8px}.wechat-content label{margin:8px 0}.help{margin:5px 0}.guide-steps li{padding-left:34px;padding-bottom:12px}}
@media(max-width:1100px){.wechat-overview{flex-wrap:wrap}.overview-actions{margin-left:64px}}
</style>

<style>
.el-dialog.wechat-dialog{padding:24px;border-radius:14px}.wechat-dialog .el-dialog__header{padding:0 32px 16px 0}.wechat-dialog .el-dialog__title{font-size:18px}.wechat-dialog .el-dialog__body{padding:0}.wechat-dialog .el-dialog__footer{padding-top:16px}.wechat-dialog .el-dialog__headerbtn{top:12px;right:12px}@media(max-width:620px),(max-height:650px){.el-dialog.wechat-dialog{padding:16px}.wechat-dialog .el-dialog__header{padding-bottom:12px}}
</style>
