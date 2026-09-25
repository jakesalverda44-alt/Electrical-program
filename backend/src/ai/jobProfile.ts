// Bid Overview: Plans Upload + Job Profile (2026-09-24 plan) — categorize a
// bid from its plans. Text layer first, cheap: this module is a PURE parser
// over already-extracted page text (ai/pdfText.ts's extractPdfPageTexts, the
// same text sheetCheck.ts and ai/sheetRefs.ts already pull per page — no
// second PDF read). A vision fallback (Haiku/Sonnet on the cover/title-block
// crop) only runs when a page has no text layer at all; that call is a
// caller-supplied function (visionExtractJobProfile in the route), never
// invoked from here, so this module never makes a network call and is fully
// unit-testable against real plan text.
//
// Every field carries evidence — the sheet it came from and the exact quote
// — because the Overview panel and the card-update rules (see
// estimating/jobProfileCardRules.ts) both need to show "the plans say X
// (sheet Y)", not just X.

export type ProfileFieldKey =
  | 'project_type' | 'brand' | 'store_number' | 'prototype' | 'loc' | 'sq_ft'
  | 'plan_date' | 'owner_name' | 'architect' | 'engineer' | 'build_type' | 'name';

export type SystemKey = 'fuel' | 'site_lighting' | 'fire_alarm' | 'generator' | 'ev';

export interface FieldEvidence<T = string> {
  value: T;
  /** The sheet/page the value came from ("E-1", "Cover") — null when inferred
   *  rather than read (e.g. a build_type default with no explicit keyword). */
  sheet: string | null;
  /** The exact source text matched — never invented. Null for an inferred value. */
  quote: string | null;
  confidence: 'extracted' | 'inferred';
}

export interface JobProfile {
  fields: Partial<Record<ProfileFieldKey, FieldEvidence>>;
  systems: Record<SystemKey, FieldEvidence<boolean>>;
  /** True if any field came from a vision fallback rather than a text layer
   *  (cost-relevant — see estimateJobProfileCost). */
  usedVision: boolean;
}

export interface PageText {
  page: number;
  file: string;
  /** The sheet number, if the caller's classifier already knows it (e.g. from
   *  sheetCheck's inventory) — used only to prefer an electrical-sheet's own
   *  title-block match over a civil cover sheet's. Optional: every regex
   *  below still works from `text` alone when this is omitted. */
  sheetNo?: string | null;
  text: string;
}

/** Minimum characters of extracted text for a page to count as "has a text
 *  layer" — same threshold sheetCheck.ts uses (TEXT_LAYER_MIN_CHARS), kept
 *  independent here so this module has no import-time dependency on it. */
export const TEXT_LAYER_MIN_CHARS = 50;

