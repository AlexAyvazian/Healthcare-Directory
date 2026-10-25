/* The standardized facility record returned by every registry adapter. No coordinates are
 * exposed: the directory lists facilities in its sidebar and never draws pins. */
const clean = value => {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 300) : null;
};
/* Registries often publish ALL CAPS; convert those to readable title case. */
const ACRONYMS = new Set(['NHS', 'GP', 'GPS', 'UK', 'USA', 'US', 'LLC', 'LLP', 'PLLC', 'PC', 'PA', 'LTD', 'CIC', 'ICB', 'PCN', 'CCG', 'HMO', 'PPO', 'ENT', 'ICU', 'CT', 'MRI', 'II', 'III', 'IV', 'NPI', 'CHU', 'CHR', 'CH', 'EHPAD', 'SAS', 'SARL', 'SA', 'SCM', 'SELARL']);
export const readable = value => {
  const text = clean(value);
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  // Capitalise each word, keep known acronyms, and lower-case possessive 's ("Guy's", not "Guy'S").
  return text.replace(/[A-ZÀ-Þ]+/g, word => ACRONYMS.has(word) ? word : word.charAt(0) + word.slice(1).toLowerCase())
    .replace(/(['’])S\b/g, '$1s');
};
export function website(value) {
  const text = clean(value);
  if (!text) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null;
    url.hostname = url.hostname.toLowerCase();
    return url.href;
  } catch { return null; }
}
const email = value => {
  const text = clean(value);
  return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text.toLowerCase() : null;
};

export function facility({
  source, id, name, specialties = [], status = null,
  line1 = null, line2 = null, city = null, region = null, postalCode = null, countryCode,
  phone = null, emailAddress = null, url = null, identifiers = [], updatedAt = null, sourceUrl = null
}) {
  const list = [...new Set(specialties.map(readable).filter(Boolean))];
  return {
    id: `${source}:${id}`,
    source,
    source_record_id: String(id),
    name: readable(name) || 'Unnamed facility',
    category: list[0] || null,
    specialties: list,
    status: clean(status),
    address: {
      line1: readable(line1),
      line2: readable(line2),
      city: readable(city),
      region: clean(region),
      postal_code: clean(postalCode)?.toUpperCase() || null,
      country_code: countryCode
    },
    phone: clean(phone),
    email: email(emailAddress),
    website: website(url),
    identifiers: identifiers.filter(i => i?.value).map(i => ({system: clean(i.system), value: clean(i.value)})),
    updated_at: clean(updatedAt),
    source_url: website(sourceUrl)
  };
}
