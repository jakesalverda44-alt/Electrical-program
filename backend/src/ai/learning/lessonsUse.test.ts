// Level 2 learning, Task 13 — approved lessons used: in the counter prompt
// (after the examples, before SHEET:, ≤ 5 / ≤ 400 tokens) and as review
// hints (never an answer). Scope: a project-type lesson only on that type,
// a client lesson only on that non-default rule; off-for-this-bid → absent.
import { describe, it, expect, beforeAll } from 'vitest';
import { selectLessons, LESSONS_HEADER, MAX_LESSONS, type BankLesson } from './selectExamples';
import { applyLessonHints, suggestedName } from './reviewHints';
import { makeCounterLearning } from './counterLearning';
import { buildReviewItems, enforcedCounts, reviewStatus, type ReviewItem } from '../reviewItems';
import { hashScopeSnapshot, type ScopeSnapshot } from '../../routes/preconstruction';
import { replay36th0930 } from '../../test/fixtures/realrun/replay0930';
import { load36th0930 } from '../../test/fixtures/realrun/live0930';
import { userText } from '../../test/fixtures/takeoff/fakeAnthropic';
import { isPdftoppmAvailable } from '../documentPrep';
import type { CountTarget } from '../countTargets';

const OFF = { all: false, examples: new Set<string>(), lessons: new Set<string>() };
const lesson = (over: Partial<BankLesson> & { id: string }): BankLesson => ({ version: 1, text: 'When a sheet says SHADED SYMBOL DENOTES NEW, shaded receptacles are new and open ones are existing.', appliesTo: ['counter'], scopeKind: 'all', scopeValue: null, match: {}, ...over });
const T: CountTarget[] = [{ key: 'GFI', type: 'GFI', description: 'Duplex receptacle w/ ground fault interrupter', category: 'device', source: 'legend', sourceSheet: 'E1.0' } as CountTarget];

describe('selectLessons — scope', () => {
  it('a project-type lesson only on that project type', () => {
    const l = [lesson({ id: 'a', scopeKind: 'project_type', scopeValue: 'retail' })];
    expect(selectLessons(T, l, { projectType: 'self_storage', accountRuleId: null, off: OFF }, 'counter')).toEqual([]);
    expect(selectLessons(T, l, { projectType: 'retail', accountRuleId: null, off: OFF }, 'counter').map(x => x.id)).toEqual(['a']);
  });
  it('a client lesson never on the Default rule (no account) or another rule', () => {
    const l = [lesson({ id: 'a', scopeKind: 'account', scopeValue: 'rule-az' })];
    expect(selectLessons(T, l, { projectType: null, accountRuleId: null, off: OFF }, 'counter')).toEqual([]);
    expect(selectLessons(T, l, { projectType: null, accountRuleId: 'rule-other', off: OFF }, 'counter')).toEqual([]);
    expect(selectLessons(T, l, { projectType: null, accountRuleId: 'rule-az', off: OFF }, 'counter')).toHaveLength(1);
  });
  it('review-only lessons never reach the counter; off → absent; ≤ 5 lessons / 400 tokens', () => {
    expect(selectLessons(T, [lesson({ id: 'r', appliesTo: ['review'] })], { projectType: null, accountRuleId: null, off: OFF }, 'counter')).toEqual([]);
    expect(selectLessons(T, [lesson({ id: 'a' })], { projectType: null, accountRuleId: null, off: { ...OFF, lessons: new Set(['a']) } }, 'counter')).toEqual([]);
    const many = Array.from({ length: 9 }, (_, i) => lesson({ id: `l${i}`, text: 'x'.repeat(300) }));
    const got = selectLessons(T, many, { projectType: null, accountRuleId: null, off: OFF }, 'counter');
    expect(got.length).toBeLessThanOrEqual(MAX_LESSONS);
    expect(got.reduce((n, l) => n + Math.ceil(l.text.length / 4) + 8, 0)).toBeLessThanOrEqual(400);
  });
  it('a lesson matched to a device class reaches only a sheet with such a target', () => {
    const l = [lesson({ id: 'a', match: { deviceClass: 'receptacle.floor' } })];
    expect(selectLessons(T, l, { projectType: null, accountRuleId: null, off: OFF }, 'counter')).toEqual([]);
    expect(selectLessons(T, [lesson({ id: 'b', match: { deviceClass: 'receptacle.gfci' } })], { projectType: null, accountRuleId: null, off: OFF }, 'counter')).toHaveLength(1);
  });
});

