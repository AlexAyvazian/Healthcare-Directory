import {listCountyFacilities,listCategories} from './neon-data.js';
/* Viewer-only map: facility records and categories come from the read-only Neon Data API. */
(() => {
'use strict';
const states=topojson.feature(window.US_ATLAS,window.US_ATLAS.objects.states).features;
const counties=topojson.feature(window.US_ATLAS,window.US_ATLAS.objects.counties).features;
const $=id=>document.getElementById(id);
const svg=d3.select('#mapSvg');
const fips=feature=>String(feature.id).padStart(feature.id?.length===2?2:5,'0');
const stateFips=feature=>String(feature.id).padStart(2,'0');
const countyFips=feature=>String(feature.id).padStart(5,'0');
const toAtlas=d3.geoAlbersUsa().scale(1300).translate([487.5,305]);
let state=null,county=null,facilities=[],currentPage=0,total=0,requestId=0;
const categorySelect=$('category'),list=$('facilityList'),loadMore=$('loadMore');

function insideRing(p,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if(((a[1]>p[1])!==(b[1]>p[1]))&&(p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]))inside=!inside;
  }
  return inside;
}
function inCounty(point,feature){
  const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
  return polygons.some(polygon=>insideRing(point,polygon[0])&&!polygon.slice(1).some(hole=>insideRing(point,hole)));
}
function render(){
  const el=$('mapSvg'),rect=el.getBoundingClientRect();
  const width=Math.max(rect.width,320),height=Math.max(rect.height,330);
  svg.attr('viewBox',[0,0,width,height]);svg.selectAll('*').remove();
  const region=state?counties.filter(c=>countyFips(c).startsWith(stateFips(state))):states;
  const projection=d3.geoIdentity().fitExtent([[20,20],[width-20,height-20]],{type:'FeatureCollection',features:region});
  const path=d3.geoPath(projection);
  svg.append('g').selectAll('path').data(region).join('path')
    .attr('class',state?'county':'state').classed('selected',c=>county&&countyFips(c)===countyFips(county))
    .attr('d',path).attr('tabindex',0).attr('role','button')
    .attr('aria-label',c=>(c.properties?.name||'Unknown')+(state?' County':''))
    .on('click',(_,c)=>choose(c))
    .on('keydown',(e,c)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(c);}});
  if(county){
    const pins=svg.append('g');
    for(const record of facilities){
      const lat=Number(record.latitude),lon=Number(record.longitude);
      if(record.latitude==null||record.longitude==null||!Number.isFinite(lat)||!Number.isFinite(lon))continue;
      const atlasPoint=toAtlas([lon,lat]);
      if(!atlasPoint||!inCounty(atlasPoint,county))continue;
      const pixel=projection(atlasPoint);
      pins.append('circle').attr('class','facility-pin').attr('cx',pixel[0]).attr('cy',pixel[1]).attr('r',4).append('title').text(record.name);
    }
  }
  $('back').hidden=!state;
  $('breadcrumb').textContent=state?(state.properties?.name||stateFips(state))+(county?' / '+(county.properties?.name||countyFips(county)):''):'';
  $('status').textContent=county?'County selected':state?'Select a county':'Select a state';
}
function clearList(message){$('subtitle').textContent=message;list.replaceChildren();loadMore.hidden=true;}
function textNode(tag,value,parent){const node=document.createElement(tag);node.textContent=String(value);parent.appendChild(node);return node;}
function addFacility(item){
  const card=document.createElement('article');card.className='facility';
  textNode('h2',item.name,card);textNode('div',item.category||'Facility',card);
  const address=[item.address,item.city,item.state,item.postal_code].filter(Boolean).join(', ');
  if(address)textNode('div',address,card);
  if(item.phone)textNode('div',item.phone,card);
  if(item.email)textNode('div',item.email,card);
  if(item.source_name)textNode('small','Source: '+item.source_name,card);
  if(item.website&&/^https?:\/\//i.test(item.website)){
    const link=document.createElement('a');link.href=item.website;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Website';card.appendChild(link);
  }
  list.appendChild(card);
}
async function load({append=false}={}){
  if(!county)return;
  const id=++requestId,selectedCounty=countyFips(county),selectedCategory=categorySelect.value;
  const page=append?currentPage+1:1;
  if(!append){facilities=[];currentPage=0;clearList('Loading facilities…');render();}
  loadMore.disabled=true;
  try{
    const data=await listCountyFacilities(selectedCounty,{category:selectedCategory,page,perPage:100});
    if(id!==requestId||!county||countyFips(county)!==selectedCounty||categorySelect.value!==selectedCategory)return;
    if(!Array.isArray(data.facilities))throw new Error('Unexpected facility response.');
    if(!append)list.replaceChildren();
    facilities.push(...data.facilities);for(const item of data.facilities)addFacility(item);
    currentPage=page;total=Number.isInteger(data.total)?data.total:null;
    $('subtitle').textContent=facilities.length?(total===null?`Showing ${facilities.length} facilities`:`Showing ${facilities.length} of ${total} facilities`):'No facility records imported for this county yet.';
    loadMore.hidden=!data.has_more;render();
  }catch(e){
    if(id===requestId){if(!append)clearList('Healthcare records could not be loaded from Neon. Please try again.');else $('subtitle').textContent='Could not load more facilities.';}
  }finally{if(id===requestId)loadMore.disabled=false;}
}
function choose(feature){
  requestId++;
  if(!state){state=feature;county=null;facilities=[];currentPage=0;clearList('Select a county to see healthcare facilities.');render();return;}
  county=feature;facilities=[];currentPage=0;render();load();
}
function reset(){requestId++;state=null;county=null;facilities=[];currentPage=0;clearList('Select a state and county to view facilities stored in Neon.');render();}
async function loadCategories(){
  try{
    const data=await listCategories();
    if(!Array.isArray(data.categories))return;
    for(const entry of data.categories){
      if(typeof entry.category!=='string')continue;
      const option=document.createElement('option');option.value=entry.category;
      option.textContent=entry.category.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase())+' ('+entry.total+')';
      categorySelect.appendChild(option);
    }
  }catch{ /* The map remains usable without category counts. */ }
}
$('home').addEventListener('click',reset);$('back').addEventListener('click',reset);
categorySelect.addEventListener('change',()=>{if(county)load();});
loadMore.addEventListener('click',()=>load({append:true}));
window.addEventListener('resize',render);
reset();loadCategories();
})();
