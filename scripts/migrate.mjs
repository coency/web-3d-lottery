import { loadEnvironment } from './lib/config.mjs';
import { localSettings } from './lib/database.mjs';
import { migrate } from './lib/migrations.mjs';
loadEnvironment();
try {
  if (process.env.NODE_ENV !== 'development' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required outside development');
  const connectionString = process.env.DATABASE_URL || (await localSettings()).connectionString;
  const applied = await migrate(connectionString);
  console.info(applied.length ? `[migrate] Applied: ${applied.join(', ')}` : '[migrate] Schema already up to date');
} catch {
  console.error('[migrate] Failed. Check database availability, configuration and migration integrity. No credentials logged.');
  process.exitCode = 1;
}
