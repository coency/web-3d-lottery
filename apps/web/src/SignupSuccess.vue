<script setup lang="ts">
import {computed} from 'vue';
import type {ActivityMaterials} from './materials';
const props=defineProps<{person:{nickname:string;avatarUrl:string;displayFields?:{id:string;label:string;value:string}[]};ended?:boolean;materials?:ActivityMaterials|null;loading?:boolean;error?:string}>();
defineEmits<{open:[];retry:[]}>();
const placeholder='/signup-avatar-placeholder.svg';
const avatar=computed(()=>!props.person.avatarUrl||props.person.avatarUrl.endsWith('/avatar-placeholder.svg')?placeholder:props.person.avatarUrl);
function fallback(event:Event){const img=event.target as HTMLImageElement;if(!img.src.endsWith(placeholder))img.src=placeholder;}
</script>
<template>
<section class="signup-success">
 <div class="result-heading"><svg class="success-check" viewBox="0 0 56 56" aria-hidden="true"><circle cx="28" cy="28" r="26"/><path d="m17 28 7 7 15-16"/></svg><h1>签到成功</h1><p>{{ended?'活动已结束，您的签到记录已保留':'祝您好运'}}</p></div>
 <div class="success-identity"><img :src="avatar" alt="微信头像" @error="fallback"><h2>{{person.nickname}}</h2></div>
 <dl v-if="person.displayFields?.length" class="signup-details"><div v-for="field in person.displayFields" :key="field.id"><dt>{{field.label}}</dt><dd>{{field.value}}</dd></div></dl>
 <button v-if="materials" class="materials-entry" type="button" :disabled="loading" @click="$emit('open')"><svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="materials.type==='images'" d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/><path v-else d="m9 15 6-6M8 10l-3 3a4 4 0 0 0 6 6l3-3M10 8l3-3a4 4 0 0 1 6 6l-3 3"/></svg>{{loading?'正在打开…':materials.buttonText}}</button>
 <p v-if="error" class="materials-error" role="alert">{{error}}<button type="button" @click="$emit('retry')" :disabled="loading">重试</button></p>
</section>
</template>
<style>
/* Shared surface and layout keep the admin preview aligned with the phone page. */
main.signup-result-surface,.configuration .phone-screen.signup-result-surface{background-color:#0e1528;background-image:radial-gradient(ellipse at 0% 0%,#51449380,transparent 47%),radial-gradient(ellipse at 100% 88%,#1e438775,transparent 46%)}
.join-content.signup-result-layout,.configuration .phone-content.signup-result-layout{display:flex;flex-direction:column;container-type:size;padding-top:0;padding-bottom:24px}
</style>
<style scoped>
.signup-success{--unit:clamp(.75px,.31348cqw,1.15px);width:100%;flex-shrink:0;margin:0;text-align:center;padding:clamp(28px,12cqh,100px) 0 0}
.result-heading{margin-bottom:calc(36 * var(--unit))}
.success-check{width:calc(64 * var(--unit));height:calc(64 * var(--unit));fill:none;stroke:#efd0a5;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;display:block;margin:0 auto calc(16 * var(--unit))}
.success-check path{stroke-width:3}
.result-heading h1{font-size:calc(30 * var(--unit));line-height:1.4;color:#f6f3fb;margin:0;font-weight:700}
.result-heading p{color:#ad9dca;font-size:calc(14 * var(--unit));line-height:1.7;margin:calc(6 * var(--unit)) 0 0}
.success-identity{display:flex;justify-content:center;align-items:center;gap:calc(13 * var(--unit));margin-bottom:calc(26 * var(--unit));min-width:0}
.success-identity img{width:calc(42 * var(--unit));height:calc(42 * var(--unit));border-radius:calc(9 * var(--unit));object-fit:cover;flex-shrink:0}
.success-identity h2{font-size:calc(18 * var(--unit));line-height:1.5;font-weight:600;margin:0;min-width:0;overflow-wrap:anywhere;text-align:left;color:#f6f3fb}
.signup-details{display:block;width:100%;max-width:100%;margin:0;padding:calc(6 * var(--unit)) calc(22 * var(--unit));text-align:left;background:#ffffff0b;border:1px solid #b9a5e54d;border-radius:calc(12 * var(--unit));font-size:calc(14 * var(--unit));line-height:1.7}
.signup-details>div{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:calc(16 * var(--unit));align-items:center;padding:calc(13 * var(--unit)) 0;min-height:calc(52 * var(--unit))}
.signup-details>div+div{border-top:1px solid #c6b8de26}
.signup-details dt{color:#b5a4d0;text-align:left;overflow-wrap:anywhere}
.signup-details dd{color:#f6f3fb;text-align:right;margin:0;min-width:0;overflow-wrap:anywhere}
.materials-entry{width:100%;border:0;border-radius:10px;min-height:44px;padding:14px;color:#241936;background:linear-gradient(110deg,#e2c6a0,#baa4e8);font:inherit;font-size:calc(16 * var(--unit));cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;margin-top:calc(24 * var(--unit));overflow-wrap:anywhere}
.materials-entry svg{width:20px;height:20px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.materials-error{font-size:12px;color:#ffb4bf;line-height:1.6;margin:16px 0 0}.materials-error button{width:auto;min-height:32px;padding:4px 10px;margin-left:8px;background:transparent;color:#ffb4bf;text-decoration:underline}
</style>
