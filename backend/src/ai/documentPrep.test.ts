import { describe, it, expect } from 'vitest';
import {
  classifySheet, buildAgent1Content, isPdftoppmAvailable, computePrepFidelity,
  contiguousPageRanges, computeTileGrid, tileSettingsFor, parseTileOverrideSetting,
  TILE_DPI_MIN, TILE_DPI_MAX, TILE_COUNT_MIN, TILE_COUNT_MAX, type PrepFile,
} from './documentPrep';
import { isPdftotextAvailable, PAGE_TEXT_CAP, TOTAL_TEXT_CAP } from './pdfText';
import { buildTestPdf } from '../test/fixtures/buildTestPdf';

describe('classifySheet', () => {
  it('flags dense schedule sheets', () => {
    expect(classifySheet('E-601 Panel Schedule.pdf')).toBe('schedule');
    expect(classifySheet('one-line-diagram.pdf')).toBe('schedule');
    expect(classifySheet('MCC Motor Control.pdf')).toBe('schedule');
    expect(classifySheet('Luminaire Fixture Schedule.pdf')).toBe('schedule');
  });

  it('flags plan sheets', () => {
    expect(classifySheet('E-201 Lighting-Plan.pdf')).toBe('plan');
    expect(classifySheet('Photometric.pdf')).toBe('plan');
  });

  it('flags detail/legend sheets', () => {
    expect(classifySheet('E-001 Legend and Notes.pdf')).toBe('detail');
    expect(classifySheet('Electrical Details.pdf')).toBe('detail');
  });

  it('defaults unknown electrical sheets to schedule (safer = more detail)', () => {
    expect(classifySheet('E-501.pdf')).toBe('schedule');
  });
});

describe('buildAgent1Content', () => {
  it('passes standard images through with a valid Claude media type', async () => {
    const files: PrepFile[] = [{ filename: 'site.png', buffer: Buffer.from('x'), ext: 'png' }];
    const blocks = await buildAgent1Content(files);
    const img = blocks.find(b => b.type === 'image');
    expect(img).toBeDefined();
    expect(img?.type === 'image' && img.source.type === 'base64' && img.source.media_type).toBe('image/png');
  });

  it('orders schedule sheets before plans, each labeled', async () => {
    const files: PrepFile[] = [
      { filename: 'E-201 Lighting-Plan.png', buffer: Buffer.from('a'), ext: 'png' },
      { filename: 'E-601 Panel Schedule.png', buffer: Buffer.from('b'), ext: 'png' },
    ];
    const blocks = await buildAgent1Content(files);
    const labels = blocks.filter(b => b.type === 'text').map(b => (b.type === 'text' ? b.text : ''));
    expect(labels[0]).toContain('Panel Schedule');
    expect(labels[0]).toContain('(schedule)');
    expect(labels[1]).toContain('Lighting-Plan');
    expect(labels[1]).toContain('(plan)');
  });

  it('falls back to a document block for PDFs when pdftoppm is unavailable', async () => {
    // In CI/dev without poppler-utils this exercises the graceful fallback path.
    if (await isPdftoppmAvailable()) return; // skip where poppler is actually installed
    const files: PrepFile[] = [{ filename: 'E-601 Panel Schedule.pdf', buffer: Buffer.from('%PDF-1.4'), ext: 'pdf' }];
    const blocks = await buildAgent1Content(files);
    expect(blocks.some(b => b.type === 'document')).toBe(true);
    expect(blocks.some(b => b.type === 'image')).toBe(false);
  });
});

