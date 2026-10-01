// Accuracy round A — the site poles counted twice on the live AutoZone run
// of 2026-09-30 (6 poles / 10 heads; Chris 3 / 4), on that run's own
// stored output and its counting replay (no model, no DB).
//
// A1 diagnosis: PH0.1's S1 (2) and S2 (1) were counted only on the
// photometric sheet; E-7's SITE LIGHT (3) — the same three poles — carries
// another DSX1 catalog number (E-3: "DSX1 LED 60C 1000 40K T3M"), so the
// family code kept it as its own type ("shares the DSX1 series … but not the
// catalog number"): 2 + 1 + 3 = 6 poles, 2 + 2 + 3 × 2 = 10 heads.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { applyFamilies, catalogOf, type FamilyDecision, type SiteFamilyContext } from './families';
import type { Viewport } from './viewports';
import { buildReviewItems, type ReviewItem } from '../reviewItems';
import type { TypeCountResult } from '../countMerge';
import type { CountTarget } from '../countTargets';
import type { CountResult } from '../countingStage';
import { loadKissimmeeLive0930 } from '../../test/fixtures/realrun/live0930';
import { loadKissimmeeLive0928 } from '../../test/fixtures/realrun/kissimmeeLive';
import { replayKissimmee0930 } from '../../test/fixtures/realrun/replay0930';
import { replay0928 } from '../../test/fixtures/realrun/replay0928';
import { isPdftoppmAvailable } from '../documentPrep';
import { diffAgainstExpected, validateExpectedFile } from '../../eval/takeoffEval';

const live = loadKissimmeeLive0930();
const live28 = loadKissimmeeLive0928();
const expected = validateExpectedFile(JSON.parse(fs.readFileSync(path.join(__dirname, '../../../eval/autozone-10077-kissimmee.expected.json'), 'utf8')));
const T30 = (k: string) => (live.countResult.types as unknown as TypeCountResult[]).find(t => t.key === k)!;
const site = (types: TypeCountResult[]) => {
  const c = types.filter(t => t.category === 'site_lighting' && t.status === 'counted');
  return { poles: c.reduce((n, t) => n + t.count, 0), heads: c.reduce((n, t) => n + (t.heads ?? 0), 0) };
};

describe('A1 — the live cause (2026-09-30, stored)', () => {
  it('S1 2 + S2 1 photometric-only; SITE LIGHT 3 from E-7; the family kept SITE LIGHT as its own type: 6 poles / 10 heads', () => {
    expect([T30('S1').count, T30('S1').photometricOnly, T30('S2').count, T30('S2').photometricOnly]).toEqual([2, true, 1, true]);
    const sl = T30('SITE LIGHT');
    expect([sl.count, sl.status, sl.heads]).toEqual([3, 'counted', 6]);
    expect(sl.sheets.filter(s => s.used).map(s => s.label.split(' ')[0])).toEqual(['E-7']);
    const fam = (live.countResult.evidence.families as FamilyDecision[]).find(d => d.family === 'DSX1')!;
    expect(fam.merged).toEqual([]);
    expect(fam.flags.join(' ')).toMatch(/SITE LIGHT .* shares the DSX1 series with S1\/S2 but not the catalog number — kept as its own type/);
    expect(site(live.countResult.types as unknown as TypeCountResult[])).toEqual({ poles: 6, heads: 10 });
    // Only the series matches: PH0.1's P8 T4M vs E-3's 60C 1000 T3M.
    expect(catalogOf(T30('S1').description)!.full).not.toBe(catalogOf(sl.description)!.full);
  });
});

