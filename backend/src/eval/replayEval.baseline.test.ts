// Accuracy round Task 0.3 — the "before" numbers, computed by the F2 replay
// harness on the pre-round code and committed as
// backend/eval/replay-baseline-2026-09-30.json. Every before/after in the
// round's reports comes from that file.
//
//   regenerate (only with a report entry saying why):
//     WRITE_REPLAY_BASELINE=1 npm test -- src/eval/replayEval.baseline.test.ts
//
// Scenarios per job (all from the read-only live exports; no model, no DB):
//   live@<stage>      Agent 2's rows as stored, the bid's own stage — must
//                     reproduce what GET /accubid showed (acceptance: $1 / 0.1 h)
//   live@due-fresh    the same rows, stage 'due' assumed, as a fresh bid
//                     (default equipment / GE lines not yet seeded)
//   projected@<stage> the REPLAYED count projected onto Agent 2's rows
//                     (projectCountsOntoRows — the replay's stand-in for Agent 2
//                     reading the counts), the bid's own stage
//   projected@due-fresh the same, 'due' assumed, fresh bid — the gate's scenario
// Review answers: 36th Street = the stored answers; Kissimmee = none (the
// SCRIPTED answer set arrives with the round's tasks).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { replayPricing, chrisHours, countDiff, type ReplayPricing } from './replayEval';
import { validateExpectedFile, type ExpectedFile } from './takeoffEval';
import { loadKissimmeeLive0930, load36th0930, loadLiveLibrary0930, type Live0930 } from '../test/fixtures/realrun/live0930';
import { replayKissimmee0930, replay36th0930 } from '../test/fixtures/realrun/replay0930';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { isEstimatingBid } from '../estimating/costLineDefaults';
import type { CountResult } from '../ai/countingStage';

