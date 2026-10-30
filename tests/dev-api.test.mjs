import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, utimes, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { watchApi } from '../scripts/lib/dev-api.mjs';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function until(check) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; } catch {}
    await delay(100);
  }
  throw new Error('Development API regression check timed out');
}

test('development API survives no-op builds and metadata events, reloads successful changes only', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starlit-dev-watch-'));
  const project = path.join(directory, 'tsconfig.json');
  const source = path.join(directory, 'main.ts');
  const entry = path.join(directory, 'build', 'main.js');
  const port = await freePort(), url = `http://127.0.0.1:${port}/`;
  const program = value => `declare function require(name: string): any;
declare const process: { pid: number };
const value: number = ${value};
require('node:http').createServer((_request: any, response: any) => {
  response.end(JSON.stringify({ value, pid: process.pid }));
}).listen(${port}, '127.0.0.1');\n`;
  let log = '', fatal;
  const builds = () => (log.match(/Found 0 errors\. Watching for file changes/g) || []).length;
  const read = async () => (await fetch(url, { signal: AbortSignal.timeout(1000) })).json();
  let watcher;
  try {
    await writeFile(project, JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'CommonJS', outDir: 'build', types: [], noEmitOnError: true, removeComments: true,
    }, files: ['main.ts'] }));
    await writeFile(source, program('1'));
    watcher = watchApi({ project, entry, readyUrl: url, output: { write: chunk => { log += chunk; } }, onFatal: error => { fatal = error; } });
    await watcher.ready;
    const first = await read();
    assert.equal(first.value, 1);
    await delay(800);
    assert.equal((await read()).pid, first.pid, 'API stays ready after initial compilation');
    await utimes(entry, new Date(), new Date());
    await delay(800);
    assert.equal((await read()).pid, first.pid, 'metadata-only changes must not restart API');
    const before = builds();
    await writeFile(source, program('1') + '// Source-only comment; emitted output is unchanged.\n');
    await until(() => builds() > before);
    await delay(500);
    assert.equal((await read()).pid, first.pid, 'identical emitted content must not restart API');
    await writeFile(source, program('2'));
    const second = await until(async () => { const result = await read(); return result.value === 2 && result; });
    assert.notEqual(second.pid, first.pid);
    await writeFile(source, program('"invalid"'));
    await until(() => /Found 1 error\. Watching for file changes/.test(log));
    assert.deepEqual(await read(), second, 'failed compilation retains the last healthy API');
    await writeFile(source, program('3'));
    const third = await until(async () => { const result = await read(); return result.value === 3 && result; });
    assert.notEqual(third.pid, second.pid);
    assert.equal(fatal, undefined);
  } finally {
    await watcher?.stop();
    await rm(directory, { recursive: true, force: true });
  }
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }), 'stop closes the fixture API');
});

test('initial compile errors never announce a ready development API or emit invalid output', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'starlit-dev-errors-'));
  const project = path.join(directory, 'tsconfig.json');
  const entry = path.join(directory, 'build', 'main.js');
  let watcher;
  try {
    await writeFile(project, JSON.stringify({ compilerOptions: { outDir: 'build', types: [] }, files: ['main.ts'] }));
    await writeFile(path.join(directory, 'main.ts'), 'const value: number = "invalid";');
    watcher = watchApi({ project, entry, readyUrl: `http://127.0.0.1:${await freePort()}/`, output: { write() {} } });
    await assert.rejects(watcher.ready, /Initial API compilation failed/);
    await assert.rejects(access(entry), { code: 'ENOENT' });
  } finally {
    await watcher?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
