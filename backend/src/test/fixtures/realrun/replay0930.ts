// Accuracy round Task 0 / F2 — the two live runs of 2026-09-30 replayed
// through the current code's counting stage. No model is called:
//   * Kissimmee (run 11ff4565): exactly the replay0928.ts method — the
//     counter answers with the live run's own marks (incl. the marks the
//     enlarged-plan rule excluded), the consistency pass with the live E-3
//     marks; the evidence readers from the live run's parsed output.
//   * 36th Street (run ec90ce29): exactly the replay36thB.ts method on the
//     0930 export; the close-up status check (a mocked reply in 36thB) is
//     answered with the LIVE run's own crop verdicts — per type, the first
//     `asNew` marks (live order) "filled", the rest "open"
//     (count_result.remodel.statusCrops.checked).
import { loadKissimmeeLive0930, load36th0930 } from './live0930';
import { replayPdfs, replayEvidenceCache, replayCounter, liveCounterMarks, liveAgent1Input, isCounterRequest, REPLAY_COUNTER_MODEL } from './replay';
import { replay36thB, type CropPolicy, type Live36thB } from './replay36thB';
import { fakeAnthropic, userText, type FakeRequest } from '../takeoff/fakeAnthropic';
import { gapFillResponder, isGapFillRequest } from '../evidence/kissimmeeReplies';
import { runCountingStage, type CountResult } from '../../../ai/countingStage';
import { buildCountTargets } from '../../../ai/countTargets';
import { consolidateTargets } from '../../../ai/evidence/consolidate';
import { buildReviewItems, type ReviewItem } from '../../../ai/reviewItems';
import { DEFAULT_EVIDENCE_MODEL } from '../../../routes/preconstruction';
import type { InventoryPage } from '../../../ai/countSheets';
import type { KissimmeeLiveRun } from './kissimmeeLive';

export async function replayKissimmee0930(): Promise<{ cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] }> {
  const run = loadKissimmeeLive0930() as unknown as KissimmeeLiveRun;
  const cons = consolidateTargets(buildCountTargets(run.agent1).targets);
  const keys = (k: string): string | null => {
    const t = cons.targets.find(x => x.key === k);
    if (!t) return k;
    if (!t.mergedInto?.length || t.role === 'host') return k;
    return cons.aliasOf.get(k) ?? null;
  };
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

/** The live close-up verdicts, per type (first `asNew` marks filled). */
export function liveCrops0930(run: Live36thB): CropPolicy {
  const checked = ((run.countResult.remodel as unknown as { statusCrops?: { checked?: Array<{ typeKey: string; asNew: number }> } }).statusCrops?.checked) ?? [];
  const asNew = new Map(checked.map(c => [c.typeKey, c.asNew]));
  return m => ({ answer: m.index < (asNew.get(m.typeKey) ?? 0) ? 'filled' : 'open', confidence: 'high' });
}

export async function replay36th0930() {
  const run = load36th0930() as unknown as Live36thB;
  return replay36thB({ run, crops: liveCrops0930(run) });
}
