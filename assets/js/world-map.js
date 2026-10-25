/* International Directory map — the sibling of the original contact map (renderUSMap /
 * renderStateMap / renderSideList / openRecord at 4a0d5f1), extended to the world:
 * World → country → first-level region → deeper regions where geoBoundaries publishes them.
 * Geographic regions are the ONLY selectable map objects: no facility pins, markers or dots. */
import {COUNTRIES} from './world-catalog.js';
import {countryStates, regionStates} from './world-colors.js';
import {loadLevel, assignParents} from './world-geo.js';
import {singularLabel, plural} from './world-labels.js';
import {listFacilities, listCategories, PAGE_SIZE} from './world-data.js';

(() => {
'use strict';
const $ = id => document.getElementById(id);
const svg = d3.select('#mapSvg'), tooltip = d3.select('#tooltip');
const byIso = new Map(COUNTRIES.map(c => [c.iso3, c]));
const byNumeric = new Map(COUNTRIES.filter(c => c.numeric).map(c => [c.numeric, c]));
const byAtlasName = new Map(COUNTRIES.flatMap(c => c.atlasNames.map(n => [n, c])));
const directoryCountries = COUNTRIES.filter(c => !c.redirect && !c.noDirectory);
const FLY_MS = 750;

let width = 0, height = 0;
/* Flat (cylindrical) Miller projection: straight meridians and parallels, no globe-like curvature,
 * and the whole of Antarctica stays on the map. Country views only shift east–west, never tilt. */
const millerRaw = (lambda, phi) => [lambda, 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * phi))];
millerRaw.invert = (x, y) => [x, 2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI];
const flatProjection = () => d3.geoProjection(millerRaw);
const projection = flatProjection();
const path = d3.geoPath(projection);
let worldFeatures = [];
let focusTarget = {target: {type: 'Sphere'}, rotate: [0, 0]};
let flying = null;

/* Selection state: country, chain of selected regions (one per level), loaded level features. */
const state = {country: null, chain: [], levels: [], geoError: null, geoLoading: false, rotate: [0, 0]};
let navToken = 0;
const list = {token: 0, abort: null, page: 0, items: [], total: null};

/* ---------- SVG scaffolding (sphere kept invisible, graticule, layers) ---------- */
const viewport = svg.append('g').attr('class', 'viewport');
const sphereLayer = viewport.append('path').attr('class', 'sphere');
const graticuleLayer = viewport.append('path').attr('class', 'graticule').datum(d3.geoGraticule10());
const countryLayer = viewport.append('g').attr('class', 'countries');
const regionRoot = viewport.append('g').attr('class', 'regions');

const featureCountry = feature => (feature.id && byNumeric.get(feature.id)) || byAtlasName.get(feature.properties?.name) || null;
const styleVars = (selection, colors) => selection
  .style('--fill', c => colors(c).fill).style('--hover', c => colors(c).hover)
  .style('--selected', c => colors(c).selected).style('--outline', c => colors(c).outline).style('--glow', c => colors(c).glow);
const levelLabel = (country, index) => {
  const label = country?.levels[index]?.label;
  return label ? singularLabel(label) : (index === 0 ? 'Region' : `Level ${index + 1} region`);
};

/* Focus on the main landmass of a feature (overseas fragments far from it would zoom the map out). */
function focusGeometry(feature) {
  const g = feature.geometry;
  if (!g || g.type !== 'MultiPolygon' || g.coordinates.length < 2) return feature;
  const parts = g.coordinates.map(coordinates => ({type: 'Polygon', coordinates})).map(p => ({p, area: d3.geoArea(p), c: d3.geoCentroid(p)}));
  const main = parts.reduce((a, b) => (b.area > a.area ? b : a));
  const keep = parts.filter(x => x.area >= main.area * 0.2 || d3.geoDistance(x.c, main.c) < 0.35);
  return {type: 'Feature', geometry: {type: 'MultiPolygon', coordinates: keep.map(x => x.p.coordinates)}};
}