const BRAND_RULES: { name: string; pattern: RegExp; projectType: string }[] = [
  { name: 'AutoZone',    pattern: /\bautozone\b/i,        projectType: 'retail' },
  { name: '7-Eleven',    pattern: /\b7-?\s?eleven\b/i,     projectType: 'cstore_fuel' },
  { name: "Big Dan's",   pattern: /\bbig\s*dan'?s\b/i,     projectType: 'car_wash' },
  { name: 'Bubble Down', pattern: /\bbubble\s*down\b/i,    projectType: 'car_wash' },
  { name: "Tommy's",     pattern: /\btommy'?s\b/i,         projectType: 'car_wash' },
  { name: 'Murrell',     pattern: /\bmurrell\b/i,          projectType: 'self_storage' },
];

// Fallback project-type keyword scan, used only when no known brand matched
// (a "free text" client — Decision 3 explicitly allows this).
const PROJECT_TYPE_KEYWORDS: { type: string; pattern: RegExp }[] = [
  { type: 'car_wash',     pattern: /\bcar\s*wash\b/i },
  { type: 'self_storage', pattern: /\bself[\s-]?storage\b/i },
  { type: 'cstore_fuel',  pattern: /\bconvenience\s*store\b|\bc-?store\b/i },
  { type: 'restaurant',   pattern: /\brestaurant\b/i },
  { type: 'medical',      pattern: /\bmedical\s*office\b|\bclinic\b/i },
  { type: 'warehouse',    pattern: /\bwarehouse\b/i },
  { type: 'office',       pattern: /\boffice\s*building\b/i },
];

function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

function firstMatch(pages: PageText[], pattern: RegExp): { page: PageText; match: RegExpMatchArray; line: string } | null {
  for (const p of pages) {
    for (const ln of lines(p.text)) {
      const m = ln.match(pattern);
      if (m) return { page: p, match: m, line: ln.trim() };
    }
  }
  return null;
}

function sheetLabel(p: PageText): string {
  return p.sheetNo || `p.${p.page}`;
}

/** A line-heading block: a line that (trimmed, case-insensitively) equals
 *  `heading`, with the next non-empty line taken as the value — the shape
 *  "OWNER" / "ARCHITECT" cover-sheet blocks use. `excludePrevLine` skips a
 *  heading whose preceding non-empty line matches (e.g. "ARCHITECT" preceded
 *  by "LANDSCAPE" is the landscape-architect block, not the main one). */
function headingBlock(
  pages: PageText[], heading: string, excludePrevLine?: RegExp,
): { page: PageText; value: string; quote: string } | null {
  const target = heading.toLowerCase();
  for (const p of pages) {
    const ls = lines(p.text);
    for (let i = 0; i < ls.length; i++) {
      if (ls[i].trim().toLowerCase() !== target) continue;
      if (excludePrevLine) {
        let j = i - 1;
        while (j >= 0 && !ls[j].trim()) j--;
        if (j >= 0 && excludePrevLine.test(ls[j].trim())) continue;
      }
      let k = i + 1;
      while (k < ls.length && !ls[k].trim()) k++;
      if (k < ls.length && ls[k].trim()) {
        return { page: p, value: ls[k].trim(), quote: ls[k].trim() };
      }
    }
  }
  return null;
}

function titleCaseAddress(s: string): string {
  const KEEP_UPPER = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'FL']);
  return s
    .split(/\s+/)
    .map(w => {
      const bare = w.replace(/[.,]+$/, '');
      const trail = w.slice(bare.length);
      if (KEEP_UPPER.has(bare.toUpperCase())) return bare.toUpperCase() + trail;
      if (/^\d/.test(bare)) return bare + trail;
      return bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase() + trail;
    })
    .join(' ');
}

function extractBrand(pages: PageText[]): FieldEvidence | null {
  for (const rule of BRAND_RULES) {
    const hit = firstMatch(pages, rule.pattern);
    if (hit) return { value: rule.name, sheet: sheetLabel(hit.page), quote: hit.line, confidence: 'extracted' };
  }
  return null;
}

function extractProjectType(pages: PageText[], brand: FieldEvidence | null): FieldEvidence | null {
  if (brand) {
    const rule = BRAND_RULES.find(r => r.name === brand.value);
    if (rule) return { value: rule.projectType, sheet: brand.sheet, quote: brand.quote, confidence: 'inferred' };
  }
  for (const kw of PROJECT_TYPE_KEYWORDS) {
    const hit = firstMatch(pages, kw.pattern);
    if (hit) return { value: kw.type, sheet: sheetLabel(hit.page), quote: hit.line, confidence: 'extracted' };
  }
  return null;
}

