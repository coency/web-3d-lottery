import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import validation from '../apps/api/build/activities/configuration.validation.js';
const {formInput,ruleInput,prizesInput,validateAnswers}=validation;
const rejects=fn=>assert.throws(fn,e=>e.getStatus()===422);
test('simulation target accepts bounded integers without coercion',()=>{
 for(const value of [1,100,2000,5000])assert.equal(validation.simulationTarget(value),value);
 for(const value of [undefined,null,'2000',true,0,-1,1.5,5001,NaN,Infinity,Number.MAX_SAFE_INTEGER])rejects(()=>validation.simulationTarget(value));
});
test('empty and optional forms accept no answers; required text rejects whitespace',()=>{
 const blank={fields:[],titleFieldId:null,auxiliaryFieldIds:[]};
 assert.deepEqual(validateAnswers(formInput(blank),{}),{});
 const field={id:randomUUID(),name:'公司',type:'text',required:false,hint:'',options:[]};
 const form=formInput({...blank,fields:[field]});assert.deepEqual(validateAnswers(form,{}),{});
 field.required=true;const required=formInput({...blank,fields:[field]});
 rejects(()=>validateAnswers(required,{}));rejects(()=>validateAnswers(required,{[field.id]:'   '}));
});
test('choice answers require known stable option IDs without duplicates',()=>{
 for(const type of ['single']){
  const field={id:randomUUID(),name:'选择',type,required:true,hint:'',options:[{id:randomUUID(),label:'选项一'}]};
  const form=formInput({fields:[field],titleFieldId:null,auxiliaryFieldIds:[]});
  rejects(()=>validateAnswers(form,{[field.id]:type==='single'?'选项一':['选项一']}));
  assert.doesNotThrow(()=>validateAnswers(form,{[field.id]:type==='single'?field.options[0].id:[field.options[0].id]}));
  if(type==='multiple')rejects(()=>validateAnswers(form,{[field.id]:[field.options[0].id,field.options[0].id]}));
 }
});
test('field references, duplicate IDs and unsafe quota numbers are rejected',()=>{
 const field={id:randomUUID(),name:'字段',type:'text',required:false,hint:'',options:[]};
 rejects(()=>formInput({fields:[field,field],titleFieldId:null,auxiliaryFieldIds:[]}));
 rejects(()=>formInput({fields:[field],titleFieldId:field.id,auxiliaryFieldIds:[field.id]}));
 rejects(()=>ruleInput({mode:'max',maxWins:1.5}));
 rejects(()=>prizesInput([{id:randomUUID(),name:'奖项',total:1,batch:2,mode:'random'}]));
});

test('compact signup limits and ten-person rounds are enforced by the API',()=>{
 const f={id:randomUUID(),name:'部门',type:'text',required:false,hint:'',options:[]};
 rejects(()=>formInput({fields:Array.from({length:4},()=>({...f,id:randomUUID()})),titleFieldId:null,auxiliaryFieldIds:[]}));
 rejects(()=>formInput({fields:[{...f,name:'一二三四五六七八九'}],titleFieldId:null,auxiliaryFieldIds:[]}));
 rejects(()=>formInput({fields:[{...f,type:'multiple',options:[{id:randomUUID(),label:'一'}]}],titleFieldId:null,auxiliaryFieldIds:[]}));
 for(const batch of [5,6,10])assert.equal(prizesInput([{id:randomUUID(),name:'奖项',total:30,batch,mode:'random'}])[0].batch,batch);
 rejects(()=>prizesInput([{id:randomUUID(),name:'奖项',total:30,batch:11,mode:'random'}]));
});

test('prize themes default legacy data and reject unavailable renderers',()=>{
 const p={id:randomUUID(),name:'主题验收',total:1,batch:1,mode:'random'};
 assert.equal(prizesInput([p])[0].theme,'dream-planet');
 assert.equal(prizesInput([{...p,theme:'dream-planet'}])[0].theme,'dream-planet');
 assert.equal(prizesInput([{...p,theme:'starlight-matrix'}])[0].theme,'starlight-matrix');
 assert.equal(prizesInput([{...p,theme:'star-wave'}])[0].theme,'star-wave');
 assert.equal(prizesInput([{...p,theme:'starlight-corridor'}])[0].theme,'starlight-corridor');
 assert.equal(prizesInput([{...p,theme:'galaxy-waterfall'}])[0].theme,'galaxy-waterfall');
 rejects(()=>prizesInput([{...p,theme:'unavailable'}]));
});

test('numeric signup fields accept only integers and preserve large values and leading zeros',()=>{
 const field={id:randomUUID(),name:'数字',type:'number',required:false,hint:'',options:[]};
 const form=formInput({fields:[field],titleFieldId:null,auxiliaryFieldIds:[]});
 assert.deepEqual(validateAnswers(form,{}),{});
 for(const value of ['0','18','-2','+3','0018','9007199254740993'])assert.equal(validateAnswers(form,{[field.id]:value})[field.id],value);
 for(const value of ['abc','1e3','Infinity','NaN','12岁','1.2.3','1.25','.5','1.0','-0.5','+','--1'])rejects(()=>validateAnswers(form,{[field.id]:value}));
 rejects(()=>formInput({fields:[{...field,options:[{id:randomUUID(),label:'不应有选项'}]}],titleFieldId:null,auxiliaryFieldIds:[]}));
 rejects(()=>validateAnswers({...form,fields:[{...field,required:true}]},{}));
});

test('signup display is independent, supports all fields and rejects unknown or duplicate selections',()=>{
 const fields=['姓名','部门','电话'].map(name=>({id:randomUUID(),name,type:'text',required:false,hint:'',options:[]}));
 const input={fields,titleFieldId:fields[0].id,auxiliaryFieldIds:[fields[1].id],signupFieldIds:fields.map(f=>f.id)};
 assert.deepEqual(formInput(input).auxiliaryFieldIds,[]);
 assert.deepEqual(formInput(input).signupFieldIds,fields.map(f=>f.id));
 for(const ids of [[randomUUID()],[fields[0].id,fields[0].id],'bad'])rejects(()=>formInput({...input,signupFieldIds:ids}));
});
