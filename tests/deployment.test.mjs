import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,readdir,cp,symlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {root,prepareBundle,manifest,walk} from '../scripts/package-deploy.mjs';

const bash=process.platform==='win32'?'D:/Program Files/Git/bin/bash.exe':'bash';
const posix=file=>process.platform==='win32'?file.replaceAll('\\','/').replace(/^([A-Z]):/i,(_,drive)=>'/'+drive.toLowerCase()):file;
await mkdir(path.join(root,'artifacts'),{recursive:true});
const scratch=await mkdtemp(path.join(root,'artifacts/deploy-tests-'));
const dockerMock=[
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$*" >> "$MOCK_LOG"',
  'if [[ $1 == image && $2 == inspect && $* == *"{{.Id}}"* ]]; then echo "id-${@: -1}"; exit 0; fi',
  'if [[ $1 == image && $2 == inspect ]]; then',
  '  if [[ $* == *--format* ]]; then echo linux/amd64; elif [[ ${MOCK_IMAGE_MISSING:-0} == 1 ]]; then exit 1; fi',
  '  exit 0',
  'fi',
  'if [[ $1 == ps ]]; then [[ -z ${MOCK_USED_IMAGE:-} ]] || echo other-container; exit 0; fi',
  'if [[ $1 == inspect && $* == *"{{.Config.Image}}"* ]]; then [[ ${@: -1} == gateway-id ]] && echo "starlit-gateway:${MOCK_CURRENT_VERSION:-1.0.0-rc.6}" || echo "starlit-app:${MOCK_CURRENT_VERSION:-1.0.0-rc.6}"; exit 0; fi',
  'if [[ $1 == inspect && $* == *"{{.State.Status}}/{{.State.Health.Status}}"* ]]; then echo "running/${MOCK_CLEANUP_HEALTH:-healthy}"; exit 0; fi',
  'if [[ $1 == inspect && $* == *"{{.State.Status}}"* ]]; then echo running; exit 0; fi',
  'if [[ $1 == inspect && $* == *"{{.Image}}"* ]]; then echo "id-${MOCK_USED_IMAGE:-other}"; exit 0; fi',
  'if [[ $1 == inspect ]]; then echo "${MOCK_DB_HEALTH:-healthy}"; exit 0; fi',
  'if [[ $1 != compose ]]; then exit 0; fi',
  'shift',
  'while [[ ${1:-} == --env-file || ${1:-} == -f ]]; do shift 2; done',
  'case "${1:-}" in',
  '  ps) if [[ ${MOCK_CLEANUP:-0} == 1 && $* == *"-q "* ]]; then echo "${@: -1}-id"; elif [[ $* == *"-q db"* ]]; then echo "${MOCK_DB_CONTAINER:-}"; else printf "%b\\n" "${MOCK_RUNNING:-api\\ngateway\\ndb}"; fi;;',
  '  up) if [[ $* == *"--wait-timeout 150 db" && ${MOCK_DB_FAIL:-0} == 1 ]]; then exit 1; fi;;',
  '  run)',
  '    if [[ $* == *has-account* ]]; then echo "${MOCK_ACCOUNT:-yes}";',
  '    elif [[ $* == *" -T migrate" && ${MOCK_MIGRATION_FAIL:-0} == 1 ]]; then exit 1;',
  '    fi;;',
  '  exec)',
  '    if [[ $* == *pg_dump* ]]; then',
  '      [[ ${MOCK_BACKUP_FAIL:-0} != 1 ]] || exit 1',
  '      echo mock-database-dump',
  '    elif [[ $* == *pg_restore* ]]; then cat >/dev/null; fi;;',
  'esac','',
].join('\n');
async function fixture({configured=true}={}){
  const folder=await mkdtemp(path.join(scratch,'case-'));
  const bin=path.join(folder,'mockbin');await mkdir(bin);
  await writeFile(path.join(folder,'shell-env'),'export PATH="$MOCK_BIN:$PATH"\n');
  await writeFile(path.join(folder,'os-release'),'ID=ubuntu\nVERSION_ID=24.04\nVERSION_CODENAME=noble\n');
  const mocks={docker:dockerMock,uname:'#!/usr/bin/env bash\n[[ $1 == -m ]] && echo x86_64 || echo Linux\n',flock:'#!/usr/bin/env bash\nexit 0\n',
    mountpoint:'#!/usr/bin/env bash\n[[ -n ${MOCK_MOUNT_PATH:-} && ${@: -1} == "$MOCK_MOUNT_PATH" ]]\n',
    curl:'#!/usr/bin/env bash\nprintf "curl %s\\n" "$*" >> "$MOCK_LOG"\nif [[ -n ${MOCK_TLS_ERRORS:-} ]]; then printf "%b\\n" "$MOCK_TLS_ERRORS" >&2; fi\nexit "${MOCK_TLS_FAIL:-0}"\n',
    ss:'#!/usr/bin/env bash\n[[ ${MOCK_PORT_BUSY:-0} == 1 ]] && echo LISTEN\nexit 0\n',
    getent:'#!/usr/bin/env bash\n[[ ${MOCK_DNS_FAIL:-0} != 1 ]] || exit 2\necho "203.0.113.1 example"\n',
    install:'#!/usr/bin/env bash\nprintf "install %s\\n" "$*" >> "$MOCK_LOG"\nfor item in "$@"; do [[ $item == -* ]] || mkdir -p -- "$item"; done\n'};
  for(const [name,content]of Object.entries(mocks))await writeFile(path.join(bin,name),content,{mode:0o755});
  for(const file of ['starlit.sh','install.sh','engine.sh']){
    let content=(await readFile(path.join(root,'deploy/container',file),'utf8')).replaceAll('\r\n','\n');
    // Only the host/root prerequisite is adapted. Flow and file operations run in Bash.
    content=content.replace(/^\[\[ .*\$EUID.*$/m,': # host/root prerequisite satisfied by harness');
    content=content.replace('. /etc/os-release','. "$MOCK_OS_RELEASE"');
    // Keep /root downloads inside this isolated fixture as well.
    content=content.replaceAll('archive="/root/','archive="$MOCK_DOWNLOADS/');
    await writeFile(path.join(folder,file),content);
  }
  for(const file of ['release.env','compose.yaml'])await copyFile(path.join(root,'deploy/container',file),path.join(folder,file));
  await mkdir(path.join(folder,'source'));
  if(configured){
    await mkdir(path.join(folder,'config'));
    await writeFile(path.join(folder,'config/compose.env'),'COMPOSE_PROJECT_NAME=starlit_123456abcdef\n');
    await writeFile(path.join(folder,'config/app.env'),'AUTH_SECRET=preserve-me\n');
    await writeFile(path.join(folder,'config/gateway.env'),'APP_DOMAIN=lottery.company.cn\n');
    await writeFile(path.join(folder,'config/database.env'),'POSTGRES_PASSWORD=preserve-me\n');
    for(const directory of ['uploads','verification','caddy','caddy-config','postgres'])await mkdir(path.join(folder,'data',directory),{recursive:true});
    await writeFile(path.join(folder,'data/uploads/avatar.txt'),'avatar-data');
  }
  return {folder,bin};
}
function execute(f,args,{script='starlit.sh',input,env={}}={}){
  const result=spawnSync(bash,[script,...args],{cwd:f.folder,encoding:'utf8',input,timeout:30000,
    env:{...process.env,MSYS_NO_PATHCONV:'1',BASH_ENV:posix(path.join(f.folder,'shell-env')),MOCK_BIN:posix(f.bin),MOCK_LOG:posix(path.join(f.folder,'commands.log')),MOCK_OS_RELEASE:posix(path.join(f.folder,'os-release')),MOCK_DOWNLOADS:posix(path.join(f.folder,'downloads')),...env}});
  if(result.error)throw result.error;
  return result;
}
async function log(f){return readFile(path.join(f.folder,'commands.log'),'utf8');}
function success(result){assert.equal(result.status,0,result.stdout+'\n'+result.stderr);}
const shellTest=(name,fn)=>test(name,{skip:process.platform==='win32'&&!existsSync(bash)},fn);

shellTest('deployment shell syntax is valid',async()=>{
  for(const file of ['install.sh','engine.sh','starlit.sh'])success(spawnSync(bash,['-n','deploy/container/'+file],{cwd:root,encoding:'utf8'}));
});
shellTest('Ubuntu and Debian supported releases pass preflight without changing host',async()=>{
  for(const [id,version,codename] of [['ubuntu','22.04','jammy'],['ubuntu','24.04','noble'],['debian','12','bookworm'],['debian','13','trixie']]){
    const f=await fixture({configured:false});
    await writeFile(path.join(f.folder,'os-release'),'ID='+id+'\nVERSION_ID='+version+'\nVERSION_CODENAME='+codename+'\n');
    success(execute(f,['--check-host'],{script:'engine.sh'}));
    assert.equal(existsSync(path.join(f.folder,'commands.log')),false);
  }
});
shellTest('unsupported systems and mismatched codenames abort before installation',async()=>{
  for(const [id,version,codename] of [['rocky','9','Blue'],['ubuntu','20.04','focal'],['debian','12','trixie']]){
    const f=await fixture({configured:false});
    await writeFile(path.join(f.folder,'os-release'),'ID='+id+'\nVERSION_ID='+version+'\nVERSION_CODENAME='+codename+'\n');
    const result=execute(f,[],{script:'install.sh'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Ubuntu 22.04/);
    assert.equal(existsSync(path.join(f.folder,'config')),false);
    assert.equal(existsSync(path.join(f.folder,'commands.log')),false);
  }
});
shellTest('first start migrates and initializes before exposing website',async()=>{
  const f=await fixture();success(execute(f,['start'],{env:{MOCK_ACCOUNT:'no'}}));
  const commands=await log(f);
  assert.ok(commands.indexOf('-T migrate')<commands.indexOf('scripts/account.mjs init'));
  assert.ok(commands.indexOf('scripts/account.mjs init')<commands.indexOf('--force-recreate'));
  assert.ok(commands.includes('curl'));
});
shellTest('repeat installation preserves existing account and encryption keys',async()=>{
  const f=await fixture();const before=await readFile(path.join(f.folder,'config/app.env'),'utf8');
  success(execute(f,[],{script:'install.sh'}));
  assert.equal(await readFile(path.join(f.folder,'config/app.env'),'utf8'),before);
  assert.ok(!(await log(f)).includes('scripts/account.mjs init'));
});
shellTest('unhealthy database is recreated once with existing data preserved',async()=>{
  const f=await fixture();
  await writeFile(path.join(f.folder,'data/postgres/keep.txt'),'existing-database');
  success(execute(f,['start'],{env:{MOCK_DB_CONTAINER:'db-id',MOCK_DB_HEALTH:'unhealthy'}}));
  const commands=await log(f);
  assert.equal(commands.split('--force-recreate --wait --wait-timeout 150 db').length-1,1);
  assert.ok(commands.indexOf('install -d -m0700 -o999 -g999 data/postgres')<commands.indexOf('--wait-timeout 150 db'));
  assert.equal(await readFile(path.join(f.folder,'data/postgres/keep.txt'),'utf8'),'existing-database');
  assert.ok(commands.indexOf('--wait-timeout 150 db')<commands.indexOf('-T migrate'));
});
shellTest('healthy database is not force recreated',async()=>{
  const f=await fixture();success(execute(f,['start'],{env:{MOCK_DB_CONTAINER:'db-id'}}));
  assert.ok(!(await log(f)).includes('--force-recreate --wait --wait-timeout 150 db'));
});
shellTest('failed database recovery stops before migrations and does not loop',async()=>{
  const f=await fixture();
  const result=execute(f,['start'],{env:{MOCK_DB_CONTAINER:'db-id',MOCK_DB_HEALTH:'unhealthy',MOCK_DB_FAIL:'1'}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/数据库仍未就绪/);
  const commands=await log(f);
  assert.equal(commands.split('--force-recreate --wait --wait-timeout 150 db').length-1,1);
  assert.ok(!commands.includes('-T migrate'));
});
shellTest('unresolved domain aborts before generating configuration',async()=>{
  const f=await fixture({configured:false});
  const result=execute(f,[],{script:'install.sh',input:'lottery.company.cn\n',env:{MOCK_DNS_FAIL:'1'}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/实际 NS/);
  assert.equal(existsSync(path.join(f.folder,'config')),false);
});
shellTest('migration failure prevents website start and initialization',async()=>{
  const f=await fixture();assert.notEqual(execute(f,['start'],{env:{MOCK_MIGRATION_FAIL:'1'}}).status,0);
  const commands=await log(f);assert.ok(!commands.includes('--force-recreate'));assert.ok(!commands.includes('scripts/account.mjs init'));
});
shellTest('HTTPS failure is reported as failed deployment',async()=>{
  const f=await fixture();const result=execute(f,['start'],{env:{MOCK_TLS_FAIL:'1',MOCK_TLS_ERRORS:'curl: transient failure\\ncurl: final TLS failure'}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/HTTPS/);
  assert.match(result.stderr,/final TLS failure/);assert.doesNotMatch(result.stderr,/transient failure/);
  assert.doesNotMatch(result.stdout,/网站已启动/);
});
shellTest('HTTPS retry success hides transient errors without weakening verification',async()=>{
  const f=await fixture();const result=execute(f,['start'],{env:{MOCK_TLS_ERRORS:'curl: (35) OpenSSL: tlsv1 alert internal error\\ncurl: (35) OpenSSL: tlsv1 alert internal error'}});
  success(result);assert.match(result.stdout,/正在等待 HTTPS 就绪/);assert.match(result.stdout,/网站已启动/);
  assert.doesNotMatch(result.stdout+result.stderr,/OpenSSL|tlsv1/);
  const curlLine=(await log(f)).split('\n').find(line=>line.startsWith('curl '));
  assert.match(curlLine,/--retry 8 --retry-all-errors --retry-delay 5 --max-time 10/);
  assert.match(curlLine,/https:\/\//);assert.doesNotMatch(curlLine,/--insecure|(?:^| )-k(?: |$)/);
});
shellTest('occupied ports abort before configuration',async()=>{
  const f=await fixture({configured:false});assert.notEqual(execute(f,[],{script:'install.sh',env:{MOCK_PORT_BUSY:'1'}}).status,0);
  assert.equal(existsSync(path.join(f.folder,'config')),false);assert.equal(existsSync(path.join(f.folder,'commands.log')),false);
});
shellTest('fresh installer generates separate secrets and valid production configuration',async()=>{
  const f=await fixture({configured:false});success(execute(f,[],{script:'install.sh',input:'lottery.company.cn\n'}));
  const {validateProduction}=await import('../scripts/check-production.mjs');
  const text=await readFile(path.join(f.folder,'config/app.env'),'utf8');
  const env=Object.fromEntries(text.trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
  assert.deepEqual(validateProduction(env),[]);assert.notEqual(env.AUTH_SECRET,env.WECHAT_MASTER_KEY);
  assert.ok(!(await log(f)).includes(env.AUTH_SECRET));
});
shellTest('partial installation is not overwritten',async()=>{
  const f=await fixture({configured:false});await mkdir(path.join(f.folder,'data'));
  await writeFile(path.join(f.folder,'data/keep.txt'),'existing');assert.notEqual(execute(f,[],{script:'install.sh'}).status,0);
  assert.equal(await readFile(path.join(f.folder,'data/keep.txt'),'utf8'),'existing');
});
shellTest('backup captures data and keys and resumes running site',async()=>{
  const f=await fixture();success(execute(f,['backup']));
  const [name]=await readdir(path.join(f.folder,'backups'));const saved=path.join(f.folder,'backups',name);
  assert.equal(await readFile(path.join(saved,'data/uploads/avatar.txt'),'utf8'),'avatar-data');
  assert.match(await readFile(path.join(saved,'config/app.env'),'utf8'),/preserve-me/);assert.ok(existsSync(path.join(saved,'SHA256SUMS')));
  const commands=await log(f);assert.ok(commands.indexOf('stop gateway api')<commands.indexOf('pg_dump'));assert.ok(commands.includes('start api gateway'));
});
shellTest('backup failure resumes service and leaves incomplete marker',async()=>{
  const f=await fixture();assert.notEqual(execute(f,['backup'],{env:{MOCK_BACKUP_FAIL:'1'}}).status,0);
  const [name]=await readdir(path.join(f.folder,'backups'));assert.ok(existsSync(path.join(f.folder,'backups',name,'INCOMPLETE')));
  assert.ok((await log(f)).includes('start api gateway'));
});
shellTest('backup does not start a stopped site',async()=>{
  const f=await fixture();success(execute(f,['backup'],{env:{MOCK_RUNNING:'db'}}));assert.ok(!(await log(f)).includes('start api gateway'));
});
shellTest('restore imports into fresh install and rejects tampered backup',async()=>{
  const f=await fixture();success(execute(f,['backup']));
  const [name]=await readdir(path.join(f.folder,'backups'));const saved=path.join(f.folder,'backups',name);
  const fresh=await fixture({configured:false});success(execute(fresh,['restore',posix(saved)]));
  assert.equal(await readFile(path.join(fresh.folder,'data/uploads/avatar.txt'),'utf8'),'avatar-data');
  const commands=await log(fresh);assert.ok(commands.indexOf('pg_restore')<commands.indexOf('-T migrate'));assert.ok(!commands.includes('scripts/account.mjs init'));
  const another=await fixture({configured:false});await writeFile(path.join(saved,'database.dump'),'tampered');
  assert.notEqual(execute(another,['restore',posix(saved)]).status,0);assert.equal(existsSync(path.join(another.folder,'config')),false);
});
shellTest('restore refuses existing installation',async()=>{
  const f=await fixture();assert.notEqual(execute(f,['restore',posix(f.folder)]).status,0);assert.match(await readFile(path.join(f.folder,'config/app.env'),'utf8'),/preserve-me/);
});
shellTest('failed upgrade keeps backup and leaves website stopped',async()=>{
  const f=await fixture();const next=await fixture({configured:false});
  await writeFile(path.join(f.folder,'release.env'),'RELEASE_VERSION=1.0.0-rc.5\nAPP_IMAGE=starlit-app:1.0.0-rc.5\nGATEWAY_IMAGE=starlit-gateway:1.0.0-rc.5\n');
  await writeFile(path.join(next.folder,'release.env'),'RELEASE_VERSION=1.0.0-rc.6\nAPP_IMAGE=starlit-app:1.0.0-rc.6\nGATEWAY_IMAGE=starlit-gateway:1.0.0-rc.6\n');
  await manifest(next.folder);
  const result=execute(f,['upgrade',posix(next.folder)],{env:{MOCK_MIGRATION_FAIL:'1'}});assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.equal((await readdir(path.join(f.folder,'backups'))).length,1);
  const commands=await log(f);assert.ok(!commands.includes('--force-recreate'));assert.ok(!commands.includes('start api gateway'));assert.ok(commands.indexOf('pg_dump')<commands.indexOf('-T migrate'));
});
test('deployment exposes only gateway ports and preserves database independently',async()=>{
  const {services}=JSON.parse(await readFile(path.join(root,'deploy/container/compose.yaml'),'utf8'));
  assert.deepEqual(services.api.ports,['80:80','443:443','443:443/udp']);assert.equal(services.db.ports,undefined);
  assert.equal(services.gateway.network_mode,'service:api');assert.equal(services.api.depends_on.migrate.condition,'service_completed_successfully');
  assert.equal(services.api.read_only,true);assert.ok(services.db.volumes.some(x=>x.includes(':/var/lib/postgresql:')));
  assert.ok(services.api.volumes.includes('./data/verification:/var/lib/starlit/verification:z'));
  assert.ok(services.gateway.volumes.includes('./data/verification:/verification:ro,z'));
});
shellTest('successful upgrade retains matching sources for later cache rebuilds',async()=>{
  const f=await fixture();const next=await fixture({configured:false});
  await writeFile(path.join(f.folder,'release.env'),'RELEASE_VERSION=1.0.0-rc.5\nAPP_IMAGE=starlit-app:1.0.0-rc.5\nGATEWAY_IMAGE=starlit-gateway:1.0.0-rc.5\n');
  await writeFile(path.join(next.folder,'release.env'),'RELEASE_VERSION=1.0.0-rc.6\nAPP_IMAGE=starlit-app:1.0.0-rc.6\nGATEWAY_IMAGE=starlit-gateway:1.0.0-rc.6\n');
  await manifest(next.folder);
  success(execute(f,['upgrade',posix(next.folder)]));
  assert.match(await readFile(path.join(f.folder,'release.env'),'utf8'),/rc\.6/);
  assert.match(await readFile(path.join(f.folder,'config/app.env'),'utf8'),/preserve-me/);
  success(execute(f,['start'],{env:{MOCK_IMAGE_MISSING:'1'}}));
  assert.match(await log(f),/releases\/1\.0\.0-rc\.6\/source/);
});
test('package preserves migration bytes and excludes host credentials/data',async()=>{
  const parent=await mkdtemp(path.join(scratch,'package-'));const directory=await prepareBundle(parent,{version:"1.0.0-test.1"});
  const all=(await walk(directory)).map(file=>path.relative(directory,file).replaceAll('\\','/'));
  assert.ok(all.includes('source/apps/api/src/main.ts'));assert.ok(all.includes('install.sh'));
  assert.ok(all.includes('INSTALLATION.md'));
  assert.ok(all.includes('TESTING.md'));
  assert.ok(all.includes('RELEASE_NOTES.md'));
  assert.ok(all.includes('source/apps/api/src/activities/wechat-cleanup.service.ts'));
  assert.ok(all.includes('source/apps/web/stage/portrait-cache.js'));
  const dockerfile=await readFile(path.join(directory,'source/deploy/container/Dockerfile'),'utf8');
  assert.ok(!dockerfile.includes('# syntax='));
  assert.match(dockerfile,/ARG NODE_IMAGE=public\.ecr\.aws\/docker\/library\/node:24\.14\.1-bookworm-slim/);
  assert.match(dockerfile,/ARG CADDY_IMAGE=public\.ecr\.aws\/docker\/library\/caddy:2\.11\.7-alpine/);
  const services=JSON.parse(await readFile(path.join(directory,'compose.yaml'),'utf8')).services;
  const bundleRelease=await readFile(path.join(directory,'release.env'),'utf8');
  assert.match(bundleRelease,/^APP_IMAGE=starlit-app:1\.0\.0-test\.1-[a-f0-9]{12}$/m);
  assert.match(bundleRelease,/^GATEWAY_IMAGE=starlit-gateway:1\.0\.0-test\.1-[a-f0-9]{12}$/m);
  assert.equal(bundleRelease.match(/APP_IMAGE=starlit-app:(.+)/)[1],bundleRelease.match(/GATEWAY_IMAGE=starlit-gateway:(.+)/)[1]);
  assert.equal(services.db.image,'public.ecr.aws/docker/library/postgres:18.6-bookworm');
  for(const script of ['install.sh','starlit.sh']){
    assert.match(await readFile(path.join(directory,script),'utf8'),/install -d -m0700 -o999 -g999 data\/postgres/);
  }
  // HTML entrypoints can reference code outside src (the standalone 3D stage).
  for(const entry of ['index.html','stage.html','join.html']){
    const html=await readFile(path.join(directory,'source/apps/web',entry),'utf8');
    for(const [,reference] of html.matchAll(/(?:src|href)="(\.\.?\/[^"?#]+)"/g)){
      assert.ok(existsSync(path.resolve(directory,'source/apps/web',reference)),entry+' missing '+reference);
    }
  }
  assert.ok(all.includes('source/apps/web/stage/waterfall-physics.worker.js'));
  assert.ok(!all.some(x=>/(^|\/)(\.env[^/]*|node_modules|artifacts|\.local|config|data)(\/|$)/.test(x)));
  for(const line of (await readFile(path.join(directory,'SHA256SUMS'),'utf8')).trim().split('\n')){
    const [hash,relative]=line.split('  ');assert.equal(createHash('sha256').update(await readFile(path.join(directory,relative))).digest('hex'),hash);
  }
  assert.deepEqual(await readFile(path.join(directory,'source/db/migrations/017_local_accounts.sql')),await readFile(path.join(root,'db/migrations/017_local_accounts.sql')));
  assert.ok(!(await readFile(path.join(directory,'install.sh'),'utf8')).includes('\r'));await assert.rejects(prepareBundle(parent,{version:"1.0.0-test.1"}),/EEXIST/);
  await assert.rejects(prepareBundle(parent,{version:'../../escape'}),/无效版本号/);
});

const releaseText=version=>`RELEASE_VERSION=${version}\nAPP_IMAGE=starlit-app:${version}\nGATEWAY_IMAGE=starlit-gateway:${version}\n`;
async function automaticDownloadFixture(kind='source'){
  const f=await fixture(),next=await fixture({configured:false});
  await writeFile(path.join(f.folder,'release.env'),releaseText('1.0.0-rc.5'));
  await writeFile(path.join(next.folder,'release.env'),releaseText('1.0.0-rc.6'));
  if(kind==='images'){
    await writeFile(path.join(next.folder,'images.tar'),'mock image archive');
    await writeFile(path.join(next.folder,'release.env'),releaseText('1.0.0-rc.6')+'BUNDLE_KIND=images\n');
  }
  await manifest(next.folder);
  const downloads=path.join(f.folder,'downloads');await mkdir(downloads);
  const staged=await mkdtemp(path.join(scratch,'archive-input-'));
  await cp(next.folder,path.join(staged,'starlit-1.0.0-rc.6-'+kind),{recursive:true});
  const archive=path.join(downloads,'starlit-1.0.0-rc.6-'+kind+'.tar.gz');
  success(spawnSync('tar',['-czf',archive,'-C',staged,'starlit-1.0.0-rc.6-'+kind],{encoding:'utf8'}));
  const hash=createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(archive+'.sha256',hash+'  '+path.basename(archive)+'\n');
  return {...f,next,archive,env:{MOCK_CLEANUP:'1',MOCK_CURRENT_VERSION:'1.0.0-rc.6'}};
}
shellTest('successful upgrade automatically removes only its verified download pair',async()=>{
  const f=await automaticDownloadFixture();
  const other=path.join(f.folder,'downloads/starlit-1.0.0-rc.5-source.tar.gz');await writeFile(other,'keep');
  const result=execute(f,['upgrade',posix(f.next.folder)],{env:f.env});success(result);
  assert.match(result.stdout,/升级完成/);assert.match(result.stdout,/已自动删除本次上传文件/);
  assert.ok(!existsSync(f.archive));assert.ok(!existsSync(f.archive+'.sha256'));assert.ok(existsSync(other));
  assert.ok(existsSync(f.next.folder));assert.ok(existsSync(path.join(f.folder,'releases/1.0.0-rc.6/SHA256SUMS')));
  assert.equal((await readdir(path.join(f.folder,'backups'))).length,1);
  assert.equal(await readFile(path.join(f.folder,'data/uploads/avatar.txt'),'utf8'),'avatar-data');
  assert.match(await readFile(path.join(f.folder,'config/app.env'),'utf8'),/preserve-me/);
});
shellTest('automatic download removal never runs after migration or HTTPS failure',async()=>{
  for(const failure of [{MOCK_MIGRATION_FAIL:'1'},{MOCK_TLS_FAIL:'1'}]){
    const f=await automaticPackageFixture();
    const result=execute(f,['upgrade',posix(f.next.folder)],{env:{...f.env,...failure}});
    assert.notEqual(result.status,0);assert.ok(existsSync(f.archive));assert.ok(existsSync(f.archive+'.sha256'));
    assert.ok(existsSync(f.next.folder));
    assert.doesNotMatch(result.stdout,/已自动删除本次上传文件/);
  }
});
async function automaticPackageFixture(kind='source'){
  const f=await automaticDownloadFixture(kind);
  const parent=await mkdtemp(path.join(scratch,'extracted-'));
  const folder=path.join(parent,'starlit-1.0.0-rc.6-'+kind);
  await cp(f.next.folder,folder,{recursive:true});
  f.next={...f.next,folder};
  return f;
}
shellTest('image upgrade imports bundled images and cleans only its verified downloads and extracted directory',async()=>{
  const f=await automaticPackageFixture('images');
  const unrelated=path.join(f.folder,'downloads/starlit-1.0.0-rc.6-source.tar.gz');await writeFile(unrelated,'keep');
  success(execute(f,['upgrade',posix(f.next.folder)],{env:{...f.env,MOCK_IMAGE_MISSING:'1'}}));
  assert.ok(!existsSync(f.archive));assert.ok(!existsSync(f.archive+'.sha256'));assert.ok(!existsSync(f.next.folder));
  assert.ok(existsSync(unrelated));assert.ok(existsSync(path.join(f.folder,'releases/1.0.0-rc.6/images.tar')));
  assert.equal(await readFile(path.join(f.folder,'data/uploads/avatar.txt'),'utf8'),'avatar-data');
  assert.match(await log(f),/load -i .*images.tar/);assert.doesNotMatch(await log(f),/\b(build|pull)\b/);
});
shellTest('image upgrade retains downloads and extracted files when migration fails',async()=>{
  const f=await automaticPackageFixture('images');
  const result=execute(f,['upgrade',posix(f.next.folder)],{env:{...f.env,MOCK_MIGRATION_FAIL:'1'}});
  assert.notEqual(result.status,0);assert.ok(existsSync(f.archive));assert.ok(existsSync(f.next.folder));
});
shellTest('image bundle refuses missing payload and reuses images already imported',async()=>{
  const f=await fixture();await writeFile(path.join(f.folder,'release.env'),releaseText('1.0.0-rc.6')+'BUNDLE_KIND=images\n');
  assert.notEqual(execute(f,['start']).status,0);
  await writeFile(path.join(f.folder,'images.tar'),'mock');
  success(execute(f,['start']));assert.doesNotMatch(await log(f),/load -i|\bbuild\b|\bpull\b/);
});
shellTest('successful upgrade removes its extracted package even without uploaded archive',async()=>{
  const f=await automaticPackageFixture();
  const result=execute(f,['upgrade',posix(f.next.folder)],{env:{...f.env,MOCK_DOWNLOADS:posix(path.join(f.folder,'absent'))}});success(result);
  assert.match(result.stdout,/已自动删除本次升级解压目录/);
  assert.ok(!existsSync(f.next.folder));
  assert.ok(existsSync(f.folder));assert.ok(existsSync(f.archive));
  assert.ok(existsSync(path.join(f.folder,'releases/1.0.0-rc.6/SHA256SUMS')));
  assert.equal((await readdir(path.join(f.folder,'backups'))).length,1);
  assert.equal(await readFile(path.join(f.folder,'data/uploads/avatar.txt'),'utf8'),'avatar-data');
});
shellTest('automatic extracted package removal preserves changed mounted unhealthy or undeletable input',async()=>{
  for(const scenario of ['extra-file','mount','unhealthy','delete-failure']){
    const f=await automaticPackageFixture();
    if(scenario==='extra-file'){
      await writeFile(path.join(f.bin,'curl'),'#!/usr/bin/env bash\nprintf keep > "$MOCK_PACKAGE/operator-note.txt"\n');
      f.env.MOCK_PACKAGE=posix(f.next.folder);
    }
    if(scenario==='mount')f.env.MOCK_MOUNT_PATH=posix(f.next.folder);
    if(scenario==='unhealthy')f.env.MOCK_CLEANUP_HEALTH='unhealthy';
    if(scenario==='delete-failure')await writeFile(path.join(f.bin,'rm'),'#!/usr/bin/env bash\ncase "$*" in *--one-file-system*) exit 1;; *) /usr/bin/rm "$@";; esac\n');
    const result=execute(f,['upgrade',posix(f.next.folder)],{env:f.env});success(result);
    assert.match(result.stderr,/解压目录未通过清理检查或删除未完成/);
    assert.ok(existsSync(f.next.folder));assert.ok(existsSync(f.folder));
  }
});
shellTest('automatic download removal preserves unverifiable files without failing a completed upgrade',async()=>{
  const cases=[
    async f=>writeFile(f.archive+'.sha256','invalid'),
    async f=>{const {unlink}=await import('node:fs/promises');await unlink(f.archive+'.sha256');},
    async f=>{await writeFile(path.join(f.next.folder,'different-bundle.txt'),'different');await manifest(f.next.folder);},
    async f=>{f.env.MOCK_CLEANUP_HEALTH='unhealthy';},
    async f=>writeFile(path.join(f.bin,'rm'),'#!/usr/bin/env bash\ncase "$*" in *starlit-1.0.0-rc.6-source.tar.gz*) exit 1;; *) /usr/bin/rm "$@";; esac\n',{mode:0o755}),
  ];
  for(const mutate of cases){
    const f=await automaticDownloadFixture();await mutate(f);
    const result=execute(f,['upgrade',posix(f.next.folder)],{env:f.env});success(result);
    assert.match(result.stdout,/升级完成/);assert.match(result.stderr,/上传文件未能通过清理检查或删除未完成/);
    assert.ok(existsSync(f.archive));assert.ok(existsSync(path.join(f.folder,'releases/1.0.0-rc.6')));
  }
});
async function cleanupFixture(){
  const f=await fixture();await writeFile(path.join(f.folder,'release.env'),releaseText('1.0.0-rc.6'));
  for(const n of [2,3,4,5,6]){
    const folder=path.join(f.folder,'releases','1.0.0-rc.'+n);await mkdir(path.join(folder,'source'),{recursive:true});
    await writeFile(path.join(folder,'release.env'),releaseText('1.0.0-rc.'+n));await writeFile(path.join(folder,'source/app.txt'),'release '+n);await manifest(folder);
    if(n===6)continue;
    const backup=path.join(f.folder,'backups',`2026100${n}T010000Z.ABCDEF`);await mkdir(path.join(backup,'config'),{recursive:true});
    await writeFile(path.join(backup,'release.env'),releaseText('1.0.0-rc.'+n));await writeFile(path.join(backup,'database.dump'),'database '+n);
    await copyFile(path.join(f.folder,'config/compose.env'),path.join(backup,'config/compose.env'));await manifest(backup);
  }
  return f;
}
const cleanEnv={MOCK_CLEANUP:'1'};
shellTest('cleanup recognizes content-tagged images proven by installation backups',async()=>{
  const f=await cleanupFixture();
  const backup=path.join(f.folder,'backups/20261002T010000Z.ABCDEF');
  await writeFile(path.join(backup,'release.env'),releaseText('1.0.0-rc.2').replaceAll('starlit-app:1.0.0-rc.2','starlit-app:1.0.0-rc.2-abcdef123456').replaceAll('starlit-gateway:1.0.0-rc.2','starlit-gateway:1.0.0-rc.2-abcdef123456'));
  await manifest(backup);
  success(execute(f,['cleanup','--apply'],{env:cleanEnv,input:'CLEAN\n'}));
  assert.match(await log(f),/image rm starlit-app:1\.0\.0-rc\.2-abcdef123456/);
  assert.match(await log(f),/image rm starlit-gateway:1\.0\.0-rc\.2-abcdef123456/);
});
async function freshDownloadFixture(){
  const f=await fixture(),download=await mkdtemp(path.join(scratch,'fresh-download-'));
  await writeFile(path.join(f.folder,'release.env'),releaseText('1.0.0-rc.6'));
  await mkdir(path.join(f.folder,'source/deploy/container'),{recursive:true});
  await writeFile(path.join(f.folder,'source/package.json'),'{}');
  await writeFile(path.join(f.folder,'source/deploy/container/Dockerfile'),'FROM fixture');
  await manifest(f.folder);
  const archive=path.join(download,'starlit-1.0.0-rc.6-source.tar.gz');await writeFile(archive,'fixture-download');
  const hash=createHash('sha256').update(await readFile(archive)).digest('hex');await writeFile(archive+'.sha256',hash+'  '+path.basename(archive)+'\n');
  return {...f,archive,env:{...cleanEnv,MOCK_DOWNLOADS:posix(download)}};
}
shellTest('fresh installation download cleanup previews, cancels and removes only the archive pair',async()=>{
  const f=await freshDownloadFixture();
  // Updating maintenance tools separately does not invalidate the rebuild sources.
  await writeFile(path.join(f.folder,'starlit.sh'),(await readFile(path.join(f.folder,'starlit.sh'),'utf8'))+'\n# maintenance update\n');
  const preview=execute(f,['cleanup','--downloads'],{env:f.env});success(preview);assert.match(preview.stdout,/无法确认/);assert.match(preview.stdout,/tar\.gz/);assert.ok(existsSync(f.archive));
  success(execute(f,['cleanup','--downloads','--apply'],{env:f.env,input:'NO\n'}));assert.ok(existsSync(f.archive));
  success(execute(f,['cleanup','--downloads','--apply'],{env:f.env,input:'CLEAN\n'}));assert.ok(!existsSync(f.archive));assert.ok(!existsSync(f.archive+'.sha256'));
  assert.equal(await readFile(path.join(f.folder,'data/uploads/avatar.txt'),'utf8'),'avatar-data');
  assert.equal(await readFile(path.join(f.folder,'config/app.env'),'utf8'),'AUTH_SECRET=preserve-me\n');
  assert.ok(existsSync(path.join(f.folder,'source/deploy/container/Dockerfile')));assert.ok(!(await log(f)).includes('image rm'));
  const again=execute(f,['cleanup','--downloads'],{env:f.env});success(again);assert.match(again.stdout,/未找到本次下载文件/);
});
shellTest('fresh download cleanup accepts explicit path and rejects corrupt sources, downloads and unsafe options',async()=>{
  const valid=await freshDownloadFixture();success(execute(valid,['cleanup','--archive',posix(valid.archive)],{env:valid.env}));assert.ok(existsSync(valid.archive));
  const mutations=[
    f=>writeFile(path.join(f.folder,'source/package.json'),'corrupt'),
    f=>writeFile(path.join(f.folder,'source/extra.txt'),'unverified'),
    f=>writeFile(path.join(f.folder,'SHA256SUMS'),''),
    f=>writeFile(f.archive,'corrupt'),
    f=>writeFile(f.archive+'.sha256','invalid'),
    f=>writeFile(path.join(f.folder,'compose.yaml'),'changed')
  ];
  for(const mutate of mutations){const f=await freshDownloadFixture();await mutate(f);assert.notEqual(execute(f,['cleanup','--downloads','--apply'],{env:f.env,input:'CLEAN\n'}).status,0);assert.ok(existsSync(f.archive));}
  assert.notEqual(execute(valid,['cleanup','--downloads','--archive',posix(valid.archive)],{env:valid.env}).status,0);
  assert.notEqual(execute(valid,['cleanup','--downloads','--apply'],{env:{...valid.env,MOCK_TLS_FAIL:'1'},input:'CLEAN\n'}).status,0);assert.ok(existsSync(valid.archive));
});
shellTest('cleanup preview never deletes; apply preserves current, previous, two backups and all runtime data',async()=>{
  const f=await cleanupFixture();const preview=execute(f,['cleanup'],{env:cleanEnv});success(preview);
  assert.match(preview.stdout,/未删除/);assert.ok(existsSync(path.join(f.folder,'releases/1.0.0-rc.2')));assert.ok(!(await log(f)).includes('image rm'));
  success(execute(f,['cleanup','--apply'],{env:cleanEnv,input:'NO\n'}));assert.ok(existsSync(path.join(f.folder,'releases/1.0.0-rc.2')));
  success(execute(f,['cleanup','--apply'],{env:{...cleanEnv,MOCK_USED_IMAGE:'starlit-app:1.0.0-rc.3'},input:'CLEAN\n'}));
  assert.deepEqual((await readdir(path.join(f.folder,'releases'))).sort(),['1.0.0-rc.4','1.0.0-rc.5','1.0.0-rc.6']);
  assert.deepEqual((await readdir(path.join(f.folder,'backups'))).sort(),['20261004T010000Z.ABCDEF','20261005T010000Z.ABCDEF']);
  assert.equal(await readFile(path.join(f.folder,'data/uploads/avatar.txt'),'utf8'),'avatar-data');assert.match(await readFile(path.join(f.folder,'config/app.env'),'utf8'),/preserve-me/);
  for(const dir of ['postgres','verification','caddy','caddy-config'])assert.ok(existsSync(path.join(f.folder,'data',dir)));
  assert.ok(existsSync(path.join(f.folder,'source')));
  const commands=await log(f);assert.ok(commands.includes('image rm starlit-app:1.0.0-rc.2'));assert.ok(!commands.includes('image rm starlit-app:1.0.0-rc.3'));
  assert.ok(!commands.includes('prune'));assert.ok(!commands.includes('stop gateway api'));assert.ok(!commands.includes('image rm starlit-app:1.0.0-rc.5'));
});
shellTest('cleanup blocks unhealthy, wrong-version and HTTPS-failing deployments',async()=>{
  const f=await cleanupFixture();
  for(const [env,message] of [[{MOCK_CLEANUP_HEALTH:'unhealthy'},/服务尚未健康/],[{MOCK_CURRENT_VERSION:'1.0.0-rc.5'},/运行镜像与当前版本不一致/],[{MOCK_TLS_FAIL:'1'},/HTTPS 检查未通过/]]){
    const result=execute(f,['cleanup','--apply'],{env:{...cleanEnv,...env},input:'CLEAN\n'});
    assert.notEqual(result.status,0);assert.match(result.stderr,message);
    assert.ok(existsSync(path.join(f.folder,'releases/1.0.0-rc.2')));
  }
  assert.ok(!(await log(f)).includes('image rm'));
});
shellTest('cleanup preserves incomplete, foreign, corrupt and extra-file backups and unproven releases',async()=>{
  const f=await cleanupFixture();
  const oldest=path.join(f.folder,'backups/20261002T010000Z.ABCDEF');await writeFile(path.join(oldest,'INCOMPLETE'),'');
  const older=path.join(f.folder,'backups/20261003T010000Z.ABCDEF');await writeFile(path.join(older,'notes.txt'),'not in manifest');
  const current=path.join(f.folder,'releases/1.0.0-rc.6');const unproven=path.join(f.folder,'releases/1.0.0-rc.99');await cp(current,unproven,{recursive:true});
  success(execute(f,['cleanup','--apply'],{env:cleanEnv,input:'CLEAN\n'}));
  for(const folder of [oldest,older,unproven,path.join(f.folder,'releases/1.0.0-rc.2')])assert.ok(existsSync(folder));
  await writeFile(path.join(older,'config/compose.env'),'COMPOSE_PROJECT_NAME=starlit_abcdef123456\n');await manifest(older);
  await writeFile(path.join(oldest,'database.dump'),'corrupted');
  success(execute(f,['cleanup','--apply'],{env:cleanEnv,input:'CLEAN\n'}));assert.ok(existsSync(older));assert.ok(existsSync(oldest));
});
shellTest('cleanup external package and archive require explicit exact paths and a verified internal copy',async()=>{
  const f=await cleanupFixture(),download=await mkdtemp(path.join(scratch,'download-'));
  const folder=path.join(download,'starlit-1.0.0-rc.6-source');await cp(path.join(f.folder,'releases/1.0.0-rc.6'),folder,{recursive:true});
  const archive=folder+'.tar.gz';await writeFile(archive,'fixture-download');
  const hash=createHash('sha256').update(await readFile(archive)).digest('hex');await writeFile(archive+'.sha256',hash+'  '+path.basename(archive)+'\n');
  const args=['cleanup','--package',posix(folder),'--archive',posix(archive)];
  success(execute(f,args,{env:cleanEnv}));assert.ok(existsSync(folder));assert.ok(existsSync(archive));
  await writeFile(path.join(folder,'personal.txt'),'preserve');assert.notEqual(execute(f,[...args,'--apply'],{env:cleanEnv,input:'CLEAN\n'}).status,0);assert.ok(existsSync(archive));
  // A separate clean download is used; never repair a user-modified package automatically.
  const second=await mkdtemp(path.join(scratch,'download-'));const clean=path.join(second,path.basename(folder));await cp(path.join(f.folder,'releases/1.0.0-rc.6'),clean,{recursive:true});
  success(execute(f,['cleanup','--package',posix(clean),'--archive',posix(archive),'--apply'],{env:cleanEnv,input:'CLEAN\n'}));
  assert.ok(!existsSync(clean));assert.ok(!existsSync(archive));assert.ok(!existsSync(archive+'.sha256'));assert.ok(existsSync(folder));assert.ok(existsSync(path.join(f.folder,'releases/1.0.0-rc.6')));
  assert.notEqual(execute(f,['cleanup','--package',posix(f.folder),'--apply'],{env:cleanEnv,input:'CLEAN\n'}).status,0);
});
shellTest('cleanup refuses symlinked parent directories without traversing outside the installation',async()=>{
  const f=await fixture(),outside=await mkdtemp(path.join(scratch,'outside-'));await writeFile(path.join(f.folder,'release.env'),releaseText('1.0.0-rc.6'));
  await writeFile(path.join(outside,'keep.txt'),'keep');
  await symlink(outside,path.join(f.folder,'releases'),process.platform==='win32'?'junction':'dir');
  const result=execute(f,['cleanup','--apply'],{env:cleanEnv,input:'CLEAN\n'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/目录不安全/);assert.equal(await readFile(path.join(outside,'keep.txt'),'utf8'),'keep');
});
shellTest('cleanup skips nested mounts and never cleans an unknown previous version',async()=>{
  const f=await cleanupFixture();const mounted=path.join(f.folder,'releases/1.0.0-rc.2/source');
  success(execute(f,['cleanup','--apply'],{env:{...cleanEnv,MOCK_MOUNT_PATH:posix(mounted)},input:'CLEAN\n'}));
  assert.ok(existsSync(mounted));
  const empty=await fixture();await writeFile(path.join(empty.folder,'release.env'),releaseText('1.0.0-rc.6'));
  await mkdir(path.join(empty.folder,'releases/1.0.0-rc.1'),{recursive:true});
  const result=execute(empty,['cleanup','--apply'],{env:cleanEnv,input:'CLEAN\n'});success(result);assert.match(result.stdout,/无法确认/);
  assert.ok(existsSync(path.join(empty.folder,'releases/1.0.0-rc.1')));assert.ok(!(await log(empty)).includes('image rm'));
});
