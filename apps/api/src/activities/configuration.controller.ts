import { Controller,Get,Put,Post,Param,Req,Res,HttpCode } from '@nestjs/common';
import type { Request,Response } from 'express';
import { ConfigurationService } from './configuration.service';
import { envelope } from '../http';
import { fail } from '../auth/security';
@Controller('api/v1/activities/:id')
export class ConfigurationController{
 constructor(private service:ConfigurationService){}
 @Get('configuration')
 async get(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.get(r,id),s);}
 @Put('configuration/:section')
 async save(@Param('id') id:string,@Param('section') section:string,@Req() r:Request,@Res({passthrough:true}) s:Response){
 if(section!=='form'&&section!=='rule'&&section!=='prizes'&&section!=='checkin'&&section!=='prize-settings')fail(404,'NOT_FOUND','配置入口不存在');
 return envelope(await this.service.save(r,id,section),s);}
 @Post('form-preview') @HttpCode(200)
 async preview(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.preview(r,id),s);}
 @Post('mode/:action') @HttpCode(200)
 async mode(@Param('id') id:string,@Param('action') action:string,@Req() r:Request,@Res({passthrough:true}) s:Response){
 if(action!=='clear-rehearsal'&&action!=='reset-draw'&&action!=='promote')fail(404,'NOT_FOUND','模式操作不存在');
 return envelope(await this.service.mode(r,id,action),s);}
 @Post('rehearsal/simulated-participants') @HttpCode(200)
 async simulate(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.simulate(r,id),s);}
}
