import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import readiness from '../apps/api/build/activities/wechat-readiness.js';
const {checkVerificationFile,verificationFiles,verificationFile,verificationOrigin}=readiness;

test('domain verification checks exact public file bytes and rejects unsafe or unusable responses',async()=>{
 await mkdir('artifacts',{recursive:true});
 const dir=await mkdtemp(path.resolve('artifacts/wechat-file-test-'));
 const old={...process.env};
 process.env.WECHAT_VERIFICATION_DIRECTORY=dir;
 process.env.APP_ORIGIN='https://lottery.example.test';
 process.env.WECHAT_OAUTH_PROVIDER='wechat';
 const name='MP_verify_Example123.txt',content='ExampleVerificationToken123\n';
 try{
  await writeFile(path.join(dir,name),content);
  await writeFile(path.join(dir,'private.env'),'never-read');
  assert.deepEqual(await verificationFiles(),[name]);
  let calls=0;
  const result=await checkVerificationFile(name,async(url,options)=>{
   calls++;assert.equal(url,'https://lottery.example.test/'+name);assert.equal(options.redirect,'error');assert.ok(options.signal);return new Response(content);
  });
  assert.equal(result.hash,(await verificationFile(name)).hash);assert.equal(calls,1);
  for(const filename of ['../private.env','MP_verify_a.txt/../../private.env','https://other.test/file',name+'?x']){
   await assert.rejects(checkVerificationFile(filename,async()=>{throw new Error('must not fetch');}),e=>e.getResponse().code==='INVALID_VERIFICATION_FILE');
  }
  for(const response of [new Response('<html>fallback</html>'),new Response(content,{status:404}),new Response('a'.repeat(5000)),new Response('WrongToken123')]){
   await assert.rejects(checkVerificationFile(name,async()=>response),e=>e.getResponse().code==='VERIFICATION_FILE_UNREACHABLE');
  }
  await assert.rejects(checkVerificationFile(name,async()=>{throw new Error('TLS failed');}),e=>e.getResponse().code==='VERIFICATION_FILE_UNREACHABLE');
  await writeFile(path.join(dir,name),'<html>not a token</html>');
  await assert.rejects(verificationFile(name),e=>e.getResponse().code==='VERIFICATION_FILE_UNAVAILABLE');
  for(const origin of ['http://example.test','https://example.test/path','https://user:pass@example.test','https://example.test/?query']){
   process.env.APP_ORIGIN=origin;assert.equal(verificationOrigin(),null);
  }
  process.env.APP_ORIGIN='https://lottery.example.test';process.env.WECHAT_OAUTH_PROVIDER='mock';assert.equal(verificationOrigin(),null);
 }finally{for(const key of ['WECHAT_VERIFICATION_DIRECTORY','APP_ORIGIN','WECHAT_OAUTH_PROVIDER']){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});
