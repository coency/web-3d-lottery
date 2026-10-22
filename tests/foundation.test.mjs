import test from 'node:test';
import assert from 'node:assert/strict';
import { port, requireDevelopment } from '../scripts/lib/config.mjs';
test('ports reject invalid and out-of-range values before starting services', () => {
  assert.equal(port(undefined, 3000, 'API_PORT'), 3000);
  assert.equal(port('5173', 3000, 'API_PORT'), 5173);
  for (const value of ['0', '-1', '65536', '1.5', 'hello']) assert.throws(() => port(value, 3000, 'API_PORT'));
});
test('local database tooling fails closed outside explicit development mode', () => {
  const previous = process.env.NODE_ENV;
  try {
    for (const value of ['production', 'test', '']) {
      process.env.NODE_ENV = value;
      assert.throws(requireDevelopment, /development-only/);
    }
    process.env.NODE_ENV = 'development';
    assert.doesNotThrow(requireDevelopment);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
