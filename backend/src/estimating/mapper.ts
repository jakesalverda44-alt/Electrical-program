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
}

export interface LibraryCandidate {
  kind: 'assembly' | 'item';
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  aliases: string[];
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
 *  punctuation that carries no matching signal, collapse whitespace. */
export function normalize(s: string): string {
  let t = (s ?? '').toLowerCase();
  t = t.replace(/(\d*\.\d+)/g, (m) => DECIMAL_TO_FRACTION[m] ?? m);
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

interface Scored {
  candidate: LibraryCandidate;
  baseScore: number; // before category/unit bonuses — determines exact/alias/fuzzy classification
  confidence: MapConfidence;
  rankScore: number; // baseScore + bonuses — determines which candidate wins
}

function scoreCandidate(
  descNorm: string,
  descTokens: Set<string>,
  line: NormalizedTakeoffLine,
  candidate: LibraryCandidate,
  tokenWeight: (t: string) => number,
): Scored {
  const nameNorm = normalize(candidate.name);
  let baseScore = 0;
  let confidence: MapConfidence = 'none';

  const names = [nameNorm, ...candidate.aliases.map(normalize)];
  for (const n of names) {
    if (!n) continue;
    if (n === descNorm) {
      baseScore = 1;
      confidence = 'exact';
      break;
    }
  }
  if (confidence !== 'exact') {
    for (const n of names) {
      if (!n || n.length < 4) continue;
      if (descNorm.includes(n) || n.includes(descNorm)) {
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
      // A rating/size token ("400a", "800a", "3/4", "2x4"...) that this candidate's
      // own name/alias carries but the takeoff description does NOT is a conflicting
      // spec, not a missing qualifier — down-weighting isn't enough to stop two
      // otherwise near-identical names ("400A ... service entrance assembly, NEMA
      // 3R" vs "800A ... service entrance assembly, NEMA 3R") from out-scoring each
      // other on shared trade words alone. Disqualify that candidate text outright
      // rather than confidently mapping a takeoff line to the wrong rating.
      const hasConflictingSpec = [...nTokens].some(t => /\d/.test(t) && !descTokens.has(t));
      if (hasConflictingSpec) continue;
      best = Math.max(best, overlapScore(descTokens, nTokens, tokenWeight));
    }
    baseScore = best;
    confidence = best >= FUZZY_THRESHOLD ? 'fuzzy' : 'none';
  }

  let rankScore = baseScore;
  if (candidate.category.toLowerCase() === line.category.toLowerCase()) rankScore += CATEGORY_BONUS;
  if (candidate.unit === line.unit) rankScore += UNIT_BONUS;

  return { candidate, baseScore, confidence, rankScore };
}

function mapTakeoffLineWithFreq(line: NormalizedTakeoffLine, library: LibraryCandidate[], freq: Map<string, number>): MappedLine {
  const descNorm = normalize(line.description);
  const descTokens = tokens(line.description);
  const tokenWeight = (t: string) => 1 / (1 + (freq.get(t) ?? 0));

  let best: Scored | null = null;
  for (const candidate of library) {
    const scored = scoreCandidate(descNorm, descTokens, line, candidate, tokenWeight);
    if (scored.confidence === 'none') continue;
    if (!best
      || scored.rankScore > best.rankScore
      || (scored.rankScore === best.rankScore && scored.candidate.kind === 'assembly' && best.candidate.kind === 'item')
    ) {
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
        unit: it.unit,
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

/** The legacy Agent 2/4 line shape read by the frontend's buildLineItemsFromTakeoff. */
export function fromLegacyTakeoff(rows: LegacyTakeoffRow[]): NormalizedTakeoffLine[] {
  return rows.map(r => ({
    category: r.category,
    description: (r.spec && r.spec.trim()) || r.item,
    takeoffItemId: r.item ?? null,
    qty: r.qty,
    unit: r.unit,
    sourceConfidence: normalizeSourceConfidence(r.confidence),
  }));
}

function normalizeSourceConfidence(v: string | null | undefined): SourceConfidence | null {
  const up = (v ?? '').toUpperCase();
  return up === 'FIRM' || up === 'APPROX' || up === 'VERIFY' ? (up as SourceConfidence) : null;
}
