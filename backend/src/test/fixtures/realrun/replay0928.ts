// Fix round S5 — the 2026-09-28 replay, shared by the replay test and the
// route test (so the REAL assignment item goes through /review/resolve).
// See kissimmeeLive0928Replay.test.ts for what is and is not replayed.
import { loadKissimmeeLive0928 } from './kissimmeeLive';
import { replayPdfs, replayEvidenceCache, replayCounter, liveCounterMarks, liveAgent1Input, isCounterRequest, REPLAY_COUNTER_MODEL } from './replay';
import { fakeAnthropic, userText, type FakeRequest } from '../takeoff/fakeAnthropic';
import { gapFillResponder, isGapFillRequest } from '../evidence/kissimmeeReplies';
import { runCountingStage, type CountResult } from '../../../ai/countingStage';
import { buildCountTargets } from '../../../ai/countTargets';
import { consolidateTargets } from '../../../ai/evidence/consolidate';
import { buildReviewItems, type ReviewItem } from '../../../ai/reviewItems';
import { DEFAULT_EVIDENCE_MODEL } from '../../../routes/preconstruction';
import type { InventoryPage } from '../../../ai/countSheets';

const live = loadKissimmeeLive0928();

function keyMap() {
  const cons = consolidateTargets(buildCountTargets(live.agent1).targets);
  return (k: string): string | null => {
    const t = cons.targets.find(x => x.key === k);
    if (!t) return k;
    if (!t.mergedInto?.length || t.role === 'host') return k;
    return cons.aliasOf.get(k) ?? null;
  };
}

export async function replay0928(): Promise<{ cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] }> {
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

