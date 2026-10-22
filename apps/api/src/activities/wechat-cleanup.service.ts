import {Injectable,OnModuleInit,OnModuleDestroy} from '@nestjs/common';
import {DatabaseService} from '../database.service';

const ENTRY_BATCH=10,ROW_BATCH=200;

@Injectable()
export class WechatCleanupService implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;
 private running?:Promise<void>;
 private cursor='';
 constructor(private db:DatabaseService){}
 onModuleInit(){
  const tick=()=>{void this.sweep().catch(()=>console.error('[wechat-cleanup] cleanup deferred; will retry'));};
  this.timer=setInterval(tick,60000);this.timer.unref();tick();
 }
 async onModuleDestroy(){if(this.timer)clearInterval(this.timer);await this.running?.catch(()=>{});}
 sweep(){
  if(!this.running)this.running=this.cleanBatch().finally(()=>{this.running=undefined;});
  return this.running;
 }
 private async cleanBatch(){
  // Keyset traversal also visits entries containing only orphan avatars. Busy
  // entries are skipped this pass and revisited on the next traversal.
  const entries=await this.db.transaction(async c=>(await c.query(
   `SELECT e.code,e.activity_id,e.run_id,a.owner_id FROM join_entries e
    JOIN activities a ON a.id=e.activity_id WHERE e.code>$1 ORDER BY e.code LIMIT $2`,
   [this.cursor,ENTRY_BATCH])).rows);
  for(const entry of entries){
   await this.db.transaction(async c=>{
    // Match signup/callback/reset lock order. In particular, do not delete an
    // avatar while a check-in that just read a valid session is committing it.
    if(!(await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE SKIP LOCKED',[entry.owner_id])).rowCount)return;
    if(!(await c.query('SELECT id FROM activities WHERE id=$1 FOR UPDATE SKIP LOCKED',[entry.activity_id])).rowCount)return;
    if(!(await c.query('SELECT id FROM activity_runs WHERE id=$1 FOR UPDATE SKIP LOCKED',[entry.run_id])).rowCount)return;
    await c.query(`DELETE FROM wechat_oauth_states WHERE token_hash IN
     (SELECT token_hash FROM wechat_oauth_states WHERE entry_code=$1 AND expires_at<=clock_timestamp()
      ORDER BY expires_at,token_hash LIMIT $2)`,[entry.code,ROW_BATCH]);
    await c.query(`DELETE FROM participant_sessions WHERE token_hash IN
     (SELECT token_hash FROM participant_sessions WHERE entry_code=$1 AND expires_at<=clock_timestamp()
      ORDER BY expires_at,token_hash LIMIT $2)`,[entry.code,ROW_BATCH]);
    // Keep even expired sessions until their own batch is removed (FK), and
    // preserve all roster/history references, including invalidated awards.
    await c.query(`DELETE FROM join_avatars WHERE id IN (
     SELECT a.id FROM join_avatars a WHERE a.entry_code=$1
      AND NOT EXISTS(SELECT 1 FROM participant_sessions s WHERE s.avatar_id=a.id)
      AND NOT EXISTS(SELECT 1 FROM activity_participants p
       WHERE p.avatar_url='/api/v1/join/'||a.entry_code||'/avatar/'||a.id::text)
      AND NOT EXISTS(SELECT 1 FROM draw_awards w
       WHERE w.display_snapshot->>'avatarUrl'='/api/v1/join/'||a.entry_code||'/avatar/'||a.id::text)
     ORDER BY a.created_at,a.id LIMIT $2)`,[entry.code,ROW_BATCH]);
   });
   this.cursor=entry.code;
  }
  if(entries.length<ENTRY_BATCH)this.cursor='';
 }
}
