import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);const {DrawService}=require('../apps/api/build/activities/draw.service.js');
test('draw uses signup-time options for historical participant answers',async()=>{
 const roundId=randomUUID(),rootId=randomUUID(),personId=randomUUID(),fieldId=randomUUID();let saved;
 const oldField={id:fieldId,name:'部门',type:'select',options:[{id:'sales',label:'市场部'}]};
 const currentForm={fields:[{...oldField,options:[{id:'sales',label:'新部门名称'}]}],titleFieldId:fieldId,auxiliaryFieldIds:[fieldId]};
 const c={query:async(sql,args)=>{
  if(sql.startsWith('SELECT * FROM draw_rounds'))return {rows:[{id:roundId,status:'drawing',root_round_id:rootId,draw_count:1,candidates:[personId],snapshot:{prize:{id:randomUUID(),name:'一等奖',mode:'random'},form:currentForm},replacements:[]}]};
  if(sql.includes('FROM activity_participants'))return {rows:[{id:personId,nickname:'微信昵称',eligible:true,answers:{[fieldId]:'sales'},signup_form:{fields:[oldField]}}]};
  if(sql.startsWith('INSERT INTO draw_awards'))saved=JSON.parse(args[6]);
  if(sql.startsWith('SELECT expires_at'))return {rows:[{active:true}]};
  return {rows:[]};
 }};
 await new DrawService(null,null).stop(c,{id:randomUUID()},{id:randomUUID(),generation:1,active_root_id:rootId},{roundId});
 assert.equal(saved.title,'市场部');assert.deepEqual(saved.auxiliary,[]);
});

test('signup success resolves saved labels, preserves order and hides empty or missing answers',()=>{
 const {signupDisplay}=require('../apps/api/build/activities/signup-display.js');
 const saved={fields:[{id:'name',name:'姓名',type:'text',options:[]},{id:'dept',name:'部门',type:'single',options:[{id:'a',label:'原部门'}]},{id:'empty',name:'备注',type:'text',options:[]}]};
 const form={fields:[],signupFieldIds:['dept','name','empty','missing']};
 assert.deepEqual(signupDisplay(form,saved,{name:'张三',dept:'a',empty:' '}),[{id:'dept',label:'部门',value:'原部门'},{id:'name',label:'姓名',value:'张三'}]);
 assert.deepEqual(signupDisplay({...form,signupFieldIds:[]},saved,{name:'张三'}),[]);
});
