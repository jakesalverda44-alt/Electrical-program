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
import type { FakeRequest } from './fixtures/takeoff/fakeAnthropic';
import { replay0928 } from './fixtures/realrun/replay0928';
import type { CountResult } from '../ai/countingStage';
import { applyReconcileMemberResolution, enforcedCounts, reviewItemIsOpen, type ReviewItem } from '../ai/reviewItems';
import { NOT_A_HOST } from '../ai/evidence/typicals';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import { diffAgainstExpected, formatDiffTable, validateExpectedFile } from '../eval/takeoffEval';

const live = loadKissimmeeLive0928();
const expected = validateExpectedFile(JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/autozone-10077-kissimmee.expected.json'), 'utf8')));

let have = false;
let after: { cr: CountResult; review: ReviewItem[]; calls: FakeRequest[] };
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (have) after = await replay0928();
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
      // Accuracy round B4 — the schedule rows of the #1 office / #4 tester
      // pole types fold into PP-1..6 (were zero-count items).
      if (t.key === 'PP-TEST' || t.key === 'PP-OFFICE/CCTV') {
        expect(after.cr.types.find(x => x.key === t.key)).toMatchObject({ count: 0, status: 'merged' });
        continue;
      }
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

  it('ONE blocking item: 6 power poles found, 5 pole types in #9 — accuracy round B3: asked POLE by pole (none bound: no tag read); the suggestion is shown, never counted', (ctx) => {
    if (!have) return ctx.skip();
    const items = after.review.filter(i => i.id.startsWith('typicalassign:'));
    expect(items.length).toBe(1);
    const it0 = items[0];
    expect(reviewItemIsOpen(it0)).toBe(true);
    expect(it0.group).toBe('typical');
    expect(it0.title).toBe('6 power poles found on the plans, 5 power pole types in #9 POWER POLE LEGEND — assign a type to each power pole');
    // The five per-pole "same outlet on two sheets?" questions are gone (nothing was expanded).
    expect(after.review.filter(i => i.id.startsWith('typicalat:')).length).toBe(0);
    expect(it0.reconcileMembers!.map(m => m.key)).toEqual(['pole:E-2:1', 'pole:E-2:2', 'pole:E-2:3', 'pole:E-2:4', 'pole:E-2:5', 'pole:E-2:6']);
    expect(it0.options).toEqual(['tag:1', 'tag:2', 'tag:3', 'tag:4', 'tag:6', NOT_A_HOST]);
    // Each pole carries its place on E-2 (the jump to the mark).
    expect(it0.hostAssignment!.perPole!.poles.every(p => p.pdf?.sheetKey.endsWith('#50'))).toBe(true);
    // Suggested from the drawing analysis's own PP-1..6 note (AI-read):
    // office 1, checkout 1, 2 parts pods, tester 1, counter 1 = 6.
    expect(it0.hostAssignment!.members.map(m => m.suggested)).toEqual([1, 1, 2, 1, 1]);
    expect(it0.detail).toContain('SUGGESTION ONLY — not counted');
    expect(it0.detail).toContain('AI-read, not a schedule');
    // Never counted before an answer.
    const e0 = enforcedCounts(after.cr, after.review).byType;
    expect([e0.get('DUPLEX / FLOOR RECEPTACLE'), e0.get('SIMPLEX')]).toEqual([6, 7]);
    // Accuracy round B4 — no zero items for the office / tester schedule rows, no synonym question.
    expect(after.review.some(i => i.id === 'count:PP-TEST' || i.id === 'count:PP-OFFICE/CCTV' || i.id === 'synonym:PP-1..6')).toBe(false);
    // eslint-disable-next-line no-console
    console.log(`[typicalassign] ${it0.title}\n${it0.detail}`);
  });

  it('human confirmation expands it, pole by pole (the suggestion accepted: duplex 6 + 8, simplex 7 + 1; receptacles 33)', (ctx) => {
    if (!have) return ctx.skip();
    let item = after.review.find(i => i.id.startsWith('typicalassign:'))!;
    // The suggestion (office 1, checkout 1, parts pod 2, tester 1, counter 1), one type per pole.
    const answers = ['tag:1', 'tag:2', 'tag:3', 'tag:3', 'tag:4', 'tag:6'];
    item.reconcileMembers!.forEach((m, i) => {
      item = applyReconcileMemberResolution(item, m.key, { action: 'answer', answer: answers[i] }, 'Jake');
      if (i < answers.length - 1) expect(reviewItemIsOpen(item)).toBe(true);
    });
    expect(reviewItemIsOpen(item)).toBe(false);
    const review = after.review.map(i => (i.id === item.id ? item : i));
    const byType = enforcedCounts(after.cr, review).byType;
    expect([byType.get('DUPLEX / FLOOR RECEPTACLE'), byType.get('SIMPLEX'), byType.get('GFCI'), byType.get('WP GFI')]).toEqual([14, 8, 7, 4]);
    // The poles themselves: all six kept (none answered "not a power pole").
    expect(byType.get('PP-1..6') ?? 6).toBe(6);
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
