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

import {checkReleaseVersion} from '../scripts/check-release-version.mjs';
test('new releases accept missing tags, reject conflicts and fail closed on API errors',async()=>{
 const sha='a'.repeat(40),options={repository:'owner/repo',version:'1.0.0-rc.3',sha,token:'fixture'};
 const response=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body});
 const missing=()=>response(404,{message:'Not Found'});
 assert.deepEqual(await checkReleaseVersion({...options,fetcher:async()=>missing()}),{tag:'v1.0.0-rc.3',sha});
 assert.deepEqual(await checkReleaseVersion({...options,fetcher:async url=>url.includes('/git/ref/')?response(200,{object:{sha}}):missing()}),{tag:'v1.0.0-rc.3',sha});
 await assert.rejects(checkReleaseVersion({...options,fetcher:async url=>url.includes('/git/ref/')?response(200,{object:{sha:'b'.repeat(40)}}):missing()}),/其他提交/);
 await assert.rejects(checkReleaseVersion({...options,fetcher:async()=>response(200,{tag_name:'v1.0.0-rc.3'})}),/已发布/);
 for(const status of [401,403,429,500])await assert.rejects(checkReleaseVersion({...options,fetcher:async()=>response(status,{message:'error'})}),new RegExp('HTTP '+status));
});


test('release image mirror keeps pinned versions, amd64 and the installed database reference',async()=>{
 const {imageBuildPlan}=await import('../scripts/package-deploy.mjs');
 const options={imageTag:'1.0.0-rc.3-test',dockerfile:'Dockerfile',context:'source'};
 const defaults=imageBuildPlan(options),mirror=imageBuildPlan({...options,registry:'docker.io/library'});
 assert.equal(defaults.length,3);assert.equal(mirror.length,4);
 for(const commands of [defaults,mirror])for(const command of commands.slice(0,3))assert.deepEqual(command.slice(command.indexOf('--platform'),command.indexOf('--platform')+2),['--platform','linux/amd64']);
 for(const build of mirror.slice(0,2)){
  assert(build.includes('NODE_IMAGE=docker.io/library/node:24.14.1-bookworm-slim'));
  assert(build.includes('CADDY_IMAGE=docker.io/library/caddy:2.11.7-alpine'));
 }
 assert.deepEqual(mirror[2],['pull','--platform','linux/amd64','docker.io/library/postgres:18.6-bookworm']);
 assert.deepEqual(mirror[3],['tag','docker.io/library/postgres:18.6-bookworm',defaults[2].at(-1)]);
 assert.throws(()=>imageBuildPlan({...options,registry:'untrusted.example'}));
});
