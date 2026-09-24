// Real-run fix round — THE acceptance test: the live Opus 5.5 run of AutoZone
// #10077 Kissimmee (2026-09-24) replayed through the fixed code. Every input
// is that run's own output (fixtures/realrun/replay.ts says exactly how);
// nothing is transcribed and no model is called.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadKissimmeeLive, liveBlocking, LIVE_PLAN_FILE } from './fixtures/realrun/kissimmeeLive';
import { replayPdfs, replayEvidenceCache, replayCounter, liveCounterMarks, liveAgent1Input, isCounterRequest, REPLAY_COUNTER_MODEL } from './fixtures/realrun/replay';
import { fakeAnthropic, type FakeRequest } from './fixtures/takeoff/fakeAnthropic';
import { gapFillResponder, isGapFillRequest } from './fixtures/evidence/kissimmeeReplies';
import { runCountingStage, type CountResult } from '../ai/countingStage';
import { buildCountTargets } from '../ai/countTargets';
import { consolidateTargets } from '../ai/evidence/consolidate';
import { buildReviewItems, referencedSheetItems, reviewItemIsOpen, type ReviewItem } from '../ai/reviewItems';
import { learnSheetPattern, normalizeSheetId } from '../ai/sheetRefs';
import { resolveAccountTerms } from '../bidstd/accountRules';
import { scopeQuestionsFor } from '../bidstd/accountRulesDb';
import { AUTOZONE_SEED } from './fixtures/bidstd/kissimmeeProposal';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { DEFAULT_EVIDENCE_MODEL } from '../routes/preconstruction';
import type { InventoryPage } from '../ai/countSheets';

const live = loadKissimmeeLive();

export interface LiveReplay { cr: CountResult; review: ReviewItem[]; calls: FakeRequest[]; usage: { input_tokens: number; output_tokens: number } }

/** Live key -> the key the fixed code asks the counter for. */
function keyMap() {
  const cons = consolidateTargets(buildCountTargets(live.agent1).targets);
  return (k: string): string | null => {
    const t = cons.targets.find(x => x.key === k);
    if (!t) return k;
    if (!t.mergedInto?.length || t.role === 'host') return k;
    return cons.aliasOf.get(k) ?? null;
  };
}

export async function replayLive(extra: { secondPass?: Parameters<typeof replayCounter>[1] } = {}): Promise<LiveReplay> {
  const run = loadKissimmeeLive();
  const counter = replayCounter(run, liveCounterMarks(run), keyMap());
  const gf = gapFillResponder();
  const { client, calls } = fakeAnthropic(req => (isCounterRequest(req) ? counter(req)
    : isGapFillRequest(req) ? gf(req)
    : (() => { throw new Error(`unexpected model call: ${JSON.stringify(req.system).slice(0, 120)}`); })()));
  void extra;
  const stage = await runCountingStage({
    client, model: REPLAY_COUNTER_MODEL, maxTokens: 32000,
    agent1: liveAgent1Input(run), inventory: run.inventory as InventoryPage[], pdfs: await replayPdfs(),
    evidence: { model: DEFAULT_EVIDENCE_MODEL, maxTokens: 16000, cache: replayEvidenceCache(run) },
  });
  const cr = stage.countResult;
  const snap = resolveAccountTerms(AUTOZONE_SEED, '"AutoZone" in the brand', run.agent1.furnishStatements as never, false);
  const loaded = new Set(run.inventory.map(p => normalizeSheetId(p.sheetNo)).filter((k): k is string => !!k));
  const review = [
    ...buildReviewItems(cr, scopeQuestionsFor(snap)),
    ...referencedSheetItems(run.agent1.missingSheets, { loadedSheetKeys: loaded, checkRefKeys: new Set() }, normalizeSheetId,
      { pattern: learnSheetPattern(run.inventory.map(p => p.sheetNo)) }),
  ];
  return { cr, review, calls, usage: stage.usage };
}

let have = false;
let after: LiveReplay;
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (have) after = await replayLive();
}, 300_000);

const byGroup = (items: Array<{ group?: string; id: string; blocking?: boolean }>, open: (i: never) => boolean) => {
  const out: Record<string, { blocking: number; total: number }> = {};
  for (const i of items) {
    const g = i.group ?? 'other';
    out[g] = out[g] ?? { blocking: 0, total: 0 };
    out[g].total++;
    if (open(i as never)) out[g].blocking++;
  }
  return out;
};