function fitParams(target, rotate) {
  const pad = Math.max(16, Math.min(width, height) * 0.06);
  const p = flatProjection().rotate(rotate).precision(0.2);
  if (target.type === 'Sphere') p.fitExtent([[10, 10], [width - 10, height - 10]], target);
  else p.fitExtent([[pad, pad], [width - pad, height - pad]], target);
  return {r: rotate, k: p.scale(), t: p.translate()};
}
/* Centre the flat map on a country by shifting east–west only; tilting north–south would bend it. */
function countryRotation(feature) {
  const [lon] = d3.geoCentroid(feature);
  return [-lon, 0];
}

/* Smoothly fly from the current view to `target`, then re-project every layer at full precision.
 * Within one country the move is an affine zoom of the rendered layers; between countries the
 * projection itself rotates (only the light world outlines are redrawn per frame). */
function flyTo(target, animate = true, rotate = projection.rotate().slice(0, 2)) {
  focusTarget = {target, rotate};
  const next = fitParams(target, rotate);
  const r0 = projection.rotate().slice(0, 2), k0 = projection.scale(), t0 = projection.translate();
  const finish = () => {
    flying = null;
    projection.rotate(next.r).scale(next.k).translate(next.t).precision(0.2);
    viewport.attr('transform', null);
    redraw();
  };
  viewport.interrupt();
  svg.interrupt('rotate');
  if (!animate || !k0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finish(); return Promise.resolve(); }
  const sameRotation = Math.abs(r0[0] - next.r[0]) < 1e-6 && Math.abs(r0[1] - next.r[1]) < 1e-6;
  if (!sameRotation) {
    const r1 = next.r.slice();
    while (r1[0] - r0[0] > 180) r1[0] -= 360;
    while (r1[0] - r0[0] < -180) r1[0] += 360;
    const rotation = d3.interpolate(r0, r1), translate = d3.interpolate(t0, next.t);
    const bump = Math.min(1, d3.geoDistance([-r0[0], -r0[1]], [-r1[0], -r1[1]]) / Math.PI) * 0.6;
    return new Promise(resolve => {
      flying = svg.transition('rotate').duration(1000).ease(d3.easeCubicInOut)
        .tween('rotate', () => e => {
          const k = Math.exp(Math.log(k0) + (Math.log(next.k) - Math.log(k0)) * e) * (1 - bump * Math.sin(Math.PI * e));
          projection.rotate(rotation(e)).scale(k).translate(translate(e));
          renderWorldMap();
        })
        .on('end', () => { finish(); resolve(); })
        .on('interrupt', resolve);
    });
  }
  const S = next.k / k0, T = [next.t[0] - t0[0] * S, next.t[1] - t0[1] * S];
  const from = [width / 2, height / 2, width];
  const to = [(width / 2 - T[0]) / S, (height / 2 - T[1]) / S, width / S];
  const zoom = d3.interpolateZoom(from, to);
  return new Promise(resolve => {
    flying = viewport.transition().duration(Math.min(1400, Math.max(FLY_MS, zoom.duration * 0.6))).ease(d3.easeCubicInOut)
      .attrTween('transform', () => e => {
        const [cx, cy, w] = zoom(e), k = width / w;
        return `translate(${width / 2 - cx * k},${height / 2 - cy * k}) scale(${k})`;
      })
      .on('end', () => { finish(); resolve(); })
      .on('interrupt', resolve);
  });
}

function measure() {
  const node = $('mapShell');
  width = Math.max(node.clientWidth, 280);
  height = Math.max(node.clientHeight, 260);
  svg.attr('viewBox', [0, 0, width, height]);
}

/* ---------- Tooltip + cursor glow (original contact-map behaviour) ---------- */
function showTip(event, html, colors) {
  tooltip.style('display', 'block').style('left', (event.clientX + 14) + 'px').style('top', (event.clientY + 14) + 'px')
    .style('--tip', colors?.glow || null).style('--tipGlow', colors ? colors.glow + '55' : null).html(html);
}
function hideTip() { tooltip.style('display', 'none'); }
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
document.addEventListener('mousemove', e => { const g = $('cursorGlow'); g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px'; });

function bindRegionEvents(selection, onChoose, describe) {
  selection
    .attr('tabindex', 0).attr('role', 'button')
    .on('mouseenter', function () { d3.select(this).raise(); })
    .on('mousemove', (event, d) => { const [html, colors] = describe(d); showTip(event, html, colors); })
    .on('mouseleave', hideTip)
    .on('focus', function () { d3.select(this).classed('kb', true); })
    .on('blur', function () { d3.select(this).classed('kb', false); })
    .on('click', (event, d) => { hideTip(); onChoose(d); })
    .on('keydown', (event, d) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onChoose(d); } });
}