const BASELINE = path.join(__dirname, '../../eval/replay-baseline-2026-09-30.json');
const expectedOf = (f: string): ExpectedFile => validateExpectedFile(JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval', f), 'utf8')));
const bomText = (f: string) => fs.readFileSync(path.join(__dirname, '../test/fixtures/estimating/accubid', f), 'utf8');

interface JobSpec {
  id: 'kissimmee' | '36th';
  live: Live0930;
  expected: ExpectedFile;
  bom: string;
  /** Job-specific exterior fixture rows of Chris's BOM (documented). */
  extraExterior: RegExp[];
  extraExteriorNote?: string;
  replay: () => Promise<CountResult>;
}

type TypeRow = { key: string; count: number; status: string; heads?: number };
function typeDiffs(live: TypeRow[], replayed: TypeRow[]): string[] {
  const out: string[] = [];
  for (const t of live) {
    const a = replayed.find(x => x.key === t.key);
    if (!a || a.count !== t.count || a.status !== t.status || (a.heads ?? null) !== (t.heads ?? null)) out.push(`${t.key}: live ${t.count}/${t.status} replay ${a ? `${a.count}/${a.status}` : 'missing'}`);
  }
  for (const a of replayed) if (!live.some(t => t.key === a.key)) out.push(`${a.key}: only in replay (${a.count}/${a.status})`);
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

async function jobBaseline(spec: JobSpec) {
  const lib = loadLiveLibrary0930();
  const { live } = spec;
  const cr = await spec.replay();
  const stage = live.bid.stage;
  const scen: Record<string, ReplayPricing> = {
    [`live@${stage}`]: await replayPricing(live, lib, { rows: 'live' }),
    'live@due-fresh': await replayPricing(live, lib, { rows: 'live', stage: 'due', ignoreCostLineSeeds: true }),
    [`projected@${stage}`]: await replayPricing(live, lib, { rows: 'projected', countResult: cr }),
    'projected@due-fresh': await replayPricing(live, lib, { rows: 'projected', countResult: cr, stage: 'due', ignoreCostLineSeeds: true }),
  };
  const own = scen[`live@${stage}`];
  const diff = countDiff(spec.expected, cr);
  const chris = chrisHours(bomText(spec.bom), spec.extraExterior);
  const ref = spec.expected.reference_estimate as { selling_price?: number; total_labor_hours?: number } | undefined;
  return {
    bidId: live.bid.id, runId: live.runId, stage, sqFt: live.bid.sq_ft,
    liveProposal: { sellingPrice: live.liveProposal.recap.sellingPrice, hours: live.liveProposal.totalHours },
    reproduction: {
      scenario: `live@${stage}`, sellingPrice: own.sellingPrice, hours: own.hours,
      deltaPrice: r2(own.sellingPrice - live.liveProposal.recap.sellingPrice),
      deltaHours: Math.round((own.hours - live.liveProposal.totalHours) * 10000) / 10000,
    },
    counting: {
      replayTypeDiffs: typeDiffs(live.countResult.types as TypeRow[], cr.types as unknown as TypeRow[]),
      passed: diff.passed, failed: diff.failed, reported: diff.reported,
      rows: diff.rows.map(r => ({ id: r.id, expected: r.expected, actual: r.actual, delta: r.delta, verdict: r.verdict })),
    },
    scenarios: scen,
    primary: 'projected@due-fresh',
    chris: {
      source: `computed from accubid/${spec.bom} by hoursGroups.ts`,
      ...(spec.extraExteriorNote ? { exteriorNote: spec.extraExteriorNote } : {}),
      sellingPrice: ref?.selling_price ?? null, hours: chris.total, footerHours: chris.footer,
      hoursByBucket: chris.byBucket, hoursByGroup: chris.byGroup,
    },
  };
}

const JOBS: JobSpec[] = [
  {
    id: 'kissimmee', live: loadKissimmeeLive0930(), expected: expectedOf('autozone-10077-kissimmee.expected.json'), bom: 'kissimmee-bom.txt',
    extraExterior: [/5" Luminaire Recessed Downlight/],
    extraExteriorNote: 'the 5" recessed downlights (11) are type G "Soffit" — the CRM prices them as Exterior Site Lighting "Soffit" × 11',
    replay: async () => (await replayKissimmee0930()).cr,
  },
  {
    id: '36th', live: load36th0930(), expected: expectedOf('36th-street-warehouse.expected.json'), bom: '36th-street-bom.txt',
    extraExterior: [],
    replay: async () => (await replay36th0930()).stage.countResult,
  },
];

let have = false;
let computed: Record<string, unknown> | null = null;
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  const jobs: Record<string, unknown> = {};
  for (const j of JOBS) jobs[j.id] = await jobBaseline(j);
  computed = {
    _note: 'Accuracy round Task 0 baseline — the F2 replay harness (src/eval/replayEval.ts) on the pre-round code (main d783568 + the Task 0 pure-core refactor, no behavior change), over the read-only live exports of 2026-09-30 (test/fixtures/realrun/*-2026-09-30.json + live-library-2026-09-30.json). No model, no DB. See replayEval.baseline.test.ts for the scenarios. Chris\'s hours are computed from his Accubid BOM by hoursGroups.ts, never typed. Regenerate only with a report entry saying why.',
    jobs,
  };
  if (process.env.WRITE_REPLAY_BASELINE === '1') fs.writeFileSync(BASELINE, JSON.stringify(computed, null, 1) + '\n');
}, 600_000);

/** Accuracy round — the replayed counts this round changes ON PURPOSE (the
 *  "after"; the committed file stays the "before"): per job, the type keys
 *  whose replayed count / status may differ from the live run, each with
 *  the task that changes it (see docs/superpowers/plans/2026-09-30-accuracy-R-report.md). */
export const INTENDED_COUNT_CHANGES: Record<string, Record<string, string>> = {
  kissimmee: {
    'SITE LIGHT': 'R Task A — the same 3 site poles as PH0.1\'s S1/S2 (E-7 registers onto PH0.1): merged, never stacked',
    'PP-1..6': 'R Task B1/B2 — a shared pole host is counted on the plans (no longer from its circuits: 2); the live marks hold none, so 0 found of the 6 E-2 states, asked pole by pole',
    'PP-OFFICE/CCTV': 'R Task B4 — the #1 office pole type\'s schedule row: merged into PP-1..6',
    'PP-TEST': 'R Task B4 — the #4 tester pole type\'s schedule row: merged into PP-1..6',
  },
  '36th': {},
};
/** Fields of the committed baseline the round's tasks change on purpose:
 *  the counting rows and the scenarios priced from the replayed count. */
function withoutIntended(jobs: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, j] of Object.entries(jobs)) {
    const { counting: _c, scenarios, reproduction, ...rest } = j as { counting: unknown; scenarios: Record<string, unknown>; reproduction: unknown; stage: string };
    // Pricing scoping (Builder P): the generated rows, units and prices of this round apply ONLY to a bid being
    // estimated (isEstimatingBid), so a bid that is still `due` (36th) legitimately prices differently from the
    // committed pre-round file in EVERY scenario and in its reproduction. They are excluded here and checked
    // instead by the gate (replayEval.test.ts) and the pricing tests. A bid that is NOT being estimated
    // (Kissimmee, submitted) keeps its stored price: its live@<stage> scenario and its reproduction stay pinned
    // on price / hours / material (its hold COUNT changed on purpose: the holds / notes vocabulary, D5).
    const estimating = isEstimatingBid({ stage: rest.stage });
    const kept = estimating ? {} : Object.fromEntries(Object.entries(scenarios).filter(([k]) => !k.startsWith('projected@') && !k.startsWith('live@due'))
      .map(([k, v]) => { const { sellingPrice, hours, material } = v as { sellingPrice: number; hours: number; material: number }; return [k, { sellingPrice, hours, material }]; }));
    out[id] = { ...rest, ...(estimating ? {} : { reproduction }), scenarios: kept };
  }
  return out;
}

