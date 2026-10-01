// Fewer-questions round Task 6 — remembered answers per account. Pure rules,
// then the Kissimmee 0930 replay with a SCRIPTED "other AutoZone bid"
// (test/fixtures/realrun/scripted-autozone-memory-bid.json — labelled
// SCRIPTED in its _note: no real earlier AutoZone answers exist).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fp, itemMemoryKey, memberMemoryKey, collectMemories, applyAccountMemory, type MemorySourceBid } from './accountMemory';
import { applyGroupMemberResolution, finalizeReview, reviewStatus, type ReviewItem } from './reviewItems';
import { replayReview, reviewCounts, type ReplayReview } from '../eval/reviewReplay';
import { isPdftoppmAvailable } from './documentPrep';

const ACC = { ruleId: 'rule-az', ruleName: 'AutoZone' };
const zero = (k: string, d: string): ReviewItem => ({ id: `count:${k}`, kind: 'count', title: `Type ${k} — ${d}`, detail: 'Counted 0: not found on any counted plan sheet.', typeKey: k, type: k, description: d, actions: ['count', 'markers', 'not_on_job'], fingerprint: 'zero|0|' });
const src = (name: string, items: ReviewItem[], at = '2026-09-01T00:00:00Z'): MemorySourceBid => ({ bidId: `bid-${name}`, bidName: name, createdAt: at, items });
const noj = (i: ReviewItem, reason = 'Not on the prototype at all', extra: Partial<ReviewItem['resolution']> = {}): ReviewItem => ({ ...i, resolution: { action: 'not_on_job', reason, by: 'Jake', at: 't', ...extra } as ReviewItem['resolution'] });

describe('keys', () => {
  it('fp: case, punctuation, whitespace and order do not matter; numbers kept', () => {
    expect(fp('Motion  sensor LSXR-50-HL (hub stores only)')).toBe(fp('motion sensor, lsxr 50 hl — HUB STORES ONLY'));
    expect(fp('Typical office pole: (2) duplex')).not.toBe(fp('Typical office pole: (3) duplex'));
  });
  it('member and standalone zero keys agree', () => {
    expect(itemMemoryKey(zero('M2', 'Motion sensor LSXR-50-HL'))).toBe(memberMemoryKey({ key: 'M2', type: 'M2', description: 'motion sensor lsxr 50 hl' }));
  });
  it('area:, unlisted: and per-pole members are never remembered', () => {
    expect(itemMemoryKey({ id: 'area:X', kind: 'area', title: 't', detail: 'd' })).toBeNull();
    expect(itemMemoryKey({ id: 'unlisted:H', kind: 'count', title: 't', detail: 'd' })).toBeNull();
    expect(itemMemoryKey({ id: 'typicalassign:PP', kind: 'count', title: 't', detail: 'd' })).toBeNull();
  });
});

describe('S2 — precedence: the estimator\'s own earlier answer outranks another bid\'s memory', () => {
  const tq = (qty?: number): ReviewItem => ({ id: 'typicalqty:p:S', kind: 'count', title: 'Typical: Office pole — how many simplex?', detail: 'How many?', memoryText: 'Office area power pole|Simplex|"office pole: simplex in j-box"', actions: ['count', 'not_on_job'], ...(qty !== undefined ? { resolution: { action: 'count' as const, qty, by: 'Jake', at: 't' } } : {}) });
  const mem = () => collectMemories([src('Lake Mary', [tq(6)])]);
  it('a different previousResolution: memory is NOT applied; the item stays open', () => {
    const open = { ...tq(), previousResolution: { action: 'count' as const, qty: 4, by: 'Jake', at: 't' } };
    const [i] = applyAccountMemory([open], mem(), ACC);
    expect(i.resolution).toBeUndefined();
    expect(i.previousResolution).toMatchObject({ qty: 4 });
  });
  it('the same previous value is applied (they agree); no previous value is applied (unchanged)', () => {
    const agree = { ...tq(), previousResolution: { action: 'count' as const, qty: 6, by: 'Jake', at: 't' } };
    expect(applyAccountMemory([agree], mem(), ACC)[0].resolution).toMatchObject({ action: 'count', qty: 6, auto: { source: 'account_memory' } });
    expect(applyAccountMemory([tq()], mem(), ACC)[0].resolution).toMatchObject({ qty: 6 });
  });
  it('a group member with a different previousResolution is skipped', () => {
    const g: ReviewItem = { id: 'legend-zero:A-B', kind: 'count', title: '2 legend items', detail: 'd', groupedTypes: [{ key: 'A', type: 'A', description: 'Alarm horn', previousResolution: { action: 'count', qty: 1, by: 'Jake', at: 't' } }, { key: 'B', type: 'B', description: 'Bell' }] };
    const srcG = applyGroupMemberResolution(applyGroupMemberResolution(g, 'A', { action: 'not_on_job', reason: 'none' }, 'Jake'), 'B', { action: 'not_on_job', reason: 'none' }, 'Jake');
    const [i] = applyAccountMemory([g], collectMemories([src('Lake Mary', [srcG])]), ACC);
    expect(i.groupedTypes![0].resolution).toBeUndefined();
    expect(i.groupedTypes![1].resolution).toMatchObject({ action: 'not_on_job' });
  });
});

