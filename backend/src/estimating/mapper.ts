// Estimating labor engine — Task 4: takeoff line → assembly/item mapper.
//
// Pure and deterministic: no AI, no DB, no I/O. Given a normalized takeoff
// line and the library (items + assemblies, each with aliases), returns the
// best match and how confident that match is. A "suggest with AI" button for
// lines that come back `none` is a follow-up, not this task.
//
// Accepts two real input shapes so the caller doesn't have to pre-normalize:
//   - the bidstd TakeoffItem/TakeoffCategory shape (backend/src/bidstd/bidData.ts):
//     `item` is Agent 4's short takeoff item id ("5.1"), `description` is the text.
//   - the legacy Agent 2/4 line shape used by the frontend's
//     buildLineItemsFromTakeoff (PcWorkspace/parsing.ts) — { category, item,
//     qty, unit, spec?, confidence?, notes? }. Corrected understanding (Part 1
//     follow-up): `item` here is ALSO the short takeoff item id, matching Agent
//     4's convention (Agent 4 QCs and restructures Agent 2's output, preserving
//     its numbering) — `spec` carries the descriptive text. An earlier version
//     of this file treated `item` as the description, which meant est_bid_lines
//     never recorded the short id and composeBidData's per-line confidence
//     lookup (keyed on that id) couldn't match a new-engine-saved bid. See
//     NormalizedTakeoffLine.takeoffItemId / MappedLine.takeoffItemId below.

import { canonicalizeTakeoffCategory } from '../bidstd/boilerplate';

export type MapConfidence = 'exact' | 'alias' | 'fuzzy' | 'none';
export type SourceConfidence = 'FIRM' | 'APPROX' | 'VERIFY';

export interface NormalizedTakeoffLine {
  category: string;
  /** The text matched against the library — a takeoff item's `description`
   *  (falling back to `item`/`spec` when blank, shape-dependent). */
  description: string;
  /** Agent 4's short takeoff item id (e.g. "5.1"), when the source shape has
   *  one — carried through untouched so callers can key on it (composeBidData's
   *  SavedConfidenceItem, est_bid_lines.takeoff_item_id) without re-deriving it. */
  takeoffItemId?: string | null;
  /** Raw qty as the takeoff carries it. A string (e.g. "VERIFY", "TBD") is never
   *  coerced to a number — see MappedLine.qty / isVerifyQty. */
  qty: number | string;
  unit: string;
  /** The takeoff's OWN stated confidence about the quantity (FIRM/APPROX/VERIFY),
   *  distinct from MappedLine.matchConfidence (how sure the mapper is about WHICH
   *  library row this is). */
  sourceConfidence?: SourceConfidence | null;
  /** A secondary raw text field — the OTHER of a takeoff row's item/spec fields,
   *  whichever one wasn't chosen as `description` (B3 fix). Real Agent 2/4 rows
   *  split the descriptive noun unpredictably across the two fields — e.g. item
   *  "Duplex receptacle" / spec "20A,125V,NEMA 5-20R,spec grade" carries the
   *  device name in `item`, while item "5.1" / spec "3/4\" EMT" carries it in
   *  `spec`. Using only the "primary" field lost the noun in the first case and
   *  mapped a receptacle to a switch. altText widens alias/fuzzy recall (its
   *  tokens are merged into the match text) without weakening the primary
   *  description's own exact-match precision — exact match still requires the
   *  primary text (or altText) to equal a candidate name/alias outright. */
  altText?: string | null;
}

export interface LibraryCandidate {
  kind: 'assembly' | 'item';
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  aliases: string[];
  /** Review round 2 / B3 — est_items.source / est_assemblies.source
   *  ('seed'|'accubid'|'manual'|'calibrated'). Used only as a tie-break
   *  (below): a curated seed/manual/calibrated row outranks a raw,
   *  unreconciled Accubid-imported row when both score identically —
   *  an accubid-imported "3/4" Coupling - EMT Set Screw Steel" must never
   *  beat the seed's own "3/4" EMT" item on a bare tie. Optional so every
   *  existing caller that built a LibraryCandidate by hand (tests, mostly)
   *  keeps compiling; a candidate with no source is treated as neutral. */
  source?: string;
}

