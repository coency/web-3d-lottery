import {Controller,Get,Injectable,Logger,NotFoundException,OnModuleDestroy,Param,Res} from '@nestjs/common';
import type {Response} from 'express';
import path from 'node:path';
import {DatabaseService} from '../database.service';
import {SimulationPortraitStore} from './simulation-portrait-store';

@Injectable()
export class SimulationPortraitService implements OnModuleDestroy {
 private readonly logger=new Logger(SimulationPortraitService.name);
 private readonly store=new SimulationPortraitStore(path.resolve(process.env.ASSET_DIRECTORY??path.join(process.cwd(),'.local','uploads'),'simulation','portraits-v1'));
 constructor(private readonly db:DatabaseService){}
 prepare(target:number){void this.store.warm(target).catch(()=>this.logger.warn('模拟头像准备失败；请求头像时将重试，请检查上传目录权限和磁盘空间。'));}
 async image(filename:string){
  if(!/^[1-9]\d{0,3}\.webp$/.test(filename))throw new NotFoundException();
  const id=Number(filename.slice(0,-5));if(id>5000)throw new NotFoundException();
  const cached=await this.store.cached(id);if(cached)return cached;
  // Old participant URLs keep working after an upgrade. Anonymous requests must
  // not create arbitrary portraits before any simulated participants exist.
  const exists=await this.db.transaction(async c=>(await c.query(
   'SELECT 1 FROM activity_participants WHERE identity_key=$1 AND avatar_url=$2 LIMIT 1',
   ['rehearsal-simulation-'+id,'/demo-avatars/portraits-v1/'+filename])).rowCount);
  if(!exists)throw new NotFoundException();
  return this.store.ensure(id);
 }
 async onModuleDestroy(){await this.store.close();}
}

@Controller('demo-avatars/portraits-v1')
export class SimulationPortraitController {
 constructor(private readonly portraits:SimulationPortraitService){}
 @Get(':filename')
 async image(@Param('filename')filename:string,@Res()response:Response){
  const bytes=await this.portraits.image(filename);
  response.set({'Content-Type':'image/webp','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}).send(bytes);
 }
}
