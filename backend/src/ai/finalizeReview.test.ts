// Fewer-questions round Task 1 — finalizeReview's precedence (human >
// declined > evidence auto > memory), group member carry-over (Gap 1),
// Agent 4's wording for automatic answers, and the scope hash.
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  finalizeReview, applyGroupMemberResolution, enforcedCounts, reviewResolutionsForAgent4, autoAnswersOf, AUTO_BY,
  type ReviewItem, type ReviewResolution, type AutoAnswer,
} from './reviewItems';
import { hashScopeSnapshot, type ScopeSnapshot } from '../routes/preconstruction';
import type { CountResult } from './countingStage';

const AT = '2026-10-01T00:00:00.000Z';
const auto = (source: AutoAnswer['source'] = 'registration'): AutoAnswer => ({ source, reason: 'the sheets line up', evidence: ['3 of 3 marks sit in the same place'] });
const area = (over: Partial<ReviewItem> = {}): ReviewItem => ({
  id: 'area:X', kind: 'area', title: 'Type X: same area or different areas?', detail: 'E1 1 / E2 1 — ?', options: ['Same area — keep 1', 'Different areas — sum 2'],
  keepQty: 1, sumQty: 2, actions: ['answer', 'count'], typeKey: 'X', fingerprint: 'counted|1|E1: 1;E2: 1', ...over,
});
const autoRes = (source?: AutoAnswer['source']): ReviewResolution => ({ action: 'answer', answer: 'Same area — keep 1', qty: 1, by: AUTO_BY, at: AT, auto: auto(source) });
const human: ReviewResolution = { action: 'answer', answer: 'Different areas — sum 2', qty: 2, by: 'Jake', at: AT };

describe('finalizeReview precedence', () => {
  it('evidence auto stands when nothing else applies', () => {
    const [i] = finalizeReview([area({ resolution: autoRes() })], { previous: null });
    expect(i.resolution?.auto?.source).toBe('registration');
  });
  it('human beats evidence auto (same fingerprint)', () => {
    const [i] = finalizeReview([area({ resolution: autoRes() })], { previous: [area({ resolution: human })] });
    expect(i.resolution).toMatchObject({ answer: 'Different areas — sum 2', carriedOver: true });
    expect(i.resolution?.auto).toBeUndefined();
  });
  it('an automatic answer is never carried as such (re-derived only)', () => {
    const [i] = finalizeReview([area()], { previous: [area({ resolution: autoRes() })] });
    expect(i.resolution).toBeUndefined();
  });
  it('declined beats evidence auto — Undo then re-run stays open', () => {
    const [i] = finalizeReview([area({ resolution: autoRes() })], { previous: [area({ autoDeclined: ['registration'] })] });
    expect(i.resolution).toBeUndefined();
    expect(i.autoDeclined).toEqual(['registration']);
    // and again on the next run (carried while the fingerprint is unchanged)
    const [j] = finalizeReview([area({ resolution: autoRes() })], { previous: [i] });
    expect(j.resolution).toBeUndefined();
  });
  it('a declined source does not block another source', () => {
    const [i] = finalizeReview([area({ resolution: autoRes('independent_check') })], { previous: [area({ autoDeclined: ['registration'] })] });
    expect(i.resolution?.auto?.source).toBe('independent_check');
  });
  it('a changed fingerprint after Undo allows the auto answer again (the evidence changed)', () => {
    const [i] = finalizeReview([area({ fingerprint: 'counted|2|E1: 2;E2: 2', resolution: autoRes() })], { previous: [area({ autoDeclined: ['registration'] })] });
    expect(i.resolution?.auto?.source).toBe('registration');
    expect(i.autoDeclined).toBeUndefined();
  });
  it('memory runs last, only on items still open', () => {
    const seen: string[] = [];
    const out = finalizeReview([area({ resolution: autoRes() }), area({ id: 'area:Y' })], {
      previous: null,
      applyMemory: items => items.map(i => { seen.push(`${i.id}:${i.resolution ? 'resolved' : 'open'}`); return i; }),
    });
    expect(seen).toEqual(['area:X:resolved', 'area:Y:open']);
    expect(out).toHaveLength(2);
  });
});

