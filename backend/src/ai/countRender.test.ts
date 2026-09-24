// Takeoff accuracy Task 3 — counting renderer. Pure tile geometry, plus the
// real thing: pdftoppm at 300 DPI on the committed vector test PDF
// (kissimmee-mini.pdf), including a /Rotate 90 page with a non-zero MediaBox
// origin and an inset CropBox. For every drawn symbol we find its dark-pixel
// centroid on the ACTUAL tile image a counter would see, express it the way
// the counter reports it (tile id + normalized x/y), convert back with
// tileToPdfPoint, and require the original PDF coordinate within 1 pt.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  planCountTiles, effectivePxPerIn, groupTilesForCalls, tileToPdfPoint, readPageGeometry, renderCountTiles,
  COUNT_TILE_IN, TITLE_BLOCK_FRAC, type RenderedCountPage, type PageGeometry,
} from './countRender';
import { isPdftoppmAvailable } from './documentPrep';
import { screenPosition } from '../estimating/pageGeometry';
import { buildKissimmeeMiniPdf, buildSymbolPdf, MINI_P2_SYMBOLS, MINI_P3_SYMBOLS, MINI_P2_CROP, MINI_P2_MEDIA } from '../test/fixtures/takeoff/buildSymbolPdf';

const PDF_PATH = path.join(__dirname, '../test/fixtures/takeoff/kissimmee-mini.pdf');

describe('planCountTiles (pure)', () => {
  it('36x24 sheet: 5x4 = 20 tiles, every tile <= 8", >= 1" overlap, title block strip uncovered', () => {
    const tiles = planCountTiles(36, 24);
    expect(tiles).toHaveLength(20);
    for (const t of tiles) {
      expect(t.widthIn).toBeLessThanOrEqual(COUNT_TILE_IN + 1e-9);
      expect(t.heightIn).toBeLessThanOrEqual(COUNT_TILE_IN + 1e-9);
      expect(effectivePxPerIn(t)).toBeGreaterThanOrEqual(190);
    }
    const right = Math.max(...tiles.map(t => t.leftIn + t.widthIn));
    expect(right).toBeCloseTo(36 * (1 - TITLE_BLOCK_FRAC), 9);
    const bottom = Math.max(...tiles.map(t => t.topIn + t.heightIn));
    expect(bottom).toBeCloseTo(24, 9);
    // Neighbouring columns overlap by exactly 1".
    const r1 = tiles.filter(t => t.row === 1).sort((a, b) => a.col - b.col);
    for (let i = 1; i < r1.length; i++) {
      expect(r1[i - 1].leftIn + r1[i - 1].widthIn - r1[i].leftIn).toBeCloseTo(1, 9);
    }
    expect(tiles[0].id).toBe('R1C1');
  });

  it('42x30 sheet exceeds 20 tiles (the tile-group split case)', () => {
    expect(planCountTiles(42, 30).length).toBe(30);
  });

  it('a page smaller than a tile is one tile', () => {
    const t = planCountTiles(8.5, 11 * 0 + 7);
    expect(t).toHaveLength(1);
    expect(t[0].widthIn).toBeCloseTo(8.5 * 0.9, 9);
  });

  it('rejects degenerate sizes', () => {
    expect(planCountTiles(0, 10)).toEqual([]);
  });
});

describe('groupTilesForCalls (pure)', () => {
  const mk = (rows: number, cols: number, bytes = 400_000) =>
    Array.from({ length: rows * cols }, (_, i) => ({ id: `R${Math.floor(i / cols) + 1}C${(i % cols) + 1}`, row: Math.floor(i / cols) + 1, bytes }));

  it('a standard 20-tile sheet is ONE call', () => {
    const g = groupTilesForCalls(mk(4, 5));
    expect(g).toHaveLength(1);
    expect(g[0].tiles).toHaveLength(20);
  });

  it('30 tiles split into whole rows: 4 rows (20) + 1 row... never splitting a row that fits', () => {
    const g = groupTilesForCalls(mk(5, 6));
    expect(g.map(x => x.tiles.length)).toEqual([18, 12]);
    for (const grp of g) {
      const rows = new Set(grp.tiles.map(t => t.row));
      for (const r of rows) expect(grp.tiles.filter(t => t.row === r)).toHaveLength(6);
    }
  });

  it('respects the byte budget (base64-inflated)', () => {
    const g = groupTilesForCalls(mk(4, 5, 2_000_000), 20, 24_000_000);
    for (const grp of g) expect(grp.bytes).toBeLessThanOrEqual(24_000_000);
    expect(g.length).toBeGreaterThan(1);
  });
});

