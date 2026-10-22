import { tmpdir } from 'node:os';
import { mkdir, writeFile, unlink, cp, access } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { root } from './config.mjs';

// Native binaries use an ASCII cache; persistent data remains inside the project.
export async function windowsPostgres(settings) {
  const home = process.env.STARLIT_LOCAL_DB_HOME ?? path.join(tmpdir(), 'starlit-postgres-native');
  if (/[^\x00-\x7f]/.test(home)) throw new Error('Set STARLIT_LOCAL_DB_HOME to an ASCII directory for Windows PostgreSQL');
  const runtime = path.join(home, 'postgres-18.4');
  const dataHome = path.dirname(settings.databaseDir);
  const data = settings.databaseDir;
  await mkdir(dataHome, { recursive: true });
  try { await access(path.join(runtime, 'bin/pg_ctl.exe')); }
  catch {
    await cp(path.join(root, 'node_modules/@embedded-postgres/windows-x64/native'), runtime, { recursive: true });
  }
  async function execute(name, args) {
    await new Promise((resolve, reject) => {
      const child = spawn(path.join(runtime, 'bin', name + '.exe'), args, {
        cwd: runtime, windowsHide: true, env: { ...process.env, LC_MESSAGES: 'C' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', chunk => { output = (output + chunk).slice(-2000); });
      child.stderr.on('data', chunk => { output = (output + chunk).slice(-2000); });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`PostgreSQL ${name} failed: ${output}`)));
    });
  }
  let started = false;
  return {
    databaseDir: data,
    async initialise() {
      const passwordFile = path.join(dataHome, 'init-password-' + process.pid);
      await writeFile(passwordFile, settings.password + '\n', { flag: 'wx', mode: 0o600 });
      try {
        await execute('initdb', ['-D', data, '--auth=scram-sha-256', '--username=' + settings.user,
          '--pwfile=' + passwordFile, '--encoding=UTF8', '--locale=C']);
      } finally { await unlink(passwordFile); }
    },
    async start() {
      await execute('pg_ctl', ['start', '-D', data, '-l', path.join(dataHome, 'postgres.log'),
        '-o', `-h 127.0.0.1 -p ${settings.port} -c timezone=UTC`, '-w', '-t', '20']);
      started = true;
    },
    async stop() {
      if (!started) return;
      await execute('pg_ctl', ['stop', '-D', data, '-m', 'fast', '-w', '-t', '20']);
      started = false;
    },
  };
}
