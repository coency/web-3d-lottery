import {mkdir,mkdtemp,readFile,writeFile,open,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {root,prepareBundle,manifest,inputFingerprint,validateVersion} from './package-deploy.mjs';
import {verifyRelease} from './lib/release-gate.mjs';

function execute(command,name){
 console.info('\n[release] '+name);
 let [program,...args]=command;
 if(program==='node')program=process.execPath;
 if(program==='npm'){
  // Avoid shell quoting and npm.cmd on Windows.
  const cli=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  program=process.execPath;args=[cli,...args];
 }
 return new Promise((resolve,reject)=>{
  const child=spawn(program,args,{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,DRAW_RULES_ONLY:'0',DRAW_RECORDS_ONLY:'0'}});
  child.once('error',reject);
  child.once('exit',(code,signal)=>code===0?resolve():reject(new Error(name+' 未通过（'+(signal||code)+'），发布已停止。')));
 });
}
export async function release(args){
 const checkOnly=args.includes('--check'),includeImages=args.includes('--images');
 const versions=args.filter(a=>a.startsWith('--version='));
 if(args.some(a=>a!=='--check'&&a!=='--images'&&!a.startsWith('--version='))||versions.length>1||checkOnly&&(versions.length||includeImages))throw new Error('用法：npm run release:check，或 npm run package:deploy -- --version=1.0.0-rc.8 [--images]');
 const version=checkOnly?null:validateVersion(versions[0]?.slice(10));
 const parent=path.join(root,'artifacts');await mkdir(parent,{recursive:true});
 // Serialize publication and prevent accidentally reusing a release identity.
 const lockPath=path.join(parent,'.release.lock');
 const lock=await open(lockPath,'wx').catch(()=>{throw new Error('已有发布验收正在运行，或上次被中断。请确认旧进程已结束后处理 artifacts/.release.lock。');});
 let work;
 try{
  const registry=path.join(parent,'releases');await mkdir(registry,{recursive:true});
  const record=version?path.join(registry,version+'.json'):null;
  if(record){try{await readFile(record);throw new Error('此版本已发布，请使用新的版本号。');}catch(e){if(e.code!=='ENOENT')throw e;}}
  // Also recognize archives created before the release registry was introduced.
  if(version)for(const entry of await readdir(parent,{withFileTypes:true})){
   if(entry.isDirectory()&&entry.name.startsWith('deploy-')){
    const names=await readdir(path.join(parent,entry.name));
    if(names.some(name=>name===`starlit-${version}-source.tar.gz`||name===`starlit-${version}-images.tar.gz`))throw new Error('已存在此版本的部署包，请使用新的版本号。');
   }
  }
  work=await mkdtemp(path.join(parent,'release-check-'));
  console.info('[release] 正在计算源码和测试输入指纹…');
  const evidence=await verifyRelease({fingerprint:inputFingerprint,run:execute});
  await writeFile(path.join(work,'verification.json'),JSON.stringify(evidence,null,2)+'\n');
  if(checkOnly){console.info('\n验收通过：'+path.join(work,'verification.json'));return;}
  const staging=await mkdtemp(path.join(parent,'deploy-'));
  const directory=await prepareBundle(staging,{version,includeImages});
  if(await inputFingerprint()!==evidence.sourceFingerprint)throw new Error('打包期间源码发生变化，未生成部署压缩包。请重新验收。');
  const sourceManifest=await readFile(path.join(directory,'SHA256SUMS'));
  const info={version,builtAt:new Date().toISOString(),bundleFingerprint:createHash('sha256').update(sourceManifest).digest('hex'),...evidence};
  await writeFile(path.join(directory,'RELEASE.json'),JSON.stringify(info,null,2)+'\n');
  await manifest(directory);
  const archive=directory+'.tar.gz';
  await execute(['tar','-czf',archive,'-C',staging,path.basename(directory)],'archive');
  const digest=createHash('sha256');for await(const chunk of createReadStream(archive))digest.update(chunk);const hash=digest.digest('hex');
  await writeFile(archive+'.sha256',hash+'  '+path.basename(archive)+'\n');
  await writeFile(record,JSON.stringify({...info,archive,sha256:hash},null,2)+'\n',{flag:'wx'});
  console.info('\n部署包：'+archive+'\n验收记录：'+path.join(directory,'RELEASE.json')+'\n尚未部署到服务器；服务器启动和 HTTPS 需现场确认。');
 }catch(error){
  if(work)await writeFile(path.join(work,'FAILED.txt'),error.message+'\n');
  throw error;
 }finally{
  await lock.close();
  const {unlink}=await import('node:fs/promises');await unlink(lockPath);
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await release(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
