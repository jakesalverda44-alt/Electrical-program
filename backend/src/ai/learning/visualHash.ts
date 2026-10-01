// Level 2 learning, Task 9 — a 64-bit difference hash of a symbol crop's
// centre (the 0.6" core, so nearby walls and text weigh little), and the
// clusters of near-identical crops. A cluster that holds two different
// verified meanings is "conflicted": its examples are then used only on a
// strict meaning match. A false "same cluster" only RESTRICTS use (safe).
import sharp from 'sharp';

/** The stored crop is 1.2" square at 300 DPI (360 px); the core is 0.6". */
export const CROP_DPI = 300;
export const CROP_HALF_IN = 0.6;
export const CORE_FRAC = 0.5;

export async function dhash64(png: Buffer): Promise<bigint> {
  const meta = await sharp(png).metadata();
  const w = meta.width ?? 0, h = meta.height ?? 0;
  const cw = Math.max(9, Math.round(w * CORE_FRAC)), ch = Math.max(8, Math.round(h * CORE_FRAC));
  const left = Math.max(0, Math.round((w - cw) / 2)), top = Math.max(0, Math.round((h - ch) / 2));
  const { data } = await sharp(png).extract({ left, top, width: Math.min(cw, w - left), height: Math.min(ch, h - top) })
    .grayscale().resize(9, 8, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    bits = (bits << 1n) | (data[y * 9 + x] > data[y * 9 + x + 1] ? 1n : 0n);
  }
  return BigInt.asIntN(64, bits);
}

export function hamming(a: bigint, b: bigint): number {
  let x = BigInt.asUintN(64, a ^ b), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

export interface ClusterInput { id: string; dhash: bigint; deviceClass: string | null; meaningFp: string }
export interface Cluster { ids: string[]; conflicted: boolean }

/** Union-find over pairs within `maxHamming`. */
export function clusterOf(examples: ClusterInput[], maxHamming = 10): Map<string, Cluster> {
  const parent = examples.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < examples.length; i++) for (let j = i + 1; j < examples.length; j++) {
    if (hamming(examples[i].dhash, examples[j].dhash) <= maxHamming) parent[find(i)] = find(j);
  }
  const groups = new Map<number, number[]>();
  examples.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); });
  const out = new Map<string, Cluster>();
  for (const idx of groups.values()) {
    const meanings = new Set(idx.map(i => `${examples[i].deviceClass}|${examples[i].meaningFp}`));
    const c: Cluster = { ids: idx.map(i => examples[i].id), conflicted: meanings.size > 1 };
    for (const i of idx) out.set(examples[i].id, c);
  }
  return out;
}
