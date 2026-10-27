import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, readdir, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {listCountyFacilities,listCategories,DATA_API_URL} from '../assets/js/neon-data.js';
import {BUNDLED_GEO} from '../assets/js/world-config.js';
import {COUNTRIES} from '../assets/js/world-catalog.js';

function fakeFetch(payload, range='0-0/1') {
  const calls=[];
  const fetchImpl=async (url,options)=>{
    calls.push({url,options});
    if (String(url).endsWith('/token/anonymous')) return {ok:true,status:200,json:async()=>({token:'e30.e30.sig'})};
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
  const url=new URL(mock.calls.find(call => call.url.includes('/rest/v1/')).url);
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
  assert.equal(new URL(mock.calls.find(call => call.url.includes('/rest/v1/')).url).searchParams.get('offset'),'2');
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
  assert.equal(new URL(mock.calls.find(call => call.url.includes('/rest/v1/')).url).pathname.endsWith('/facility_category_counts'),true);
});

test('Render build publishes only public viewer assets, without uploads or downloads',async()=>{
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
  const geo=BUNDLED_GEO.map(([iso3,level])=>`geo/gbOpen/${iso3}/${level}/geoBoundaries-${iso3}-${level}_simplified.geojson`);
  assert.deepEqual(files,[
    'assets/css/healthcare.css',
    'assets/js/healthcare-map.js',
    'assets/js/neon-data.js',
    'assets/vendor/d3.min.js',
    'assets/vendor/topojson-client.min.js',
    'assets/vendor/us-atlas-counties-albers-10m.js',
    'assets/vendor/us-atlas.LICENSE',
    'index.html',
    'assets/js/facility-logos.js',
    'assets/css/facility-logos.css',
    'world.html',
    'assets/css/world.css',
    'assets/js/world-map.js',
    'assets/js/world-data.js',
    'assets/js/world-geo.js',
    'assets/js/world-colors.js',
    'assets/js/world-labels.js',
    'assets/js/world-catalog.js',
    'assets/js/world-config.js',
    'assets/js/registry-data.js',
    'assets/vendor/world-atlas-countries-50m.json',
    'assets/vendor/world-atlas.LICENSE',
    ...geo
  ].sort());
  const index=await readFile(join(root,'dist/index.html'),'utf8');
  assert.match(index,/type="module" src="\/assets\/js\/healthcare-map\.js"/);
  assert.doesNotMatch(index,/href="\/admin(?:\.html)?"/i);
  assert.doesNotMatch(index,/import facilities|download|export|upload|<input[^>]+type=['"]file/i);
  await assert.rejects(readFile(join(root,'dist/admin.html')), {code:'ENOENT'});
  await assert.rejects(readFile(join(root,'dist/assets/js/import-facilities.js')), {code:'ENOENT'});
  const publicApi=await readFile(join(root,'dist/assets/js/neon-data.js'),'utf8');
  assert.doesNotMatch(publicApi,/\bfetch\s*\([^)]*method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  assert.doesNotMatch(publicApi,/postgres(?:ql)?:\/\/|npg_|password=/);
  const server=await stat(join(root,'dist/assets/js/neon-data.js'));
  assert.ok(server.size>0);
});

test('U.S. directory gains only a navigation link to the international directory',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const index=await readFile(join(root,'index.html'),'utf8');
  assert.match(index,/<a class="toplink" href="\/world\.html">International directory<\/a>/);
  assert.match(index,/src="\/assets\/js\/healthcare-map\.js"/);
});

test('published Canada boundary is the original 26,022,306-byte file with the pinned SHA-256',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const bytes=await readFile(join(root,'dist/geo/gbOpen/CAN/ADM1/geoBoundaries-CAN-ADM1_simplified.geojson'));
  assert.equal(bytes.length,26022306);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'0c9e4fc56c8b9ce958960ffabd1556fbe7c3ec0deeea346a2b5b7dff05e35449');
  for(const [iso3,level] of BUNDLED_GEO){
    const source=COUNTRIES.find(c=>c.iso3===iso3).levels.find(l=>l.level===level);
    const copy=await readFile(join(root,'dist/geo/gbOpen',iso3,level,source.file));
    assert.equal(createHash('sha256').update(copy).digest('hex'),source.sha256,`${iso3} ${level}`);
  }
});

test('international viewer is view-only: no uploads, exports, downloads, admin links, or secrets',async()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const html=await readFile(join(root,'dist/world.html'),'utf8');
  assert.doesNotMatch(html,/download|export|upload|import|admin|<input[^>]+type=['"]file|<form/i);
  for(const file of ['world-map.js','world-data.js','world-geo.js','world-config.js','world-colors.js','world-labels.js','registry-data.js']){
    const js=await readFile(join(root,'dist/assets/js',file),'utf8');
    assert.doesNotMatch(js,/postgres(?:ql)?:\/\/|npg_|password\s*=|neondb_owner|api[_-]?key/i,file);
    assert.doesNotMatch(js,/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/,file);
    assert.doesNotMatch(js,/\bdownload\b|createObjectURL|text\/csv/i,file);
  }
});
