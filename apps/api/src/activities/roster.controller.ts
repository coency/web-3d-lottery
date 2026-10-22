import { Controller,Get,Post,Param,Req,Res,HttpCode } from '@nestjs/common';
import type { Request,Response } from 'express';
import { envelope } from '../http';
import { RosterService } from './roster.service';
@Controller('api/v1/activities/:id')
export class RosterController{
 constructor(private service:RosterService){}
 @Get('participants')
 async list(@Req() r:Request,@Param('id') id:string,@Res({passthrough:true}) s:Response){return envelope(await this.service.list(r,id),s);}
 @Get('exports')
 async exports(@Req() r:Request,@Param('id') id:string,@Res({passthrough:true}) s:Response){return envelope(await this.service.exports(r,id),s);}
 @Post('exports') @HttpCode(200)
 async create(@Req() r:Request,@Param('id') id:string,@Res({passthrough:true}) s:Response){return envelope(await this.service.createExport(r,id),s);}
 @Get('exports/:jobId')
 async status(@Req() r:Request,@Param('id') id:string,@Param('jobId') job:string,@Res({passthrough:true}) s:Response){return envelope(await this.service.exportStatus(r,id,job),s);}
 @Get('exports/:jobId/download')
 async download(@Req() r:Request,@Param('id') id:string,@Param('jobId') job:string,@Res() s:Response){
  const result=await this.service.exportStatus(r,id,job,true);
  s.setHeader('Content-Disposition',"attachment; filename=checkin.xlsx; filename*=UTF-8''"+encodeURIComponent(result.filename!));
  s.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(result.bytes);
 }
}
