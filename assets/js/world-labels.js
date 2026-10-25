/* Level names come from geoBoundaries metadata and are sometimes plural ("Prefectures",
 * "Counties and Unitary Authorities"). The UI needs singular forms ("Select a prefecture") and
 * simple counted plurals ("47 prefectures"). Only plain-ASCII (English) words are changed; names
 * in other languages ("Bundesländer", "Regiões") are shown as published. */
const EXCEPTIONS = new Set(['okres', 'status', 'sous']);

function singularWord(word) {
  const lower = word.toLowerCase();
  if (!/^[a-z]+$/.test(lower) || word.length <= 3 || EXCEPTIONS.has(lower) || /(ss|us|is)$/.test(lower)) return word;
  if (lower.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (/(ch|sh|x)es$/.test(lower)) return word.slice(0, -2);
  return lower.endsWith('s') ? word.slice(0, -1) : word;
}

export const singularLabel = label => String(label).replace(/\p{L}+/gu, singularWord);

function pluralWord(word) {
  const lower = word.toLowerCase();
  if (!/^[a-z]+$/.test(lower) || EXCEPTIONS.has(lower)) return word;
  if (/[^aeiou]y$/.test(lower)) return word.slice(0, -1) + 'ies';
  if (/(s|x|ch|sh)$/.test(lower)) return word + 'es';
  return word + 's';
}

/* "1 state", "32 states", "13 province/territories", "216 county / unitary authorities". */
export const plural = (n, phrase) => `${n.toLocaleString()} ${n === 1 ? phrase : phrase.replace(/\p{L}+$/u, pluralWord)}`;
