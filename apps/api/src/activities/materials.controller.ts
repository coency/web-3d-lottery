import {Controller,Get,Put,Param,Req,Res} from '@nestjs/common';
import type {Request,Response} from 'express';
import {DatabaseService} from '../database.service';
import {ActivitiesService} from './activities.service';
import {envelope} from '../http';
import {fail,validateWrite} from '../auth/security';
import {materialsInput,readMaterials,writeMaterials} from './materials';
@Controller('api/v1/activities/:id/materials')
export class MaterialsController{
 constructor(private db:DatabaseService,private activities:ActivitiesService){}
 @Get() async get(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){
  res.setHeader('Cache-Control','no-store');
  return envelope(await this.db.transaction(async c=>{
   const user=await this.activities.identity(c,req),activity=await this.activities.access(c,user.id,id);
   const content=await readMaterials(c,id);
   return {...content,version:activity.version,images:content.images.map(image=>({...image,url:'/api/v1/assets/'+image.id+'/content'}))};
  }),res);
 }
 @Put() async save(@Param('id') id:string,@Req() req:Request,@Res({passthrough:true}) res:Response){
  validateWrite(req);const content=materialsInput(req.body);
  return envelope(await this.db.transaction(async c=>{
   const user=await this.activities.identity(c,req);
   // Lock the activity before checking the idempotency receipt, including concurrent retries.
   const activity=await this.activities.access(c,user.id,id,true);
   return this.activities.receipt(c,user.id,req,'activity-materials:'+id,{content,version:req.get('if-match')},async()=>{
    if(req.get('if-match')!==String(activity.version))fail(409,'VERSION_CONFLICT','活动已更新，本次资料未保存，请重新加载后再试');
    await writeMaterials(c,id,user.id,content);
    const version=(await c.query('UPDATE activities SET version=version+1 WHERE id=$1 RETURNING version',[id])).rows[0].version;
    await this.activities.audit(c,user.id,user.id,'materials_updated',{type:content.type,imageCount:content.images.length},id);
    return {version};
   });
  }),res);
 }
}