export interface MappedLine {
  category: string;
  description: string;
  /** Passed through from NormalizedTakeoffLine.takeoffItemId — never derived here. */
  takeoffItemId: string | null;
  /** Resolved qty — 0 when the source qty was a non-numeric string (VERIFY-style). */
  qty: number;
  unit: string;
  isVerifyQty: boolean;
  sourceConfidence: SourceConfidence | null;
  matchConfidence: MapConfidence;
  matchedKind: 'assembly' | 'item' | null;
  matchedId: string | null;
  matchedCode: string | null;
  /** The matched item/assembly's OWN unit (e.g. "C" for a per-100-ft item),
   *  as opposed to `unit` above which stays the takeoff line's display unit
   *  (e.g. "LF"). Callers (bidEstimate.ts) pass this through to pricing.ts as
   *  PricingLineInput.libraryUnit so a 1,200 LF line matched to a per-C item
   *  prices as 12 C, not 1,200 EA (B1). Null when there is no match. */
  matchedUnit: string | null;
}

/** B2: normalize the handful of real-world unit spellings AI output and hand
 *  entry both produce down to the canonical EstUnit set. Unrecognized units
 *  (LS/SET/LOT/blank/anything else) pass through unchanged — callers treat
 *  those as "unit unknown", not as EA. */
export function normalizeUnit(raw: string | null | undefined): string {
  const u = (raw ?? '').trim().toUpperCase();
  if (u === 'EA' || u === 'EACH') return 'EA';
  if (u === 'LF' || u === 'FT' || u === 'FOOT' || u === 'FEET') return 'LF';
  if (u === 'C' || u === 'M') return u;
  return u;
}

const KNOWN_UNITS = new Set(['EA', 'LF', 'C', 'M']);
// LF/C/M are all "linear count at a different pricing denomination" — the same
// raw qty (feet) just gets divided by 1, 100 or 1000. EA is a fundamentally
// different kind of quantity (a count of discrete things) and must never be
// paired with a linear unit (B1: "If the line unit is incompatible with the
// library unit (EA vs LF), don't match; leave the line unmatched").
export function unitFamily(u: string): 'EA' | 'LINEAR' | 'OTHER' {
  const n = normalizeUnit(u);
  if (n === 'EA') return 'EA';
  if (n === 'LF' || n === 'C' || n === 'M') return 'LINEAR';
  return 'OTHER';
}
export function isUnitCompatible(lineUnit: string, candidateUnit: string): boolean {
  const a = unitFamily(lineUnit);
  const b = unitFamily(candidateUnit);
  // An unrecognized unit on either side can't be judged compatible or not —
  // treat it as incompatible so the line goes to "unmatched" (B2's manual/
  // unit_unknown path) rather than silently mismatching EA against it.
  if (a === 'OTHER' || b === 'OTHER') return false;
  return a === b;
}

// ── Normalization ────────────────────────────────────────────────────────────

// Electrical trade sizes are a small, known set — a generic decimal→fraction
// converter isn't needed, just enough entries to unify how AI output and an
// estimator's own typing both spell the same conduit/box size.
const DECIMAL_TO_FRACTION: Record<string, string> = {
  '.125': '1/8', '0.125': '1/8',
  '.25': '1/4', '0.25': '1/4',
  '.375': '3/8', '0.375': '3/8',
  '.5': '1/2', '0.5': '1/2',
  '.625': '5/8', '0.625': '5/8',
  '.75': '3/4', '0.75': '3/4',
  '.875': '7/8', '0.875': '7/8',
  '1.25': '1-1/4',
  '1.5': '1-1/2',
  '2.5': '2-1/2',
};

