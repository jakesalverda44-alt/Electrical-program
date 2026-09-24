// Next round A5 — counter tiles sized per model, and the dense-area retry,
// on real pdftoppm renders of the Kissimmee-shaped set (a >4 KB PDF in a
// Buffer that owns its ArrayBuffer). No network: a fake client.
import { describe, it, expect, beforeAll } from 'vitest';
import { counterTileSpec, retryTileIn, imageLimitsFor, fitImageToLimits, imageTokens } from './modelLimits';
import { planCountTiles, effectivePxPerIn } from './countRender';
import { isPdftoppmAvailable as isPdftoppmAvailableForTests } from './documentPrep';
import { countSheets } from './countingStage';
import { selectCountSheets } from './countSheets';
import { buildCountTargets } from './countTargets';
import { mergeCountsIntoTakeoff } from './countMerge';
import { buildReviewItems, reviewItemIsOpen, enforcedCounts } from './reviewItems';
import { fakeAnthropic, userText, imageCount, systemText } from '../test/fixtures/takeoff/fakeAnthropic';
import { buildKissimmeeSetPdf, ownedBuffer, KISSIMMEE_SET_CLASSIFIED } from '../test/fixtures/takeoff/kissimmeeSet';

describe('fix round S1 — the API\'s real limits (long edge AND visual tokens), one table', () => {
  it('Claude 4.7+ is high-resolution (2576 px, 4784 tokens); older models standard (1568 px, 1568 tokens)', () => {
    for (const m of ['claude-opus-5-5', 'claude-opus-5-5[1m]', 'anthropic.claude-sonnet-5-20260101-v1:0', 'claude-opus-4-7']) {
      expect(imageLimitsFor(m)).toMatchObject({ tier: 'high', maxLongEdge: 2576, maxTokens: 4784 });
    }
    for (const m of ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929', 'mystery-model']) {
      expect(imageLimitsFor(m)).toMatchObject({ tier: 'standard', maxLongEdge: 1568, maxTokens: 1568 });
    }
  });
  it('tiles are sized so a square tile is >= 196 px/in within the token budget', () => {
    const opus = counterTileSpec('claude-opus-5-5');
    const other = counterTileSpec('claude-sonnet-4-6');
    expect(opus).toMatchObject({ tileIn: 9.8, pxPerIn: 197 });
    expect(other).toMatchObject({ tileIn: 5.5, pxPerIn: 198 });
    expect(planCountTiles(36, 24, { tileIn: opus.tileIn })).toHaveLength(12);
    expect(planCountTiles(36, 24, { tileIn: other.tileIn })).toHaveLength(42);
    for (const [spec, n] of [[opus, 12], [other, 42]] as const) {
      const tiles = planCountTiles(36, 24, { tileIn: spec.tileIn });
      expect(tiles).toHaveLength(n);
      for (const t of tiles) {
        expect(effectivePxPerIn(t, spec.limits)).toBeGreaterThanOrEqual(196);
        const fit = fitImageToLimits(t.widthIn * 300, t.heightIn * 300, spec.limits);
        expect(imageTokens(fit.width, fit.height)).toBeLessThanOrEqual(spec.maxTokens);
        expect(Math.max(fit.width, fit.height)).toBeLessThanOrEqual(spec.maxLongEdge);
      }
    }
  });
  it('the review\'s numbers: the old specs were downscaled by the server', () => {
    // A5 as shipped: 10.5" tiles at 2576 px on Opus (8.85x8.67" actual) -> the server keeps ~216 px/in, not 245.
    const oldOpus = planCountTiles(36, 24, { tileIn: 10.5 })[0];
    expect(Math.round(effectivePxPerIn(oldOpus, counterTileSpec('claude-opus-5-5').limits))).toBeLessThan(220);
    // Standard 8" tiles at 1568 px -> ~148 px/in after the 1568-token cap, not 196.
    const oldStd = planCountTiles(36, 24, { tileIn: 8 })[0];
    expect(Math.round(effectivePxPerIn(oldStd, counterTileSpec('claude-sonnet-4-6').limits))).toBeLessThan(160);
  });
  it('the retry tile is 60% of the first, never smaller than the tile that reaches the 300 DPI raster', () => {
    expect(retryTileIn(9.8)).toBe(5.9);
    expect(retryTileIn(9.8, counterTileSpec('claude-opus-5-5').limits)).toBe(6.4);
    expect(retryTileIn(5.5, counterTileSpec('claude-sonnet-4-6').limits)).toBe(3.6);
    expect(retryTileIn(4)).toBe(3);
  });
});

