// Live AutoZone run (2026-09-23): the counting stage failed on EVERY plan
// sheet with "TypeError: Cannot perform Construct on a detached ArrayBuffer"
// at renderCountTiles' fs.writeFile. openPdfDocument handed pdf.js a VIEW of
// the pipeline's own Buffer (fix round 1 / B9's zero-copy), and pdf.js
// transfers — detaches — an ArrayBuffer its data fully spans. readPageGeometry
// ran first, so the counter then rendered from a dead buffer.
//
// Earlier tests missed it: every fixture PDF is under 4 KB, and Node serves a
// Buffer that small from its shared 8 KB pool, so pdf.js copied it instead of
// transferring it. These tests use a Buffer that owns its whole ArrayBuffer —
// the shape of a real upload / document (multer, Buffer.concat, base64 of a
// multi-MB set) — and run the real call order on ONE shared Buffer.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { openPdfDocument } from '../estimating/pdfjsLoader';
import { readPageGeometry, renderCountTiles } from '../ai/countRender';
import { isPdftoppmAvailable } from '../ai/documentPrep';

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures/takeoff/kissimmee-mini.pdf'));

/** A Buffer that owns its whole ArrayBuffer, like a real multi-MB upload. */
export function fullSpan(src: Buffer): Buffer {
  const b = Buffer.alloc(src.length);
  src.copy(b);
  return b;
}

let have = false;
beforeAll(async () => { have = await isPdftoppmAvailable(); });

describe('one shared PDF Buffer through pdf.js and then the renderer', () => {
  it('the fixture Buffer is the real-shape one (owns its whole ArrayBuffer)', () => {
    const shared = fullSpan(FIXTURE);
    expect(shared.byteOffset).toBe(0);
    expect(shared.buffer.byteLength).toBe(shared.byteLength);
  });

  it('openPdfDocument never detaches the caller\'s Buffer', async () => {
    const shared = fullSpan(FIXTURE);
    const doc = await openPdfDocument(shared);
    expect(doc.numPages).toBe(4);
    await doc.destroy();
    expect(shared.byteLength).toBe(FIXTURE.length);
    expect(shared.equals(FIXTURE)).toBe(true);
  });

  it('page geometry (pdf.js) and then 300 DPI counting tiles (pdftoppm) from the SAME Buffer, every plan page', async (ctx) => {
    if (!have) return ctx.skip();
    const shared = fullSpan(FIXTURE);
    const geo = await readPageGeometry(shared, [1, 2, 3, 4]);
    expect(geo.size).toBe(4);
    expect(shared.byteLength).toBe(FIXTURE.length);
    for (const page of [2, 3]) {
      const rendered = await renderCountTiles(shared, page, geo.get(page)!);
      expect(rendered.tiles.length).toBeGreaterThan(0);
      expect(rendered.geometryOk).toBe(true);
    }
    // And pdf.js can read it again afterwards (the marker / sheet paths).
    const again = await readPageGeometry(shared, [2]);
    expect(again.get(2)).toEqual(geo.get(2));
  }, 120_000);

  it('opting into transfer (sheet indexing, which never reuses its Buffer) still parses', async () => {
    const own = fullSpan(FIXTURE);
    const doc = await openPdfDocument(own, { transfer: true });
    expect(doc.numPages).toBe(4);
    await doc.destroy();
  });
});
