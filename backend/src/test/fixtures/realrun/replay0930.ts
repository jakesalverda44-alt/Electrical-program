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
import { loadKissimmeeLive0928 } from './kissimmeeLive';
import { replayPdfs, replayEvidenceCache, replayCounter, liveCounterMarks, liveAgent1Input, isCounterRequest, REPLAY_COUNTER_MODEL, type ReplayMark } from './replay';
import { replay36thB, type CropPolicy, type Live36thB } from './replay36thB';
import { fakeAnthropic, userText, type FakeRequest } from '../takeoff/fakeAnthropic';
import { gapFillResponder, isGapFillRequest } from '../evidence/kissimmeeReplies';
import { runCountingStage, type CountResult, type CountingStageInput } from '../../../ai/countingStage';
import { buildCountTargets } from '../../../ai/countTargets';
import { consolidateTargets } from '../../../ai/evidence/consolidate';
import { buildReviewItems, type ReviewItem } from '../../../ai/reviewItems';
import { DEFAULT_EVIDENCE_MODEL } from '../../../routes/preconstruction';
import type { InventoryPage } from '../../../ai/countSheets';
import type { KissimmeeLiveRun } from './kissimmeeLive';

/** Accuracy round B — SCRIPTED (cross-run, labelled): the PP-1..6 marks the
 *  live counter placed on E-2 on 2026-09-28, when it WAS asked for the poles
 *  (the same sheet of the same plan set; 6 on the main plan + 2 the
 *  enlarged-plan rule excluded). The 09-30 run never asked (PP-1..6 was
 *  schedule-owned), so its own marks hold none — this is what the counter
 *  gives when asked, not a hand measurement. `tags` (SCRIPTED too) puts a
 *  read hexagon number on the i-th mark ("#n" in the circuit field). */
export function scriptedPoleMarks0928(tags: Record<number, string> = {}): ReplayMark[] {
  const run28 = loadKissimmeeLive0928();
  return liveCounterMarks(run28).filter(m => m.typeKey === 'PP-1..6' && m.sheetKey.endsWith('#50'))
    .map((m, i) => (tags[i] ? { ...m, circuit: `#${tags[i]}${m.circuit ? ` ${m.circuit}` : ''}` } : m));
}

export async function replayKissimmee0930(opts: { extraMarks?: ReplayMark[]; /** Level 2 learning — the counter's prefix. */ learning?: CountingStageInput['learning'] } = {}): Promise<{ cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] }> {
  const run = loadKissimmeeLive0930() as unknown as KissimmeeLiveRun;
  const cons = consolidateTargets(buildCountTargets(run.agent1).targets);
  const keys = (k: string): string | null => {
    const t = cons.targets.find(x => x.key === k);
    if (!t) return k;
    if (!t.mergedInto?.length || t.role === 'host') return k;
    return cons.aliasOf.get(k) ?? null;
  };
  const marks = [...liveCounterMarks(run), ...(opts.extraMarks ?? [])];
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
    ...(opts.learning ? { learning: opts.learning } : {}),
  });
  return { cr: stage.countResult, review: buildReviewItems(stage.countResult), calls };
}

/** The live close-up verdicts, per type (first `asNew` marks filled). */
export function liveCrops0930(run: Live36thB): CropPolicy {
  const checked = ((run.countResult.remodel as unknown as { statusCrops?: { checked?: Array<{ typeKey: string; asNew: number }> } }).statusCrops?.checked) ?? [];
  const asNew = new Map(checked.map(c => [c.typeKey, c.asNew]));
  return m => ({ answer: m.index < (asNew.get(m.typeKey) ?? 0) ? 'filled' : 'open', confidence: 'high' });
}

export async function replay36th0930(opts: { learning?: CountingStageInput['learning'] } = {}) {
  const run = load36th0930() as unknown as Live36thB;
  return replay36thB({ run, crops: liveCrops0930(run), ...(opts.learning ? { learning: opts.learning } : {}) });
}
