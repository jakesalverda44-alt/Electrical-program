/**
 * Duplicate / REBID hints for the Intake Inbox — pure, DB-free matching so three separate
 * "[RFP] Nick & Moes Winter Haven" invitations (or a plain vs. "(REBID)" pair) show the
 * reviewer a heads-up instead of silently becoming three unrelated pipeline rows.
 * Informational only: no auto-merge, no data changes — see routes/intake.ts for the DB
 * lookup that feeds candidates in, and IntakeInboxPage.tsx for the amber chip that renders it.
 */

export interface SimilarCandidate {
  kind: 'intake' | 'bid';
  id: string;
  name: string;
  stage?: string;
}

// Tokens that mark a re-send/rebid/forward of the same project rather than a different one —
// stripped before comparing so they don't defeat the match.
const NOISE_RE = /\b(re[- ]?bid|rebid|rfp|rfq|itb|re|fw|fwd)\b/gi;
const BRACKETED_RE = /[[(][^[\]()]*[\])]/g; // "(REBID)", "[RFP]"

/**
 * Normalizes a project name down to a comparison key: strip bracketed tags ("(REBID)",
 * "[RFP]"), strip loose re-send/rebid tokens, lowercase, strip punctuation, collapse
 * whitespace. Two invitations for the same project — however differently worded — should
 * collapse to the same key.
 */
export function similarKey(name: string): string {
  let s = (name || '').trim();
  s = s.replace(BRACKETED_RE, ' ');
  s = s.replace(/^\s*(re|fw|fwd)\s*:\s*/i, ' '); // leading "RE:"/"FW:"/"FWD:"
  s = s.replace(NOISE_RE, ' ');
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Guards against a short/generic key ("bid", "tampa") producing false-positive matches.
const MIN_KEY_LEN = 8;

/**
 * Candidates whose normalized key equals, contains, or is contained by the subject's key.
 * Capped at 3. Both sides must clear MIN_KEY_LEN to count — short/generic keys never match.
 */
export function findSimilar(
  subjectName: string,
  candidates: SimilarCandidate[],
  max = 3,
): SimilarCandidate[] {
  const subjectKey = similarKey(subjectName);
  if (subjectKey.length < MIN_KEY_LEN) return [];

  const out: SimilarCandidate[] = [];
  for (const c of candidates) {
    const key = similarKey(c.name);
    if (key.length < MIN_KEY_LEN) continue;
    if (key === subjectKey) {
      out.push(c);
    } else if (key.includes(subjectKey) || subjectKey.includes(key)) {
      // Containment (one name inside the other) requires the SHORTER side to
      // carry at least two tokens — a bare brand name ("AutoZone") is contained
      // in every store's invite and would chip against every same-brand bid in
      // the pipeline. Same single-token-containment ban customerMatch.ts uses
      // for GC canonicalization (the DR Horton / Horton Group lesson).
      const shorter = key.length <= subjectKey.length ? key : subjectKey;
      if (shorter.split(' ').length >= 2) out.push(c);
    }
    if (out.length >= max) break;
  }
  return out;
}

/** The single match rule shared by findSimilar and the indexed matcher. */
function keysMatch(key: string, subjectKey: string): boolean {
  if (key.length < MIN_KEY_LEN) return false;
  if (key === subjectKey) return true;
  if (key.includes(subjectKey) || subjectKey.includes(key)) {
    const shorter = key.length <= subjectKey.length ? key : subjectKey;
    return shorter.split(' ').length >= 2;
  }
  return false;
}

/**
 * Same results as calling findSimilar(subject, candidates, max) for every subject, but built
 * for many subjects against a large candidate set (pending intake x every bid in the DB).
 * findSimilar re-normalizes every candidate name per subject (O(subjects x candidates)
 * regex work — minutes on a table with ~85k bids). Here each candidate is normalized once
 * and indexed by key and by character trigram, so a lookup only inspects candidates that
 * can possibly match: those containing the subject key (every trigram of the subject must
 * appear, so the rarest trigram's posting list is a superset) and those whose whole key is
 * a substring of the subject key (exact lookups of the subject's substrings).
 * `candidates` order is the tie-break order, exactly as in findSimilar.
 */
export function buildSimilarMatcher(candidates: SimilarCandidate[], max = 3) {
  const keys: string[] = candidates.map(c => similarKey(c.name));
  const byKey = new Map<string, number[]>();
  const byTrigram = new Map<string, number[]>();
  keys.forEach((k, i) => {
    if (k.length < MIN_KEY_LEN) return;
    const l = byKey.get(k); if (l) l.push(i); else byKey.set(k, [i]);
    const seen = new Set<string>();
    for (let j = 0; j + 3 <= k.length; j++) {
      const t = k.substr(j, 3);
      if (seen.has(t)) continue;
      seen.add(t);
      const tl = byTrigram.get(t); if (tl) tl.push(i); else byTrigram.set(t, [i]);
    }
  });

  return function find(subjectName: string, excludeId?: string): SimilarCandidate[] {
    const subjectKey = similarKey(subjectName);
    if (subjectKey.length < MIN_KEY_LEN) return [];

    const cand = new Set<number>();
    // Candidates containing the subject key: scan the rarest trigram's posting list.
    let best: number[] | null = null;
    for (let j = 0; j + 3 <= subjectKey.length; j++) {
      const l = byTrigram.get(subjectKey.substr(j, 3));
      if (!l) { best = []; break; }
      if (!best || l.length < best.length) best = l;
    }
    for (const i of best ?? []) cand.add(i);
    // Candidates whose whole key sits inside the subject key.
    for (let a = 0; a < subjectKey.length; a++) {
      for (let b = a + MIN_KEY_LEN; b <= subjectKey.length; b++) {
        const l = byKey.get(subjectKey.slice(a, b));
        if (l) for (const i of l) cand.add(i);
      }
    }
    const hits = [...cand].sort((x, y) => x - y);
    const out: SimilarCandidate[] = [];
    for (const i of hits) {
      const c = candidates[i];
      if (excludeId !== undefined && c.kind === 'intake' && c.id === excludeId) continue;
      if (keysMatch(keys[i], subjectKey)) out.push(c);
      if (out.length >= max) break;
    }
    return out;
  };
}