const STORE_NUMBER_RE = /\bSTORE\s*(?:NO\.?|#)?\s*[A-Z]{0,3}(\d{3,7})\b/i;

function extractStoreNumber(pages: PageText[]): FieldEvidence | null {
  const hit = firstMatch(pages, STORE_NUMBER_RE);
  if (!hit) return null;
  return { value: hit.match[1], sheet: sheetLabel(hit.page), quote: hit.line, confidence: 'extracted' };
}

// A prototype code — "7N2", "7N2-L" — is a whole line by itself in a title
// block. Digit-letter-digit(-suffix): never matches a sheet id (E-1, M-1.1)
// or an amperage/voltage token. The base (digit-letter-digit) and an optional
// suffix are captured separately: "7N2" and "7N2-L" are the SAME prototype
// (a civil/architectural sheet's title block often carries the bare base
// while the electrical/mechanical sheets carry the more specific "-L"
// variant) — grouping by base picks the right code by how often it recurs,
// then reports whichever variant of it is most specific.
const PROTOTYPE_RE = /^([0-9][A-Z][0-9])(-[A-Z0-9]+)?$/;

function extractPrototype(pages: PageText[]): FieldEvidence | null {
  interface Variant { full: string; page: PageText; line: string }
  const byBase = new Map<string, { count: number; longest: Variant }>();
  for (const p of pages) {
    for (const raw of lines(p.text)) {
      const ln = raw.trim();
      const m = ln.match(PROTOTYPE_RE);
      if (!m) continue;
      const base = m[1].toUpperCase();
      const full = (m[1] + (m[2] ?? '')).toUpperCase();
      const existing = byBase.get(base);
      if (existing) {
        existing.count++;
        if (full.length > existing.longest.full.length) existing.longest = { full, page: p, line: ln };
      } else {
        byBase.set(base, { count: 1, longest: { full, page: p, line: ln } });
      }
    }
  }
  if (!byBase.size) return null;
  const best = [...byBase.values()].sort((a, b) => b.count - a.count)[0];
  return { value: best.longest.full, sheet: sheetLabel(best.longest.page), quote: best.longest.line, confidence: 'extracted' };
}

const DATE_LINE_RE = /^(\d{1,2}\/\d{1,2}\/\d{2,4})$/;

function normalizeDate(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let [, mo, da, yr] = m;
  if (yr.length === 2) yr = (Number(yr) > 50 ? '19' : '20') + yr;
  return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
}

function extractPlanDate(pages: PageText[]): FieldEvidence | null {
  const counts = new Map<string, { count: number; page: PageText; line: string }>();
  // Prefer a date found on a page whose own sheet number is electrical
  // (starts with E) — the electrical set's own issue date, not a civil
  // cover sheet's separate one.
  let electricalHit: { page: PageText; line: string } | null = null;
  for (const p of pages) {
    for (const raw of lines(p.text)) {
      const ln = raw.trim();
      const m = ln.match(DATE_LINE_RE);
      if (!m) continue;
      if (!electricalHit && p.sheetNo && /^E[-.]?\d/i.test(p.sheetNo)) electricalHit = { page: p, line: ln };
      const existing = counts.get(ln);
      if (existing) existing.count++;
      else counts.set(ln, { count: 1, page: p, line: ln });
    }
  }
  const chosen = electricalHit
    ?? (counts.size ? [...counts.entries()].sort((a, b) => b[1].count - a[1].count)[0]?.[1] : null);
  if (!chosen) return null;
  const iso = normalizeDate(chosen.line);
  if (!iso) return null;
  return { value: iso, sheet: sheetLabel(chosen.page), quote: chosen.line, confidence: 'extracted' };
}

function extractOwner(pages: PageText[]): FieldEvidence | null {
  const inline = firstMatch(pages, /Owner\s*\/\s*Developer\s*:\s*(.+)/i);
  if (inline) {
    return { value: inline.match[1].trim(), sheet: sheetLabel(inline.page), quote: inline.line, confidence: 'extracted' };
  }
  const block = headingBlock(pages, 'OWNER');
  if (block) return { value: block.value, sheet: sheetLabel(block.page), quote: block.quote, confidence: 'extracted' };
  return null;
}

function extractArchitect(pages: PageText[]): FieldEvidence | null {
  const block = headingBlock(pages, 'ARCHITECT', /^LANDSCAPE$/i);
  if (!block) return null;
  return { value: block.value, sheet: sheetLabel(block.page), quote: block.quote, confidence: 'extracted' };
}

// No trailing \b: it would force backtracking off the optional final period
// (a word boundary can't sit between two non-word characters — the period
// just matched and end-of-string), silently dropping "P.E." to "P.E".
const ENGINEER_INLINE_RE = /ENGINEER:?\s*([A-Z][A-Za-z.'’ -]*?P\.?\s?E\.?)/;

function extractEngineer(pages: PageText[]): FieldEvidence | null {
  // Prefer an inline "ENGINEER: <name> P.E." line on an electrical sheet.
  const electricalPages = pages.filter(p => p.sheetNo && /^E[-.]?\d/i.test(p.sheetNo));
  const hit = firstMatch(electricalPages.length ? electricalPages : pages, ENGINEER_INLINE_RE);
  if (hit) return { value: hit.match[1].trim(), sheet: sheetLabel(hit.page), quote: hit.line, confidence: 'extracted' };
  const block = headingBlock(pages, 'ENGINEER');
  if (block) return { value: block.value, sheet: sheetLabel(block.page), quote: block.quote, confidence: 'extracted' };
  return null;
}

const STREET_SUFFIX = '(?:RD|ROAD|ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|DR|DRIVE|LN|LANE|HWY|HIGHWAY|CIR|CIRCLE|PKWY|PARKWAY|WAY|CT|COURT)';
const ADDRESS_RE = new RegExp(
  `(\\d+[\\w .'-]*?${STREET_SUFFIX}\\.?)\\s*,\\s*([A-Za-z .'-]+?)\\s*,\\s*(FLORIDA|FL|[A-Z]{2})\\.?\\s*(\\d{5})?`,
  'i',
);

interface AddressEvidence { loc: FieldEvidence; city: string; state: string }

function extractAddress(pages: PageText[]): AddressEvidence | null {
  const hit = firstMatch(pages, ADDRESS_RE);
  if (!hit) return null;
  const [, street, city, stateRaw, zip] = hit.match;
  const state = /florida/i.test(stateRaw) ? 'FL' : stateRaw.toUpperCase();
  const value = `${titleCaseAddress(street.replace(/[.,]+$/, ''))}, ${titleCaseAddress(city)}, ${state}${zip ? ' ' + zip : ''}`;
  return {
    loc: { value, sheet: sheetLabel(hit.page), quote: hit.line, confidence: 'extracted' },
    city: titleCaseAddress(city),
    state,
  };
}

const SQFT_RE = /BLDG\.?\s*AREA\s*=\s*([\d,]+)\s*(?:SQ\.?\s*FT\.?|S\.?F\.?)/i;
const SQFT_GROSS_NET_RE = /\b(GROSS|NET)\b[^.\n]{0,20}?([\d,]{3,7})\s*S\.?F\.?/i;

function extractSqFt(pages: PageText[]): FieldEvidence<number> | null {
  const gn = firstMatch(pages, SQFT_GROSS_NET_RE);
  if (gn) {
    const n = Number(gn.match[2].replace(/,/g, ''));
    return { value: n, sheet: sheetLabel(gn.page), quote: `${gn.line} (${gn.match[1].toLowerCase()})`, confidence: 'extracted' };
  }
  const hit = firstMatch(pages, SQFT_RE);
  if (!hit) return null;
  const n = Number(hit.match[1].replace(/,/g, ''));
  return { value: n, sheet: sheetLabel(hit.page), quote: hit.line, confidence: 'extracted' };
}

function extractBuildType(pages: PageText[]): FieldEvidence {
  const tenant = firstMatch(pages, /\bTENANT\s+FIT[\s-]?(?:UP|OUT)\b/i);
  if (tenant) return { value: 'tenant', sheet: sheetLabel(tenant.page), quote: tenant.line, confidence: 'extracted' };
  const remodel = firstMatch(pages, /\b(REMODEL|RENOVATION)\b/i);
  if (remodel) return { value: 'remodel', sheet: sheetLabel(remodel.page), quote: remodel.line, confidence: 'extracted' };
  return { value: 'new', sheet: null, quote: null, confidence: 'inferred' };
}

function systemFlag(pages: PageText[], pattern: RegExp): FieldEvidence<boolean> {
  const hit = firstMatch(pages, pattern);
  if (hit) return { value: true, sheet: sheetLabel(hit.page), quote: hit.line, confidence: 'extracted' };
  return { value: false, sheet: null, quote: null, confidence: 'inferred' };
}

function extractSystems(pages: PageText[]): Record<SystemKey, FieldEvidence<boolean>> {
  return {
    fuel: systemFlag(pages, /\b(FUEL\s+(?:ISLAND|DISPENSER|CANOPY)|DISPENSER\s+ISLAND|UNDERGROUND\s+STORAGE\s+TANK|\bUST\b)\b/i),
    site_lighting: systemFlag(pages, /\bPHOTOMETRIC\b|\bSITE\s+LIGHTING\b/i),
    fire_alarm: systemFlag(pages, /\bFIRE\s+ALARM\b/i),
    generator: systemFlag(pages, /\bGENERATOR\b/i),
    ev: systemFlag(pages, /\bEV\s+CHARG|\bELECTRIC\s+VEHICLE\s+CHARG/i),
  };
}

function suggestedName(
  brand: FieldEvidence | null, store: FieldEvidence | null, address: AddressEvidence | null, projectType: FieldEvidence | null,
): FieldEvidence | null {
  if (brand && store && address) {
    return {
      value: `${brand.value} #${store.value} – ${address.city}, ${address.state}`,
      sheet: store.sheet, quote: null, confidence: 'inferred',
    };
  }
  if (projectType && address) {
    return {
      value: `${projectType.value} – ${address.city}, ${address.state}`,
      sheet: address.loc.sheet, quote: null, confidence: 'inferred',
    };
  }
  return null;
}

/** The main entry point — pure, synchronous, no I/O. Every field is optional:
 *  a plan set missing a title block, or one this parser's regexes don't
 *  cover, simply leaves that field absent rather than guessing. */
export function extractJobProfile(pages: PageText[]): JobProfile {
  const brand = extractBrand(pages);
  const projectType = extractProjectType(pages, brand);
  const store = extractStoreNumber(pages);
  const prototype = extractPrototype(pages);
  const planDate = extractPlanDate(pages);
  const owner = extractOwner(pages);
  const architect = extractArchitect(pages);
  const engineer = extractEngineer(pages);
  const address = extractAddress(pages);
  const sqFt = extractSqFt(pages);
  const buildType = extractBuildType(pages);
  const name = suggestedName(brand, store, address, projectType);

  const fields: Partial<Record<ProfileFieldKey, FieldEvidence>> = {};
  if (projectType) fields.project_type = projectType;
  if (brand) fields.brand = brand;
  if (store) fields.store_number = store;
  if (prototype) fields.prototype = prototype;
  if (address) fields.loc = address.loc;
  if (sqFt) fields.sq_ft = sqFt as unknown as FieldEvidence;
  if (planDate) fields.plan_date = planDate;
  if (owner) fields.owner_name = owner;
  if (architect) fields.architect = architect;
  if (engineer) fields.engineer = engineer;
  fields.build_type = buildType;
  if (name) fields.name = name;

  return { fields, systems: extractSystems(pages), usedVision: false };
}

/** Rough per-bid cost of the job-profile step, in cents. Text-first: when
 *  every page used for the profile has a usable text layer, the only cost is
 *  the regex pass above (effectively $0 — no AI call at all). A vision
 *  fallback crop (cover/title-block only, never a full sheet) is a single
 *  small image at standard tier (~1568px, well under a full 36x24 sheet's
 *  tile count) — call it one Haiku call at roughly 1.5k image tokens plus a
 *  few hundred output tokens: at Haiku 4.5 list pricing ($1/M in, $5/M out)
 *  that's under a tenth of a cent per crop; rounded up here to a
 *  conservative 2 cents/crop so the estimate never undercounts. */
export function estimateJobProfileCost(visionCropsUsed: number): number {
  if (visionCropsUsed <= 0) return 0;
  return visionCropsUsed * 2;
}
