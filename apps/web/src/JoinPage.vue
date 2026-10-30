<script setup lang="ts">
import SignupFields from './SignupFields.vue';
import SignupSuccess from './SignupSuccess.vue';
import MaterialsGallery from './MaterialsGallery.vue';
import {safeMaterialLink,type ActivityMaterials} from './materials';
import {showNotice} from './notices';
const signupFields=ref<InstanceType<typeof SignupFields>|null>(null);
import {onMounted,onUnmounted,ref,computed,watch} from 'vue';
import {get,write,RequestError} from './api';
import TopNotice from './TopNotice.vue';
type Field={id:string;name:string;hint:string;required:boolean;type:string;options:{id:string;label:string}[]};
type Person={nickname:string;avatarUrl:string;createdAt:string;displayFields?:{id:string;label:string;value:string}[]};
type Entry={generation:number;version:string;ended:boolean;readOnly?:boolean;mode?:string;development?:boolean;name:string;tagline:string;organizer:string;logoUrl:string|null;backgroundUrl:string|null;form:{fields:Field[]};person:Person|null;authenticated?:boolean;profile?:{nickname:string|null;avatarUrl:string}|null;authorizationAvailable?:boolean;requiresWechat?:boolean};
const query=new URLSearchParams(location.search),code=query.get('code'),id=query.get('activity'),base=code?'/api/v1/join/'+code:'/api/v1/dev-join/'+id;
const entry=ref<Entry|null>(null),nickname=ref(''),answers=ref<Record<string,string>>({}),error=ref(''),busy=ref(false);
const materials=ref<ActivityMaterials|null>(null),materialsLoading=ref(false),materialsError=ref(''),materialsOpen=ref(location.hash==='#materials');
let materialsRequest=0;
async function loadMaterials(){
 if(!entry.value?.person)return null;
 const request=++materialsRequest;materialsLoading.value=true;materialsError.value='';
 try{const result=await get<ActivityMaterials|null>(base+'/materials');if(request!==materialsRequest)return null;materials.value=result?.type==='link'||result?.type==='images'?result:null;return materials.value;}
 catch(e){if(request===materialsRequest){materials.value=null;materialsError.value=e instanceof Error?e.message:'活动资料暂不可用';}return null;}
 finally{if(request===materialsRequest)materialsLoading.value=false;}
}
watch(()=>entry.value?.person,person=>{materials.value=null;materialsError.value='';if(person)void loadMaterials();else{materialsRequest++;materialsLoading.value=false;} });
async function openMaterials(){
 if(materialsLoading.value)return;
 const latest=await loadMaterials();if(!latest)return;
 if(latest.type==='link'){
  const url=safeMaterialLink(latest.link);if(!url){materialsError.value='活动链接暂不可用，请联系主办方';return;}
  const link=document.createElement('a');link.href=url;link.rel='noreferrer';document.body.appendChild(link);link.click();link.remove();
 }else{history.pushState({...history.state,starlitMaterials:true},'',location.pathname+location.search+'#materials');materialsOpen.value=true;}
}
function syncMaterialsView(){materialsOpen.value=location.hash==='#materials';}
function closeMaterials(){if(history.state?.starlitMaterials)history.back();else{history.replaceState(null,'',location.pathname+location.search);materialsOpen.value=false;}}
function resumeMaterials(event:PageTransitionEvent){if(event.persisted&&entry.value?.person)void loadMaterials();}
onMounted(()=>{window.addEventListener('popstate',syncMaterialsView);window.addEventListener('hashchange',syncMaterialsView);window.addEventListener('pageshow',resumeMaterials);});
onUnmounted(()=>{materialsRequest++;window.removeEventListener('popstate',syncMaterialsView);window.removeEventListener('hashchange',syncMaterialsView);window.removeEventListener('pageshow',resumeMaterials);});
watch(()=>entry.value?.name,name=>{document.title=name?.trim()||'活动签到';},{immediate:true});
const needsNickname=computed(()=>!code||!entry.value?.profile?.nickname?.trim());
const noFields=computed(()=>!!entry.value&&!entry.value.form.fields.length);
const canAutoCheckin=computed(()=>noFields.value&&!!code&&entry.value?.authenticated&&!entry.value.person&&!entry.value.ended&&!entry.value.readOnly&&!needsNickname.value);
const authErrors:Record<string,string>={OAUTH_STATE_INVALID:'授权已失效或已使用，请重新授权',OAUTH_CONTEXT_CHANGED:'活动配置或彩排数据已变化，请重新授权',WECHAT_AUTH_DENIED:'授权未完成，请重新授权',WECHAT_AUTH_FAILED:'微信授权失败，请重新授权',MOCK_FORMAL_FORBIDDEN:'模拟授权不能用于正式活动',WECHAT_IDENTITY_MISMATCH:'身份校验未通过，请重新授权'};
function fallback(e:Event){const img=e.target as HTMLImageElement;if(!img.src.endsWith('/avatar-placeholder.svg'))img.src='/avatar-placeholder.svg';}
function fallbackLogo(e:Event){const img=e.target as HTMLImageElement;if(!img.src.endsWith('/favicon.svg'))img.src='/favicon.svg';}
async function load(autoCheckin=true){busy.value=true;error.value='';try{const fresh=await get<Entry>(base);const old=entry.value;entry.value=fresh;if(old&&old.generation!==fresh.generation)answers.value={};else answers.value=Object.fromEntries(fresh.form.fields.filter(f=>answers.value[f.id]!==undefined&&(f.type==='text'||f.type==='number'||f.options.some(o=>o.id===answers.value[f.id]))).map(f=>[f.id,answers.value[f.id]!]));}catch(e){error.value=e instanceof Error?e.message:'加载失败';}finally{busy.value=false;}if(autoCheckin&&!error.value&&canAutoCheckin.value)await submit();}
async function authorize(){busy.value=true;error.value='';try{const result=await write<{authorizationUrl:string}>(base+'/authorize','POST',{});location.assign(result.authorizationUrl);}catch(e){error.value=e instanceof Error?e.message:'授权失败';busy.value=false;}}
async function submit(){if(!entry.value||busy.value||entry.value.person||entry.value.ended||entry.value.readOnly)return;const issue=noFields.value?undefined:signupFields.value?.validate();if(issue)return;if(needsNickname.value&&!nickname.value.trim()){showNotice('请填写昵称','warning');return;}busy.value=true;error.value='';try{entry.value.person=await write<Person>(base+'/checkins','POST',{generation:entry.value.generation,version:entry.value.version,nickname:nickname.value,answers:answers.value});}catch(e){const message=e instanceof Error?e.message:'签到失败';if(e instanceof RequestError&&['FORM_VERSION_CHANGED','FORM_CHANGED','PARTICIPANT_AUTH_REQUIRED','GENERATION_CHANGED'].includes(e.code))await load(false);else if(e instanceof RequestError&&e.status>=500){try{const current=await get<Entry>(base);if(current.person)entry.value=current;}catch{}}if(!entry.value?.person)error.value=message;}finally{busy.value=false;}}
onMounted(async()=>{const reason=query.get('authError');await load(!reason);if(reason){error.value=authErrors[reason]??'微信授权暂未完成，请稍后重试或联系主办方';query.delete('authError');history.replaceState(null,'',location.pathname+'?'+query.toString());}});
</script>
<template>
 <TopNotice :text="error" kind="error"/>
 <main :class="{'empty-signup':noFields,'signup-result-surface':!!entry?.person}" :style="entry?.backgroundUrl?{backgroundImage:'linear-gradient(#11162c66,#11162cbb),url('+entry.backgroundUrl+')'}:{}">
  <div class="mode-heading"><div class="demo" :class="{invisible:code&&!entry?.development&&entry?.mode!=='rehearsal'}">彩排签到</div></div><div class="join-content" :class="{'signup-result-layout':!!entry?.person&&!materialsOpen}">
  <template v-if="entry">
   <MaterialsGallery v-if="entry.person&&materialsOpen&&materials?.type==='images'" :materials="materials" @back="closeMaterials"/>
   <SignupSuccess v-else-if="entry.person" :person="entry.person" :ended="entry.ended" :materials="materials" :loading="materialsLoading" :error="materialsError" @open="openMaterials" @retry="loadMaterials"/>
   <section v-else-if="code&&!entry.authenticated" class="success authorization"><img class="brand-logo" :src="entry.logoUrl||'/favicon.svg'" alt="活动品牌 Logo" @error="fallbackLogo"><h2><span class="welcome-heading">{{entry.ended?'活动已结束':'欢迎参加'}}</span><span class="welcome-activity">{{entry.name}}</span></h2><p>{{entry.requiresWechat?'请使用微信扫码打开此页面':entry.ended?'授权后可查看您已有的签到状态':noFields?'授权后将自动为您签到':'授权后填写信息，即可完成签到'}}</p><button v-if="!entry.requiresWechat" :disabled="busy||!entry.authorizationAvailable" @click="authorize">{{busy?'正在跳转…':'微信授权'}}</button><small v-if="!entry.authorizationAvailable">微信授权尚未就绪，请联系主办方</small></section>
   <section v-else-if="entry.ended" class="success"><h2>活动已结束</h2><p>本场活动不再接受新的签到</p></section>
   <section v-else-if="entry.readOnly" class="success"><h2>签到模式已切换</h2><p>请扫描当前活动的签到二维码</p></section>
   <form v-else novalidate @submit.prevent="submit"><div class="profile"><img class="avatar" :src="entry.profile?.avatarUrl||(code?'/avatar-placeholder.svg':'/demo-avatar.svg')" alt="头像" @error="fallback"><strong v-if="!needsNickname">{{entry.profile?.nickname}}</strong><label v-else>{{code?'补充昵称':'彩排昵称'}}<input v-model="nickname" maxlength="64" required :placeholder="code?'微信未返回昵称，请填写':'填写彩排昵称'"></label></div><SignupFields v-if="!noFields" ref="signupFields" :fields="entry.form.fields" v-model="answers"/><button v-if="!noFields||needsNickname" :disabled="busy">{{busy?'正在签到…':noFields?'确认昵称并签到':'签到，开启幸运时刻'}}</button><small v-if="noFields&&!needsNickname" role="status">{{busy?'正在为您签到…':error?'签到未完成，请重新加载后重试':''}}</small><small v-else>{{!code||entry.development?'此签到仅用于彩排':'确认信息后提交签到'}}</small></form>
  </template>
  <section v-else class="success"><h1>{{busy?'正在加载活动…':'签到页面暂不可用'}}</h1><p v-if="!busy">{{code?'请重新扫码，或联系主办方检查活动状态。':'请使用主办方提供的签到二维码。'}}</p></section>
  </div>
  <button v-if="error&&!entry?.person" class="reload" :disabled="busy" @click="load()">重新加载签到页面</button>
  <footer v-if="entry?.organizer">主办方 · {{entry.organizer}}</footer>
 </main>
