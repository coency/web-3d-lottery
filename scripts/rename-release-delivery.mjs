import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {validateVersion} from './package-deploy.mjs';

// Same-version renaming is deliberately separate from normal, immutable releases.
export function deliveryNames(version,renamed=false){
 validateVersion(version);
 const docker=`starlit-${version}-${renamed?'docker':'images'}.tar.gz`,source=`starlit-${version}-source.tar.gz`;
 return [docker,docker+'.sha256',source,source+'.sha256',(renamed?'DOCKER':'IMAGES')+'_INSTALLATION.md','SOURCE_INSTALLATION.md'];
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function renameDelivery(action){
 const {GITHUB_REPOSITORY:repository,RELEASE_VERSION:version,GH_TOKEN:token,GITHUB_SHA:sha,GITHUB_RUN_ID:runId}=process.env;
 validateVersion(version);assert(/^[\w.-]+\/[\w.-]+$/.test(repository));assert(/^[a-f0-9]{40}$/.test(sha));assert(/^\d+$/.test(runId));assert(token);
 const base=`https://api.github.com/repos/${repository}`,headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 const beforeDir='artifacts/delivery-before',afterDir='artifacts/delivery-renamed';
 async function api(p,method='GET',body){
  const r=await fetch(base+p,{method,headers:{...headers,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error(`${method} ${p}: HTTP ${r.status}`);return r.status===204?null:r.json();
 }
 const snapshot=r=>r.assets.map(a=>[a.id,a.name,a.digest,a.size]).sort((a,b)=>a[0]-b[0]);
 const release=await api('/releases/tags/v'+version),tag=await api('/git/ref/tags/v'+version);
 assert(!release.immutable&&!release.draft,'Release is immutable or draft');
 if(action==='prepare'){
  assert.deepEqual(release.assets.map(a=>a.name).sort(),deliveryNames(version).sort(),'Only the original six images/source attachments may be renamed');
  await mkdir('artifacts',{recursive:true});
  await mkdir(beforeDir,{recursive:false});
  await writeFile(beforeDir+'/release.json',JSON.stringify(release,null,2));await writeFile(beforeDir+'/tag.json',JSON.stringify(tag,null,2));
  // gh downloads only this release's six public deployment files, never business data.
  execFileSync('gh',['release','download','v'+version,'--repo',repository,'--dir',beforeDir],{stdio:'inherit'});
  for(const a of release.assets){const bytes=await readFile(beforeDir+'/'+a.name);assert.equal(bytes.length,a.size);assert.equal('sha256:'+hash(bytes),a.digest);}
  console.info('Original six attachments downloaded and verified for backup.');return;
 }
 assert.equal(action,'publish');
 const before=JSON.parse(await readFile(beforeDir+'/release.json','utf8')),oldTag=JSON.parse(await readFile(beforeDir+'/tag.json','utf8'));
 assert.equal(release.id,before.id);assert.equal(release.body,before.body);assert.deepEqual(snapshot(release),snapshot(before));assert.deepEqual(tag.object,oldTag.object);
 const imageRecord=JSON.parse(await readFile(`artifacts/releases/${version}.json`)),sourceRecord=JSON.parse(await readFile(`artifacts/releases/${version}-source.json`));
 assert.equal(imageRecord.kind,'images');assert.equal(sourceRecord.kind,'source');
 for(const r of [imageRecord,sourceRecord]){assert.equal(r.version,version);assert.equal(r.checks.length,13);assert(r.checks.every(c=>c.passed));assert.equal(r.imageVerification.passed,true);assert.equal(hash(await readFile(r.archive)),r.sha256);}
 assert.equal(imageRecord.sourceFingerprint,sourceRecord.sourceFingerprint);
 const sourceBundle=sourceRecord.archive.replace(/\.tar\.gz$/,''),imageBundle=imageRecord.archive.replace(/\.tar\.gz$/,'');
 assert.equal(path.basename(imageBundle),`starlit-${version}-docker`);
 const oldSource='artifacts/previous-source';await mkdir(oldSource,{recursive:false});
 execFileSync('tar',['-xzf',`${beforeDir}/starlit-${version}-source.tar.gz`,'-C',oldSource]);
 const previous=path.join(oldSource,`starlit-${version}-source`);
 // A packaging rename must never silently introduce changed application code or images.
 execFileSync('diff',['-qr',path.join(previous,'source'),path.join(sourceBundle,'source')],{stdio:'inherit'});
 assert((await readFile(path.join(previous,'release.env'))).equals(await readFile(path.join(sourceBundle,'release.env'))));
 const oldImagesEnv=execFileSync('tar',['-xOzf',`${beforeDir}/starlit-${version}-images.tar.gz`,`starlit-${version}-images/release.env`]);
 assert(oldImagesEnv.equals(await readFile(path.join(imageBundle,'release.env'))));
 await mkdir(afterDir,{recursive:false});
 for(const record of [imageRecord,sourceRecord])for(const f of [record.archive,record.archive+'.sha256'])await writeFile(path.join(afterDir,path.basename(f)),await readFile(f));
 await writeFile(afterDir+'/DOCKER_INSTALLATION.md',await readFile(imageBundle+'/INSTALLATION.md'));
 await writeFile(afterDir+'/SOURCE_INSTALLATION.md',await readFile(sourceBundle+'/INSTALLATION.md'));
 assert.deepEqual((await readdir(afterDir)).sort(),deliveryNames(version,true).sort());
 const oldArchive=`starlit-${version}-images.tar.gz`,newArchive=`starlit-${version}-docker.tar.gz`;
 let body=before.body.replaceAll(oldArchive,newArchive).replaceAll('IMAGES_INSTALLATION.md','DOCKER_INSTALLATION.md');
 for(const [oldName,record] of [[oldArchive,imageRecord],[`starlit-${version}-source.tar.gz`,sourceRecord]])body=body.replaceAll(before.assets.find(a=>a.name===oldName).digest.slice(7),record.sha256);
 body+=`\n\n安装包命名更新：镜像压缩包和解压目录统一使用 docker，安装说明改为 DOCKER_INSTALLATION.md。重新打包后的 SHA256 已更新，请重新下载对应校验文件。应用源码和镜像标识与原版完全一致，版本标签保持不变；打包与维护脚本对应提交 [${sha.slice(0,7)}](https://github.com/${repository}/commit/${sha})。已有 images 目录中的网站继续使用原目录，不需为改名重新安装或同版本升级。\n`;
 const staged=[];const renamedOld=[];let promoted=false;
 try{
  for(const name of deliveryNames(version,true)){
   const bytes=await readFile(afterDir+'/'+name),url=before.upload_url.split('{')[0]+'?name='+encodeURIComponent(name+'.pending-'+runId);
   const r=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(300000)});if(!r.ok)throw Error('Upload '+name+': HTTP '+r.status);
   const a=await r.json();staged.push({...a,finalName:name});assert.equal(a.digest,'sha256:'+hash(bytes));assert.equal(a.size,bytes.length);
  }
  // Stage every replacement before changing any existing download name.
  for(const a of before.assets){await api('/releases/assets/'+a.id,'PATCH',{name:a.name+'.previous-'+runId});renamedOld.push(a);}
  for(const a of staged)await api('/releases/assets/'+a.id,'PATCH',{name:a.finalName});
  await api('/releases/'+release.id,'PATCH',{body});
  const check=await api('/releases/'+release.id);
  for(const a of staged)assert(check.assets.some(b=>b.id===a.id&&b.name===a.finalName&&b.digest===a.digest));
  assert.deepEqual((await api('/git/ref/tags/v'+version)).object,oldTag.object);
  promoted=true;
 }catch(error){
  // Original files still exist remotely; undo names if promotion did not complete.
  for(const a of staged)await api('/releases/assets/'+a.id,'DELETE').catch(()=>{});
  for(const a of renamedOld)await api('/releases/assets/'+a.id,'PATCH',{name:a.name}).catch(()=>{});
  await api('/releases/'+release.id,'PATCH',{body:before.body}).catch(()=>{});
  throw error;
 }
 if(promoted)for(const a of before.assets)await api('/releases/assets/'+a.id,'DELETE');
 const after=await api('/releases/'+release.id);assert.deepEqual(after.assets.map(a=>a.name).sort(),deliveryNames(version,true).sort());
 await writeFile(afterDir+'/release.json',JSON.stringify(after,null,2));
 console.info('Renamed deployment delivery published; original tag and application source unchanged.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await renameDelivery(process.argv[2]);
