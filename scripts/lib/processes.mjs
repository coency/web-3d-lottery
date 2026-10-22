import { spawn } from 'node:child_process';
import { root } from './config.mjs';
export function startNode(args, options = {}) {
  return spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
}
export async function runNode(args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = startNode(args, options);
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Child process failed (${code})`)));
  });
}
export async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      // Only the process tree created by this launcher, never an executable-name kill.
      const task = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      task.once('exit', resolve); task.once('error', resolve);
    });
  } else {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
export async function waitForHttp(url, child, milliseconds = 60000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error('Server exited before becoming ready');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Server readiness timed out');
}
