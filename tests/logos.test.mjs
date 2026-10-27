import test from 'node:test';
import assert from 'node:assert/strict';
import {domainOf,pooledRequest,resolveBrand} from '../worker/src/logo-providers.js';
import {enrichFacility} from '../worker/src/logos.js';

test('logo identity uses canonical website hosts and rejects shared/social hosts',()=>{
  assert.equal(domainOf('https://WWW.QuestDiagnostics.com/locations'),'questdiagnostics.com');
  for(const input of ['http://127.0.0.1','https://user:pass@clinic.org','https://facebook.com/clinic','not a domain','']) assert.equal(domainOf(input),null);
});

test('resolved, negative and manual mappings never call a provider again',async()=>{
  for(const row of [{status:'resolved',locked:true},{status:'not_found'},{status:'review'},{manual_override:true}]) {
    let reads=0;
    const db={query:async()=>{reads++;return [row];}};
    const status=await enrichFacility({},'usa',{id:'1',name:'Clinic'},{db,accountDb:db,fetchImpl:()=>{throw Error('provider must not run');}});
    assert.equal(status,row.status);assert.equal(reads,1);
  }
});

test('quota response cools down the account and fails over, successful accounts are not rotated',async()=>{
  const unavailable=new Map(),calls=[];
  const db={query:async(q,p)=>{
    if(q.startsWith('INSERT INTO logo_provider_accounts')) return [{unavailable_until:unavailable.get(p[0])}];
    if(q.startsWith('UPDATE logo_provider_accounts')) unavailable.set(p[0],new Date(Date.now()+p[1]*1000));
    return [];
  }};
  const opts={env:{KEY:'one',KEY_2:'two'},accountDb:db,db,brandKey:'clinic.org',provider:'test',prefix:'KEY',count:2,
    makeRequest:a=>['https://example.org/'+a.value,{}],fetchImpl:async url=>{calls.push(url);return new Response('{}',{status:url.endsWith('one')?429:200,headers:{'Retry-After':'120'}});}};
  assert.equal((await pooledRequest(opts)).response.status,200);
  assert.equal(calls.length,2);assert.ok(unavailable.has('KEY'));
  calls.length=0;await pooledRequest(opts);assert.deepEqual(calls,['https://example.org/two']);
});

test('a known shared domain reuses its stored image without another provider request',async()=>{
  const saved={status:'resolved',domain:'clinic.org',brand_name:'Clinic',provider:'logo_dev',image_base64:'abcd',image_type:'image/png'};
  const result=await resolveBrand({name:'Clinic branch',website:'https://clinic.org/branch'},{env:{},db:{query:async()=>[saved]},fetchImpl:()=>{throw Error('provider must not run');}});
  assert.equal(result.image_base64,'abcd');assert.equal(result.method,'website_domain');
});

test('exact name with unverified location is retained for review instead of locking a guessed logo',async()=>{
  const db={query:async q=>q.startsWith('INSERT INTO logo_provider_accounts')?[{}]:[]};
  const result=await resolveBrand({name:'Central Clinic',country:'US'},{env:{LOGO_DEV_API_KEY:'test'},db,accountDb:db,brandKey:'test',fetchImpl:async()=>Response.json({data:[{name:'Central Clinic',domain:'centralclinic.org'}]})});
  assert.equal(result.status,'review');assert.equal(result.candidate.domain,'centralclinic.org');assert.equal(result.image_base64,undefined);
});