describe('dense-area retry (real renders)', () => {
  let have = false;
  beforeAll(async () => { have = await isPdftoppmAvailableForTests(); });

  it('a sheet with unreadable symbols is re-counted once at smaller tiles; both passes reported, the retry used', async () => {
    if (!have) return;
    const pdf = ownedBuffer(buildKissimmeeSetPdf());
    const { targets } = buildCountTargets({
      fixtureSchedule: [
        { type: 'A', description: '4 ft LED linear wraparound', wattage: 32, location: 'interior', headsPerPole: 0, symbol: 'square', sourceSheet: 'E-0.1' },
        { type: 'S1', description: 'LED area light single head', wattage: 150, location: 'site', headsPerPole: 1, symbol: 'square', sourceSheet: 'E-0.1' },
      ],
    });
    const inv = KISSIMMEE_SET_CLASSIFIED.map(c => ({ ...c, file: 'set.pdf', included: true }));
    const sel = selectCountSheets(inv).counted.filter(s => s.sheetNo === 'E-3' || s.sheetNo === 'E-1');
    const seen: Record<string, number[]> = {};
    const { client } = fakeAnthropic(req => {
      if (!systemText(req).includes('counting symbols on ONE')) throw new Error('unexpected');
      const t = userText(req);
      const sheet = /SHEET: ([^ ]+)/.exec(t)![1];
      (seen[sheet] ??= []).push(imageCount(req));
      const first = [...t.matchAll(/Tile (R\d+C\d+) \(row/g)][0][1];
      if (sheet === 'E-3' && seen[sheet].length === 1) {
        return { text: JSON.stringify({ marks: [['A', first, 0.2, 0.3]], unreadable: [{ type: 'A', tile: first, note: 'dense strip area — symbols overlap' }], notes: [] }) };
      }
      if (sheet === 'E-3') return { text: JSON.stringify({ marks: [['A', first, 0.1, 0.3], ['A', first, 0.4, 0.3], ['A', first, 0.7, 0.3]], unreadable: [], notes: [] }) };
      return { text: JSON.stringify({ marks: [['S1', first, 0.2, 0.3]], unreadable: [], notes: [] }) };
    });
    const pdfs = new Map([['set.pdf', pdf]]);
    const run = await countSheets({ client, model: 'claude-opus-5-5', maxTokens: 8000, pdfs }, targets, sel);
    // E-3 twice (the retry had more, smaller tiles); E-1 once.
    expect(seen['E-3']).toHaveLength(2);
    expect(seen['E-3'][1]).toBeGreaterThan(seen['E-3'][0]);
    expect(seen['E-1']).toHaveLength(1);
    const e3 = run.sheets.find(r => r.sheet.sheetNo === 'E-3')!;
    expect(e3.retry).toMatchObject({ used: 'retry', firstTileIn: 9.8, tileIn: 6.4, firstCounts: { A: 1 }, firstUnreadable: ['A'], retryCounts: { A: 3 } });
    expect(e3.placed.filter(p => p.typeKey === 'A')).toHaveLength(3);
    expect(e3.unreadable).toEqual([]);
    expect(e3.notes.join(' ')).toContain('A 1→3');
    expect(run.sheets.find(r => r.sheet.sheetNo === 'E-1')!.retry).toBeUndefined();
    expect(pdf.byteLength).toBeGreaterThan(4096); // still attached
  }, 120_000);

  it('a failed retry keeps the first pass (and its unreadable flag) and says why', async () => {
    if (!have) return;
    const pdf = ownedBuffer(buildKissimmeeSetPdf());
    const { targets } = buildCountTargets({ fixtureSchedule: [{ type: 'A', description: '4 ft LED linear wraparound', wattage: 32, location: 'interior', headsPerPole: 0, symbol: 'square', sourceSheet: 'E-0.1' }] });
    const sel = selectCountSheets(KISSIMMEE_SET_CLASSIFIED.map(c => ({ ...c, file: 'set.pdf', included: true }))).counted.filter(s => s.sheetNo === 'E-3');
    let n = 0;
    const { client } = fakeAnthropic(req => {
      n++;
      const first = [...userText(req).matchAll(/Tile (R\d+C\d+) \(row/g)][0][1];
      if (n === 1) return { text: JSON.stringify({ marks: [['A', first, 0.2, 0.3]], unreadable: [{ type: 'A', tile: first, note: 'dense' }], notes: [] }) };
      return { text: 'not json' };
    });
    const run = await countSheets({ client, model: 'claude-sonnet-4-6', maxTokens: 8000, pdfs: new Map([['set.pdf', pdf]]) }, targets, sel);
    const e3 = run.sheets[0];
    expect(e3.status).toBe('counted');
    expect(e3.retry).toMatchObject({ used: 'first', firstTileIn: 5.5, tileIn: 3.6, error: expect.stringContaining('expected shape') });
    expect(e3.unreadable.map(u => u.typeKey)).toEqual(['A']);
  }, 120_000);

  it('fix round S2: only the unreadable types are replaced; a LOWER recount becomes a blocking review item', async () => {
    if (!have) return;
    const pdf = ownedBuffer(buildKissimmeeSetPdf());
    const { targets } = buildCountTargets({ fixtureSchedule: [
      { type: 'A', description: '4 ft LED linear wraparound', wattage: 32, location: 'interior', headsPerPole: 0, symbol: 'square', sourceSheet: 'E-0.1' },
      { type: 'B', description: '8 ft LED linear wraparound', wattage: 64, location: 'interior', headsPerPole: 0, symbol: 'square', sourceSheet: 'E-0.1' },
    ] });
    const sel = selectCountSheets(KISSIMMEE_SET_CLASSIFIED.map(c => ({ ...c, file: 'set.pdf', included: true }))).counted.filter(s => s.sheetNo === 'E-3');
    const asked: string[][] = [];
    let n = 0;
    const { client } = fakeAnthropic(req => {
      n++;
      const t = userText(req);
      asked.push(['A', 'B'].filter(k => new RegExp(`\\b${k} [—-] `).test(t) || t.includes(`${k} — `)));
      const first = [...t.matchAll(/Tile (R\d+C\d+) \(row/g)][0][1];
      const xs = (k: string, c: number) => Array.from({ length: c }, (_, i) => [k, first, 0.05 + i * 0.06, k === 'A' ? 0.3 : 0.7]);
      // First pass: A 5 (read fine), B 6 but unreadable. Retry: B 4 (fewer), A would be 2.
      if (n === 1) return { text: JSON.stringify({ marks: [...xs('A', 5), ...xs('B', 6)], unreadable: [{ type: 'B', tile: first, note: 'dense strips' }], notes: [] }) };
      return { text: JSON.stringify({ marks: [...xs('A', 2), ...xs('B', 4)], unreadable: [], notes: [] }) };
    });
    const run = await countSheets({ client, model: 'claude-opus-5-5', maxTokens: 8000, pdfs: new Map([['set.pdf', pdf]]) }, targets, sel);
    const e3 = run.sheets[0];
    // A keeps the first pass (5); only B takes the recount (4).
    expect(e3.placed.filter(p => p.typeKey === 'A')).toHaveLength(5);
    expect(e3.placed.filter(p => p.typeKey === 'B')).toHaveLength(4);
    expect(e3.retry).toMatchObject({ firstCounts: { B: 6 }, retryCounts: { B: 4 }, lower: [{ typeKey: 'B', first: 6, retry: 4 }] });
    // …and the lower recount is a blocking item, never silently accepted.
    const merged = mergeCountsIntoTakeoff({ fixtureSchedule: [] }, targets, [{ sheet: e3.sheet, status: 'counted', placed: e3.placed, unreadable: e3.unreadable }], { countingRan: true });
    const cr = { version: 2, ran: true, model: 'm', targets, targetNotes: [], sheets: [{ key: e3.sheet.key, label: e3.sheet.label, retry: e3.retry }], skippedSheets: [], types: merged.types, loadCheck: merged.loadCheck, removedRows: [], flags: [], marks: [] };
    const items = buildReviewItems(cr as never);
    const rec = items.find(i => i.id === 'recount:B')!;
    expect(rec).toMatchObject({ kind: 'count', aiCount: 4, actions: ['count', 'confirm'] });
    expect(rec.detail).toContain('first pass 6, recount 4');
    expect(reviewItemIsOpen(rec)).toBe(true);
    expect(enforcedCounts(cr as never, [{ ...rec, resolution: { action: 'count', qty: 6, by: 'J', at: 't' } }]).byType.get('B')).toBe(6);
  }, 120_000);
});

