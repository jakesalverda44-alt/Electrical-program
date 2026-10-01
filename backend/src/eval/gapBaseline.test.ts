// Gap-closing T0 — the "before" of the gap-closing round, committed as
// backend/eval/gap-baseline-2026-10-01.json BEFORE any behavior change and never rewritten.
//
//   written once:  WRITE_GAP_BASELINE=1 npm test -- src/eval/gapBaseline.test.ts
//
// Scenarios per job (read-only live exports of 2026-09-30; no model, no DB):
//   live@<stage>                   the stored proposal (Kissimmee: submitted, not calibration)
//   projected@due-fresh            the accuracy round's gate scenario
//   SCRIPTED projected@due-fresh   (Kissimmee) + the SCRIPTED feeder locate / pins (P's scenario)
//   SCRIPTED answers               the gap-closing gate scenario: + the SCRIPTED account terms, count answers
//                                  and the fixture-package answer (scripted-answers-2026-09-30.json)
// The plan's T0 acceptance ("K SCRIPTED $85,294.44 / 697.90 h") was measured before P's fix rounds 1–2 and the
// R merge; main 25dce72 is the true before: K SCRIPTED $68,753.09 / 638.1 h, gate $64,994.21 / 600.3 h,
// live@submitted $42,916.83 / 364.5375 h; 36th projected@due-fresh $21,357.35 / 167.5 h. Pinned below.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { replayPricing, chrisHours, chrisAtCrmSettings, type ReplayPricing } from './replayEval';
import { loadKissimmeeLive0930, load36th0930, loadLiveLibrary0930, type Live0930 } from '../test/fixtures/realrun/live0930';
import { replayKissimmee0930, replay36th0930 } from '../test/fixtures/realrun/replay0930';
import { textSheets0930, scriptedLocate, scriptedPins } from '../test/fixtures/realrun/feeders0930';
import { scriptedAnswersOptions, SCRIPTED_ANSWERS, type GapJob } from '../test/fixtures/realrun/gapScripted';
import { isPdftoppmAvailable } from '../ai/documentPrep';

export const GAP_BASELINE_PATH = path.join(__dirname, '../../eval/gap-baseline-2026-10-01.json');
const bomText = (f: string) => fs.readFileSync(path.join(__dirname, '../test/fixtures/estimating/accubid', f), 'utf8');
export const GAP_JOBS: Array<{ id: GapJob; load: () => Live0930; bom: string; extraExterior: RegExp[]; replay: () => Promise<unknown> }> = [
  { id: 'kissimmee', load: loadKissimmeeLive0930, bom: 'kissimmee-bom.txt', extraExterior: [/5" Luminaire Recessed Downlight/], replay: async () => (await replayKissimmee0930()).cr },
  { id: '36th', load: load36th0930, bom: '36th-street-bom.txt', extraExterior: [], replay: async () => (await replay36th0930()).stage.countResult },
];

const slim = (s: ReplayPricing) => {
  const { lineDetail: _d, ...rest } = s;
  return rest;
};

/** Every gap-closing scenario for one job (shared with the gate). */
export async function gapScenarios(job: typeof GAP_JOBS[number], cr: unknown): Promise<Record<string, ReplayPricing>> {
  const live = job.load();
  const lib = loadLiveLibrary0930();
  const textSheets = job.id === 'kissimmee' ? textSheets0930() : [];
  const out: Record<string, ReplayPricing> = {
    [`live@${live.bid.stage}`]: await replayPricing(live, lib, { rows: 'live', feeders: { textSheets }, detail: true }),
    'projected@due-fresh': await replayPricing(live, lib, { rows: 'projected', countResult: cr as never, stage: 'due', ignoreCostLineSeeds: true, feeders: { textSheets }, detail: true }),
  };
  if (job.id === 'kissimmee') {
    out['SCRIPTED projected@due-fresh'] = await replayPricing(live, lib, {
      rows: 'projected', countResult: cr as never, stage: 'due', ignoreCostLineSeeds: true, detail: true,
      feeders: { textSheets, locate: scriptedLocate(), pins: scriptedPins(p => p.page === 15) },
    });
  }
  out['SCRIPTED answers'] = await replayPricing(live, lib, scriptedAnswersOptions(job.id, live, cr));
  return out;
}

let have = false;
let computed: Record<string, unknown> | null = null;
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  const jobs: Record<string, unknown> = {};
  for (const j of GAP_JOBS) {
    const cr = await j.replay();
    const scen = await gapScenarios(j, cr);
    const chris = chrisHours(bomText(j.bom), j.extraExterior);
    const ref = chrisAtCrmSettings(j.id, j.load(), bomText(j.bom));
    jobs[j.id] = {
      stage: j.load().bid.stage,
      scenarios: Object.fromEntries(Object.entries(scen).map(([k, v]) => [k, slim(v)])),
      chris: { hours: chris.total, footerHours: chris.footer, hoursByGroup: chris.byGroup, hoursByBucket: chris.byBucket },
      chrisAtCrmSettings: { sellingPrice: ref.sellingPrice, material: ref.material, hours: ref.hours, source: ref.inputs.source },
    };
  }
  computed = {
    _note: 'Gap-closing T0 baseline — main 25dce72 (accuracy-reading + accuracy-pricing merged) + the T0 eval-only changes (hoursGroups size-first Feeders hint, the SCRIPTED answers scenario options), BEFORE any behavior change. Read-only live exports of 2026-09-30, no model, no DB. "SCRIPTED answers" = scripted-answers-2026-09-30.json (each answer quotes its document) + the migration-114 AutoZone / Default rules (account-rules-2026-09-30.json) resolved against Agent 1\'s furnish statements. Chris\'s hours come from his BOM via hoursGroups.ts; chrisAtCrmSettings = Chris\'s own inputs at the bid\'s CRM settings. Never rewritten.',
    scriptedAnswersNote: SCRIPTED_ANSWERS._note,
    jobs,
  };
  if (process.env.WRITE_GAP_BASELINE === '1') fs.writeFileSync(GAP_BASELINE_PATH, JSON.stringify(computed, null, 1) + '\n');
}, 600_000);

