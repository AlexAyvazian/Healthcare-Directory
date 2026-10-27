/* Credentials never leave the Worker. Availability is shared across directories in the US logo DB. */
export function domainOf(value) {
  try {
    const u = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) || u.username || u.password) return null;
    if (/(^|\.)(facebook\.com|instagram\.com|linkedin\.com|google\.com|goo\.gl|yelp\.com|wixsite\.com|wordpress\.com)$/.test(host)) return null;
    return host;
  } catch { return null; }
}
export const normalizedName = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const list = (env, prefix, n) => Array.from({length:n}, (_, i) => ({name: prefix + (i ? '_' + (i+1) : ''), value: env[prefix + (i ? '_' + (i+1) : '')], slot:i})).filter(x => x.value);
const fingerprint = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');

export async function pooledRequest({env, accountDb, db, brandKey, provider, prefix, count, makeRequest, fetchImpl = fetch, budget: optionsBudget = {used:0}}) {
  let transient = false;
  for (const account of list(env, prefix, count)) {
    if(optionsBudget.used>=4) return {response:null,transient:true};
    const fp = await fingerprint(account.value);
    const availability = await accountDb.query(`INSERT INTO logo_provider_accounts(account_name,fingerprint) VALUES($1,$2)
      ON CONFLICT(account_name) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,
      unavailable_until=CASE WHEN logo_provider_accounts.fingerprint<>EXCLUDED.fingerprint THEN NULL ELSE logo_provider_accounts.unavailable_until END
      RETURNING unavailable_until`, [account.name,fp]);
    if (availability[0]?.unavailable_until && new Date(availability[0].unavailable_until) > new Date()) {transient = true; continue;}
    optionsBudget.used++;
    let response;
    try { const [url,init] = makeRequest(account); response = await fetchImpl(url, { ...init, redirect:'error', signal:AbortSignal.timeout(8000) }); }
    catch { transient = true; await log('network_error'); continue; }
    await log(response.ok ? 'success' : 'http_error', response.status);
    if ([401,402,403,429].includes(response.status)) {
      const retryHeader = response.headers.get('retry-after');
      const seconds = /^\d+$/.test(retryHeader || '') ? Math.max(60,Number(retryHeader)) : retryHeader && Number.isFinite(Date.parse(retryHeader)) ? Math.max(60,(Date.parse(retryHeader)-Date.now())/1000) : response.status===429 ? 3600 : 86400;
      await accountDb.query(`UPDATE logo_provider_accounts SET unavailable_until=now()+$2::double precision*interval '1 second',last_status=$3,updated_at=now() WHERE account_name=$1`, [account.name,seconds,response.status]);
      transient = true;
      continue;
    }
    if (response.status >= 500 || response.status === 202) {transient = true; continue;}
    return {response, account, transient};
    async function log(outcome, status=null) {
      await db.query('INSERT INTO logo_lookup_history(brand_key,provider,account_name,outcome,http_status) VALUES($1,$2,$3,$4,$5)',[brandKey,provider,account.name,outcome,status]);
    }
  }
  return {response:null, transient};
}

export async function resolveBrand(input, options) {
  const {env} = options;
  options = {...options,budget:{used:0}};
  let domain = domainOf(input.website || ''), method = 'website_domain', confidence = 1;
  let transient = false, candidate = null;
  const call = async args => {const result=await pooledRequest({...options, ...args});transient ||= result.transient;return result;};
  if (!domain) {
    const {response} = await call({provider:'logo_dev_search',prefix:'LOGO_DEV_API_KEY',count:2,
      makeRequest:a=>['https://api.logo.dev/v2/search?q='+encodeURIComponent(input.name)+'&limit=5',{headers:{Authorization:'Bearer '+a.value}}]});
    if (response?.ok) {
      const result = await response.json();
      const matches = (Array.isArray(result) ? result : result.data || []).filter(r=> normalizedName(r.name)===normalizedName(input.name) && domainOf(r.domain));
      if (matches.length===1) {
        candidate=matches[0];
        const check=await call({provider:'brandfetch_verify',prefix:'BRANDFETCH_API_KEY',count:2,makeRequest:a=>['https://api.brandfetch.io/v2/brands/'+domainOf(candidate.domain),{headers:{Authorization:'Bearer '+a.value}}]});
        if(check.response?.ok) {
          const brand=await check.response.json();
          if(domainOf(brand.domain)===domainOf(candidate.domain) && normalizedName(brand.name)===normalizedName(input.name) && brand.company?.location?.countryCode===input.country) {domain=domainOf(candidate.domain);method='exact_name_country';confidence=0.95;}
        }
        if(!domain) return {status:transient?'error':'review',method:'name_requires_review',confidence:0,candidate};
      }
      else if (matches.length>1) return {status:'review',method:'ambiguous_name',confidence:0};
    }
  }
  if (domain) {
    const saved=await options.db.query("SELECT * FROM brands WHERE domain=$1 AND locked AND status='resolved'",[domain]);
    if(saved[0]) return {...saved[0],name:saved[0].brand_name,method,confidence};
    const tokens = list(env,'LOGO_DEV_TOKEN',2);
    // The saved PNG is served from Neon, so later views spend no provider/CDN requests.
    if (tokens.length) {
      const {response} = await call({provider:'logo_dev',prefix:'LOGO_DEV_TOKEN',count:2,
        makeRequest:a=>['https://img.logo.dev/'+domain+'?token='+encodeURIComponent(a.value)+'&size=64&format=png&fallback=404',{}]});
      if (response?.ok && response.headers.get('content-type')?.startsWith('image/png')) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length<=128*1024) return {status:'resolved',domain,name:input.name,provider:'logo_dev',method,confidence,image_base64:btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')),image_type:'image/png'};
      }
    }
    const {response} = await call({provider:'brandfetch',prefix:'BRANDFETCH_API_KEY',count:2,
      makeRequest:a=>['https://api.brandfetch.io/v2/brands/'+domain,{headers:{Authorization:'Bearer '+a.value}}]});
    if (response?.ok) {
      const brand = await response.json();
      if (domainOf(brand.domain)===domain) {
        const formats=(brand.logos || []).sort((a,b)=>Number(b.type==='icon')-Number(a.type==='icon')).flatMap(x=>x.formats || []);
        const image = formats.find(f=>/^https:\/\/cdn\.brandfetch\.io\//.test(f.src || '') && ['png','svg','webp'].includes(f.format));
        if(image) return {status:'resolved',domain,name:brand.name || input.name,provider:'brandfetch',logo_url:image.src,method,confidence};
      }
    }
  }
  // API Ninjas has no domain in its results: only an unambiguous exact company name is eligible.
  const {response} = await call({provider:'api_ninjas',prefix:'NINJAS_API_KEY',count:4,
    makeRequest:a=>['https://api.api-ninjas.com/v1/logo?name='+encodeURIComponent(input.name),{headers:{'X-Api-Key':a.value}}]});
  if (response?.ok) {
    const candidates = await response.json();
    const matches = (Array.isArray(candidates)?candidates:[]).filter(r=>normalizedName(r.name)===normalizedName(input.name) && /^https:\/\/(?:[a-z0-9-]+\.)*api-ninjas\.com\//i.test(r.image_thumbnail || ''));
    // Name-only results do not establish location/identity. Keep candidates for explicit review.
    if(matches.length) return {status:'review',domain,method:'name_requires_review',confidence:0,candidate:matches[0]};
  }
  return {status:transient ? 'error':'not_found',domain,method,confidence:0};
}
