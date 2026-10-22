import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(path.resolve('artifacts/client-retries-'));
for(const name of ['api','sessionRotation']){
 const source=await readFile('apps/web/src/'+name+'.ts','utf8');
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("'./sessionRotation'","'./sessionRotation.mjs'");
 await writeFile(path.join(dir,name+'.mjs'),output);
}
const api=await import(pathToFileURL(path.join(dir,'api.mjs')).href);
const original=globalThis.fetch;
const ok=data=>new Response(JSON.stringify({data}),{status:200});
let checks=0;
try{
 for(const kind of ['auth','business'])for(const fault of ['offline','invalid-json','server-error','validation']){
  const keys=[];let attempts=0;
  globalThis.fetch=async(url,options)=>{
   if(String(url).endsWith('/csrf'))return ok({csrfToken:'test-token'});
   keys.push(options.headers['Idempotency-Key']);attempts++;
   if(attempts===1){
    if(fault==='offline')throw new TypeError('offline');
    if(fault==='invalid-json')return new Response('interrupted-json',{status:200});
    return new Response(JSON.stringify({error:{code:fault==='validation'?'INVALID_INPUT':'UNAVAILABLE',message:'test'}}),{status:fault==='validation'?422:503});
   }
   return ok({saved:true});
  };
  const body={account:'test_owner',password:'Test-password-'+kind+fault};
  const send=()=>kind==='auth'?api.post('login',body):api.write('/api/v1/activities','POST',body);
  await assert.rejects(send());await send();
  if(fault==='validation')assert.notEqual(keys[0],keys[1]);else assert.equal(keys[0],keys[1]);
  await send();assert.notEqual(keys[1],keys[2]);
  console.info('PASS '+kind+' '+fault);checks++;
 }
}finally{globalThis.fetch=original;}
console.info('Client retry verification complete: '+checks+' checks.');
