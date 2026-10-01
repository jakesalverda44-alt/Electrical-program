// Fewer-questions round Task 3 — "same area?" answered automatically when
// the sheets' registration proves it. 36th Street reproduces Jake's three
// stored answers exactly; Kissimmee stays asked (its marks are on an
// enlarged plan, and the nearest duplex marks are 0.58" apart); every
// synthetic negative stays asked.
import { describe, it, expect, beforeAll } from 'vitest';
import { autoAreaAnswer, enforcedCounts, AUTO_BY, type ReviewItem } from './reviewItems';
import { registrationOf, type RelationSheet } from './evidence/sheetRelation';
import { replayReview, storedAnswers, type ReplayReview } from '../eval/reviewReplay';
import { isPdftoppmAvailable } from './documentPrep';
import type { AreaQuestion } from './countMerge';

type Reg = NonNullable<AreaQuestion['registration']>[number];
const reg = (over: Partial<Reg> = {}): Reg => ({
  sheets: ['E1.0 "Electrical Plan"', 'E2.0 "Electrical Plan"'], relation: 'duplicate', cause: 's15', alignment: 'building', alignNote: 'building outlines aligned', tol: 0.5,
  paired: 3, compared: 3, verify: { paired: 4, compared: 4, verified: true }, minSepIn: 0.06, allMain: true, ...over,
});
const q = (rs: Reg[]): AreaQuestion => ({ sheets: [{ label: 'E1.0', count: 3 }, { label: 'E2.0', count: 9 }], keep: 9, sum: 12, registration: rs });
const ONE_LEVEL = ['Cover Sheet', 'Electrical Plan', 'Electrical Plan', 'Roof Plan'];

describe('autoAreaAnswer — the rules', () => {
  it('same — keep: duplicate asked only for S15, all paired, verified, single-level', () => {
    const a = autoAreaAnswer(q([reg()]), ONE_LEVEL)!;
    expect(a.index).toBe(0);
    expect(a.evidence).toEqual([
      'E1.0 / E2.0: 3 of 3 marks sit in the same place (building outlines aligned)',
      'E1.0 / E2.0: aligned on the building outlines (4 of 4 marks of other types also line up)',
      'no sheet title names a floor or level — 4 titles checked',
    ]);
  });
  it.each([
    ['a two-story inventory', [reg()], [...ONE_LEVEL, 'Second Floor Electrical Plan']],
    ['a mezzanine in the set', [reg()], [...ONE_LEVEL, 'Mezzanine Framing']],
    ['no inventory titles', [reg()], []],
    ['a mark not paired', [reg({ paired: 2 })], ONE_LEVEL],
    ['an enlarged-plan mark', [reg({ allMain: false })], ONE_LEVEL],
    ['a frame alignment without verification (mirror / look-alike)', [reg({ alignment: 'frame', alignNote: 'same sheet size', tol: 1, verify: { paired: 1, compared: 5, verified: false } })], ONE_LEVEL],
    ['a duplicate that was unclear for another reason', [reg({ cause: 'unclear' })], ONE_LEVEL],
    ['three sheets, one pair unclear', [reg(), reg({ sheets: ['E1.0', 'E3.0'], relation: 'unclear', cause: 'unclear', paired: 1 })], ONE_LEVEL],
  ])('asked: %s', (_n, rs, titles) => {
    expect(autoAreaAnswer(q(rs as Reg[]), titles as string[])).toBeNull();
  });
  const diff = (over: Partial<Reg> = {}) => reg({ relation: 'unclear', cause: 'unclear', paired: 0, compared: 3, minSepIn: 8.2, ...over });
  it('different — sum: verified alignment, none paired, ≥ 2 compared, main plans, far apart', () => {
    const a = autoAreaAnswer(q([diff()]), ONE_LEVEL)!;
    expect(a.index).toBe(1);
    expect(a.evidence[0]).toBe('E1.0 / E2.0: 0 of 3 marks sit in the same place; the nearest two are 8.2" apart (more than twice the 0.5" tolerance)');
  });
  it.each([
    ['too close (≤ 2 × tolerance)', diff({ minSepIn: 0.58 })],
    ['one compared', diff({ compared: 1 })],
    ['an enlarged-plan mark', diff({ allMain: false })],
    ['not verified', diff({ alignment: 'frame', verify: { paired: 0, compared: 4, verified: false } })],
    ['one mark paired', diff({ paired: 1 })],
  ])('different stays asked: %s', (_n, r) => {
    expect(autoAreaAnswer(q([r]), ONE_LEVEL)).toBeNull();
  });
});