describe('tileToPdfPoint (pure)', () => {
  it('maps a tile-normalized position through the origin- and rotation-aware inverse', () => {
    const geom: PageGeometry = { widthPt: 612, heightPt: 792, originX: 100, originY: 200, rotation: 90 };
    // Displayed point (50,50) is PDF (150,250) at rotation 90 (review numbers).
    const tile = { leftIn: 0, topIn: 0, widthIn: 100 / 72, heightIn: 100 / 72 };
    const p = tileToPdfPoint(tile, 0.5, 0.5, geom);
    expect(p.x).toBeCloseTo(150, 9);
    expect(p.y).toBeCloseTo(250, 9);
  });
});

describe('committed kissimmee-mini.pdf', () => {
  it('matches the generator byte-for-byte (fixture and ground truth cannot drift)', () => {
    expect(fs.readFileSync(PDF_PATH).equals(buildKissimmeeMiniPdf())).toBe(true);
  });
});

/** Dark-pixel centroid within a window of a tile image. */
async function centroid(tileJpeg: Buffer, cx: number, cy: number, halfWin: number): Promise<{ x: number; y: number; n: number }> {
  const { data, info } = await sharp(tileJpeg).grayscale().raw().toBuffer({ resolveWithObject: true });
  let sx = 0, sy = 0, n = 0;
  for (let y = Math.max(0, Math.floor(cy - halfWin)); y < Math.min(info.height, Math.ceil(cy + halfWin)); y++) {
    for (let x = Math.max(0, Math.floor(cx - halfWin)); x < Math.min(info.width, Math.ceil(cx + halfWin)); x++) {
      if (data[y * info.width + x] < 100) { sx += x + 0.5; sy += y + 0.5; n++; }
    }
  }
  return { x: sx / n, y: sy / n, n };
}

