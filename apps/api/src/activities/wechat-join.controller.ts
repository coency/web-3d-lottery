import {Controller,Get,Post,HttpCode,Param,Req,Res} from '@nestjs/common';
import type {Request,Response} from 'express';
import {envelope} from '../http';
import {WechatJoinService} from './wechat-join.service';
@Controller('api/v1')
export class WechatJoinController {
 constructor(private service:WechatJoinService){}
 @Get('activities/:id/join-entry') async entry(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.entry(r,id),s);}
 @Get('join/:code') async me(@Param('code') code:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.me(r,code),s);}
 @Get('join/:code/materials') async materials(@Param('code') code:string,@Req() r:Request,@Res({passthrough:true}) s:Response){s.setHeader('Cache-Control','no-store');return envelope(await this.service.materials(r,code),s);}
 @Get('join/:code/materials/images/:id') async materialImage(@Param('code') code:string,@Param('id') id:string,@Req() r:Request,@Res() s:Response){s.setHeader('Cache-Control','no-store');s.type('image/webp').send(await this.service.materials(r,code,id));}
 @Post('join/:code/authorize') @HttpCode(200) async start(@Param('code') code:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.start(r,s,code),s);}
 @Get('wechat/callback') async callback(@Req() r:Request,@Res() s:Response){s.redirect(303,await this.service.callback(r,s));}
 @Post('join/:code/checkins') @HttpCode(200) async checkin(@Param('code') code:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.checkin(r,code),s);}
 @Get('join/:code/image/:kind') async image(@Param('code') code:string,@Param('kind') kind:string,@Res() s:Response){s.type('image/webp').send(await this.service.image(code,kind));}
 @Get('join/:code/avatar/:id') async avatar(@Param('code') code:string,@Param('id') id:string,@Res() s:Response){s.type('image/webp').send(await this.service.avatar(code,id));}
}
