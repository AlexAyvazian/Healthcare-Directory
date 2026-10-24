import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, readdir, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {listCountyFacilities,listCategories,DATA_API_URL} from '../assets/js/neon-data.js';

function fakeFetch(payload, range='0-0/1') {
  const calls=[];
  const fetchImpl=async (url,options)=>{
    calls.push({url,options});
    return {ok:true,status:200,headers:{get:()=>range},json:async()=>payload};
  };
  return {fetchImpl,calls};
}

test('Neon URL is a public HTTPS REST endpoint, never a database credential',()=>{
  assert.match(DATA_API_URL,/^https:\/\/[^/]+\/neondb\/rest\/v1$/);
  assert.doesNotMatch(DATA_API_URL,/postgres(ql)?:\/\/|npg_|password=/);
});

test('county requests use server-side RLS restricted, parameterized PostgREST filters',async()=>{
  const mock=fakeFetch([{id:1,name:'Facility A'}],'0-0/1');
  const result=await listCountyFacilities('06019',{page:1,perPage:100,category:'clinic',fetchImpl:mock.fetchImpl});
  const url=new URL(mock.calls[0].url);
  assert.equal(url.searchParams.get('county_fips'),'eq.06019');
  assert.equal(url.searchParams.get('category'),'eq.clinic');
  assert.equal(url.searchParams.get('limit'),'101');
  assert.equal(result.total,1);
  assert.equal(result.facilities.length,1);
  assert.equal(result.has_more,false);
});

test('paging works even without a count response header',async()=>{
  const rows=Array.from({length:3},(_,id)=>({id}));
  const mock=fakeFetch(rows,'0-2/*');
  const result=await listCountyFacilities('06019',{page:2,perPage:2,fetchImpl:mock.fetchImpl});
  assert.equal(result.has_more,true);
  assert.equal(result.total,null);
  assert.equal(result.facilities.length,2);
  assert.equal(new URL(mock.calls[0].url).searchParams.get('offset'),'2');
});

test('county requests validate FIPS and page',async()=>{
  await assert.rejects(listCountyFacilities('6019',{}),/county FIPS/);
  await assert.rejects(listCountyFacilities('06019',{page:0}),/page/);
  await assert.rejects(listCountyFacilities('06019',{perPage:250}),/page size/);
});

test('facility categories are loaded from the database view',async()=>{
  const mock=fakeFetch([{category:'hospital',total:4}]);
  const out=await listCategories({fetchImpl:mock.fetchImpl});
  assert.deepEqual(out.categories,[{category:'hospital',total:4}]);
  assert.equal(new URL(mock.calls[0].url).pathname.endsWith('/facility_category_counts'),true);
});

test('Render build creates only the allowlisted static files in dist',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  execFileSync(process.execPath,['scripts/build-static.mjs'],{cwd:root,stdio:'pipe'});
  const list=async folder=>{
    const files=[];
    for(const item of await readdir(join(root,'dist',folder),{withFileTypes:true})){
      const p=join(folder,item.name);
      if(item.isDirectory())files.push(...await list(p));
      else files.push(p);
    }
    return files;
  };
  const files=(await list('')).sort();
  assert.deepEqual(files,[
    'admin.html','assets/css/healthcare.css','assets/js/healthcare-map.js',
    'assets/js/neon-data.js','assets/vendor/d3.min.js',
    'assets/vendor/topojson-client.min.js',
    'assets/vendor/us-atlas-counties-albers-10m.js',
    'assets/vendor/us-atlas.LICENSE','index.html'
  ].sort());
  const index=await readFile(join(root,'dist/index.html'),'utf8');
  assert.match(index,/type="module" src="\/assets\/js\/healthcare-map\.js"/);
  const admin=await readFile(join(root,'dist/admin.html'),'utf8');
  assert.doesNotMatch(admin,/id="adminToken"|\/api\/admin\/facilities\/import/);
  const server=await stat(join(root,'dist/assets/js/neon-data.js'));
  assert.ok(server.size>0);
});
