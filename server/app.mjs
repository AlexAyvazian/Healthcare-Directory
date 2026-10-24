import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {timingSafeEqual} from 'node:crypto';
import {ValidationError,parseCsv,importFacilities,listCountyFacilities,listCategories} from './facilities.mjs';

const defaultRoot=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.ico':'image/x-icon'};
const baseHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'"};
const MAX_UPLOAD_BYTES=8*1024*1024;
class TooLargeError extends Error {}
function sendJson(res,code,payload,method='GET'){
  res.writeHead(code,{...baseHeaders,'Content-Type':'application/json; charset=utf-8'});
  res.end(method==='HEAD'?undefined:JSON.stringify(payload));
}
function authorized(actual,expected){
  if(!expected||!actual)return false;
  const a=Buffer.from(actual),b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
async function bodyText(req){
  const chunks=[];let size=0;
  for await(const c of req){size+=c.length;if(size>MAX_UPLOAD_BYTES)throw new TooLargeError('Maximum upload size is 8 MB.');chunks.push(c);}
  return Buffer.concat(chunks).toString('utf8');
}

export function createServer({pool,importToken='',root=defaultRoot}={}){
  if(!pool||typeof pool.query!=='function')throw new Error('A database pool is required.');
  return http.createServer(async(req,res)=>{
    const method=req.method;
    try{
      const url=new URL(req.url,'http://localhost');
      if(url.pathname==='/api/admin/facilities/import'){
        if(method!=='POST'){sendJson(res,405,{error:'Only POST is supported.'},method);return;}
        if(!importToken){sendJson(res,503,{error:'Facility import is not configured.'});return;}
        const header=String(req.headers.authorization||'');
        if(!header.startsWith('Bearer ')||!authorized(header.slice(7),importToken)){
          sendJson(res,401,{error:'Valid administrator import token required.'});return;
        }
        const contentType=String(req.headers['content-type']||'').split(';')[0].toLowerCase().trim();
        if(!['application/json','text/csv'].includes(contentType)){
          sendJson(res,415,{error:'Upload CSV (text/csv) or JSON (application/json).'});return;
        }
        const body=await bodyText(req);
        let records;
        if(contentType==='text/csv')records=parseCsv(body);
        else {try{records=JSON.parse(body);}catch{throw new ValidationError('Invalid JSON payload.');}}
        const result=await importFacilities(pool,records);
        sendJson(res,200,{status:'imported',...result});return;
      }
      if(method!=='GET'&&method!=='HEAD'){
        sendJson(res,405,{error:'Method not allowed.'},method);return;
      }
      if(url.pathname==='/healthz'){
        try{await pool.query('SELECT 1');sendJson(res,200,{status:'ok',database:'connected'},method);}
        catch{sendJson(res,503,{status:'unavailable'},method);}
        return;
      }
      if(url.pathname==='/api/healthcare/categories'){
        const categories=await listCategories(pool);sendJson(res,200,{categories},method);return;
      }
      if(url.pathname.startsWith('/api/healthcare/county/')){
        const fips=url.pathname.slice('/api/healthcare/county/'.length);
        if(!/^\d{5}$/.test(fips)){sendJson(res,400,{error:'Invalid county FIPS.'},method);return;}
        const rawPage=url.searchParams.get('page')||'1';
        const rawPerPage=url.searchParams.get('per_page')||'100';
        if(!/^\d+$/.test(rawPage)||!/^\d+$/.test(rawPerPage))throw new ValidationError('page and per_page must be positive integers.');
        const result=await listCountyFacilities(pool,fips,{category:url.searchParams.get('category')||'',page:Number(rawPage),perPage:Number(rawPerPage)});
        sendJson(res,200,result,method);return;
      }
      const p=url.pathname==='/'?'index.html':url.pathname==='/admin'?'admin.html':decodeURIComponent(url.pathname.slice(1));
      if(p!=='index.html'&&p!=='admin.html'&&!/^assets\/(css|js|vendor)\/[\w.-]+$/.test(p)){
        sendJson(res,404,{error:'Not found.'},method);return;
      }
      const bytes=await readFile(path.join(root,p));
      res.writeHead(200,{...baseHeaders,'Content-Type':mime[path.extname(p)]||'application/octet-stream'});
      res.end(method==='HEAD'?undefined:bytes);
    }catch(e){
      if(e instanceof ValidationError){sendJson(res,422,{error:e.message},method);return;}
      if(e instanceof TooLargeError){sendJson(res,413,{error:e.message},method);return;}
      if(e?.code==='ENOENT'){sendJson(res,404,{error:'Not found.'},method);return;}
      console.error('Healthcare API failed:',e?.code||e?.name||'UnknownError');
      sendJson(res,503,{error:'Healthcare data service temporarily unavailable.'},method);
    }
  });
}
