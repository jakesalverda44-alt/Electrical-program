// Real-run fix 5, review fixes B1 / S8 — the dense-sheet consistency pass,
// with MOCKED passes. (The replay test runs it on the two real Opus reads of
// Kissimmee E-3.) B1: the pass NEVER lowers a count without a human.
import { describe, it, expect, beforeAll } from 'vitest';
import { consistencyTypes, reconcilePasses, coverRect, entryOf, agreeRadiusPt, CONSISTENCY_MIN_COUNT } from './consistency';
import { planOffsetTiles, planCountTiles } from '../countRender';
import { countSheets } from '../countingStage';
import { counterTileSpec, retryTileIn } from '../modelLimits';
import type { CountTarget } from '../countTargets';
import type { CountSheet } from '../countSheets';
import { buildRasterSet } from '../../test/fixtures/evidence/buildRasterSheet';
import { fakeAnthropic, userText, type FakeRequest, type FakeReply } from '../../test/fixtures/takeoff/fakeAnthropic';
import { displayedToPdf } from '../../estimating/pageGeometry';
import { isPdftoppmAvailable } from '../documentPrep';
import type { EvidenceCache } from './evidenceStage';

const at = (x: number, y: number, typeKey = 'A') => ({ typeKey, x, y });

describe('reconcile two passes by location', () => {
  it('re-found marks, pass-1-only marks (still counted) and pass-2-only marks (suggested); agreement = re-found / pass 1', () => {
    const first = [at(100, 100), at(200, 100), at(300, 100), at(400, 100)];
    const second = [at(104, 98), at(203, 110), at(300, 100), at(700, 700)];
    const r = reconcilePasses(first, second, 28.8);
    expect(r.agreed.map(m => m.x)).toEqual([100, 200, 300]);
    expect(r.onlyFirst.map(m => m.x)).toEqual([400]);
    expect(r.onlySecond.map(m => m.x)).toEqual([700]);
    expect(entryOf('s', 'E-3', 'A', 'high count', r)).toMatchObject({ first: 4, second: 4, agreed: 3, onlyFirst: 1, onlySecond: 1, agreement: 0.75, lowAgreement: true });
  });

  it('S8 — maximum matching: nearest-first greedy would pair a1-b1 and strand a2; the optimum pairs both', () => {
    const r = reconcilePasses([at(0, 0), at(20, 0)], [at(10, 0), at(-12, 0)], 25);
    expect(r.agreed.length).toBe(2);
    expect(r.onlyFirst).toEqual([]);
  });

  it('S8 — jitter: 70 fixtures at the real 44-62 pt spacing, the second read jittered up to 30 pt: every one re-found', () => {
    const first = Array.from({ length: 70 }, (_, i) => at(1000 + (i % 10) * 62, 1400 + Math.floor(i / 10) * 44));
    const second = first.map((m, i) => at(m.x + ((i * 7) % 31) - 15, m.y + ((i * 13) % 31) - 15));
    const r = reconcilePasses(first, second);
    expect(agreeRadiusPt(first)).toBeGreaterThan(30);
    expect([r.agreed.length, r.onlyFirst.length, r.onlySecond.length]).toEqual([70, 0, 0]);
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
    const edges = new Set(base.map(t => t.leftIn.toFixed(3)));
    expect(all.filter(t => t.leftIn > 0).every(t => !edges.has(t.leftIn.toFixed(3)))).toBe(true);
    const within = coverRect([{ x: 6, y: 4 }, { x: 18, y: 10 }]);
    expect(planOffsetTiles(36, 24, { tileIn: spec.tileIn, within }).map(t => t.id)).toEqual(['SR1C2', 'SR1C3', 'SR2C2', 'SR2C3']);
  });
});

