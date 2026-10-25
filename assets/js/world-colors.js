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

/* Shade `index` of `total` regions: an interleaved ramp from the country colour towards the middle
 * swatch of its own palette family, so regions keep the country's lighting identity while
 * neighbouring list entries get clearly different shades. */
export function regionStates(country, index, total) {
  const base = countryStates(country);
  const n = Math.max(1, total);
  const order = (index * 5 + Math.floor(index / 2)) % n; // deterministic interleave
  const t = n === 1 ? 0.5 : order / (n - 1);
  const fill = mix(base.fill, base.accent || base.glow, 0.08 + t * 0.62);
  return {
    fill,
    hover: mix(fill, base.glow, 0.45),
    selected: mix(base.glow, '#FFFFFF', 0.35),
    outline: base.outline,
    glow: base.glow
  };
}
