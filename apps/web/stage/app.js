import {showNotice} from '../src/notices';
import {subscribeUpdates} from '../src/realtime';
import {joinQr} from '../src/join-qr';

import {createUniverse} from './universe.js';
import {createImageCache} from './image-cache.js';
import {createPortraitCache} from './portrait-cache.js';
import {prepareWaterfallWorker,cancelWaterfallPreparation} from './waterfall-loader.js';
import {createPortraitRasterizer} from './portrait-raster.js';
import {createStagePortraits} from './portrait-source.js';
import {stageChecks,stageCheckSummary} from './preflight.js';
import {winnerLayout} from './sphere-layout.js';
import {get,write,releaseOnExit,RequestError} from '../src/api';
const $=s=>document.querySelector(s);
const systemBrand=$('.brand').cloneNode(true);
const query=new URLSearchParams(location.search),id=query.get('activity'),mode=query.get('mode')==='formal'?'formal':'rehearsal';
const base='/api/v1/activities/'+id;
// Persist identity across refresh; an exclusive browser lock separates duplicated tabs.
async function controlIdentity(){
 const key='starlit-stage-tab';
 if(!navigator.locks)return crypto.randomUUID();
 let value=sessionStorage.getItem(key)||crypto.randomUUID();
 const hold=token=>new Promise(resolve=>{
  navigator.locks.request('starlit-stage:'+token,{ifAvailable:true},async lock=>{
   resolve(!!lock);if(lock)await new Promise(()=>{});
  }).catch(()=>resolve(false));
 });
 if(!await hold(value)){value=crypto.randomUUID();if(!await hold(value))throw new Error('无法初始化页面控制，请重新打开大屏');}
 sessionStorage.setItem(key,value);return value;
}
const tabId=await controlIdentity();
let data=null,activity=null,selected='',people=[],visuals=null,fence='',busy=false,transition=false,connected=false,loading=false;
let records=[],imagesDirty=false,confirmId=null,authLost=false,lastFailure='',controlBusy=false;
const dirtyPortraitUrls=new Set();
let actionPending='';
let pageSuspended=false;
let themeReady=false,themeError='',peopleLoaded=false,portraitStatus=null;
let waterfallStatus='idle';
const waterfallLoading=()=>prize()?.theme==='galaxy-waterfall'&&waterfallStatus!=='ready'&&waterfallStatus!=='error';
const waterfallError=()=>prize()?.theme==='galaxy-waterfall'&&waterfallStatus==='error'?'碰撞引擎加载失败，请刷新大屏重试':'';
function onWaterfallStatus(status){waterfallStatus=status;render();}
let peopleRevision='',loadedAppearanceRevision='';
const appearanceResources=new Map();
function watchAppearance(image,key){
 const resource={status:'loading',image};appearanceResources.set(key,resource);
 const finish=status=>{if(appearanceResources.get(key)!==resource)return;resource.status=status;renderChecks();};
 image.onload=()=>finish('ready');image.onerror=()=>finish('error');
}
function renderChecks(){
 const checks=stageChecks({connected,authLost,fence,controlBusy,modeMatches:!data||data.phase===mode,themeReady:themeReady&&!waterfallLoading(),themeError:themeError||waterfallError(),assets:[...appearanceResources.values()].map(r=>r.status),peopleLoaded,portraits:portraitStatus});
 const {ready,label,reason}=stageCheckSummary(checks),status=$('#preflightStatus');
 const retryable=!!portraitStatus?.failed||[...appearanceResources.values()].some(r=>r.status==='error')||!!themeError||!!waterfallError();
 status.dataset.ready=String(ready);
 status.disabled=!retryable;
 status.textContent=retryable?'重试':label;
 status.title=reason;
 $('#preflightReason').textContent=reason;
 $('#preflightReason').hidden=!reason;
}
const images=createImageCache({onLoad:url=>{dirtyPortraitUrls.add(url);}}),existing=new Set(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const portraitRaster=createPortraitRasterizer();
let portraits=null,portraitScope='',portraitExpiry='',accountId='';
function portraitProgress(status){
 portraitStatus=status;renderChecks();
 const defaults=people.filter(person=>!person.avatarUrl||person.avatarUrl==='/avatar-placeholder.svg').length;
 $('#portraitProgress').textContent='头像资源 '+status.total+' 张 · 本机已缓存 '+status.cached+' 张 · 待准备 '+status.pending+' 张 · 失败 '+status.failed+' 张'+(defaults?' · 使用品牌 Logo '+defaults+' 人':'');
 $('#portraitStorage').textContent=status.storageAvailable?'头像自动缓存，关闭后重开可复用。活动结束 7 天后，下次打开系统时清理；清理网站数据后需重新下载。':'本机存储暂不可用，已改用临时缓存；关闭后可能需要重新下载。';
}
function setupPortraits(){
 const scope=accountId+':'+id+':'+mode+':'+data.generation;
 if(scope===portraitScope&&portraitExpiry===activity?.expires_at)return;
 portraits?.dispose();portraitRaster.clear();portraitScope=scope;portraitExpiry=activity?.expires_at;
 portraitStatus=null;
 dirtyPortraitUrls.clear();
 portraits=createPortraitCache({scope,activityExpiresAt:portraitExpiry,onLoad:url=>{dirtyPortraitUrls.add(url);},onChange:portraitProgress});
 portraits.setPaused(waterfallLoading());
 imagesDirty=true;
}
const retryImages=()=>{images.retryFailed();portraits?.retryFailed();};window.addEventListener('online',retryImages);
window.addEventListener('pagehide',event=>{if(!event.persisted){cancelWaterfallPreparation();images.dispose();portraits?.dispose();window.removeEventListener('online',retryImages);}});
const scene={phase:'idle',population:0};
const themes={'dream-planet':createUniverse,'starlight-matrix':createUniverse,'star-wave':createUniverse,'starlight-corridor':createUniverse,'galaxy-waterfall':createUniverse};
function notify(text){showNotice(text,'info',{duration:10000,grouping:true});}
function fail(e){
 controlBusy=e instanceof RequestError&&e.code==='CONTROL_BUSY';
 connected=controlBusy;fence='';
 const message=controlBusy?'另一个大屏正在操作本场活动。请使用原大屏，或关闭它后等待本页接管。':e instanceof Error?e.message:'连接失败，请重试';
 const key=e instanceof RequestError?e.code:message;
 if(key!==lastFailure){notify(message);lastFailure=key;}
 if(e instanceof RequestError&&e.status===401)authLost=true;
 render();
}
function loadImage(url){
 portraits?.load(url,{priority:3,display:true});
}
const stagePortraits=createStagePortraits({images,getPortraits:()=>portraits,getLogoUrl:()=>activity?.logoUrl,raster:portraitRaster});
const {logo}=stagePortraits;
function avatar(person,size,target){return stagePortraits.avatar(typeof person==='number'?people[person]:person,size,target);}
avatar.preload=stagePortraits.avatar.preload;avatar.isReady=stagePortraits.avatar.isReady;avatar.usesBrand=stagePortraits.avatar.usesBrand;
function refreshLoadedPortraits(){
 if(!visuals||(!imagesDirty&&!dirtyPortraitUrls.size))return;
 const changed=imagesDirty?null:new Set(dirtyPortraitUrls);
 imagesDirty=false;dirtyPortraitUrls.clear();visuals.refreshPortraits(changed);
}
function leaves(awards){
 const children=new Map(awards.filter(a=>a.replaces_award_id).map(a=>[a.replaces_award_id,a]));
 return awards.filter(a=>!a.replaces_award_id).map(a=>{while(children.has(a.id))a=children.get(a.id);return {...a,person:a.display_snapshot,replaces:a.replaces_award_id};});
}
const drawing=()=>data?.rounds.find(r=>r.status==='drawing');
const prize=()=>data?.prizes.find(p=>p.id===selected);
const payload=()=>({mode,generation:data.generation,tabId,fence});
function render(){
 renderChecks();
 if(!data)return;
 const p=prize(),missing=data.vacancies.length,rolling=!!drawing(),completed=!!p&&!data.activeRootId&&p.awarded>=p.total;
 portraits?.setBusy(busy||transition||rolling);
 portraits?.setPaused(waterfallLoading());
 document.body.classList.toggle('physics-loading',waterfallLoading()||!!waterfallError());
 scene.theme=p?.theme||'dream-planet';$('#stage').dataset.theme=scene.theme;
 scene.phase=rolling?'rolling':data.activeRootId?'result':'idle';scene.population=people.length;
 scene.drawCount=drawing()?.draw_count??0;
 document.body.classList.toggle('blocked',!connected||!fence||authLost||data.phase!==mode);document.body.classList.toggle('rolling',rolling);document.body.classList.toggle('result',scene.phase==='result');document.body.classList.toggle('revealing',transition);
 $('#joined').textContent=data.signedIn.toLocaleString();$('#prizeName').textContent=p?p.name:'请先配置奖项';
 $('#remaining').textContent=p?Math.max(0,p.total-p.awarded):0;
 $('#roundLabel').textContent=completed?'已中奖':'本轮';
 $('#roundCount').textContent=completed?p.awarded:drawing()?.draw_count||missing||(data.activeRootId?records.length:0);
 $('#drawLabel').textContent=actionPending==='start'&&!rolling?'正在开始…':transition?'幸运即将揭晓':rolling?'停止 · 揭晓幸运':missing?'开始补抽':data.activeRootId?'进入下一轮':completed?'本奖项已完成':'开始抽奖';
 $('#draw').disabled=!themeReady||waterfallLoading()||!!waterfallError()||!connected||!fence||busy||!!actionPending||transition||data.phase!==mode||!p||(!data.activeRootId&&p.awarded>=p.total);
 $('#stageStatus').textContent=authLost?'登录已失效，请返回后台重新登录':data.phase!==mode?(data.phase==='expired'?'活动已到期，仅可查看记录':'活动模式已变化，请重新从后台打开大屏'):!connected?'连接中断，操作已暂停，正在自动重连':waterfallError()?waterfallError():waterfallLoading()?'正在加载碰撞引擎，首次进入请稍候…':!fence?(controlBusy?'另一个大屏正在控制 · 关闭原大屏后，本页将自动接管':'正在等待取得操作权限'):transition?'星光收束，幸运即将揭晓':rolling?'按空格停止 · 揭晓本轮幸运星':!p?'请在后台添加并保存奖项':'';
 $('#winners').hidden=!records.length||(transition&&!existing.size);
 $('#resultNote').textContent=transition?'幸运揭晓中':missing?'空缺 '+missing+' 位 · 按空格开始补抽，再按空格停止':'Enter 下一轮 · W 中奖名单 · 不在场可点击补抽';
 $('#winnerSlots').replaceChildren(...records.map(r=>{
  const el=document.createElement('article');el.className='winner-slot'+(r.status==='void'?' vacant':'')+((rolling||transition)?' dimmed':'');el.dataset.id=r.id;el.hidden=transition&&!existing.has(r.id);
  const hit=document.createElement('div');hit.className='cube-hit';
  const caption=document.createElement('div');caption.className='winner-caption';const name=document.createElement('h3');name.textContent=r.status==='void'?'':r.display_snapshot.title||r.display_snapshot.nickname;name.title=name.textContent;caption.hidden=r.status==='void';caption.append(name);
  if(r.status==='valid'){const button=document.createElement('button');button.className='void-person';button.textContent='不在场 · 补抽';button.disabled=busy||transition||rolling||!connected||!fence||data.phase!==mode;button.onclick=()=>askVoid(r);caption.append(button);}
  el.append(hit,caption);return el;
 }));
 position();visuals?.setPopulation(people.length);
 if(!transition)visuals?.syncWinners(records);
}
function position(){const stage=$('#stage'),narrow=stage.clientWidth<=600,multi=records.length>(narrow?3:5);stage.style.minHeight=narrow&&multi?(525+Math.ceil(records.length/3)*170)+'px':'';$('#winnerSlots').classList.toggle('multi-row',multi);const anchors=winnerLayout(stage.clientWidth,stage.clientHeight,records.length,0);document.querySelectorAll('.winner-slot').forEach((el,i)=>{const a=anchors[i];if(a){el.style.left=a.x+'px';el.style.top=(a.y-a.size*.62)+'px';el.style.setProperty('--cube-size',a.size+'px');el.style.setProperty('--card-width',a.cardWidth+'px');}});}
async function load(){
 const next=await get(base+'/draw?mode='+mode);
 if(data&&data.generation!==next.generation){fence='';records=[];existing.clear();visuals?.syncWinners([]);notify('彩排数据已重置，已同步最新名单和奖项。');}
 data=next;connected=true;
 if(data.activeRootId)selected=data.rounds[0]?.prize_id||selected;
 else if(!data.prizes.some(p=>p.id===selected))selected=data.prizes[0]?.id||'';
 if(!visuals&&prize()?.theme==='galaxy-waterfall'&&waterfallStatus==='idle'){
  waterfallStatus='loading';
  try{prepareWaterfallWorker();}catch{waterfallStatus='error';}
 }
 setupPortraits();
 records=leaves(data.awards);records.forEach(a=>loadImage(a.display_snapshot.avatarUrl));render();
}
async function claim(){
 if(pageSuspended)return;
 if(authLost||!data||data.phase!==mode)return;
 const result=await write(base+'/draw/claim','POST',payload());fence=String(result.fence);
 if(pageSuspended){releaseOnExit(base+'/draw/release',payload());fence='';return;}
 controlBusy=false;lastFailure='';render();
}
async function refreshPeople(){
 if(peopleLoaded&&data.rosterRevision&&peopleRevision===data.rosterRevision)return;
 const result=await get(base+'/stage-people?mode='+mode+(peopleLoaded&&peopleRevision?'&revision='+encodeURIComponent(peopleRevision):''));
 if(result.generation!==data.generation)throw new Error('名单已重置，请重新打开大屏');
 if(!result.unchanged){
  // The renderer reconciles portrait keys when the roster changes. Existing
  // photos remain valid; new/changed URLs and late image loads update their own
  // cells. A new signup must not invalidate the entire atlas (or winner photos).
  people=result.items;
  portraits?.setRoster(people.map(p=>p.avatarUrl));
 }
 peopleRevision=result.revision||'';
 peopleLoaded=true;portraitStatus=portraits?.stats()??null;renderChecks();
}
async function action(kind,awardId){
 if(busy||transition||actionPending)return;
 actionPending=kind;render();
 while(loading)await new Promise(resolve=>setTimeout(resolve,50));
 if(busy||transition||!connected||!fence||data.phase!==mode){actionPending='';render();return;}
 const nextPrize=kind==='next'&&!switching&&prize()?.awarded>=prize()?.total
  ?data.prizes.slice(data.prizes.findIndex(p=>p.id===selected)+1).find(p=>p.awarded<p.total):null;
 busy=true;
 if(kind==='stop'){records.filter(r=>r.status==='valid').forEach(r=>existing.add(r.id));transition=true;}
 render();
 try{
 const extra=kind==='void'?{awardId,confirmed:true}:kind==='start'?{prizeId:selected,version:data.version}:kind==='stop'?{roundId:drawing().id}:{rootId:data.activeRootId};
 await write(base+'/draw/'+kind,'POST',{...payload(),...extra});
 await load();
 if(nextPrize&&!data.activeRootId&&data.prizes.some(p=>p.id===nextPrize.id&&p.awarded<p.total)){selected=nextPrize.id;render();}
 if(kind==='stop'){
  visuals.reveal(records,()=>{transition=false;existing.clear();render();});
 }
 }catch(e){transition=false;existing.clear();
  try{await load();}catch(loadError){fail(loadError);return;}
  if(e instanceof RequestError&&['NOT_ENOUGH_CANDIDATES','PRIZE_FULL','VERSION_CONFLICT','GROUP_UNFINISHED'].includes(e.code))notify(e.message);
  else fail(e);
 }
 finally{busy=false;actionPending='';render();}
}
function askVoid(r){
 if(busy||transition||drawing()||!connected||!fence)return;
 confirmId=r.id;$('#confirmTitle').textContent='确认 '+(r.display_snapshot.title||r.display_snapshot.nickname)+' 不在场？';$('#confirmText').textContent='确认后将空出该名额，此人不再参与本场后续颁发，原记录保留。其他中奖者保持不变。准备完成后，请按空格开始、停止补抽。';$('#confirmDialog').showModal();$('#confirmTitle').focus();
}
$('#confirmDialog').addEventListener('close',()=>{confirmId=null;});
$('#cancelConfirm').onclick=()=>{confirmId=null;$('#confirmDialog').close();};
$('#acceptConfirm').onclick=async()=>{if(busy||transition)return;const id=confirmId;confirmId=null;$('#confirmDialog').close();if(id)await action('void',id);};
window.addEventListener('offline',()=>{connected=false;fence='';render();});
function draw(){if(document.querySelector('dialog[open]')||$('#draw').disabled)return;if(drawing())void action('stop');else if(data.activeRootId&&!data.vacancies.length)void action('next');else void action('start');}
let switching=false;
async function switchPrize(step){
 if(switching)return;
 if(!data||!connected||!fence){notify(authLost?'登录已失效，请返回后台重新登录':!data?'活动尚未加载完成，请稍后重试':controlBusy?'另一个大屏正在操作，请关闭原大屏后等待本页自动接管':'连接尚未恢复，请稍后重试');return;}
 if(busy||actionPending||transition||drawing()){notify('请等待本轮揭晓完成后切换奖项');return;}
 if(data.vacancies.length){notify('当前还有待补名额，请先完成补抽再切换奖项');return;}
 if(data.prizes.length<2){notify('当前只有一个奖项，请在后台添加其他奖项');return;}
 switching=true;
 try{
  if(data.activeRootId){await action('next');if(data.activeRootId)return;}
  if(!connected||!fence)return;
  const i=data.prizes.findIndex(p=>p.id===selected);selected=data.prizes[(i+step+data.prizes.length)%data.prizes.length].id;render();
 }finally{switching=false;}
}
let historyRequest=0,historyLoading=false;
$('#historyDialog').addEventListener('close',()=>{historyRequest++;historyLoading=false;});
async function history(refresh=false){
 const dialog=$('#historyDialog');if(dialog.open&&!refresh){dialog.close();return;}if(transition||busy||drawing()||(refresh&&historyLoading))return;
 const request=++historyRequest;historyLoading=true;
 if(!dialog.open)dialog.showModal();const content=$('#historyContent');if(!refresh)content.textContent='正在加载…';
 try{
 let page=1,all=[],result;
 do{result=await get(base+'/awards?mode='+mode+'&page='+page++);if(request!==historyRequest||!dialog.open)return;all.push(...result.items);}while(all.length<result.total&&result.items.length);
 const scrollTop=content.scrollTop,fragment=document.createDocumentFragment();$('#historySummary').textContent='共 '+all.length+' 条记录（含作废记录）';
 const groups=new Map();
 for(const record of all){const key=record.prize_id||record.display_snapshot.prizeName||'历史奖项';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(record);}
 const order=new Map((data?.prizes||[]).map((p,i)=>[p.id,i]));
 for(const [key,items] of [...groups].sort((a,b)=>(order.get(a[0])??Infinity)-(order.get(b[0])??Infinity))){
  const section=document.createElement('section');section.className='history-group';
  const heading=document.createElement('h3');heading.textContent=items[0].display_snapshot.prizeName||'历史奖项';
  const list=document.createElement('ul');list.className='history-list';
  for(const record of items){
   const row=document.createElement('li');row.className='history-person'+(record.status==='valid'?'':' history-void');
   const name=document.createElement('strong');name.textContent=record.display_snapshot.nickname||record.display_snapshot.title||'历史记录';name.title=name.textContent;
   const status=document.createElement('span');status.className='history-status';status.textContent=record.status==='valid'?'有效':'作废';
   row.append(name,status);list.append(row);
  }
  section.append(heading,list);fragment.append(section);
 }
 content.replaceChildren(fragment);
 if(!all.length)content.textContent='暂无中奖名单';
 if(refresh)content.scrollTop=scrollTop;
 }catch(e){if(request===historyRequest&&dialog.open)content.textContent=e.message;}
 finally{if(request===historyRequest)historyLoading=false;}
}
$('#draw').onclick=draw;
$('#preflightStatus').onclick=()=>{
 if(themeError||waterfallError()){location.reload();return;}
 retryImages();
 for(const [key,resource] of appearanceResources)if(resource.status==='error'){
  const src=resource.image.src;watchAppearance(resource.image,key);resource.image.src=src;
 }
 portraitStatus=portraits?.stats()??null;renderChecks();
};
document.addEventListener('webglcontextlost',()=>{themeReady=false;themeError='图形显示已中断，请刷新大屏恢复';render();},true);


document.addEventListener('keydown',e=>{
 if(e.repeat||e.ctrlKey||e.altKey||e.metaKey||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable)return;
 const k=e.key.toLowerCase(),dialog=document.querySelector('dialog[open]');
 if(dialog){if((k===' '||k==='enter')&&!e.target.closest('button'))e.preventDefault();if((dialog.id==='helpDialog'&&k==='h')||(dialog.id==='historyDialog'&&k==='w')||(dialog.id==='qrDialog'&&k==='q'))dialog.close();return;}
 if(k===' '){e.preventDefault();if(scene.phase!=='result'||data?.vacancies.length)draw();else notify('按 Enter 进入下一轮');}
 else if(k==='enter'){e.preventDefault();if(data?.activeRootId&&!drawing()&&!data.vacancies.length)void action('next');}
 else if(k==='h'){$('#helpDialog').showModal();$('#helpTitle').focus();}
 else if(k==='w')void history();
 else if(k==='q'&&!drawing()&&!transition)void showJoin();
 else if(k==='arrowup'||k==='arrowdown'){e.preventDefault();void switchPrize(k==='arrowup'?-1:1);}
});
window.addEventListener('resize',position);
let joinRequest=0;
$('#qrDialog').addEventListener('close',()=>{joinRequest++;});
async function showJoin(){
 const request=++joinRequest;
 const dialog=$('#qrDialog');dialog.querySelectorAll('img,a').forEach(el=>el.remove());
 dialog.querySelector('h2').textContent=mode==='formal'?'正式签到':'彩排签到';
 dialog.querySelector('p').textContent='正在加载签到二维码…';
 dialog.showModal();$('#qrTitle').focus();
 try{
 const entry=await get(base+'/join-entry?mode='+mode);
 if(request!==joinRequest||!dialog.open)return;
 if(!entry.available||entry.provider!=='wechat'||!entry.url){dialog.querySelector('p').textContent='签到暂不可用，请联系主办方检查签到配置。';return;}
 const qr=await joinQr(entry.url);if(request!==joinRequest||!dialog.open)return;
 dialog.querySelector('p').textContent='请使用微信扫码签到';
 const img=new Image();img.src=qr;img.alt='签到二维码';img.style.cssText='display:block;width:280px;max-width:100%;margin:20px auto';dialog.insertBefore(img,dialog.querySelector('small'));
 }catch(e){if(request===joinRequest&&dialog.open){dialog.querySelector('p').textContent='二维码加载失败，请稍后重新打开。';notify('二维码加载失败，请稍后重新打开');}}
}
let appearanceKey='';
function applyActivity(){
 const key=JSON.stringify([activity.name,activity.tagline,activity.organizer,activity.coorganizer,activity.logoUrl,activity.stageBackgroundUrl,activity.display]);
 if(key===appearanceKey)return;appearanceKey=key;
 appearanceResources.clear();
 document.title=activity.name+' · 3D 抽奖';
 $('.event h1').textContent=activity.name;$('.tagline').textContent=activity.display.tagline?activity.tagline:'';

 $('.organizer').textContent=[activity.display.organizer&&activity.organizer?'主办方 · '+activity.organizer:'',activity.display.coorganizer&&activity.coorganizer?'协办方 · '+activity.coorganizer:''].filter(Boolean).join(' ｜ ');
 $('.brand').hidden=!activity.display.logo;
 if(activity.logoUrl&&activity.display.logo){$('.brand').replaceChildren();const img=new Image();watchAppearance(img,'logo');img.src=activity.logoUrl;img.alt='活动 Logo';img.style.cssText='max-width:150px;max-height:65px;object-fit:contain';$('.brand').append(img);}
 else $('.brand').replaceChildren(...Array.from(systemBrand.childNodes,node=>node.cloneNode(true))); 
 images.load(activity.logoUrl);
 scene.customBackground=!!(activity.stageBackgroundUrl&&activity.display.stageBackground);
 $('#stage').classList.toggle('custom-background',scene.customBackground);
 $('#activityBackground')?.remove();
 if(activity.stageBackgroundUrl&&activity.display.stageBackground){const bg=document.createElement('img');watchAppearance(bg,'background');bg.id='activityBackground';bg.src=activity.stageBackgroundUrl;bg.alt='';bg.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;opacity:1';$('#stage').prepend(bg);}

 imagesDirty=true;
}
async function boot(){
 if(!/^[0-9a-f-]{36}$/i.test(id||''))throw new Error('活动地址不正确，请从活动卡片打开');
 accountId=(await get('/api/v1/auth/me')).id;activity=await get(base);
 applyActivity();
 $('.demo-mark').textContent=mode==='rehearsal'?'彩排模式':'';
 await load();await refreshPeople();scene.population=people.length;
 if(pageSuspended)return;
 const createTheme=themes[prize()?.theme||'dream-planet'];
 if(!createTheme)throw new Error('当前奖项主题不可用，请在后台重新选择主题');
 visuals=createTheme({getState:()=>scene,getPeople:()=>people,avatar,brandLogo:logo,reduced,notify,onWaterfallStatus});render();
 if(!waterfallLoading()&&!waterfallError())$('#stageStatus').textContent='正在准备舞台…';
 await visuals.ready;
 themeReady=true;themeError='';render();
 try{await claim();}catch(e){fail(e);}
}
window.addEventListener('pagehide',()=>{
 pageSuspended=true;
 if(data&&fence)releaseOnExit(base+'/draw/release',payload());
 fence='';
});
let booting=false,bootBlocked=false,bootRetryAt=0;
async function initialize(){
 if(booting||bootBlocked||themeReady||pageSuspended||authLost||Date.now()<bootRetryAt)return;
 booting=true;
 try{await boot();}
 catch(e){
  // Retry only network/service failures before renderer creation. Shader or
  // configuration errors require a reload; never create a second renderer.
  const retryable=!visuals&&e instanceof RequestError&&(e.status>=500||e.status===429);
  bootBlocked=!retryable;bootRetryAt=Date.now()+3000;connected=false;fence='';
  if(e instanceof RequestError&&e.status===401)authLost=true;
  const message=authLost?'登录已失效，请返回后台重新登录':retryable?'舞台加载暂时失败，正在自动重试':e.message+'，请刷新大屏重试';
  themeError=message;renderChecks();$('#stageStatus').textContent=message;
  if(lastFailure!==message){lastFailure=message;notify(message);}
 }finally{booting=false;}
}
await initialize();
let pendingSync=true,appearancePending=true,realtimeOnline=false,lastSnapshot=0,nextRetry=0;
window.addEventListener('online',()=>{bootRetryAt=0;pendingSync=true;});
window.addEventListener('pageshow',event=>{
 if(!event.persisted)return;
 pageSuspended=false;connected=false;fence='';pendingSync=true;nextRetry=0;
 unsubscribe=listenUpdates();
 render();void synchronize();
});
const listenUpdates=()=>subscribeUpdates(change=>{
 const state=change.activities?.find(a=>a.id===id);
 if(data&&state&&state.phase!==mode){data.phase=state.phase;fence='';render();}
 if(change.all||change.ids.includes(id)){pendingSync=true;appearancePending=true;}
},status=>{
 realtimeOnline=status==='connected';
 if(realtimeOnline)retryImages();
 if(status==='expired'){authLost=true;connected=false;fence='';notify('登录已失效，请返回后台重新登录');render();}
 else if(status==='reconnecting'){connected=false;fence='';notify('实时连接中断，操作已暂停，正在重新连接。');render();}
 else pendingSync=true;
});
let unsubscribe=listenUpdates();
window.addEventListener('pagehide',()=>{unsubscribe();realtimeOnline=false;});
async function synchronize(){
 if(pageSuspended||authLost||booting||busy||transition||loading)return;
 if(!themeReady){await initialize();return;}
 if(!pendingSync||Date.now()<nextRetry)return;
 pendingSync=false;loading=true;
 try{
  await load();await refreshPeople();
  if(appearancePending&&!drawing()){
   if(!data.appearanceRevision||loadedAppearanceRevision!==data.appearanceRevision){
    activity=await get(base);setupPortraits();portraits?.setRoster(people.map(p=>p.avatarUrl));applyActivity();loadedAppearanceRevision=data.appearanceRevision||'';
   }
   appearancePending=false;
  }
  if(data.phase===mode&&!fence)await claim();
  if(!drawing())refreshLoadedPortraits();
  if($('#historyDialog').open)await history(true);
  lastSnapshot=Date.now();render();
 }catch(e){pendingSync=true;nextRetry=Date.now()+3000;fail(e);}finally{loading=false;}
}
setInterval(()=>{if(pageSuspended)return;if(!busy)refreshLoadedPortraits();if(appearancePending&&!drawing()&&!transition)pendingSync=true;void synchronize();},300);
// Control lease is independent of notifications. Also reconcile periodically if events are lost.
setInterval(async()=>{
 if(pageSuspended||authLost||!themeReady||booting||loading||busy)return;
 if(Date.now()-lastSnapshot>30000||!realtimeOnline)pendingSync=true;
 if(!connected||!fence||data.phase!==mode)return;
 try{await write(base+'/draw/heartbeat','POST',payload());}catch(e){fail(e);pendingSync=true;}
},4000);