/* ---------- Rendering: renderWorldMap() + renderRegionMap() ---------- */
function renderWorldMap() {
  sphereLayer.datum({type: 'Sphere'}).attr('d', path);
  graticuleLayer.attr('d', path);
  const selected = state.country;
  // Keyed by each feature's own index (not DOM position): hover raise() reorders the DOM, and a
  // positional key would rebind paths to other countries and leave stale colour variables.
  countryLayer.selectAll('path.country').data(worldFeatures, d => d.atlasIndex).join(enter => {
    const paths = enter.append('path');
    styleVars(paths, d => countryStates(featureCountry(d)));
    bindRegionEvents(paths, d => chooseCountry(featureCountry(d)), d => {
      const c = featureCountry(d);
      if (!c) return [escapeHtml(d.properties?.name), null];
      const note = c.redirect ? 'Opens the U.S. Healthcare Directory' : c.noDirectory ? 'No ISO 3166 country code · not in the directory'
        : c.levels.length ? `${plural(c.levels[0].units || 0, levelLabel(c, 0).toLowerCase())} · select to explore` : 'Select to view national records';
      return [`<b>${escapeHtml(c.name)}</b><br><small>${escapeHtml(note)}</small>`, countryStates(c)];
    });
    return paths.attr('aria-label', d => { const c = featureCountry(d); return c ? (c.redirect ? `${c.name} (opens the U.S. directory)` : c.name) : d.properties?.name; });
  })
    .attr('d', path)
    .attr('class', d => {
      const c = featureCountry(d);
      const cls = ['country'];
      if (c?.redirect) cls.push('us');
      if (selected) cls.push(c === selected ? 'selected' : 'dim');
      return cls.join(' ');
    })
    .attr('data-iso3', d => featureCountry(d)?.iso3 || null);
}

/* Features shown for level `i`: all first-level regions, or children of the selected parent. */
function regionsAt(i) {
  const all = state.levels[i];
  if (!all) return null;
  if (i === 0) return all;
  const parent = state.chain[i - 1];
  if (!parent || !state.levels[i - 1]) return null;
  const parents = assignParents(all, state.levels[i - 1], d3);
  return all.filter(f => parents.get(f.key) === parent.key);
}

function renderRegionMap() {
  const country = state.country;
  const layers = [];
  for (let i = 0; i < state.levels.length; i++) {
    const features = regionsAt(i);
    if (!features) break;
    layers.push({i, features: features.slice().sort((a, b) => a.name.localeCompare(b.name))});
  }
  regionRoot.selectAll('g.level').data(layers, d => d.i).join(enter => enter.append('g').attr('class', d => `level level-${d.i} fadeIn`))
    .each(function (layer) {
      const total = layer.features.length;
      const colorOf = new Map(layer.features.map((f, idx) => [f.key, regionStates(country, idx, total)]));
      const chosen = state.chain[layer.i];
      const hasChildLayer = layers.some(l => l.i === layer.i + 1);
      const paths = d3.select(this).selectAll('path.region').data(layer.features, f => f.key).join(enter => {
        const p = enter.append('path');
        bindRegionEvents(p, f => chooseRegion(layer.i, f), f => [
          `<b>${escapeHtml(f.name)}</b><br><small>${escapeHtml(levelLabel(country, layer.i))} · ${escapeHtml(country.name)}</small>`, colorOf.get(f.key)]);
        return p;
      });
      styleVars(paths, f => colorOf.get(f.key));
      paths.attr('d', f => path(f.geometry))
        .attr('aria-label', f => `${f.name}, ${levelLabel(country, layer.i)}`)
        .attr('aria-pressed', f => String(chosen === f))
        .attr('class', f => ['region', chosen === f ? 'active' : chosen ? 'dim' : '', chosen === f && hasChildLayer ? 'parent' : ''].filter(Boolean).join(' '));
      if (chosen && !hasChildLayer) paths.filter(f => f === chosen).raise();
    });
  // While the selected country's regions are on screen its world outline sits underneath them.
  countryLayer.selectAll('path.country').classed('hidden', d => state.levels.length > 0 && featureCountry(d) === country && !!regionsAt(0));
}

