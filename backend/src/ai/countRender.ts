// Takeoff accuracy, Task 3 — the counting renderer (Decision 3).
//
// Agent 1's plan-class tiles are 16" at 130 DPI (~98 px/in after the vision
// API's 1568 px downscale) — fine for reading a plan's layout, too coarse to
// count symbols (Kissimmee: 0 interior fixtures on E-3). The counter gets
// its own rasters instead:
//
//   * each electrical plan page rendered by pdftoppm at 300 DPI, CropBox,
//     /Rotate applied, grayscale (line-art; halves the raw decode buffer —
//     a 36x24 sheet is 10800x7200 = 78 MB gray vs 233 MB RGB);
//   * the title-block strip (right 10% of the DISPLAYED page) excluded;
//   * cut into overlapping tiles no larger than 8" on either side with
//     >= 1" overlap, so after resizing to fit 1568 px on the long edge each
//     tile lands at >= 1568/8 = 196 px/in (>= 190 px/in, the plan's floor);
//   * each tile JPEG-encoded and kept under the API's 5 MB per-image limit.
//
// 1568 px is the long-edge ceiling of every vision model this setting can
// name (Opus 5.5 accepts up to 2576 px, older models downscale to 1568); the
// tile size is chosen against the LOWER ceiling so the px/in guarantee holds
// whichever counter model Settings selects. See the report for the upside
// left on the table for high-resolution models.
//
// The pure geometry (planCountTiles, tileToPdfPoint, groupTilesForCalls) is
// exported and unit-tested; renderCountTiles is the I/O half and is tested
// against real pdftoppm output on a committed vector PDF.
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { displayedSize, displayedToPdf } from '../estimating/pageGeometry';
import { openPdfDocument } from '../estimating/pdfjsLoader';
import { fitImageToLimits, STANDARD_LIMITS, type ModelImageLimits } from './modelLimits';

const execFileP = promisify(execFile);

export const COUNT_DPI = 300;
export const COUNT_TILE_IN = 8;
export const COUNT_OVERLAP_IN = 1;
/** Right-hand share of the DISPLAYED page treated as the title block and not
 *  counted. Title blocks on 30x42 / 24x36 sets run ~3.5-4.5" (10-12%);
 *  10% errs toward keeping plan content — a sliver of title block left in a
 *  tile is harmless (it holds no fixture symbols), plan content cut off is
 *  not. */
export const TITLE_BLOCK_FRAC = 0.10;
export const COUNT_MAX_LONG_EDGE = 1568;
/** Anthropic per-image limit is 5 MB; stay under it with margin. */
export const MAX_TILE_BYTES = 4_500_000;

export interface PageGeometry {
  /** Unrotated CropBox width/height in PDF points (pdf.js page.view). */
  widthPt: number;
  heightPt: number;
  originX: number;
  originY: number;
  rotation: number;
}

/** A tile's rectangle in DISPLAYED inches, from the displayed page's top-left. */
export interface TileRectIn {
  id: string;
  row: number;
  col: number;
  leftIn: number;
  topIn: number;
  widthIn: number;
  heightIn: number;
}

/** Pure: split one axis of `extentIn` into n spans of equal length <= tileIn
 *  that overlap their neighbours by exactly overlapIn. */
function axisSpans(extentIn: number, tileIn: number, overlapIn: number): Array<{ start: number; len: number }> {
  if (extentIn <= tileIn) return [{ start: 0, len: extentIn }];
  const n = Math.ceil((extentIn - overlapIn) / (tileIn - overlapIn));
  const len = (extentIn + (n - 1) * overlapIn) / n;
  return Array.from({ length: n }, (_, i) => ({ start: i * (len - overlapIn), len }));
}

/** Pure: the tile grid for one displayed page (inches). The right
 *  `titleBlockFrac` of the displayed width is never covered. */
export function planCountTiles(
  displayedWidthIn: number,
  displayedHeightIn: number,
  opts: { tileIn?: number; overlapIn?: number; titleBlockFrac?: number } = {},
): TileRectIn[] {
  const tileIn = opts.tileIn ?? COUNT_TILE_IN;
  const overlapIn = opts.overlapIn ?? COUNT_OVERLAP_IN;
  const frac = opts.titleBlockFrac ?? TITLE_BLOCK_FRAC;
  if (!(displayedWidthIn > 0) || !(displayedHeightIn > 0)) return [];
  const contentW = displayedWidthIn * (1 - frac);
  const cols = axisSpans(contentW, tileIn, overlapIn);
  const rows = axisSpans(displayedHeightIn, tileIn, overlapIn);
  const out: TileRectIn[] = [];
  rows.forEach((r, ri) => cols.forEach((c, ci) => {
    out.push({ id: `R${ri + 1}C${ci + 1}`, row: ri + 1, col: ci + 1, leftIn: c.start, topIn: r.start, widthIn: c.len, heightIn: r.len });
  }));
  return out;
}

