export function soakReport(result){
 const fmt=(n,d=1)=>Number.isFinite(n)?n.toFixed(d):'—';
 const names={'dream-planet':'梦幻星球','starlight-matrix':'星光矩阵','star-wave':'星轨光波','starlight-corridor':'星光长廊','galaxy-waterfall':'星河瀑布'};
 const lines=['# 大屏持续运行测试报告','',`状态：${result.status}。${result.smoke?'本次仅为短时预检，不代表一小时测试。':''}`,`开始时间：${result.runStartedAt||result.startedAt}（UTC）。持续 ${fmt(result.durationSeconds/60)} 分钟。`,'',
 '## 环境','',`- 真实本地 API、独立 PostgreSQL 和测试账号；不访问现有活动数据。`,
 `- 处理器：${result.environment.cpu}；内存 ${fmt(result.environment.totalMemoryGB)} GB。`,
 `- 浏览器：${result.environment.chrome}，无界面 Chrome；1920 × 1080，DPR 1。`,
 `- 图形后端：${result.environment.gpu?.auxAttributes?.glRenderer||'未记录'}。`,
 '- 使用不同的合成头像，不是微信真人头像；网络为本机网络，不代表公网授权并发。',
 '- 正常帧采样排除页面首次打开和诊断 GC。每个区块结束主动回收一次 JS 垃圾，用于比较仍被持有的内存。',
 '- 下表为浏览器动画帧间隔，不是 GPU 呈现帧的硬件测量；实际会场电脑仍需验证。','',
 '## 各主题数据','',
 '| 人数 | 主题 | 待机/抽奖/结果综合 FPS | >50ms 帧 | 最长帧 ms | 首轮→末轮 GC 后堆 MB | 首轮→末轮纹理数 |',
 '|---|---|---:|---:|---:|---:|---:|'];
 for(const population of [...new Set(result.activities.map(a=>a.population))])for(const theme of Object.keys(names)){
  const samples=result.samples.filter(s=>s.population===population&&s.theme===theme&&['idle','rolling','result'].includes(s.phase)&&s.frames>=60);
  const blocks=result.blocks.filter(s=>s.population===population&&s.theme===theme);
  if(!samples.length&&!blocks.length)continue;
  const frames=samples.reduce((n,s)=>n+s.frames,0),seconds=samples.reduce((n,s)=>n+(s.fps?s.frames/s.fps:0),0);
  const first=blocks[0],last=blocks.length>1?blocks.at(-1):undefined;
  lines.push(`| ${population} | ${names[theme]} | ${fmt(frames/seconds)} | ${samples.reduce((n,s)=>n+s.over50,0)} | ${fmt(Math.max(...samples.map(s=>s.maxMs)))} | ${fmt(first?.heapAfterGCMB)} → ${fmt(last?.heapAfterGCMB)} | ${first?.gl?.Texture?.live??'—'} → ${last?.gl?.Texture?.live??'—'} |`);
 }
 lines.push('','## 功能和缓存','',`- 已完成开始/停止/下一轮操作：${result.actions.length} 次。`,`- 页面/API/采样异常：${result.errors.length} 条。`,`- WebGL 上下文丢失：${Math.max(0,...result.samples.map(s=>s.contextLost))} 次。`,`- “模”字头像绘制：${Math.max(0,...result.samples.map(s=>s.initials))} 次。`);
 for(const a of result.activities)lines.push(`- ${a.population} 人活动：${a.awards?`${a.awards.total} 个有效中奖记录，${a.awards.unique_people} 个不同中奖者。`:'未完成中奖记录核验。'}`);
 for(const b of result.blocks.filter(b=>b.reopened))lines.push(`- ${b.population} 人页面重开，在首次可操作检查点新发起 ${b.avatarNetworkRequests} 次头像请求（含尚未缓存的头像，不能单独据此认定缓存失效）。`);
 for(const a of result.activities){const latest=result.samples.filter(s=>s.population===a.population&&s.label==='block-end').at(-1);if(latest)lines.push(`- ${a.population} 人最后区块缓存：${latest.cache}。`);}
 if(result.failure)lines.push('','## 未完成原因','', '```',result.failure,'```');
 if(result.errors.length)lines.push('','## 异常记录','',...result.errors.map(e=>'- '+JSON.stringify(e)));
 lines.push('','## 证据','', '- `results.json`：完整环境、阶段采样、操作耗时、功能核验。','- `samples.jsonl`：逐次追加的采样记录。','- 同目录 PNG：每个主题区块结束时的画面。','', '未发现异常不等于所有设备均流畅。内存增长需要比较同人数、同主题和同阶段，不能把不同场景的瞬时堆大小直接当作泄漏。');
 return lines.join('\n')+'\n';
}
