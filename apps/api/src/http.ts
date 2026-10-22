import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthError } from './auth/security';
import type { Request, Response } from 'express';
import type { ApiResponse, ApiError } from '@starlit/contracts';

export function requestMetadata(req: Request, res: Response, next: () => void) {
  res.locals.traceId = randomUUID();
  res.setHeader('X-Request-Id', res.locals.traceId);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const start = performance.now();
  res.on('finish', () => console.info(JSON.stringify({ traceId: res.locals.traceId,
    method: req.method, status: res.statusCode, durationMs: Math.round(performance.now() - start) })));
  next();
}
export function envelope<T>(data: T, res: Response): ApiResponse<T> {
  return { data, serverTime: new Date().toISOString(), traceId: res.locals.traceId };
}
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const tooLarge = !!exception && typeof exception==='object' && 'type' in exception && exception.type==='entity.too.large';
    const status = tooLarge ? 413 : exception instanceof HttpException ? exception.getStatus() : 500;
    if(status===500){
      // Log only a safe diagnostic code, never SQL, parameters or provider secrets.
      const candidate=(exception as {code?:unknown})?.code;
      console.error(JSON.stringify({traceId:response.locals.traceId,errorCode:typeof candidate==='string'&&/^[A-Z0-9_]{5,40}$/.test(candidate)?candidate:'UNEXPECTED_ERROR'}));
    }
    const code = status === 413 ? 'BODY_TOO_LARGE' : status === 404 ? 'NOT_FOUND' : status === 503 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR';
    const message = status === 413 ? '上传内容过大，Logo 最大 5MB、背景最大 10MB' : status === 404 ? '接口不存在' : status === 503 ? '数据库暂不可用或尚未完成迁移' : '服务暂时不可用';
    const body: ApiError = { error: exception instanceof AuthError ? exception.getResponse() as ApiError['error'] : { code, message, retryable: status >= 500 },
      serverTime: new Date().toISOString(), traceId: response.locals.traceId };
    response.status(status).json(body);
  }
}
