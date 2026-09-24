// Real-run fix 5 — the dense-sheet consistency pass, with MOCKED passes.
// (The replay test runs it on the two real Opus reads of Kissimmee E-3.)
import { describe, it, expect, beforeAll } from 'vitest';
import { consistencyTypes, reconcilePasses, coverRect, entryOf, CONSISTENCY_MIN_COUNT } from './consistency';
import { planOffsetTiles, planCountTiles } from '../countRender';
import { countSheets } from '../countingStage';
import { counterTileSpec } from '../modelLimits';
import type { CountTarget } from '../countTargets';
import type { CountSheet } from '../countSheets';
import { buildRasterSet } from '../../test/fixtures/evidence/buildRasterSheet';
import { fakeAnthropic, userText, type FakeRequest } from '../../test/fixtures/takeoff/fakeAnthropic';
import { displayedToPdf } from '../../estimating/pageGeometry';
import { isPdftoppmAvailable } from '../documentPrep';

const at = (x: number, y: number, typeKey = 'A') => ({ typeKey, x, y });

describe('real-run fix 5 — reconcile two passes by location', () => {
  it('agreeing marks are one symbol; a mark only one pass found is left out (to be suggested)', () => {
    const first = [at(100, 100), at(200, 100), at(300, 100), at(400, 100)];
    const second = [at(104, 98), at(203, 110), at(300, 100), at(700, 700)];
    const r = reconcilePasses(first, second);
    expect(r.agreed.map(m => m.x)).toEqual([100, 200, 300]);
    expect(r.onlyFirst.map(m => m.x)).toEqual([400]);
    expect(r.onlySecond.map(m => m.x)).toEqual([700]);
    expect(entryOf('s', 'E-3', 'A', 'high count', r)).toMatchObject({ first: 4, second: 4, agreed: 3, onlyFirst: 1, onlySecond: 1, agreement: 0.6 });
  });

  it('one-to-one, nearest first: two close fixtures are never both matched to one mark', () => {
    // Fixtures 44 pt apart (the real E-3 minimum); the second pass saw one of them.
    const r = reconcilePasses([at(0, 0), at(44, 0)], [at(40, 0)]);
    expect(r.agreed.map(m => m.x)).toEqual([44]);
    expect(r.onlyFirst.map(m => m.x)).toEqual([0]);
  });

  it('which types get the second pass: 20+ on the sheet, or flagged hard to read; never a host marker', () => {
    const placed = [...Array.from({ length: CONSISTENCY_MIN_COUNT }, () => at(0, 0, 'A')), ...Array.from({ length: 19 }, () => at(0, 0, 'B')), at(0, 0, 'C'), ...Array.from({ length: 30 }, () => at(0, 0, 'HOST'))];
    expect(consistencyTypes(placed, [{ typeKey: 'C' }, { typeKey: 'D' }], k => k === 'HOST')).toEqual([
      { typeKey: 'A', why: 'high count' }, { typeKey: 'C', why: 'density flagged' },
    ]);
  });

  it('the shifted grid moves every tile edge half a step, and keeps only the tiles over the dense marks', () => {
    const spec = counterTileSpec('claude-opus-5-5');
    const base = planCountTiles(36, 24, { tileIn: spec.tileIn });
    const all = planOffsetTiles(36, 24, { tileIn: spec.tileIn });
    const step = base[1].leftIn - base[0].leftIn;
    expect(all.find(t => t.id === 'SR1C2')!.leftIn).toBeCloseTo(step / 2, 5);
    // No shifted edge coincides with a first-pass edge.
    const edges = new Set(base.map(t => t.leftIn.toFixed(3)));
    expect(all.filter(t => t.leftIn > 0).every(t => !edges.has(t.leftIn.toFixed(3)))).toBe(true);
    const within = coverRect([{ x: 6, y: 4 }, { x: 18, y: 10 }]);
    expect(planOffsetTiles(36, 24, { tileIn: spec.tileIn, within }).map(t => t.id)).toEqual(['SR1C2', 'SR1C3', 'SR2C2', 'SR2C3']);
  });
});

