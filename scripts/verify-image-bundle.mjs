import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const bundle=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('Provide the prepared image bundle directory');
const root=process.cwd();await mkdir(path.join(root,'artifacts'),{recursive:true});
const fixture=await mkdtemp(path.join(root,'artifacts/image-smoke-'));
const run=(args,input)=>{
 const result=spawnSync('docker',args,{cwd:fixture,encoding:'utf8',input,timeout:240000,maxBuffer:8*1024*1024});
 if(result.error||result.status!==0)throw Error('Docker smoke check failed: '+args.slice(0,3).join(' ')+'\n'+result.stdout+'\n'+result.stderr);
 return result.stdout.trim();
};
const release=Object.fromEntries((await readFile(path.join(bundle,'release.env'),'utf8')).trim().split(/\r?\n/).map(x=>x.split('=')));
assert.equal(release.BUNDLE_KIND,'images');
// Test the actual exported archive, not just the build cache.
run(['load','-i',path.join(bundle,'images.tar')]);
const project='starlit_smoke_'+randomBytes(6).toString('hex');
const password=randomBytes(24).toString('hex');
const spec=JSON.parse(await readFile(path.join(bundle,'compose.yaml'),'utf8'));spec.name=project;
for(const service of Object.values(spec.services)){
 if(service.image==='${APP_IMAGE:?release.env missing}')service.image=release.APP_IMAGE;
 if(service.image==='${GATEWAY_IMAGE:?release.env missing}')service.image=release.GATEWAY_IMAGE;
}
spec.services.api.ports=['127.0.0.1::80'];
await mkdir(path.join(fixture,'config'));
for(const name of ['postgres','uploads','verification','caddy','caddy-config'])await mkdir(path.join(fixture,'data',name),{recursive:true});
// Match install.sh ownership and permissions; native portrait generation must
// work as the production node user, without a world-writable upload directory.
run(['run','--rm','--network','none','--user','0','--mount',`type=bind,src=${path.join(fixture,'data/uploads')},dst=/uploads`,release.APP_IMAGE,'node','-e',"const fs=require('node:fs');fs.chownSync('/uploads',1000,1000);fs.chmodSync('/uploads',0o750)"]);
await writeFile(path.join(fixture,'config/database.env'),`POSTGRES_USER=starlit\nPOSTGRES_PASSWORD=${password}\nPOSTGRES_DB=starlit\n`,{mode:0o600});
await writeFile(path.join(fixture,'config/app.env'),`NODE_ENV=production\nAPI_HOST=127.0.0.1\nAPI_PORT=3000\nTRUST_PROXY=loopback\nAPP_ORIGIN=https://smoke.starlit.invalid\nDATABASE_URL=postgresql://starlit:${password}@db:5432/starlit\nAUTH_SECRET=${randomBytes(48).toString('hex')}\nWECHAT_MASTER_KEY=${randomBytes(32).toString('hex')}\nASSET_DIRECTORY=/var/lib/starlit/uploads\nWECHAT_VERIFICATION_DIRECTORY=/var/lib/starlit/verification\nWECHAT_OAUTH_PROVIDER=disabled\n`,{mode:0o600});
// The isolated smoke test uses HTTP locally; public DNS/TLS/WeChat need deployment-time validation.
await writeFile(path.join(fixture,'config/gateway.env'),'APP_DOMAIN=http://127.0.0.1\n');
await writeFile(path.join(fixture,'data/verification/MP_verify_Smoke.txt'),'smoke-verification');
await writeFile(path.join(fixture,'compose.json'),JSON.stringify(spec));
const dc=(args,input)=>run(['compose','-f','compose.json',...args],input);
try{
 dc(['up','-d','--pull','never','--wait','--wait-timeout','150','db']);
 dc(['run','--rm','--no-deps','-T','migrate']);
 dc(['run','--rm','--no-deps','-T','api','node','scripts/account.mjs','init','--stdin-json'],JSON.stringify({account:'image_smoke',password:randomBytes(24).toString('hex')}));
 assert.equal(dc(['run','--rm','--no-deps','-T','api','node','deploy/container/runtime.mjs','has-account']),'yes');
 dc(['up','-d','--no-deps','--pull','never','--wait','--wait-timeout','180','api','gateway']);
 const address=dc(['port','api','80']);
 for(const route of ['/','/join.html','/stage.html','/MP_verify_Smoke.txt']){
  const response=await fetch('http://'+address+route,{signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,route);const text=await response.text();
  if(route.endsWith('.txt'))assert.equal(text,'smoke-verification');else assert.match(text,/<html/i);
 }
 dc(['exec','-T','api','node','-e',"fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]);
 const portraitUrl='http://'+address+'/demo-avatars/portraits-v1/';
 assert.equal((await fetch(portraitUrl+'1.webp',{signal:AbortSignal.timeout(15000)})).status,404);
 dc(['exec','-T','api','node','-e',"const {SimulationPortraitStore}=require('./apps/api/build/activities/simulation-portrait-store.js');const store=new SimulationPortraitStore(process.env.ASSET_DIRECTORY+'/simulation/portraits-v1');Promise.all([store.ensure(1),store.ensure(2)]).then(()=>store.close()).catch(e=>{console.error(e);process.exitCode=1})"]);
 const portraits=[];
 for(const id of [1,2]){
  const response=await fetch(portraitUrl+id+'.webp',{signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^image\/webp/);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.toString('ascii',8,12),'WEBP');portraits.push(bytes);
 }
 assert.notDeepEqual(portraits[0],portraits[1]);
 dc(['restart','db']);dc(['up','-d','--pull','never','--wait','--wait-timeout','150','db']);
 assert.equal(dc(['run','--rm','--no-deps','-T','api','node','deploy/container/runtime.mjs','has-account']),'yes');
 const report={passed:true,platform:'linux/amd64',archiveImported:true,migrations:true,accountInitialization:true,apiHealth:true,threeFrontendEntrypoints:true,verificationFile:true,onDemandPortraitGeneration:true,portraitUploadPermissions:true,portraitGatewayRouting:true,databaseRestartPersistence:true,publicTlsAndWechat:false};
 await writeFile(path.join(root,'artifacts/image-smoke.json'),JSON.stringify(report,null,2)+'\n');
 console.info('PASS exported images: database, migration, account, API, gateway, verification file, on-demand portraits and restart persistence');
}finally{dc(['down','--volumes','--remove-orphans']);}
