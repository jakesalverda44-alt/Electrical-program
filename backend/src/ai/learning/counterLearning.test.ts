// Level 2 learning, Task 11 (+ CI gate A1/A2/A3 of Task 14) — examples in
// the counter prompt, fakeAnthropic only (no model is called):
//   * with an EMPTY bank — or a bank where nothing matches — the counter's
//     requests are byte-identical to the committed baseline
//     (eval/learning-baseline-2026-10-01.json);
//   * with a SCRIPTED bank (crops drawn by the test, other-bid provenance
//     invented, labelled SCRIPTED): the header sentence, X-ids, only current
//     targets' tags, ≤ 12 example images and ≤ 1,500 image tokens per call;
//     the photometric sheet gets only its own (site) targets' examples;
//   * leakage: same bid / same drawings / a tag letter alone / a conflicted
//     cluster without a strict match are never used; per-bid "off" → none;
//   * the replayed counter answers the same marks → the count result (minus
//     `learning`), the review items and enforcedCounts are identical.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { replayKissimmee0930, replay36th0930 } from '../../test/fixtures/realrun/replay0930';
import { replayPdfs } from '../../test/fixtures/realrun/replay';
import { loadKissimmeeLive0930 } from '../../test/fixtures/realrun/live0930';
import { userText, type FakeRequest } from '../../test/fixtures/takeoff/fakeAnthropic';
import { isPdftoppmAvailable } from '../documentPrep';
import { buildReviewItems, enforcedCounts } from '../reviewItems';
import { makeCounterLearning, type LearningBank } from './counterLearning';
import { meaningOf } from './meaning';
import { EXAMPLES_HEADER, MAX_IMAGES, MAX_IMAGE_TOKENS, imageTokens, type BankExample } from './selectExamples';
import { shaOf } from './bank';
import { counterRequestHashes, exampleImages } from '../../eval/learningGate';

const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../eval/learning-baseline-2026-10-01.json'), 'utf8')) as { jobs: Record<string, Array<{ key: string; sha256: string }>> };
const NO_OFF = { all: false, examples: new Set<string>(), lessons: new Set<string>() };
const isCounter = (r: FakeRequest) => JSON.stringify(r.system ?? '').includes('counting symbols on ONE electrical plan sheet');

async function glyph(body: string): Promise<Buffer> {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360"><rect width="360" height="360" fill="white"/>${body}</svg>`)).grayscale().png().toBuffer();
}

/** SCRIPTED bank: crops drawn here, provenance invented (never a real bid's labels). */
async function scriptedBank(liveBidId: string, liveSha: string): Promise<LearningBank> {
  const crop = await glyph('<circle cx="180" cy="180" r="40" stroke="black" stroke-width="5" fill="none"/><text x="160" y="190" font-size="30">G</text>');
  const crop2 = await glyph('<rect x="140" y="140" width="80" height="80" stroke="black" stroke-width="5" fill="none"/>');
  const crop3 = await glyph('<path d="M140 220 L180 130 L220 220 Z" fill="black"/>');
  const base = { quality: 2, sourceBidName: 'SCRIPTED other bid', sourceDocSha: 'sha-scripted-other', createdAt: '2026-09-01T00:00:00Z', conflicted: false, notADevice: false, confusedWith: null } as const;
  const ex = (over: Partial<BankExample> & { id: string; crop: Buffer }) => ({ ...base, sourceBidId: '00000000-0000-4000-8000-0000000000b1', polarity: 'positive' as const, meaning: meaningOf({ type: 'G', description: 'GFCI receptacle', category: 'device' }), dhash: 1n, ...over });
  return {
    releaseId: 99,
    examples: [
      ex({ id: 'e-gfci', crop, dhash: 0x0f0f0f0f0f0f0f0fn }),
      ex({ id: 'e-neg', crop: crop2, dhash: 0x00ff00ff00ff00ffn, polarity: 'negative', meaning: meaningOf({ description: 'Duplex receptacle', category: 'device' }), confusedWith: meaningOf({ description: 'GFCI receptacle', category: 'device' }) }),
      ex({ id: 'e-samebid', crop, dhash: 0x7777777777777777n, sourceBidId: liveBidId }),
      ex({ id: 'e-samedoc', crop, dhash: 0x3333333333333333n, sourceDocSha: liveSha }),
      ex({ id: 'e-tagonly', crop: crop3, dhash: 0x5555555555555555n, meaning: meaningOf({ type: 'A', description: '6 inch LED downlight', category: 'interior_lighting' }) }),
      ex({ id: 'e-conflicted', crop: crop3, dhash: 0x1234123412341234n, conflicted: true, meaning: meaningOf({ type: 'MS', description: 'Motion sensor wall', category: 'lighting_control' }) }),
      ex({ id: 'e-site', crop: crop2, dhash: 0x0ff00ff00ff00ff0n, meaning: meaningOf({ description: 'Lithonia DSX1 LED area light, pole mounted', category: 'site_lighting' }) }),
    ],
    lessons: [],
  };
}

