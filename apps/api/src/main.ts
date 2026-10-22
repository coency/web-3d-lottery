import {oauthProvider} from './activities/wechat-provider';
import 'reflect-metadata';
import { raw, json } from 'express';
import { NestFactory } from '@nestjs/core';
import { secret } from './auth/security';
import { AppModule } from './app.module';
import { requestMetadata, SafeExceptionFilter } from './http';

async function main() {
  secret();
  oauthProvider();
  const origin = new URL(process.env.APP_ORIGIN ?? '');
  if (origin.origin !== process.env.APP_ORIGIN || (process.env.NODE_ENV !== 'development' && origin.protocol !== 'https:')) throw new Error('APP_ORIGIN must be a valid origin, HTTPS outside development');
  const port = Number(process.env.API_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const app = await NestFactory.create(AppModule, { abortOnError: false, logger: ['warn', 'error'] });
  if (process.env.TRUST_PROXY) {
    if (process.env.TRUST_PROXY !== 'loopback' || (process.env.API_HOST ?? '127.0.0.1') !== '127.0.0.1') throw new Error('TRUST_PROXY requires the local reverse proxy topology');
    app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  }
  app.use(requestMetadata);
  app.use(json({limit:'256kb'}));
  app.use('/api/v1/assets', raw({type:'application/octet-stream',limit:'10mb'}));
  app.useGlobalFilters(new SafeExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(port, process.env.API_HOST ?? '127.0.0.1');
  console.info(`[api] listening on port ${port}`);
}
main().catch(() => {
  console.error('[api] Startup failed. Check DATABASE_URL, AUTH_SECRET, APP_ORIGIN and port availability.');
  process.exitCode = 1;
});
