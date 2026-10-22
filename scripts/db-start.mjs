import { installShutdown } from './lib/shutdown.mjs';
import { loadEnvironment, requireDevelopment } from './lib/config.mjs';
import { startLocalDatabase } from './lib/database.mjs';
loadEnvironment();
let database;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (database) await database.stop();
}
try {
  requireDevelopment();
  if (process.env.DATABASE_URL) throw new Error('DATABASE_URL is set: start that database with its own tools');
  database = await startLocalDatabase();
  installShutdown(stop);
  console.info('[database] Keep this terminal open; Ctrl+C stops PostgreSQL and retains data.');
} catch (error) { console.error(error.message); await stop(); process.exitCode = 1; }