const zeroType = (key: string) => ({ key, type: key, description: `${key} desc`, category: 'device', status: 'zero', count: 0, sheets: [], reason: 'not found on any counted plan sheet' });
const cr = (keys: string[]) => ({ version: 1, ran: true, model: 'm', targets: [], targetNotes: [], sheets: [], skippedSheets: [], types: keys.map(zeroType), removedRows: [], flags: [], marks: [] }) as unknown as CountResult;
const group = (keys: string[], prefix = 'legend-zero:'): ReviewItem => ({
  id: `${prefix}${keys.join('-')}`, kind: 'count', title: `${keys.length} legend items`, detail: '', actions: ['count', 'markers', 'not_on_job'],
  groupedTypes: keys.map(k => ({ key: k, type: k, description: `${k} desc`, fingerprint: 'zero|0|' })), fingerprint: `legend-zero|${keys.join('|')}`,
});

describe('Gap 1 — group member answers survive a re-run', () => {
  it('a partly answered group keeps its member answers (count 6, not on job) in enforcedCounts', () => {
    let g = applyGroupMemberResolution(group(['A', 'B', 'C']), 'A', { action: 'count', qty: 6 }, 'Jake');
    g = applyGroupMemberResolution(g, 'B', { action: 'not_on_job', reason: 'not on this job at all' }, 'Jake');
    const [after] = finalizeReview([group(['A', 'B', 'C'])], { previous: [g] });
    expect(after.resolution).toBeUndefined();
    const ec = enforcedCounts(cr(['A', 'B', 'C']), [after]);
    expect(ec.byType.get('A')).toBe(6);
    expect(ec.byType.get('B')).toBe(null);
    expect(ec.byType.has('C')).toBe(false);
  });
  it('a fully answered group is resolved again by the all-answered rule (recomputed, not copied)', () => {
    let g = applyGroupMemberResolution(group(['A', 'B']), 'A', { action: 'count', qty: 2 }, 'Jake');
    g = applyGroupMemberResolution(g, 'B', { action: 'count', qty: 1 }, 'Jake');
    const [after] = finalizeReview([group(['A', 'B'])], { previous: [g] });
    expect(after.resolution).toMatchObject({ action: 'confirm', carriedOver: true });
  });
  it('a group whose member set changed keeps the answers of the members still in it', () => {
    const g = applyGroupMemberResolution(group(['A', 'B']), 'A', { action: 'count', qty: 3 }, 'Jake');
    const [after] = finalizeReview([group(['A', 'C', 'D'])], { previous: [g] });
    expect(after.groupedTypes!.find(m => m.key === 'A')?.resolution?.qty).toBe(3);
  });
  it('a changed member fingerprint is not carried (shown as previousResolution)', () => {
    const g = applyGroupMemberResolution(group(['A', 'B']), 'A', { action: 'count', qty: 3 }, 'Jake');
    const fresh = group(['A', 'B']);
    fresh.groupedTypes![0].fingerprint = 'zero|0|E-9: 1 (not used — legend)';
    const [after] = finalizeReview([fresh], { previous: [g] });
    expect(after.groupedTypes![0].resolution).toBeUndefined();
    expect(after.groupedTypes![0].previousResolution?.qty).toBe(3);
  });
  it('a standalone count:<K> answer carries to member K and back (same fingerprint)', () => {
    const standalone: ReviewItem = { id: 'count:A', kind: 'count', title: 'Type A', detail: '', typeKey: 'A', fingerprint: 'zero|0|', resolution: { action: 'not_on_job', reason: 'by the sign vendor', by: 'Jake', at: AT } };
    const [g] = finalizeReview([group(['A', 'B'], 'textzero:')], { previous: [standalone] });
    expect(g.groupedTypes![0].resolution).toMatchObject({ action: 'not_on_job', carriedOver: true });
    const back = finalizeReview([{ ...standalone, resolution: undefined }], { previous: [g] });
    expect(back[0].resolution).toMatchObject({ action: 'not_on_job', carriedOver: true });
  });
  it('a declined automatic member answer stays off on the next run', () => {
    const fresh = group(['A', 'B']);
    fresh.groupedTypes![0].resolution = { action: 'not_on_job', reason: 'From Lake Mary: by others', by: 'CRM (from Lake Mary)', at: AT, auto: auto('account_memory') };
    const prev = group(['A', 'B']);
    prev.groupedTypes![0].autoDeclined = ['account_memory'];
    const [after] = finalizeReview([fresh], { previous: [prev] });
    expect(after.groupedTypes![0].resolution).toBeUndefined();
  });
  it('automatic member answers are never carried as such', () => {
    const prev = group(['A', 'B']);
    prev.groupedTypes![0].resolution = { action: 'not_on_job', reason: 'From Lake Mary: by others', by: 'CRM (from Lake Mary)', at: AT, auto: auto('account_memory') };
    const [after] = finalizeReview([group(['A', 'B'])], { previous: [prev] });
    expect(after.groupedTypes![0].resolution).toBeUndefined();
  });
});