describe('A1 — the 2026-09-28 run with SITE LIGHT counted 3 (MUTATION: live it counted 0)', () => {
  const targets = live28.countResult.targets as unknown as CountTarget[];
  const types = (live28.countResult.types as unknown as TypeCountResult[]).filter(t => t.category === 'site_lighting').map(t => {
    if (t.key === 'SITE LIGHT') return { ...t, status: 'counted' as const, count: 3, heads: 6, reason: '', flags: [], sheets: [{ sheetKey: `${'x'}#55`, label: 'E-7 "Lighting Plan"', count: 3, used: true }] };
    return { ...t, photometricOnly: true, flags: [] };
  });
  it('the same shape as 09-30 (PH0.1 3 photometric, E-7 3, series-only) now gives 3 poles / 4 heads, "not registered" without marks', () => {
    const r = applyFamilies(types, targets);
    expect(site(r.types)).toEqual({ poles: 3, heads: 4 });
    expect(r.types.find(t => t.key === 'SITE LIGHT')).toMatchObject({ status: 'merged', count: 0, mergedInto: 'S1/S2', mergedCount: 3 });
    const d = r.decisions.find(x => x.family === 'DSX1')!;
    expect(d.question).toBeUndefined();
    expect(d.registration).toMatchObject({ registered: false });
    expect(d.flags.join(' ')).toMatch(/not registered/);
    // S1 / S2 are no longer "photometric only": E-7 places them.
    expect(r.types.filter(t => t.key === 'S1' || t.key === 'S2').every(t => !t.photometricOnly)).toBe(true);
  });
  it('with the 09-28 run\'s own E-7 / PH0.1 marks (relabelled SITE LIGHT on E-7, MUTATION): the drawings register — each E-7 pole has its PH0.1 twin', () => {
    const sheetOf = (k: string) => live28.countResult.sheets.find(s => s.key.endsWith(k))!;
    const ctx: SiteFamilyContext = { sheets: ['#19', '#55'].map(k => {
      const s = sheetOf(k);
      return { key: s.key, label: s.label, photometric: k === '#19', geometry: s.geometry, viewports: s.viewports ?? null,
        marks: live28.countResult.marks.filter(m => m.sheetKey === s.key).map(m => ({ ...m, typeKey: k === '#55' && (m.typeKey === 'S1' || m.typeKey === 'S2') ? 'SITE LIGHT' : m.typeKey })) };
    }) };
    const r = applyFamilies(types, targets, ctx);
    const d = r.decisions.find(x => x.family === 'DSX1')!;
    expect(d.registration!.registered).toBe(true);
    expect(d.registration!.pairs!.map(p => p.twinOf).sort()).toEqual(['S1', 'S1', 'S2']);
    expect(site(r.types)).toEqual({ poles: 3, heads: 4 });
  });
});

