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