// Task 2 (phase 2 takeoff fidelity): text-extract first — pdftotext runs before
// tiling and a per-page EXTRACTED TEXT block is inserted ahead of that page's
// tiles whenever the sheet has enough real text to matter. Poppler is installed
// on this dev Mac (verified 2026-09-02, poppler 26.08) so these run for real
// rather than skip; they still gate on availability so a machine without
// poppler-utils skips cleanly instead of failing.
describe('buildAgent1Content — text-extract-first (Task 1)', () => {
  async function popplerReady() {
    return (await isPdftoppmAvailable()) && (await isPdftotextAvailable());
  }

  it('inserts an EXTRACTED TEXT block before that page\'s tiles for a text-rich page', async (ctx) => {
    if (!(await popplerReady())) return ctx.skip();
    // ASCII only — buildTestPdf writes latin1 PDF string literals, and non-ASCII
    // (e.g. an em dash) corrupts the content stream and truncates extraction.
    const richText = 'PANEL SCHEDULE - PANEL A: 225A 3PH 4W, FED FROM MDP, LOCATION ELEC ROOM 101. '.repeat(4);
    expect(richText.length).toBeGreaterThanOrEqual(200);
    const files: PrepFile[] = [{ filename: 'E-601 Panel Schedule.pdf', buffer: buildTestPdf([richText]), ext: 'pdf' }];
    const blocks = await buildAgent1Content(files);

    const textBlockIdx = blocks.findIndex(
      b => b.type === 'text' && b.text.includes('EXTRACTED TEXT (machine-read, treat as FIRM source)')
    );
    const firstImageIdx = blocks.findIndex(b => b.type === 'image');
    expect(textBlockIdx).toBeGreaterThan(-1);
    expect(firstImageIdx).toBeGreaterThan(-1);
    expect(textBlockIdx).toBeLessThan(firstImageIdx); // block ordering: text before tiles for the same page
    expect((blocks[textBlockIdx] as { text: string }).text).toContain('PANEL A: 225A 3PH');
  });

  it('skips the text block for a page under the 200-char gate (raster/drawing-only)', async (ctx) => {
    if (!(await popplerReady())) return ctx.skip();
    const sparseText = 'E-201'; // well under 200 chars — a title-block-only / drawing-only page
    const files: PrepFile[] = [{ filename: 'E-201 Lighting-Plan.pdf', buffer: buildTestPdf([sparseText]), ext: 'pdf' }];
    const blocks = await buildAgent1Content(files);

    expect(blocks.some(b => b.type === 'text' && b.text.includes('EXTRACTED TEXT'))).toBe(false);
    expect(blocks.some(b => b.type === 'image')).toBe(true); // tiles are still produced regardless
  });

  it('caps a single page\'s extracted text at PAGE_TEXT_CAP with a visible marker', async (ctx) => {
    if (!(await popplerReady())) return ctx.skip();
    const hugeText = 'Q'.repeat(PAGE_TEXT_CAP + 1000);
    const files: PrepFile[] = [{ filename: 'E-601 Panel Schedule.pdf', buffer: buildTestPdf([hugeText]), ext: 'pdf' }];
    const blocks = await buildAgent1Content(files);

    const textBlock = blocks.find(b => b.type === 'text' && b.text.includes('EXTRACTED TEXT')) as { text: string } | undefined;
    expect(textBlock).toBeDefined();
    expect(textBlock!.text).toContain('[TEXT TRUNCATED]');
    expect(textBlock!.text.length).toBeLessThan(hugeText.length);
  }, 20_000);

  it('caps total extracted text across the run at TOTAL_TEXT_CAP with one omitted marker', async (ctx) => {
    if (!(await popplerReady())) return ctx.skip();
    // 14 pages at ~14k chars each (over the per-page cap, so each contributes
    // ~PAGE_TEXT_CAP to the running total) comfortably exceeds the 150k total cap.
    const pageText = 'R'.repeat(PAGE_TEXT_CAP + 2000);
    const pages = Array.from({ length: 14 }, () => pageText);
    const files: PrepFile[] = [{ filename: 'E-601 Panel Schedule.pdf', buffer: buildTestPdf(pages), ext: 'pdf' }];
    const blocks = await buildAgent1Content(files);

    const textBlocks = blocks.filter(b => b.type === 'text' && b.text.includes('EXTRACTED TEXT')) as { text: string }[];
    const omittedMarkers = blocks.filter(b => b.type === 'text' && b.text === '[additional page text omitted — cap reached]');
    expect(omittedMarkers).toHaveLength(1); // exactly one marker, not one per remaining page
    const totalChars = textBlocks.reduce((sum, b) => sum + b.text.length, 0);
    expect(totalChars).toBeLessThanOrEqual(TOTAL_TEXT_CAP);
    expect(textBlocks.length).toBeLessThan(pages.length); // some pages' text was genuinely dropped
  }, 30_000);
});

describe('computePrepFidelity (pure)', () => {
  it('is tiled+text when both poppler tools are present', () => {
    expect(computePrepFidelity(true, true)).toBe('tiled+text');
  });
  it('is tiled when rasterization works but text extraction does not', () => {
    expect(computePrepFidelity(true, false)).toBe('tiled');
  });
  it('is document-fallback when rasterization is unavailable, text extraction or not', () => {
    expect(computePrepFidelity(false, true)).toBe('document-fallback');
    expect(computePrepFidelity(false, false)).toBe('document-fallback');
  });
});

describe('contiguousPageRanges (pure)', () => {
  it('groups consecutive pages into one range', () => {
    expect(contiguousPageRanges([1, 2, 3])).toEqual([[1, 3]]);
  });
  it('splits non-consecutive pages into separate ranges', () => {
    expect(contiguousPageRanges([1, 3, 4, 8])).toEqual([[1, 1], [3, 4], [8, 8]]);
  });
  it('de-dupes and sorts unordered input', () => {
    expect(contiguousPageRanges([5, 2, 2, 3])).toEqual([[2, 3], [5, 5]]);
  });
});

