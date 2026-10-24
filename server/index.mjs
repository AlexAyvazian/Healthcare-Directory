import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.ico':'image/x-icon'};
export const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  if(url.pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'});res.end(req.method==='HEAD'?undefined:JSON.stringify({status:'ok'}));return;}
  if(url.pathname.startsWith('/api/healthcare/county/')){
   const fips=url.pathname.slice('/api/healthcare/county/'.length);
   if(!/^[0-9]{5}$/.test(fips)){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Invalid county FIPS'}));return;}
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
   res.end(req.method==='HEAD'?undefined:JSON.stringify({county_fips:fips,facilities:[],data_status:'not_configured'}));return;
  }
  const p=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
  if(p!=='index.html' && !/^assets\/(css|js|vendor)\/[\w.-]+$/.test(p)){res.writeHead(404);res.end('Not found');return;}
  if(/atlas-data|registry-|fl-association/.test(p)){res.writeHead(404);res.end('Not found');return;}
  const data=await readFile(path.join(root,p));
  res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream','Cache-Control':'no-cache'});
  res.end(req.method==='HEAD'?undefined:data);
 }catch(e){res.writeHead(e.code==='ENOENT'?404:503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.code==='ENOENT'?'Not found':'Service temporarily unavailable'}));}
});
if(process.env.NODE_ENV!=='test')server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Healthcare map server ready'));
process.on('SIGTERM',()=>server.close());
