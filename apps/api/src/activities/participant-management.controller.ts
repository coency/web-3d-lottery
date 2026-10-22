import { Controller,Get,Patch,Post,Param,Req,Res,HttpCode } from '@nestjs/common';
import type {Request,Response} from 'express';
import { envelope } from '../http';
import { ParticipantManagementService } from './participant-management.service';
@Controller('api/v1/activities/:id/participants/:pid')
export class ParticipantManagementController{
 constructor(private service:ParticipantManagementService){}
 @Get()
 async detail(@Req() r:Request,@Param('id') id:string,@Param('pid') pid:string,@Res({passthrough:true}) s:Response){return envelope(await this.service.detail(r,id,pid),s);}
 @Patch('answers')
 async answers(@Req() r:Request,@Param('id') id:string,@Param('pid') pid:string,@Res({passthrough:true}) s:Response){return envelope(await this.service.change(r,id,pid,'answers'),s);}
 @Post('eligibility') @HttpCode(200)
 async eligibility(@Req() r:Request,@Param('id') id:string,@Param('pid') pid:string,@Res({passthrough:true}) s:Response){return envelope(await this.service.change(r,id,pid,'eligibility'),s);}
}
