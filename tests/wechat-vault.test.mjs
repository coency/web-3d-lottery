import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import vault from '../apps/api/build/activities/wechat-vault.js';
const {sealSecret,openSecret,vaultReady}=vault;
test('envelope encryption binds each credential version and detects tampering or wrong master key',()=>{
 process.env.WECHAT_MASTER_KEY=randomBytes(32).toString('hex');
 const id=randomUUID(),value='fake-secret-for-encryption-test',box=sealSecret(value,id);
 assert.equal(openSecret(box,id),value);assert.ok(!JSON.stringify(box).includes(value));
 assert.notDeepEqual(box,sealSecret(value,id));
 assert.throws(()=>openSecret(box,randomUUID()),e=>e.getStatus()===503);
 const corrupted=structuredClone(box);corrupted.secret.data=Buffer.from('wrong ciphertext').toString('base64');
 assert.throws(()=>openSecret(corrupted,id),e=>e.getStatus()===503);
 process.env.WECHAT_MASTER_KEY=randomBytes(32).toString('hex');
 assert.throws(()=>openSecret(box,id),e=>e.getStatus()===503);
 delete process.env.WECHAT_MASTER_KEY;assert.equal(vaultReady(),false);
 assert.throws(()=>sealSecret(value,id),e=>e.getStatus()===503);
});
