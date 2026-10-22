import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './config.mjs';
export async function prepareAuthEnvironment(webPort) {
  if (process.env.NODE_ENV !== 'development') throw new Error('Development auth setup only');
  process.env.APP_ORIGIN ??= 'http://127.0.0.1:' + webPort;
  if (process.env.AUTH_SECRET) return;
  const directory = path.join(root, '.local');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'auth-secret');
  try { process.env.AUTH_SECRET = (await readFile(file, 'utf8')).trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await writeFile(file, randomBytes(48).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (writeError) { if (writeError.code !== 'EEXIST') throw writeError; }
    process.env.AUTH_SECRET = (await readFile(file, 'utf8')).trim();
  }
}
