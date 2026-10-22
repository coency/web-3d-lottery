import type { Client } from 'pg';
import * as argon from 'argon2';
import { account, password, fields, fail } from './security';

/** Server-side maintenance only. Never expose this function through an HTTP controller. */
export async function manageLocalAccount(client: Client, action: 'init' | 'reset-password', input: unknown) {
  if (!['init', 'reset-password'].includes(action)) fail(422, 'INVALID_ACTION', '不支持的账号维护操作');
  const values = fields(input, ['account', 'password']);
  const name = account(values.account);
  const encoded = await argon.hash(password(values.password), {type: argon.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1});
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query('SELECT pg_advisory_xact_lock(782146017)');
    let id: string;
    if (action === 'init') {
      if ((await client.query('SELECT 1 FROM users LIMIT 1')).rowCount) fail(409, 'ALREADY_INITIALIZED', '系统已有账号，不能重复初始化；忘记密码请使用 reset-password');
      id = (await client.query("INSERT INTO users(login_name,password_hash,role) VALUES($1,$2,'user') RETURNING id", [name,encoded])).rows[0].id;
      await client.query('INSERT INTO entitlements(user_id) VALUES($1)', [id]);
    } else {
      const user = (await client.query('SELECT id,status FROM users WHERE coalesce(login_name,substring(phone from 4))=$1 FOR UPDATE', [name])).rows[0];
      if (!user) fail(404,'ACCOUNT_NOT_FOUND','账号不存在，请确认完整登录账号');
      if (user.status !== 'active') fail(409,'ACCOUNT_DISABLED','账号已停用，不能通过重置密码启用');
      id = user.id;
      await client.query('UPDATE users SET password_hash=$2,login_version=login_version+1 WHERE id=$1', [id,encoded]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    }
    await client.query('INSERT INTO auth_audit(user_id,action) VALUES($1,$2)', [id,action==='init'?'local_account_initialized':'local_password_reset']);
    await client.query('COMMIT');
    return {id,account:name};
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
