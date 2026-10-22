import {createRequire} from 'node:module';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
const argon=require('argon2');

// Integration fixtures only. Production provisioning is scripts/account.mjs.
export async function provisionFixtureAccount(sql,phone,password){
  if(process.env.NODE_ENV!=='development')throw new Error('Account fixtures are development-only');
  if(!/^1\d{10}$/.test(phone))throw new Error('Invalid fixture phone');
  const encoded=await argon.hash(password,{type:argon.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
  const user=(await sql.query('INSERT INTO users(phone,login_name,password_hash) VALUES($1,$2,$3) RETURNING id',['+86'+phone,phone,encoded])).rows[0];
  await sql.query('INSERT INTO entitlements(user_id) VALUES($1)',[user.id]);
  return user;
}