describe('Agent 4 and automatic answers', () => {
  it('an automatic answer reads "answered automatically", never "estimator"', () => {
    const txt = reviewResolutionsForAgent4([
      area({ resolution: autoRes() }),
      { id: 'spotcheck:A', kind: 'confirm', title: 'Spot-check A', detail: '', blocking: false, resolution: { action: 'confirm', reason: 'schedule qty agrees', by: AUTO_BY, at: AT, auto: { source: 'independent_check', reason: 'schedule quantity column agrees', evidence: ['Σqty 24 = 24'] } } },
    ])!;
    expect(txt).toContain('- Type X: 1 EA (Same area — keep 1) (answered automatically: the sheets line up).');
    expect(txt).toContain('Spot-check A: confirmed (answered automatically: schedule quantity column agrees).');
    expect(txt).not.toMatch(/estimator\)|by the estimator/);
  });
  it('a textzero checklist lists each member on its own line', () => {
    let g = applyGroupMemberResolution(group(['TSTAT', 'T'], 'textzero:'), 'TSTAT', { action: 'count', qty: 2, reason: 'Stated: "(2)" (E-4)' }, 'Jake');
    g = applyGroupMemberResolution(g, 'T', { action: 'not_on_job', reason: 'same item as TSTAT' }, 'Jake');
    const txt = reviewResolutionsForAgent4([g])!;
    expect(txt).toContain('- Type TSTAT — TSTAT desc: 2 EA (counted by the estimator).');
    expect(txt).toContain('- Type T — T desc: NOT ON THIS JOB — omit it from the takeoff and scope.');
  });
  it('autoAnswersOf lists item and member automatic answers', () => {
    const g = group(['A']);
    g.groupedTypes![0].resolution = { action: 'not_on_job', reason: 'x by others ok', by: 'CRM (from B)', at: AT, auto: auto('account_memory') };
    expect(autoAnswersOf([area({ resolution: autoRes() }), g]).map(a => `${a.itemId}/${a.memberKey ?? ''}/${a.auto.source}`)).toEqual(['area:X//registration', 'legend-zero:A/A/account_memory']);
  });
});

describe('hashScopeSnapshot', () => {
  const snap = (items: ReviewItem[]): ScopeSnapshot => ({ runId: 'r', agent1Output: '', agent2Output: 'a2', reviewItems: items, accountTerms: null, workspaceScope: null, scopeList: { items: [], overrides: [] } as unknown as ScopeSnapshot['scopeList'] });
  /** The formula before this round, verbatim. */
  const oldHash = (s: ScopeSnapshot) => {
    const resolutions = (s.reviewItems ?? []).map(i => [i.id, i.resolution?.action ?? null, i.resolution?.qty ?? null, i.resolution?.answer ?? null, i.resolution?.reason ?? null]);
    return crypto.createHash('sha256').update(JSON.stringify([s.runId, s.agent2Output, s.accountTerms, resolutions, [], [], {}])).digest('hex');
  };
  it('is byte-identical for a list with no textzero item', () => {
    const g = applyGroupMemberResolution(group(['A', 'B']), 'A', { action: 'count', qty: 6 }, 'Jake');
    const s = snap([area({ resolution: human }), g]);
    expect(hashScopeSnapshot(s)).toBe(oldHash(s));
  });
  it('changes when a textzero member is answered', () => {
    const g = group(['A', 'B'], 'textzero:');
    const a = hashScopeSnapshot(snap([g]));
    const b = hashScopeSnapshot(snap([applyGroupMemberResolution(g, 'A', { action: 'count', qty: 2 }, 'Jake')]));
    expect(a).not.toBe(b);
  });
});