describe('A2 — family-level photometric fallback, synthetic', () => {
  const fx = (key: string, description: string, sourceSheet: string, headsPerPole: number | null): CountTarget =>
    ({ type: key, key, description, symbolHint: '', wattage: null, category: 'site_lighting', source: 'fixture_schedule', sourceSheet, headsPerPole, emergency: false });
  const r = (t: CountTarget, count: number, sheet: string, photo = false): TypeCountResult => ({
    key: t.key, type: t.type, description: t.description, category: t.category, wattage: null, count, heads: t.headsPerPole != null ? count * t.headsPerPole : null,
    status: count > 0 ? 'counted' : 'zero', reason: '', sheets: [{ sheetKey: sheet, label: `${sheet} x`, count, used: count > 0 }], flags: [], ...(photo ? { photometricOnly: true } : {}),
  });
  const s1 = fx('S1', 'Lithonia DSX1 LED P8 40K T4M MVOLT HS', 'PH0.1', 1);
  const s2 = fx('S2', 'Lithonia DSX1 LED P8 40K T4M MVOLT HS twin', 'PH0.1', 2);
  const sl = fx('SITE LIGHT', 'D-Series Size 1 DSX1 LED 60C 1000 40K T3M MVOLT', 'E-3', 2);

  it('E 4 vs PH0.1 3: the count stays 4 (E-7\'s), ONE blocking question with both counts; nothing summed', () => {
    const out = applyFamilies([r(s1, 2, 'PH0.1', true), r(s2, 1, 'PH0.1', true), r(sl, 4, 'E-7')], [s1, s2, sl]);
    expect(site(out.types)).toEqual({ poles: 4, heads: 8 });
    expect(out.types.find(t => t.key === 'S1')).toMatchObject({ status: 'merged', count: 0, mergedCount: 2 });
    const d = out.decisions[0];
    expect(d.question).toMatchObject({ primaryCount: 4, memberCount: 3, intoKeys: ['SITE LIGHT'] });
    expect(d.question!.text).toBe('E-7 shows 4 site poles; PH0.1 shows S1 2 + S2 1 = 3. Which is right, and which pole types?');
    const items = buildReviewItems({ types: out.types, targets: [s1, s2, sl], evidence: { families: out.decisions } } as unknown as CountResult);
    const q = items.find(i => i.id === 'family:S1')!;
    expect(q.blocking).toBeUndefined();
    expect(q.detail).toContain('carries SITE LIGHT\'s 4 for now');
  });

  it('risk: 2 parking-lot + 2 building poles of one series — 2 marks a side cannot be compared: counts reconcile AND one non-blocking family: confirm item says so (review B-3)', () => {
    const out = applyFamilies([r(s1, 2, 'PH0.1', true), r(sl, 2, 'E-7')], [s1, sl], { sheets: [
      { key: 'PH0.1', label: 'PH0.1', photometric: true, geometry: { originX: 0, originY: 0, widthPt: 2592, heightPt: 1728, rotation: 0 }, marks: [{ typeKey: 'S1', x: 100, y: 100 }, { typeKey: 'S1', x: 900, y: 120 }] },
      { key: 'E-7', label: 'E-7', geometry: { originX: 0, originY: 0, widthPt: 2592, heightPt: 1728, rotation: 0 }, marks: [{ typeKey: 'SITE LIGHT', x: 100, y: 100 }, { typeKey: 'SITE LIGHT', x: 120, y: 900 }] },
    ] });
    expect(out.decisions[0].registration!.registered).toBe(false);
    expect(out.decisions[0].question).toBeUndefined();
    expect(out.decisions[0].assumedSame).toMatchObject({ key: 'S1', count: 2 });
    const items = buildReviewItems({ types: out.types, targets: [s1, sl], evidence: { families: out.decisions } } as unknown as CountResult);
    const it1 = items.find(i => i.id === 'family:S1')!;
    expect(it1).toBeTruthy();
    expect(it1.blocking).toBe(false);
    expect(it1.title).toMatch(/taken as the same 2 poles — positions not compared/);
    expect(it1.detail).toContain('E-7 shows SITE LIGHT 2');
    expect(it1.detail).toContain('S1 2');
    expect(it1.sheets).toEqual(['E-7', 'PH0.1']);
    // Three marks a side that do not line up: asked (blocking), never merged, never 6.
    const three = applyFamilies([r(s1, 3, 'PH0.1', true), r(sl, 3, 'E-7')], [s1, sl], { sheets: [
      { key: 'PH0.1', label: 'PH0.1', photometric: true, geometry: { originX: 0, originY: 0, widthPt: 2592, heightPt: 1728, rotation: 0 }, marks: [{ typeKey: 'S1', x: 100, y: 100 }, { typeKey: 'S1', x: 900, y: 120 }, { typeKey: 'S1', x: 500, y: 700 }] },
      { key: 'E-7', label: 'E-7', geometry: { originX: 0, originY: 0, widthPt: 2592, heightPt: 1728, rotation: 0 }, marks: [{ typeKey: 'SITE LIGHT', x: 100, y: 100 }, { typeKey: 'SITE LIGHT', x: 110, y: 900 }, { typeKey: 'SITE LIGHT', x: 1500, y: 300 }] },
    ] });
    expect(three.decisions[0].registration!.registered).toBe(false);
    expect(three.decisions[0].question).toBeTruthy();
    expect(site(three.types).poles).toBe(3); // never 6
  });

  describe('Rule 2 (review B-1): merge only on evidence', () => {
    const e7 = fx('(UNTAGGED) SITE LIGHT', 'Site light DSX1 LED P9 30K T5M', 'E-7', 1);
    const g = { originX: 0, originY: 0, widthPt: 2592, heightPt: 1728, rotation: 0 };
    const vp = (inPerFt: number) => [{ id: 'x@1', number: '1', title: 'SITE PLAN', scale: '', kind: 'main_plan', rectIn: { left: 0, top: 0, width: 36, height: 24 }, bboxPt: { minX: 0, minY: 0, maxX: 2592, maxY: 1728 }, source: 'text', inPerFt }] as unknown as Viewport[];
    // An asymmetric, non-collinear 4-pole layout (PDF points).
    const pts = [{ x: 100, y: 100 }, { x: 600, y: 140 }, { x: 420, y: 700 }, { x: 800, y: 520 }];
    const merge = (viewportsA: Viewport[] | undefined, viewportsB: Viewport[] | undefined, pa = pts, pb = pts.map(p => ({ x: p.x * 0.5 + 40, y: p.y * 0.5 + 30 }))) =>
      applyFamilies([r(sl, 4, 'E-3'), r(e7, 4, 'E-7')], [sl, e7], { sheets: [
        { key: 'E-3', label: 'E-3', geometry: g, viewports: viewportsA, marks: pa.map(p => ({ typeKey: 'SITE LIGHT', ...p })) },
        { key: 'E-7', label: 'E-7', geometry: g, viewports: viewportsB, marks: pb.map(p => ({ typeKey: e7.key, ...p })) },
      ] });

    it('two sheets, both viewport scales known and matching, 4 marks line up: merged — AND a non-blocking family-same item states the merge, both counts and the evidence', () => {
      const same = merge(vp(1 / 8), vp(1 / 16));
      expect(site(same.types).poles).toBe(4);
      expect(same.types.find(t => t.key === e7.key)!.status).toBe('merged');
      const items = buildReviewItems({ types: same.types, targets: [sl, e7], evidence: { families: same.decisions } } as unknown as CountResult);
      const it1 = items.find(i => i.id === `family-same:${e7.key}`)!;
      expect(it1.blocking).toBe(false);
      expect(it1.title).toMatch(/Treated as the same site poles/);
      expect(it1.detail).toMatch(/4 counted/);
      expect(it1.detail).toMatch(/marks line up/);
    });

    it('viewport scales unknown: NOT merged, kept at today\'s count with the family-same question', () => {
      const apart = merge(undefined, undefined);
      expect(site(apart.types).poles).toBe(8);
      expect(apart.decisions[0].samePoles).toEqual([expect.objectContaining({ key: e7.key, count: 4, intoCount: 4 })]);
      expect(apart.decisions[0].samePoles![0].reason).toMatch(/scales are not both known/);
      const items = buildReviewItems({ types: apart.types, targets: [sl, e7], evidence: { families: apart.decisions } } as unknown as CountResult);
      expect(items.find(i => i.id === `family-same:${e7.key}`)!.blocking).toBe(false);
    });

    it('fewer than 4 marks a side: never merged; the reason says the real cause', () => {
      const out = applyFamilies([r(sl, 3, 'E-3'), r(e7, 3, 'E-7')], [sl, e7], { sheets: [
        { key: 'E-3', label: 'E-3', geometry: g, viewports: vp(1 / 8), marks: pts.slice(0, 3).map(p => ({ typeKey: 'SITE LIGHT', ...p })) },
        { key: 'E-7', label: 'E-7', geometry: g, viewports: vp(1 / 16), marks: pts.slice(0, 3).map(p => ({ typeKey: e7.key, x: p.x * 0.5 + 40, y: p.y * 0.5 + 30 })) },
      ] });
      expect(site(out.types).poles).toBe(6);
      expect(out.decisions[0].samePoles![0].reason).toMatch(/fewer than 4 or more than 7 marks on a side \(3 \/ 3\)/);
    });

    it('marks on more than one sheet: the reason is "not on one sheet each", not a count', () => {
      const out = applyFamilies([r(sl, 3, 'E-3'), r(e7, 3, 'E-7')], [sl, e7], undefined);
      expect(out.decisions[0].samePoles![0].reason).toMatch(/not on one sheet each/);
    });

    it('B-1 repro: two rows of 3 on the SAME sheet are different poles (never 6 -> 3)', () => {
      const rowA = [100, 400, 700].map(x => ({ x, y: 100 })), rowB = [100, 400, 700].map(x => ({ x, y: 1200 }));
      const out = applyFamilies([r(sl, 3, 'E-7'), r(e7, 3, 'E-7')], [sl, e7], { sheets: [
        { key: 'E-7', label: 'E-7', geometry: g, viewports: vp(1 / 8), marks: [...rowA.map(p => ({ typeKey: 'SITE LIGHT', ...p })), ...rowB.map(p => ({ typeKey: e7.key, ...p }))] },
      ] });
      expect(site(out.types).poles).toBe(6);
      expect(out.types.find(t => t.key === e7.key)!.status).toBe('counted');
    });

    it('B-1 repro: two rows of 4 at different spacing on two sheets, scales unknown: not merged', () => {
      const rowA = [100, 400, 700, 1000].map(x => ({ x, y: 100 })), rowB = [100, 250, 400, 550].map(x => ({ x, y: 300 }));
      const out = merge(undefined, undefined, rowA, rowB);
      expect(site(out.types).poles).toBe(8);
      const known = merge(vp(1 / 8), vp(1 / 8), rowA, rowB);
      expect(site(known.types).poles).toBe(8); // collinear: cannot be compared even with scales
    });

    it('same sheet, same places (one pole counted under two types): merged, with the visible item', () => {
      const out = applyFamilies([r(sl, 4, 'E-7'), r(e7, 4, 'E-7')], [sl, e7], { sheets: [
        { key: 'E-7', label: 'E-7', geometry: g, viewports: vp(1 / 8), marks: [...pts.map(p => ({ typeKey: 'SITE LIGHT', ...p })), ...pts.map(p => ({ typeKey: e7.key, x: p.x + 4, y: p.y - 3 }))] },
      ] });
      expect(site(out.types).poles).toBe(4);
      expect(out.decisions[0].samePoles![0].merged).toBe(true);
    });
  });
});

