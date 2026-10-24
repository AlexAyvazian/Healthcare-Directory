/* Healthcare map. Uses only geographic boundaries and dedicated /api/healthcare data. */
(() => {
'use strict';
const STATES=[['AL','Alabama','01'],['AK','Alaska','02'],['AZ','Arizona','04'],['AR','Arkansas','05'],['CA','California','06'],['CO','Colorado','08'],['CT','Connecticut','09'],['DE','Delaware','10'],['DC','District of Columbia','11'],['FL','Florida','12'],['GA','Georgia','13'],['HI','Hawaii','15'],['ID','Idaho','16'],['IL','Illinois','17'],['IN','Indiana','18'],['IA','Iowa','19'],['KS','Kansas','20'],['KY','Kentucky','21'],['LA','Louisiana','22'],['ME','Maine','23'],['MD','Maryland','24'],['MA','Massachusetts','25'],['MI','Michigan','26'],['MN','Minnesota','27'],['MS','Mississippi','28'],['MO','Missouri','29'],['MT','Montana','30'],['NE','Nebraska','31'],['NV','Nevada','32'],['NH','New Hampshire','33'],['NJ','New Jersey','34'],['NM','New Mexico','35'],['NY','New York','36'],['NC','North Carolina','37'],['ND','North Dakota','38'],['OH','Ohio','39'],['OK','Oklahoma','40'],['OR','Oregon','41'],['PA','Pennsylvania','42'],['RI','Rhode Island','44'],['SC','South Carolina','45'],['SD','South Dakota','46'],['TN','Tennessee','47'],['TX','Texas','48'],['UT','Utah','49'],['VT','Vermont','50'],['VA','Virginia','51'],['WA','Washington','53'],['WV','West Virginia','54'],['WI','Wisconsin','55'],['WY','Wyoming','56']];
const byFips=new Map(STATES.map(s=>[s[2],s]));const byAbbr=new Map(STATES.map(s=>[s[0],s]));
const allStates=topojson.feature(window.US_ATLAS,window.US_ATLAS.objects.states).features;
const allCounties=topojson.feature(window.US_ATLAS,window.US_ATLAS.objects.counties).features;
const $=id=>document.getElementById(id),svg=d3.select('#mapSvg');
let state=null,county=null,facilities=[],requestId=0;
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const countyId=f=>String(f.id).padStart(5,'0');
const stateId=f=>String(f.id).padStart(2,'0');
function render(){
const rect=$('mapSvg').getBoundingClientRect();const width=Math.max(rect.width,320),height=Math.max(rect.height,330);
svg.attr('viewBox',[0,0,width,height]);svg.selectAll('*').remove();
const region=state?allCounties.filter(f=>countyId(f).startsWith(state[2])):allStates;
const projection=d3.geoIdentity().reflectY(true).fitExtent([[22,22],[width-22,height-22]],{type:'FeatureCollection',features:region});
const path=d3.geoPath(projection);
svg.append('g').selectAll('path').data(region).join('path').attr('class',state?'county':'state').classed('selected',f=>countyId(f)===county).attr('d',path).attr('tabindex',0).attr('role','button').attr('aria-label',f=>state?(f.properties?.name||countyId(f)):(byFips.get(stateId(f))?.[1]||'State')).on('click',(_,f)=>choose(f)).on('keydown',(event,f)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(f);}});
if(state&&county){const selected=region.find(f=>countyId(f)===county);if(selected){const dots=svg.append('g');for(const facility of facilities){if(!Number.isFinite(facility.latitude)||!Number.isFinite(facility.longitude))continue;const point=projection([facility.longitude,facility.latitude]);if(point&&Number.isFinite(point[0])&&Number.isFinite(point[1])&&d3.geoContains(selected,[facility.longitude,facility.latitude]))dots.append('circle').attr('class','facility-pin').attr('cx',point[0]).attr('cy',point[1]).attr('r',4).append('title').text(facility.name);}}}
$('back').hidden=!state;$('breadcrumb').textContent=state?state[1]+(county?' / '+(region.find(f=>countyId(f)===county)?.properties?.name||county):''):'';
$('status').textContent=state?(county?'County selected':'Select a county'):'Select a state';
}
function choose(f){if(!state){state=byFips.get(stateId(f))||null;county=null;facilities=[];clearList('Select a county to see healthcare facilities.');render();return;}county=countyId(f);render();load();}
function clearList(message){$('subtitle').textContent=message;$('facilityList').replaceChildren();}
async function load(){const id=++requestId;facilities=[];const fips=county;const category=$('category').value;clearList('Loading facilities…');
try{const result=await fetch('/api/healthcare/county/'+encodeURIComponent(fips)+(category?'?category='+encodeURIComponent(category):''),{cache:'no-store'});if(!result.ok)throw Error('HTTP '+result.status);const data=await result.json();if(id!==requestId||county!==fips)return;if(!Array.isArray(data.facilities))throw Error('Invalid facility data');facilities=data.facilities;const list=$('facilityList');clearList(facilities.length?facilities.length+' facilities listed':'No facility records imported for this county yet.');for(const item of facilities){const card=document.createElement('article');card.className='facility';const parts=['<h2>'+safe(item.name)+'</h2>','<div>'+safe(item.category)+'</div>'];if(item.address)parts.push('<div>'+safe(item.address)+'</div>');if(item.phone)parts.push('<div>'+safe(item.phone)+'</div>');if(item.website&&/^https?:\/\//.test(item.website))parts.push('<div><a rel="noopener noreferrer" target="_blank" href="'+safe(item.website)+'">Website</a></div>');card.innerHTML=parts.join('');list.appendChild(card);}render();}
catch(e){if(id!==requestId)return;clearList('Healthcare facility service unavailable. Please retry.');}}
function reset(){requestId++;state=null;county=null;facilities=[];clearList('Select a state and county to view healthcare facilities.');render();}
$('home').addEventListener('click',reset);$('back').addEventListener('click',reset);$('category').addEventListener('change',()=>{if(county)load();});window.addEventListener('resize',render);reset();
})();