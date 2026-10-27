import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRelease} from '../scripts/lib/release-gate.mjs';
import {validateVersion} from '../scripts/package-deploy.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const steps=[['first',['node','one']],['second',['node','two']]];
test('release gate stops at the failing check and cannot return successful evidence',async()=>{
 const calls=[];
 await assert.rejects(verifyRelease({steps,fingerprint:async()=>'abc',run:async(_,name)=>{calls.push(name);throw new Error('failed');}}),/failed/);
 assert.deepEqual(calls,['first']);
});
test('release gate rejects changed inputs and records only the tested fingerprint',async()=>{
 let reads=0;
 await assert.rejects(verifyRelease({steps,fingerprint:async()=>++reads===1?'before':'after',run:async()=>{}}),/发生变化/);
 const result=await verifyRelease({steps,fingerprint:async()=>'stable',run:async()=>{}});
 assert.equal(result.sourceFingerprint,'stable');assert.equal(result.checks.length,2);assert.ok(result.checks.every(c=>c.passed));
});
test('publishing requires an explicit safe version',()=>{
 for(const version of [undefined,'','../escape','1.0.0;bad','v1.0.0'])assert.throws(()=>validateVersion(version),/版本号/);
 assert.equal(validateVersion('1.0.0-rc.8'),'1.0.0-rc.8');
});
test('legacy packaging CLI reaches the gate without an async import deadlock',()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/package-deploy.mjs',import.meta.url)),'--version=invalid'],{encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,/无效版本号/);
});

test('paired packaging cannot be combined with check-only or image-only options',()=>{
 for(const args of [['--both','--check'],['--both','--images','--version=1.0.0-rc.3']]){
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/release.mjs',import.meta.url)),...args],{encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,/用法/);
 }
});
