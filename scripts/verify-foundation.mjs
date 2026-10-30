import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import pg from 'pg';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { root } from './lib/config.mjs';
import { startLocalDatabase } from './lib/database.mjs';
import { migrate } from './lib/migrations.mjs';
import { startNode, stopChild, waitForHttp } from './lib/processes.mjs';

process.env.NODE_ENV = 'development';
async function availablePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
  });
}
await mkdir(path.join(root, 'artifacts'), { recursive: true });
const directory = await mkdtemp(path.join(root, 'artifacts/foundation-'));
const dbPort = await availablePort();
const apiPort = await availablePort();
const webPort = await availablePort();
process.env.API_PORT = String(apiPort);
process.env.WEB_PORT = String(webPort);
process.env.AUTH_SECRET = randomBytes(48).toString('hex');
let database, api, web, browser, client;
const results = [];
const pass = name => { results.push(name); console.info('PASS ' + name); };
const apiUrl = `http://127.0.0.1:${apiPort}`;
async function launchApi(environment) {
  const child = startNode(['apps/api/build/main.js'], {
    env: { ...process.env, NODE_ENV: environment, APP_ORIGIN: environment === 'production' ? 'https://example.test' : `http://127.0.0.1:${webPort}`, API_HOST: '127.0.0.1', DATABASE_URL: database.connectionString },
    stdio: 'inherit',
  });
  try { await waitForHttp(apiUrl + '/health/live', child); } catch (error) { await stopChild(child); throw error; }
  return child;
}
try {
  database = await startLocalDatabase({ directory, port: dbPort });
  const parallel = await Promise.all([migrate(database.connectionString), migrate(database.connectionString)]);
  assert.equal(parallel.flat().length, 21);
  assert.deepEqual(await migrate(database.connectionString), []);
  pass('concurrent migration lock and repeated migration idempotency');

  const fixture = path.join(directory, 'migration-fixture');
  await mkdir(fixture);
  const first = '001_foundation.sql';
  await copyFile(path.join(root, 'db/migrations', first), path.join(fixture, first));
  await copyFile(path.join(root, 'db/migrations/002_accounts.sql'), path.join(fixture, '002_accounts.sql'));
  await copyFile(path.join(root, 'db/migrations/003_phone_login.sql'), path.join(fixture, '003_phone_login.sql'));
  await copyFile(path.join(root, 'db/migrations/004_activities.sql'), path.join(fixture, '004_activities.sql'));
  await copyFile(path.join(root, 'db/migrations/005_checkin_background.sql'), path.join(fixture, '005_checkin_background.sql'));
  await copyFile(path.join(root, 'db/migrations/006_activity_configuration.sql'), path.join(fixture, '006_activity_configuration.sql'));
  await copyFile(path.join(root, 'db/migrations/007_participant_exports.sql'), path.join(fixture, '007_participant_exports.sql'));
  await copyFile(path.join(root, 'db/migrations/008_participant_management.sql'), path.join(fixture, '008_participant_management.sql'));
  await copyFile(path.join(root, 'db/migrations/009_participant_avatars.sql'), path.join(fixture, '009_participant_avatars.sql'));
  await copyFile(path.join(root, 'db/migrations/010_account_profile.sql'), path.join(fixture, '010_account_profile.sql'));
  await copyFile(path.join(root, 'db/migrations/011_optional_activity_logo.sql'), path.join(fixture, '011_optional_activity_logo.sql'));
  await copyFile(path.join(root, 'db/migrations/012_server_draw.sql'), path.join(fixture, '012_server_draw.sql'));
  await copyFile(path.join(root, 'db/migrations/013_wechat_configuration.sql'), path.join(fixture, '013_wechat_configuration.sql'));
  await copyFile(path.join(root, 'db/migrations/014_wechat_oauth.sql'), path.join(fixture, '014_wechat_oauth.sql'));
  await copyFile(path.join(root, 'db/migrations/015_realtime.sql'), path.join(fixture, '015_realtime.sql'));
  await copyFile(path.join(root, 'db/migrations/016_user_only.sql'), path.join(fixture, '016_user_only.sql'));
  await copyFile(path.join(root, 'db/migrations/017_local_accounts.sql'), path.join(fixture, '017_local_accounts.sql'));
  await copyFile(path.join(root, 'db/migrations/018_ten_person_rounds.sql'), path.join(fixture, '018_ten_person_rounds.sql'));
  await copyFile(path.join(root, 'db/migrations/019_wechat_readiness.sql'), path.join(fixture, '019_wechat_readiness.sql'));
  await copyFile(path.join(root, 'db/migrations/020_roster_revisions.sql'), path.join(fixture, '020_roster_revisions.sql'));
  await copyFile(path.join(root, 'db/migrations/021_activity_materials.sql'), path.join(fixture, '021_activity_materials.sql'));
  await writeFile(path.join(fixture, '022_failure.sql'), 'CREATE TABLE must_rollback (id integer); SELECT missing_column;');
  await assert.rejects(migrate(database.connectionString, fixture));
  client = new pg.Client({ connectionString: database.connectionString });
  await client.connect();
  assert.equal((await client.query("SELECT to_regclass('must_rollback') AS name")).rows[0].name, null);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count, 21);
  pass('failed migration rolls back DDL and migration record');
  await writeFile(path.join(fixture, first), (await readFile(path.join(fixture, first), 'utf8')) + '\n-- changed\n');
  await assert.rejects(migrate(database.connectionString, fixture), /Applied migration changed/);
  pass('applied SQL checksum protects migration history');

  const user = (await client.query(`INSERT INTO users(account,password_hash,phone) VALUES ('test_one','fixture-only','+8613800000001') RETURNING id`)).rows[0].id;
  const other = (await client.query(`INSERT INTO users(account,password_hash,phone) VALUES ('test_two','fixture-only','+8613800000002') RETURNING id`)).rows[0].id;
  const asset = (await client.query(`INSERT INTO assets(owner_id, object_key, purpose, status) VALUES ($1,'fixture/logo','activity_logo','ready') RETURNING id`, [user])).rows[0].id;
  const background = (await client.query(`INSERT INTO assets(owner_id, object_key, purpose, status) VALUES ($1,'fixture/background','h5_background','ready') RETURNING id`, [user])).rows[0].id;
  const activity = (await client.query(`INSERT INTO activities(owner_id,name,logo_asset_id,h5_background_asset_id,expires_at) VALUES ($1,'工程验证',$2,$3,clock_timestamp()+interval '1 day') RETURNING id`, [user, asset, background])).rows[0].id;
  await assert.rejects(client.query(`INSERT INTO activities(owner_id,name,logo_asset_id,h5_background_asset_id,expires_at) VALUES ($1,'串用户',$2,$3,clock_timestamp()+interval '1 day')`, [other, asset, background]), error => error.code === '23503');
  await assert.rejects(client.query(`UPDATE activities SET expires_at = created_at + interval '31 days' WHERE id=$1`, [activity]), error => error.code === '23514');
  await assert.rejects(client.query(`UPDATE activities SET created_at=created_at + interval '1 hour' WHERE id=$1`, [activity]), error => error.code === '23514');
  await assert.rejects(client.query(`INSERT INTO activity_runs(owner_id,activity_id,mode) VALUES ($1,$2,'formal')`, [other, activity]), error => error.code === '23503');
  pass('database constraints reject cross-owner resources/runs and moving 30-day anchor');

  // A checked-out pg client has no pool idle listener. Terminate it between
  // queries to cover disconnects that do not reject an active query promise.
  const {DatabaseService}=await import('../apps/api/build/database.service.js');
  const previousDatabaseUrl=process.env.DATABASE_URL;
  process.env.DATABASE_URL=database.connectionString;
  const service=new DatabaseService();
  if(previousDatabaseUrl===undefined)delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL=previousDatabaseUrl;
  try{
    async function disconnect(c){
      const pid=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const disconnected=new Promise(resolve=>c.once('error',resolve));
      await client.query('SELECT pg_terminate_backend($1)',[pid]);
      await disconnected;
    }
    await assert.rejects(service.transaction(async c=>{await disconnect(c);return 'must not commit';}));
    assert.equal((await service.transaction(c=>c.query('SELECT 1 AS value'))).rows[0].value,1);
    const original=new Error('original transaction failure');
    await assert.rejects(service.transaction(async c=>{await disconnect(c);throw original;}),error=>error===original);
    assert.equal((await service.status()).schemaVersion,'021_activity_materials.sql');
    const latest=(await client.query("DELETE FROM schema_migrations WHERE version='021_activity_materials.sql' RETURNING *")).rows[0];
    try{await assert.rejects(service.status(),/Database schema is not ready/);}
    finally{await client.query('INSERT INTO schema_migrations(version,checksum,installed_at) VALUES($1,$2,$3)',[latest.version,latest.checksum,latest.installed_at]);}
    assert.equal((await service.status()).schemaVersion,'021_activity_materials.sql');
    pass('readiness rejects pre-materials schema and recovers after latest migration');
  }finally{await service.onApplicationShutdown();}
  pass('checked-out connection loss rejects safely, preserves original failure and discards broken connections');


  api = await launchApi('development');
  let response = await fetch(apiUrl + '/api/v1/system/bootstrap');
  assert.equal(response.status, 200);
  const initial = await response.json();
  assert.equal(initial.data.schemaVersion, '021_activity_materials.sql');
  assert.equal(initial.traceId, response.headers.get('x-request-id'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  response = await fetch(apiUrl + '/does-not-exist');
  assert.equal(response.status, 404);
  const unknown = await response.json();
  assert.equal(unknown.error.code, 'NOT_FOUND');
  assert.ok(unknown.traceId);
  assert.equal('stack' in unknown, false);
  pass('real API reads persisted schema; envelopes, request IDs and safe errors');

  web = await createServer({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts') });
  await web.listen();
  const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  await access(chrome);
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${webPort}/`);
  await page.locator('input[name=account]').waitFor();
  const proxied=await page.evaluate(async()=>({status:(await fetch('/api/v1/system/bootstrap')).status}));
  assert.equal(proxied.status,200);
  assert.equal(await page.getByText('工程状态',{exact:false}).count(),0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(root, 'artifacts/foundation-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(root, 'artifacts/foundation-laptop.png'), fullPage: true });
  assert.deepEqual(pageErrors, []);
  pass('desktop login page has no engineering UI; Vite proxy reaches API without layout overflow');

  await client.end(); client = undefined;
  await database.stop();
  response = await fetch(apiUrl + '/health/ready');
  assert.equal(response.status, 503);
  const outage = await response.json();
  assert.equal(outage.error.code, 'SERVICE_UNAVAILABLE');
  assert.equal(outage.error.retryable, true);
  assert.equal((await fetch(apiUrl + '/health/live')).status, 200);
  const browserOutage=await page.evaluate(async()=>{const r=await fetch('/api/v1/system/bootstrap');return {status:r.status,body:await r.json()};});
  assert.equal(browserOutage.status,503);assert.equal(browserOutage.body.error.retryable,true);
  pass('database outage reports 503 readiness, live process and retryable response through browser proxy');

  database = await startLocalDatabase({ directory, port: dbPort });
  await waitForHttp(apiUrl + '/health/ready', api);
  response = await fetch(apiUrl + '/api/v1/system/bootstrap');
  assert.equal((await response.json()).data.installedAt, initial.data.installedAt);
  client = new pg.Client({ connectionString: database.connectionString });
  await client.connect();
  assert.equal((await client.query('SELECT name FROM activities WHERE id=$1', [activity])).rows[0].name, '工程验证');
  assert.equal(await page.evaluate(async()=>(await fetch('/api/v1/system/bootstrap')).status),200);
  pass('database restart preserves records and API/frontend recover');

  await stopChild(api); api = undefined;
  api = await launchApi('production');
  assert.equal((await fetch(apiUrl + '/api/v1/system/bootstrap')).status, 404);
  assert.equal((await fetch(apiUrl + '/health/ready')).status, 200);
  pass('production does not register development diagnostics');

  await writeFile(path.join(root, 'artifacts/foundation-verification.json'), JSON.stringify({
    verifiedAt: new Date().toISOString(), node: process.version, checks: results,
    database: 'real embedded PostgreSQL 18.4; isolated fixture directory', fixtureDirectory: directory,
  }, null, 2));
} finally {
  await browser?.close();
  await web?.close();
  await stopChild(api);
  await client?.end();
  await database?.stop();
}
console.info(`Foundation verification complete: ${results.length} checks.`);