/** The gap-closing round's pinned delta (replayed live@due minus the live proposal) for each still-estimated job. */
const DUE_ROUND_DELTA: Record<string, number> = { '36th': 1178.47 } // $22,133.75 replayed vs the live proposal's $20,955.28 (5.6%);

describe('Task 0 — replay baseline (2026-09-30)', () => {
  it('acceptance: replaying the stored rows reproduces the live proposal within $1 and 0.1 h', (ctx) => {
    if (!have) return ctx.skip();
    const committed = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).jobs as Record<string, { reproduction: { deltaPrice: number; deltaHours: number } }>;
    for (const j of JOBS) {
      const b = (computed!.jobs as Record<string, { reproduction: { deltaPrice: number; deltaHours: number } }>)[j.id];
      if (isEstimatingBid(j.live.bid)) {
        // A bid still being estimated prices with this round's rows / units, so it no longer reproduces the stored
        // (pre-round) proposal; what is checked is that the committed pre-round reproduction was exact, and that the
        // difference is the round's own additions (a small, bounded set: the equipment terminations / notes).
        expect(Math.abs(committed[j.id].reproduction.deltaPrice), `${j.id} (committed)`).toBeLessThanOrEqual(1);
        // Gap-closing round: a due bid takes the round's new units / MC basis / device-only receptacles on purpose
        // (J5–J10); gapGate.test.ts owns the per-group checks. Review S5: the round's delta on the 36th live@due
        // replay is PINNED (±$1, was a 10% bound that could hide a second change of the round's size).
        expect(Math.abs(b.reproduction.deltaPrice - DUE_ROUND_DELTA[j.id]), `${j.id} (round additions, pinned)`).toBeLessThanOrEqual(1);
        continue;
      }
      expect(Math.abs(b.reproduction.deltaPrice), j.id).toBeLessThanOrEqual(1);
      expect(Math.abs(b.reproduction.deltaHours), j.id).toBeLessThanOrEqual(0.1);
    }
  });

  it('replay fidelity: the replayed count keeps every live type (count, status, heads) but the ones the round changes on purpose', (ctx) => {
    if (!have) return ctx.skip();
    for (const j of JOBS) {
      const diffs = (computed!.jobs as Record<string, { counting: { replayTypeDiffs: string[] } }>)[j.id].counting.replayTypeDiffs;
      expect(diffs.filter(d => !(d.split(':')[0] in INTENDED_COUNT_CHANGES[j.id])), j.id).toEqual([]);
    }
  });

  it('the committed baseline is what the harness computes (pinned) — outside the counting the round changes on purpose', (ctx) => {
    if (!have) return ctx.skip();
    const committed = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    // The "before" file is never rewritten by the round; its counting rows
    // and the projected scenarios are compared in replayReading.test.ts.
    expect(withoutIntended(JSON.parse(JSON.stringify(computed)).jobs)).toEqual(withoutIntended(committed.jobs));
  });

  it('prints the table the reports quote', (ctx) => {
    if (!have) return ctx.skip();
    const jobs = computed!.jobs as Record<string, { liveProposal: unknown; scenarios: Record<string, ReplayPricing>; chris: { hours: number; sellingPrice: number | null; hoursByBucket: Record<string, number> } }>;
    const lines: string[] = [];
    for (const [id, j] of Object.entries(jobs)) {
      lines.push(`== ${id}  live ${JSON.stringify(j.liveProposal)}  Chris ${j.chris.hours} h / $${j.chris.sellingPrice}`);
      for (const [k, s] of Object.entries(j.scenarios)) lines.push(`  ${k.padEnd(22)} $${s.sellingPrice}  ${s.hours.toFixed(1)} h  mat $${s.material}  held ${s.heldCount}  ${JSON.stringify(s.hoursByBucket)}`);
      lines.push(`  ${'Chris'.padEnd(22)} ${JSON.stringify(j.chris.hoursByBucket)}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[replay baseline]\n${lines.join('\n')}`);
    expect(lines.length).toBeGreaterThan(0);
  });
});
