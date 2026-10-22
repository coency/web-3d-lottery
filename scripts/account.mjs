import pg from 'pg';
import {createInterface, emitKeypressEvents} from 'node:readline';
import {stdin, stdout} from 'node:process';

const [action, ...extra] = process.argv.slice(2);
if (!action || action === '--help') {
  console.info('用法：node --env-file=/etc/starlit/production.env scripts/account.mjs init|reset-password\n账号和密码由交互提示输入，密码不回显。自动安装程序可通过 --stdin-json 从标准输入传递 {"account":"...","password":"..."}。\n必须先执行数据库迁移和 API 构建；不接受密码命令行参数。');
} else {
  let client;
  try {
    if (!['init','reset-password'].includes(action) || extra.some(x=>x!=='--stdin-json') || extra.length>1) throw new Error('用法不正确，请运行 --help；不要将密码放入命令行参数');
    if (!process.env.DATABASE_URL) throw new Error('请通过 --env-file 加载目标服务器配置（必须包含 DATABASE_URL）');
    let input;
    if (extra.includes('--stdin-json')) {
      let raw='';
      for await (const chunk of stdin) {
        raw+=chunk.toString();
        if (Buffer.byteLength(raw)>16384) throw new Error('输入内容过长');
      }
      try {input=JSON.parse(raw);} catch {throw new Error('标准输入必须是有效 JSON');}
    } else {
      if (!stdin.isTTY || !stdout.isTTY) throw new Error('需要交互终端；自动安装请使用 --stdin-json');
      const rl=createInterface({input:stdin,output:stdout});
      const name=await new Promise(resolve=>rl.question('登录账号：',resolve));
      rl.close();
      const first=await readPassword('设置密码（10–128 个字符）：');
      const second=await readPassword('再次输入密码：');
      if (first!==second) throw new Error('两次输入的密码不一致');
      input={account:name,password:first};
    }
    const {default:accounts}=await import('../apps/api/build/auth/local-accounts.js');
    client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
    await client.connect();
    await accounts.manageLocalAccount(client,action,input);
    console.info(action==='init'?'账号初始化完成，可使用设置的账号和密码登录。':'密码已重置，所有旧登录会话已失效，请重新登录。');
  } catch (error) {
    // Database and filesystem errors can contain connection strings or SQL parameters.
    const known=error?.constructor===Error && !error.code;
    const detail=typeof error?.getResponse==='function'?error.getResponse()?.message:known?error.message:null;
    console.error(detail || '账号维护失败，请检查数据库连接、迁移版本及 API 构建；未输出凭据。');
    process.exitCode=1;
  } finally {await client?.end();}
}

function readPassword(prompt) {
  return new Promise((resolve,reject)=>{
    let value='';
    const previousRaw=stdin.isRaw;
    stdout.write(prompt);
    emitKeypressEvents(stdin);stdin.setRawMode(true);stdin.resume();
    function finish(error) {
      stdin.removeListener('keypress',onKey);stdin.setRawMode(previousRaw);stdin.pause();stdout.write('\n');
      if(error)reject(error);else resolve(value);
    }
    function onKey(text,key={}) {
      if(key.ctrl&&key.name==='c')return finish(new Error('已取消'));
      if(key.name==='return'||key.name==='enter')return finish();
      if(key.name==='backspace'){value=Array.from(value).slice(0,-1).join('');return;}
      if(text&&!key.ctrl&&!key.meta&&!/[\x00-\x1f\x7f]/.test(text))value+=text;
      if(value.length>128)finish(new Error('密码不能超过 128 个字符'));
    }
    stdin.on('keypress',onKey);
  });
}
