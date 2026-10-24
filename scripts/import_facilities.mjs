#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {parseCsv,validateRecords,importFacilities} from '../server/facilities.mjs';

const args=process.argv.slice(2);
const dryRun=args.includes('--dry-run');
const filename=args.find(a=>!a.startsWith('--'));
if(!filename){
  console.error('Usage: npm run import:facilities -- path/to/facilities.csv [--dry-run]');
  process.exitCode=2;
}else{
  try{
    const input=await readFile(filename,'utf8');
    const rows=filename.toLowerCase().endsWith('.json')?JSON.parse(input):parseCsv(input);
    const validated=validateRecords(rows);
    if(dryRun){console.log(`Validated ${validated.length} facilities. No database changes made.`);}
    else{
      const {createDatabasePool}=await import('../server/db.mjs');
      const pool=createDatabasePool();
      try{
        const outcome=await importFacilities(pool,validated);
        console.log(`Imported/updated ${outcome.processed} facilities.`);
      }finally{await pool.end();}
    }
  }catch(e){
    console.error('Import failed:',e?.code||e?.name||'Error',e?.name==='ValidationError'?e.message:'');
    process.exitCode=1;
  }
}
