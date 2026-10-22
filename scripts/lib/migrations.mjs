import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
export async function migrate(connectionString, directory = path.join(root, 'db/migrations')) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    await client.query("SET TIME ZONE 'UTC'");
    await client.query("SET lock_timeout = '10s'");
    await client.query('SELECT pg_advisory_lock(782146001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, installed_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    const files = (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
    if (!files.length) throw new Error('No migrations found');
    const applied = await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version');
    for (const row of applied.rows) {
      if (!files.includes(row.version)) throw new Error(`Applied migration is missing: ${row.version}`);
    }
    const added = [];
    for (const file of files) {
      const sql = await readFile(path.join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = applied.rows.find(row => row.version === file);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Applied migration changed: ${file}`);
        continue;
      }
      if (applied.rows.some(row => row.version > file)) throw new Error(`Out-of-order migration: ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1,$2)', [file, checksum]);
        await client.query('COMMIT');
        added.push(file);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    return added;
  } finally {
    // Disconnect releases the session advisory lock, including error paths.
    await client.end();
  }
}
