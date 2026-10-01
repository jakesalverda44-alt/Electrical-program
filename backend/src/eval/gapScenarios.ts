// Gap-closing — the round's replay scenarios per job (shared by the T0 baseline and the T15 gate).
import fs from 'fs';
import path from 'path';
import { replayPricing, type ReplayPricing } from './replayEval';
import { loadKissimmeeLive0930, load36th0930, loadLiveLibrary0930, type Live0930 } from '../test/fixtures/realrun/live0930';
import { replayKissimmee0930, replay36th0930 } from '../test/fixtures/realrun/replay0930';
import { textSheets0930, scriptedLocate, scriptedPins } from '../test/fixtures/realrun/feeders0930';
import { scriptedAnswersOptions, type GapJob } from '../test/fixtures/realrun/gapScripted';

export const GAP_BASELINE_PATH = path.join(__dirname, '../../eval/gap-baseline-2026-10-01.json');
export const GAP_JOBS: Array<{ id: GapJob; load: () => Live0930; bom: string; extraExterior: RegExp[]; replay: () => Promise<unknown> }> = [
  { id: 'kissimmee', load: loadKissimmeeLive0930, bom: 'kissimmee-bom.txt', extraExterior: [/5" Luminaire Recessed Downlight/], replay: async () => (await replayKissimmee0930()).cr },
  { id: '36th', load: load36th0930, bom: '36th-street-bom.txt', extraExterior: [], replay: async () => (await replay36th0930()).stage.countResult },
];


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

