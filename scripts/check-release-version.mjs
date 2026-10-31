import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateVersion} from './package-deploy.mjs';
export async function checkReleaseVersion({repository,version,sha,token,fetcher=fetch}){
 validateVersion(version);
 if(!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repository??'')||!/^[a-f0-9]{40}$/i.test(sha??'')||!token)throw new Error('发布环境缺少有效仓库、提交或认证信息');
 const base='https://api.github.com/repos/'+repository,tag=encodeURIComponent('v'+version);
 async function read(endpoint){
  const response=await fetcher(base+endpoint,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(20000)});
  if(response.status===404)return null;
  if(!response.ok)throw new Error('GitHub 版本检查失败：HTTP '+response.status);
  return response.json();
 }
 if(await read('/releases/tags/'+tag))throw new Error('此版本已发布，请使用新版本号');
 const ref=await read('/git/ref/tags/'+tag);
 if(ref&&ref.object?.sha!==sha)throw new Error('现有版本标签指向其他提交，不能覆盖');
 return {tag:'v'+version,sha};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 checkReleaseVersion({repository:process.env.GITHUB_REPOSITORY,version:process.env.RELEASE_VERSION,sha:process.env.GITHUB_SHA,token:process.env.GH_TOKEN}).then(result=>console.info('版本检查通过：'+result.tag)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
