// Typical-expansion fix — the live Opus 5.5 run of AutoZone #10077 Kissimmee
// (2026-09-28) replayed through the current code. Every input is that run's
// own stored output (fixtures/realrun/replay.ts says how; no model is
// called, nothing is transcribed):
//   * the counter answers with the live run's own marks (incl. the marks the
//     enlarged-plan rule excluded), the consistency pass with the same E-3
//     marks (the live second pass agreed 73/73, 52/52);
//   * the evidence readers answer from the live run's parsed output (the
//     sheets' viewports, every typical package, every schedule table).
// The live run gave ALL six power poles one equipment row ("PP-1..6"); the
// #9 POWER POLE LEGEND's five pole types were each multiplied by all six
// (duplex 48, simplex 12; receptacles +33 against 38).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadKissimmeeLive0928 } from './fixtures/realrun/kissimmeeLive';
import { replayPdfs, replayEvidenceCache, replayCounter, liveCounterMarks, liveAgent1Input, isCounterRequest, REPLAY_COUNTER_MODEL } from './fixtures/realrun/replay';
import { fakeAnthropic, userText, type FakeRequest } from './fixtures/takeoff/fakeAnthropic';
import { gapFillResponder, isGapFillRequest } from './fixtures/evidence/kissimmeeReplies';
import { runCountingStage, type CountResult } from '../ai/countingStage';
import { buildCountTargets } from '../ai/countTargets';
import { consolidateTargets } from '../ai/evidence/consolidate';
import { buildReviewItems, reviewItemIsOpen, type ReviewItem } from '../ai/reviewItems';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { DEFAULT_EVIDENCE_MODEL } from '../routes/preconstruction';
import type { InventoryPage } from '../ai/countSheets';
import { diffAgainstExpected, formatDiffTable, validateExpectedFile } from '../eval/takeoffEval';

const live = loadKissimmeeLive0928();
const expected = validateExpectedFile(JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/autozone-10077-kissimmee.expected.json'), 'utf8')));

function keyMap() {
  const cons = consolidateTargets(buildCountTargets(live.agent1).targets);
  return (k: string): string | null => {
    const t = cons.targets.find(x => x.key === k);
    if (!t) return k;
    if (!t.mergedInto?.length || t.role === 'host') return k;
    return cons.aliasOf.get(k) ?? null;
  };
}

async function replay(): Promise<{ cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] }> {
  const run = loadKissimmeeLive0928();
  const keys = keyMap();
  const marks = liveCounterMarks(run);
  const first = replayCounter(run, marks, keys);
  const second = replayCounter(run, marks.filter(m => m.sheetKey.endsWith('#51')), keys);
  const gf = gapFillResponder();
  const { client, calls } = fakeAnthropic(req => (isCounterRequest(req) ? (userText(req).includes('CONSISTENCY PASS') ? second(req) : first(req))
    : isGapFillRequest(req) ? gf(req)
    : (() => { throw new Error(`unexpected model call: ${JSON.stringify(req.system).slice(0, 120)}`); })()));
  const stage = await runCountingStage({
    client, model: REPLAY_COUNTER_MODEL, maxTokens: 32000,
    agent1: liveAgent1Input(run), inventory: run.inventory as InventoryPage[], pdfs: await replayPdfs(),
    evidence: { model: DEFAULT_EVIDENCE_MODEL, maxTokens: 16000, cache: replayEvidenceCache(run) },
  });
  return { cr: stage.countResult, review: buildReviewItems(stage.countResult), calls };
}

let have = false;
let after: { cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] };
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (have) after = await replay();
}, 300_000);

const liveCount = (k: string) => live.countResult.types.find(t => t.key === k)!.count;
const count = (k: string) => after.cr.types.find(t => t.key === k)!.count;

describe('the 2026-09-28 live Kissimmee run, replayed', () => {
  it('prints the eval before (live) / after (replayed)', (ctx) => {
    if (!have) return ctx.skip();
    const before = diffAgainstExpected(expected, live.countResult as unknown as CountResult);
    const now = diffAgainstExpected(expected, after.cr);
    // eslint-disable-next-line no-console
    console.log(`BEFORE (live 2026-09-28)\n${formatDiffTable(before)}\n\nAFTER (replayed)\n${formatDiffTable(now)}\n\nREVIEW (replayed)\n${after.review.map(i => `  ${reviewItemIsOpen(i) ? 'B' : 'i'} ${i.id} — ${i.title}`).join('\n')}`);
    expect(now.rows.length).toBe(before.rows.length);
  });

  it('replay fidelity: every type outside the power-pole typicals keeps the live count', (ctx) => {
    if (!have) return ctx.skip();
    for (const t of live.countResult.types) {
      if (t.key === 'DUPLEX / FLOOR RECEPTACLE' || t.key === 'SIMPLEX') continue;
      const a = after.cr.types.find(x => x.key === t.key);
      expect(a, t.key).toBeTruthy();
      expect([a!.count, a!.status], t.key).toEqual([t.count, t.status]);
    }
  });

  it('live: the six untyped poles fed all five legend types (duplex 48, simplex 12)', () => {
    expect([liveCount('DUPLEX / FLOOR RECEPTACLE'), liveCount('SIMPLEX')]).toEqual([48, 12]);
  });

  it('replayed: counts from the drawn marks only', (ctx) => {
    if (!have) return ctx.skip();
    expect([count('DUPLEX / FLOOR RECEPTACLE'), count('SIMPLEX'), count('GFCI'), count('WP GFI')]).toEqual([48, 12, 7, 4]);
  });
});
