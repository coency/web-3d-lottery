import { Controller,Get,Post,Param,Req,Res,HttpCode } from '@nestjs/common';
import type { Request,Response } from 'express';
import { envelope } from '../http';
import { DrawService } from './draw.service';
@Controller('api/v1/activities/:id')
export class DrawController{
 constructor(private service:DrawService){}
 @Get('stage-people')
 async people(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){return envelope(await this.service.people(req,id),res);}
 @Get('draw')
 async state(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){return envelope(await this.service.state(req,id),res);}
 @Get('draw/preflight')
 async preflight(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){return envelope(await this.service.state(req,id,true),res);}
 @Post('draw/:action') @HttpCode(200)
 async act(@Param('id') id:string,@Param('action') action:string,@Req() req:Request,@Res({passthrough:true}) res:Response){return envelope(await this.service.act(req,id,action),res);}
 @Get('awards')
 async records(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){return envelope(await this.service.records(req,id),res);}
 @Get('awards/download')
 async export(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const bytes=await this.service.export(req,id);res.setHeader('Cache-Control','no-store');res.setHeader('Content-Disposition','attachment; filename=awards.xlsx');res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(bytes);}
}
