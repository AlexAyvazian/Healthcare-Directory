import {ApiError, invalid} from './http.js';
import {logoDb} from './logo-db.js';
import {domainOf, normalizedName, resolveBrand} from './logo-providers.js';

const validSource = s => /^[a-z0-9-]{1,80}$/.test(s);
const validId = s => /^[\w.:-]{1,180}$/.test(s);

export async function cachedLogos(env, directory, source, ids) {
  if (!validSource(source) || !ids.length || ids.length>100 || ids.some(id=>!validId(id))) throw invalid('Invalid logo identifiers.');
  const db = logoDb(env,directory);
  const rows = await db.query(`SELECT m.facility_id,b.status,b.provider,b.logo_url,
    CASE WHEN b.image_base64 IS NOT NULL THEN true ELSE false END AS stored_image
    FROM facility_brand_map m JOIN brands b USING(brand_key)
    WHERE m.facility_source=$1 AND m.facility_id=ANY($2::text[])`,[source,ids]);
  return {logos: rows.map(r=>({id:r.facility_id,status:r.status,provider:r.provider,
    url:r.status==='resolved' ? r.stored_image ? `/logos/${directory}/image/${source}/${encodeURIComponent(r.facility_id)}` : r.logo_url : null}))};
}

export async function storedImage(env,directory,source,id) {
  if (!validSource(source) || !validId(id)) throw invalid('Invalid logo identifiers.');
  const rows=await logoDb(env,directory).query(`SELECT b.image_base64,b.image_type FROM facility_brand_map m JOIN brands b USING(brand_key)
    WHERE m.facility_source=$1 AND m.facility_id=$2 AND b.status='resolved'`,[source,id]);
  if (!rows[0]?.image_base64) throw new ApiError(404,'logo_not_found','No stored logo.');
  const bytes=Uint8Array.from(atob(rows[0].image_base64),c=>c.charCodeAt(0));
  return new Response(bytes,{headers:{'Content-Type':rows[0].image_type,'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
}

export async function enrichFacility(env,directory,facility,{db=logoDb(env,directory),accountDb=logoDb(env,'usa'),fetchImpl=fetch}={}) {
  const source=facility.source || 'directory', id=String(facility.id);
  if(!validSource(source)||!validId(id)||typeof facility.name!=='string'||!facility.name.trim()||facility.name.length>400) throw invalid('Invalid facility.');
  const existing=await db.query(`SELECT b.status,b.locked,m.manual_override FROM facility_brand_map m JOIN brands b USING(brand_key) WHERE facility_source=$1 AND facility_id=$2`,[source,id]);
  if(existing[0] && (existing[0].locked || existing[0].manual_override || ['not_found','review'].includes(existing[0].status))) return existing[0].status;
  const domain=domainOf(facility.website || '');
  const brandKey=domain ? 'domain:'+domain : 'name:'+normalizedName(facility.name)+':'+String(facility.country || '')+':'+normalizedName(facility.city);
  await db.query(`INSERT INTO brands(brand_key,domain,brand_name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[brandKey,domain,facility.name]);
  await db.query(`INSERT INTO facility_brand_map(facility_source,facility_id,facility_name,brand_key,match_method,match_confidence)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(facility_source,facility_id) DO NOTHING`,[source,id,facility.name,brandKey,domain?'website_domain':'unresolved',domain?1:0]);
  const leaseToken=crypto.randomUUID();
  const claimed=await db.query(`UPDATE brands SET lease_until=now()+interval '5 minutes',lease_token=$2,attempted_at=now(),updated_at=now()
    WHERE brand_key=$1 AND NOT locked AND NOT manual_override AND status IN ('pending','error')
    AND (lease_until IS NULL OR lease_until<now()) AND (retry_after IS NULL OR retry_after<now()) RETURNING brand_key`,[brandKey,leaseToken]);
  if(!claimed.length) return 'cached';
  let result;
  try {result=await resolveBrand(facility,{env,db,accountDb,brandKey,fetchImpl});}
  catch(error) {console.error('logo resolution failed',error?.name);result={status:'error',method:'temporary_failure',confidence:0};}
  // A name search can discover a domain already resolved for another facility. Reuse it.
  if(result.domain && result.domain!==domain) {
    const canonical='domain:'+result.domain;
    await db.query(`INSERT INTO brands(brand_key,domain,brand_name,provider,logo_url,image_base64,image_type,status,locked,resolved_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9 THEN now() ELSE NULL END) ON CONFLICT(brand_key) DO UPDATE SET provider=EXCLUDED.provider,logo_url=EXCLUDED.logo_url,image_base64=EXCLUDED.image_base64,image_type=EXCLUDED.image_type,status=EXCLUDED.status,locked=EXCLUDED.locked,resolved_at=EXCLUDED.resolved_at,lease_token=NULL,lease_until=NULL
      WHERE NOT brands.locked AND NOT brands.manual_override AND EXCLUDED.status='resolved'`,
      [canonical,result.domain,result.name||facility.name,result.provider||null,result.logo_url||null,result.image_base64||null,result.image_type||null,result.status,result.status==='resolved']);
    await db.query(`UPDATE facility_brand_map SET brand_key=$3,match_method=$4,match_confidence=$5 WHERE facility_source=$1 AND facility_id=$2 AND NOT manual_override`,[source,id,canonical,result.method,result.confidence]);
  }
  await db.query(`UPDATE brands SET status=$3,provider=$4,logo_url=$5,image_base64=$6,image_type=$7,locked=$8,
    resolved_at=CASE WHEN $8 THEN now() ELSE NULL END,retry_after=CASE WHEN $3='error' THEN now()+interval '6 hours' ELSE NULL END,
    lease_until=NULL,lease_token=NULL,candidate=$9::jsonb,updated_at=now() WHERE brand_key=$1 AND lease_token=$2 AND NOT manual_override AND NOT locked`,
    [brandKey,leaseToken,result.status,result.provider||null,result.logo_url||null,result.image_base64||null,result.image_type||null,result.status==='resolved',JSON.stringify(result.candidate||null)]);
  await db.query(`UPDATE facility_brand_map SET match_method=$3,match_confidence=$4 WHERE facility_source=$1 AND facility_id=$2 AND NOT manual_override`,[source,id,result.method,result.confidence]);
  return result.status;
}

export async function logoRoute(request,env,ctx) {
  const url=new URL(request.url);
  const image=/^\/logos\/(usa|international)\/image\/([a-z0-9-]+)\/([^/]+)$/.exec(url.pathname);
  if(image) return storedImage(env,image[1],image[2],decodeURIComponent(image[3]));
  const match=/^\/logos\/(usa|international)$/.exec(url.pathname);
  if(match) return {body:await cachedLogos(env,match[1],url.searchParams.get('source') || 'directory',(url.searchParams.get('ids') || '').split(',').filter(Boolean)),cache:60};
  return null;
}
