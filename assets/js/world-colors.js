/* Country lighting identity. Country colours come from the explicit table in world-catalog.js;
 * subdivision shades are derived deterministically from their country's colour so a selected
 * country's regions keep its lighting identity while remaining individually distinguishable. */
export const US_GREY = {fill: '#4A5363', hover: '#647086', selected: '#647086', outline: '#AEB7C6', glow: '#94A3B8', accent: '#94A3B8'};

const hex = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
const toHex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
export const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
export function luminance(value) {
  const [r, g, b] = hex(value).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function countryStates(country) {
  return country?.states || US_GREY;
}

function oklab(value) {
  const [r, g, b] = hex(value).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export const colorDistance = (a, b) => Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]));

/* The far end of a country's subdivision ramp: its family accent when that is clearly different
 * from the country colour; otherwise a darker (light colours) or lighter (dark colours) version of
 * the country's own colour, so subdivisions are always distinguishable. */
export function regionRampEnd(base) {
  const accent = base.accent || base.glow;
  if (colorDistance(base.fill, accent) >= 0.2) return accent;
  return luminance(base.fill) > 0.3 ? mix(base.fill, '#0B1730', 0.6) : mix(base.fill, '#FFFFFF', 0.6);
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/* A stride coprime with n (near the golden-ratio fraction) visits every ramp step exactly once
 * while placing alphabetically adjacent regions far apart on the ramp. */
function interleaveStep(n) {
  let step = Math.max(1, Math.round(n * 0.382));
  while (gcd(step, n) !== 1) step++;
  return step;
}

/* Shade `index` of `total` regions: an interleaved ramp from the country colour towards
 * regionRampEnd(), so regions keep the country's lighting identity while neighbouring list entries
 * (usually neighbouring regions) get clearly different shades. */
export function regionStates(country, index, total) {
  const base = countryStates(country);
  const n = Math.max(1, total);
  const order = (index * interleaveStep(n)) % n; // deterministic permutation: every region its own step
  const t = n === 1 ? 0.5 : order / (n - 1);
  const fill = mix(base.fill, regionRampEnd(base), 0.08 + t * 0.62);
  return {
    fill,
    hover: mix(fill, base.glow, 0.45),
    selected: mix(base.glow, '#FFFFFF', 0.35),
    outline: base.outline,
    glow: base.glow
  };
}
