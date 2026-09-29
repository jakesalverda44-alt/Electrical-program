// Fix round S5 — the 2026-09-28 replay, shared by the replay test and the
// route test (so the REAL assignment item goes through /review/resolve).
// See kissimmeeLive0928Replay.test.ts for what is and is not replayed.
import { loadKissimmeeLive0928 } from './kissimmeeLive';
import { replayPdfs, replayEvidenceCache, replayCounter, liveCounterMarks, liveAgent1Input, isCounterRequest, REPLAY_COUNTER_MODEL } from './replay';
import { fakeAnthropic, userText, type FakeReply, type FakeRequest } from '../takeoff/fakeAnthropic';
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

/** Fix round B1 / B2 — `inventory` edits the page inventory (the reviewer's
 *  V0.1 rename); `statusEvery` makes the counter tag every Nth mark
 *  "existing" whenever the sheet note asks for a STATUS (a model that
 *  labels dashed / light-line items existing, with no printed rule). */
export async function replay0928(opts: { remodel?: { buildType?: string | null; answer?: string | null }; inventory?: (inv: InventoryPage[]) => InventoryPage[]; statusEvery?: number } = {}): Promise<{ cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] }> {
  const run = loadKissimmeeLive0928();
  const keys = keyMap();
  const marks = liveCounterMarks(run);
  const first = replayCounter(run, marks, keys);
  const second = replayCounter(run, marks.filter(m => m.sheetKey.endsWith('#51')), keys);
  const gf = gapFillResponder();
  const tag = (req: FakeRequest, r: FakeReply | Promise<FakeReply>) => Promise.resolve(r).then(rep => {
    if (!opts.statusEvery || !userText(req).includes('STATUS (remodel job)')) return rep;
    const j = JSON.parse(rep.text) as { marks: unknown[][] };
    j.marks = j.marks.map((m, i) => [...m.slice(0, 5), ...Array(Math.max(0, 5 - m.length)).fill(''), i % opts.statusEvery! === 0 ? 'existing' : 'new']);
    return { ...rep, text: JSON.stringify(j) };
  });
  const { client, calls } = fakeAnthropic(req => (isCounterRequest(req) ? tag(req, userText(req).includes('CONSISTENCY PASS') ? second(req) : first(req))
    : isGapFillRequest(req) ? gf(req)
    : (() => { throw new Error(`unexpected model call: ${JSON.stringify(req.system).slice(0, 120)}`); })()));
  const stage = await runCountingStage({
    client, model: REPLAY_COUNTER_MODEL, maxTokens: 32000,
    agent1: liveAgent1Input(run), inventory: (opts.inventory ?? (x => x))(run.inventory as InventoryPage[]), pdfs: await replayPdfs(),
    evidence: { model: DEFAULT_EVIDENCE_MODEL, maxTokens: 16000, cache: replayEvidenceCache(run) },
    // Remodel round — the pipeline always passes this; a new build ignores it.
    ...(opts.remodel ? { remodel: opts.remodel } : {}),
  });
  return { cr: stage.countResult, review: buildReviewItems(stage.countResult), calls };
}