describe('applying', () => {
  const target = [zero('M2', 'Motion sensor LSXR-50-HL')];
  it('a human not-on-job of another bid answers it automatically, labelled and undoable', () => {
    const [i] = applyAccountMemory(target, collectMemories([src('Lake Mary', [noj(zero('M2', 'motion sensor lsxr-50-hl'))])]), ACC, 'now');
    expect(i.resolution).toMatchObject({ action: 'not_on_job', reason: 'From Lake Mary: Not on the prototype at all', by: 'CRM (from Lake Mary)', auto: { source: 'account_memory', fromBid: { id: 'bid-Lake Mary', name: 'Lake Mary' }, reason: 'Same account (AutoZone) — answered this way on Lake Mary' } });
    expect(i.resolution!.auto!.evidence[0]).toMatch(/^Lake Mary: Type M2 — motion sensor lsxr-50-hl — not on this job/);
  });
  it('no account (Default rule / none) → nothing applied', () => {
    expect(applyAccountMemory(target, collectMemories([src('Lake Mary', [noj(zero('M2', 'Motion sensor LSXR-50-HL'))])]), null)[0].resolution).toBeUndefined();
  });
  it('an automatic answer is never a source', () => {
    const autoAns = noj(zero('M2', 'Motion sensor LSXR-50-HL'), 'From X: y', { auto: { source: 'account_memory', reason: 'r', evidence: [] } });
    expect(collectMemories([src('Lake Mary', [autoAns])])).toEqual([]);
  });
  it('a count on a zero row is never remembered (per store)', () => {
    const counted = { ...zero('M2', 'Motion sensor LSXR-50-HL'), resolution: { action: 'count' as const, qty: 3, by: 'Jake', at: 't' } };
    expect(collectMemories([src('Lake Mary', [counted])])).toEqual([]);
  });
  it('two bids that disagree → not applied, and the detail says so', () => {
    const tq = (qty: number): ReviewItem => ({ id: 'typicalqty:p:S', kind: 'count', title: 'Typical: Office pole — how many simplex?', detail: 'd', memoryText: 'Office area power pole|Simplex|"office pole: simplex in j-box"', actions: ['count', 'not_on_job'], resolution: { action: 'count', qty, by: 'Jake', at: 't' } });
    const fresh: ReviewItem = { ...tq(1), resolution: undefined, detail: 'How many?' };
    const [i] = applyAccountMemory([fresh], collectMemories([src('Kissimmee', [tq(2)]), src('Lake Mary', [tq(3)])]), ACC);
    expect(i.resolution).toBeUndefined();
    expect(i.detail).toContain('AutoZone bids differ: Kissimmee 2, Lake Mary 3 — not applied.');
  });
  it('a scope answer is only pre-filled (suggested), never applied', () => {
    const q: ReviewItem = { id: 'scope:lighting', kind: 'scope_question', step: 'scope', term: 'lighting', title: 'Lighting', detail: 'Who?', options: ['A', 'B'], actions: ['answer'] };
    const [i] = applyAccountMemory([q], collectMemories([src('Lake Mary', [{ ...q, resolution: { action: 'answer', answer: 'B', by: 'Jake', at: 't' } }])]), ACC);
    expect(i.resolution).toBeUndefined();
    expect(i.suggested).toBe('B');
    expect(reviewStatus([i])).toBe('needs_review');
  });
  it('an option that no longer exists is not applied (re-validated)', () => {
    const pp: ReviewItem = { id: 'pipepoles:PP:X', kind: 'area', blocking: false, title: 't', detail: 'd', memoryText: '3" PVC pipes at pole #5', options: ['No', 'Yes — price 2'], optionQty: [0, 2], actions: ['answer'] };
    const old = { ...pp, options: ['No', 'Yes — price 3'], resolution: { action: 'answer' as const, answer: 'Yes — price 3', by: 'Jake', at: 't' } };
    expect(applyAccountMemory([pp], collectMemories([src('Lake Mary', [old])]), ACC)[0].resolution).toBeUndefined();
  });
  it('Undo (autoDeclined) keeps it off; a human answer always wins (memory only fills open items)', () => {
    const mem = collectMemories([src('Lake Mary', [noj(zero('M2', 'Motion sensor LSXR-50-HL'))])]);
    const declined = { ...target[0], autoDeclined: ['account_memory' as const] };
    expect(applyAccountMemory([declined], mem, ACC)[0].resolution).toBeUndefined();
    const out = finalizeReview(target, { previous: [{ ...target[0], resolution: { action: 'count', qty: 2, by: 'Jake', at: 't' } }], applyMemory: items => applyAccountMemory(items, mem, ACC) });
    expect(out[0].resolution).toMatchObject({ action: 'count', qty: 2, carriedOver: true });
  });
  it('group members: answered one by one; the group resolves only when all are', () => {
    const g: ReviewItem = { id: 'legend-zero:A-B', kind: 'count', title: '2 legend items', detail: 'd', groupedTypes: [{ key: 'A', type: 'A', description: 'Alarm horn' }, { key: 'B', type: 'B', description: 'Bell' }] };
    const srcG = applyGroupMemberResolution(g, 'A', { action: 'not_on_job', reason: 'No alarm on the prototype' }, 'Jake');
    const [i] = applyAccountMemory([g], collectMemories([src('Lake Mary', [srcG])]), ACC);
    expect(i.groupedTypes![0].resolution).toMatchObject({ action: 'not_on_job', by: 'CRM (from Lake Mary)' });
    expect(i.groupedTypes![1].resolution).toBeUndefined();
    expect(i.resolution).toBeUndefined();
  });
});

