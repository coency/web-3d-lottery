<script setup lang="ts">
import {watch,onUnmounted,useSlots,h,type VNode} from 'vue';
import {showNotice} from './notices';
const props=defineProps<{text:string;kind?:string}>();
const slots=useSlots();
let message:ReturnType<typeof showNotice>|undefined;
watch(()=>[props.text,props.kind],()=>{
 message?.close();message=undefined;
 if(!props.text)return;
 const text=props.text;
 const type=props.kind==='error'?'error':props.kind==='success'?'success':props.kind==='warning'?'warning':'info';
 // Freeze this notification's content while Element Plus animates it out.
 // A later prop update should create a new message, not rewrite the old one.
 let snapshot:VNode|undefined;
 message=showNotice(slots.default?()=>snapshot??(snapshot=h('div',slots.default!())):text,type);
},{immediate:true,flush:'post'});
onUnmounted(()=>message?.close());
</script>
<template></template>