function redraw() {
  if (!worldFeatures.length) return;
  renderWorldMap();
  renderRegionMap();
}

/* ---------- Geometry loading ---------- */
function showProgress(fraction) {
  const bar = $('geoProgress');
  bar.hidden = fraction === null;
  bar.firstElementChild.style.width = Math.round((fraction || 0) * 100) + '%';
}
async function loadRegionLevel(country, index, token) {
  const source = country.levels[index];
  state.geoLoading = true; state.geoError = null;
  setMapLabel(`Loading ${levelLabel(country, index).toLowerCase()} boundaries for ${country.name}… (${(source.bytes / 1e6).toFixed(1)} MB, verified)`);
  showProgress(0);
  try {
    const features = await loadLevel(country.iso3, source, d3, {onProgress: f => token === navToken && showProgress(f)});
    if (token !== navToken) return false;
    state.levels[index] = features;
    return true;
  } catch (error) {
    if (token !== navToken) return false;
    state.geoError = error;
    console.error(error);
    return false;
  } finally {
    if (token === navToken) { state.geoLoading = false; showProgress(null); }
  }
}

/* ---------- Navigation ---------- */
function syncHistory(push) {
  const parts = state.country ? [state.country.iso3, ...state.chain.map(f => f.key)] : [];
  const hash = parts.length ? '#/' + parts.map(encodeURIComponent).join('/') : '';
  if (location.hash === hash || (!hash && !location.hash)) return;
  if (push) history.pushState({parts}, '', hash || location.pathname);
  else history.replaceState({parts}, '', hash || location.pathname);
}

async function chooseCountry(country, {push = true, animate = true} = {}) {
  if (!country) return;
  if (country.redirect) { window.location.assign(country.redirect); return; }
  if (country.noDirectory) {
    setMapLabel(`${country.name} has no ISO 3166 country code and is not part of the directory.`);
    return;
  }
  const token = ++navToken;
  state.country = country; state.chain = []; state.levels = []; state.geoError = null;
  state.geoLoading = country.levels.length > 0;
  syncHistory(push);
  closeDrawer();
  $('regionFilter').value = '';
  updatePanel();
  renderRegionList();
  resetFacilityTools();
  loadCategoryOptions(country);
  reloadFacilities();
  renderRegionMap();
  const feature = worldFeatures.filter(f => featureCountry(f) === country).sort((a, b) => d3.geoArea(b) - d3.geoArea(a))[0];
  const focus = feature ? focusGeometry(feature) : {type: 'Sphere'};
  state.rotate = feature ? countryRotation(focus) : [0, 0];
  const flight = flyTo(focus, animate, state.rotate);
  if (country.levels.length) {
    const ok = await loadRegionLevel(country, 0, token);
    await flight;
    if (token !== navToken) return;
    if (ok) renderRegionMap();
  } else await flight;
  if (token === navToken) { updatePanel(); renderRegionList(); }
}

async function chooseRegion(index, feature, {push = true, animate = true} = {}) {
  const country = state.country;
  if (!country || !feature) return;
  const token = ++navToken;
  state.chain = state.chain.slice(0, index).concat(feature);
  state.levels = state.levels.slice(0, index + 1);
  state.geoError = null;
  state.geoLoading = !!country.levels[index + 1];
  syncHistory(push);
  closeDrawer();
  $('regionFilter').value = '';
  updatePanel();
  renderRegionList();
  reloadFacilities();
  renderRegionMap();
  const flight = flyTo(focusGeometry(feature), animate, state.rotate);
  if (country.levels[index + 1]) {
    const ok = await loadRegionLevel(country, index + 1, token);
    await flight;
    if (token !== navToken) return;
    if (ok) { assignParents(state.levels[index + 1], state.levels[index], d3); renderRegionMap(); }
  } else await flight;
  if (token === navToken) { updatePanel(); renderRegionList(); }
}