describe('renderCountTiles — real pdftoppm, 300 DPI', () => {
  let have = false;
  const pdf = fs.readFileSync(PDF_PATH);
  const rendered = new Map<number, RenderedCountPage>();
  beforeAll(async () => {
    have = await isPdftoppmAvailable();
    if (!have) return;
    const geo = await readPageGeometry(pdf, [2, 3]);
    for (const p of [2, 3]) rendered.set(p, await renderCountTiles(pdf, p, geo.get(p)!));
  }, 120_000);

  it('reads the CropBox geometry of the rotated, offset page from pdf.js', async (ctx) => {
    if (!have) return ctx.skip();
    const g = rendered.get(2)!.geometry;
    expect(g).toEqual({ widthPt: 1224, heightPt: 1656, originX: MINI_P2_CROP[0], originY: MINI_P2_CROP[1], rotation: 90 });
    expect(rendered.get(2)!.geometryOk).toBe(true);
    // Displayed 23" x 17" at 300 DPI.
    expect(rendered.get(2)!.rasterWidthPx).toBe(6900);
    expect(rendered.get(2)!.rasterHeightPx).toBe(5100);
  });

  it('every tile is a JPEG under 5 MB at >= 190 px/in, long edge <= 1568', async (ctx) => {
    if (!have) return ctx.skip();
    for (const r of rendered.values()) {
      expect(r.tiles.length).toBeGreaterThan(1);
      for (const t of r.tiles) {
        expect(t.jpeg.subarray(0, 2).toString('hex')).toBe('ffd8');
        expect(t.bytes).toBeLessThan(5_000_000);
        expect(Math.max(t.imageWidth, t.imageHeight)).toBeLessThanOrEqual(1568);
        expect(t.pxPerIn).toBeGreaterThanOrEqual(190);
      }
    }
  });

  for (const [page, symbols] of [[2, MINI_P2_SYMBOLS], [3, MINI_P3_SYMBOLS]] as const) {
    it(`page ${page}: every symbol's centroid on its tile converts back to its PDF coordinate within 1 pt`, async (ctx) => {
      if (!have) return ctx.skip();
      const r = rendered.get(page)!;
      const g = r.geometry;
      for (const s of symbols) {
        // Where the verified FORWARD transform says the symbol is displayed.
        const d = screenPosition(s.x, s.y, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
        const dIn = { x: d.x / 72, y: d.y / 72 };
        const tile = r.tiles.find(t => dIn.x >= t.leftIn + 0.2 && dIn.x <= t.leftIn + t.widthIn - 0.2 && dIn.y >= t.topIn + 0.2 && dIn.y <= t.topIn + t.heightIn - 0.2);
        expect(tile, `symbol ${s.type} at (${s.x},${s.y}) must be inside a tile`).toBeDefined();
        const sx = tile!.imageWidth / tile!.widthIn;
        const sy = tile!.imageHeight / tile!.heightIn;
        const expectPx = { x: (dIn.x - tile!.leftIn) * sx, y: (dIn.y - tile!.topIn) * sy };
        const c = await centroid(tile!.jpeg, expectPx.x, expectPx.y, 20 / 72 * sx);
        // The square really is there in the raster (14 pt at ~196 px/in).
        expect(c.n).toBeGreaterThan(200);
        const back = tileToPdfPoint(tile!, c.x / tile!.imageWidth, c.y / tile!.imageHeight, g);
        expect(Math.abs(back.x - s.x)).toBeLessThan(1);
        expect(Math.abs(back.y - s.y)).toBeLessThan(1);
      }
    });
  }
});

describe('renderCountTiles — real pdftoppm at /Rotate 180 and 270 (offset MediaBox + inset CropBox)', () => {
  for (const rotate of [180, 270, 0]) {
    it(`rotation ${rotate}: centroid -> tile-normalized -> PDF round trip within 1 pt`, async (ctx) => {
      if (!(await isPdftoppmAvailable())) return ctx.skip();
      const pdf = buildSymbolPdf([{ mediaBox: MINI_P2_MEDIA, cropBox: MINI_P2_CROP, rotate, symbols: MINI_P2_SYMBOLS, texts: [] }]);
      const geo = (await readPageGeometry(pdf, [1])).get(1)!;
      expect(geo.rotation).toBe(rotate);
      const r = await renderCountTiles(pdf, 1, geo);
      expect(r.geometryOk).toBe(true);
      let checked = 0;
      for (const s of MINI_P2_SYMBOLS) {
        const d = screenPosition(s.x, s.y, geo.originX, geo.originY, geo.widthPt, geo.heightPt, geo.rotation);
        const dIn = { x: d.x / 72, y: d.y / 72 };
        const tile = r.tiles.find(t => dIn.x >= t.leftIn + 0.2 && dIn.x <= t.leftIn + t.widthIn - 0.2 && dIn.y >= t.topIn + 0.2 && dIn.y <= t.topIn + t.heightIn - 0.2);
        if (!tile) continue; // a symbol can land in the excluded title-block strip once rotated
        const sx = tile.imageWidth / tile.widthIn;
        const sy = tile.imageHeight / tile.heightIn;
        const c = await centroid(tile.jpeg, (dIn.x - tile.leftIn) * sx, (dIn.y - tile.topIn) * sy, 20 / 72 * sx);
        expect(c.n).toBeGreaterThan(200);
        const back = tileToPdfPoint(tile, c.x / tile.imageWidth, c.y / tile.imageHeight, geo);
        expect(Math.abs(back.x - s.x)).toBeLessThan(1);
        expect(Math.abs(back.y - s.y)).toBeLessThan(1);
        checked++;
      }
      expect(checked).toBeGreaterThanOrEqual(5);
    }, 60_000);
  }
});