// Task 2 (phase 2 takeoff fidelity): page-level selection from pageClassifier.ts
// replaces the whole-file filename label/class with each selected page's real
// sheet identity, and pages the classifier excluded are never tiled at all.
describe('buildAgent1Content — page-level selection (Task 2)', () => {
  async function popplerReady() {
    return (await isPdftoppmAvailable()) && (await isPdftotextAvailable());
  }

  it('labels each selected page with its real sheet identity, not the filename', async (ctx) => {
    if (!(await popplerReady())) return ctx.skip();
    const pdf = buildTestPdf(['page one content', 'page two content', 'page three content']);
    const files: PrepFile[] = [{
      filename: 'combined-set.pdf',
      buffer: pdf,
      ext: 'pdf',
      pageSelection: [
        { page: 1, label: 'E1.1 "Panel Schedules"', cls: 'schedule' },
        { page: 3, label: 'E2.1 "Lighting Plan"', cls: 'plan' },
      ],
    }];
    const blocks = await buildAgent1Content(files);

    const labels = blocks.filter(b => b.type === 'text' && b.text.startsWith('--- Sheet')).map(b => (b as { text: string }).text);
    expect(labels.some(l => l.includes('E1.1 "Panel Schedules"') && l.includes('(schedule)'))).toBe(true);
    expect(labels.some(l => l.includes('E2.1 "Lighting Plan"') && l.includes('(plan)'))).toBe(true);
    // No generic whole-file label — page-level labels replace it entirely.
    expect(labels.some(l => l.includes('combined-set.pdf'))).toBe(false);
  });

  it('never tiles a page the classifier excluded', async (ctx) => {
    if (!(await popplerReady())) return ctx.skip();
    const pdf = buildTestPdf(['ONLY PAGE ONE SHOULD BE TILED', 'this page must never be tiled']);
    const files: PrepFile[] = [{
      filename: 'combined-set.pdf',
      buffer: pdf,
      ext: 'pdf',
      pageSelection: [{ page: 1, label: 'E1.1', cls: 'schedule' }],
    }];
    const blocks = await buildAgent1Content(files);

    const imageCount = blocks.filter(b => b.type === 'image').length;
    expect(imageCount).toBeGreaterThan(0);
    // Exactly one sheet label (page 1's) — page 2 produced no label, no text, no tiles.
    const sheetLabels = blocks.filter(b => b.type === 'text' && b.text.startsWith('--- Sheet')).map(b => (b as { text: string }).text);
    expect(sheetLabels).toHaveLength(1);
    expect(sheetLabels[0]).toContain('E1.1');
  });

  it('falls back to whole-file behavior when pageSelection is absent', async (ctx) => {
    if (!(await popplerReady())) return ctx.skip();
    const pdf = buildTestPdf(['page one', 'page two']);
    const files: PrepFile[] = [{ filename: 'no-classification.pdf', buffer: pdf, ext: 'pdf' }];
    const blocks = await buildAgent1Content(files);
    const labels = blocks.filter(b => b.type === 'text' && b.text.startsWith('--- Sheet')).map(b => (b as { text: string }).text);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain('no-classification.pdf');
  });
});

