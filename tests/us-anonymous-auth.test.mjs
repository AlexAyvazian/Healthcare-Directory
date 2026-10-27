import test from 'node:test';
import assert from 'node:assert/strict';
import {listCountyFacilities, listCategories, resetUsTokenCache, DATA_API_URL, US_AUTH_URL} from '../assets/js/neon-data.js';

function jwt() { return ['e30', Buffer.from(JSON.stringify({role:'anonymous',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'sig'].join('.'); }

test('U.S. Neon viewer obtains anonymous JWT and reads facilities without write privileges',async()=>{
  resetUsTokenCache();
  const calls=[],token=jwt();
  const fetchImpl=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith('/token/anonymous')) return {ok:true,status:200,json:async()=>({token})};
    return {ok:true,status:200,headers:{get:()=> '0-0/1'},json:async()=>[{id:1,name:'Hospital'}]};
  };
  const rows=await listCountyFacilities('06019',{perPage:5,fetchImpl});
  assert.equal(rows.facilities[0].name,'Hospital');
  assert.match(US_AUTH_URL,/^https:\/\/ep-[^/]+\.neonauth\./);
  assert.ok(calls.some(c=>c.url===US_AUTH_URL+'/token/anonymous'));
  const rest=calls.find(c=>c.url.startsWith(DATA_API_URL+'/healthcare_facilities'));
  assert.equal(rest.options.headers.Authorization,'Bearer '+token);
  assert.ok(calls.every(c=>c.options.method==='GET'));
  assert.ok(!rest.url.includes(token),'JWT is never in URL');
});

test('expired U.S. Neon JWT is refreshed once after 401',async()=>{
  resetUsTokenCache();
  let auth=0,rest=0;
  const fetchImpl=async(url)=>{
    if(String(url).endsWith('/token/anonymous')){auth++;return {ok:true,status:200,json:async()=>({token:jwt()})};}
    rest++;
    if(rest===1)return {ok:false,status:401};
    return {ok:true,status:200,headers:{get:()=> '0-0/1'},json:async()=>[{id:4,name:'Recovered'}]};
  };
  const result=await listCountyFacilities('06019',{fetchImpl});
  assert.equal(result.facilities[0].name,'Recovered');
  assert.equal(auth,2);
  assert.equal(rest,2);
});

test('categories use anonymous GET session instead of an unauthenticated request',async()=>{
  resetUsTokenCache();
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith('/token/anonymous'))return {ok:true,status:200,json:async()=>({token:jwt()})};
    return {ok:true,status:200,headers:{get:()=>'*/*'},json:async()=>[{category:'hospital',total:5419}]};
  };
  const out=await listCategories({fetchImpl});
  assert.deepEqual(out.categories,[{category:'hospital',total:5419}]);
  assert.ok(calls.find(c=>c.url.includes('/facility_category_counts'))?.options?.headers?.Authorization?.startsWith('Bearer '));
});

test('U.S. sidebar search is applied on the server within the selected county',async()=>{
  resetUsTokenCache();let query;
  const fetchImpl=async(url)=>{
    if(String(url).endsWith('/token/anonymous'))return {ok:true,status:200,json:async()=>({token:jwt()})};
    query=new URL(url);return {ok:true,status:200,headers:{get:()=> '0-0/1'},json:async()=>[{id:1,name:'Fresno hospital'}]};
  };
  await listCountyFacilities('06019',{search:'Fresno',fetchImpl});
  assert.equal(query.searchParams.get('county_fips'),'eq.06019');
  assert.equal(query.searchParams.get('or'),'(name.ilike."*Fresno*",city.ilike."*Fresno*")');
  await listCountyFacilities('06019',{search:'x"),id.gt.0%_*',fetchImpl});
  assert.equal(query.searchParams.get('or'),'(name.ilike."*x id.gt.0*",city.ilike."*x id.gt.0*")');
});
