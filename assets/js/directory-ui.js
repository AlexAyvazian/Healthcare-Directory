/* Shared sidebar cards and record drawer for both healthcare directories. */
import {logoTitle} from './facility-logos.js';
export function safeUrl(value) {
  try {const u=new URL(value);return /^https?:$/.test(u.protocol)?u.href:null;} catch {return null;}
}
export function textLine(parent,value,className='line') {
  const node=document.createElement('div');node.className=className;node.textContent=value;parent.append(node);return node;
}
export function linkLine(parent,href,label) {
  if(!href)return;
  const line=document.createElement('div');line.className='line';
  const a=document.createElement('a');a.href=href;a.textContent=label;
  if(/^https?:/.test(href)){a.target='_blank';a.rel='noopener noreferrer';}
  a.addEventListener('click',e=>e.stopPropagation());line.append(a);parent.append(line);
}
export function facilityCard(item,{directory,onOpen}) {
  const card=document.createElement('article');card.className='facility';card.tabIndex=0;
  card.setAttribute('role','button');card.setAttribute('aria-label',`${item.name} — open details`);
  const heading=document.createElement('h3');heading.textContent=item.name;card.append(heading);logoTitle(heading,item,directory);
  if(item.category)textLine(card,item.category.replace(/[-_]/g,' '),'badge');
  const address=[item.address,item.city,item.state,item.postal_code].filter(Boolean).join(', ');
  if(address)textLine(card,address);
  if(item.phone)linkLine(card,'tel:'+String(item.phone).replace(/[^\d+]/g,''),item.phone);
  if(item.email && /^[^\s@]+@[^\s@]+$/.test(item.email))linkLine(card,'mailto:'+item.email,item.email);
  const site=safeUrl(item.website);if(site)linkLine(card,site,'Website ↗');
  if(item.source_name)textLine(card,'Source: '+item.source_name,'src');
  card.addEventListener('click',()=>onOpen(item,card));
  card.addEventListener('keydown',e=>{if(e.target===card && (e.key==='Enter'||e.key===' ')){e.preventDefault();onOpen(item,card);}});
  return card;
}
export function showRecord(item,{region='',glow='#69dcff'}={}) {
  const body=document.getElementById('drawerBody');body.replaceChildren();
  const h=document.createElement('h3');h.id='drawerTitle';h.textContent=item.name;body.append(h);
  if(item.category)textLine(body,item.category.replace(/[-_]/g,' '),'badge');
  const field=(label,value,href)=>{
    if(!value)return;
    const wrap=document.createElement('div');wrap.className='field';
    const l=document.createElement('label');l.textContent=label;
    const v=document.createElement('div');
    if(href){const a=document.createElement('a');a.href=href;a.textContent=value;if(/^https?:/.test(href)){a.target='_blank';a.rel='noopener noreferrer';}v.append(a);}else v.textContent=value;
    wrap.append(l,v);body.append(wrap);
  };
  field('Region',region);field('Address',item.address);field('City',item.city);field('State',item.state);field('Postal code',item.postal_code);
  field('Telephone',item.phone,item.phone?'tel:'+String(item.phone).replace(/[^\d+]/g,''):null);
  field('Email',item.email&&/^[^\s@]+@[^\s@]+$/.test(item.email)?item.email:null,'mailto:'+item.email);
  const website=safeUrl(item.website);field('Website',website?item.website:null,website);
  field('Source',item.source_name,safeUrl(item.source_url));
  if(item.source_retrieved_at)field('Source retrieved',new Date(item.source_retrieved_at).toLocaleDateString());
  const drawer=document.getElementById('drawer');drawer.style.setProperty('--drawerGlow',glow);drawer.hidden=false;document.getElementById('drawerClose').focus();
}