let have = false;
const live = loadKissimmeeLive0930();
let liveSha = '';
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (have) liveSha = shaOf((await replayPdfs()).values().next().value as Buffer);
}, 120_000);

describe('A1 — an empty bank sends byte-identical counter requests', () => {
  it('Kissimmee and 36th match the committed baseline; a bank where nothing matches too', async (ctx) => {
    if (!have) return ctx.skip();
    const k = await replayKissimmee0930();
    expect(counterRequestHashes(k.calls)).toEqual(BASE.jobs.kissimmee);
    const t = await replay36th0930();
    expect(counterRequestHashes(t.calls)).toEqual(BASE.jobs['36th']);
    expect(makeCounterLearning({ releaseId: 1, examples: [], lessons: [] }, { bidId: live.bid.id, docShas: new Set(), off: NO_OFF, projectType: null, accountRuleId: null })).toBeUndefined();
    const nothing = makeCounterLearning({ releaseId: 1, examples: [{ ...(await scriptedBank(live.bid.id, liveSha)).examples.find(e => e.id === 'e-tagonly')! }], lessons: [] }, { bidId: live.bid.id, docShas: new Set([liveSha]), off: NO_OFF, projectType: null, accountRuleId: null });
    const k2 = await replayKissimmee0930({ learning: nothing });
    expect(counterRequestHashes(k2.calls)).toEqual(BASE.jobs.kissimmee);
  }, 600_000);
});

describe('A2/A3 — a SCRIPTED bank: prompt shape, budget, leakage, and no count change', () => {
  it('SCRIPTED: Kissimmee', async (ctx) => {
    if (!have) return ctx.skip();
    const bank = await scriptedBank(live.bid.id, liveSha);
    const learning = makeCounterLearning(bank, { bidId: live.bid.id, docShas: new Set([liveSha]), off: NO_OFF, projectType: 'retail', accountRuleId: null })!;
    const withL = await replayKissimmee0930({ learning });
    const without = await replayKissimmee0930();
    const counter = withL.calls.filter(isCounter);
    const withExamples = counter.filter(r => exampleImages(r) > 0);
    expect(withExamples.length).toBeGreaterThan(0);
    for (const r of counter) {
      const text = userText(r);
      const n = exampleImages(r);
      expect(n).toBeLessThanOrEqual(MAX_IMAGES);
      expect(n * imageTokens(196)).toBeLessThanOrEqual(MAX_IMAGE_TOKENS);
      if (!n) continue;
      expect(text.startsWith(EXAMPLES_HEADER)).toBe(true);
      expect(text.indexOf(EXAMPLES_HEADER)).toBeLessThan(text.indexOf('SHEET: '));
      // only this call's targets are named
      const asked = new Set(text.split('\n').filter(l => l.startsWith('- ') && l.includes(' | ')).map(l => l.slice(2).split(' | ')[0]));
      for (const m of text.matchAll(/COUNT TARGET "([^"]+)"/g)) expect(asked.has(m[1]), m[1]).toBe(true);
      expect(text).toMatch(/Example X1 — /);
      // the photometric sheet: site targets only → never the GFCI example
      if (text.includes('SHEET: PH0.1')) expect(text).not.toContain('GFCI');
    }
    const rec = withL.cr.learning!;
    const usedIds = new Set(rec.examplesUsed.map(e => e.id));
    expect(usedIds.has('e-gfci')).toBe(true);
    expect(usedIds.has('e-neg')).toBe(true);
    for (const leak of ['e-samebid', 'e-samedoc', 'e-tagonly', 'e-conflicted']) expect(usedIds.has(leak), leak).toBe(false);
    expect(rec.skipped.map(s => `${s.id}: ${s.reason}`).sort()).toEqual(['e-samebid: from this bid', 'e-samedoc: from these same drawings']);
    expect(rec.releaseId).toBe(99);
    expect(rec.tokensEst).toBeGreaterThan(0);
    // No count change: the same marks → the same count result, review and enforced counts.
    const { learning: _l, ...a } = withL.cr;
    expect(a).toEqual(without.cr);
    expect(buildReviewItems(withL.cr)).toEqual(buildReviewItems(without.cr));
    expect(Object.fromEntries(enforcedCounts(withL.cr, withL.review).byType)).toEqual(Object.fromEntries(enforcedCounts(without.cr, without.review).byType));
  }, 600_000);

  it('per-bid off: all → no learning at all; one example → that one is never used', async (ctx) => {
    if (!have) return ctx.skip();
    const bank = await scriptedBank(live.bid.id, liveSha);
    expect(makeCounterLearning(bank, { bidId: live.bid.id, docShas: new Set(), off: { all: true, examples: new Set(), lessons: new Set() }, projectType: null, accountRuleId: null })).toBeUndefined();
    const l = makeCounterLearning(bank, { bidId: live.bid.id, docShas: new Set(), off: { all: false, examples: new Set(['e-gfci']), lessons: new Set() }, projectType: null, accountRuleId: null })!;
    const r = await replayKissimmee0930({ learning: l });
    expect(r.cr.learning!.examplesUsed.map(e => e.id)).not.toContain('e-gfci');
  }, 600_000);
});
