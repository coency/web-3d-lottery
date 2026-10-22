import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Exercise the actual upload widgets and view lifecycle without touching live data.
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage();
 await page.addInitScript(()=>{window.EventSource=class{addEventListener(){} close(){}};});
 const activity={id:'notice-test',name:'提示回归',phase:'rehearsal',mode:'rehearsal',version:'1',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000*20).toISOString(),display:{},tagline:'',organizer:'',coorganizer:''};
 let uploads=0;
 await page.route('**/api/**',route=>{
  const pathname=new URL(route.request().url()).pathname;
  let data;
  if(pathname.endsWith('/csrf'))data={csrfToken:'test'};
  else if(pathname.endsWith('/auth/me'))data={id:'test',account:'tester',role:'owner'};
  else if(pathname.endsWith('/entitlements/me'))data={created_activity_count:1,can_create:true,server_now:new Date().toISOString()};
  else if(pathname==='/api/v1/activities')data=[activity];
  else if(pathname==='/api/v1/activities/notice-test')data=activity;
  else if(pathname.endsWith('/assets/uploads')){uploads++;return route.fulfill({status:503,json:{error:{code:'TEST_FAILURE',message:'测试上传失败'}}});}
  else return route.fulfill({status:404,json:{error:{code:'NOT_FOUND',message:'Unexpected API'}}});
  return route.fulfill({json:{data}});
 });
 await page.goto((process.env.TEST_WEB_ORIGIN??'http://127.0.0.1:5175')+'/');
 await page.getByRole('button',{name:'编辑活动',exact:true}).click();
 const visual=page.getByRole('tab',{name:'品牌视觉',exact:true});
 await visual.click();
 const input=purpose=>page.locator('input[type=file][name="'+purpose+'"]');
 const file=mb=>({name:'notice-test.png',mimeType:'image/png',buffer:Buffer.alloc(mb*1024*1024)});
 const notices=page.locator('.el-message');
 async function one(text){await page.waitForFunction(text=>{const nodes=document.querySelectorAll('.el-message');return nodes.length===1&&nodes[0].textContent.includes(text);},text);}
 async function none(){await page.waitForFunction(()=>document.querySelectorAll('.el-message').length===0);}
 await input('activity_logo').setInputFiles(file(6));
 await one('图片不能超过 5MB');
 await page.waitForTimeout(1000);assert.equal(await notices.count(),1,'One failed upload must emit only one toast');
 await none(); // Must expire without clicking its close button.
 assert.equal(uploads,0,'Oversized logo must not reach the API');
 await input('activity_logo').setInputFiles(file(6));await one('图片不能超过 5MB');
 await page.getByRole('tab',{name:'活动资料',exact:true}).click();await none();
 await visual.click();await page.waitForTimeout(300);assert.equal(await notices.count(),0,'Returning to the tab must not replay upload errors');
 await input('activity_logo').setInputFiles(file(6));await one('图片不能超过 5MB');
 await page.getByRole('menuitem',{name:'我的活动',exact:true}).click();await none();
 await page.getByRole('button',{name:'编辑活动',exact:true}).click();await visual.click();
 assert.equal(await notices.count(),0,'Returning to the page must not resurrect errors');
 await input('stage_background').setInputFiles(file(11));await one('图片不能超过 10MB');await none();
 await input('stage_background').setInputFiles(file(6));await one('测试上传失败');
 assert.equal(uploads,1,'A 6MB background must pass client validation');
 await none();
 console.log('PASS upload notices: single toast, auto-dismiss, repeat attempts, tab/page cleanup, 5MB/10MB limits and server failures');
}finally{await browser.close();}