function chooseWorld({push = true, animate = true} = {}) {
  ++navToken;
  state.country = null; state.chain = []; state.levels = []; state.geoError = null;
  showProgress(null);
  syncHistory(push);
  closeDrawer();
  $('regionFilter').value = '';
  if (list.abort) list.abort.abort();
  list.token++;
  updatePanel();
  resetFacilityTools();
  renderFacilityPlaceholder();
  renderRegionMap();
  flyTo({type: 'Sphere'}, animate, [0, 0]);
  redraw();
  renderRegionList();
}

function goUp() {
  if (!state.country) return;
  if (state.chain.length > 1) chooseRegion(state.chain.length - 2, state.chain[state.chain.length - 2]);
  else if (state.chain.length === 1) chooseCountry(state.country);
  else chooseWorld();
}

async function navigateTo(parts, options) {
  if (!parts.length) { chooseWorld(options); return; }
  const country = byIso.get(parts[0]);
  if (!country || country.redirect || country.noDirectory) { chooseWorld(options); return; }
  await chooseCountry(country, options);
  for (let i = 1; i < parts.length; i++) {
    const candidates = regionsAt(i - 1) || [];
    const feature = candidates.find(f => f.key === parts[i]);
    if (!feature) break;
    await chooseRegion(i - 1, feature, {...options, push: false});
  }
}
const hashParts = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

/* ---------- Side panel: renderSideList() equivalent ---------- */
function setMapLabel(text) { $('mapLabel').textContent = text; }

