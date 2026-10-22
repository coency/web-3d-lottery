// Pure presentation checks. Server-side draw validation remains authoritative.
export function stageChecks({connected,authLost,fence,controlBusy,modeMatches=true,themeReady,themeError,assets=[],peopleLoaded,portraits}){
 const rows=[
  {id:'connection',title:'服务器连接',ok:connected&&!authLost,text:authLost?'登录已失效，请返回后台登录':connected?'连接正常':'连接中断或正在连接，暂不能抽奖'},
  {id:'control',title:'抽奖控制权限',ok:!!fence&&connected&&!authLost&&modeMatches,text:authLost?'请重新登录':!modeMatches?'活动已到期或模式已变化，请从后台重新进入':!connected?'连接恢复后重新获取':fence?'本页已取得控制权限':controlBusy?'另一个大屏正在控制，请关闭原大屏后等待接管':'正在等待取得控制权限'},
  {id:'theme',title:'主题资源',ok:themeReady&&!themeError&&assets.every(s=>s==='ready'),text:themeError||(!themeReady?'正在准备 3D 主题':assets.includes('error')?'品牌图片或背景加载失败，请检查网络或后台图片':assets.includes('loading')?'正在加载品牌图片和背景':'3D 主题及品牌图片已就绪')}
 ];
 let text='正在读取参与名单…',ok=false;
 if(peopleLoaded&&portraits){
  const {total,cached,failed,pending,storageAvailable}=portraits;
  ok=storageAvailable&&cached===total&&!failed&&!pending;
  text=!total?'当前名单无需下载头像':cached+' / '+total+' 张已缓存';
  if(failed)text+=' · '+failed+' 张失败，可重试';
  else if(pending||cached<total)text+=' · 正在准备';
  if(!storageAvailable)text+=' · 本机缓存不可用，暂用内存';
 }
 rows[1].pending=connected&&!authLost&&modeMatches&&!controlBusy&&!fence;
 rows[2].pending=!themeError&&!assets.includes('error')&&!rows[2].ok;
 rows.push({id:'portraits',title:'本机头像',ok,text,pending:!peopleLoaded||!portraits||(!portraits.failed&&portraits.storageAvailable&&!ok)});
 return rows;
}

export function stageCheckSummary(checks){
 const issues=checks.filter(row=>!row.ok&&!row.pending);
 const ready=checks.every(row=>row.ok);
 return {ready,label:ready?'已就绪':issues.length?'需处理':'准备中',
  reason:issues.map(row=>row.id==='portraits'?'头像准备异常，请查看上方缓存提示':row.title+'：'+row.text).join('；')};
}