describe('countSheets with mocked passes', () => {
  let have = false;
  let pdf: Buffer;
  beforeAll(async () => {
    have = await isPdftoppmAvailable();
    if (have) pdf = await buildRasterSet([{ images: [] }]);
  }, 60_000);
  const sheet: CountSheet = { key: 'p.pdf#1', file: 'p.pdf', page: 1, sheetNo: 'E-3', title: 'LIGHTING PLAN', label: 'E-3 "LIGHTING PLAN"', role: 'building', focus: 'lighting', level: '' };
  const target = (type: string): CountTarget => ({ type, key: type, description: `${type} fixture`, symbolHint: '', wattage: 30, category: 'interior_lighting', source: 'fixture_schedule', sourceSheet: 'E-3', headsPerPole: null, emergency: false });
  const G = { widthPt: 1728, heightPt: 2592, originX: 0, originY: 0, rotation: 270 };
  const pdfPt = (x: number, y: number) => displayedToPdf(x * 72, y * 72, G.originX, G.originY, G.widthPt, G.heightPt, G.rotation);
  // Fixtures 1" apart (displayed inches).
  const gridOf = (n: number, cols = 10) => Array.from({ length: n }, (_, i) => ({ type: 'A', x: 6 + (i % cols), y: 4 + Math.floor(i / cols) }));
  const grid = gridOf(25, 5);
  const b3 = [{ type: 'B', x: 20, y: 18 }, { type: 'B', x: 21, y: 18 }, { type: 'B', x: 22, y: 18 }];
  const spec = counterTileSpec('claude-opus-5-5');

  function counter(pass1: Array<{ type: string; x: number; y: number }>, pass2: Array<{ type: string; x: number; y: number }> | 'fail' | 'truncate') {
    return (req: FakeRequest): FakeReply => {
      const text = userText(req);
      const second = text.includes('CONSISTENCY PASS');
      if (second && pass2 === 'fail') return { text: 'not json at all' };
      if (second && pass2 === 'truncate') return { text: '{"marks":[', stop_reason: 'max_tokens' };
      const truth = second ? pass2 as typeof pass1 : pass1;
      const rects = [...planCountTiles(36, 24, { tileIn: spec.tileIn }), ...planOffsetTiles(36, 24, { tileIn: retryTileIn(spec.tileIn, spec.limits) })].filter(r => text.includes(`Tile ${r.id} (row`));
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
  const run = (client: Parameters<typeof countSheets>[0]['client'], targets: CountTarget[], cache?: EvidenceCache) =>
    countSheets({ client, model: 'claude-opus-5-5', maxTokens: 32000, pdfs: new Map([['p.pdf', pdf]]) }, targets, [sheet], undefined, undefined, { consistency: true, cache });

  it('B1 — 70 counted, the second pass re-finds 50: the count stays 70; 20 "not re-seen" listed; agreement 71% (low) -> a blocking item with both counts', async (ctx) => {
    if (!have) return ctx.skip();
    const seventy = gridOf(70);
    const { client } = fakeAnthropic(counter(seventy, seventy.slice(0, 50)));
    const r = (await run(client, [target('A')])).sheets[0];
    expect(r.placed.filter(p => p.typeKey === 'A').length).toBe(70);
    expect(r.consistency![0]).toMatchObject({ first: 70, second: 50, agreed: 50, onlyFirst: 20, onlySecond: 0, agreement: 0.714, lowAgreement: true });
    expect(r.consistencySuggested).toEqual([]);
    expect(r.consistencyNotReseen!.length).toBe(20);
    const { buildReviewItems, reviewItemIsOpen, enforcedCounts, applyReconcileMemberResolution } = await import('../reviewItems');
    const cr = { version: 2, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], loadCheck: null, removedRows: [], flags: [], marks: [],
      types: [{ key: 'A', type: 'A', description: 'A', category: 'interior_lighting', count: 70, heads: null, status: 'counted', reason: '', sheets: [], flags: [], wattage: 30 }],
      evidence: { tables: [], expansions: [], families: [], typicals: [], consistency: { entries: r.consistency, suggested: [], notReseen: r.consistencyNotReseen, calls: 1, usage: {}, tiles: 2 } } } as never;
    const item = buildReviewItems(cr).find(i => i.id === 'consistency:A')!;
    expect(reviewItemIsOpen(item)).toBe(true);
    expect(item.detail).toContain('counted 70 (first pass); the second pass (shifted tiles) found 50, re-finding 50 of the 70 (71%); 20 counted marks it did not re-find (still counted)');
    expect(enforcedCounts(cr, [item]).byType.get('A')).toBe(70);
    // "Keep the counted number" keeps pass 1's 70.
    const kept = applyReconcileMemberResolution(item, 'A', { action: 'confirm', reason: 'checked the plans — 70 is right', qty: item.reconcileMembers![0].currentQty }, 'Jake');
    expect(enforcedCounts(cr, [kept]).byType.get('A')).toBe(70);
  });

  it('B1 — high agreement: 25 counted, 24 re-found + 1 new -> 25 stay counted, 1 suggested (never removed, never added by itself)', async (ctx) => {
    if (!have) return ctx.skip();
    const pass2 = [...grid.slice(1), { type: 'A', x: 13.5, y: 9.5 }];
    const { client, calls } = fakeAnthropic(counter([...grid, ...b3], pass2));
    const out = await run(client, [target('A'), target('B')]);
    const r = out.sheets[0];
    expect(r.placed.filter(p => p.typeKey === 'A').length).toBe(25);
    expect(r.placed.filter(p => p.typeKey === 'B').length).toBe(3);
    expect(r.consistency).toEqual([{ sheetKey: 'p.pdf#1', sheetLabel: sheet.label, typeKey: 'A', why: 'high count', first: 25, second: 25, agreed: 24, onlyFirst: 1, onlySecond: 1, agreement: 0.96 }]);
    expect(r.consistencySuggested!.map(s => [s.pass, Math.round(s.x), Math.round(s.y)])).toEqual([['second', Math.round(pdfPt(13.5, 9.5).x), Math.round(pdfPt(13.5, 9.5).y)]]);
    expect(r.consistencyNotReseen!.map(s => [Math.round(s.x), Math.round(s.y)])).toEqual([[Math.round(pdfPt(6, 4).x), Math.round(pdfPt(6, 4).y)]]);
    const second = calls.filter(c => userText(c).includes('CONSISTENCY PASS'));
    expect(second.length).toBe(1);
    expect(userText(second[0])).not.toMatch(/^- B \|/m);
    // S8 — read at the retry's smaller tile size.
    expect(r.notes.join(' ')).toContain(`shifted tiles, ${retryTileIn(spec.tileIn, spec.limits)}"`);
  });

  it('both passes agree -> nothing suggested, no item, the count stands', async (ctx) => {
    if (!have) return ctx.skip();
    const { client } = fakeAnthropic(counter(grid, grid));
    const r = (await run(client, [target('A')])).sheets[0];
    expect(r.placed.length).toBe(25);
    expect(r.consistency![0]).toMatchObject({ agreed: 25, agreement: 1 });
    expect(r.consistency![0].lowAgreement).toBeUndefined();
    expect(r.consistencySuggested).toEqual([]);
  });

  it('S8 — a failed second pass keeps the first, says so, suggests nothing', async (ctx) => {
    if (!have) return ctx.skip();
    const { client } = fakeAnthropic(counter(grid, 'fail'));
    const out = await run(client, [target('A')]);
    expect(out.sheets[0].placed.length).toBe(25);
    expect(out.sheets[0].consistency).toBeUndefined();
    expect(out.sheets[0].notes.join(' ')).toMatch(/Consistency pass \(shifted tiles\) could not run for A/);
    expect(out.consistency!.warnings.join(' ')).toMatch(/consistency pass failed/);
  });

  it('S8 — a TRUNCATED second pass is a skipped check with a warning, never a failed run', async (ctx) => {
    if (!have) return ctx.skip();
    const { client } = fakeAnthropic(counter(grid, 'truncate'));
    const out = await run(client, [target('A')]);
    expect(out.sheets[0].status).toBe('counted');
    expect(out.sheets[0].placed.length).toBe(25);
    expect(out.sheets[0].notes.join(' ')).toMatch(/Consistency pass \(shifted tiles\) failed .*ran out of room/);
    expect(out.consistency!.warnings.length).toBe(1);
  });

  it('S8 — cached by sheet hash + types + prompt version: a re-run of the same sheet makes no second-pass call', async (ctx) => {
    if (!have) return ctx.skip();
    const store = new Map<string, unknown>();
    const cache: EvidenceCache = {
      async get(sha, page, kind, key) { return store.get(`${sha}|${page}|${kind}|${key}`) ?? null; },
      async set(sha, page, kind, key, v) { store.set(`${sha}|${page}|${kind}|${key}`, v); },
    };
    const pass2 = [...grid.slice(1), { type: 'A', x: 13.5, y: 9.5 }];
    const a = fakeAnthropic(counter(grid, pass2));
    await run(a.client, [target('A')], cache);
    expect([...store.keys()][0]).toMatch(/\|1\|consistency:A:6\.4:SR[^:]+:[0-9a-f]{16}\|claude-opus-5-5\|cs1$/);
    const b = fakeAnthropic(counter(grid, 'fail'));
    const out = await run(b.client, [target('A')], cache);
    expect(b.calls.filter(c => userText(c).includes('CONSISTENCY PASS')).length).toBe(0);
    expect(out.sheets[0].consistency![0]).toMatchObject({ agreed: 24, onlySecond: 1 });
    expect(out.consistency!.cached).toBe(1);
  });

  it('off (no evidence round): one pass only, exactly as before', async (ctx) => {
    if (!have) return ctx.skip();
    const { client, calls } = fakeAnthropic(counter(grid, grid));
    const out = await countSheets({ client, model: 'claude-opus-5-5', maxTokens: 32000, pdfs: new Map([['p.pdf', pdf]]) }, [target('A')], [sheet]);
    expect(calls.length).toBe(1);
    expect(out.consistency).toBeUndefined();
  });
});

describe('the review item and its enforced answers', () => {
  it('one blocking item per check, one member per type; "count" per type, "confirm" keeps the counted (pass-1) number', async () => {
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
