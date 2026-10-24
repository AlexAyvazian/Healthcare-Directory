import {createDatabasePool} from './db.mjs';
import {createServer} from './app.mjs';

const token=process.env.IMPORT_TOKEN||'';
if(token&&token.length<24)throw new Error('IMPORT_TOKEN must be at least 24 characters.');
const pool=process.env.DATABASE_URL ? createDatabasePool() : {
  async query(){throw Object.assign(new Error('Database not configured'),{code:'DATABASE_NOT_CONFIGURED'});},
  async connect(){throw Object.assign(new Error('Database not configured'),{code:'DATABASE_NOT_CONFIGURED'});},
  async end(){}
};
if(process.env.DATABASE_URL)pool.on('error',error=>console.error('Database connection unavailable:',error?.code||error?.name));
else console.warn('DATABASE_URL not configured: public map available, data APIs will return 503.');
const server=createServer({pool,importToken:token});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Healthcare facility map server listening'));
process.on('SIGTERM',()=>server.close(()=>pool.end()));
process.on('SIGINT',()=>server.close(()=>pool.end()));
