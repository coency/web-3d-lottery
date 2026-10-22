import { Controller, Get, Req, Res, OnApplicationShutdown } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { DatabaseService } from './database.service';
import { AuthService } from './auth/auth.service';
import { cookie, fail } from './auth/security';

@Controller('api/v1/events')
export class RealtimeController implements OnApplicationShutdown {
 private streams = new Map<Response,string>();
 constructor(private db:DatabaseService, private auth:AuthService){}
 @Get()
 async events(@Req() req:Request,@Res() res:Response){
  const raw=cookie(req,'starlit_session');
  const user=await this.auth.me(raw);
  if([...this.streams.values()].filter(id=>id===user.id).length>=6)fail(429,'STREAM_LIMIT','实时连接过多，请关闭不用的页面');
  if(res.destroyed)return;
  this.streams.set(res,user.id);
  res.setHeader('Content-Type','text/event-stream');
  res.setHeader('Cache-Control','no-cache, no-store');
  res.setHeader('X-Accel-Buffering','no');
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  let closed=false, previous='',beats=0,timer:ReturnType<typeof setTimeout>;
  const close=()=>{closed=true;clearTimeout(timer);this.streams.delete(res);res.end();};
  res.on('close',close);
  const send=(event:string,data:unknown,id?:string)=>res.write((id?'id: '+id+'\n':'')+'event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
  const tick=async()=>{
   try{
    const snapshot=await this.db.transaction(async c=>{
     const current=await this.auth.session(c,raw);
     if(!current)return null;
     return (await c.query(`SELECT a.id,a.phase,r.revision::text,a.expires_at<=clock_timestamp() AS ended
       FROM activities a JOIN activity_revisions r ON r.activity_id=a.id
       WHERE a.owner_id=$1 ORDER BY a.id`,[current.id])).rows;
    });
    if(closed)return;
    if(!snapshot){send('session-expired',{});close();return;}
    const version=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    // Every connection starts with a snapshot notification, including after a server restart.
    // Changes are coalesced; clients always fetch authorized current state, never replay writes.
    if(version!==previous){if(!send('sync',{activities:snapshot.map(x=>({id:x.id,revision:x.revision,ended:x.ended,phase:x.ended?'expired':x.phase}))},version)){close();return;}previous=version;}
    else if(++beats%15===0&&!res.write(': heartbeat\n\n')){close();return;}
   }catch{if(!closed){send('unavailable',{});close();}return;}
   if(!closed)timer=setTimeout(()=>void tick(),1000);
  };
  void tick();
 }
 onApplicationShutdown(){for(const res of this.streams.keys())res.end();}
}
