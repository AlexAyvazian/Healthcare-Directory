import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv, validateRecords, listCountyFacilities, listCategories, importFacilities} from '../server/facilities.mjs';

const sample = {
  source_name:'provider_registry', source_record_id:'abc-100', name:'Community Health Center',
  category:'clinic', county_fips:'06019', address:'100 Main St',city:'Fresno',state:'CA',postal_code:'93701',
  latitude:'36.74',longitude:'-119.78',website:'https://example.org'
};

test('CSV parser preserves quoted commas, embedded newlines and escaped quotes',()=>{
  const rows=parseCsv('source_name,source_record_id,name,category,county_fips\r\nRegistry,1,"A, B \"\"Care\"\"\nCenter",clinic,06019\r\n');
  assert.equal(rows.length,1);
  assert.equal(rows[0].name,'A, B "Care"\nCenter');
  assert.equal(rows[0].county_fips,'06019');
});

test('CSV parser rejects malformed rows',()=>{
  assert.throws(()=>parseCsv('name,county_fips\n"unfinished,06019'),/Unterminated/i);
  assert.throws(()=>parseCsv('name,name\na,b'),/Duplicate header/i);
});

test('normalization preserves FIPS and source IDs and coordinates',()=>{
  const [r]=validateRecords([sample]);
  assert.equal(r.county_fips,'06019');
  assert.equal(r.latitude,36.74);
  assert.equal(r.longitude,-119.78);
  assert.equal(r.source_record_id,'abc-100');
  assert.deepEqual(r.metadata,{});
});

test('invalid latitude/longitude, URL, missing ID and duplicate import keys are rejected',()=>{
  assert.throws(()=>validateRecords([{...sample,latitude:'99'}]),/latitude/i);
  assert.throws(()=>validateRecords([{...sample,longitude:''}]),/both/i);
  assert.throws(()=>validateRecords([{...sample,website:'javascript:alert(1)'}]),/website/i);
  assert.throws(()=>validateRecords([{...sample,source_record_id:''}]),/source_record_id/i);
  assert.throws(()=>validateRecords([sample,sample]),/duplicate/i);
});

test('read path uses parameterized county and category, pagination and total count',async()=>{
  const queries=[];
  const pool={query:async(sql,params)=>{queries.push({sql,params});return sql.includes('COUNT(*)')?{rows:[{total:1}]}:{rows:[{id:'5',name:'Community Health Center',category:'clinic',latitude:36.74,longitude:-119.78}]};}};
  const result=await listCountyFacilities(pool,'06019',{category:'clinic',page:1,perPage:25});
  assert.equal(result.total,1);assert.equal(result.facilities[0].name,'Community Health Center');
  assert.equal(result.has_more,false);assert.equal(queries.length,2);
  assert.deepEqual(queries[0].params,['06019','clinic']);
  assert.deepEqual(queries[1].params,['06019','clinic',25,0]);
  assert.match(queries[1].sql,/LIMIT \$3 OFFSET \$4/);
});

test('categories are read from DB, never embedded as facility records',async()=>{
  const pool={query:async()=>({rows:[{category:'clinic',total:1}]})};
  assert.deepEqual(await listCategories(pool),[{category:'clinic',total:1}]);
});

test('import is transactional and uses conflict-upsert with source identity',async()=>{
  const calls=[];
  const client={query:async(sql,params)=>{calls.push({sql,params});return {rowCount:1};},release:()=>calls.push({sql:'RELEASE'})};
  const result=await importFacilities({connect:async()=>client},[sample]);
  assert.equal(result.processed,1);
  assert.deepEqual(calls.map(c=>c.sql==='BEGIN'?'BEGIN':c.sql==='COMMIT'?'COMMIT':c.sql==='RELEASE'?'RELEASE':'UPSERT'),['BEGIN','UPSERT','COMMIT','RELEASE']);
  assert.match(calls[1].sql,/ON CONFLICT \(source_name, source_record_id\)/);
  assert.equal(JSON.parse(calls[1].params[0])[0].county_fips,'06019');
});

test('import rolls back when database insert fails',async()=>{
  const calls=[];
  const client={query:async(sql)=>{calls.push(sql);if(sql.includes('INSERT INTO'))throw Error('temporary db failure');return {}},release:()=>calls.push('RELEASE')};
  await assert.rejects(()=>importFacilities({connect:async()=>client},[sample]),/temporary db failure/);
  assert.ok(calls.includes('ROLLBACK'));
});
