import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import pg from 'pg';
import {composeAtlas} from './data.mjs';
import {fetchGovDirCounty, GovDirError} from './govdir.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!process.env.DIRECTORY_DATABASE) throw new Error('DIRECTORY_DATABASE is required');
const pool=new pg.Pool({connectionString:process.env.DIRECTORY_DATABASE,max:3,connectionTimeoutMillis:15000,idleTimeoutMillis:30000});
pool.on('error',()=>console.error('Database pool connection failed'));
// Cache official GovDir listings for the 15 minutes permitted by its API documentation.
const govDirCache = new Map(), govDirPending = new Map();
async function countyOffices(fips) {
 const old = govDirCache.get(fips);
 if(old && old.expires > Date.now()) return old.value;
 if(govDirPending.has(fips)) return govDirPending.get(fips);
 const pending=fetchGovDirCounty(fips).then(data=>{
  if(govDirCache.size>=300)govDirCache.delete(govDirCache.keys().next().value);
  govDirCache.set(fips,{value:data,expires:Date.now()+900000});return data;
 }).finally(()=>govDirPending.delete(fips));
 govDirPending.set(fips,pending);return pending;
}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.ico':'image/x-icon'};
export const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  if(url.pathname.startsWith('/api/healthcare/county/')){
   const fips=url.pathname.slice('/api/healthcare/county/'.length);
   if(!/^[0-9]{5}$/.test(fips)){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Invalid county FIPS'}));return;}
   const category=url.searchParams.get('category');
   if(category && !['hospital','clinic','urgent-care','pharmacy','laboratory','imaging','dental','other'].includes(category)){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Invalid category'}));return;}
   try{
    const params=category?[fips,category]:[fips];
    const rows=await pool.query('SELECT id,name,category,address,phone,website,latitude,longitude FROM healthcare_facilities WHERE county_fips=$1'+(category?' AND category=$2':'')+' ORDER BY name LIMIT 5000',params);
    const facilities=rows.rows.map(row=>({...row,latitude:row.latitude==null?null:Number(row.latitude),longitude:row.longitude==null?null:Number(row.longitude)}));
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify({county_fips:fips,facilities}));return;
   }catch(e){console.error('Healthcare facility lookup failed',e.code||e.name);res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Healthcare facility dataset unavailable; apply healthcare schema first'}));return;}
  }
  if(url.pathname.startsWith('/api/govdir/county/')){
   const fips=url.pathname.slice('/api/govdir/county/'.length);
   try{
    const data=await countyOffices(fips);
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=900'});
    res.end(req.method==='HEAD'?undefined:JSON.stringify(data));
   }catch(e){
    const status=e instanceof GovDirError?e.status:503;
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
    if(e instanceof GovDirError && e.retryAfter)headers['Retry-After']=e.retryAfter;
    res.writeHead(status,headers);
    res.end(req.method==='HEAD'?undefined:JSON.stringify({error:e instanceof GovDirError?e.message:'GovDir directory temporarily unavailable'}));
   }
   return;
  }
  if(url.pathname==='/healthz'){await pool.query('SELECT 1');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok',database:'Neon'}));return;}
  if(url.pathname==='/api/atlas'){
   const client=await pool.connect();let atlas;
   try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const meta=await client.query("SELECT data FROM directory_metadata WHERE key='atlas'");
    if(!meta.rows.length)throw new Error('Directory import required');
    const jurisdictions=await client.query('SELECT data FROM directory_jurisdictions ORDER BY id');
    const contacts=await client.query('SELECT * FROM directory_contacts ORDER BY id');
    atlas=composeAtlas(meta.rows[0].data,jurisdictions.rows.map(r=>r.data),contacts.rows);
    await client.query('COMMIT');
   } catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(atlas));return;
  }
  // Only expose the app shell and presentation assets. Source data and credentials stay server-side.
  const p=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
  if(p!=='index.html' && !/^assets\/(css|js|vendor)\/[\w.-]+$/.test(p)){res.writeHead(404);res.end('Not found');return;}
  if(/atlas-data|registry-|fl-association/.test(p)){res.writeHead(404);res.end('Not found');return;}
  const data=await readFile(path.join(root,p));res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
 }catch(e){res.writeHead(e.code==='ENOENT'?404:503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.code==='ENOENT'?'Not found':'Directory temporarily unavailable. Please retry.'}));console.error('Directory request failed',e.code||e.name);}
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Directory server ready'));
process.on('SIGTERM',()=>server.close(()=>pool.end()));
