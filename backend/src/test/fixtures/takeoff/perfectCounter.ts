// Takeoff accuracy — a fake Agent 1C that answers like a PERFECT counter:
// every drawn symbol of the named sheet reported in EVERY tile of the call
// whose area contains it (overlap bands included), positions exact. Used to
// prove the de-dup and the tile->PDF conversion bring the counts back to the
// ground truth on real pdftoppm tiles.
import { screenPosition } from '../../../estimating/pageGeometry';
import type { RenderedCountPage } from '../../../ai/countRender';
import type { SymbolSpec } from './buildSymbolPdf';
import { userText, type FakeRequest, type FakeReply } from './fakeAnthropic';

export type CounterTruth = Record<string, { rendered: RenderedCountPage; symbols: SymbolSpec[] }>;

/** Seeded PRNG + Gaussian (xorshift32 + Box-Muller) for jittered counters. */
export function seededGauss(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32; };
  for (let i = 0; i < 8; i++) u();
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** Fix round 1 / S17 — like perfectCounter, but every reported position is
 *  off by Gaussian noise of `sd` (a fraction of the tile, e.g. 0.02), each
 *  report independently, as a real model's placement would be. */
export function jitteredCounter(truth: CounterTruth, sd: number, seed = 1) {
  const g = seededGauss(seed);
  return (req: FakeRequest): FakeReply => {
    const exact = perfectCounter(truth)(req);
    const body = JSON.parse(exact.text!) as { marks: Array<[string, string, number, number]> };
    body.marks = body.marks.map(([t, id, x, y]) => [t, id,
      Number(Math.min(1, Math.max(0, x + g() * sd)).toFixed(3)),
      Number(Math.min(1, Math.max(0, y + g() * sd)).toFixed(3))]);
    return { text: JSON.stringify(body) };
  };
}

export function perfectCounter(truth: CounterTruth) {
  return (req: FakeRequest): FakeReply => {
    const text = userText(req);
    const sheet = Object.keys(truth).find(label => text.includes(`SHEET: ${label}`));
    if (!sheet) throw new Error(`perfectCounter: no truth for request: ${text.slice(0, 120)}`);
    const { rendered, symbols } = truth[sheet];
    const g = rendered.geometry;
    const ids = [...text.matchAll(/Tile (R\d+C\d+) \(row/g)].map(m => m[1]);
    const marks: unknown[] = [];
    for (const s of symbols) {
      const d = screenPosition(s.x, s.y, g.originX, g.originY, g.widthPt, g.heightPt, g.rotation);
      for (const id of ids) {
        const t = rendered.tiles.find(x => x.id === id)!;
        const nx = (d.x / 72 - t.leftIn) / t.widthIn;
        const ny = (d.y / 72 - t.topIn) / t.heightIn;
        if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) marks.push([s.type, id, Number(nx.toFixed(3)), Number(ny.toFixed(3))]);
      }
    }
    return { text: JSON.stringify({ marks, unreadable: [], notes: [] }) };
  };
}
