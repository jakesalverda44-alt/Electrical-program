// Task 5 (phase 2 takeoff fidelity): confidence survives to the estimator's
// screen. Agent 1 emits VERIFIED/ASSUMED/NOT SHOWN per quantity and Agent 2
// carries a `confidence` field on each takeoff row, but Pricing has always
// shown nothing — the estimator can't see which numbers are firm vs guessed,
// which the manual playbook (Takeoff_Process.md) treats as the core of a
// takeoff: every quantity is FIRM, APPROX, or VERIFY.
//
// This is a code-level mapping only — it does NOT change the agent prompts'
// confidence vocabulary. Agent 3's QC step references VERIFIED/ASSUMED
// directly (AGENT3_SYSTEM), so those values keep flowing through the pipeline
// unchanged; only the Pricing tab's chip rendering translates them to the
// playbook's three-word vocabulary for the estimator.

export type PlaybookConfidence = 'FIRM' | 'APPROX' | 'VERIFY';

/**
 * Map an Agent 1/2 confidence value to the playbook's FIRM/APPROX/VERIFY.
 * Already-playbook values pass through unchanged (a takeoff imported from the
 * Cowork pre-bid package may already carry them). Unknown or absent -> null,
 * so callers can render nothing rather than a misleading chip.
 */
export function confidenceToPlaybook(c: string | undefined | null): PlaybookConfidence | null {
  if (!c) return null;
  const upper = c.trim().toUpperCase();
  switch (upper) {
    case 'VERIFIED':
      return 'FIRM';
    case 'ASSUMED':
      return 'APPROX';
    case 'NOT SHOWN':
      return 'VERIFY';
    case 'FIRM':
    case 'APPROX':
    case 'VERIFY':
      return upper;
    default:
      return null;
  }
}