describe('the live Kissimmee run, replayed through the fixed code', () => {
  it('prints before / after', (ctx) => {
    if (!have) return ctx.skip();
    const t = (k: string) => after.cr.types.find(x => x.key === k);
    // eslint-disable-next-line no-console
    console.log([
      `BEFORE (live): ${live.reviewItems.length} items, ${liveBlocking(live).length} blocking — ${JSON.stringify(byGroup(live.reviewItems, (i: { blocking?: boolean }) => i.blocking !== false))}`,
      `AFTER (replay): ${after.review.length} items, ${after.review.filter(reviewItemIsOpen).length} blocking — ${JSON.stringify(byGroup(after.review, reviewItemIsOpen))}`,
      ...after.review.map(i => `  ${reviewItemIsOpen(i) ? 'B' : 'i'} ${i.id} — ${i.title}`),
      `types: ${after.cr.types.filter(x => x.status !== 'merged').map(x => `${x.key}=${x.count}${x.status !== 'counted' ? `(${x.status})` : ''}${x.components?.typical ? `[+${x.components.typical} typ]` : ''}`).join(', ')}`,
      `merged: ${after.cr.types.filter(x => x.status === 'merged').map(x => `${x.key}->${x.mergedInto}`).join('; ')}`,
      `expansions: ${after.cr.evidence!.expansions.map(e => `${e.status} ${e.hostKey} ${e.deviceKey} ${e.hostCount}x${e.perHost}=${e.expanded}`).join('; ')}`,
      `RTU total: ${(t('RTU-1')?.count ?? 0) + (t('RTU-2')?.count ?? 0)}; file ${LIVE_PLAN_FILE}`,
    ].join('\n'));
  });
});
describe('real-run fix 3 — the power-pole legend packages expand, times the drawn poles', () => {
  it('live: every pole package was an "assembly" of its PP#n type, expanded 0; tester perHost with hostCount null', () => {
    const exp = live.countResult.evidence.expansions.filter(e => /^PP#/.test(e.hostKey));
    expect(exp.map(e => [e.hostKey, e.status, e.expanded])).toEqual([
      ['PP#1', 'assembly', 0], ['PP#1', 'assembly', 0], ['PP#2', 'assembly', 0], ['PP#3', 'assembly', 0],
      ['PP#4', 'assembly', 0], ['PP#4', 'assembly', 0], ['PP#6', 'assembly', 0],
    ]);
    expect(exp.filter(e => e.hostKey === 'PP#4').map(e => e.hostCount)).toEqual([null, null]);
  });

  it('replayed: office 2 duplex (+ simplex drawn on #11), checkout 1, parts pod 1 x 2, tester 1 simplex + 1 duplex, counter 2 — each with its quote', (ctx) => {
    if (!have) return ctx.skip();
    const exp = after.cr.evidence!.expansions.filter(e => /^PP#/.test(e.hostKey));
    const D = 'DUPLEX RECEPTACLE / FLOOR RECEPTACLE';
    expect(exp.map(e => [e.hostKey, e.deviceKey, e.status, e.hostCount, e.perHost, e.drawnAtHosts, e.expanded])).toEqual([
      ['PP#1', D, 'expanded', 1, 2, 0, 2],
      ['PP#1', 'SIMPLEX', 'qty_unstated', 1, 0, 5, 0],
      ['PP#2', D, 'expanded', 1, 1, 0, 1],
      ['PP#3', D, 'expanded', 2, 1, 0, 2],
      ['PP#4', 'SIMPLEX', 'expanded', 1, 1, 0, 1],
      ['PP#4', D, 'expanded', 1, 1, 0, 1],
      ['PP#6', D, 'expanded', 1, 2, 0, 2],
    ]);
    for (const e of exp) expect(e.quote).toMatch(/POWER POLE/);
    // The drawn pole count per type: tags bound by their circuit (PP#2 A29,
    // PP#3 A33 + A35, PP#4 B20,24, PP#6 A40,42), the office pole from its
    // schedule rows (A-30/32/36 feed ONE pole), never a circuit per pole.
    const t = (k: string) => after.cr.types.find(x => x.key === k)!;
    expect(['PP#1', 'PP#2', 'PP#3', 'PP#4', 'PP#5', 'PP#6'].map(k => t(k).count)).toEqual([1, 1, 2, 1, 1, 1]);
    expect(after.cr.evidence!.consolidation!.hostBindings!.map(b => `${b.member}:${b.circuit}`)).toEqual(['PP#3:A33', 'PP#6:A40,42', 'PP#4:B20,24', 'PP#3:A35', 'PP#2:A29']);
    // Pole #2 is drawn on the main plan AND the #11 office plan (same A29): once.
    expect(after.cr.sheets.find(s => s.page === 50)!.excluded!.find(e => e.typeKey === 'PP#2')!.reasons[0]).toMatch(/same PP#2 as on the main plan \(circuit A29\)/);
    // Office pole's floor simplex: not stated per pole, drawn on #11 -> information, counted where drawn.
    const info = after.review.find(i => i.id.includes(':SIMPLEX') && i.id.startsWith('typicalqty:'))!;
    expect(info.blocking).toBe(false);
    // Tester pole: no zero item any more.
    expect(after.review.find(i => i.id === 'count:PP#4')).toBeUndefined();
  });

  it('receptacles 34 (simplex 9, duplex / floor 14, GFCI 7, WP GFI 4) — plausible against Chris\'s 38', (ctx) => {
    if (!have) return ctx.skip();
    const t = (k: string) => after.cr.types.find(x => x.key === k)!;
    const r = { simplex: t('SIMPLEX'), duplex: t('DUPLEX RECEPTACLE / FLOOR RECEPTACLE'), gfci: t('GFCI'), wp: t('WP GFI') };
    expect([r.simplex.count, r.duplex.count, r.gfci.count, r.wp.count]).toEqual([9, 14, 7, 4]);
    expect(r.simplex.components).toEqual({ drawn: 8, typical: 1, schedule: 0 });
    expect(r.duplex.components).toEqual({ drawn: 6, typical: 8, schedule: 0 });
    const total = r.simplex.count + r.duplex.count + r.gfci.count + r.wp.count;
    expect(total).toBe(34);
    // Chris: GFCI 16, duplex 11, single 8, decorator 3 = 38. Duplex +
    // decorator 14 = our 14; single 8 vs our 9; the whole gap is GFCI
    // (11 vs 16) — the open audit question since the evidence round.
    expect(38 - total).toBe(4);
  });
});

describe('real-run fix 4 — no "panel schedules not read completely" item for two panel drawings', () => {
  it('both E-4 panels complete and used for the branch circuits; the E-5 diagram / section are not schedules', (ctx) => {
    if (!have) return ctx.skip();
    expect(live.reviewItems.some(i => i.id === 'schedule:panels-unread')).toBe(true);
    expect(after.cr.evidence!.panelsUnread).toEqual([]);
    expect(after.review.find(i => i.id === 'schedule:panels-unread')).toBeUndefined();
    expect(after.cr.evidence!.circuitRows).toBeGreaterThan(0);
  });
});
