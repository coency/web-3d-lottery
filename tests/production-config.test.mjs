import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProduction } from '../scripts/check-production.mjs';
const valid = { NODE_ENV: 'production', APP_ORIGIN: 'https://lottery.company.cn', DATABASE_URL: 'postgresql://app:secret@127.0.0.1:5432/app', AUTH_SECRET: 'a'.repeat(64), WECHAT_MASTER_KEY: 'b'.repeat(64), API_HOST: '127.0.0.1', API_PORT: '3000', TRUST_PROXY: 'loopback', ASSET_DIRECTORY: '/var/lib/starlit/uploads', WECHAT_OAUTH_PROVIDER: 'wechat' };
test('accept production template topology with real configuration', () => assert.deepEqual(validateProduction(valid), []));
test('reject mock providers, placeholders and public API binding', () => {
  for (const [key, value] of Object.entries({ NODE_ENV: 'development', WECHAT_OAUTH_PROVIDER: 'mock', API_HOST: '0.0.0.0', APP_ORIGIN: 'https://lottery.example.com', AUTH_SECRET: 'CHANGE_ME', ASSET_DIRECTORY: 'uploads' })) {
    assert.ok(validateProduction({ ...valid, [key]: value }).length, key);
  }
});
test('reject malformed origins, database URLs and keys without leaking values', () => {
  for (const origin of ['http://company.cn', 'https://company.cn/', 'https://user:private@company.cn']) assert.ok(validateProduction({ ...valid, APP_ORIGIN: origin }).length);
  const errors = validateProduction({ ...valid, DATABASE_URL: 'bad-private-password', WECHAT_MASTER_KEY: 'private-secret' }).join('\n');
  assert.match(errors, /DATABASE_URL/); assert.match(errors, /WECHAT_MASTER_KEY/); assert.doesNotMatch(errors, /private/);
});