</template>
<style>
.authorization .brand-logo{display:block;width:88px;height:88px;object-fit:contain;margin:0 auto}.welcome-heading{display:block;font-size:18px;font-weight:500;margin-bottom:8px}.welcome-activity{display:block;max-width:100%;font-size:24px;line-height:1.5;overflow-wrap:anywhere}
*{box-sizing:border-box}body{margin:0;background:#10162b;color:#f4efff;font-family:system-ui,sans-serif}main{max-width:480px;margin:auto;height:100dvh;min-height:100svh;display:flex;flex-direction:column;overflow:hidden;padding:18px 28px 0;background:radial-gradient(ellipse at 15% 15%,#51407788,transparent 65%),radial-gradient(ellipse at 90% 60%,#19366a99,transparent 60%),#10162b;background-size:cover;background-position:center}
.mode-heading{flex-shrink:0;min-height:32px}.demo{text-align:center;font-size:11px;letter-spacing:1px;color:#e1c998;border:1px solid #d8b98555;border-radius:20px;padding:7px}.demo.invisible{visibility:hidden}.join-content{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;padding:24px 0;scrollbar-width:thin}.join-content>form,.join-content>.success{width:100%;flex-shrink:0;margin:auto 0;padding:0;border:0;background:transparent;text-align:center}
.profile,.success-profile{display:flex;flex-direction:column;align-items:center;gap:14px;width:100%;min-width:0}.profile{margin-bottom:24px}.avatar{height:88px;width:88px;object-fit:cover;border-radius:20px;flex-shrink:0}.profile>strong,.success-profile>h2{font-size:25px;line-height:1.4;font-weight:700;margin:0;max-width:100%;overflow-wrap:anywhere}.profile label{width:100%;margin:0}.success h2{font-size:24px;line-height:1.4;overflow-wrap:anywhere}.authorization>h2{margin:14px 0}.success p{font-size:14px;line-height:1.8;color:#c2b8d2;margin:14px 0 24px}.success-message{margin-top:28px}.success-message h2{font-size:18px;color:#e8d0a5;margin:0}.success-message small{margin-top:10px}
label{display:block;font-size:13px;margin-bottom:15px}input,select{display:block;width:100%;margin-top:8px;padding:12px;border:1px solid #ffffff33;border-radius:9px;color:#f3edff;background:#171d32;font:inherit;color-scheme:dark}input:focus,select:focus{outline:2px solid #bca2e1}main button{width:100%;border:0;border-radius:10px;min-height:48px;padding:14px;color:#241936;background:linear-gradient(110deg,#e2c6a0,#baa4e8);font:inherit;cursor:pointer}main button:disabled{opacity:.6}small{display:block;text-align:center;color:#a99fbe;font-size:11px;margin-top:14px;line-height:1.6}main>.reload{flex-shrink:0;background:transparent;color:#b3a9c4;font-size:12px;margin:0;padding:10px 0}footer{flex-shrink:0;text-align:center;font-size:12px;color:#baafca;margin:0;padding:12px 0 max(18px,env(safe-area-inset-bottom));overflow-wrap:anywhere;line-height:1.5}
</style>
