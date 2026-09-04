import { describe, it, expect } from 'vitest';
import {
  classifySheet, computePrepFidelity,
  contiguousPageRanges, computeTileGrid, tileSettingsFor, parseTileOverrideSetting,
  TILE_DPI_MIN, TILE_DPI_MAX, TILE_COUNT_MIN, TILE_COUNT_MAX,
} from './documentPrep';

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
