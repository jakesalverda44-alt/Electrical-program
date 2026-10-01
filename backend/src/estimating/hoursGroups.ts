// Accuracy round F3 — ONE classifier for where labor hours go, used for BOTH
// the CRM's priced lines and Chris's Accubid BOM rows (parseAccubidBom), so
// the replay eval compares like with like. Chris's reference hours are
// always computed from accubid/*-bom.txt through this file, never typed.
//
// Pure. Two outputs per line:
//   * a BOM group (what the hours are FOR: wire, conduit, boxes, …);
//   * a CRM bucket (the estimate's category, rolled up so the CRM's own
//     category names and a BOM row land in the same bucket).

export const HOURS_GROUPS = [
  'wire & MC', 'branch conduit', 'fittings', 'boxes & rings', 'hardware', 'splices', 'fixtures', 'devices',
  'equipment connections', 'service gear', 'feeders', 'site / underground', 'controls', 'demolition', 'misc',
] as const;
export type HoursGroup = typeof HOURS_GROUPS[number];

export const CRM_BUCKETS = [
  'Branch Wiring', 'Interior Lighting', 'Exterior / Site Lighting', 'Branch Power', 'Service & Distribution',
  'Feeders', 'Site / Underground', 'Lighting Controls', 'Low Voltage', 'Demolition', 'Other',
] as const;
export type CrmBucket = typeof CRM_BUCKETS[number];

/** Nominal trade size in inches of the FIRST raceway size in the text
 *  (3/4" → 0.75, 1-1/4" → 1.25, 2" → 2), or null. */
