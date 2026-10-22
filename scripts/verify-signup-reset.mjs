import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';

// Mock every API call: this regression never touches an existing activity.
const web=process.env.TEST_WEB_ORIGIN?null:await createServer({configFile:'apps/web/vite.config.ts',root:'apps/web',cacheDir:'../../artifacts/signup-reset-vite',server:{port:0,host:'127.0.0.1'}});
await web?.listen();
const origin=process.env.TEST_WEB_ORIGIN??'http://127.0.0.1:'+web.httpServer.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),writes=[];
 const entry={generation:1,version:'1',ended:false,readOnly:false,mode:'formal',name:'测试',organizer:'',form:{fields:[{id:'name',name:'姓名',type:'text',required:true,options:[]}]},person:null,authenticated:true,profile:{nickname:'来宾',avatarUrl:'/avatar-placeholder.svg'}};
 await page.route('**/api/**',r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('/csrf'))return r.fulfill({json:{data:{csrfToken:'test'}}});
  if(path.endsWith('/checkins')){
   const body=r.request().postDataJSON();writes.push(body);
   if(body.generation!==entry.generation)return r.fulfill({status:409,json:{error:{code:'GENERATION_CHANGED',message:'彩排数据已更新，请重新加载'}}});
   return r.fulfill({json:{data:{nickname:'来宾',avatarUrl:'/avatar-placeholder.svg',createdAt:new Date().toISOString()}}});
  }
  if(path==='/api/v1/join/audit')return r.fulfill({json:{data:entry}});
  return r.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:'Unexpected API'}}});
 });
 await page.goto(origin+'/join.html?code=audit');
 const input=page.getByRole('textbox',{name:'姓名',exact:true});await input.fill('旧答案');
 assert.equal(await page.getByRole('button',{name:'重新加载签到页面'}).count(),0);
 entry.generation=2;entry.version='2';
 await page.getByRole('button',{name:'签到，开启幸运时刻'}).click();
 await page.waitForFunction(()=>document.querySelector('.reload')?.disabled===false&&document.querySelector('.signup-fields input')?.value==='');
 assert.equal(await input.inputValue(),'','Clearing the rehearsal must clear displayed answers as well as the submitted model');
 await page.getByRole('button',{name:'签到，开启幸运时刻'}).click();assert.equal(writes.length,1,'An empty required field must be rejected before another submission');
 await page.getByRole('button',{name:'重新加载签到页面'}).click();
 await page.getByRole('button',{name:'重新加载签到页面'}).waitFor({state:'detached'});
 await input.fill('新答案');await page.getByRole('button',{name:'签到，开启幸运时刻'}).click();
 await page.getByRole('heading',{name:'签到成功',exact:true}).waitFor();
 assert.deepEqual(writes.map(x=>({generation:x.generation,answers:x.answers})),[{generation:1,answers:{name:'旧答案'}},{generation:2,answers:{name:'新答案'}}]);
 console.log('PASS signup generation reset clears displayed values and validates the same answers that are submitted');
}finally{await browser.close();await web?.close();}
