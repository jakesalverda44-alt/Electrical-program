// Level 2 learning, Task 14 — the release gate.
//
// A. CI gate (deterministic, no model): the counter's requests with an empty
//    bank are byte-identical to the committed baseline (a sha256 per counter
//    request); with a bank injected, the replayed count result (minus
//    `learning`), the review items (minus lessonHints / suggested) and the
//    enforced counts are identical — examples and lessons cannot change a
//    count directly; the prompt budget and leakage rules hold.
// B. Model effect (RECORDED-LIVE, Jake's button only — L-D2): worse-of-2
//    per arm; for every non-disputed expected item B's worse repeat is no
//    further from the expected value than A's worse repeat; no pass -> fail;
//    the review "asked" count does not rise. Disputed items are reported,
//    never gated. With no cross-job labels the bank is empty and the gate
//    reports "no change" (L-D1: Jake chose no labelling session).
import crypto from 'crypto';
import type { FakeRequest } from '../test/fixtures/takeoff/fakeAnthropic';
import type { EvalDiff } from './takeoffEval';

const isCounter = (req: FakeRequest) => {
  const s = req.system;
  const text = typeof s === 'string' ? s : Array.isArray(s) ? s.map(b => (b as { text?: string }).text ?? '').join('\n') : '';
  return text.includes('counting symbols on ONE electrical plan sheet');
};

/** A stable key + hash per counter request (sheet label + tiles; consistency pass marked). */
export function counterRequestHashes(calls: FakeRequest[]): Array<{ key: string; sha256: string }> {
  return calls.filter(isCounter).map(req => {
    const blocks = Array.isArray(req.messages[0]?.content) ? req.messages[0].content as Array<{ type: string; text?: string }> : [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n');
    const sheet = /SHEET: ([^\n—]+?)(?: — tile-group|\n)/.exec(text)?.[1]?.trim() ?? '?';
    const tiles = [...text.matchAll(/Tile (\S+) \(row/g)].map(m => m[1]).join(',');
    const pass = text.includes('CONSISTENCY PASS') ? 'consistency' : 'count';
    return { key: `${pass}|${sheet}|${tiles}`, sha256: crypto.createHash('sha256').update(JSON.stringify({ model: req.model, max_tokens: req.max_tokens, system: req.system, messages: req.messages })).digest('hex') };
  }).sort((a, b) => a.key.localeCompare(b.key) || a.sha256.localeCompare(b.sha256));
}

/** Images in a request beyond its tiles (the example crops). */
export function exampleImages(req: FakeRequest): number {
  const blocks = Array.isArray(req.messages[0]?.content) ? req.messages[0].content as Array<{ type: string; text?: string }> : [];
  const images = blocks.filter(b => b.type === 'image').length;
  const tiles = blocks.filter(b => b.type === 'text' && /^Tile \S+ \(row/.test(b.text ?? '')).length;
  return images - tiles;
}

// ── B: the model-effect rule (pure) ────────────────────────────────────────

export interface ArmRepeat { diff: EvalDiff; asked: number }
export interface GateItemRow { id: string; expected: number; aWorst: number | null; bWorst: number | null; verdict: 'ok' | 'regression' | 'reported'; why?: string }
export interface GateResult { passed: boolean; rows: GateItemRow[]; regressions: string[]; reported: string[]; asked: { a: number; b: number }; note: string }

/** Worse-of-2 per arm: |actual - expected| of the worse repeat. */
export function gateDecision(a: ArmRepeat[], b: ArmRepeat[], disputed: Set<string>): GateResult {
  const ids = a[0]?.diff.rows.map(r => r.id) ?? [];
  const worst = (arm: ArmRepeat[], id: string) => {
    const ds = arm.map(x => x.diff.rows.find(r => r.id === id)).filter(Boolean);
    if (ds.some(d => d!.delta == null)) return null;
    return Math.max(...ds.map(d => Math.abs(d!.delta!)));
  };
  const wasPass = (arm: ArmRepeat[], id: string) => arm.every(x => x.diff.rows.find(r => r.id === id)?.verdict === 'pass');
  const rows: GateItemRow[] = [];
  const regressions: string[] = [];
  const reported: string[] = [];
  for (const id of ids) {
    const exp = a[0].diff.rows.find(r => r.id === id)!.expected;
    const aw = worst(a, id), bw = worst(b, id);
    if (disputed.has(id) || a[0].diff.rows.find(r => r.id === id)!.verdict === 'reported') { rows.push({ id, expected: exp, aWorst: aw, bWorst: bw, verdict: 'reported' }); reported.push(id); continue; }
    let why: string | undefined;
    if (aw != null && (bw == null || bw > aw)) why = `B's worse repeat is further from ${exp} (${bw ?? 'no match'} vs ${aw})`;
    if (wasPass(a, id) && !wasPass(b, id)) why = `${why ? `${why}; ` : ''}passed without learning, fails with it`;
    rows.push({ id, expected: exp, aWorst: aw, bWorst: bw, verdict: why ? 'regression' : 'ok', ...(why ? { why } : {}) });
    if (why) regressions.push(`${id}: ${why}`);
  }
  const askedA = Math.max(...a.map(x => x.asked)), askedB = Math.max(...b.map(x => x.asked));
  if (askedB > askedA) regressions.push(`review questions asked rose: ${askedA} -> ${askedB}`);
  return { passed: regressions.length === 0, rows, regressions, reported, asked: { a: askedA, b: askedB }, note: 'worse-of-2 per arm; disputed items reported, not gated' };
}
