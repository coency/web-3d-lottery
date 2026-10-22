import { Controller, Get, Post, Param, Req, Res, HttpCode } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthError, cookie, cookieOptions, issueCsrf, validateWrite, loginInput, fail } from './security';
import { envelope } from '../http';
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Get('csrf')
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) { return envelope({ csrfToken: issueCsrf(res,req) },res); }
  @Get('me')
  async me(@Req() req: Request,@Res({ passthrough: true }) res: Response) { return envelope(await this.auth.me(cookie(req,'starlit_session')),res); }
  @Post(':action')
  @HttpCode(200)
  async write(@Param('action') action: string,@Req() req: Request,@Res({ passthrough: true }) res: Response) {
    const key = validateWrite(req);
    await this.auth.rate('auth-ip', req.ip ?? 'unknown', 60, 60);
    if (!['login','logout','change-password'].includes(action)) fail(404,'NOT_FOUND','接口不存在');
    if (action === 'login') await this.auth.rate('login-account',loginInput(req.body).account,10,900);
    if(action==='change-password')await this.auth.rate('profile-session',cookie(req,'starlit_session'),10,900);
    const receipt = await this.auth.operation(key,action,req.body,req);
    if (receipt.fault) throw new AuthError(receipt.fault.status,receipt.fault.code,receipt.fault.message);
    if (receipt.session) res.cookie('starlit_session',receipt.session,cookieOptions(86400000));
    if (action === 'logout') res.clearCookie('starlit_session',cookieOptions(0));
    return envelope(receipt.data,res);
  }
}
