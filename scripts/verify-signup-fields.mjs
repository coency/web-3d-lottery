import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';

// All API traffic is intercepted; this test never connects to the business database.
const cache=await mkdtemp(path.join(tmpdir(),'starlit-signup-fields-'));
const web=await createServer({configFile:'apps/web/vite.config.ts',root:'apps/web',cacheDir:cache,server:{port:0,host:'127.0.0.1'}});
let browser;
try{
 await web.listen();
 const origin='http://127.0.0.1:'+web.httpServer.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const fields=[
  {id:'name',name:'姓名',type:'text',required:true,hint:'',options:[]},
  {id:'integer',name:'数字',type:'number',required:true,hint:'',options:[]},
  {id:'department',name:'部门',type:'single',required:true,hint:'',options:[{id:'engineering',label:'研发'}]},
 ];
 async function fixture(formFields){
  const page=await browser.newPage({viewport:{width:390,height:844}}),writes=[],pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());let data;
   if(url.pathname.endsWith('/csrf'))data={csrfToken:'fixture-token'};
   else if(url.pathname==='/api/v1/join/fixture'&&req.method()==='GET')data={generation:1,version:'1',ended:false,name:'字段校验测试',organizer:'',logoUrl:null,backgroundUrl:null,form:{fields:formFields},person:null,authenticated:true,profile:{nickname:'测试参与者',avatarUrl:'/avatar-placeholder.svg'}};
   else if(url.pathname==='/api/v1/join/fixture/checkins'&&req.method()==='POST'){
    writes.push(req.postDataJSON());data={nickname:'测试参与者',avatarUrl:'/avatar-placeholder.svg',createdAt:new Date().toISOString()};
   }else return route.fulfill({status:404,json:{error:{code:'FIXTURE_UNEXPECTED',message:'Unexpected fixture request'}}});
   await route.fulfill({json:{data}});
  });
  await page.goto(origin+'/join.html?code=fixture');
  await page.getByRole('button',{name:'签到，开启幸运时刻'}).waitFor();
  return {page,writes,pageErrors};
 }
 const {page,writes,pageErrors}=await fixture(fields);
 assert.equal(await page.locator('.field-error').count(),0,'No errors before submitting');
 await page.getByRole('button',{name:'签到，开启幸运时刻'}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.field-error').length===3);
 assert.deepEqual(await page.locator('.field-error').allTextContents(),['请填写：姓名','请填写：数字','请选择：部门']);
 assert.equal(writes.length,0);
 const invalid=await page.getByRole('textbox',{name:'数字'}).getAttribute('aria-invalid');assert.equal(invalid,'true');
 const errorId=await page.getByRole('textbox',{name:'数字'}).getAttribute('aria-describedby');
 assert.ok(errorId);assert.equal(await page.locator('[id="'+errorId+'"]').textContent(),'请填写：数字');
 await page.getByRole('textbox',{name:'姓名'}).fill('林小满');
 await page.locator('.signup-field').filter({has:page.getByRole('textbox',{name:'姓名'})}).locator('.field-error').waitFor({state:'hidden'});
 for(const number of ['1.25','1.0','-0.5','1e3']){
  await page.getByRole('textbox',{name:'数字'}).fill(number);
  await page.getByText('请填写整数：数字',{exact:true}).waitFor();
  await page.getByRole('button',{name:'签到，开启幸运时刻'}).click();assert.equal(writes.length,0);
 }
 if(process.env.SIGNUP_SCREENSHOT)await page.screenshot({path:process.env.SIGNUP_SCREENSHOT,fullPage:true});
 await page.getByRole('textbox',{name:'数字'}).fill('-2');
 await page.getByText('请填写整数：数字',{exact:true}).waitFor({state:'hidden'});
 await page.locator('.el-select').filter({has:page.getByRole('combobox',{name:'部门',exact:true})}).click();
 await page.getByRole('option',{name:'研发',exact:true}).click();
 await page.locator('.field-error').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'签到，开启幸运时刻'}).click();
 await page.getByRole('heading',{name:'签到成功'}).waitFor();
 assert.deepEqual(writes[0].answers,{name:'林小满',integer:'-2',department:'engineering'});
 assert.equal(writes.length,1);assert.deepEqual(pageErrors,[]);
 await page.close();
 for(const value of ['', '0', '+3', '0018', '9007199254740993']){
  const f=await fixture([{...fields[1],required:false}]);
  if(value)await f.page.getByRole('textbox',{name:'数字'}).fill(value);
  await f.page.getByRole('button',{name:'签到，开启幸运时刻'}).click();
  await f.page.getByRole('heading',{name:'签到成功'}).waitFor();
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].answers.integer??'',value);assert.deepEqual(f.pageErrors,[]);
  await f.page.close();
 }
 console.info('PASS: inline required/choice/integer errors, live correction, no invalid submission, optional empty and exact integer values');
}finally{await browser?.close();await web.close();}