describe('registrationOf (synthetic sheets)', () => {
  const geom = { widthPt: 2592, heightPt: 1728, originX: 0, originY: 0, rotation: 0 };
  const main = (id: string) => ({ id: `${id}@1`, number: '1', title: 'PLAN', scale: '1/8"', kind: 'main_plan' as const, rectIn: { left: 0, top: 0, width: 36, height: 24 }, bboxPt: { x0: 0, y0: 0, x1: 2592, y1: 1728 }, source: 'text' as const, inPerFt: 0.125, buildingIn: { left: 2, top: 2, width: 30, height: 20 } });
  const sheet = (key: string, marks: RelationSheet['marks'], extra: RelationSheet['viewports'] = []): RelationSheet => ({ key, label: key, geometry: geom, viewports: [main(key), ...(extra ?? [])], marks });
  const pts = (k: string, xs: number[]) => xs.map(x => ({ typeKey: k, x, y: 500 }));
  it('verifies on the building box; counts other shared types; min separation; all on the main plan', () => {
    const a = sheet('A', [...pts('$', [100, 300, 500]), ...pts('GFI', [700, 900])]);
    const b = sheet('B', [...pts('$', [100, 300, 500]), ...pts('GFI', [700, 900])]);
    const r = registrationOf('$', a, b);
    expect(r).toMatchObject({ alignment: 'building', paired: 3, compared: 3, verify: { paired: 2, compared: 2, verified: true }, minSepIn: 0, allMain: true });
  });
  it('an enlarged-plan mark makes allMain false', () => {
    const enl = { id: 'B@2', number: '2', title: 'ENLARGED', scale: '1/4"', kind: 'enlarged_plan' as const, rectIn: { left: 20, top: 2, width: 8, height: 8 }, bboxPt: { x0: 0, y0: 0, x1: 1, y1: 1 }, source: 'text' as const, inPerFt: 0.25, areaOnMain: { left: 2, top: 2, width: 4, height: 4 } };
    const a = sheet('A', pts('$', [100, 300]));
    const b = sheet('B', [...pts('$', [100]), { typeKey: '$', x: 1600, y: 300, viewportId: 'B@2' }], [enl]);
    expect(registrationOf('$', a, b).allMain).toBe(false);
  });
});

let have = false;
const r: Partial<Record<'kissimmee' | '36th', ReplayReview>> = {};
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  r.kissimmee = await replayReview('kissimmee');
  r['36th'] = await replayReview('36th');
}, 900_000);

describe('the two 0930 replays', () => {
  it("36th Street: all three answered automatically, exactly Jake's stored answers", (ctx) => {
    if (!have) return ctx.skip();
    const stored = storedAnswers(r['36th']!.live);
    for (const id of ['area:ELECTRICAL PANEL', 'area:PANEL B', 'area:$']) {
      const i = r['36th']!.items.find(x => x.id === id)!;
      const jake = stored.get(id)!.resolution!;
      expect(i.resolution).toMatchObject({ action: 'answer', answer: jake.answer, qty: jake.qty, by: AUTO_BY, auto: { source: 'registration' } });
      expect(i.resolution!.auto!.evidence.length).toBeGreaterThanOrEqual(3);
    }
    // the count is what Jake's answers give
    const withJake = r['36th']!.items.map(i => (stored.get(i.id)?.resolution && i.id.startsWith('area:') ? { ...i, resolution: stored.get(i.id)!.resolution } : i)) as ReviewItem[];
    expect(Object.fromEntries(enforcedCounts(r['36th']!.countResult, r['36th']!.items).byType)).toEqual(Object.fromEntries(enforcedCounts(r['36th']!.countResult, withJake).byType));
  });
  it('Kissimmee: both stay asked (enlarged-plan marks on E-2; the duplex marks 0.58" apart)', (ctx) => {
    if (!have) return ctx.skip();
    for (const id of ['area:SIMPLEX RECEPTACLE', 'area:DUPLEX / FLOOR RECEPTACLE']) {
      const i = r.kissimmee!.items.find(x => x.id === id)!;
      expect(i.resolution).toBeUndefined();
    }
    const regs = r.kissimmee!.countResult.types.filter(t => t.areaQuestion).map(t => [t.key, t.areaQuestion!.registration!.map(x => `${x.relation}/${x.cause}/${x.alignment}/verified=${x.verify.verified}/paired=${x.paired}/${x.compared}/allMain=${x.allMain}/minSep=${x.minSepIn}`)]);
    expect(regs).toEqual([
      ['SIMPLEX RECEPTACLE', ['unclear/unclear/building/verified=true/paired=0/3/allMain=false/minSep=8.2']],
      ['DUPLEX / FLOOR RECEPTACLE', ['unclear/unclear/building/verified=true/paired=0/2/allMain=false/minSep=0.58']],
    ]);
  });
});