function updatePanel() {
  const {country, chain} = state;
  const current = chain.at(-1);
  const colors = country ? (current ? regionStatesFor(chain.length - 1, current) : countryStates(country)) : null;
  $('panelTitle').textContent = current ? current.name : country ? country.name : 'World';
  $('modeBadge').textContent = current ? levelLabel(country, chain.length - 1) : country ? 'Country' : 'World map';
  $('backBtn').hidden = !country;
  $('mapToolbar').hidden = !country; // breadcrumbs/back only once a country is selected
  $('backBtn').textContent = chain.length > 1 ? `← ${chain.at(-2).name}` : chain.length === 1 ? `← ${country.name}` : '← World';
  document.documentElement.style.setProperty('--glow', colors?.glow || '#69dcff');
  document.documentElement.style.setProperty('--cardGlow', colors?.glow || 'rgba(125,211,252,.8)');

  const crumbs = $('breadcrumbs');
  crumbs.replaceChildren();
  const items = [['World', () => chooseWorld()]];
  if (country) items.push([country.name, () => chooseCountry(country)]);
  chain.forEach((f, i) => items.push([f.name, () => chooseRegion(i, f)]));
  items.forEach(([label, action], i) => {
    const li = document.createElement('li');
    if (i === items.length - 1) {
      const span = document.createElement('span');
      span.setAttribute('aria-current', 'location');
      span.textContent = label;
      li.appendChild(span);
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', action);
      li.appendChild(button);
    }
    crumbs.appendChild(li);
  });

  let meta, label;
  const nextIndex = chain.length;
  if (!country) {
    meta = `${plural(directoryCountries.length, 'country')} and territories. The United States opens its own directory.`;
    label = 'World map · select a country';
  } else if (state.geoLoading) {
    meta = `Loading ${levelLabel(country, nextIndex).toLowerCase()} boundaries…`;
    label = $('mapLabel').textContent;
  } else if (state.geoError) {
    meta = 'Boundary data could not be loaded. Facility records are still listed below.';
    label = `${current ? current.name : country.name} · boundaries unavailable`;
  } else if (country.levels[nextIndex]) {
    meta = `Select a ${levelLabel(country, nextIndex).toLowerCase()} on the map or in the list.`;
    label = `${current ? current.name : country.name} · ${plural(regionsAt(nextIndex)?.length || 0, levelLabel(country, nextIndex).toLowerCase())}`;
  } else if (!country.levels.length) {
    meta = 'geoBoundaries publishes no subdivision boundaries for this country; showing national records.';
    label = `${country.name} · national view`;
  } else {
    meta = 'Most detailed boundary level available for this area.';
    label = `${current.name} · ${levelLabel(country, chain.length - 1)}`;
  }
  $('panelMeta').textContent = meta;
  setMapLabel(label);

  const card = $('selectedCard');
  card.replaceChildren();
  const name = document.createElement('div');
  name.className = 'regionName';
  if (colors) {
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.setProperty('--fill', colors.fill);
    swatch.style.setProperty('--glow', colors.glow);
    name.appendChild(swatch);
  }
  name.appendChild(document.createTextNode(current ? current.name : country ? country.name : 'No country selected'));
  card.appendChild(name);
  const count = document.createElement('div');
  count.className = 'count';
  count.id = 'selectionCount';
  count.textContent = country ? countText() : 'Hover a country to light it up; click to focus it.';
  card.appendChild(count);
  if (country) {
    const note = document.createElement('div');
    note.className = 'note';
    const source = country.levels[Math.max(0, chain.length - 1)];
    note.textContent = source ? `Boundaries: geoBoundaries ${source.level}${source.year ? ' (' + source.year + ')' : ''} · ${source.source || 'source not stated'} · ${source.license || 'licence not stated'}` : 'Boundaries: Natural Earth country outline.';
    card.appendChild(note);
    $('geoCredit').textContent = source ? `geoBoundaries ${country.iso3} ${source.level} — ${source.source || ''} (${source.license || 'licence not stated'})` : 'geoBoundaries (gbOpen), loaded per country.';
    if (state.geoError) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry loading boundaries';
      retry.addEventListener('click', () => (current ? chooseRegion(chain.length - 1, current, {push: false}) : chooseCountry(country, {push: false})));
      card.appendChild(retry);
    }
  }
}
function regionStatesFor(level, feature) {
  const features = (regionsAt(level) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  return regionStates(state.country, Math.max(0, features.indexOf(feature)), features.length);
}
function countText() {
  if (list.total === null && !list.items.length) return 'Counting published facilities…';
  const total = list.total ?? list.items.length;
  return total ? `${plural(total, 'healthcare facility')} published` : 'No healthcare facilities published here yet';
}

function renderRegionList() {
  const container = $('regionList'), filter = $('regionFilter').value.trim().toLowerCase();
  container.replaceChildren();
  const {country, chain} = state;
  let entries, label;
  if (!country) {
    entries = COUNTRIES.filter(c => !c.noDirectory).slice().sort((a, b) => a.name.localeCompare(b.name))
      .map(c => ({name: c.redirect ? `${c.name} ↗` : c.name, colors: countryStates(c), choose: () => chooseCountry(c), selected: false}));
    label = `Countries (${entries.length})`;
    $('regionFilter').placeholder = 'Find a country…';
  } else {
    const nextIndex = chain.length;
    const deeper = regionsAt(nextIndex);
    const level = deeper ? nextIndex : Math.max(0, chain.length - 1);
    const features = (deeper || regionsAt(level) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    entries = features.map((f, idx) => ({name: f.name, colors: regionStates(country, idx, features.length), choose: () => chooseRegion(level, f), selected: chain[level] === f}));
    label = features.length ? `${levelLabel(country, level)} (${features.length})` : country.levels.length ? (state.geoLoading ? 'Loading regions…' : 'Regions unavailable') : 'No subdivision boundaries';
    $('regionFilter').placeholder = `Find a ${levelLabel(country, level).toLowerCase()}…`;
  }
  $('regionLabel').textContent = label;
  $('regionFilter').hidden = !entries.length;
  for (const entry of entries) {
    if (filter && !entry.name.toLowerCase().includes(filter)) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (entry.selected ? ' sel' : '');
    chip.setAttribute('role', 'listitem');
    if (entry.selected) chip.setAttribute('aria-current', 'true');
    chip.style.setProperty('--glow', entry.colors.glow);
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.setProperty('--fill', entry.colors.fill);
    swatch.style.setProperty('--glow', entry.colors.glow);
    const text = document.createElement('span');
    text.textContent = entry.name;
    chip.append(swatch, text);
    chip.addEventListener('click', entry.choose);
    container.appendChild(chip);
  }
}

/* ---------- Facility list + record drawer (openRecord) ---------- */
function resetFacilityTools() {
  $('search').value = '';
  $('search').disabled = !state.country;
  const select = $('category');
  select.replaceChildren(new Option('All categories', ''));
  select.disabled = !state.country;
  $('statFacilities').textContent = '–';
}
async function loadCategoryOptions(country) {
  try {
    const categories = await listCategories(country.iso3);
    if (state.country !== country) return;
    for (const entry of categories) {
      const option = new Option(entry.category.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ` (${entry.total})`, entry.category);
      $('category').appendChild(option);
    }
  } catch { /* the list still works without category counts */ }
}
function currentRegionQuery() {
  const current = state.chain.at(-1);
  if (!current) return null;
  return {name: current.name, codes: current.codes, ancestors: state.chain.slice(0, -1).map(f => f.name)};
}
function renderFacilityPlaceholder() {
  const listNode = $('facilityList');
  listNode.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = 'Healthcare facilities appear here when you select a country or region. The map shows regions only — never facility pins.';
  listNode.appendChild(empty);
  $('listLabel').textContent = 'Select a country to see its healthcare facilities.';
  $('loadMore').hidden = true;
}
function textLine(parent, text, className = 'line') {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  parent.appendChild(div);
  return div;
}
const safeUrl = value => { try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };
function linkLine(parent, href, text) {
  const div = document.createElement('div');
  div.className = 'line';
  const a = document.createElement('a');
  a.href = href; a.textContent = text;
  if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  a.addEventListener('click', e => e.stopPropagation());
  div.appendChild(a);
  parent.appendChild(div);
}
function facilityCard(item) {
  const card = document.createElement('article');
  card.className = 'facility';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `${item.name} — open details`);
  const h = document.createElement('h3');
  h.textContent = item.name;
  card.appendChild(h);
  if (item.category) textLine(card, item.category.replace(/[-_]/g, ' '), 'badge');
  const address = [item.address, item.city, item.postal_code].filter(Boolean).join(', ');
  if (address) textLine(card, address);
  if (item.phone) linkLine(card, 'tel:' + String(item.phone).replace(/[^\d+]/g, ''), item.phone);
  if (item.email && /^[^\s@]+@[^\s@]+$/.test(item.email)) linkLine(card, 'mailto:' + item.email, item.email);
  const site = safeUrl(item.website);
  if (site) linkLine(card, site, 'Website ↗');
  if (item.source_name) textLine(card, 'Source: ' + item.source_name, 'src');
  card.addEventListener('click', () => openRecord(item));
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecord(item); } });
  return card;
}
function openRecord(item) {
  const body = $('drawerBody');
  body.replaceChildren();
  const h = document.createElement('h3');
  h.id = 'drawerTitle';
  h.textContent = item.name;
  body.appendChild(h);
  if (item.category) textLine(body, item.category.replace(/[-_]/g, ' '), 'badge');
  const field = (label, value, href) => {
    if (!value) return;
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const l = document.createElement('label');
    l.textContent = label;
    const v = document.createElement('div');
    if (href) {
      const a = document.createElement('a');
      a.href = href; a.textContent = value;
      if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      v.appendChild(a);
    } else v.textContent = value;
    wrap.append(l, v);
    body.appendChild(wrap);
  };
  const country = byIso.get(item.country_iso3);
  field('Region', [...(Array.isArray(item.admin_names) ? item.admin_names.slice().reverse() : []), country?.name || item.country_iso3].filter(Boolean).join(', '));
  field('Address', item.address);
  field('City', item.city);
  field('Postal code', item.postal_code);
  field('Telephone', item.phone, item.phone ? 'tel:' + String(item.phone).replace(/[^\d+]/g, '') : null);
  field('Email', item.email && /^[^\s@]+@[^\s@]+$/.test(item.email) ? item.email : null, 'mailto:' + item.email);
  const site = safeUrl(item.website);
  field('Website', site ? item.website : null, site);
  const sourceUrl = safeUrl(item.source_url);
  field('Source', item.source_name, sourceUrl);
  if (item.source_retrieved_at) field('Source retrieved', new Date(item.source_retrieved_at).toLocaleDateString());
  const drawer = $('drawer');
  drawer.style.setProperty('--drawerGlow', getComputedStyle(document.documentElement).getPropertyValue('--glow') || '#69dcff');
  drawer.hidden = false;
  $('drawerClose').focus();
}
function closeDrawer() { $('drawer').hidden = true; }

