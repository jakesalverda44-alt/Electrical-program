// Next round A5 — counter tiles sized per model, and the dense-area retry,
// on real pdftoppm renders of the Kissimmee-shaped set (a >4 KB PDF in a
// Buffer that owns its ArrayBuffer). No network: a fake client.
import { describe, it, expect, beforeAll } from 'vitest';
import { counterTileSpec, retryTileIn, imageLimitsFor } from './modelLimits';
import { planCountTiles, effectivePxPerIn } from './countRender';
import { isPdftoppmAvailable as isPdftoppmAvailableForTests } from './documentPrep';
import { countSheets } from './countingStage';
import { selectCountSheets } from './countSheets';
import { buildCountTargets } from './countTargets';
import { fakeAnthropic, userText, imageCount, systemText } from '../test/fixtures/takeoff/fakeAnthropic';
import { buildKissimmeeSetPdf, ownedBuffer, KISSIMMEE_SET_CLASSIFIED } from '../test/fixtures/takeoff/kissimmeeSet';

describe('model -> image limits, one table', () => {
  it('Opus 5.5 takes 2576 px; every other model 1568 px', () => {
    expect(imageLimitsFor('claude-opus-5-5').maxLongEdge).toBe(2576);
    expect(imageLimitsFor('claude-sonnet-4-6').maxLongEdge).toBe(1568);
    expect(imageLimitsFor('claude-haiku-4-5-20251001').maxLongEdge).toBe(1568);
  });
  it('counter tiles: fewer AND sharper on Opus 5.5, unchanged elsewhere', () => {
    const opus = counterTileSpec('claude-opus-5-5');
    const other = counterTileSpec('claude-sonnet-4-6');
    expect(other).toEqual({ maxLongEdge: 1568, tileIn: 8, pxPerIn: 196 });
    expect(opus.maxLongEdge).toBe(2576);
    expect(opus.tileIn).toBe(10.5);
    // 36x24 sheet: 20 tiles at 8", 12 at 10.5".
    expect(planCountTiles(36, 24, { tileIn: other.tileIn })).toHaveLength(20);
    const big = planCountTiles(36, 24, { tileIn: opus.tileIn });
    expect(big).toHaveLength(12);
    for (const t of big) expect(effectivePxPerIn(t, opus.maxLongEdge)).toBeGreaterThanOrEqual(240);
    for (const t of planCountTiles(36, 24, { tileIn: other.tileIn })) expect(effectivePxPerIn(t, other.maxLongEdge)).toBeGreaterThanOrEqual(190);
  });
  it('the retry tile is 60% of the first (never under 5")', () => {
    expect(retryTileIn(10.5)).toBe(6.3);
    expect(retryTileIn(8)).toBe(5);
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
    expect(e3.retry).toMatchObject({ used: 'retry', firstTileIn: 10.5, tileIn: 6.3, firstCounts: { A: 1 }, firstUnreadable: ['A'], retryCounts: { A: 3 } });
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
    expect(e3.retry).toMatchObject({ used: 'first', firstTileIn: 8, tileIn: 5, error: expect.stringContaining('expected shape') });
    expect(e3.unreadable.map(u => u.typeKey)).toEqual(['A']);
  }, 120_000);
});
