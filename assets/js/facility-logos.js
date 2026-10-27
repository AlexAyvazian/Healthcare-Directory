/* Sidebar reads only saved logos. No provider lookup is initiated by page loads or scrolling. */
import {REGISTRY_API_URL} from './world-config.js';
const pending = new Map(), results = new Map();
let queued = false;
export function logoTitle(heading, item, directory) {
  const row=document.createElement('div');row.className='facilityHeading';
  const icon=document.createElement('span');icon.className='facilityLogo';icon.setAttribute('aria-hidden','true');icon.textContent='✚';
  heading.replaceWith(row);row.append(icon,heading);
  const source=item.logo_source || 'directory', id=String(item.id);
  const key=[directory,source,id].join('|');
  if (!results.has(key)) {
    let resolve;
    results.set(key,new Promise(r=>{resolve=r;}));
    const group=directory+'|'+source;
    if(!pending.has(group)) pending.set(group,[]);
    pending.get(group).push({id,resolve});
    if(!queued) {queued=true;queueMicrotask(flush);}
  }
  results.get(key).then(url=>{
    if(!url || !row.isConnected) return;
    let safe;
    try {safe=new URL(url,REGISTRY_API_URL);} catch {return;}
    if(safe.protocol!=='https:') return;
    const img=document.createElement('img');img.alt='';img.width=32;img.height=32;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
    img.addEventListener('error',()=>{img.remove();icon.textContent='✚';},{once:true});
    img.addEventListener('load',()=>{icon.firstChild?.nodeType===Node.TEXT_NODE && icon.firstChild.remove();},{once:true});
    img.src=safe.href;icon.append(img);
  });
}
async function flush() {
  queued=false;
  const groups=[...pending];pending.clear();
  await Promise.all(groups.map(async ([group,entries])=>{
    const [directory,source]=group.split('|');
    for(let offset=0;offset<entries.length;offset+=50) {
      const batch=entries.slice(offset,offset+50);
      try {
        const url=new URL(REGISTRY_API_URL+'/logos/'+directory);
        url.searchParams.set('source',source);url.searchParams.set('ids',batch.map(e=>e.id).join(','));
        const response=await fetch(url,{credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
        if(!response.ok) throw new Error('Logo cache unavailable');
        const body=await response.json();const found=new Map((body.logos || []).map(l=>[l.id,l.url]));
        batch.forEach(e=>e.resolve(found.get(e.id)||null));
      } catch {batch.forEach(e=>e.resolve(null));}
    }
  }));
}
