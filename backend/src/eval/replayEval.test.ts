// Accuracy round F5 — the replay eval gate, against the committed baseline
// (eval/replay-baseline-2026-09-30.json). No model, no DB: the read-only live
// exports of 2026-09-30 through the current code.
//
// Scenarios per job are the baseline's (live@<stage>, live@due-fresh,
// projected@<stage>, projected@due-fresh — see replayEval.baseline.test.ts),
// priced against the live library as this round's migrations leave it
// (158: Chris's units + decision 1; 159: v2 cost-line defaults). Kissimmee
// also gets its real C4.1 / PH0.1 text runs (what the app's loader reads)
// and, separately, the SCRIPTED scenario: the locate[] stand-in for Builder
// R's C3 + the SCRIPTED pins measured once on the local PDF (no review
// answers — the pole-type / typical answers arrive with Builder R).
// "projected" = the replay's stand-in for Agent 2 reading the counts (stated
// in every table). The gate scenario is projected@due-fresh.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { replayPricing, countDiff, type ReplayPricing } from './replayEval';
import { validateExpectedFile, type ExpectedFile, type EvalDiff } from './takeoffEval';
import { loadKissimmeeLive0930, load36th0930, loadLiveLibrary0930, type Live0930 } from '../test/fixtures/realrun/live0930';
import { replayKissimmee0930, replay36th0930 } from '../test/fixtures/realrun/replay0930';
import { textSheets0930, scriptedLocate, scriptedPins } from '../test/fixtures/realrun/feeders0930';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import type { CountResult } from '../ai/countingStage';

