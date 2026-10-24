import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server/app.mjs';
const token='test-token-that-is-long-and-private';
const sample={source_name:'manual',source_record_id:'m-1',name:'Test Clinic',category:'clinic',county_fips:'06019'};
async function runWithServer(pool,fn,importToken=token){
 const server=createServer({pool,importToken});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{return await fn('http://127.0.0.1:'+server.address().port);}finally{await new Promise(r=>server.close(r));}
}
const pool={query:async(sql,params)=>sql.includes('COUNT(*)')?{rows:[{total:0}]}:{rows:[]},connect:async()=>({query:async()=>({rowCount:1}),release:()=>{}})};

test('county route validates FIPS and never returns invented data',async()=>{
 await runWithServer(pool,async url=>{
  let r=await fetch(url+'/api/healthcare/county/notfips');assert.equal(r.status,400);
  r=await fetch(url+'/api/healthcare/county/06019');assert.equal(r.status,200);
  const j=await r.json();assert.deepEqual(j.facilities,[]);assert.equal(j.county_fips,'06019');assert.equal(j.total,0);
 });
});

test('upload endpoint rejects anonymous access',async()=>{
 await runWithServer(pool,async url=>{
  const r=await fetch(url+'/api/admin/facilities/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify([sample])});
  assert.equal(r.status,401);
 });
});

test('upload accepts authenticated CSV with no hardcoded facility rows',async()=>{
 const calls=[];
 const p={...pool,connect:async()=>({query:async(q,params)=>{calls.push(q);return {rowCount:1}},release:()=>{}})};
 await runWithServer(p,async url=>{
  const r=await fetch(url+'/api/admin/facilities/import',{method:'POST',headers:{'content-type':'text/csv','authorization':'Bearer '+token},body:'source_name,source_record_id,name,category,county_fips\nmanual,m-1,Test Clinic,clinic,06019\n'});
  assert.equal(r.status,200);assert.equal((await r.json()).processed,1);assert.ok(calls.some(q=>q.includes('INSERT INTO')));
 });
});

test('upload rejects invalid content before starting DB transaction',async()=>{
 let writes=0;
 const p={...pool,connect:async()=>{writes++;throw Error('Should not connect')}};
 await runWithServer(p,async url=>{
  const r=await fetch(url+'/api/admin/facilities/import',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+token},body:JSON.stringify([{...sample,county_fips:'abc'}])});
  assert.equal(r.status,422);assert.equal(writes,0);
 });
});

test('unconfigured import token fails closed',async()=>{
 await runWithServer(pool,async url=>{
  const r=await fetch(url+'/api/admin/facilities/import',{method:'POST',headers:{'content-type':'application/json'},body:'[]'});
  assert.equal(r.status,503);
 },'');
});

test('health check tests DB connectivity',async()=>{
 await runWithServer(pool,async url=>{const r=await fetch(url+'/healthz');assert.equal(r.status,200);assert.equal((await r.json()).status,'ok')});
});
