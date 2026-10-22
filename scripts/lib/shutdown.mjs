import readline from 'node:readline';
// Handle Ctrl+C as a key in Windows terminals so npm/PowerShell do not terminate
// the entire process tree before PostgreSQL has completed a graceful shutdown.
export function installShutdown(stop) {
  let exiting = false;
  const shutdown = async () => {
    if (exiting) return;
    exiting = true;
    try { await stop(); }
    finally {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', (_text, key) => {
      if (key?.ctrl && key.name === 'c') void shutdown();
    });
  }
}
