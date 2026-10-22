import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {migrate} from '../../scripts/lib/migrations.mjs';

try {
  if (!process.env.DATABASE_URL || process.env.NODE_ENV!=='production') throw new Error('production configuration required');
  const command=process.argv[2];
  if(command==='migrate'){
    const changes=await migrate(process.env.DATABASE_URL);
    console.info(changes.length?'数据库迁移完成。':'数据库版本已就绪。');
  }else if(command==='has-account'){
    const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
    try{await client.connect();console.info((await client.query('SELECT 1 FROM users LIMIT 1')).rowCount?'yes':'no');}
    finally{await client.end();}
  }else if(command==='serve'){
    const checked=spawnSync(process.execPath,['scripts/check-production.mjs'],{stdio:'inherit'});
    if(checked.status!==0)throw new Error('production validation failed');
    await import('../../apps/api/build/main.js');
  }else throw new Error('unknown command');
}catch{
  console.error('启动或迁移失败，请检查数据库、生产配置和版本；未输出凭据。');
  process.exitCode=1;
}
