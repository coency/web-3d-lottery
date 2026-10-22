// Supplemental verification against ONLY a previous isolated soak database.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';
import {preview} from 'vite';
import {chromium,request} from 'playwright';
import {root} from './lib/config.mjs';
import {startLocalDatabase} from './lib/database.mjs';
import {startNode,stopChild,waitForHttp} from './lib/processes.mjs';
const directory=path.resolve(process.argv[2]||'');
assert.equal(path.dirname(directory),path.join(root,'artifacts'));
assert.match(path.basename(directory),/^soak-stage-[a-zA-Z0-9]+$/);
const original=JSON.parse(await readFile(path.join(directory,'results.json'),'utf8'));
assert.equal(original.activities.length,2);
process.env.NODE_ENV='development';
const port=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const apiPort=await port(),webPort=await port(),dbPort=await port();
process.env.API_PORT=String(apiPort);process.env.WEB_PORT=String(webPort);
const base='http://127.0.0.1:'+apiPort,origin='http://127.0.0.1:'+webPort;
let db,sql,api,web,browser,client;
const result={startedAt:new Date().toISOString(),status:'running',originalAwards:[],errors:[],checks:[],responses:[]};
try{
 db=await startLocalDatabase({directory,port:dbPort});sql=new pg.Client({connectionString:db.connectionString});await sql.connect();
 for(const a of original.activities){
  const row=(await sql.query("SELECT count(*)::int total,count(DISTINCT participant_id)::int people FROM draw_awards WHERE activity_id=$1 AND status='valid'",[a.id])).rows[0];
  assert.equal(row.total,200);assert.equal(row.people,200);result.originalAwards.push({...a,...row});
 }
 result.checks.push('Both original runs produced exactly 200 valid awards for 200 distinct people, including the final retried stop');
 const require=createRequire(new URL('../apps/api/package.json',import.meta.url));const argon=require('argon2'),password=randomBytes(24).toString('hex');
 await sql.query('UPDATE users SET password_hash=$1 WHERE login_name=$2',[await argon.hash(password,{type:argon.argon2id}),'13800000971']);
 api=startNode(['apps/api/build/main.js'],{env:{...process.env,DATABASE_URL:db.connectionString,AUTH_SECRET:randomBytes(48).toString('hex'),APP_ORIGIN:origin,ASSET_DIRECTORY:path.join(directory,'uploads')}});await waitForHttp(base+'/health/ready',api);
 client=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:origin}});
 const csrf=(await(await client.get('/api/v1/auth/csrf')).json()).data.csrfToken;
 const login=await client.post('/api/v1/auth/login',{data:{phone:'13800000971',password},headers:{'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()}});assert.equal(login.status(),200);
 web=await preview({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),preview:{host:'127.0.0.1',port:webPort,strictPort:true,proxy:{'/api':base,'/health':base}}});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const ctx=await browser.newContext({viewport:{width:1920,height:1080},storageState:await client.storageState()});
 const activity=original.activities.find(a=>a.population===5000);let page,avatarRequests=0;
 const ready=()=>page.waitForFunction(()=>!document.querySelector('#draw').disabled&&!document.body.classList.contains('revealing'),null,{timeout:60000});
 async function open(){
  page=await ctx.newPage();page.on('pageerror',e=>result.errors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/demo-avatars/portraits-v1/'))avatarRequests++;});
  page.on('response',r=>{if(new URL(r.url()).pathname.endsWith('/draw/stop'))result.responses.push({status:r.status(),operation:r.request().headers()['idempotency-key']});});
  await page.goto(origin+'/stage.html?activity='+activity.id+'&mode=rehearsal');await ready();
  await page.waitForFunction(()=>document.querySelector('#portraitProgress').textContent.includes('本机已缓存 5000 张'),null,{timeout:180000});
 }
 async function act(kind,key){await ready();const pending=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/draw/'+kind)&&r.request().method()==='POST'&&r.status()!==403,{timeout:35000});await page.keyboard.press(key);assert.equal((await pending).status(),200);await ready();}
 await open();assert.equal(await page.locator('.winner-slot:visible').count(),10);result.checks.push('Reopening original final round shows all 10 winners');
 await act('next','Enter');await page.waitForFunction(()=>!document.body.classList.contains('result'));
 await act('start','Space');await page.waitForTimeout(3000);
 // Force the same double-submit rejection as an expired cookie without changing
 // the production lifetime or bypassing the server's CSRF validation.
 await ctx.clearCookies({name:'starlit_csrf'});
 await act('stop','Space');assert.equal(await page.locator('.winner-slot:visible').count(),10);
 assert.deepEqual(result.responses.map(r=>r.status),[403,200]);
 assert.equal(result.responses[0].operation,result.responses[1].operation);
 const after=(await sql.query("SELECT count(*)::int total,count(DISTINCT participant_id)::int people FROM draw_awards WHERE activity_id=$1 AND status='valid'",[activity.id])).rows[0];
 assert.equal(after.total,210);assert.equal(after.people,210);result.afterSupplement=after;
 result.checks.push('CSRF rejection renews automatically, retries with the same operation key and creates exactly 10 awards');
 await act('next','Enter');await page.waitForFunction(()=>!document.body.classList.contains('result'));
 await page.close();await new Promise(resolve=>setTimeout(resolve,16000));
 const before=avatarRequests;await open();result.reopenAvatarRequests=avatarRequests-before;assert.equal(result.reopenAvatarRequests,0);
 assert.equal(await page.locator('#preflightStatus').isDisabled(),true);
 result.checks.push('5000-avatar page reopens from local cache with zero avatar network requests');
 await page.keyboard.press('h');await page.screenshot({path:path.join(directory,'supplement-cache.png')});
 assert.deepEqual(result.errors,[]);result.status='passed';
}catch(e){result.status='failed';result.failure=e.stack;}
finally{
 result.completedAt=new Date().toISOString();await writeFile(path.join(directory,'supplement.json'),JSON.stringify(result,null,2));
 await browser?.close();if(web)await new Promise(resolve=>web.httpServer.close(resolve));await client?.dispose();await stopChild(api);await sql?.end();await db?.stop();
 console.log(JSON.stringify(result));process.exitCode=result.status==='passed'?0:1;
}
