import {listCountyFacilities,listCategories} from './neon-data.js';
import {facilityCard,showRecord,textLine} from './directory-ui.js';
import {US_GREY,regionStates} from './world-colors.js';
/* U.S. geography and read-only data; the interface is shared with the International Directory. */
(() => {
'use strict';
const states=topojson.feature(window.US_ATLAS,window.US_ATLAS.objects.states).features;
const counties=topojson.feature(window.US_ATLAS,window.US_ATLAS.objects.counties).features;
const $=id=>document.getElementById(id),svg=d3.select('#mapSvg');
const stateFips=f=>String(f.id).padStart(2,'0'),countyFips=f=>String(f.id).padStart(5,'0');
const toAtlas=d3.geoAlbersUsa().scale(1300).translate([487.5,305]);
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const theme={states:US_GREY};
let state=null,county=null,facilities=[],page=0,total=null,requestId=0,loading=false,drawerOrigin=null;
const category=$('category'),search=$('search'),list=$('facilityList'),more=$('loadMore');
let hasMore=false,searchTimer;
const name=f=>f.properties?.name||String(f.id);
const sorted=items=>[...items].sort((a,b)=>name(a).localeCompare(name(b)));
const countyRegions=()=>state?counties.filter(c=>countyFips(c).startsWith(stateFips(state))):[];
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
function colors(node,values){for(const [key,value]of Object.entries(values))node.style.setProperty('--'+key,value);}
function hideTip(){$('tooltip').style.display='none';}
function showTip(event,feature){
  const tip=$('tooltip');tip.textContent=name(feature);tip.style.display='block';
  const rect=event.currentTarget.getBoundingClientRect();
  tip.style.left=Math.max(8,Math.min(event.clientX||rect.x,innerWidth-tip.offsetWidth-12))+'px';
  tip.style.top=Math.max(8,Math.min((event.clientY||rect.y)+16,innerHeight-tip.offsetHeight-12))+'px';
}
function renderMap(){
  const rect=$('mapShell').getBoundingClientRect(),width=Math.max(rect.width,300),height=Math.max(rect.height,300);
  svg.attr('viewBox',[0,0,width,height]);
  const regions=sorted(state?countyRegions():states);
  const projection=d3.geoIdentity().fitExtent([[20,20],[width-20,height-20]],{type:'FeatureCollection',features:regions});
  const path=d3.geoPath(projection);
  const layer=svg.selectAll('g.mapLayer').data([null]).join('g').attr('class','mapLayer');
  layer.selectAll('path').data(regions,f=>(state?'county:':'state:')+f.id).join('path')
    .attr('class',state?'region county':'country state').classed('active',f=>Boolean(county&&countyFips(f)===countyFips(county)))
    .attr('d',path).attr('tabindex',0).attr('role','button')
    .attr('aria-label',f=>name(f)+(state?' County':''))
    .attr('aria-pressed',f=>String(Boolean(county&&countyFips(f)===countyFips(county))))
    .each(function(f,i){colors(this,regionStates(theme,i,regions.length));})
    .on('pointermove',showTip).on('pointerleave',hideTip).on('blur',hideTip)
    .on('click',(event,f)=>{event.stopPropagation();choose(f);})
    .on('keydown',(event,f)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(f);}});
  const pins=svg.selectAll('g.facilityPins').data([null]).join('g').attr('class','facilityPins');pins.selectAll('*').remove();
  if(county)for(const record of facilities){
    const lat=Number(record.latitude),lon=Number(record.longitude);
    if(record.latitude==null||record.longitude==null||!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const point=toAtlas([lon,lat]);if(!point||!inCounty(point,county))continue;
    const pixel=projection(point);
    pins.append('circle').attr('class','facility-pin').attr('cx',pixel[0]).attr('cy',pixel[1]).attr('r',4).append('title').text(record.name);
  }
}
function renderRegions(){
  const regions=sorted(state?countyRegions():states),term=$('regionFilter').value.toLocaleLowerCase();
  $('regionList').replaceChildren();
  regions.forEach((feature,index)=>{
    if(!name(feature).toLocaleLowerCase().includes(term))return;
    const chip=document.createElement('button');chip.type='button';chip.className='chip';chip.setAttribute('role','listitem');
    chip.setAttribute('aria-label',name(feature)+(state?' County':''));
    const selected=Boolean(county&&countyFips(feature)===countyFips(county));chip.classList.toggle('sel',selected);chip.setAttribute('aria-pressed',String(selected));
    colors(chip,regionStates(theme,index,regions.length));
    const swatch=document.createElement('span');swatch.className='swatch';swatch.setAttribute('aria-hidden','true');
    const text=document.createElement('span');text.textContent=name(feature);chip.append(swatch,text);chip.addEventListener('click',()=>choose(feature));$('regionList').append(chip);
  });
}
function renderPanel(){
  $('panelTitle').textContent=county?name(county):state?name(state):'United States';
  $('panelMeta').hidden=!county;$('panelMeta').textContent=state?name(state):'';
  $('modeBadge').textContent=county?'County selected':state?'State selected':'U.S. map';
  $('regionLabel').textContent=state?'Counties':'States';
  $('regionFilter').placeholder=state?'Find a county…':'Find a state…';
  const selected=$('selectedCard');selected.replaceChildren();
  textLine(selected,county?name(county)+', '+name(state):state?name(state):'United States','regionName');
  textLine(selected,county?(loading?'Loading facilities…':total===null?`${facilities.length.toLocaleString()} facilities loaded`:`${total.toLocaleString()} healthcare facilities`):state?`${countyRegions().length.toLocaleString()} counties & equivalents`:`${states.length} states & territories`,'count');
  $('statStates').textContent=states.length.toLocaleString();
  $('statCounties').textContent=(state?countyRegions().length:counties.length).toLocaleString();
  $('statFacilities').textContent=county?(loading?'–':(total??facilities.length).toLocaleString()):'–';
  $('mapLabel').textContent=county?`${name(state)} · ${name(county)} County`:state?name(state):'United States';
  search.disabled=!county;category.disabled=!county;
  more.hidden=!county||!hasMore;more.disabled=loading;
}
function empty(message){list.replaceChildren();textLine(list,message,'empty');$('listLabel').textContent=message;}
function openRecord(item,card){drawerOrigin=card;showRecord(item,{region:county?`${name(county)} County, ${name(state)}`:''});}
function closeDrawer(){const wasOpen=!$('drawer').hidden;$('drawer').hidden=true;if(wasOpen&&drawerOrigin?.isConnected)drawerOrigin.focus();}
function clearSelection(message){
  clearTimeout(searchTimer);requestId++;facilities=[];page=0;total=null;hasMore=false;loading=false;search.value='';category.value='';closeDrawer();hideTip();empty(message);
}
function render(){renderMap();renderRegions();renderPanel();}
function choose(feature){
  if(!state){state=feature;county=null;clearSelection('Select a county to see its healthcare facilities.');$('regionFilter').value='';render();}
  else{county=feature;clearSelection('Loading facilities…');render();load();}
}
function goUp(){
  if(county){county=null;clearSelection('Select a county to see its healthcare facilities.');}
  else if(state){state=null;clearSelection('Select a state and county to see healthcare facilities.');}
  $('regionFilter').value='';render();
}
async function load({append=false}={}){
  if(!county)return;
  const id=++requestId,selectedCounty=countyFips(county),selectedCategory=category.value,selectedSearch=search.value;
  const nextPage=append?page+1:1;loading=true;
  if(!append){facilities=[];total=null;hasMore=false;list.replaceChildren(...Array.from({length:3},()=>Object.assign(document.createElement('div'),{className:'skeleton'})));$('listLabel').textContent='Loading facilities…';}
  renderMap();renderPanel();
  try{
    const data=await listCountyFacilities(selectedCounty,{category:selectedCategory,search:selectedSearch,page:nextPage,perPage:100});
    if(id!==requestId||!county||countyFips(county)!==selectedCounty||category.value!==selectedCategory||search.value!==selectedSearch)return;
    if(!Array.isArray(data.facilities))throw Error('Unexpected facility response.');
    if(!append)list.replaceChildren();facilities.push(...data.facilities);
    for(const item of data.facilities)list.append(facilityCard(item,{directory:'usa',onOpen:openRecord}));
    page=nextPage;total=Number.isInteger(data.total)?data.total:null;hasMore=data.has_more;
    $('listLabel').textContent=facilities.length?(total===null?`Showing ${facilities.length} facilities`:`Showing ${facilities.length} of ${total} facilities`):'No facilities match this selection.';
    if(!facilities.length)empty('No facilities match this selection.');
  }catch{
    if(id===requestId){
      if(!append)empty('Healthcare facilities could not be loaded.');
      $('listLabel').textContent='Could not load facilities. Please try again.';
      const retry=document.createElement('button');retry.type='button';retry.textContent='Try again';retry.addEventListener('click',()=>{retry.remove();load({append});});list.append(retry);
    }
  }finally{if(id===requestId){loading=false;renderMap();renderPanel();}}
}
async function loadCategories(){
  try{
    const data=await listCategories();if(!Array.isArray(data.categories))return;
    for(const entry of data.categories){if(typeof entry.category!=='string')continue;const option=document.createElement('option');option.value=entry.category;option.textContent=entry.category.replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase())+' ('+entry.total+')';category.append(option);}
  }catch{/* Category counts are optional; the map remains usable. */}
}
$('regionFilter').addEventListener('input',renderRegions);
category.addEventListener('change',()=>load());
search.addEventListener('input',()=>{clearTimeout(searchTimer);requestId++;searchTimer=setTimeout(()=>load(),300);});
more.addEventListener('click',()=>load({append:true}));
svg.on('click.up',event=>{if(!event.target.closest?.('path.state,path.county'))goUp();});
$('drawerClose').addEventListener('click',closeDrawer);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('drawer').hidden)closeDrawer();else if(!event.target.closest?.('input,select'))goUp();}});
if(!reduced)document.addEventListener('pointermove',event=>{$('cursorGlow').style.left=event.clientX+'px';$('cursorGlow').style.top=event.clientY+'px';});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(renderMap,120);});
empty('Select a state and county to see healthcare facilities.');render();$('loading').hidden=true;document.body.dataset.ready='true';loadCategories();
})();
