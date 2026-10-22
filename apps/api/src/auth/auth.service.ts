import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { Request } from 'express';
import * as argon from 'argon2';
import { DatabaseService } from '../database.service';
import { password, loginInput, fields, fail, mac, digest, token, seal, unseal, cookie, equal } from './security';
type User = { id: string; phone: string | null; login_name: string | null; password_hash: string; role: string; status: string; login_version: string };
type Fault = { status: number; code: string; message: string };
type Receipt = { payloadHash?: string; data?: unknown; session?: string; fault?: Fault };
const fault = (status: number, code: string, message: string): Receipt => ({ fault: { status, code, message } });
const publicUser = (user: User) => {
  const name = user.login_name ?? user.phone!.slice(3);
  return { id: user.id, account: /^1\d{10}$/.test(name) ? name.slice(0,3)+'****'+name.slice(-4) : name, role: user.role,
    ...(user.phone ? {phone: user.phone.slice(3,6)+'****'+user.phone.slice(-4)} : {}) };
};
const hash = (value: string) => argon.hash(value, { type: argon.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
@Injectable()
export class AuthService {
  private dummy = hash(token());
  constructor(private readonly db: DatabaseService) {}

  async rate(scope: string, subject: string, cap: number, seconds: number) {
    const result = await this.db.transaction(async client => {
      const { rows } = await client.query(`INSERT INTO auth_limits(key,hits) VALUES ($1,1)
        ON CONFLICT(key) DO UPDATE SET
        hits=CASE WHEN auth_limits.started_at + $2 * interval '1 second' <= clock_timestamp() THEN 1 ELSE auth_limits.hits+1 END,
        started_at=CASE WHEN auth_limits.started_at + $2 * interval '1 second' <= clock_timestamp() THEN clock_timestamp() ELSE auth_limits.started_at END
        RETURNING hits`, [mac(scope + ':' + subject), seconds]);
      return rows[0].hits <= cap;
    });
    if (!result) fail(429, 'RATE_LIMITED', '操作过于频繁，请稍后再试');
  }

  async operation(key: string, action: string, body: unknown, req: Request) {
    if (!['login','logout','change-password'].includes(action)) return fault(404,'NOT_FOUND','接口不存在');
    const requestHash = mac(action + ':' + JSON.stringify(body) + (['logout','change-password'].includes(action) ? ':' + digest(cookie(req, 'starlit_session')) : ''));
    return this.db.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
      const old = (await client.query('SELECT request_hash,receipt,expires_at > clock_timestamp() AS active FROM auth_operations WHERE key=$1', [key])).rows[0];
      if (old) {
        if (!old.active) return fault(409, 'OPERATION_EXPIRED', '操作已过期，请重新提交');
        const receipt = unseal<Receipt>(old.receipt);
        // A response may set the new cookie before its body is lost. Accept only
        // that exact replacement session and identical payload on the same key.
        const rotatedRetry=receipt.session&&(action==='change-password')
          &&equal(cookie(req,'starlit_session'),receipt.session)
          &&receipt.payloadHash===mac(action+':'+JSON.stringify(body));
        if(old.request_hash!==requestHash&&!rotatedRetry)return fault(409,'OPERATION_CONFLICT','操作编号已用于其他请求');
        if (receipt.session && !(await this.session(client, receipt.session))) return fault(401, 'SESSION_REPLACED', '该次登录已失效，请重新登录');
        return receipt;
      }
      // A lock and one transaction make account changes and receipts atomic.
      const receipt = await this.execute(client, action, body, req);
      if(action==='change-password')receipt.payloadHash=mac(action+':'+JSON.stringify(body));
      await client.query('INSERT INTO auth_operations(key,request_hash,receipt) VALUES ($1,$2,$3)', [key, requestHash, seal(receipt)]);
      return receipt;
    });
  }

  async session(client: PoolClient, raw: string): Promise<User | undefined> {
    if (!/^[0-9a-f]{64}$/.test(raw)) return;
    const session = (await client.query('SELECT user_id FROM sessions WHERE token_hash=$1', [digest(raw)])).rows[0];
    if (!session) return;
    // All future user business writes must use this same user lock before activity/run locks.
    const user = (await client.query<User>('SELECT * FROM users WHERE id=$1 FOR UPDATE', [session.user_id])).rows[0];
    if (!user || user.status !== 'active') return;
    const valid = (await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2
      AND login_version=$3 AND expires_at > clock_timestamp()`, [digest(raw), user.id, user.login_version])).rowCount;
    return valid ? user : undefined;
  }

  async me(raw: string) {
    return this.db.transaction(async client => {
      const user = await this.session(client, raw);
      if (!user) fail(401, 'SESSION_INVALID', '登录已失效，请重新登录');
      return publicUser(user);
    });
  }
  private async audit(client: PoolClient, user: string, action: string) {
    await client.query('INSERT INTO auth_audit(user_id,action) VALUES ($1,$2)', [user, action]);
  }
  private async execute(client: PoolClient, action: string, body: unknown, req: Request): Promise<Receipt> {
    if (action === 'login') {
      const {account: name, password: pw} = loginInput(body);
      const user = (await client.query<User>('SELECT * FROM users WHERE coalesce(login_name,substring(phone from 4))=$1 FOR UPDATE', [name])).rows[0];
      const valid = await argon.verify(user?.password_hash ?? await this.dummy, pw);
      if (!valid || !user || user.status !== 'active') return fault(401, 'LOGIN_REJECTED', '账号或密码不正确，或账号不可用');
      await client.query('UPDATE users SET login_version=login_version+1 WHERE id=$1', [user.id]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
      const raw = token();
      await client.query(`INSERT INTO sessions(user_id,token_hash,login_version,expires_at)
        SELECT id,$2,login_version,clock_timestamp()+interval '24 hours' FROM users WHERE id=$1`, [user.id,digest(raw)]);
      await this.audit(client,user.id,'logged_in');
      return { data: publicUser(user), session: raw };
    }
    if(action==='change-password'){
      const b=fields(body,['currentPassword','newPassword']);
      const user=await this.session(client,cookie(req,'starlit_session'));
      if(!user)fail(401,'SESSION_INVALID','登录已失效，请重新登录');
      if(!await argon.verify(user.password_hash,password(b.currentPassword)))return fault(422,'PASSWORD_REJECTED','当前密码不正确');
      const encoded=await hash(password(b.newPassword));
      await client.query('UPDATE users SET password_hash=$2,login_version=login_version+1 WHERE id=$1',[user.id,encoded]);
      await client.query('DELETE FROM sessions WHERE user_id=$1',[user.id]);
      const raw=token();
      await client.query("INSERT INTO sessions(user_id,token_hash,login_version,expires_at) SELECT id,$2,login_version,clock_timestamp()+interval '24 hours' FROM users WHERE id=$1",[user.id,digest(raw)]);
      await this.audit(client,user.id,'password_changed');
      return {data:publicUser(user),session:raw};
    }
    if (action === 'logout') {
      fields(body, []);
      const raw = cookie(req,'starlit_session');
      const user = await this.session(client, raw);
      if (user) {
        await client.query('DELETE FROM sessions WHERE token_hash=$1', [digest(raw)]);
        await this.audit(client,user.id,'logged_out');
      }
      return { data: { message: '已退出登录' } };
    }
    return fault(404,'NOT_FOUND','接口不存在');
  }
}