describe('real-run fix 5 — countSheets with mocked passes', () => {
  let have = false;
  let pdf: Buffer;
  beforeAll(async () => {
    have = await isPdftoppmAvailable();
    if (have) pdf = await buildRasterSet([{ images: [] }]);
  }, 60_000);
  const sheet: CountSheet = { key: 'p.pdf#1', file: 'p.pdf', page: 1, sheetNo: 'E-3', title: 'LIGHTING PLAN', label: 'E-3 "LIGHTING PLAN"', role: 'building', focus: 'lighting', level: '' };
  const target = (type: string): CountTarget => ({ type, key: type, description: `${type} fixture`, symbolHint: '', wattage: 30, category: 'interior_lighting', source: 'fixture_schedule', sourceSheet: 'E-3', headsPerPole: null, emergency: false });
  const G = { widthPt: 1728, heightPt: 2592, originX: 0, originY: 0, rotation: 270 };
  // 25 A fixtures on a 5 x 5 grid 1" apart (displayed inches), 3 B.
  const grid = Array.from({ length: 25 }, (_, i) => ({ type: 'A', x: 8 + (i % 5), y: 5 + Math.floor(i / 5) }));
  const b3 = [{ type: 'B', x: 20, y: 18 }, { type: 'B', x: 21, y: 18 }, { type: 'B', x: 22, y: 18 }];

  function counter(pass1: Array<{ type: string; x: number; y: number }>, pass2: Array<{ type: string; x: number; y: number }> | 'fail') {
    const spec = counterTileSpec('claude-opus-5-5');
    return (req: FakeRequest) => {
      const text = userText(req);
      const second = text.includes('CONSISTENCY PASS');
      if (second && pass2 === 'fail') return { text: 'not json at all' };
      const truth = second ? pass2 as typeof pass1 : pass1;
      const rects = [...planCountTiles(36, 24, { tileIn: spec.tileIn }), ...planOffsetTiles(36, 24, { tileIn: spec.tileIn })].filter(r => text.includes(`Tile ${r.id} (row`));
      const asked = new Set(text.split('COUNT TARGETS')[1].split('\n\n')[0].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).split(' | ')[0]));
      const marks: unknown[] = [];
      for (const s of truth) {
        if (!asked.has(s.type)) continue;
        for (const t of rects) {
          const nx = (s.x - t.leftIn) / t.widthIn, ny = (s.y - t.topIn) / t.heightIn;
          if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) marks.push([s.type, t.id, nx, ny]);
        }
      }
      return { text: JSON.stringify({ marks, unreadable: [], notes: [] }) };
    };
  }

  it('A (25, high) is counted again on shifted tiles: 24 agree -> counted 24, 1 missed + 1 extra suggested; B (3) never re-counted', async (ctx) => {
    if (!have) return ctx.skip();
    const pass2 = [...grid.slice(1), { type: 'A', x: 13.5, y: 9.5 }];
    const { client, calls } = fakeAnthropic(counter([...grid, ...b3], pass2));
    const run = await countSheets({ client, model: 'claude-opus-5-5', maxTokens: 32000, pdfs: new Map([['p.pdf', pdf]]) }, [target('A'), target('B')], [sheet], undefined, undefined, { consistency: true });
    const r = run.sheets[0];
    expect(r.placed.filter(p => p.typeKey === 'A').length).toBe(24);
    expect(r.placed.filter(p => p.typeKey === 'B').length).toBe(3);
    expect(r.consistency).toEqual([{ sheetKey: 'p.pdf#1', sheetLabel: sheet.label, typeKey: 'A', why: 'high count', first: 25, second: 25, agreed: 24, onlyFirst: 1, onlySecond: 1, agreement: 0.923 }]);
    const pdfPt = (x: number, y: number) => displayedToPdf(x * 72, y * 72, G.originX, G.originY, G.widthPt, G.heightPt, G.rotation);
    expect(r.consistencySuggested!.map(s => [s.pass, Math.round(s.x), Math.round(s.y)])).toEqual([
      ['first', Math.round(pdfPt(8, 5).x), Math.round(pdfPt(8, 5).y)],
      ['second', Math.round(pdfPt(13.5, 9.5).x), Math.round(pdfPt(13.5, 9.5).y)],
    ]);
    const second = calls.filter(c => userText(c).includes('CONSISTENCY PASS'));
    expect(second.length).toBe(1);
    expect(userText(second[0])).not.toMatch(/^- B \|/m);
    expect(run.consistency).toMatchObject({ calls: 1 });
    expect(run.consistency!.tiles).toBeLessThanOrEqual(4);
  });

  it('both passes agree -> nothing suggested, the count stands (agreement 100%)', async (ctx) => {
    if (!have) return ctx.skip();
    const { client } = fakeAnthropic(counter(grid, grid));
    const run = await countSheets({ client, model: 'claude-opus-5-5', maxTokens: 32000, pdfs: new Map([['p.pdf', pdf]]) }, [target('A')], [sheet], undefined, undefined, { consistency: true });
    expect(run.sheets[0].placed.length).toBe(25);
    expect(run.sheets[0].consistency![0]).toMatchObject({ agreed: 25, agreement: 1 });
    expect(run.sheets[0].consistencySuggested).toEqual([]);
  });

  it('a second pass that fails keeps the first pass, says so, and suggests nothing', async (ctx) => {
    if (!have) return ctx.skip();
    const { client } = fakeAnthropic(counter(grid, 'fail'));
    const run = await countSheets({ client, model: 'claude-opus-5-5', maxTokens: 32000, pdfs: new Map([['p.pdf', pdf]]) }, [target('A')], [sheet], undefined, undefined, { consistency: true });
    expect(run.sheets[0].placed.length).toBe(25);
    expect(run.sheets[0].consistency).toBeUndefined();
    expect(run.sheets[0].notes.join(' ')).toMatch(/Consistency pass \(shifted tiles\) could not run for A/);
  });

  it('off (no evidence round): one pass only, exactly as before', async (ctx) => {
    if (!have) return ctx.skip();
    const { client, calls } = fakeAnthropic(counter(grid, grid));
    const run = await countSheets({ client, model: 'claude-opus-5-5', maxTokens: 32000, pdfs: new Map([['p.pdf', pdf]]) }, [target('A')], [sheet]);
    expect(calls.length).toBe(1);
    expect(run.consistency).toBeUndefined();
  });
});

