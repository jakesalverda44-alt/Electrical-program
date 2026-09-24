// Real-run fix round — THE acceptance test: the live Opus 5.5 run of AutoZone
// #10077 Kissimmee (2026-09-24) replayed through the fixed code. Every input
// is that run's own output (fixtures/realrun/replay.ts says exactly how);
// nothing is transcribed and no model is called.
import { describe, it, expect, beforeAll } from 'vitest';
import { loadKissimmeeLive, liveBlocking, LIVE_PLAN_FILE } from './fixtures/realrun/kissimmeeLive';
import { replayPdfs, replayEvidenceCache, replayCounter, liveCounterMarks, liveAgent1Input, isCounterRequest, REPLAY_COUNTER_MODEL, type ReplayMark } from './fixtures/realrun/replay';
import { fakeAnthropic, userText, type FakeRequest } from './fixtures/takeoff/fakeAnthropic';
import { loadKissimmeeBaseline } from './fixtures/evidence/kissimmeeBaseline';
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
import { usageCost } from '../eval/takeoffEval';

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

/** The consistency pass's second read: the EARLIER real Opus run of the
 *  same drawings (bid d9abdb87, the evidence round's baseline) — every mark
 *  it placed on E-3. A real second reading of the same sheet, though not one
 *  made on the shifted tile grid (no model can be called here). */
export function secondPassMarks(): ReplayMark[] {
  return loadKissimmeeBaseline().marks.filter(m => m.sheetKey.endsWith('#51')).map(m => ({ ...m }));
}

