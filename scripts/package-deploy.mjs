import {mkdir, readdir, readFile, writeFile, copyFile, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const root=fileURLToPath(new URL('../',import.meta.url));
const directories=['apps/api/src','apps/web/src','apps/web/stage','apps/web/public','packages/contracts/src','db/migrations'];
const files=['.dockerignore','package.json','package-lock.json','tsconfig.base.json',
  'apps/api/package.json','apps/api/tsconfig.json','apps/web/package.json','apps/web/tsconfig.json','apps/web/vite.config.ts',
  'apps/web/index.html','apps/web/join.html','apps/web/stage.html','packages/contracts/package.json',
  'scripts/account.mjs','scripts/check-production.mjs','scripts/lib/migrations.mjs',
  'deploy/container/Dockerfile','deploy/container/Caddyfile','deploy/container/runtime.mjs'];
const deployFiles=['install.sh','engine.sh','starlit.sh','compose.yaml'];
const documents=['docs/一键部署.md','docs/部署流程步骤.md','docs/2000人服务器测试.md','docs/部署包更新说明.md','docs/升级后清理.md'];
export function validateVersion(version){
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:-[a-z0-9]+(?:\.[a-z0-9]+)*)?$/.test(version))throw new Error('无效版本号；请显式指定 --version，例如 --version=1.0.0-rc.8');
  return version;
}
export async function inputFingerprint(){
  const inputs=new Set([...files,...documents,...deployFiles.map(file=>'deploy/container/'+file)]);
  for(const directory of [...directories,'scripts','tests'])for(const file of await walk(path.join(root,directory)))inputs.add(path.relative(root,file).split(path.sep).join('/'));
  const hash=createHash('sha256');
  for(const relative of [...inputs].sort())hash.update(relative+'\0'+await hashFile(path.join(root,relative))+'\n');
  return hash.digest('hex');
}
async function hashFile(file){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
export async function walk(directory){
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const full=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw new Error(`不允许符号链接：${entry.name}`);
    if(entry.isDirectory())result.push(...await walk(full));
    else if(entry.isFile())result.push(full);
    else throw new Error('不允许特殊文件');
  }
  return result.sort();
}
export async function manifest(directory){
  const lines=[];
  for(const file of await walk(directory)){
    const relative=path.relative(directory,file).split(path.sep).join('/');
    if(relative==='SHA256SUMS')continue;
    if(!/^[a-zA-Z0-9_./@+ -]+$/.test(relative))throw new Error(`无法加入校验清单的文件名：${relative}`);
    lines.push(`${await hashFile(file)}  ./${relative}`);
  }
  await writeFile(path.join(directory,'SHA256SUMS'),lines.join('\n')+'\n');
}
function run(command,args){
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});
  if(result.error||result.status!==0)throw new Error(`${command} 执行失败`);
}
export async function prepareBundle(outputParent,{version,includeImages=false}={}){
  validateVersion(version);
  const kind=includeImages?'images':'source';
  const directory=path.join(outputParent,`starlit-${version}-${kind}`);
  // Never overwrite an existing bundle: it could contain a live installation.
  await mkdir(directory,{recursive:false});
  const copy=async(relative,destination)=>{
    const source=path.join(root,relative);
    if(!(await lstat(source)).isFile())throw new Error(`只允许普通文件：${relative}`);
    await mkdir(path.dirname(destination),{recursive:true});
    if(relative.endsWith('.sh'))await writeFile(destination,(await readFile(source,'utf8')).replace(/\r\n/g,'\n'));
    else if(relative.startsWith('docs/'))await writeFile(destination,(await readFile(source,'utf8')).replaceAll('starlit-1.0.0-rc.2-images',`starlit-${version}-${kind}`));
    else await copyFile(source,destination);
  };
  for(const file of deployFiles)await copy(`deploy/container/${file}`,path.join(directory,file));
  await copy('docs/一键部署.md',path.join(directory,'README.md'));
  await copy('docs/部署流程步骤.md',path.join(directory,'INSTALLATION.md'));
  await copy('docs/2000人服务器测试.md',path.join(directory,'TESTING.md'));
  await copy('docs/部署包更新说明.md',path.join(directory,'RELEASE_NOTES.md'));
  await copy('docs/升级后清理.md',path.join(directory,'CLEANUP.md'));
  const sourceFiles=[...files];
  for(const sub of directories)for(const full of await walk(path.join(root,sub)))sourceFiles.push(path.relative(root,full));
  for(const file of sourceFiles){
    if(file.split(/[\\/]/).some(part=>part.startsWith('.env')||['node_modules','build','.git','.local','artifacts'].includes(part)))throw new Error('源码包混入运行环境文件');
    await copy(file,path.join(directory,'source',file));
  }
  // A reset release number must not reuse an older server's cached image tag.
  const sourceDigest=createHash('sha256');
  for(const file of await walk(path.join(directory,'source'))){
    sourceDigest.update(path.relative(path.join(directory,'source'),file).split(path.sep).join('/')+'\0'+await hashFile(file)+'\n');
  }
  const imageTag=version+'-'+sourceDigest.digest('hex').slice(0,12);
  await writeFile(path.join(directory,'release.env'),`RELEASE_VERSION=${version}\nBUNDLE_KIND=${kind}\nAPP_IMAGE=starlit-app:${imageTag}\nGATEWAY_IMAGE=starlit-gateway:${imageTag}\n`);
  if(includeImages){
    run('docker',['info']);
    for(const target of ['app','gateway'])run('docker',['build','--platform','linux/amd64','--target',target,'-t',`starlit-${target}:${imageTag}`,'-f',path.join(directory,'source/deploy/container/Dockerfile'),path.join(directory,'source')]);
    run('docker',['pull','--platform','linux/amd64','public.ecr.aws/docker/library/postgres:18.6-bookworm']);
    for(const image of [`starlit-app:${imageTag}`,`starlit-gateway:${imageTag}`,'public.ecr.aws/docker/library/postgres:18.6-bookworm']){
      const check=spawnSync('docker',['image','inspect','--format','{{.Os}}/{{.Architecture}}',image],{encoding:'utf8'});
      if(check.status!==0||check.stdout.trim()!=='linux/amd64')throw new Error('镜像架构错误');
    }
    run('docker',['save','-o',path.join(directory,'images.tar'),`starlit-app:${imageTag}`,`starlit-gateway:${imageTag}`,'public.ecr.aws/docker/library/postgres:18.6-bookworm']);
  }
  await manifest(directory);
  return directory;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  // Keep the old CLI entrypoint, but never bypass the release gate.
  // Use a child process: importing release here would form a top-level-await cycle.
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./release.mjs',import.meta.url)),...process.argv.slice(2)],{cwd:root,stdio:'inherit',windowsHide:true});
  if(result.error)console.error(result.error.message);
  process.exitCode=result.status??1;
}
