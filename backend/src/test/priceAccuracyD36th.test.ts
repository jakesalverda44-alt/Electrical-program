// Price accuracy round D1-D4 — the LATEST live 36th Street run (2026-09-29b)
// replayed through the counting stage. See fixtures/realrun/replay36thB.ts
// for what is real (every live mark, status, rule and title) and what is a
// MOCKED model answer (the close-up status check, the "marked for removal"
// flag).
import { describe, it, expect, beforeAll } from 'vitest';
import { replay36thB, chrisCrops, isStatusCrop } from './fixtures/realrun/replay36thB';
import { userText } from './fixtures/takeoff/fakeAnthropic';
import { applyReconcileMemberResolution, carryOverResolutions, enforcedCounts } from '../ai/reviewItems';
import { isPdftoppmAvailable } from '../ai/documentPrep';

type R = Awaited<ReturnType<typeof replay36thB>>;
let have = false;
let now: R;
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  now = await replay36thB();
}, 300_000);

const count = (r: R, k: string) => r.stage.countResult.types.find(t => t.key === k)!;

describe('D1 — E1.0\'s receptacle rule no longer applies to other symbols', () => {
  it('the 9 "could not be told new or existing" items on non-receptacles are gone; their counts are unchanged', (ctx) => {
    if (!have) return ctx.skip();
    const live = now.run.reviewItems.filter(i => i.id.startsWith('status:')).map(i => i.id);
    expect(live).toEqual(['status:DISCONNECT', 'status:$', 'status:ELECTRICAL PANEL', 'status:AHU #1', 'status:COMP #1', 'status:COMP #2', 'status:DISC-A', 'status:DISC-B', 'status:TRIANGLE']);
    expect(now.review.filter(i => i.id.startsWith('status:'))).toEqual([]);
    for (const [k, n] of [['DISCONNECT', 4], ['ELECTRICAL PANEL', 2], ['$', 9], ['AHU #1', 1], ['COMP #1', 1], ['COMP #2', 1], ['DISC-A', 1], ['DISC-B', 1], ['TRIANGLE', 1]] as const) {
      expect([k, count(now, k).count]).toEqual([k, n]);
    }
    expect(now.stage.countResult.remodel!.unknownStatus).toEqual([]);
    const so = now.stage.countResult.remodel!.scopedOut!;
    expect(so.map(s => [s.label, s.count, s.scope])).toEqual([['E1.0 "Electrical Plan"', 15, 'receptacle']]);
  });
});

describe('D2 — receptacle status by close-up crop check (answers MOCKED: see chrisCrops)', () => {
  it('E1.0\'s fill rule: every receptacle mark (26) is crop-checked in 3 calls on the evidence model, with the power legend', (ctx) => {
    if (!have) return ctx.skip();
    const crops = now.calls.filter(isStatusCrop);
    expect(crops.length).toBe(3);
    expect(crops.every(c => c.model === 'claude-opus-5-5')).toBe(true);
    const text = crops.map(userText).join('\n');
    expect((text.match(/CROP c\d+ — type /g) ?? []).length).toBe(26);
    expect(text).toContain('PRINTED RULE: "SHADED SYMBOL DENOTES NEW RECEPTICLE" (new)');
    expect(text).toContain('FILLED (shaded / solid) or OPEN');
    const images = crops.flatMap(c => (c.messages[0].content as Array<{ type: string }>).filter(b => b.type === 'image')).length;
    expect(images).toBe(26 + 3); // one legend per call
    const sc = now.stage.countResult.remodel!.statusCrops!;
    expect([sc.calls, sc.crops, sc.capped, sc.errors]).toEqual([3, 26, 0, []]);
  });
  it('the result (Chris: 5 new duplex + 2 GFCI): duplex 1 → 5, WP GFCI 0 → 2; the rest listed as existing, never priced', (ctx) => {
    if (!have) return ctx.skip();
    expect(['DUPLEX RECEPTACLE', 'GFI', '42', 'WP'].map(k => [count(now, k).count, count(now, k).existingMarks ?? 0])).toEqual([[5, 9], [0, 7], [0, 3], [2, 0]]);
    expect(now.review.find(i => i.id === 'remodel:existing')!.title).toBe('19 existing devices shown on the plans — listed, never priced');
    expect(now.review.some(i => i.id === 'statuscrop:low')).toBe(false);
  });
  it('low-confidence answers: counted as new for now, ONE review item listing them; the answer (type by type) is enforced and carried over', async (ctx) => {
    if (!have) return ctx.skip();
    const r = await replay36thB({ crops: m => (m.typeKey === 'GFI' && m.index < 2) || (m.typeKey === 'DUPLEX RECEPTACLE' && m.index === 9) ? { answer: 'open', confidence: 'low' } : chrisCrops(m) });
    expect([count(r, 'DUPLEX RECEPTACLE').count, count(r, 'GFI').count]).toEqual([6, 2]);
    const items = r.review.filter(i => i.id.startsWith('statuscrop:') || i.id.startsWith('status:'));
    expect(items.map(i => i.id)).toEqual(['statuscrop:low']);
    const it0 = items[0];
    expect(it0.title).toBe('3 symbols could not be told new or existing, even close up');
    expect(it0.blocking).not.toBe(false);
    expect(it0.reconcileMembers!.map(m => [m.key, m.currentQty])).toEqual([['GFI', 2], ['DUPLEX RECEPTACLE', 6]]);
    let answered = applyReconcileMemberResolution(it0, 'GFI', { action: 'count', qty: 0, reason: 'both open on the plans' }, 'Jake');
    answered = applyReconcileMemberResolution(answered, 'DUPLEX RECEPTACLE', { action: 'confirm', reason: 'the breakroom one is new', qty: 6 }, 'Jake');
    const e = enforcedCounts(r.stage.countResult, [answered]);
    expect([e.byType.get('GFI'), e.byType.get('DUPLEX RECEPTACLE')]).toEqual([0, 6]);
    // a re-run with the same answers from the check: the member answers carry over
    const again = carryOverResolutions(r.review, r.review.map(i => (i.id === answered.id ? answered : i)));
    const c = again.find(i => i.id === 'statuscrop:low')!;
    expect(c.reconcileMembers!.map(m => m.resolution?.action)).toEqual(['count', 'confirm']);
  });
  it('a failed close-up call: its marks are left for review (counted as new), the run completes', async (ctx) => {
    if (!have) return ctx.skip();
    const r = await replay36thB({ crops: () => ({ answer: 'unclear', confidence: 'low' }) });
    expect(r.review.find(i => i.id === 'statuscrop:low')!.title).toBe('26 symbols could not be told new or existing, even close up');
    expect(count(r, 'DUPLEX RECEPTACLE').count).toBe(14);
  });
  it('"all new" answered: no close-up check at all', async (ctx) => {
    if (!have) return ctx.skip();
    const r = await replay36thB({ remodel: { buildType: null, answer: 'All devices on these plans are new — count everything' } });
    expect(r.calls.filter(isStatusCrop)).toEqual([]);
  });
});