describe('gap-closing T0 — baseline (2026-10-01)', () => {
  it('the committed baseline exists and pins main\'s figures (not the plan\'s pre-fix-round ones)', (ctx) => {
    if (!have) { if (process.env.CI) throw new Error('pdftoppm missing'); return ctx.skip(); }
    const b = JSON.parse(fs.readFileSync(GAP_BASELINE_PATH, 'utf8')).jobs;
    const k = b.kissimmee.scenarios;
    expect(k['live@submitted'].sellingPrice).toBe(42916.83);
    expect(k['live@submitted'].hours).toBeCloseTo(364.5375, 4);
    expect(k['projected@due-fresh'].sellingPrice).toBe(64994.21);
    expect(k['SCRIPTED projected@due-fresh'].sellingPrice).toBe(68753.09);
    expect(b['36th'].scenarios['projected@due-fresh'].sellingPrice).toBe(21357.35);
    expect(b.kissimmee.chrisAtCrmSettings.sellingPrice).toBe(82853.75);
    expect(b['36th'].chrisAtCrmSettings.sellingPrice).toBe(20100.47);
  });

  it('prints the baseline table', (ctx) => {
    if (!have) return ctx.skip();
    const jobs = computed!.jobs as Record<string, { scenarios: Record<string, ReplayPricing>; chris: { hours: number; hoursByGroup: Record<string, number> }; chrisAtCrmSettings: { sellingPrice: number } }>;
    const lines: string[] = [];
    for (const [id, j] of Object.entries(jobs)) {
      lines.push(`== ${id}  Chris ${j.chris.hours} h; Chris's inputs at CRM settings $${j.chrisAtCrmSettings.sellingPrice}`);
      for (const [k, s] of Object.entries(j.scenarios)) lines.push(`  ${k.padEnd(30)} $${s.sellingPrice}  ${s.hours.toFixed(2)} h  mat $${s.material}  holds ${s.heldCount}  ${JSON.stringify(s.hoursByGroup)}`);
      lines.push(`  ${'Chris'.padEnd(30)} ${JSON.stringify(j.chris.hoursByGroup)}`);
    }
    // eslint-disable-next-line no-console
    console.log(`[gap baseline]\n${lines.join('\n')}`);
    expect(lines.length).toBeGreaterThan(0);
  });
});
