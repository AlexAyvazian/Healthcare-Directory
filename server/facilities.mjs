/** Facility records live only in Neon, never as JavaScript fixture data. */
const MAX_RECORDS = 5000;
const MAX_STRING = { source_name:120, source_record_id:250, name:350, category:100, county_fips:5, address:700, city:200, state:2, postal_code:30, phone:100, email:320, website:1500, source_url:1500 };
const COLUMNS = ['source_name','source_record_id','name','category','county_fips','address','city','state','postal_code','phone','email','website','latitude','longitude','source_url','metadata'];

export class ValidationError extends Error {
  constructor(message) { super(message); this.name='ValidationError'; }
}

/** RFC 4180-style parser: handles CRLF, quoted fields, escaped quotes and embedded newlines. */
export function parseCsv(input) {
  if (typeof input!=='string') throw new ValidationError('CSV must be UTF-8 text.');
  const str=input.replace(/^\uFEFF/,'');
  const rows=[];let row=[],field='',quoted=false,afterQuote=false;
  function endField(){row.push(field);field='';afterQuote=false;}
  function endRow(){endField();if(row.some(v=>v.trim()!==''))rows.push(row);row=[];}
  for(let i=0;i<str.length;i++){
    const ch=str[i];
    if(quoted){
      if(ch==='"'){
        if(str[i+1]==='"'){field+='"';i++;}else{quoted=false;afterQuote=true;}
      }else field+=ch;
      continue;
    }
    if(afterQuote){
      if(ch===' '||ch==='\t')continue;
      if(ch!==','&&ch!=='\n'&&ch!=='\r')throw new ValidationError('Invalid character after closing CSV quote.');
    }
    if(ch===','){endField();continue;}
    if(ch==='\n'||ch==='\r'){
      if(ch==='\r'&&str[i+1]==='\n')i++;
      endRow();continue;
    }
    if(ch==='"'){
      if(field.trim()!==''||afterQuote)throw new ValidationError('Invalid CSV quotation.');
      field='';quoted=true;continue;
    }
    field+=ch;
  }
  if(quoted)throw new ValidationError('Unterminated quoted CSV value.');
  if(field!==''||row.length||afterQuote)endRow();
  if(!rows.length)throw new ValidationError('CSV has no header row.');
  const headers=rows.shift().map(c=>c.trim().toLowerCase());
  if(headers.some(h=>!h))throw new ValidationError('CSV header contains an empty column.');
  if(new Set(headers).size!==headers.length)throw new ValidationError('Duplicate header in CSV.');
  if(rows.length>MAX_RECORDS)throw new ValidationError(`Upload limit is ${MAX_RECORDS} facilities per request.`);
  return rows.map((r,i)=>{
    if(r.length!==headers.length)throw new ValidationError(`CSV row ${i+2} has ${r.length} fields; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((h,j)=>[h,r[j].trim()]));
  });
}
function nonEmpty(value){return value===null||value===undefined?'':String(value).trim();}
function field(raw,key,{required=false}={}){
  const value=nonEmpty(raw[key]);
  if(required&&!value)throw new ValidationError(`${key} is required.`);
  if(value.length>(MAX_STRING[key]||1000))throw new ValidationError(`${key} exceeds the allowed length.`);
  return value||null;
}
function coordinate(value,name,min,max){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max)throw new ValidationError(`${name} must be between ${min} and ${max}.`);
  return n;
}
function validUrl(value,name){
  if(!value)return null;
  let url;try{url=new URL(value);}catch{throw new ValidationError(`${name} must be a valid HTTPS/HTTP URL.`);}
  if(!['https:','http:'].includes(url.protocol))throw new ValidationError(`${name} must be a valid HTTPS/HTTP URL.`);
  return value;
}
export function validateRecords(rows){
  if(!Array.isArray(rows)||!rows.length)throw new ValidationError('Provide a nonempty array of facility records.');
  if(rows.length>MAX_RECORDS)throw new ValidationError(`Upload limit is ${MAX_RECORDS} facilities per request.`);
  const seen=new Set();
  return rows.map((raw,i)=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new ValidationError(`Row ${i+1} must be an object.`);
    try{
      const r={};for(const key of COLUMNS){if(!['latitude','longitude','metadata'].includes(key))r[key]=field(raw,key,{required:['source_name','source_record_id','name','category','county_fips'].includes(key)});}
      if(!/^\d{5}$/.test(r.county_fips))throw new ValidationError('county_fips must contain exactly five digits, including leading zeros.');
      if(!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(r.category))throw new ValidationError('category must be a lowercase slug (e.g., urgent-care).');
      if(r.state&&!/^[A-Z]{2}$/.test(r.state.toUpperCase()))throw new ValidationError('state must be a two-letter abbreviation.');
      if(r.state)r.state=r.state.toUpperCase();
      r.website=validUrl(r.website,'website');r.source_url=validUrl(r.source_url,'source_url');
      r.latitude=coordinate(raw.latitude,'latitude',-90,90);
      r.longitude=coordinate(raw.longitude,'longitude',-180,180);
      if((r.latitude===null)!==(r.longitude===null))throw new ValidationError('Provide both latitude and longitude, or neither.');
      let metadata=raw.metadata;
      if(metadata===null||metadata===undefined||metadata==='')metadata={};
      if(typeof metadata==='string'){try{metadata=JSON.parse(metadata)}catch{throw new ValidationError('metadata must be valid JSON.');}}
      if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw new ValidationError('metadata must be a JSON object.');
      r.metadata=metadata;
      const key=JSON.stringify([r.source_name,r.source_record_id]);
      if(seen.has(key))throw new ValidationError('Duplicate source_name + source_record_id in upload.');
      seen.add(key);
      return r;
    }catch(e){if(e instanceof ValidationError)throw new ValidationError(`Record ${i+1}: ${e.message}`);throw e;}
  });
}

const UPSERT_SQL=`INSERT INTO public.healthcare_facilities AS current (
 source_name,source_record_id,name,category,county_fips,address,city,state,postal_code,phone,email,website,latitude,longitude,source_url,metadata
) SELECT r.source_name,r.source_record_id,r.name,r.category,r.county_fips,r.address,r.city,r.state,r.postal_code,r.phone,r.email,r.website,r.latitude,r.longitude,r.source_url,r.metadata
FROM jsonb_to_recordset($1::jsonb) AS r (
 source_name text,source_record_id text,name text,category text,county_fips text,address text,city text,state text,postal_code text,phone text,email text,website text,latitude double precision,longitude double precision,source_url text,metadata jsonb
)
ON CONFLICT (source_name, source_record_id) DO UPDATE SET
 name=EXCLUDED.name,category=EXCLUDED.category,county_fips=EXCLUDED.county_fips,address=EXCLUDED.address,city=EXCLUDED.city,state=EXCLUDED.state,postal_code=EXCLUDED.postal_code,phone=EXCLUDED.phone,email=EXCLUDED.email,website=EXCLUDED.website,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,source_url=EXCLUDED.source_url,metadata=EXCLUDED.metadata,updated_at=now()`;

/** Validates whole import before opening the DB transaction; an error rolls back the batch. */
export async function importFacilities(pool,rows){
  const records=validateRecords(rows),client=await pool.connect();
  try{
    await client.query('BEGIN');
    for(let i=0;i<records.length;i+=250)await client.query(UPSERT_SQL,[JSON.stringify(records.slice(i,i+250))]);
    await client.query('COMMIT');
    return {processed:records.length,batches:Math.ceil(records.length/250)};
  }catch(e){try{await client.query('ROLLBACK');}catch{}throw e;}
  finally{client.release();}
}

export async function listCountyFacilities(pool,countyFips,{category='',page=1,perPage=100}={}){
  if(!/^\d{5}$/.test(countyFips))throw new ValidationError('Invalid county FIPS.');
  if(category&&!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(category))throw new ValidationError('Invalid facility category.');
  if(!Number.isInteger(page)||page<1||page>100000)throw new ValidationError('Invalid page.');
  if(!Number.isInteger(perPage)||perPage<1||perPage>250)throw new ValidationError('Invalid page size.');
  const params=category?[countyFips,category]:[countyFips];
  const where=`WHERE county_fips=$1${category?' AND category=$2':''}`;
  const count=await pool.query(`SELECT COUNT(*)::int AS total FROM public.healthcare_facilities ${where}`,params);
  const total=Number(count.rows[0]?.total||0);
  const result=await pool.query(`SELECT id,name,category,address,city,state,postal_code,phone,email,website,latitude,longitude,source_name,source_url FROM public.healthcare_facilities ${where} ORDER BY name,id LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,perPage,(page-1)*perPage]);
  return {county_fips:countyFips,facilities:result.rows,page,per_page:perPage,total,has_more:page*perPage<total};
}

export async function listCategories(pool){
  const result=await pool.query('SELECT category,COUNT(*)::int AS total FROM public.healthcare_facilities GROUP BY category ORDER BY category');
  return result.rows.map(r=>({category:r.category,total:Number(r.total)}));
}
