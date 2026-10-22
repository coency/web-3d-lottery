import { fail } from '../auth/security';
import { object,text,uuid } from './validation';
export type Field={id:string;name:string;type:'text'|'number'|'single'|'multiple';hint:string;required:boolean;options:{id:string;label:string}[]};
export type Form={fields:Field[];titleFieldId:string|null;auxiliaryFieldIds:string[];signupFieldIds?:string[]};
export type Rule={mode:'once'|'across'|'max';maxWins:number|null};
export type Prize={id:string;name:string;total:number;batch:number;mode:'random'|'designated'|'mixed';theme:'dream-planet'|'starlight-matrix'|'star-wave'|'starlight-corridor'|'galaxy-waterfall'};
function invalid(message:string):never{return fail(422,'INVALID_CONFIGURATION',message);}
function integer(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<1)invalid('名额、每轮人数和中奖上限必须是正整数');return value as number;}
export function formInput(value:unknown):Form{
 const b=object(value,['fields','titleFieldId','auxiliaryFieldIds','signupFieldIds']);
 if(!Array.isArray(b.fields)||b.fields.length>3)invalid('自定义字段最多 3 个');
 const ids=new Set<string>(),optionIds=new Set<string>();
 const fields=b.fields.map(value=>{
  const f=object(value,['id','name','type','hint','required','options']);
  if(!uuid(f.id)||ids.has(f.id))invalid('字段编号无效或重复');ids.add(f.id);
  if(!['text','number','single'].includes(String(f.type))||typeof f.required!=='boolean'||!Array.isArray(f.options))invalid('字段类型或必填设置不正确');
  if((f.type==='text'||f.type==='number')&&f.options.length)invalid('文本字段不能包含选项');
  if(f.type==='single'&&(f.options.length<1||f.options.length>50))invalid('选择字段需要 1–50 个选项');
  const options=f.options.map(value=>{
   const o=object(value,['id','label']);if(!uuid(o.id)||optionIds.has(o.id))invalid('选项编号无效或重复');optionIds.add(o.id);
   return {id:o.id,label:text(o.label,100,true)};
  });
  if(new Set(options.map(o=>o.label)).size!==options.length)invalid('同一字段内的选项名称不能重复');
  return {id:f.id,name:text(f.name,8,true),type:f.type as Field['type'],hint:text(f.hint,20),required:f.required as boolean,options};
 });
 if(b.titleFieldId!==null&&!ids.has(String(b.titleFieldId)))invalid('中奖主标题字段不存在');
 if(!Array.isArray(b.auxiliaryFieldIds)||b.auxiliaryFieldIds.length>2||b.auxiliaryFieldIds.some(id=>!ids.has(id))||new Set(b.auxiliaryFieldIds).size!==b.auxiliaryFieldIds.length)invalid('辅助字段最多两个，且不能重复');
 if(b.auxiliaryFieldIds.includes(b.titleFieldId))invalid('主标题与辅助字段不能重复');
 const signup=b.signupFieldIds??[];
 if(!Array.isArray(signup)||signup.length>3||signup.some(id=>!ids.has(id))||new Set(signup).size!==signup.length)invalid('签到展示字段不存在或重复');
 return {fields,titleFieldId:b.titleFieldId as string|null,auxiliaryFieldIds:[],signupFieldIds:signup as string[]};
}
export function ruleInput(value:unknown):Rule{
 const b=object(value,['mode','maxWins']);
 if(!['once','across','max'].includes(String(b.mode)))invalid('中奖次数模式不正确');
 if(b.mode!=='max'&&b.maxWins!==null)invalid('此模式无需填写中奖次数上限');
 return {mode:b.mode as Rule['mode'],maxWins:b.mode==='max'?integer(b.maxWins):null};
}
export function prizesInput(value:unknown):Prize[]{
 if(!Array.isArray(value)||value.length>200)invalid('每场最多配置 200 个奖项');
 const ids=new Set<string>();
 return value.map(value=>{
  const p=object(value,['id','name','total','batch','mode','theme']);
  if(!uuid(p.id)||ids.has(p.id))invalid('奖项编号无效或重复');ids.add(p.id);
  const total=integer(p.total),batch=integer(p.batch);
  if(batch>10)invalid('每轮最多抽取 10 人');
  if(batch>total)invalid('每轮人数不能大于奖项总名额');
  if(!['random','designated','mixed'].includes(String(p.mode)))invalid('颁发方式不正确');
  if(p.theme!==undefined&&!['dream-planet','starlight-matrix','star-wave','starlight-corridor','galaxy-waterfall'].includes(String(p.theme)))invalid('请选择可用的抽奖主题');
  return {id:p.id,name:text(p.name,100,true),total,batch,theme:(p.theme??'dream-planet') as Prize['theme'],mode:(p.mode==='mixed'?'designated':p.mode) as Prize['mode']};
 });
}
export function validateAnswers(form:Form,value:unknown):Record<string,string|string[]>{
 const answers=object(value,form.fields.map(f=>f.id)),result:Record<string,string|string[]>={};
 for(const f of form.fields){
  const v=answers[f.id];
  const empty=v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length);
  if(empty){if(f.required)invalid('请填写：'+f.name);continue;}
  if(f.type==='number'){const number=text(v,200,true);if(!/^[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(number))invalid('请填写有效数字：'+f.name);result[f.id]=number;continue;}
  if(f.type==='text'){result[f.id]=text(v,200,f.required);continue;}
  const options=new Set(f.options.map(o=>o.id));
  if(f.type==='single'){if(typeof v!=='string'||!options.has(v))invalid('请选择有效选项：'+f.name);result[f.id]=v;}
  else{if(!Array.isArray(v)||v.some(x=>!options.has(x))||new Set(v).size!==v.length)invalid('多选内容不正确：'+f.name);result[f.id]=v;}
 }
 return result;
}
export function simulationTarget(value:unknown):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>5000)fail(422,'INVALID_SIMULATION_COUNT','模拟参与者总数须为 1–5000 的整数');
 return value;
}