// Task 3 (phase 2 takeoff fidelity): the fidelity math. Every tile downscales to
// 1568px on the long edge (the Anthropic vision API's ceiling), so effective
// legibility is 1568/tileInches px/in — smaller tiles is the only lever that
// actually gains resolution. See tileSettingsFor's defaults: schedule 8"/DPI 200,
// detail 12"/DPI 170, plan 16"/DPI 130.
describe('computeTileGrid (pure grid math)', () => {
  it('grids a 36x24 sheet at schedule targets into a 5x3 grid (15 tiles)', () => {
    const { tileInches, dpi, maxTilesPerPage } = tileSettingsFor('schedule');
    const widthPx = 36 * dpi;
    const heightPx = 24 * dpi;
    const tilePx = Math.round(tileInches * dpi);
    expect(computeTileGrid(widthPx, heightPx, tilePx, maxTilesPerPage)).toEqual({ cols: 5, rows: 3 });
  });

  it('grids a 36x24 sheet at detail targets into a 3x2 grid, well under the cap', () => {
    const { tileInches, dpi, maxTilesPerPage } = tileSettingsFor('detail');
    const widthPx = 36 * dpi;
    const heightPx = 24 * dpi;
    const tilePx = Math.round(tileInches * dpi);
    const grid = computeTileGrid(widthPx, heightPx, tilePx, maxTilesPerPage);
    expect(grid).toEqual({ cols: 3, rows: 2 });
    expect(grid.cols * grid.rows).toBeLessThanOrEqual(maxTilesPerPage);
  });

  it('grids a 36x24 sheet at plan targets into a 3x2 grid, exactly at the cap', () => {
    const { tileInches, dpi, maxTilesPerPage } = tileSettingsFor('plan');
    const widthPx = 36 * dpi;
    const heightPx = 24 * dpi;
    const tilePx = Math.round(tileInches * dpi);
    const grid = computeTileGrid(widthPx, heightPx, tilePx, maxTilesPerPage);
    expect(grid).toEqual({ cols: 3, rows: 2 });
    expect(grid.cols * grid.rows).toBe(maxTilesPerPage);
  });

  it('shrink loop respects the cap even when the natural grid wildly exceeds it', () => {
    const grid = computeTileGrid(1000, 500, 10, 3); // naive 100x50 = 5000 tiles
    expect(grid.cols * grid.rows).toBeLessThanOrEqual(3);
    expect(grid.cols).toBeGreaterThanOrEqual(1);
    expect(grid.rows).toBeGreaterThanOrEqual(1);
  });

  it('never shrinks below a 1x1 grid, even with a maxTilesPerPage of 1', () => {
    expect(computeTileGrid(100, 100, 10, 1)).toEqual({ cols: 1, rows: 1 });
  });
});

describe('tileSettingsFor (pure per-class defaults + overrides)', () => {
  it('returns the fixed Task 3 defaults for each class with no overrides', () => {
    expect(tileSettingsFor('schedule')).toEqual({ tileInches: 8, maxTilesPerPage: 15, dpi: 200 });
    expect(tileSettingsFor('detail')).toEqual({ tileInches: 12, maxTilesPerPage: 9, dpi: 170 });
    expect(tileSettingsFor('plan')).toEqual({ tileInches: 16, maxTilesPerPage: 6, dpi: 130 });
  });

  it('applies a DPI/maxTilesPerPage override without touching tileInches (not settings-configurable)', () => {
    const settings = tileSettingsFor('schedule', { schedule: { dpi: 250, maxTilesPerPage: 20 } });
    expect(settings).toEqual({ tileInches: 8, maxTilesPerPage: 20, dpi: 250 });
  });

  it('leaves a class with no matching override entry at its defaults', () => {
    expect(tileSettingsFor('detail', { schedule: { dpi: 250 } })).toEqual({ tileInches: 12, maxTilesPerPage: 9, dpi: 170 });
  });

  it('applies a partial override (dpi only) without clobbering maxTilesPerPage', () => {
    expect(tileSettingsFor('plan', { plan: { dpi: 100 } })).toEqual({ tileInches: 16, maxTilesPerPage: 6, dpi: 100 });
  });
});

describe('parseTileOverrideSetting (pure — config clamps)', () => {
  it('clamps a DPI setting within TILE_DPI_MIN/MAX', () => {
    expect(parseTileOverrideSetting('400', TILE_DPI_MIN, TILE_DPI_MAX)).toBe(TILE_DPI_MAX);
    expect(parseTileOverrideSetting('10', TILE_DPI_MIN, TILE_DPI_MAX)).toBe(TILE_DPI_MIN);
    expect(parseTileOverrideSetting('180', TILE_DPI_MIN, TILE_DPI_MAX)).toBe(180);
  });

  it('clamps a tile-count setting within TILE_COUNT_MIN/MAX', () => {
    expect(parseTileOverrideSetting('99', TILE_COUNT_MIN, TILE_COUNT_MAX)).toBe(TILE_COUNT_MAX);
    expect(parseTileOverrideSetting('0', TILE_COUNT_MIN, TILE_COUNT_MAX)).toBe(TILE_COUNT_MIN);
    expect(parseTileOverrideSetting('10', TILE_COUNT_MIN, TILE_COUNT_MAX)).toBe(10);
  });

  it('returns undefined (no override) for an empty setting — never a hardcoded fallback', () => {
    expect(parseTileOverrideSetting('', TILE_DPI_MIN, TILE_DPI_MAX)).toBeUndefined();
    expect(parseTileOverrideSetting('   ', TILE_DPI_MIN, TILE_DPI_MAX)).toBeUndefined();
  });

  it('returns undefined for a non-numeric setting rather than throwing', () => {
    expect(parseTileOverrideSetting('not-a-number', TILE_DPI_MIN, TILE_DPI_MAX)).toBeUndefined();
  });
});
