import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const root = fileURLToPath(new URL('../../', import.meta.url));
export function loadEnvironment() {
  config({ path: path.join(root, '.env'), quiet: true });
  process.env.NODE_ENV ??= 'development';
}
export function port(value, fallback, label) {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`Invalid ${label}`);
  return parsed;
}
export function requireDevelopment() {
  if (process.env.NODE_ENV !== 'development') throw new Error('This command is development-only');
}
