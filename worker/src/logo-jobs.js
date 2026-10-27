/* Enrichment is separate from sidebar reads. A resumable scan reads the same published facility fields. */
import {logoDb} from './logo-db.js';
import {enrichFacility} from './logos.js';
import {DATA_API_URL,US_AUTH_URL} from '../../assets/js/neon-data.js';
import {WORLD_DATA_API_URL,WORLD_AUTH_URL} from '../../assets/js/world-config.js';

export async function enrichDirectory(env,directory,fetchImpl=fetch) {
  const db=logoDb(env,directory),job='directory-scan';
  const claimed=await db.query(`INSERT INTO logo_enrichment_state(job,lease_until) VALUES($1,now()+interval '10 minutes')
    ON CONFLICT(job) DO UPDATE SET lease_until=EXCLUDED.lease_until WHERE logo_enrichment_state.lease_until IS NULL OR logo_enrichment_state.lease_until<now()
    RETURNING cursor_value,stage`,[job]);
  if(!claimed.length) return {skipped:true};
  let count=0;
  try {
    const international=directory==='international';
    const auth=await fetchImpl((international?WORLD_AUTH_URL:US_AUTH_URL)+'/token/anonymous',{signal:AbortSignal.timeout(15000)});
    if(!auth.ok) throw new Error('Directory session unavailable');
    const {token}=await auth.json();
    const url=new URL((international?WORLD_DATA_API_URL:DATA_API_URL)+(international?'/facilities':'/healthcare_facilities'));
    url.searchParams.set('select',international?'id,name,website,city,country_iso2':'id,name,website,city');
    const stage=claimed[0].stage || 'websites';
    if(stage==='websites') url.searchParams.set('website','ilike.http*');
    else url.searchParams.set('or','(website.is.null,website.not.ilike.http*)');
    url.searchParams.set('order','id.asc');url.searchParams.set('limit','1');
    const due=await db.query("SELECT m.facility_id FROM facility_brand_map m JOIN brands b USING(brand_key) WHERE m.facility_source='directory' AND b.status='error' AND NOT b.locked AND NOT b.manual_override AND b.retry_after<now() AND (b.lease_until IS NULL OR b.lease_until<now()) ORDER BY b.retry_after LIMIT 1");
    if(due[0]) {url.searchParams.delete('website');url.searchParams.delete('or');url.searchParams.set('id','eq.'+due[0].facility_id);}
    else if(claimed[0].cursor_value) url.searchParams.set('id','gt.'+claimed[0].cursor_value);
    const response=await fetchImpl(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json',},signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error('Directory read unavailable');
    const rows=await response.json();
    if(!Array.isArray(rows)) throw new Error('Invalid directory response');
    for(const row of rows) {
      await enrichFacility(env,directory,{...row,country:international?row.country_iso2:'US'});
      if(!due.length) await db.query('UPDATE logo_enrichment_state SET cursor_value=$2,updated_at=now() WHERE job=$1',[job,String(row.id)]);
      count++;
    }
    if(!rows.length && !due.length) await db.query("UPDATE logo_enrichment_state SET cursor_value=NULL,stage=CASE WHEN stage='websites' THEN 'names' ELSE 'websites' END,updated_at=now() WHERE job=$1",[job]);
    return {processed:count};
  } finally {await db.query('UPDATE logo_enrichment_state SET lease_until=NULL WHERE job=$1',[job]);}
}

export async function runLogoJobs(env, scheduledTime=Date.now()) {
  // Sequential to stay within the Worker subrequest budget; each scan has its own durable cursor.
  for(const directory of [Math.floor(scheduledTime/60000)%2 ? 'usa':'international']) {
    try {await enrichDirectory(env,directory);} catch(error) {console.error('logo enrichment failed',directory,error?.name);}
  }
}
