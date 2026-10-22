import { Controller, Get, Post, Patch, Put, Param, Req, Res, HttpCode } from '@nestjs/common';
import type { Request,Response } from 'express';
import { envelope } from '../http';
import { ActivitiesService } from './activities.service';
@Controller('api/v1')
export class ActivitiesController {
 constructor(private service:ActivitiesService){}
 @Get('entitlements/me')
 async mine(@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.mine(r),s);}
 @Get('activities')
 async list(@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.list(r),s);}
 @Get('activities/:id')
 async detail(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.list(r,id),s);}
 @Get('activities/:id/audit')
 async audit(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.operations(r,id),s);}
 @Post('activities') @HttpCode(200)
 async create(@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.save(r),s);}
 @Patch('activities/:id')
 async update(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.save(r,id),s);}
 @Patch('activities/:id/checkin-settings')
 async checkin(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.saveCheckin(r,id),s);}
 @Post('assets/uploads') @HttpCode(200)
 async authorize(@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.authorizeUpload(r),s);}
 @Put('assets/:id/content')
 async upload(@Param('id') id:string,@Req() r:Request,@Res({passthrough:true}) s:Response){return envelope(await this.service.upload(r,id),s);}
 @Get('assets/:id/content')
 async image(@Param('id') id:string,@Req() r:Request,@Res() s:Response){const bytes=await this.service.image(r,id);s.type('image/webp').send(bytes);}
}
