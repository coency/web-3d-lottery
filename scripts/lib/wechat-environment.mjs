import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {root} from './config.mjs';
export async function prepareWechatEnvironment(){
 if(process.env.NODE_ENV!=='development')throw new Error('Development key setup only');
 if(process.env.WECHAT_MASTER_KEY)return;
 const directory=path.join(root,'.local'),file=path.join(directory,'wechat-master-key');
 await mkdir(directory,{recursive:true});
 try{await writeFile(file,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}
 catch(error){if(error.code!=='EEXIST')throw error;}
 process.env.WECHAT_MASTER_KEY=(await readFile(file,'utf8')).trim();
 if(!/^[0-9a-f]{64}$/i.test(process.env.WECHAT_MASTER_KEY))throw new Error('Invalid local WeChat master key');
}