describe('real-run fix 5 — the review item and its enforced answers', () => {
  it('one blocking item per check, one member per type; "count" / "markers" per type, "confirm" keeps the counted number', async () => {
    const { buildReviewItems, enforcedCounts, applyReconcileMemberResolution, reviewItemIsOpen } = await import('../reviewItems');
    const types = [
      { key: 'A', type: 'A', description: '8 ft strip', category: 'interior_lighting', count: 70, heads: null, status: 'counted', reason: '', sheets: [], flags: [], wattage: 42 },
      { key: 'B', type: 'B', description: '8 ft strip', category: 'interior_lighting', count: 45, heads: null, status: 'counted', reason: '', sheets: [], flags: [], wattage: 21 },
    ];
    const cr = { version: 2, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], types, loadCheck: null, removedRows: [], flags: [], marks: [],
      evidence: { tables: [], expansions: [], families: [], typicals: [], consistency: {
        entries: [entryOf('s', 'E-3', 'A', 'high count', { agreed: Array(70), onlyFirst: [], onlySecond: Array(3) }), entryOf('s', 'E-3', 'B', 'high count', { agreed: Array(45), onlyFirst: [], onlySecond: Array(7) })],
        suggested: [...Array(3).fill({ typeKey: 'A', sheetKey: 's', x: 1, y: 1, pass: 'second' }), ...Array(7).fill({ typeKey: 'B', sheetKey: 's', x: 1, y: 1, pass: 'second' })],
        calls: 1, usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, tiles: 4,
      } } } as never;
    const item = buildReviewItems(cr).find(i => i.id === 'consistency:A+B')!;
    expect(reviewItemIsOpen(item)).toBe(true);
    expect(item.actions).toEqual(['markers', 'confirm', 'count']);
    let answered = applyReconcileMemberResolution(item, 'A', { action: 'count', qty: 73 }, 'Jake');
    expect(reviewItemIsOpen(answered)).toBe(true); // B still open
    answered = applyReconcileMemberResolution(answered, 'B', { action: 'confirm', reason: 'checked the plans, 45 is right', qty: 45 }, 'Jake');
    expect(reviewItemIsOpen(answered)).toBe(false);
    const e = enforcedCounts(cr, [answered]);
    expect([e.byType.get('A'), e.byType.get('B')]).toEqual([73, 45]);
  });
});

describe('real-run fix 5 — a second pass that saw next to nothing is no check', () => {
  let have = false;
  let pdf: Buffer;
  beforeAll(async () => {
    have = await isPdftoppmAvailable();
    if (have) pdf = await buildRasterSet([{ images: [] }]);
  }, 60_000);
  it('agreement under 50%: the first pass stands (unconfirmed, flagged), nothing dropped, nothing suggested', async (ctx) => {
    if (!have) return ctx.skip();
    const sheet: CountSheet = { key: 'p.pdf#1', file: 'p.pdf', page: 1, sheetNo: 'E-3', title: 'LIGHTING PLAN', label: 'E-3 "LIGHTING PLAN"', role: 'building', focus: 'lighting', level: '' };
    const spec = counterTileSpec('claude-opus-5-5');
    const grid = Array.from({ length: 25 }, (_, i) => ({ x: 8 + (i % 5), y: 5 + Math.floor(i / 5) }));
    const { client } = fakeAnthropic((req: FakeRequest) => {
      const text = userText(req);
      if (text.includes('CONSISTENCY PASS')) return { text: JSON.stringify({ marks: [], unreadable: [], notes: [] }) };
      const rects = planCountTiles(36, 24, { tileIn: spec.tileIn }).filter(r => text.includes(`Tile ${r.id} (row`));
      return { text: JSON.stringify({ marks: grid.flatMap(s => rects.filter(t => s.x >= t.leftIn && s.x <= t.leftIn + t.widthIn && s.y >= t.topIn && s.y <= t.topIn + t.heightIn).map(t => ['A', t.id, (s.x - t.leftIn) / t.widthIn, (s.y - t.topIn) / t.heightIn])), unreadable: [], notes: [] }) };
    });
    const run = await countSheets({ client, model: 'claude-opus-5-5', maxTokens: 32000, pdfs: new Map([['p.pdf', pdf]]) },
      [{ type: 'A', key: 'A', description: 'A', symbolHint: '', wattage: 1, category: 'interior_lighting', source: 'fixture_schedule', sourceSheet: '', headsPerPole: null, emergency: false }], [sheet], undefined, undefined, { consistency: true });
    expect(run.sheets[0].placed.length).toBe(25);
    expect(run.sheets[0].consistency![0]).toMatchObject({ first: 25, second: 0, agreed: 0, inconclusive: true });
    expect(run.sheets[0].consistencySuggested).toEqual([]);
  });
});