export async function replayLive(): Promise<LiveReplay> {
  const run = loadKissimmeeLive();
  const keys = keyMap();
  const first = replayCounter(run, liveCounterMarks(run), keys);
  const second = replayCounter(run, secondPassMarks(), keys);
  const gf = gapFillResponder();
  const { client, calls } = fakeAnthropic(req => (isCounterRequest(req) ? (userText(req).includes('CONSISTENCY PASS') ? second(req) : first(req))
    : isGapFillRequest(req) ? gf(req)
    : (() => { throw new Error(`unexpected model call: ${JSON.stringify(req.system).slice(0, 120)}`); })()));
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

const groupOfLive = (i: { group?: string; id: string }) => i.group ?? (i.id.startsWith('refsheet:') ? 'refsheets' : 'other');
const groupOfAfter = (i: ReviewItem) => i.group ?? (i.id.startsWith('refsheet:') ? 'refsheets' : 'other');
function table(items: Array<{ id: string; group?: string; blocking?: boolean }>, groupOf: (i: never) => string, open: (i: never) => boolean) {
  const out: Record<string, [number, number]> = {};
  for (const i of items) {
    const g = groupOf(i as never);
    out[g] = out[g] ?? [0, 0];
    if (open(i as never)) out[g][0]++;
    out[g][1]++;
  }
  return out;
}

describe('the live Kissimmee run, replayed through the fixed code — the review list', () => {
  it('replay fidelity: the fixed code gets the live run\'s own counts where nothing was fixed', (ctx) => {
    if (!have) return ctx.skip();
    const liveT = (k: string) => live.countResult.types.find(t => t.key === k)!.count;
    const t = (k: string) => after.cr.types.find(x => x.key === k)!;
    for (const k of ['A', 'B', 'M', 'C', 'G', 'E', 'F', 'J', 'D', 'L', 'S1', 'S2', 'GFCI', 'WP GFI', 'FLEX+J', 'M1', 'MOTION SENSOR', 'BATTERY CHARGER', 'DISCON A', 'DISCON B', 'MINI-TUNE']) {
      expect(t(k).count, k).toBe(liveT(k));
    }
    expect([t('A').count, t('B').count, t('M').count, t('C').count, t('G').count]).toEqual([70, 45, 6, 2, 10]);
  });

  it('blocking 46 -> 14 (goal <= 15), 53 -> 23 items; before / after per group printed', (ctx) => {
    if (!have) return ctx.skip();
    const before = table(live.reviewItems, groupOfLive as never, ((i: { blocking?: boolean }) => i.blocking !== false) as never);
    const now = table(after.review, groupOfAfter as never, reviewItemIsOpen as never);
    const groups = [...new Set([...Object.keys(before), ...Object.keys(now)])];
    // eslint-disable-next-line no-console
    console.log(['GROUP              BEFORE (blocking/total)   AFTER (blocking/total)',
      ...groups.map(g => `${g.padEnd(18)} ${`${before[g]?.[0] ?? 0}/${before[g]?.[1] ?? 0}`.padStart(8)}                  ${`${now[g]?.[0] ?? 0}/${now[g]?.[1] ?? 0}`.padStart(6)}`),
      `TOTAL              ${`${liveBlocking(live).length}/${live.reviewItems.length}`.padStart(8)}                  ${`${after.review.filter(reviewItemIsOpen).length}/${after.review.length}`.padStart(6)}`,
      ...after.review.map(i => `  ${reviewItemIsOpen(i) ? 'B' : 'i'} ${i.id} — ${i.title}`),
    ].join('\n'));
    expect([liveBlocking(live).length, live.reviewItems.length]).toEqual([46, 53]);
    const blocking = after.review.filter(reviewItemIsOpen);
    expect(blocking.length).toBeLessThanOrEqual(15);
    expect(blocking.length).toBe(14);
    expect(after.review.length).toBe(23);
    expect(blocking.map(i => i.id).sort()).toEqual([
      'consistency:A+B',
      'count:AIM', 'count:CF', 'count:CT/SERVICE CABINET', 'count:DATA CONC', 'count:METER BASE', 'count:QC', 'count:T-1/T-2', 'count:WIREWAY',
      after.review.find(i => i.id.startsWith('legend-zero:'))!.id,
      'scope:disconnects', 'scope:lighting', 'scope:panels',
      'unscheduled:LIGHT-POLE-CONCRETE-BASE-W-ANCHOR-BOLTS-PH0-1',
    ].sort());
  });

  it('nothing real is hidden: every zero-count equipment type is its own item; the group holds no equipment; every alias is kept with its reason', (ctx) => {
    if (!have) return ctx.skip();
    const zeroEquipment = after.cr.types.filter(t => t.status === 'zero' && t.category === 'equipment');
    for (const t of zeroEquipment) expect(after.review.find(i => i.id === `count:${t.key}`), t.key).toBeTruthy();
    const group = after.review.find(i => i.id.startsWith('legend-zero:'))!;
    const typeOf = (k: string) => after.cr.types.find(t => t.key === k)!;
    expect(group.groupedTypes!.every(g => typeOf(g.key).category !== 'equipment')).toBe(true);
    expect(group.groupedTypes!.map(g => g.key).sort()).toEqual(['DUPLEX RECEPTACLE, SHALLOW 2X4 HANDY BOX', 'K', 'M2', 'N', 'PHOTOCELL SENSOR', 'QUADPLEX', 'STORE OPEN/CLOSE PUSHBUTTON']);
    // Every alias is on the list, merged, with the entity it belongs to.
    const merged = after.cr.types.filter(t => t.status === 'merged');
    for (const k of ['RTU', 'RTU-1/RTU-2', 'ALC', 'LCP', 'LIGHTING CONTACTOR ENCLOSURE', 'PYLON', 'SIGN', 'SIGN-JB', 'POWER POLES', 'PP', 'P', 'DUPLEX', 'EWH', 'EF', 'T']) {
      const m = merged.find(t => t.key === k);
      expect(m, k).toBeTruthy();
      expect(m!.mergedInto, k).toBeTruthy();
      expect(m!.reason.length, k).toBeGreaterThan(10);
    }
    // The equipment the live run left at zero because a synonym made its
    // schedule row ambiguous is now counted FROM the row (evidence kept).
    for (const [k, q] of [['ALC PANEL', 1], ['WH', 1], ['FRONT WALL SIGN', 1], ['SIDE WALL SIGN', 2], ['PYLON SIGN', 1]] as const) {
      expect(typeOf(k).count, k).toBe(q);
      expect(typeOf(k).scheduleRows!.length, k).toBeGreaterThan(0);
    }
    expect(typeOf('ALC PANEL').aliases!.map(a => a.key).sort()).toEqual(['ALC', 'LCP', 'LIGHTING CONTACTOR ENCLOSURE']);
    // The information items stay visible.
    for (const id of ['count:EXHAUST FAN RECESSED (AUTOZONE FURN, HVAC INSTALL, EC WIRE)', 'refsheet:SGN101']) {
      const i = after.review.find(x => x.id === id)!;
      expect(i, id).toBeTruthy();
      expect(i.blocking).toBe(false);
    }
    expect(after.review.find(i => i.id.startsWith('typicalheads:'))!.blocking).toBe(false);
  });

  it('RTU = 2, never 4; every quantity has a single source', (ctx) => {
    if (!have) return ctx.skip();
    const t = (k: string) => after.cr.types.find(x => x.key === k)!;
    expect([t('RTU-1').count, t('RTU-2').count, t('RTU-1/RTU-2').count, t('RTU').count]).toEqual([1, 1, 0, 0]);
    expect(live.countResult.types.filter(x => /^RTU/.test(x.key)).reduce((n, x) => n + x.count, 0)).toBe(4);
    // Agent 1's own RTU row is replaced by the entity's lines, never stacked.
    expect(after.cr.removedRows.find(r => String(r.row.item).startsWith('60/3 RTU circuits'))!.reason).toMatch(/type RTU-1/);
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

describe('real-run fix 5 — dense-sheet consistency: a second pass on a shifted tile grid, reconciled by location', () => {
  it('E-3: A 70 / 73 and B 45 / 52 — the marks both passes found are counted, the rest suggested; agreement reported', (ctx) => {
    if (!have) return ctx.skip();
    const c = after.cr.evidence!.consistency!;
    expect(c.entries.map(e => [e.sheetLabel.split(' ')[0], e.typeKey, e.why, e.first, e.second, e.agreed, e.onlyFirst, e.onlySecond, e.agreement])).toEqual([
      ['E-3', 'A', 'high count', 70, 73, 70, 0, 3, 0.959],
      ['E-3', 'B', 'high count', 45, 52, 45, 0, 7, 0.865],
    ]);
    // Never auto-counted: A and B stay at the marks both passes found.
    const t = (k: string) => after.cr.types.find(x => x.key === k)!;
    expect([t('A').count, t('B').count]).toEqual([70, 45]);
    expect(c.suggested.length).toBe(10);
    expect(c.suggested.every(s => s.pass === 'second' && s.sheetKey.endsWith('#51'))).toBe(true);
    // One review item for the check, answered type by type.
    const item = after.review.find(i => i.id === 'consistency:A+B')!;
    expect(reviewItemIsOpen(item)).toBe(true);
    expect(item.reconcileMembers!.map(m => [m.key, m.currentQty])).toEqual([['A', 70], ['B', 45]]);
    expect(item.detail).toContain('Type A: first pass 70, second pass (shifted tiles) 73, both found 70 (96% agree)');
    // Bounded: one extra counter call, only A and B, only the shifted tiles
    // over their marks (E-3's building area), no other sheet.
    const second = after.calls.filter(r => isCounterRequest(r) && userText(r).includes('CONSISTENCY PASS'));
    expect(second.length).toBe(1);
    const targetBlock = userText(second[0]).split('COUNT TARGETS')[1].split('\n\n')[0];
    expect(targetBlock.split('\n').filter(l => /^- /.test(l)).map(l => l.slice(2).split(' | ')[0])).toEqual(['A', 'B']);
    expect(c.tiles).toBe(4); // of the shifted grid's 20: only those over the A / B marks
    // eslint-disable-next-line no-console
    console.log(`[consistency] tiles ${c.tiles}, calls ${c.calls}, usage ${JSON.stringify(c.usage)}, est $${usageCost(c.usage, REPLAY_COUNTER_MODEL)!.toFixed(3)} on ${REPLAY_COUNTER_MODEL}`);
  });
});
