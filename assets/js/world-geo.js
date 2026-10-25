/* Progressive geoBoundaries loading for the International Directory.
 * Files are fetched only after a country is selected, verified against the pinned byte count and
 * SHA-256 before use, parsed once per session and cached. The SOURCE BYTES ARE NEVER MODIFIED:
 * the only in-memory preparation is ring orientation for d3's spherical renderer (no vertices are
 * added, removed, moved, or simplified). */
import {GEOBOUNDARIES_COMMIT} from './world-catalog.js';
import {BUNDLED_GEO, BUNDLED_GEO_ROOT, REMOTE_GEO_ROOT} from './world-config.js';

const cache = new Map();

export function geoUrl(iso3, source) {
  const bundled = BUNDLED_GEO.some(([country, level]) => country === iso3 && level === source.level);
  const base = bundled ? BUNDLED_GEO_ROOT : REMOTE_GEO_ROOT(GEOBOUNDARIES_COMMIT);
  return `${base}/${iso3}/${source.level}/${source.file}`;
}

export async function sha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot verify boundary files (Web Crypto unavailable).');
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function fetchBytes(url, expectedBytes, onProgress, fetchImpl) {
  const response = await fetchImpl(url, {cache: 'force-cache'});
  if (!response.ok) throw new Error(`Boundary file request failed (${response.status}).`);
  if (!response.body?.getReader) return response.arrayBuffer();
  const reader = response.body.getReader();
  const out = new Uint8Array(expectedBytes);
  let received = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    if (received + value.length > expectedBytes) throw new Error('Boundary file is larger than the pinned source.');
    out.set(value, received);
    received += value.length;
    onProgress?.(received / expectedBytes);
  }
  return out.buffer.slice(0, received);
}

/* Reverse ring order only where a polygon is wound opposite to d3's spherical convention
 * (RFC 7946 sources are counter-clockwise; d3 expects clockwise exteriors). */
export function orientForD3(geometry, d3) {
  const fix = polygon => d3.geoArea({type: 'Polygon', coordinates: polygon}) > 2 * Math.PI
    ? polygon.map(ring => ring.slice().reverse()) : polygon;
  if (geometry?.type === 'Polygon') return {type: 'Polygon', coordinates: fix(geometry.coordinates)};
  if (geometry?.type === 'MultiPolygon') return {type: 'MultiPolygon', coordinates: geometry.coordinates.map(fix)};
  return geometry;
}

function bbox(geometry) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  for (const polygon of polygons) for (const [x, y] of polygon[0] || []) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/* Stable region identity used for facility matching: ISO 3166-2 when the source supplies it,
 * otherwise the geoBoundaries shapeID. */
export function regionCodes(properties = {}) {
  return [properties.shapeISO, properties.shapeID].filter(code => typeof code === 'string' && code.trim()).map(code => code.trim());
}

export function prepareFeatures(collection, level, d3) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Boundary file is not a GeoJSON FeatureCollection.');
  return collection.features.filter(f => f?.geometry).map((feature, index) => {
    const properties = feature.properties || {};
    const geometry = orientForD3(feature.geometry, d3);
    return {
      type: 'Feature',
      geometry,
      properties,
      level,
      key: `${level}:${properties.shapeID || properties.shapeISO || index}`,
      name: String(properties.shapeName || `Region ${index + 1}`),
      codes: regionCodes(properties),
      bbox: bbox(feature.geometry)
    };
  });
}

export function loadLevel(iso3, source, d3, {onProgress, fetchImpl = fetch} = {}) {
  const key = source.sha256;
  if (!cache.has(key)) {
    const pending = (async () => {
      const buffer = await fetchBytes(geoUrl(iso3, source), source.bytes, onProgress, fetchImpl);
      if (buffer.byteLength !== source.bytes) throw new Error(`Boundary file size ${buffer.byteLength} does not match the pinned ${source.bytes} bytes.`);
      const digest = await sha256Hex(buffer);
      if (digest !== source.sha256) throw new Error('Boundary file checksum does not match the pinned geoBoundaries source.');
      return prepareFeatures(JSON.parse(new TextDecoder().decode(buffer)), source.level, d3);
    })();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key)); // allow retry after a failure
  }
  return cache.get(key);
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inGeometry(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(polygon => inRing(point, polygon[0]) && !polygon.slice(1).some(hole => inRing(point, hole)));
}
const inBox = ([x, y], b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/* geoBoundaries levels do not carry parent ids, so each child is placed in the parent containing
 * its interior sample points (centroid first, then evenly spaced vertices), falling back to the
 * largest bounding-box overlap. Computed once per level pair and cached. */
const parentCache = new WeakMap();
export function assignParents(children, parents, d3) {
  if (parentCache.get(children)?.parents === parents) return parentCache.get(children).map;
  const map = new Map();
  for (const child of children) {
    const ring = (child.geometry.type === 'Polygon' ? child.geometry.coordinates : child.geometry.coordinates.slice().sort((a, b) => b[0].length - a[0].length)[0])[0] || [];
    const samples = [d3.geoCentroid(child)];
    for (let i = 0; i < 9 && ring.length; i++) samples.push(ring[Math.floor(i * ring.length / 9)]);
    let found = null;
    for (const point of samples) {
      found = parents.find(parent => inBox(point, parent.bbox) && inGeometry(point, parent.geometry));
      if (found) break;
    }
    if (!found) found = parents.reduce((best, parent) => overlap(child.bbox, parent.bbox) > overlap(child.bbox, best?.bbox || [0, 0, 0, 0]) ? parent : best, null);
    if (found) map.set(child.key, found.key);
  }
  parentCache.set(children, {parents, map});
  return map;
}
