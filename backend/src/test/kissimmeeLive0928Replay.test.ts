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
import { applyReconcileMemberResolution, buildReviewItems, enforcedCounts, reviewItemIsOpen, type ReviewItem } from '../ai/reviewItems';
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

  it('replayed: the pole outlets are no longer multiplied by all six poles — drawn marks only until the poles are typed', (ctx) => {
    if (!have) return ctx.skip();
    expect([count('DUPLEX / FLOOR RECEPTACLE'), count('SIMPLEX'), count('GFCI'), count('WP GFI')]).toEqual([6, 7, 7, 4]);
    const D = 'DUPLEX / FLOOR RECEPTACLE';
    const exp = after.cr.evidence!.expansions.filter(e => e.hostKey === 'PP-1..6');
    expect(exp.map(e => [e.packageId.split('@').pop(), e.deviceKey, e.status, e.expanded])).toEqual([
      ['9#1', D, 'host_unassigned', 0],
      ['9#1', 'SIMPLEX', 'qty_unstated', 0],
      ['9#2', D, 'host_unassigned', 0],
      ['9#3', D, 'host_unassigned', 0],
      ['9#4', 'SIMPLEX', 'host_unassigned', 0],
      ['9#4', D, 'host_unassigned', 0],
      ['9#5', D, 'host_unassigned', 0],
    ]);
    expect(exp.every(e => e.expanded === 0)).toBe(true);
    // The display baseflex stays an assembly (untouched).
    expect(after.cr.evidence!.expansions.filter(e => e.hostKey === 'FLEX J').map(e => e.status)).toEqual(['assembly', 'assembly']);
  });

  it('ONE blocking item: 6 power poles, 5 pole types in #9 — assign a type to each pole; the suggestion is shown, never counted', (ctx) => {
    if (!have) return ctx.skip();
    const items = after.review.filter(i => i.id.startsWith('typicalassign:'));
    expect(items.length).toBe(1);
    const it0 = items[0];
    expect(reviewItemIsOpen(it0)).toBe(true);
    expect(it0.group).toBe('typical');
    expect(it0.title).toBe('6 power poles, 5 power pole types in #9 POWER POLE LEGEND — assign a type to each power pole');
    // The five per-pole "same outlet on two sheets?" questions are gone (nothing was expanded).
    expect(after.review.filter(i => i.id.startsWith('typicalat:')).length).toBe(0);
    expect(it0.reconcileMembers!.map(m => [m.key, m.currentQty])).toEqual([
      ['#1 Office area power pole', 0], ['#2 Checkout counter power pole', 0], ['#3 Parts pod power pole', 0],
      ['#4 Test station power pole', 0], ['#6 Commercial counter power pole', 0],
    ]);
    // Suggested from the drawing analysis's own PP-1..6 note (AI-read):
    // office 1, checkout 1, 2 parts pods, tester 1, counter 1 = 6.
    expect(it0.hostAssignment!.members.map(m => m.suggested)).toEqual([1, 1, 2, 1, 1]);
    expect(it0.detail).toContain('SUGGESTION ONLY — not counted');
    expect(it0.detail).toContain('AI-read, not a schedule');
    // Never counted before an answer.
    const e0 = enforcedCounts(after.cr, after.review).byType;
    expect([e0.get('DUPLEX / FLOOR RECEPTACLE'), e0.get('SIMPLEX')]).toEqual([6, 7]);
    // eslint-disable-next-line no-console
    console.log(`[typicalassign] ${it0.title}\n${it0.detail}`);
  });

  it('human confirmation expands it, type by type (the suggestion accepted: duplex 6 + 8, simplex 7 + 1; receptacles 33)', (ctx) => {
    if (!have) return ctx.skip();
    let item = after.review.find(i => i.id.startsWith('typicalassign:'))!;
    for (const m of item.hostAssignment!.members) {
      item = applyReconcileMemberResolution(item, m.key, m.suggested ? { action: 'count', qty: m.suggested } : { action: 'confirm', reason: 'none of this type on the plans' }, 'Jake');
      if (m !== item.hostAssignment!.members[item.hostAssignment!.members.length - 1]) expect(reviewItemIsOpen(item)).toBe(true);
    }
    expect(reviewItemIsOpen(item)).toBe(false);
    const review = after.review.map(i => (i.id === item.id ? item : i));
    const byType = enforcedCounts(after.cr, review).byType;
    expect([byType.get('DUPLEX / FLOOR RECEPTACLE'), byType.get('SIMPLEX'), byType.get('GFCI'), byType.get('WP GFI')]).toEqual([14, 8, 7, 4]);
    const confirmed = { ...after.cr, types: after.cr.types.map(t => (byType.has(t.key) && byType.get(t.key) != null ? { ...t, count: byType.get(t.key)! } : t)) };
    const d = diffAgainstExpected(expected, confirmed);
    expect(d.rows.find(r => r.id === 'receptacles_total')!.actual).toBe(33);
    // eslint-disable-next-line no-console
    console.log(`AFTER the suggested assignment is CONFIRMED by the estimator\n${formatDiffTable(d)}`);
  });

  it('nothing that passed regresses: A/B/M/C/G, site poles 3 / heads 4, chargers 5, RTU 2', (ctx) => {
    if (!have) return ctx.skip();
    const before = diffAgainstExpected(expected, live.countResult as unknown as CountResult);
    const now = diffAgainstExpected(expected, after.cr);
    for (const r of before.rows.filter(x => x.verdict === 'pass')) {
      const n = now.rows.find(x => x.id === r.id)!;
      expect([n.id, n.verdict, n.actual], r.id).toEqual([r.id, 'pass', r.actual]);
    }
    expect(now.rows.find(r => r.id === 'receptacles_total')!.delta).toBe(-14);
  });
});
