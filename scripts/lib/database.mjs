import EmbeddedPostgres from 'embedded-postgres';
import { windowsPostgres } from './windows-postgres.mjs';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { root, port, requireDevelopment } from './config.mjs';

export async function assertPortFree(value) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${value} is busy; stop the existing service or choose another port`)));
    server.listen(value, '127.0.0.1', () => server.close(resolve));
  });
}
export async function localSettings(directory = path.join(root, '.local'), dbPort = port(process.env.LOCAL_DB_PORT, 55432, 'LOCAL_DB_PORT')) {
  requireDevelopment();
  await mkdir(directory, { recursive: true });
  const credentialsPath = path.join(directory, 'postgres.json');
  let credentials;
  try { credentials = JSON.parse(await readFile(credentialsPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    credentials = { user: 'starlit_dev', password: randomBytes(24).toString('hex') };
    try { await writeFile(credentialsPath, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 }); }
    catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
    }
  }
  return { databaseDir: path.join(directory, 'postgres'), port: dbPort, ...credentials,
    connectionString: `postgresql://${encodeURIComponent(credentials.user)}:${encodeURIComponent(credentials.password)}@127.0.0.1:${dbPort}/postgres` };
}
export async function startLocalDatabase(options = {}) {
  const settings = await localSettings(options.directory, options.port);
  await assertPortFree(settings.port);
  const db = process.platform === 'win32' ? await windowsPostgres(settings) : new EmbeddedPostgres({
    databaseDir: settings.databaseDir, port: settings.port, user: settings.user, password: settings.password,
    persistent: true, authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {}, onError: () => {},
  });
  let exists = true;
  try { await access(path.join(db.databaseDir ?? settings.databaseDir, 'PG_VERSION')); } catch { exists = false; }
  if (!exists) await db.initialise();
  await db.start();
  console.info(`[database] local PostgreSQL ready on 127.0.0.1:${settings.port}`);
  return { connectionString: settings.connectionString, stop: () => db.stop() };
}
