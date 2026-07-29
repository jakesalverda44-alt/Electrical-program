/**
 * GC name canonicalization — pure, DB-free matching so a bid's freeform GC text
 * ("bay to bay", "Estimating Department (Bay to Bay Properties, LLC)") snaps to
 * one existing customer record instead of spawning duplicates.
 *
 * Used by resolveCustomer() in routes/customers.ts, which does the DB lookup and
 * find-or-create.
 */

export interface CustomerRef {
  id: string;
  name: string;
}

// Trailing corporate/industry qualifiers that are noise for matching purposes —
// stripped iteratively so "X Construction LLC" and "X" compare equal.
const SUFFIXES = [
  'inc', 'llc', 'l.l.c', 'corp', 'co', 'ltd',
  'construction', 'builders', 'contracting', 'contractors', 'group', 'services',
];

// Generic words that show up wrapping a GC's real name in intake text
// ("Estimating Department (...)", "Bid (...)") — never the actual company name.
const JUNK_WORDS = new Set(['estimating', 'department', 'bid', 'bids', 'preconstruction', 'purchasing', 'office']);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SUFFIX_PATTERNS = SUFFIXES.map(suf => new RegExp(`[,\\s]+${escapeRegExp(suf)}[.,]*\\s*$`, 'i'));

/** Strip at most one trailing suffix. Returns the (possibly) shortened string and whether it changed. */
function stripSuffixOnce(s: string): { s: string; changed: boolean } {
  for (const re of SUFFIX_PATTERNS) {
    if (re.test(s)) return { s: s.replace(re, ''), changed: true };
  }
  return { s, changed: false };
}

/**
 * Lowercase, strip punctuation, collapse whitespace, and iteratively strip trailing
 * corporate suffixes — for COMPARISON only, never for display.
 */
export function normalizeCompanyName(input: string): string {
  let s = (input || '').trim().toLowerCase();
  if (!s) return '';

  // Suffixes first, while punctuation (periods/commas) is still present — the
  // patterns rely on it to anchor "llc" vs "l.l.c" and to eat a trailing comma.
  for (let i = 0; i < 6; i++) {
    const next = stripSuffixOnce(s);
    if (!next.changed) break;
    s = next.s.trim();
  }

  // Apostrophes fuse into the word ("Sonny's" -> "sonnys"); everything else
  // punctuation-like becomes a separator.
  s = s.replace(/['’]/g, '');
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function isJunk(normalized: string): boolean {
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  return tokens.every(t => JUNK_WORDS.has(t));
}

/**
 * Ordered candidate names pulled out of a raw GC string. First candidate is the
 * best guess for a display/create name.
 */
export function extractCandidates(raw: string): string[] {
  const s = (raw || '').trim();
  if (!s) return [];

  const m = s.match(/\(([^()]+)\)/);
  if (!m) return [s];

  const parenContent = m[1].trim();
  const parenWords = parenContent.split(/\s+/).filter(Boolean);
  if (parenWords.length < 2) return [s];

  const outer = (s.slice(0, m.index) + s.slice(m.index! + m[0].length)).replace(/\s+/g, ' ').trim();
  const outerNorm = normalizeCompanyName(outer);

  if (isJunk(outerNorm)) return [parenContent];
  return [s, parenContent];
}

// Guards against a short/generic normalized string ("abc", "co") being treated as
// a real match signal — either as an exact-match key or as the contained side of
// a containment check.
function isSubstantial(normalized: string): boolean {
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.length >= 2 || normalized.length >= 5;
}

function tokensOf(normalized: string): string[] {
  return normalized.split(/\s+/).filter(Boolean);
}

// Contiguous-subsequence check: every token of `shorter` must appear in `longer`,
// in order, with no gaps — i.e. `shorter` is a run of adjacent tokens inside
// `longer`. This is what makes "bay to bay" ⊂ "bay to bay construction" a real
// containment match while refusing "bay to bays" vs "bay to bay" (last token
// differs, so it's never a contiguous run) or a bare surname collision.
function isContiguousSubsequence(shorter: string[], longer: string[]): boolean {
  if (!shorter.length || shorter.length > longer.length) return false;
  for (let i = 0; i <= longer.length - shorter.length; i++) {
    let match = true;
    for (let j = 0; j < shorter.length; j++) {
      if (longer[i + j] !== shorter[j]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

// Containment match on WORD-BOUNDARY tokens, not raw substring — a raw
// String.includes() would let "horton" (single token, ≥5 chars, passes the
// exact-match substantiality guard) silently swallow "dr horton" vs "horton
// group" as if they were the same company. Containment additionally refuses
// to merge when the shorter side is a single token, regardless of length:
// a lone surname/word is never trustworthy as a containment signal, only as
// part of an exact match.
function containmentMatches(aNorm: string, bNorm: string): boolean {
  const aTokens = tokensOf(aNorm);
  const bTokens = tokensOf(bNorm);
  if (!aTokens.length || !bTokens.length) return false;
  const [shorter, longer] = aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens];
  if (shorter.length < 2) return false;
  return isContiguousSubsequence(shorter, longer);
}

/**
 * Resolve a raw GC/customer string against existing customers of the same type.
 * (a) exact normalized match wins, but only when it identifies exactly one existing
 *     customer — 2+ exact hits is treated as ambiguous.
 * (b) else containment (candidate ⊆ existing or existing ⊆ candidate) — again only
 *     when exactly one existing customer matches.
 * (c) otherwise null (including when every candidate is too short/generic to trust).
 */
export function matchCustomer(input: string, existing: CustomerRef[]): CustomerRef | null {
  const candidates = extractCandidates(input)
    .map(normalizeCompanyName)
    .filter(isSubstantial);
  if (!candidates.length) return null;

  const existingNorm = existing
    .map(e => ({ ...e, norm: normalizeCompanyName(e.name) }))
    .filter(e => isSubstantial(e.norm));
  if (!existingNorm.length) return null;

  const exactIds = new Map<string, CustomerRef>();
  for (const e of existingNorm) {
    if (candidates.includes(e.norm)) exactIds.set(e.id, { id: e.id, name: e.name });
  }
  if (exactIds.size === 1) return [...exactIds.values()][0];
  if (exactIds.size >= 2) return null;

  const containIds = new Map<string, CustomerRef>();
  for (const e of existingNorm) {
    if (candidates.some(c => containmentMatches(c, e.norm))) {
      containIds.set(e.id, { id: e.id, name: e.name });
    }
  }
  if (containIds.size === 1) return [...containIds.values()][0];
  return null;
}