const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/replay-baseline-2026-09-30.json'), 'utf8'));
const expectedOf = (f: string): ExpectedFile => validateExpectedFile(JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval', f), 'utf8')));
const CHRIS = { kissimmee: { hours: 798.95, sellingPrice: 79112.23 }, '36th': { hours: 189.21, sellingPrice: 23230.14 } } as const;

type JobId = 'kissimmee' | '36th';
interface JobRun { id: JobId; scen: Record<string, ReplayPricing>; diff: EvalDiff; cr: CountResult }

let have = false;
const runs: Partial<Record<JobId, JobRun>> = {};

async function runJob(id: JobId, live: Live0930, expected: ExpectedFile, cr: CountResult): Promise<JobRun> {
  const lib = loadLiveLibrary0930();
  const stage = live.bid.stage;
  const textSheets = id === 'kissimmee' ? textSheets0930() : [];
  const f = { textSheets };
  const scen: Record<string, ReplayPricing> = {
    [`live@${stage}`]: await replayPricing(live, lib, { rows: 'live', feeders: f, detail: true }),
    'live@due-fresh': await replayPricing(live, lib, { rows: 'live', stage: 'due', ignoreCostLineSeeds: true, feeders: f, detail: true }),
    [`projected@${stage}`]: await replayPricing(live, lib, { rows: 'projected', countResult: cr, feeders: f, detail: true }),
    'projected@due-fresh': await replayPricing(live, lib, { rows: 'projected', countResult: cr, stage: 'due', ignoreCostLineSeeds: true, feeders: f, detail: true }),
  };
  if (id === 'kissimmee') {
    // SCRIPTED — R's locate[] stand-in on E-1, plus XFMR + METER pinned on C4.1.
    scen['SCRIPTED projected@due-fresh'] = await replayPricing(live, lib, {
      rows: 'projected', countResult: cr, stage: 'due', ignoreCostLineSeeds: true, detail: true,
      feeders: { textSheets, locate: scriptedLocate(), pins: scriptedPins(p => p.page === 15) },
    });
  }
  const primary = scen['projected@due-fresh'];
  const lf = { conductors: Object.fromEntries(Object.entries(primary.feederLf).map(([k, v]) => [k.replace(/^#/, ''), v])), conduits: primary.conduitLf ?? {} };
  return { id, scen, diff: countDiff(expected, cr, lf), cr };
}

beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  runs.kissimmee = await runJob('kissimmee', loadKissimmeeLive0930(), expectedOf('autozone-10077-kissimmee.expected.json'), (await replayKissimmee0930()).cr);
  runs['36th'] = await runJob('36th', load36th0930(), expectedOf('36th-street-warehouse.expected.json'), (await replay36th0930()).stage.countResult);
}, 600_000);

const base = (id: JobId) => BASELINE.jobs[id];
const r1 = (n: number) => Math.round(n * 10) / 10;

describe('F5 — the replay eval gate (vs replay-baseline-2026-09-30.json)', () => {
  it('prints the before / after tables the reports quote', (ctx) => {
    if (!have) return ctx.skip();
    const lines: string[] = [];
    for (const id of ['kissimmee', '36th'] as const) {
      const b = base(id); const a = runs[id]!;
      lines.push(`== ${id}  Chris ${CHRIS[id].hours} h / $${CHRIS[id].sellingPrice}  (rows "projected" = the replay's stand-in for Agent 2 reading the counts)`);
      for (const [k, s] of Object.entries(a.scen)) {
        const was = b.scenarios[k.replace(/^SCRIPTED /, '')];
        lines.push(`  ${k.padEnd(30)} before $${was?.sellingPrice ?? '—'} ${was ? r1(was.hours) : '—'} h held ${was?.heldCount ?? '—'}  →  after $${s.sellingPrice} ${r1(s.hours)} h  holds ${s.heldCount} notes ${s.noteCount ?? 0}  eq $${s.equipment} ge $${s.generalExpenses}`);
        lines.push(`      buckets ${JSON.stringify(s.hoursByBucket)}`);
        lines.push(`      feeder LF ${JSON.stringify(s.feederLf)}  raceway LF ${JSON.stringify(s.conduitLf ?? {})}`);
      }
      lines.push(`  Chris buckets ${JSON.stringify(b.chris.hoursByBucket)}`);
      lines.push(`  primary groups after ${JSON.stringify(a.scen['projected@due-fresh'].hoursByGroup)}`);
      lines.push(`  Chris groups        ${JSON.stringify(b.chris.hoursByGroup)}`);
      lines.push(`  count diff: ${a.diff.rows.map(r => `${r.id} ${r.actual ?? '—'}/${r.expected} ${r.verdict}`).join('; ')}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[replay gate]\n${lines.join('\n')}`);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('no non-disputed count item goes pass → fail, and none gets a larger |delta|', (ctx) => {
    if (!have) return ctx.skip();
    for (const id of ['kissimmee', '36th'] as const) {
      const before = new Map<string, { verdict: string; delta: number | null }>(base(id).counting.rows.map((r: { id: string; verdict: string; delta: number | null }) => [r.id, r]));
      for (const r of runs[id]!.diff.rows) {
        const b = before.get(r.id);
        if (!b || r.verdict === 'reported') continue;
        if (b.verdict === 'pass') expect(r.verdict, `${id} ${r.id}`).toBe('pass');
        if (b.delta != null && r.delta != null) expect(Math.abs(r.delta), `${id} ${r.id}`).toBeLessThanOrEqual(Math.abs(b.delta));
      }
    }
  });

  it('Kissimmee site poles / heads pass once Builder R\'s A lands (skipped while the replayed count still has the family stack)', (ctx) => {
    if (!have) return ctx.skip();
    const row = (k: string) => runs.kissimmee!.diff.rows.find(r => r.id === k)!;
    if (row('site_poles').actual === base('kissimmee').counting.rows.find((r: { id: string }) => r.id === 'site_poles').actual) return ctx.skip();
    expect([row('site_poles').verdict, row('site_heads').verdict]).toEqual(['pass', 'pass']);
  });

  it('per job, |hours − Chris| is not worse than the baseline by more than 2% of Chris', (ctx) => {
    if (!have) return ctx.skip();
    for (const id of ['kissimmee', '36th'] as const) {
      const before = base(id).scenarios['projected@due-fresh'].hours;
      const after = runs[id]!.scen['projected@due-fresh'].hours;
      expect(Math.abs(after - CHRIS[id].hours) - Math.abs(before - CHRIS[id].hours), id).toBeLessThanOrEqual(0.02 * CHRIS[id].hours);
    }
  });

  it('36th: hours and selling price within ±15% of 189.21 h / $23,230.14', (ctx) => {
    if (!have) return ctx.skip();
    const s = runs['36th']!.scen['projected@due-fresh'];
    expect(Math.abs(s.hours - 189.21) / 189.21).toBeLessThanOrEqual(0.15);
    expect(Math.abs(s.sellingPrice - 23230.14) / 23230.14).toBeLessThanOrEqual(0.15);
  });

  it('Kissimmee total hours ≥ the baseline', (ctx) => {
    if (!have) return ctx.skip();
    expect(runs.kissimmee!.scen['projected@due-fresh'].hours).toBeGreaterThanOrEqual(base('kissimmee').scenarios['projected@due-fresh'].hours);
  });

  it('no priced line with 0 contribution that is neither a hold nor a note', (ctx) => {
    if (!have) return ctx.skip();
    for (const id of ['kissimmee', '36th'] as const) for (const [k, s] of Object.entries(runs[id]!.scen)) {
      const silent = (s.lineDetail ?? []).filter(l => !l.excluded && l.qty > 0 && l.hours === 0 && l.material === 0 && !l.note && !l.hold);
      expect(silent.map(l => l.description), `${id} ${k}`).toEqual([]);
    }
  });
});
