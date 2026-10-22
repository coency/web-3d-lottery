import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import path from 'node:path';
import {root} from './lib/config.mjs';
const server=await createServer({root:path.join(root,'apps/web'),configFile:path.join(root,'apps/web/vite.config.ts'),server:{port:0}});
await server.listen();
const origin='http://127.0.0.1:'+server.httpServer.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const errors=[];
try{
 for(const viewport of [{width:390,height:844},{width:320,height:568}]){
  const page=await browser.newPage({viewport});page.on('pageerror',e=>errors.push(e.message));
  let entry;
  await page.route('**/api/v1/join/layout',r=>r.fulfill({json:{data:entry}}));
  for(const state of ['authorization','fields','success']){
   let reference;
   for(const mode of ['rehearsal','formal']){
    entry={mode,generation:1,version:'1',ended:false,organizer:'同道机械',form:{fields:[{id:'name',name:'姓名',type:'text',required:true,options:[]},{id:'phone',name:'电话',type:'text',required:false,options:[]}]},authenticated:state!=='authorization',authorizationAvailable:true,profile:{nickname:'参与者昵称',avatarUrl:'/avatar-placeholder.svg'},person:state==='success'?{nickname:'参与者昵称',avatarUrl:'/avatar-placeholder.svg',displayFields:[{id:'name',label:'姓名',value:'张三'},{id:'phone',label:'电话',value:'13800000000'}]}:null};
    await page.goto(origin+'/join.html?code=layout');
    await page.locator('footer').waitFor();
    await page.locator('.join-content .avatar').waitFor();
    const dimensions=await page.evaluate(()=>{
     const box=document.querySelector('.join-content>form,.join-content>.success'),style=getComputedStyle(box),avatar=document.querySelector('.avatar');
     return {x:box.getBoundingClientRect().x,width:box.getBoundingClientRect().width,avatar:avatar.getBoundingClientRect().width,footer:document.querySelector('footer').getBoundingClientRect().y,border:style.borderWidth,background:style.backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.equal(dimensions.border,'0px');assert.equal(dimensions.background,'rgba(0, 0, 0, 0)');assert.equal(dimensions.overflow,false);assert.equal(dimensions.avatar,88);
    assert.equal(await page.locator('.reload').count(),0);
    if(reference)assert.deepEqual(dimensions,reference);else reference=dimensions;
    if(state==='success')assert.deepEqual(await page.locator('.signup-details dd').allTextContents(),['张三','13800000000']);
    await page.screenshot({path:path.join(root,`artifacts/join-layout-${viewport.width}-${mode}-${state}.png`),fullPage:true});
   }
  }
  // Long data remains readable within a scrolling content area while footer stays visible.
  entry.person.nickname='超长微信昵称'.repeat(12);entry.person.displayFields[0].value='很长的签到资料'.repeat(25);
  await page.reload();await page.locator('.signup-details').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('footer').getBoundingClientRect().bottom<=innerHeight),true);
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS 12 mobile layouts: both modes × three steps × two viewport sizes; long content and fixed footer');
}finally{await browser.close();await server.close();}
