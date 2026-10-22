import { HttpException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Request, Response } from 'express';
export class AuthError extends HttpException {
  constructor(status: number, code: string, message: string) { super({ code, message, retryable: status === 429 || status === 503 }, status); }
}
export function fail(status: number, code: string, message: string): never { throw new AuthError(status, code, message); }
export function secret() {
  const key = process.env.AUTH_SECRET;
  if (!key || key.length < 64) throw new Error('AUTH_SECRET must contain at least 64 characters');
  return key;
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const mac = (value: string) => createHmac('sha256', secret()).update(value).digest('hex');
export const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const token = () => randomBytes(32).toString('hex');
export function cookie(req: Request, name: string) {
  return (req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) ?? '';
}
export function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV !== 'development', sameSite: 'lax' as const, path: '/', maxAge };
}
export function issueCsrf(res: Response, req?: Request) {
  const existing = req ? cookie(req, 'starlit_csrf') : '';
  const parts = existing.split('.');
  if (parts.length === 3 && Number(parts[1]) > Date.now() &&
      equal(parts[2] ?? '', mac('csrf:' + parts.slice(0, 2).join('.')))) return existing;
  const value = token() + '.' + (Date.now() + 3600000);
  const csrf = value + '.' + mac('csrf:' + value);
  res.cookie('starlit_csrf', csrf, cookieOptions(3600000));
  return csrf;
}
export function validateWrite(req: Request, contentType = 'application/json') {
  if (req.headers.origin !== process.env.APP_ORIGIN) fail(403, 'ORIGIN_REJECTED', '请求来源不允许');
  if (!req.is(contentType)) fail(415, 'JSON_REQUIRED', '请求内容类型不正确');
  const header = req.get('x-csrf-token') ?? '';
  const parts = header.split('.');
  const value = parts.slice(0, 2).join('.');
  if (parts.length !== 3 || !equal(header, cookie(req, 'starlit_csrf')) ||
      !equal(parts[2] ?? '', mac('csrf:' + value)) || Number(parts[1]) <= Date.now() || !Number.isFinite(Number(parts[1]))) {
    fail(403, 'CSRF_REJECTED', '页面凭据已失效，请刷新后重试');
  }
  const key = req.get('idempotency-key') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    fail(422, 'OPERATION_KEY_REQUIRED', '缺少有效操作编号');
  }
  return mac('operation:' + header + ':' + key);
}
export function seal(data: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(mac('receipt-key'), 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function unseal<T>(value: string): T {
  const bytes = Buffer.from(value, 'base64');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(mac('receipt-key'), 'hex'), bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')) as T;
}
export function fields(body: unknown, names: string[]): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !names.includes(k))) {
    fail(422, 'INVALID_FIELDS', '提交字段不正确');
  }
  const value = body as Record<string, unknown>;
  if (names.some(k => typeof value[k] !== 'string')) fail(422, 'INVALID_FIELDS', '请填写完整信息');
  return value as Record<string, string>;
}
export function phone(value: string | undefined) {
  const result = (typeof value === 'string' ? value : '').replace(/^\+86/, '');
  if (!/^1\d{10}$/.test(result)) fail(422, 'INVALID_PHONE', '请输入 11 位手机号');
  return '+86' + result;
}
export function password(value: string | undefined) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) fail(422, 'INVALID_PASSWORD', '密码长度须为 10–128 个字符');
  return value;
}
export function account(value: unknown) {
  const result = typeof value === 'string' ? value.trim().toLowerCase().replace(/^\+86(?=1\d{10}$)/, '') : '';
  if (!/^[a-z0-9_][a-z0-9_.-]{3,31}$/.test(result)) fail(422, 'INVALID_ACCOUNT', '账号须为 4–32 位字母、数字、下划线、点或短横线，首位须为字母、数字或下划线');
  return result;
}
export function loginInput(body: unknown) {
  // Accept the previous client payload during upgrades; both paths use the same account limiter.
  const legacy = !!body && typeof body === 'object' && Object.hasOwn(body, 'phone');
  const b = fields(body, [legacy ? 'phone' : 'account', 'password']);
  return { account: account(legacy ? phone(b.phone) : b.account), password: password(b.password) };
}
