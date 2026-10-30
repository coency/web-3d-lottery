import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { startNode, stopChild, waitForHttp } from './processes.mjs';

const require = createRequire(import.meta.url);
async function fingerprint(directory) {
  const hash = createHash('sha256');
  async function visit(folder) {
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (/\.(?:c?js|mjs|json)$/.test(entry.name)) {
        hash.update(path.relative(directory, file));
        hash.update('\0');
        hash.update(await readFile(file));
        hash.update('\0');
      }
    }
  }
  await visit(directory);
  return hash.digest('hex');
}

// Only a completed, successful compilation may restart the API. In particular,
// filesystem metadata events and unrelated dependency/cache writes must not do so.
export function watchApi({ project, entry, readyUrl, onFatal = () => {}, output = process.stdout }) {
  let api, stopping = false, failed = false, initialized = false;
  let revision = 0, lastFingerprint, pending = Promise.resolve(), buffer = '';
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const fail = error => {
    if (stopping || failed) return;
    failed = true;
    rejectReady(error);
    onFatal(error);
  };
  async function applyBuild(buildRevision) {
    if (stopping || failed || buildRevision !== revision) return;
    const nextFingerprint = await fingerprint(path.dirname(entry));
    if (stopping || failed || buildRevision !== revision || nextFingerprint === lastFingerprint) return;
    if (initialized) output.write('[dev] Backend code changed after successful compilation; restarting API.\n');
    const previous = api;
    api = undefined;
    if (previous) await stopChild(previous);
    if (stopping || failed || buildRevision !== revision) return;
    const child = startNode([entry]);
    api = child;
    child.once('error', fail);
    child.once('exit', () => {
      if (api === child) fail(new Error('Development API exited unexpectedly'));
    });
    await waitForHttp(readyUrl, child);
    if (stopping || failed) return;
    lastFingerprint = nextFingerprint;
    if (!initialized) {
      initialized = true;
      resolveReady();
    }
  }
  const compiler = startNode([
    require.resolve('typescript/bin/tsc'), '-p', project, '--watch',
    '--pretty', 'false', '--preserveWatchOutput', '--locale', 'en', '--noEmitOnError',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  compiler.stdout.on('data', chunk => {
    output.write(chunk);
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (/Starting (?:incremental )?compilation/.test(line)) revision++;
      const complete = /Found (\d+) errors?\. Watching for file changes\./.exec(line);
      if (!complete) continue;
      if (Number(complete[1])) {
        if (!initialized) fail(new Error('Initial API compilation failed'));
        continue;
      }
      const buildRevision = revision;
      pending = pending.then(() => applyBuild(buildRevision)).catch(fail);
    }
  });
  compiler.stderr.on('data', chunk => output.write(chunk));
  compiler.once('error', fail);
  compiler.once('exit', () => fail(new Error('Development compiler exited unexpectedly')));
  return {
    ready,
    async stop() {
      stopping = true;
      await stopChild(compiler);
      if (api) await stopChild(api);
      await pending;
    },
  };
}