export function racewaySizeIn(text: string): number | null {
  const m = /(?:^|[\s(])(\d+)-(\d)\/(\d)"|(?:^|[\s(])(\d)\/(\d)"|(?:^|[\s(])(\d+(?:\.\d+)?)"/.exec(text);
  if (!m) return null;
  if (m[1]) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  if (m[4]) return Number(m[4]) / Number(m[5]);
  return Number(m[6]);
}

/** AWG of the first "#N" / "#N/0" / "N AWG" in the text as a sortable
 *  number (bigger = heavier: #12 → -12, #6 → -6, #1/0 → 1, #3/0 → 3), or null. */
export function wireGaugeRank(text: string): number | null {
  const m = /#\s?(\d+)\/0\b|#\s?(\d+)\b(?!\s*x)|\b(\d+)\s*awg\b/i.exec(text);
  if (!m) return null;
  if (m[1]) return Number(m[1]);
  return -Number(m[2] ?? m[3]);
}

const FEEDER_RACEWAY_IN = 1.25;
const FEEDER_WIRE_RANK = -8;

/** The BOM group of one line's text. `hint` = the CRM bucket when the line
 *  is a CRM line (its category decides what the text alone cannot). */
export function groupOfText(text: string, hint?: CrmBucket | null): HoursGroup {
  // 3/4" EMT (incl. couplings/straps) is conduit: an included-parts note never decides the group.
  const t = text.replace(/\(incl\.[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim();
  if (/demolition|\bdemo\b|to be removed/i.test(t) || hint === 'Demolition') return 'demolition';
  // Gap-closing T0 — size first: the Feeders category decides only when the text names no raceway size and no
  // wire gauge. A sized line is grouped by the >= 1-1/4" / >= #8 rule below, exactly as Chris's BOM rows are
  // (they have no category): the HVAC circuits' 3/4" EMT / #10 G on a Feeders-category line are branch work,
  // as in Chris's "1\" EMT & Wire". Eval-only (the CRM bucket stays Feeders).
  if (hint === 'Feeders') {
    // Polaris taps / lugs are service gear on both sides (Chris's BOM rows have no category).
    if (/polaris|\blugs?\b/i.test(t)) return 'service gear';
    const sz = racewaySizeIn(t), rk = wireGaugeRank(t);
    if (sz == null && rk == null) return 'feeders';
    // Only the raceway / wire half of the line decides (its from → to names, "PANEL A", are not service gear).
    if (/conduit|\bemt\b|\bpvc\b|lfmc|\bflex\b|\brmc\b/i.test(t) && sz != null) return sz >= FEEDER_RACEWAY_IN ? 'feeders' : /\bpvc\b/i.test(t) ? 'site / underground' : 'branch conduit';
    if (/thhn|thwn|conductor|\bwire\b|cable|ground/i.test(t) && rk != null) return rk >= FEEDER_WIRE_RANK ? 'feeders' : 'wire & MC';
    return 'feeders';
  }
  if (hint === 'Site / Underground') {
    // Fix round nit — a feeder-size service lateral (2" PVC, #3/0) in the site category is feeder work, as in Chris's
    // BOM (the size rule below); only its group moves — the CRM bucket stays Site / Underground.
    const sz = racewaySizeIn(t), rk = wireGaugeRank(t);
    return /conduit|\bemt\b|\bpvc\b|thhn|conductor|cable|\bwire\b/i.test(t) && ((sz != null && sz >= FEEDER_RACEWAY_IN) || (rk != null && rk >= FEEDER_WIRE_RANK)) ? 'feeders' : 'site / underground';
  }
  if (hint === 'Lighting Controls') return /switch|dimmer|wallplate/i.test(t) && !/time ?switch|contactor|relay|photocell/i.test(t) ? 'devices' : 'controls';
  if (hint === 'Service & Distribution') return 'service gear';
  if (hint === 'Interior Lighting' || hint === 'Exterior / Site Lighting') return /contactor|time ?switch|photocell|occupancy|motion sensor/i.test(t) ? 'controls' : 'fixtures';
  const size = racewaySizeIn(t);
  const rank = wireGaugeRank(t);
  const pvc = /\bpvc\b/i.test(t);
  // Splices / connectors on wire (before the wire rule: "#12 to #6 Wire Connector").
  if (/wire connector|wire nut|splice|polytwine/i.test(t)) return 'splices';
  if (/polaris|\btaps?\b|wire lug|\blugs?\b|meter socket|meter base|panelboard|\bpanels?\b|service gutter|wireway|gutter|grounding|ground rod|ufer|plywood|playwood|\bfuses?\b|transformer|switchboard|\bmdp\b/i.test(t) && !/ground screw/i.test(t)) return 'service gear';
  if (/safety switch|disconnect/i.test(t)) {
    const amps = Number(/(\d+)\s*a\b/i.exec(t)?.[1] ?? NaN);
    return Number.isFinite(amps) && amps >= 200 ? 'service gear' : 'equipment connections';
  }
  if (/termination|power poles?|hang fans?|ceiling fan|exhaust fan|equipment connection|motor|\brtu\b|condens|air handler|water heater/i.test(t)) return 'equipment connections';
  if (/contactor|time ?switch|\bcmp\b|communication & control|occupancy|motion sensor|photocell|lighting control/i.test(t)) return 'controls';
  if (/receptacle|toggle switch|wallplate|\bswitch\b|\bgfci?\b|duplex|simplex|dimmer/i.test(t)) return 'devices';
  if (/luminaire|fixture|exit (?:light|sign)|emergency|\bpole\b|anchor bolt|troffer|downlight|wall ?pack|strip light|high bay|\bled\b/i.test(t)) return 'fixtures';
  if (/ground screw|square box|\bbox\b|plaster ring|mud ring|box cover|mounting bracket|handy box/i.test(t) && !/clip|strap|hanger|male adapter/i.test(t)) return 'boxes & rings';
  // Raceway fittings, then supports, then the raceway itself: feeder-size
  // (>= 1-1/4") power raceway is feeder work; small PVC is site work.
  const bySize = (small: HoursGroup): HoursGroup => (size != null && size >= FEEDER_RACEWAY_IN ? 'feeders' : pvc ? 'site / underground' : small);
  if (/coupling|connector|bushing|locknut|male adapter|elbow|fittings/i.test(t)) return bySize('fittings');
  if (/strap|clamp|clip|anchor|bolt|screw|cable tie|chain|\bnut\b|s-hook|hanger|washer|ceiling wire|support|hardware/i.test(t)) {
    return /strut clamp|1-hole strap|2-hole strap/i.test(t) && size != null && size >= FEEDER_RACEWAY_IN ? 'feeders' : 'hardware';
  }
  if (/conduit|\bemt\b|\bpvc\b|lfmc|\bflex\b/i.test(t)) return bySize('branch conduit');
  if (/\bmc\b|mc cable|\bwire\b|thhn|conductor|cable/i.test(t)) return rank != null && rank >= FEEDER_WIRE_RANK ? 'feeders' : 'wire & MC';
  return 'misc';
}

/** Is the text an exterior / site fixture? `extraExterior` = job-specific
 *  patterns the caller documents (e.g. a soffit downlight type). */
export function isExteriorFixtureText(text: string, extraExterior: RegExp[] = []): boolean {
  return /wall mount|wall ?pack|\bpole\b|pole top|anchor bolt|site light|exterior|soffit|canopy|flood/i.test(text) || extraExterior.some(r => r.test(text));
}

/** A CRM category name → its bucket. */
export function crmBucketOfCategory(category: string): CrmBucket {
  const c = category.toLowerCase();
  if (/branch wiring|boxes, fittings|box.*fitting/.test(c)) return 'Branch Wiring';
  if (/feeder/.test(c)) return 'Feeders';
  if (/site \/ underground|underground/.test(c)) return 'Site / Underground';
  if (/exterior|site lighting/.test(c)) return 'Exterior / Site Lighting';
  if (/interior lighting|lighting fixtures?/.test(c)) return 'Interior Lighting';
  if (/lighting control/.test(c)) return 'Lighting Controls';
  if (/service|distribution|grounding|gear/.test(c)) return 'Service & Distribution';
  if (/branch power|devices?|equipment/.test(c)) return 'Branch Power';
  if (/low voltage|data|telecom|fire alarm/.test(c)) return 'Low Voltage';
  if (/demo/.test(c)) return 'Demolition';
  return 'Other';
}

/** A BOM group → the CRM bucket its hours belong to (for a BOM row, which
 *  has no category of its own). Wiring groups and misc are the branch
 *  wiring allowance's scope, as the CRM carries them. */
export function crmBucketOfGroup(group: HoursGroup, text: string, extraExterior: RegExp[] = []): CrmBucket {
  switch (group) {
    case 'wire & MC': case 'branch conduit': case 'fittings': case 'boxes & rings': case 'hardware': case 'splices': case 'misc':
      return 'Branch Wiring';
    case 'fixtures': return isExteriorFixtureText(text, extraExterior) ? 'Exterior / Site Lighting' : 'Interior Lighting';
    case 'devices': return /switch|dimmer/i.test(text) && !/receptacle/i.test(text) ? 'Lighting Controls' : 'Branch Power';
    case 'equipment connections': return 'Branch Power';
    case 'service gear': return 'Service & Distribution';
    case 'feeders': return 'Feeders';
    case 'site / underground': return 'Site / Underground';
    case 'controls': return 'Lighting Controls';
    case 'demolition': return 'Demolition';
  }
}

export interface ClassifiedHours { group: HoursGroup; bucket: CrmBucket }

/** One CRM priced line: its category decides the bucket; the text (its
 *  description plus the matched library name) decides the group. */
export function classifyCrmLine(line: { category: string; description: string; matchedName?: string | null }): ClassifiedHours {
  const bucket = crmBucketOfCategory(line.category);
  const text = `${line.description} ${line.matchedName ?? ''}`;
  const hint: CrmBucket | null = bucket === 'Branch Wiring' || bucket === 'Branch Power' || bucket === 'Other' || bucket === 'Low Voltage' ? null : bucket;
  let group = groupOfText(text, hint);
  if (bucket === 'Branch Power' && !['devices', 'equipment connections', 'service gear', 'controls'].includes(group)) group = /disconnect|switch|termination|pole|fan|rtu|unit|motor|heater/i.test(text) ? 'equipment connections' : 'devices';
  if (bucket === 'Low Voltage' && group !== 'controls' && !(group === 'service gear' && /plywood|playwood/i.test(text))) group = 'misc';
  return { group, bucket };
}

/** One Chris BOM row. */
export function classifyBomRow(row: { description: string }, extraExterior: RegExp[] = []): ClassifiedHours {
  const group = groupOfText(row.description);
  return { group, bucket: crmBucketOfGroup(group, row.description, extraExterior) };
}

export interface HoursBreakdown { total: number; byGroup: Record<string, number>; byBucket: Record<string, number> }

export function sumHours<T>(rows: T[], hoursOf: (r: T) => number, classify: (r: T) => ClassifiedHours): HoursBreakdown {
  const out: HoursBreakdown = { total: 0, byGroup: {}, byBucket: {} };
  for (const r of rows) {
    const h = hoursOf(r);
    if (!h) continue;
    const c = classify(r);
    out.total += h;
    out.byGroup[c.group] = (out.byGroup[c.group] ?? 0) + h;
    out.byBucket[c.bucket] = (out.byBucket[c.bucket] ?? 0) + h;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  out.total = r2(out.total);
  for (const k of Object.keys(out.byGroup)) out.byGroup[k] = r2(out.byGroup[k]);
  for (const k of Object.keys(out.byBucket)) out.byBucket[k] = r2(out.byBucket[k]);
  return out;
}
