import {prepareWechatEnvironment} from './lib/wechat-environment.mjs';
import { prepareAuthEnvironment } from './lib/auth-environment.mjs';
import { createRequire } from 'node:module';
import { installShutdown } from './lib/shutdown.mjs';
import path from 'node:path';
import { createServer } from 'vite';
import { loadEnvironment, requireDevelopment, root, port } from './lib/config.mjs';
import { startLocalDatabase, assertPortFree } from './lib/database.mjs';
import { migrate } from './lib/migrations.mjs';
import { runNode, startNode, stopChild, waitForHttp } from './lib/processes.mjs';
const require = createRequire(import.meta.url);
loadEnvironment();
let database, web;
const children = [];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await web?.close();
  for (const child of children) await stopChild(child);
  await database?.stop();
  process.exitCode = code;
}
try {
  requireDevelopment();
  const apiPort = port(process.env.API_PORT, 3000, 'API_PORT');
  const webPort = port(process.env.WEB_PORT, 5173, 'WEB_PORT');
  if (apiPort === webPort) throw new Error('API_PORT and WEB_PORT must differ');
  await assertPortFree(apiPort); await assertPortFree(webPort);
  process.env.API_PORT = String(apiPort); process.env.API_HOST = '127.0.0.1'; process.env.WEB_PORT = String(webPort);
  if (!process.env.DATABASE_URL) {
    database = await startLocalDatabase();
    process.env.DATABASE_URL = database.connectionString;
  }
  await prepareAuthEnvironment(webPort);
  await prepareWechatEnvironment();
  const applied = await migrate(process.env.DATABASE_URL);
  console.info(`[migrate] ${applied.length ? applied.join(', ') : 'up to date'}`);
  await runNode([require.resolve('typescript/bin/tsc'), '-p', 'apps/api/tsconfig.json']);
  const api = startNode(['--watch', 'apps/api/build/main.js']);
  children.push(api);
  await waitForHttp(`http://127.0.0.1:${apiPort}/health/ready`, api);
  const compiler = startNode([require.resolve('typescript/bin/tsc'), '-p', 'apps/api/tsconfig.json', '--watch', '--preserveWatchOutput']);
  children.push(compiler);
  web = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts') });
  await web.listen();
  for (const child of children) child.once('exit', () => { if (!stopping) void stop(1); });
  installShutdown(stop);
  console.info(`\n星遇开发工作台：http://127.0.0.1:${webPort}\nCtrl+C stops services; database data is retained.\n`);
} catch (error) {
  console.error(`[dev] ${error.message?.includes('Port') ? error.message : 'Startup failed. Check ports, dependencies and database configuration.'}`);
  await stop(1);
}