describe('review hints (never an answer)', () => {
  const live = load36th0930();
  const items = (live.reviewItems as unknown as ReviewItem[]).map(i => ({ ...i, resolution: undefined }));
  const unlistedLesson = lesson({ id: 'u', appliesTo: ['review'], text: 'An unscheduled tag drawn as "surface strip fixture (warehouse)" has been surface strip light, 4ft (H on 36th Street Warehouse).', match: { itemPrefix: 'unlisted:', unlistedSymbolFp: 'fixture strip surface warehouse' } });
  it('the unlisted item gets the hint and a pre-filled name; nothing else changes', () => {
    expect(suggestedName(unlistedLesson.text)).toBe('surface strip light, 4ft');
    const out = applyLessonHints(items, [unlistedLesson], { projectType: null, accountRuleId: null, off: OFF });
    const h = out.find(i => i.id === 'unlisted:H')!;
    expect(h.lessonHints).toEqual([{ lessonId: 'u', version: 1, text: unlistedLesson.text }]);
    expect(h.suggested).toBe('surface strip light, 4ft');
    expect(h.resolution).toBeUndefined();
    expect(h.fingerprint).toBe(items.find(i => i.id === 'unlisted:H')!.fingerprint);
    expect(reviewStatus(out)).toBe(reviewStatus(items));
    const cr = live.countResult as never;
    expect(Object.fromEntries(enforcedCounts(cr, out).byType)).toEqual(Object.fromEntries(enforcedCounts(cr, items).byType));
    const snap = (its: ReviewItem[]): ScopeSnapshot => ({ runId: 'r', agent1Output: '', agent2Output: 'a', reviewItems: its, accountTerms: null, workspaceScope: null, scopeList: { items: [], overrides: [] } as unknown as ScopeSnapshot['scopeList'] });
    expect(hashScopeSnapshot(snap(out))).toBe(hashScopeSnapshot(snap(items)));
    expect(out.filter(i => i.lessonHints).map(i => i.id)).toEqual(['unlisted:H']);
  });
  it('buildReviewItems without lessons is unchanged; off → no hints', () => {
    const a = buildReviewItems(null, []);
    expect(buildReviewItems(null, [], { lessons: [unlistedLesson], lessonContext: { projectType: null, accountRuleId: null, off: { ...OFF, all: true } } })).toEqual(a);
  });
});

let have = false;
beforeAll(async () => { have = await isPdftoppmAvailable(); }, 60_000);

describe('lessons in the counter prompt (fakeAnthropic)', () => {
  it('36th: an approved counter lesson sits after any examples and before SHEET:, and is recorded', async (ctx) => {
    if (!have) return ctx.skip();
    const live = load36th0930();
    const l = makeCounterLearning({ releaseId: 7, examples: [], lessons: [lesson({ id: 'shaded', match: { deviceClass: 'receptacle.gfci' } })] }, { bidId: live.bid.id, docShas: new Set(), off: OFF, projectType: null, accountRuleId: null })!;
    const r = await replay36th0930({ learning: l });
    const withLesson = r.calls.filter(c => userText(c).includes(LESSONS_HEADER));
    expect(withLesson.length).toBeGreaterThan(0);
    for (const c of withLesson) {
      const t = userText(c);
      expect(t.indexOf(LESSONS_HEADER)).toBeLessThan(t.indexOf('SHEET: '));
      expect(t).toContain('- L1 v1: When a sheet says SHADED SYMBOL DENOTES NEW');
    }
    expect(r.stage.countResult.learning!.lessonsUsed.map(x => x.lessonId)).toEqual(['shaded']);
  }, 600_000);
});
