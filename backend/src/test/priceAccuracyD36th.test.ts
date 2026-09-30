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
import { DEMO_UNIT_NAMES } from '../ai/remodel/demolition';

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

describe('D3 — demolition by comparison (A2.0 shows ALL existing devices; E1.0 shows which remain)', () => {
  // The close-up check answers the live run's own statuses here (1 new
  // duplex, 25 existing receptacles), so only D3 moves.
  const liveCrops = (m: { liveStatus: string }) => ({ answer: m.liveStatus === 'new' ? 'filled' : 'open', confidence: 'high' as const });
  let iso: R;
  const line = (r: R, cls: string) => (r.stage.agent1.quantities as Array<Record<string, unknown>>).find(q => q.category === 'Demolition' && q.countType === cls);
  beforeAll(async () => { if (have) iso = await replay36thB({ crops: liveCrops }); }, 300_000);

  it('receptacles: A2.0 40 − 25 still existing at the same place on E1.0 (registered by 36 shared marks) = 15 (Chris 18; live run 40)', (ctx) => {
    if (!have) return ctx.skip();
    expect(now.run.countResult.types.length).toBeGreaterThan(0);
    const c = iso.stage.countResult.remodel!.demolition.comparisons!;
    expect(c.map(x => [x.classKey, x.label.split(' ')[0], x.planLabel.split(' ')[0], x.shown, x.remain, x.demo])).toEqual([['DEMO-RECEPTACLE', 'A2.0', 'E1.0', 40, 25, 15]]);
    expect(c[0].alignment).toMatch(/shared marks agree on an offset of 0\.2\d", -0\.1\d"/);
    expect(line(iso, 'DEMO-RECEPTACLE')).toMatchObject({ qty: 15 });
    expect(String(line(iso, 'DEMO-RECEPTACLE')!.spec)).toContain('25 more on A2.0 still shown as existing on E1.0 — not removed');
    const it = iso.review.find(i => i.id === 'democompare:DEMO-RECEPTACLE')!;
    expect([it.blocking, it.title, it.typeKey, it.aiCount]).toEqual([false, 'Demolition — receptacle: 40 shown on A2.0, 25 still shown as existing on E1.0 → 15 in the line', 'DEMO-RECEPTACLE', 15]);
  });
  it('fixtures (A3.0 vs E2.0, which shows nothing as existing), exit/em and switches keep today\'s counts', (ctx) => {
    if (!have) return ctx.skip();
    expect(['DEMO-FIXTURE', 'DEMO-EXIT', 'DEMO-SWITCH'].map(k => line(iso, k)?.qty)).toEqual([47, 5, 11]);
    expect((iso.stage.countResult.remodel!.demolition.suggestions ?? []).filter(q => !q.unstated)).toEqual([]);
    expect(iso.review.some(i => i.id === 'demosuggest:DEMO-FIXTURE' || i.id === 'demosuggest:DEMO-EXIT')).toBe(false);
  });
  it('switches / disconnects / the phone outlet: E1.0 draws them at the same places WITHOUT a status (D1) — never lowered, asked with the arithmetic', (ctx) => {
    if (!have) return ctx.skip();
    const q = (k: string) => iso.review.find(i => i.id === `demosuggest:${k}`)!;
    expect(['DEMO-SWITCH', 'DEMO-EQUIPMENT', 'DEMO-DEVICE'].map(k => [q(k).keepQty, q(k).sumQty, q(k).blocking])).toEqual([[7, 11, undefined], [0, 10, undefined], [0, 1, undefined]]);
    expect(q('DEMO-EQUIPMENT').detail).toContain('draws 8 of them at the same place without saying whether they are new or existing');
    expect(q('DEMO-EQUIPMENT').detail).toContain('it replaces the "same items or more?" answer');
    expect(['DEMO-SWITCH'].map(k => line(iso, k)?.qty)).toEqual([11]);
  });
  it('with the mocked close-up answers (5 duplex + 2 WP new): 19 remain → 21 (a new device at an old one\'s place replaces it)', (ctx) => {
    if (!have) return ctx.skip();
    expect(line(now, 'DEMO-RECEPTACLE')).toMatchObject({ qty: 21 });
  });
  it('rule (a): receptacles MARKED for removal on A2.0 are removed even where E1.0 shows one at that place', async (ctx) => {
    if (!have) return ctx.skip();
    const r = await replay36thB({ crops: liveCrops, markedOnA2: 40 });
    expect(r.stage.countResult.remodel!.demolition.comparisons![0]).toMatchObject({ shown: 40, marked: 40, remain: 0, demo: 40 });
    expect(line(r, 'DEMO-RECEPTACLE')).toMatchObject({ qty: 40 });
    expect(r.calls.filter(c => userText(c).includes('DEMOLITION SHEET')).every(c => userText(c).includes('"demo" ONLY when the symbol itself is marked for removal'))).toBe(true);
  });
  it('A2.0 cannot be registered (its marks moved 6"): the line keeps 40, ONE blocking suggestion shows the arithmetic 40 − 25 = 15', async (ctx) => {
    if (!have) return ctx.skip();
    const r = await replay36thB({ crops: liveCrops, mutate: run => { for (const m of run.countResult.remodel.marks) if (m.sheetKey.endsWith('#4')) m.y += 430; } });
    expect(line(r, 'DEMO-RECEPTACLE')).toMatchObject({ qty: 40 });
    const q = r.review.find(i => i.id === 'demosuggest:DEMO-RECEPTACLE')!;
    expect([q.blocking, q.title, q.keepQty, q.sumQty]).toEqual([undefined, 'Demolition — receptacle: 40 shown on the demolition plan — how many are removed?', 15, 40]);
    expect(q.detail).toContain('40 shown − 25 still there = 15 removed');
    expect(q.options).toEqual(['Use the suggestion — 15 removed', 'Keep all 40 — every one shown is removed']);
    expect(r.review.some(i => i.id.startsWith('democompare:'))).toBe(false);
  });
});

describe('D4 — every demolition class is a line at its unit (C5 adds the five missing units, names below)', () => {
  it('36th: the disconnect / equipment and "device (other)" classes are Demolition lines now; no "no demolition labor unit" item', (ctx) => {
    if (!have) return ctx.skip();
    const demo = (now.stage.agent1.quantities as Array<Record<string, unknown>>).filter(q => q.category === 'Demolition');
    expect(demo.map(q => [q.item, q.countType])).toEqual(expect.arrayContaining([
      ['Demolition — equipment connection / disconnect', 'DEMO-EQUIPMENT'], ['Demolition — device (other)', 'DEMO-DEVICE'],
    ]));
    expect(now.review.some(i => i.id.startsWith('demounit:'))).toBe(false);
  });
  it('the unit names (coordinate with C5\'s seed)', () => {
    expect(Object.values(DEMO_UNIT_NAMES)).toEqual([
      'Demolition — fluorescent fixture up to 2x4', 'Demolition — HID high bay fixture', 'Demolition — exit/emergency light',
      'Demolition — receptacle', 'Demolition — single-pole switch', 'Demolition — 3-way switch', 'Demolition — junction box',
      'Demolition — lighting control device (sensor / timer)', 'Demolition — device (other)', 'Demolition — equipment connection / disconnect',
      'Demolition — building-mounted exterior fixture', 'Demolition — site pole light',
    ]);
  });
});