const SCRIPTED = JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/realrun/scripted-autozone-memory-bid.json'), 'utf8')) as { _note: string; bidName: string; bidId: string; createdAt: string; answers: Record<string, { action: string; qty?: number; reason?: string; answerIndex?: number }> };

/** The SCRIPTED other bid: the replay's own items answered per the fixture. */
function scriptedBid(items: ReviewItem[]): MemorySourceBid {
  const A = SCRIPTED.answers;
  const out = items.map(i => {
    const by = 'Jake (SCRIPTED)';
    if (i.id.startsWith('typicalqty:')) {
      const k = Object.keys(A).find(x => x.startsWith('typicalqty:') && i.id.includes(x.split(':*:')[1].split('@')[0]) && i.id.includes(`@${x.split('@')[1]}#`));
      return k ? { ...i, resolution: { action: 'count' as const, qty: A[k].qty, by, at: SCRIPTED.createdAt } } : i;
    }
    if (i.id.startsWith('legend-zero:')) {
      let g = i;
      for (const m of i.groupedTypes ?? []) g = applyGroupMemberResolution(g, m.key, { action: 'not_on_job', reason: A['legend-zero:*'].reason }, by);
      return g;
    }
    if (A[i.id]?.answerIndex != null) return { ...i, resolution: { action: 'answer' as const, answer: i.options![A[i.id].answerIndex!], by, at: SCRIPTED.createdAt } };
    if (i.id.startsWith('pipepoles:')) return { ...i, resolution: { action: 'answer' as const, answer: i.options![A['pipepoles:*'].answerIndex!], by, at: SCRIPTED.createdAt } };
    return i;
  });
  return { bidId: SCRIPTED.bidId, bidName: SCRIPTED.bidName, createdAt: SCRIPTED.createdAt, items: out };
}

let have = false;
let k: ReplayReview;
beforeAll(async () => { have = await isPdftoppmAvailable(); if (have) k = await replayReview('kissimmee'); }, 900_000);

describe('Kissimmee 0930 + a SCRIPTED other AutoZone bid (labelled SCRIPTED)', () => {
  it('SCRIPTED: the typical quantities (×3) and the legend-zero members are answered from it; scope only pre-filled', (ctx) => {
    if (!have) return ctx.skip();
    expect(SCRIPTED._note).toMatch(/^SCRIPTED/);
    const mem = collectMemories([scriptedBid(k.items)]);
    const out = finalizeReview(k.fresh, { previous: null, applyMemory: items => applyAccountMemory(items, mem, ACC) });
    const auto = out.filter(i => i.resolution?.auto?.source === 'account_memory').map(i => i.id.split(':')[0]);
    expect(auto.sort()).toEqual(['legend-zero', 'pipepoles', 'typicalqty', 'typicalqty', 'typicalqty']);
    const lz = out.find(i => i.id.startsWith('legend-zero:'))!;
    expect(lz.groupedTypes!.every(m => m.resolution?.by === `CRM (from ${SCRIPTED.bidName})`)).toBe(true);
    expect(out.find(i => i.id === 'scope:lighting')!.resolution).toBeUndefined();
    expect(out.find(i => i.id === 'scope:lighting')!.suggested).toMatch(/^Account rule —/);
    const before = reviewCounts(k.items), after = reviewCounts(out);
    // eslint-disable-next-line no-console
    console.log(`SCRIPTED memory: Kissimmee asked ${before.asked} -> ${after.asked} (auto ${after.auto})`);
    expect(after.asked).toBe(before.asked - 4);
  });
});
