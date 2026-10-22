export const releaseSteps=[
 ['static-check',['npm','run','check']],
 ['unit-tests',['npm','test']],
 ['production-build',['npm','run','build']],
 ['deployment-tests',['npm','run','test:deployment']],
 ['foundation-regressions',['node','scripts/verify-foundation.mjs']],
 ['upgrade-migrations',['node','scripts/verify-user-migration.mjs']],
 ['preflight-browser',['node','scripts/verify-preflight.mjs']],
 ['async-recovery-browser',['node','scripts/verify-async-recovery.mjs']],
 ['draw-regressions',['node','scripts/verify-draw.mjs']],
 ['signup-regressions',['node','scripts/verify-join.mjs']],
 ['realtime-regressions',['node','scripts/verify-realtime.mjs']],
 ['wechat-lifecycle',['node','scripts/verify-wechat-lifecycle.mjs']],
 ['review-regressions',['node','scripts/verify-review-regressions.mjs']]
];

// Dependency injection keeps failure/changed-input tests independent of external services.
export async function verifyRelease({run,fingerprint,steps=releaseSteps}){
 const sourceFingerprint=await fingerprint(),checks=[];
 for(const [name,command] of steps){
  const started=Date.now();
  await run(command,name);
  checks.push({name,command:command.join(' '),passed:true,durationMs:Date.now()-started});
 }
 if(await fingerprint()!==sourceFingerprint)throw new Error('验收期间源码或测试文件发生变化，不能打包。请重新运行验收。');
 return {sourceFingerprint,verifiedAt:new Date().toISOString(),checks};
}
