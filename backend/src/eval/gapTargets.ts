// Gap-closing T0 — the per-job, per-group targets of the gap-closing round
// (docs/superpowers/plans/2026-09-30-gap-closing.md, "Expected before → after").
// Chris's hours per group are NOT typed here: the gate computes them from his
// BOM through hoursGroups.ts. A group is `gated` (its band is a pass/fail
// check on the SCRIPTED-answers scenario) or `reported` (printed only, until
// the named question for Chris is answered).
import type { HoursGroup } from '../estimating/hoursGroups';

export type GapStatus = 'gated' | { reported: string };
export interface GroupBand {
  /** What the plan expects the CRM to land at after the round ("≈"), for the report. */
  expectedAfter: string;
  /** Pass band in hours: absolute [lo, hi], or ± pct of Chris, or ≤ Chris + h. */
  band: { lo: number; hi: number } | { pctOfChris: number } | { maxOverChris: number };
  status: GapStatus;
  tasks: string;
}

export interface JobTargets {
  groups: Partial<Record<HoursGroup | 'branch wiring total', GroupBand>>;
  totalHoursPct: number;
  /** Selling price band around chrisAtCrmSettings (Chris's inputs at the CRM's settings). */
  sellingPct: number;
  /** Material band around Chris's BOM material (after owner-furnished). */
  materialPct: number;
}

/** "Branch wiring total" = branch conduit + wire & MC + fittings + hardware + boxes & rings + splices. */
export const BRANCH_WIRING_GROUPS: HoursGroup[] = ['branch conduit', 'wire & MC', 'fittings', 'hardware', 'boxes & rings', 'splices'];

export const GAP_TARGETS: Record<'kissimmee' | '36th', JobTargets> = {
  kissimmee: {
    groups: {
      feeders: { expectedAfter: '≈ 38–40 h', band: { lo: 36, hi: 90 }, status: { reported: 'Q1 (lateral length, the empty 2" PVC)' }, tasks: 'T4, J5' },
      'service gear': { expectedAfter: '≈ 45 h (J6)', band: { pctOfChris: 20 }, status: 'gated', tasks: 'T5, J6' },
      'equipment connections': { expectedAfter: '≈ 41 h (needs the power-pole hosts counted)', band: { pctOfChris: 15 }, status: { reported: 'Q4 / fewer-questions (power-pole hosts are a count)' }, tasks: 'R, P, fewer-questions' },
      'site / underground': { expectedAfter: '≈ 47 h', band: { pctOfChris: 20 }, status: 'gated', tasks: 'T6' },
      controls: { expectedAfter: '≈ 6.3 h (≈ 14.9 with the CMP length)', band: { pctOfChris: 100 }, status: { reported: 'Q9 (Venstar cable length)' }, tasks: 'T9' },
      devices: { expectedAfter: '≈ 12.7 h (T7 + J8)', band: { maxOverChris: 7 }, status: 'gated', tasks: 'T7, J8' },
      fixtures: { expectedAfter: '≈ 161 h', band: { pctOfChris: 7 }, status: 'gated', tasks: 'J7' },
      'wire & MC': { expectedAfter: '≈ 75 h', band: { pctOfChris: 100 }, status: { reported: 'the #10 split washes with site' }, tasks: 'T8' },
      'branch wiring total': { expectedAfter: 'conduit + wire + fittings + hw + boxes + splices', band: { pctOfChris: 7 }, status: 'gated', tasks: 'T7, T8' },
      misc: { expectedAfter: '1.5 h (17.5 if the misc row is included)', band: { pctOfChris: 100 }, status: { reported: 'Q6 (misc lump)' }, tasks: 'T10' },
    },
    totalHoursPct: 12, sellingPct: 20, materialPct: 30,
  },
  '36th': {
    groups: {
      'branch conduit': { expectedAfter: '≈ 33 h with T13 (17.7 without)', band: { pctOfChris: 15 }, status: { reported: 'located only with T13 / Q13' }, tasks: 'T13' },
      fixtures: { expectedAfter: '≈ 28.5 h', band: { pctOfChris: 100 }, status: { reported: 'Q10 (Type H, the 8 EM 2-heads)' }, tasks: 'J7' },
      controls: { expectedAfter: '1.65 h (TIMER counted)', band: { lo: 1.15, hi: 2.15 }, status: 'gated', tasks: 'T9' },
      'wire & MC': { expectedAfter: '≈ 19.1 h', band: { pctOfChris: 100 }, status: { reported: 'ratio' }, tasks: 'T8' },
      devices: { expectedAfter: '≈ 4.4 h', band: { lo: 2.91, hi: 6.91 }, status: 'gated', tasks: 'J8' },
      feeders: { expectedAfter: '0 h', band: { pctOfChris: 100 }, status: { reported: 'Q13 (riser)' }, tasks: '—' },
      'equipment connections': { expectedAfter: '4.1 h', band: { pctOfChris: 100 }, status: { reported: 'Q7 (terminations)' }, tasks: '—' },
    },
    totalHoursPct: 15, sellingPct: 15, materialPct: 30,
  },
};

/** The [lo, hi] hours band of a group given Chris's hours. */
export function bandOf(b: GroupBand['band'], chris: number): { lo: number; hi: number } {
  if ('lo' in b) return b;
  if ('pctOfChris' in b) return { lo: chris * (1 - b.pctOfChris / 100), hi: chris * (1 + b.pctOfChris / 100) };
  return { lo: -Infinity, hi: chris + b.maxOverChris };
}
