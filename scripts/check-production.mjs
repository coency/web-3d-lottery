import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function validateProduction(env) {
  const errors = [];
  const required = ['APP_ORIGIN', 'DATABASE_URL', 'AUTH_SECRET', 'WECHAT_MASTER_KEY', 'ASSET_DIRECTORY'];
  for (const key of required) if (!env[key] || /CHANGE_ME/i.test(env[key])) errors.push(`${key}: 请填写生产配置`);
  if (env.NODE_ENV !== 'production') errors.push('NODE_ENV: 必须为 production');
  try {
    const url = new URL(env.APP_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== env.APP_ORIGIN || /(^|\.)(localhost|example\.(com|org|net))$/.test(url.hostname) || url.hostname === '127.0.0.1') throw new Error();
  } catch { errors.push('APP_ORIGIN: 需要实际 HTTPS 域名，不含路径或末尾斜线'); }
  try {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error();
  } catch { errors.push('DATABASE_URL: 需要 PostgreSQL 连接地址'); }
  if ((env.AUTH_SECRET?.length ?? 0) < 64) errors.push('AUTH_SECRET: 至少 64 个字符');
  if (!/^[0-9a-f]{64}$/i.test(env.WECHAT_MASTER_KEY ?? '')) errors.push('WECHAT_MASTER_KEY: 需要 64 位十六进制密钥');
  if (env.API_HOST !== '127.0.0.1' || env.API_PORT !== '3000' || env.TRUST_PROXY !== 'loopback') errors.push('API_HOST/API_PORT/TRUST_PROXY: 本部署模板要求 127.0.0.1:3000 和 loopback');
  if (!['disabled', 'wechat'].includes(env.WECHAT_OAUTH_PROVIDER)) errors.push('WECHAT_OAUTH_PROVIDER: 仅支持 disabled 或 wechat');
  if (env.ASSET_DIRECTORY !== '/var/lib/starlit/uploads') errors.push('ASSET_DIRECTORY: 本部署模板要求 /var/lib/starlit/uploads');
  return [...new Set(errors)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = validateProduction(process.env);
  for (const file of ['apps/api/build/main.js', 'apps/web/build/index.html', 'apps/web/build/stage.html', 'apps/web/build/join.html']) {
    try { await access(path.join(root, file), constants.R_OK); }
    catch { errors.push(`构建文件缺失或不可读: ${file}`); }
  }
  if (!errors.length) {
    try { await access(process.env.ASSET_DIRECTORY, constants.R_OK | constants.W_OK); }
    catch { errors.push('上传目录不存在或当前账号不可读写'); }
  }
  if (errors.length) { console.error(errors.map(x => `- ${x}`).join('\n')); process.exitCode = 1; }
  else console.info('生产配置与文件检查通过；数据库连通、HTTPS 和真实微信仍需上线验收。');
}