/** Pure: effective pixels per inch a tile lands at after the long-edge resize. */
export function effectivePxPerIn(tile: Pick<TileRectIn, 'widthIn' | 'heightIn'>, maxLongEdgeOrLimits: number | ModelImageLimits = COUNT_MAX_LONG_EDGE, dpi = COUNT_DPI): number {
  // Fix round S1 — both API limits (long edge AND visual tokens), from the
  // raster at `dpi`: what the model actually sees.
  const limits: ModelImageLimits = typeof maxLongEdgeOrLimits === 'number'
    ? { tier: 'standard', maxLongEdge: maxLongEdgeOrLimits, maxTokens: Number.MAX_SAFE_INTEGER } : maxLongEdgeOrLimits;
  const w = tile.widthIn * dpi;
  const h = tile.heightIn * dpi;
  const fit = fitImageToLimits(w, h, limits);
  return Math.min(dpi, fit.width / tile.widthIn);
}

/** Pure: a counter-reported position (normalized 0-1 within a tile) to
 *  absolute PDF user-space points, origin- and rotation-aware. */
export function tileToPdfPoint(
  tile: Pick<TileRectIn, 'leftIn' | 'topIn' | 'widthIn' | 'heightIn'>,
  nx: number,
  ny: number,
  geom: PageGeometry,
): { x: number; y: number } {
  const dxPt = (tile.leftIn + nx * tile.widthIn) * 72;
  const dyPt = (tile.topIn + ny * tile.heightIn) * 72;
  return displayedToPdf(dxPt, dyPt, geom.originX, geom.originY, geom.widthPt, geom.heightPt, geom.rotation);
}

/** One call's worth of tiles. */
export interface TileGroup<T> { tiles: T[]; bytes: number }

/** Pure: split a sheet's tiles into as few calls as possible, each within
 *  `maxImages` and `maxBytes` (base64-inflated). Tiles stay in row-major order
 *  and whole ROWS are kept together where they fit, so a call sees
 *  horizontally contiguous plan area; a single row larger than the budget is
 *  itself split. One call per sheet is the norm (a 24x36 sheet is 20 tiles,
 *  ~6-12 MB) — splitting is the exception for oversized sheets. */
export function groupTilesForCalls<T extends { row: number; bytes: number }>(
  tiles: T[],
  maxImages = 20,
  maxBytes = 24_000_000,
): TileGroup<T>[] {
  const b64 = (n: number) => Math.ceil(n / 3) * 4;
  const groups: TileGroup<T>[] = [];
  let cur: TileGroup<T> = { tiles: [], bytes: 0 };
  const push = () => { if (cur.tiles.length) groups.push(cur); cur = { tiles: [], bytes: 0 }; };
  const rows = new Map<number, T[]>();
  for (const t of tiles) { if (!rows.has(t.row)) rows.set(t.row, []); rows.get(t.row)!.push(t); }
  for (const rowTiles of rows.values()) {
    const rowBytes = rowTiles.reduce((s, t) => s + b64(t.bytes), 0);
    const rowFits = rowTiles.length <= maxImages && rowBytes <= maxBytes;
    if (rowFits && (cur.tiles.length + rowTiles.length > maxImages || cur.bytes + rowBytes > maxBytes)) push();
    for (const t of rowTiles) {
      if (cur.tiles.length + 1 > maxImages || cur.bytes + b64(t.bytes) > maxBytes) push();
      cur.tiles.push(t);
      cur.bytes += b64(t.bytes);
    }
  }
  push();
  return groups;
}

// ── I/O ────────────────────────────────────────────────────────────────────

/** pdf.js page geometry (CropBox ∩ MediaBox, rotation) for the given
 *  1-based pages — the same `view` the Phase B viewer and est_sheets use. */
