// Accuracy round C4/C5/C8 — the Kissimmee 0930 feeder inputs for the pure
// estimator, from the real exports (count result, est_sheets, the real
// C4.1 / PH0.1 text runs) plus, where a test says so, the SCRIPTED pins /
// locate mock (kissimmee-2026-09-30-scripted-pins.json).
import fs from 'fs';
import path from 'path';
import { loadKissimmeeLive0930, type Live0930 } from './live0930';
import type { FeederEstimateInput } from '../../../estimating/feederEstimate';
import { DEFAULT_FEEDER_ESTIMATE } from '../../../estimating/feederRoute';
import type { LocateLike } from '../../../estimating/feederEndpoints';
import { LIVE_PLAN_FILE } from './kissimmeeLive';

const read = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
export const TEXT_RUNS_0930 = read('kissimmee-2026-09-30-textruns.json');
export const SCRIPTED_0930 = read('kissimmee-2026-09-30-scripted-pins.json') as {
  pins: Array<{ label: string; page: number; x: number; y: number }>;
  locateMock: { nodes: string[] };
};
const PLAN_DOC = '97025d73-1630-49f9-bd7a-03d22c2e0e1b';

/** The two vector sheets' text runs as the loader supplies them. */
export function textSheets0930(): FeederEstimateInput['textSheets'] {
  return (['C4.1', 'PH0.1'] as const).map(label => {
    const p = TEXT_RUNS_0930.pages[label];
    return { sheetKey: `${LIVE_PLAN_FILE}#${p.page}`, label: `${label} "${label === 'C4.1' ? 'Composite Utility Plan' : 'Photometric Plan'}"`, geometry: p.geometry, runs: p.runs, documentId: PLAN_DOC, pageIndex: p.page - 1, site: true };
  });
}

/** SCRIPTED — pins as est_markups rows (confirmed count markers). */
export function scriptedPins(labels?: (p: { label: string; page: number }) => boolean): FeederEstimateInput['pins'] {
  return SCRIPTED_0930.pins.filter(p => !labels || labels(p)).map(p => ({ document_id: PLAN_DOC, page_index: p.page - 1, label: p.label, points: [{ x: p.x, y: p.y }] }));
}

/** SCRIPTED — Builder R's locate[] stand-in (E-1 positions). */
export function scriptedLocate(): LocateLike[] {
  const byNode: Record<string, string> = { 'PANEL A': 'Panel A', 'PANEL B': 'Panel B', 'DISCON A': 'Discon A', 'DISCON B': 'Discon B', METER: 'Meter', WIREWAY: 'Wireway' };
  return SCRIPTED_0930.locateMock.nodes.map(n => {
    const p = SCRIPTED_0930.pins.find(x => x.page === 49 && x.label === byNode[n])!;
    return { node: n, sheetKey: `${LIVE_PLAN_FILE}#49`, x: p.x, y: p.y, viewportKind: 'main_plan', confidence: 'high' };
  });
}

export function feederInput0930(opts: { live?: Live0930; pins?: FeederEstimateInput['pins']; locate?: LocateLike[] } = {}): FeederEstimateInput {
  const live = opts.live ?? loadKissimmeeLive0930();
  const cr = live.countResult as unknown as NonNullable<FeederEstimateInput['countResult']>;
  return {
    graph: { agent1: live.agent1 as never, takeoffRows: live.agent2.takeoff as never },
    countResult: { ...cr, locate: opts.locate ?? cr.locate ?? [] },
    estSheets: live.estSheets as never,
    pins: opts.pins ?? [],
    textSheets: textSheets0930(),
    knownAreas: live.bid.sq_ft ? [{ sqFt: live.bid.sq_ft, source: 'bid SF' }] : [],
    settings: DEFAULT_FEEDER_ESTIMATE, slackPct: 10, deckFt: null,
  };
}
