import test from 'node:test';
import assert from 'node:assert/strict';
import security from '../apps/api/build/auth/security.js';
const {phone,password,account,loginInput,fields,issueCsrf,validateWrite,equal,mac}=security;
process.env.AUTH_SECRET='a'.repeat(96);
process.env.NODE_ENV='development';
process.env.APP_ORIGIN='http://127.0.0.1:5173';
const rejects422=fn=>assert.throws(fn,e=>e.getStatus()===422);
test('phone normalization rejects objects and unexpected characters',()=>{
  assert.equal(phone('13800000001'),'+8613800000001'); assert.equal(phone('+8613800000001'),phone('13800000001'));
  for(const value of [null,{},'ab','a'.repeat(33),'user name','管理员']) rejects422(()=>phone(value));
});
test('password limits never silently truncate input',()=>{
  assert.equal(password('a'.repeat(128)).length,128);
  rejects422(()=>password('123456789'));rejects422(()=>password('a'.repeat(129)));
});
test('login names normalize consistently and reject malformed identities',()=>{
  assert.equal(account(' Owner.Name-01 '),'owner.name-01');
  assert.equal(account('+8613800000001'),'13800000001');
  for(const value of [null,{},'abc','a'.repeat(33),'user name','管理员','.name','-name'])rejects422(()=>account(value));
  assert.equal(loginInput({account:'OWNER',password:'long-password'}).account,'owner');
  assert.equal(loginInput({phone:'+8613800000001',password:'long-password'}).account,'13800000001');
  rejects422(()=>loginInput({account:'owner',phone:'13800000001',password:'long-password'}));
  rejects422(()=>loginInput({account:'owner',password:{length:12}}));
});
test('public request fields reject role and owner injection',()=>{
  rejects422(()=>fields({account:'user',role:'platform_admin'},['account']));
  rejects422(()=>fields({account:'user',owner_id:'someone'},['account']));
  rejects422(()=>fields([],[]));
});
test('CSRF is reused across tabs, but tampering, expiry and wrong origin fail',()=>{
  const res={cookie(){}};
  const csrf=issueCsrf(res);
  const req={headers:{origin:process.env.APP_ORIGIN,cookie:'starlit_csrf='+csrf},is:()=>true,get:name=>name==='x-csrf-token'?csrf:'00000000-0000-4000-8000-000000000000'};
  assert.equal(issueCsrf(res,req),csrf);
  assert.equal(typeof validateWrite(req),'string');
  assert.throws(()=>validateWrite({...req,headers:{...req.headers,origin:'https://evil.test'}}),e=>e.getStatus()===403);
  assert.throws(()=>validateWrite({...req,get:name=>name==='x-csrf-token'?csrf+'a':req.get(name)}),e=>e.getStatus()===403);
  const value='a'.repeat(64)+'.'+(Date.now()-1), expired=value+'.'+mac('csrf:'+value);
  assert.throws(()=>validateWrite({...req,headers:{...req.headers,cookie:'starlit_csrf='+expired},get:name=>name==='x-csrf-token'?expired:req.get(name)}),e=>e.getStatus()===403);
});
test('constant-time comparison safely handles non-ASCII input',()=>{
  assert.equal(equal('é','a'),false);
  assert.equal(equal('same','same'),true);
});