/** Lowercase, unify size notation (3/4" / .75" / 3/4 in all become "3/4"), strip
 *  punctuation that carries no matching signal, collapse whitespace.
 *
 *  B3: fractional trade sizes arrive in three written forms that must all
 *  collapse to the SAME single token — "1-1/4\"" (hyphenated), "1 1/4\""
 *  (space-separated whole + fraction), and "1.25\"" (decimal) all become the
 *  one token "1-1/4". Without joining the space-separated form, "1 1/4"
 *  tokenizes as two separate tokens ("1", "1/4") and never matches the
 *  hyphenated library spelling. */
export function normalize(s: string): string {
  let t = (s ?? '').toLowerCase();
  t = t.replace(/(\d*\.\d+)/g, (m) => DECIMAL_TO_FRACTION[m] ?? m);
  t = t.replace(/(\d+)\s+(\d+\/\d+)/g, '$1-$2');
  // Fix round 2 / SF1 — "#" immediately before a number is a WIRE GAUGE
  // marker ("#1 THHN" = 1 AWG), never a trade size — a BARE number next to
  // EMT/PVC/etc ("1\" flex") is a trade size instead. The old code stripped
  // every "#" outright, so "#1" and a bare "1" became the identical token
  // "1" and a wire item could fuzzy-match a conduit/raceway description
  // sharing nothing but that coincidental digit. Marking a gauge as "gaN"
  // keeps the two permanently distinguishable at the token level.
  t = t.replace(/#\s*(\d)/g, 'ga$1');
  t = t.replace(/\b(inch|inches|in)\b\.?/g, ' ');
  t = t.replace(/["']/g, '');
  t = t.replace(/[(),#]/g, ' ');
  t = t.replace(/[.,]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter(Boolean));
}

/** Overlap coefficient — |A∩B| / min(|A|,|B|) — rather than Jaccard, because
 *  takeoff descriptions and library names are short technical phrases where a
 *  couple of shared core nouns (e.g. "duplex", "receptacle") is a real match
 *  even when one side carries extra qualifiers ("spec grade", "20A 125V").
 *  Jaccard's union-based denominator over-penalizes exactly that case.
 *
 *  Plain (unweighted) overlap has a real failure mode within one category:
 *  two assemblies that differ only by a rating ("400A ... service entrance
 *  assembly, NEMA 3R" vs "800A ... service entrance assembly, NEMA 3R")
 *  share almost every generic trade word ("service", "entrance", "assembly",
 *  "nema") and differ only in the one token that actually matters ("400a" vs
 *  "800a") — plain overlap can rank the WRONG rating higher than the RIGHT
 *  one's alias match just by sharing more common words. `weight` down-weights
 *  a token by how many library entries it appears in (a cheap TF-IDF-style
 *  correction, built fresh from the library passed in), so a token unique to
 *  one or two candidates (a size, a rating, a model qualifier) counts far
 *  more than a word every entry in the category shares. */
function overlapScore(a: Set<string>, b: Set<string>, weight: (t: string) => number): number {
  if (a.size === 0 || b.size === 0) return 0;
  let interWeight = 0;
  for (const t of a) if (b.has(t)) interWeight += weight(t);
  const weightSum = (s: Set<string>) => { let w = 0; for (const t of s) w += weight(t); return w; };
  const minWeight = Math.min(weightSum(a), weightSum(b));
  return minWeight > 0 ? interWeight / minWeight : 0;
}

/** Document frequency of each token across every candidate's name+aliases (each
 *  candidate counts a token at most once, even if it repeats across its own
 *  aliases) — the basis for down-weighting common trade words in overlapScore. */
function buildTokenDocFreq(library: LibraryCandidate[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const c of library) {
    const seen = new Set<string>();
    for (const n of [c.name, ...c.aliases]) for (const t of tokens(n)) seen.add(t);
    for (const t of seen) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  return freq;
}

const FUZZY_THRESHOLD = 0.4;
const CATEGORY_BONUS = 0.2;
const UNIT_BONUS = 0.05;

// B3/R2-SF1: raceway/wire-TYPE families that must agree when a description
// names one — "3/4 EMT" must never fuzzy/alias-match a THHN wire item, an
// RMC (rigid) item, an LFMC item, etc, even if they share generic trade
// words or a bare size number. 'rigid' folds into 'rmc' (commonly written
// "rigid"); 'flex'/'fmc' and 'liquidtight'/'lfmc' are each their own family,
// distinct from one another and from EMT/PVC/RMC — a generic "3/4\" conduit"
// (no type word at all) must never alias-match "liquidtight flexible metal
// conduit" just because "conduit" is a substring of that name (see the
// under-specified-description guard below, which uses this same tag set).
const MATERIAL_TAGS: Record<string, string> = {
  emt: 'emt', pvc: 'pvc', rmc: 'rmc', rigid: 'rmc', mc: 'mc', thhn: 'thhn', thwn: 'thhn',
  flex: 'fmc', fmc: 'fmc', liquidtight: 'lfmc', lfmc: 'lfmc',
};
// R2-SF1 — conductor MATERIAL (aluminum vs copper) is a separate dimension
// from raceway/wire type: a THHN wire item is implicitly copper (this seed
// library has no aluminum conductor items at all), and XHHW is tagged
// aluminum per the reviewer's own grouping — "#4/0 aluminum XHHW" must never
// fuzzy-match a copper THHN item on shared generic wire words.
const CONDUCTOR_TAGS: Record<string, string> = {
  aluminum: 'aluminum', al: 'aluminum', xhhw: 'aluminum',
  copper: 'copper', cu: 'copper', thhn: 'copper', thwn: 'copper',
};
function tagsOf(tokenSet: Set<string>, table: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const t of tokenSet) {
    // A compound token like "thhn/thwn" (normalize() only strips the slash
    // when it's surrounded by whitespace, not inside a word) must still be
    // read as naming THHN — split on '/' before the exact-tag lookup.
    for (const part of t.split('/')) {
      const tag = table[part];
      if (tag) out.add(tag);
    }
  }
  return out;
}
function materialTagsOf(tokenSet: Set<string>): Set<string> {
  return tagsOf(tokenSet, MATERIAL_TAGS);
}
function conductorTagsOf(tokenSet: Set<string>): Set<string> {
  return tagsOf(tokenSet, CONDUCTOR_TAGS);
}
/** True when both sides name a material type and they disagree — e.g. desc
 *  says "emt" and the candidate is a "thhn" wire item. Neither side naming a
 *  material type is not a conflict (most items don't care). */
function materialConflict(aTags: Set<string>, bTags: Set<string>): boolean {
  if (aTags.size === 0 || bTags.size === 0) return false;
  for (const t of aTags) if (bTags.has(t)) return false;
  return true;
}

// Review round 2 / B3 — a raceway line ("3/4 EMT") must never alias/fuzzy-
// match a FITTING for that same raceway type (a coupling, connector, strap,
// bushing, locknut, adapter or elbow) just because they share a material tag
// (both "emt") and a size: {3/4, emt} is a token SUBSET of "3/4 Connector -
// EMT Set Screw Steel" (real regression: the takeoff mapper priced a 1,200 LF
// run of 3/4 EMT as if every foot were one $ea EMT connector). A fitting word
// in the text always wins over the bare-raceway fallback below - a
// description that explicitly says "EMT coupling" IS a coupling, not
// conduit. This is a separate dimension from MATERIAL_TAGS (which already
// correctly keeps EMT from matching a THHN wire item): two names can share
// the identical material tag and still be a hard conflict here.
const FITTING_KIND_WORDS: Record<string, string> = {
  coupling: 'coupling', connector: 'connector', strap: 'strap', clamp: 'strap', clip: 'strap',
  bushing: 'bushing', locknut: 'locknut', adapter: 'adapter', elbow: 'elbow',
};
const RACEWAY_MATERIALS = new Set(['emt', 'pvc', 'rmc', 'fmc', 'lfmc']);

/** null = "no raceway/fitting kind named" (never a conflict with anything -
 *  most items, e.g. a duplex receptacle, don't participate in this guard at
 *  all). A fitting word (checked first) always wins; otherwise a raceway
 *  material tag with no fitting word implies bare conduit/raceway. */
function racewayKind(tokenSet: Set<string>, materialTags: Set<string>): string | null {
  for (const t of tokenSet) {
    const kind = FITTING_KIND_WORDS[t];
    if (kind) return kind;
  }
  for (const tag of materialTags) if (RACEWAY_MATERIALS.has(tag)) return 'conduit';
  return null;
}
function racewayKindConflict(a: string | null, b: string | null): boolean {
  return a != null && b != null && a !== b;
}

// "Schedule 40"/"Schedule 80" is a real, common conduit-material qualifier —
// its number is NOT a size or rating and must never trip the conflict guard
// below (real seed regression: "4\" PVC" was failing to alias-match its own
// PVC-400 item, whose full name is "4\" PVC Sch 40, underground...", because
// the bare "40" from "Sch 40" looked like an unmatched conflicting spec).
function scheduleDigits(normalizedText: string): Set<string> {
  const out = new Set<string>();
  const re = /\bsch(?:edule)?\s+(\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalizedText))) out.add(m[1]);
  return out;
}

/** A rating/size token ("400a", "800a", "3/4", "2x4"...) that `nTokens` carries
 *  but `descTokens` does NOT is a conflicting spec, not a missing qualifier —
 *  down-weighting alone isn't enough to stop two otherwise near-identical
 *  names ("400A ... service entrance assembly" vs "800A ... service entrance
 *  assembly") from out-scoring each other on shared trade words. Applied to
 *  every match tier (B3) — exact matches trivially pass since descNorm===n
 *  implies identical tokens. `ignoreDigits` excludes numbers that are part of
 *  a "Schedule NN" callout, not a size/rating. */
function hasConflictingSpec(nTokens: Set<string>, descTokens: Set<string>, ignoreDigits: Set<string>): boolean {
  for (const t of nTokens) if (/\d/.test(t) && !descTokens.has(t) && !ignoreDigits.has(t)) return true;
  return false;
}

function tokenSubsetMatch(small: Set<string>, big: Set<string>): boolean {
  if (small.size === 0) return false;
  for (const t of small) if (!big.has(t)) return false;
  return true;
}

interface Scored {
  candidate: LibraryCandidate;
  baseScore: number; // before category/unit bonuses — informational only
  confidence: MapConfidence;
  rankScore: number; // baseScore + bonuses — used to rank WITHIN a confidence tier only
}

function scoreCandidate(
  descNorm: string,
  descTokens: Set<string>,
  altNorm: string,
  altTokens: Set<string>,
  line: NormalizedTakeoffLine,
  candidate: LibraryCandidate,
  tokenWeight: (t: string) => number,
): Scored {
  const nameNorm = normalize(candidate.name);
  let baseScore = 0;
  let confidence: MapConfidence = 'none';

  // Merged description tokens (primary + secondary field) widen alias/fuzzy
  // recall (B3 item/spec field-choice fix) without weakening exact match,
  // which is checked against the primary and secondary texts individually.
  const mergedTokens = altTokens.size > 0 ? new Set([...descTokens, ...altTokens]) : descTokens;

  const names = [nameNorm, ...candidate.aliases.map(normalize)];
  for (const n of names) {
    if (!n) continue;
    if (n === descNorm || (altNorm && n === altNorm)) {
      baseScore = 1;
      confidence = 'exact';
      break;
    }
  }
  const descMaterialTags = materialTagsOf(mergedTokens);
  const descConductorTags = conductorTagsOf(mergedTokens);
  const descRacewayKind = racewayKind(mergedTokens, descMaterialTags);
  if (confidence !== 'exact') {
    for (const n of names) {
      if (!n) continue;
      const nTokens = tokens(n);
      if (nTokens.size === 0) continue;
      if (hasConflictingSpec(nTokens, mergedTokens, scheduleDigits(n))) continue;
      const nMaterialTags = materialTagsOf(nTokens);
      if (materialConflict(descMaterialTags, nMaterialTags)) continue;
      if (materialConflict(descConductorTags, conductorTagsOf(nTokens))) continue;
      // Review round 2 / B3 — "3/4 EMT" (kind: conduit) must never alias-
      // match "3/4 Connector - EMT Set Screw Steel" (kind: connector) even
      // though neither materialConflict above fires (both are tagged "emt").
      if (racewayKindConflict(descRacewayKind, racewayKind(nTokens, nMaterialTags))) continue;
      // R2-SF1 — a candidate that NAMES a raceway/wire type (EMT/PVC/RMC/MC/
      // FMC/LFMC/THHN) can't earn alias-tier confidence off a description
      // that names NO type at all — "3/4\" conduit" sharing only the
      // generic words "conduit"+size with "liquidtight flexible metal
      // conduit" is exactly the false alias match the review flagged. A
      // description that DOES name a type is unaffected (materialConflict
      // above already guards disagreement; this guards under-specification).
      if (nMaterialTags.size > 0 && descMaterialTags.size === 0) continue;
      // Token-boundary containment, not substring — a raw substring check lets
      // "4 emt" match inside "3/4 emt" (the "4" falls right after the "/"),
      // which is exactly the false alias match the review flagged.
      if (tokenSubsetMatch(nTokens, mergedTokens) || tokenSubsetMatch(mergedTokens, nTokens)) {
        baseScore = Math.max(baseScore, 0.85);
        confidence = 'alias';
      }
    }
  }
  if (confidence === 'none') {
    let best = 0;
    for (const n of names) {
      if (!n) continue;
      const nTokens = tokens(n);
      if (hasConflictingSpec(nTokens, mergedTokens, scheduleDigits(n))) continue;
      const nMaterialTags = materialTagsOf(nTokens);
      if (materialConflict(descMaterialTags, nMaterialTags)) continue;
      if (materialConflict(descConductorTags, conductorTagsOf(nTokens))) continue;
      if (racewayKindConflict(descRacewayKind, racewayKind(nTokens, nMaterialTags))) continue; // review round 2 / B3, same rationale as the alias tier above
      if (nMaterialTags.size > 0 && descMaterialTags.size === 0) continue; // R2-SF1, same rationale as the alias tier above
      best = Math.max(best, overlapScore(mergedTokens, nTokens, tokenWeight));
    }
    baseScore = best;
    confidence = best >= FUZZY_THRESHOLD ? 'fuzzy' : 'none';
  }

  let rankScore = baseScore;
  // N4/B4: canonicalize the takeoff line's category before comparing — Agent
  // 2's own categorization prompt emits a shorter, slash-free spelling for
  // three of these ("Exterior Site Lighting" vs the seed's canonical
  // "Exterior / Site Lighting") that would otherwise never earn the bonus.
  if (candidate.category.toLowerCase() === canonicalizeTakeoffCategory(line.category).toLowerCase()) rankScore += CATEGORY_BONUS;
  if (candidate.unit === line.unit) rankScore += UNIT_BONUS;

  return { candidate, baseScore, confidence, rankScore };
}

const TIER_RANK: Record<MapConfidence, number> = { exact: 3, alias: 2, fuzzy: 1, none: 0 };

/** Deterministic tie-break WITHIN one confidence tier, same rankScore: an
 *  assembly beats a bare item (unchanged); failing that, a curated row
 *  (seed/manual/calibrated) beats a raw, unreconciled Accubid-imported row —
 *  review round 2 / B3: library.ts's own `ORDER BY category, name` used to
 *  let raw import order decide this (an "3/4 Connector..." ACB row sorting
 *  before the seed "3/4 EMT" item was the exact tie B3 reproduced). Neither
 *  rule fires, keep whichever the caller already had (the earlier candidate
 *  in iteration order — unchanged, deterministic default). */
function preferCandidate(a: LibraryCandidate, b: LibraryCandidate): boolean {
  if (a.kind === 'assembly' && b.kind !== 'assembly') return true;
  if (a.kind !== 'assembly' && b.kind === 'assembly') return false;
  const aAccubid = a.source === 'accubid';
  const bAccubid = b.source === 'accubid';
  if (!aAccubid && bAccubid) return true;
  if (aAccubid && !bAccubid) return false;
  return false;
}

function mapTakeoffLineWithFreq(line: NormalizedTakeoffLine, library: LibraryCandidate[], freq: Map<string, number>): MappedLine {
  const descNorm = normalize(line.description);
  const descTokens = tokens(line.description);
  const altNorm = line.altText ? normalize(line.altText) : '';
  const altTokens = line.altText ? tokens(line.altText) : new Set<string>();
  const tokenWeight = (t: string) => 1 / (1 + (freq.get(t) ?? 0));

  let best: Scored | null = null;
  for (const candidate of library) {
    // B1: never match across an EA/linear-unit boundary, no matter how well
    // the text scores — a "3/4 EMT, 1200 LF" line must never resolve to an
    // each-priced device just because the words overlap.
    if (!isUnitCompatible(line.unit, candidate.unit)) continue;
    const scored = scoreCandidate(descNorm, descTokens, altNorm, altTokens, line, candidate, tokenWeight);
    if (scored.confidence === 'none') continue;
    if (!best) { best = scored; continue; }
    const curTier = TIER_RANK[scored.confidence];
    const bestTier = TIER_RANK[best.confidence];
    // Confidence tier always wins first — a fuzzy match can never outrank a
    // true alias/exact match just because it happens to share this line's
    // category+unit (B3: "category bonus lets fuzzy outrank alias"). rankScore
    // (which includes those bonuses) only breaks ties WITHIN the same tier.
    if (curTier > bestTier) { best = scored; continue; }
    if (curTier < bestTier) continue;
    if (scored.rankScore > best.rankScore) { best = scored; continue; }
    if (scored.rankScore === best.rankScore && preferCandidate(scored.candidate, best.candidate)) {
      best = scored;
    }
  }

  const isVerifyQty = typeof line.qty === 'string' && line.qty.trim() !== '' && Number.isNaN(Number(line.qty));
  const numericQty = typeof line.qty === 'number' ? line.qty : Number(line.qty);
  const qty = isVerifyQty || !Number.isFinite(numericQty) ? 0 : numericQty;

  return {
    category: line.category,
    description: line.description,
    takeoffItemId: line.takeoffItemId ?? null,
    qty,
    unit: line.unit,
    isVerifyQty,
    sourceConfidence: isVerifyQty ? 'VERIFY' : (line.sourceConfidence ?? null),
    matchConfidence: best?.confidence ?? 'none',
    matchedKind: best?.candidate.kind ?? null,
    matchedId: best?.candidate.id ?? null,
    matchedCode: best?.candidate.code ?? null,
    matchedUnit: best?.candidate.unit ?? null,
  };
}

/** Match one normalized takeoff line against the library. Deterministic: ties
 *  prefer an assembly over a bare item, then the earlier candidate in `library`.
 *  Builds the token-frequency weighting fresh from `library` — for matching many
 *  lines against the same library, prefer mapTakeoffLines(), which builds it once. */
export function mapTakeoffLine(line: NormalizedTakeoffLine, library: LibraryCandidate[]): MappedLine {
  return mapTakeoffLineWithFreq(line, library, buildTokenDocFreq(library));
}

export function mapTakeoffLines(lines: NormalizedTakeoffLine[], library: LibraryCandidate[]): MappedLine[] {
  const freq = buildTokenDocFreq(library);
  return lines.map(l => mapTakeoffLineWithFreq(l, library, freq));
}

// ── Adapters for the two real takeoff shapes ────────────────────────────────

export interface TakeoffItemLike {
  item: string;
  description?: string;
  unit: string;
  qty: number | string;
  conf?: string | null;
}
export interface TakeoffCategoryLike {
  name: string;
  items: TakeoffItemLike[];
}

/** bidstd TakeoffCategory[]/TakeoffItem shape (backend/src/bidstd/bidData.ts).
 *  `it.item` is Agent 4's short takeoff item id ("5.1") — carried through as
 *  takeoffItemId, never used as the match text unless description is blank. */
export function fromTakeoffCategories(categories: TakeoffCategoryLike[]): NormalizedTakeoffLine[] {
  const out: NormalizedTakeoffLine[] = [];
  for (const cat of categories) {
    for (const it of cat.items ?? []) {
      out.push({
        category: cat.name,
        description: (it.description && it.description.trim()) || it.item,
        takeoffItemId: it.item ?? null,
        qty: it.qty,
        unit: normalizeUnit(it.unit), // B2: canonicalize aliases (ea/each, ft/lf) here, once, for every downstream consumer
        sourceConfidence: normalizeSourceConfidence(it.conf),
      });
    }
  }
  return out;
}

export interface LegacyTakeoffRow {
  category: string;
  /** Agent 4's short takeoff item id ("5.1") — matches Agent 4's own
   *  `it.item` convention (Agent 4 QCs and restructures Agent 2's output,
   *  preserving its numbering), NOT the descriptive text. */
  item: string;
  /** The descriptive text to match against the library. Optional because an
   *  older/hand-built fixture may only have `item` (some existing tests
   *  predate this field and pass a description directly as `item`) — falls
   *  back to `item` when absent so those callers keep working. */
  spec?: string | null;
  qty: number | string;
  unit: string;
  confidence?: string | null;
}

// A bare takeoff-item id ("5.1", "12") carries no matching signal — only treat
// `item` as a useful secondary description (B3's item-vs-spec fix) when it
// looks like actual text, not Agent 4's numbering.
const SHORT_ID_RE = /^\d+(\.\d+)?$/;

/** The legacy Agent 2/4 line shape read by the frontend's buildLineItemsFromTakeoff. */
export function fromLegacyTakeoff(rows: LegacyTakeoffRow[]): NormalizedTakeoffLine[] {
  return rows.map(r => {
    const spec = r.spec && r.spec.trim();
    const description = spec || r.item;
    const itemTrimmed = (r.item ?? '').trim();
    // B3: real Agent 2/4 rows split the descriptive noun unpredictably across
    // item/spec — e.g. item "Duplex receptacle" / spec "20A,125V,NEMA 5-20R,
    // spec grade" carries the noun in `item`, not `spec`. Surface it as
    // altText so the mapper's alias/fuzzy tiers can see it too, without
    // touching which text counts as the "primary" description above.
    const altText = itemTrimmed && itemTrimmed !== description && !SHORT_ID_RE.test(itemTrimmed)
      ? itemTrimmed
      : null;
    return {
      category: r.category,
      description,
      takeoffItemId: r.item ?? null,
      qty: r.qty,
      unit: normalizeUnit(r.unit), // B2: canonicalize aliases (ea/each, ft/lf) here, once, for every downstream consumer
      sourceConfidence: normalizeSourceConfidence(r.confidence),
      altText,
    };
  });
}

function normalizeSourceConfidence(v: string | null | undefined): SourceConfidence | null {
  const up = (v ?? '').toUpperCase();
  return up === 'FIRM' || up === 'APPROX' || up === 'VERIFY' ? (up as SourceConfidence) : null;
}
