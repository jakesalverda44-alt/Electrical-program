// Parses a single combined address string (e.g. as delivered on a Kohler lead,
// "636 North Golf Course Dr., CRYSTAL RIVER, Florida 34429, United States") into the
// structured street / city / state / zip the proposal builder uses, so the format is
// uniform from lead → proposal → awarded project. Falls back gracefully when a string
// can't be confidently split. Keep in sync with frontend/src/lib/address.ts.

const STATE_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const ABBRS = new Set(Object.values(STATE_TO_ABBR));

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeState(text: string): string {
  const t = text.trim();
  if (!t) return '';
  if (/^[A-Za-z]{2}$/.test(t) && ABBRS.has(t.toUpperCase())) return t.toUpperCase();
  // Unrecognized → not a state (so the segment can be handled as part of the address).
  return STATE_TO_ABBR[t.toLowerCase()] || '';
}

export interface ParsedAddress { street: string; city: string; state: string; zip: string; }

export function parseAddress(full: string | null | undefined): ParsedAddress {
  const empty: ParsedAddress = { street: '', city: '', state: '', zip: '' };
  let s = (full || '').trim();
  if (!s) return empty;

  // Drop a trailing country ("United States", "USA", etc.).
  s = s.replace(/,?\s*(United States(?: of America)?|U\.?S\.?A?\.?)\s*$/i, '').trim();
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return empty;

  // Pull "STATE ZIP" out of the last comma segment.
  const last = parts[parts.length - 1];
  const zipMatch = last.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : '';
  const state = normalizeState(last.replace(/\b\d{5}(?:-\d{4})?\b/, '').trim());

  let city = '';
  let street = '';
  if (parts.length >= 3) {
    city = parts[parts.length - 2];
    street = parts.slice(0, parts.length - 2).join(', ');
  } else if (parts.length === 2) {
    // "Street, STATE ZIP" vs "City, STATE ZIP" — a leading number signals a street.
    if (/^\d/.test(parts[0])) street = parts[0];
    else city = parts[0];
  } else if (!state && !zip) {
    // Single segment with no state/zip — couldn't split; keep it as the street.
    street = parts[0];
  }

  return { street: street.trim(), city: city ? titleCase(city) : '', state, zip };
}

// Builds the gen-proposal form_data address fields + the pipeline "loc" string from a
// lead's combined address, so every downstream view shows the same uniform format.
export function leadAddressToProposal(fullAddress: string | null | undefined): {
  address: string; city: string; state: string; zip: string; loc: string;
} {
  const p = parseAddress(fullAddress);
  const couldParse = !!(p.city || p.state || p.zip);
  return {
    address: couldParse ? p.street : (fullAddress?.trim() || ''),
    city: p.city,
    state: p.state,
    zip: p.zip,
    loc: [p.city, p.state].filter(Boolean).join(', ') || (fullAddress?.trim() || '—'),
  };
}