async function reloadFacilities({append = false} = {}) {
  const country = state.country;
  if (!country) return;
  if (list.abort) list.abort.abort();
  const abort = new AbortController();
  list.abort = abort;
  const token = ++list.token;
  const region = currentRegionQuery();
  const category = $('category').value, search = $('search').value;
  const page = append ? list.page + 1 : 1;
  const listNode = $('facilityList'), more = $('loadMore');
  if (!append) {
    list.items = []; list.total = null; list.page = 0;
    listNode.replaceChildren(...Array.from({length: 3}, () => Object.assign(document.createElement('div'), {className: 'skeleton'})));
    listNode.setAttribute('aria-busy', 'true');
    $('listLabel').textContent = 'Loading healthcare facilities…';
    more.hidden = true;
    const countNode = $('selectionCount');
    if (countNode) countNode.textContent = 'Counting published facilities…';
  }
  more.disabled = true;
  try {
    const data = await listFacilities({country: country.iso3, region, category, search, page, perPage: PAGE_SIZE}, {signal: abort.signal});
    if (token !== list.token) return;
    if (!append) listNode.replaceChildren();
    for (const item of data.facilities) listNode.appendChild(facilityCard(item));
    list.items.push(...data.facilities);
    list.page = page;
    list.total = data.total;
    const where = region ? region.name : country.name;
    if (!list.items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = search || category
        ? 'No published facilities match this search in ' + where + '.'
        : 'No healthcare facilities have been published for ' + where + ' yet. Records appear here as soon as they are added to the international directory.';
      listNode.appendChild(empty);
      $('listLabel').textContent = '0 facilities';
    } else {
      $('listLabel').textContent = list.total === null ? `Showing ${list.items.length} facilities` : `Showing ${list.items.length.toLocaleString()} of ${list.total.toLocaleString()} facilities`;
    }
    $('statFacilities').textContent = (list.total ?? list.items.length).toLocaleString();
    const countNode = $('selectionCount');
    if (countNode) countNode.textContent = countText();
    more.hidden = !data.has_more;
  } catch (error) {
    if (token !== list.token || error.name === 'AbortError') return;
    if (append) { $('listLabel').textContent = 'Could not load more facilities. Please try again.'; return; }
    listNode.replaceChildren();
    const box = document.createElement('div');
    box.className = 'empty';
    box.textContent = 'Healthcare records could not be loaded from the international directory. ';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => reloadFacilities());
    box.appendChild(retry);
    listNode.appendChild(box);
    $('listLabel').textContent = 'Directory unavailable';
    const countNode = $('selectionCount');
    if (countNode) countNode.textContent = 'Facility count unavailable';
  } finally {
    if (token === list.token) { more.disabled = false; listNode.removeAttribute('aria-busy'); }
  }
}

