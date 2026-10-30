<script setup lang="ts">
import {computed,ref} from 'vue';
import {ElImageViewer} from 'element-plus';
import 'element-plus/es/components/image-viewer/style/css';
import type {ActivityMaterials} from './materials';
const props=defineProps<{materials:ActivityMaterials}>();
defineEmits<{back:[]}>();
const selected=ref<number|null>(null),failed=ref<Record<string,boolean>>({}),retries=ref<Record<string,number>>({});
function src(id:string,url:string){return retries.value[id]?url+'?retry='+retries.value[id]:url;}
const urls=computed(()=>props.materials.images.map(image=>src(image.id,image.url)));
function retry(id:string){failed.value[id]=false;retries.value[id]=Date.now();}
</script>
<template>
<section class="materials-gallery">
 <button class="materials-back" type="button" @click="$emit('back')">‹ 返回签到结果</button>
 <h1>{{materials.buttonText}}</h1>
 <div class="materials-images"><figure v-for="(image,index) in materials.images" :key="image.id">
  <div v-if="failed[image.id]" class="image-unavailable" role="alert">图片暂未加载<button type="button" @click="retry(image.id)">重新加载</button></div>
  <button v-else class="material-image" type="button" :aria-label="'放大图片 '+(index+1)+'：'+image.name" @click="selected=index"><img :src="src(image.id,image.url)" :alt="image.name" :loading="index?'lazy':'eager'" @error="failed[image.id]=true"></button>
  <figcaption v-if="materials.images.length>1">{{index+1}} / {{materials.images.length}}</figcaption>
 </figure></div>
 <p class="gallery-hint">点击图片可放大</p>
 <ElImageViewer v-if="selected!==null" :url-list="urls" :initial-index="selected" :infinite="false" show-progress teleported @close="selected=null"/>
</section>
</template>
<style scoped>
.materials-gallery{width:100%;margin:0;text-align:left}.materials-gallery .materials-back{width:auto;min-height:44px;padding:8px 0;margin:0 0 12px;background:transparent;color:#d2c7e3;font-size:14px}.materials-gallery h1{font-size:24px;line-height:1.5;overflow-wrap:anywhere;text-align:center;margin:0 0 24px}.materials-images{display:grid;gap:20px}.materials-images figure{margin:0;min-width:0}.materials-gallery .material-image{display:block;min-height:0;padding:0;background:transparent;border-radius:12px;overflow:hidden;line-height:0}.material-image img{display:block;width:100%;height:auto}.materials-images figcaption{color:#bcb2cc;font-size:12px;text-align:center;margin-top:8px}.gallery-hint{font-size:12px;color:#bcb2cc;text-align:center;margin:20px 0}.image-unavailable{padding:32px 16px;background:#ffffff0b;border-radius:12px;color:#bcb2cc;text-align:center;font-size:14px}.materials-gallery .image-unavailable button{width:auto;display:block;margin:12px auto 0;padding:8px 14px;min-height:36px}
</style>