let have = false;
let r30: { cr: CountResult; review: ReviewItem[] };
let r28: { cr: CountResult; review: ReviewItem[] };
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  r30 = await replayKissimmee0930();
  r28 = await replay0928();
}, 300_000);

describe('A — the 2026-09-30 run replayed (live counter marks; no model)', () => {
  it('3 poles / 4 heads: S1 2 + S2 1 with PH0.1\'s heads; SITE LIGHT merged with the reason; E-7 registers onto PH0.1', (ctx) => {
    if (!have) return ctx.skip();
    expect(site(r30.cr.types)).toEqual({ poles: 3, heads: 4 });
    const sl = r30.cr.types.find(t => t.key === 'SITE LIGHT')!;
    expect(sl).toMatchObject({ status: 'merged', count: 0, mergedInto: 'S1/S2', mergedCount: 3 });
    expect(sl.reason).toBe('same 3 site poles as S1/S2: E-7 shows 3, PH0.1\'s S1 2 + S2 1 = 3 — types and heads from PH0.1, positions from E-7');
    expect(sl.flags.join(' ')).toMatch(/2 heads per pole .* is not used/);
    const d = r30.cr.evidence!.families.find(x => x.family === 'DSX1')!;
    expect(d.registration!.registered).toBe(true);
    expect(d.registration!.residualIn).toBeLessThan(0.1);
    // The E-7 pole at (1131, 1346) is PH0.1's S2 (the twin-head pole).
    expect(d.registration!.pairs!.map(p => [Math.round(p.x), Math.round(p.y), p.twinOf])).toEqual([[1496, 1395, 'S1'], [1131, 1346, 'S2'], [1132, 932, 'S1']]);
    expect(r30.cr.types.filter(t => t.key === 'S1' || t.key === 'S2').every(t => !t.photometricOnly)).toBe(true);
  });

  it('the review has no new blocking item (the photometric-only notes and SITE LIGHT\'s coverage item are gone)', (ctx) => {
    if (!have) return ctx.skip();
    const before = new Set(live.reviewItems.filter(i => i.blocking !== false).map(i => i.id));
    const now = r30.review.filter(i => i.blocking !== false && /SITE LIGHT|S1|S2|family/.test(i.id)).map(i => i.id);
    expect(now.filter(id => !before.has(id))).toEqual([]);
    expect(r30.review.some(i => i.id === 'coverage:SITE LIGHT' || i.id === 'photo:S1' || i.id === 'photo:S2')).toBe(false);
    expect(r30.review.some(i => i.id.startsWith('family'))).toBe(false);
  });

  it('takeoffEval: site_poles and site_heads pass (were 6 / 10)', (ctx) => {
    if (!have) return ctx.skip();
    const d = diffAgainstExpected(expected, r30.cr);
    expect(['site_poles', 'site_heads'].map(id => { const x = d.rows.find(r => r.id === id)!; return [x.actual, x.verdict]; })).toEqual([[3, 'pass'], [4, 'pass']]);
  });

  it('09-28 replay: still 3 / 4, the family decisions identical to the live run\'s', (ctx) => {
    if (!have) return ctx.skip();
    // Fix round 1 (B-3): 09-28 also takes the same-catalog path — no assumed-same item.
    expect(r28.cr.evidence!.families.some(d => d.assumedSame)).toBe(false);
    expect(r28.review.some(i => i.id.startsWith('family'))).toBe(false);
    expect(site(r28.cr.types)).toEqual({ poles: 3, heads: 4 });
    const norm = (ds: unknown) => (JSON.parse(JSON.stringify(ds)) as Array<Record<string, unknown>>).map(d => ({ family: d.family, primary: d.primary, merged: d.merged, flags: d.flags, question: d.question }));
    expect(norm(r28.cr.evidence!.families)).toEqual(norm(live28.countResult.evidence.families));
  });

  it('W1/W2 -> D/L unchanged on the 09-30 replay (the full-catalog path)', (ctx) => {
    if (!have) return ctx.skip();
    const norm = (ds: unknown) => (JSON.parse(JSON.stringify(ds)) as Array<Record<string, unknown>>).filter(d => d.family === 'DSXW1').map(d => ({ primary: d.primary, merged: d.merged, flags: d.flags }));
    expect(norm(r30.cr.evidence!.families)).toEqual(norm(live.countResult.evidence.families));
  });
});