/* ---------- Wiring ---------- */
let searchTimer = 0;
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => reloadFacilities(), 300); });
$('category').addEventListener('change', () => reloadFacilities());
$('loadMore').addEventListener('click', () => reloadFacilities({append: true}));
$('backBtn').addEventListener('click', goUp);
$('regionFilter').addEventListener('input', renderRegionList);
$('drawerClose').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('drawer').hidden) { closeDrawer(); return; }
  if (!e.target.closest?.('input,select')) goUp();
});
window.addEventListener('popstate', () => navigateTo(hashParts(), {push: false}));
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { measure(); flyTo(focusTarget.target, false, focusTarget.rotate); }, 120);
});

$('statCountries').textContent = directoryCountries.length;
$('statSubdivided').textContent = directoryCountries.filter(c => c.levels.length).length;

async function start() {
  measure();
  renderRegionList();
  renderFacilityPlaceholder();
  updatePanel();
  try {
    const atlas = await d3.json('/assets/vendor/world-atlas-countries-50m.json');
    worldFeatures = topojson.feature(atlas, atlas.objects.countries).features;
    worldFeatures.forEach((feature, index) => { feature.atlasIndex = index; });
    $('loading').hidden = true;
    const p = fitParams({type: 'Sphere'}, [0, 0]);
    projection.rotate(p.r).scale(p.k).translate(p.t).precision(0.2);
    redraw();
    document.body.dataset.ready = 'true';
    const parts = hashParts();
    if (parts.length) await navigateTo(parts, {push: false, animate: false});
  } catch (error) {
    console.error(error);
    $('loading').textContent = 'The world map could not be loaded. Please refresh the page to try again.';
  }
}
start();
})();