export async function readPageGeometry(pdf: Buffer, pages: number[]): Promise<Map<number, PageGeometry>> {
  const doc = await openPdfDocument(pdf);
  const out = new Map<number, PageGeometry>();
  try {
    for (const p of pages) {
      if (p < 1 || p > doc.numPages) continue;
      const page = await doc.getPage(p);
      const [x0, y0, x1, y1] = page.view;
      out.set(p, {
        widthPt: Math.abs(x1 - x0),
        heightPt: Math.abs(y1 - y0),
        originX: Math.min(x0, x1),
        originY: Math.min(y0, y1),
        rotation: ((page.rotate % 360) + 360) % 360,
      });
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

export interface CountTile extends TileRectIn {
  jpeg: Buffer;
  bytes: number;
  imageWidth: number;
  imageHeight: number;
  pxPerIn: number;
}

export interface RenderedCountPage {
  page: number;
  geometry: PageGeometry;
  tiles: CountTile[];
  /** False when the raster's size disagrees with pdf.js's displayed size by
   *  more than 1% — counts are still usable, marker positions are not. */
  geometryOk: boolean;
  rasterWidthPx: number;
  rasterHeightPx: number;
}

async function encodeTile(raw: Buffer, width: number, height: number, rect: { left: number; top: number; width: number; height: number }, limits: ModelImageLimits): Promise<{ jpeg: Buffer; w: number; h: number }> {
  // Fix round S1 — sent at exactly the size the server keeps (long edge AND
  // visual tokens), so no tile is downscaled after it leaves us.
  const fit = fitImageToLimits(rect.width, rect.height, limits);
  for (const quality of [85, 72, 60, 48]) {
    const { data, info } = await sharp(raw, { raw: { width, height, channels: 1 } })
      .extract(rect)
      .resize({ width: fit.width, height: fit.height, fit: 'fill', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer({ resolveWithObject: true });
    if (data.length <= MAX_TILE_BYTES) return { jpeg: data, w: info.width, h: info.height };
  }
  throw new Error('count tile could not be encoded under the 5 MB per-image limit');
}

/** Render one page at 300 DPI and cut its counting tiles. Throws if
 *  pdftoppm fails — the caller records the sheet as not counted. */
export async function renderCountTiles(
  pdf: Buffer,
  page: number,
  geometry: PageGeometry,
  opts: { dpi?: number; maxLongEdge?: number; maxTokens?: number; limits?: ModelImageLimits; tileIn?: number; overlapIn?: number; titleBlockFrac?: number } = {},
): Promise<RenderedCountPage> {
  const dpi = opts.dpi ?? COUNT_DPI;
  const limits: ModelImageLimits = opts.limits ?? {
    tier: 'standard', maxLongEdge: opts.maxLongEdge ?? COUNT_MAX_LONG_EDGE, maxTokens: opts.maxTokens ?? STANDARD_LIMITS.maxTokens,
  };
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'apt-count-'));
  try {
    const pdfPath = path.join(tmp, 'in.pdf');
    await fs.writeFile(pdfPath, pdf);
    await execFileP('pdftoppm', ['-gray', '-png', '-cropbox', '-r', String(dpi), '-f', String(page), '-l', String(page), pdfPath, path.join(tmp, 'pg')], { maxBuffer: 1024 * 1024 });
    const file = (await fs.readdir(tmp)).find(f => f.endsWith('.png'));
    if (!file) throw new Error(`pdftoppm produced no raster for page ${page}`);
    const { data: raw, info } = await sharp(path.join(tmp, file), { limitInputPixels: 400_000_000 })
      .grayscale().raw().toBuffer({ resolveWithObject: true });
    // .grayscale() guarantees 1 channel even if a build emits gray+alpha.
    const width = info.width;
    const height = info.height;
    const shown = displayedSize(geometry.widthPt, geometry.heightPt, geometry.rotation);
    const expectW = (shown.width * dpi) / 72;
    const expectH = (shown.height * dpi) / 72;
    const geometryOk = Math.abs(width - expectW) / expectW <= 0.01 && Math.abs(height - expectH) / expectH <= 0.01;
    const pxPerInX = width / (shown.width / 72);
    const pxPerInY = height / (shown.height / 72);

    const rects = planCountTiles(shown.width / 72, shown.height / 72, opts);
    const tiles: CountTile[] = [];
    for (const r of rects) {
      const left = Math.max(0, Math.round(r.leftIn * pxPerInX));
      const top = Math.max(0, Math.round(r.topIn * pxPerInY));
      const w = Math.min(width - left, Math.round(r.widthIn * pxPerInX));
      const h = Math.min(height - top, Math.round(r.heightIn * pxPerInY));
      if (w <= 0 || h <= 0) continue;
      const { jpeg, w: iw, h: ih } = await encodeTile(raw, width, height, { left, top, width: w, height: h }, limits);
      // Re-derive the tile's inch rect from the ROUNDED pixel rect so the
      // tile->PDF conversion uses exactly the area the image shows.
      tiles.push({
        ...r,
        leftIn: left / pxPerInX, topIn: top / pxPerInY, widthIn: w / pxPerInX, heightIn: h / pxPerInY,
        jpeg, bytes: jpeg.length, imageWidth: iw, imageHeight: ih,
        pxPerIn: iw / (w / pxPerInX),
      });
    }
    return { page, geometry, tiles, geometryOk, rasterWidthPx: width, rasterHeightPx: height };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
