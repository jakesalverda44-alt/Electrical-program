// Fewer-questions round Task 8 — the replay gate, against the committed
// baseline (eval/review-baseline-2026-10-01.json, made on main 25dce72
// before this round). Both 0930 jobs, no model, no DB:
//   * no question disappears without a trace (same id, a checklist row, an
//     automatic answer WITH evidence, or the Scope step);
//   * blocking unchanged: unanswered → needs_review; a scripted full answer
//     set gives the same enforcedCounts as the baseline list answered the
//     same way (automatic answers standing in for the human answers they
//     reproduce); 36th's automatic answers = Jake's stored answers;
//   * accuracy: the expected-file diff on the enforced counts is identical,
//     and 36th's projected hours are unchanged vs Jake's answers;
//   * the counts are pinned (asked ≤ 10 on both; exact by kind) and printed.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { replayReview, reviewCounts, storedAnswers, kindOf, type ReplayReview, type ReviewBaselineJob, type ReviewCounts } from './reviewReplay';
import { replayPricing } from './replayEval';
import { diffAgainstExpected, validateExpectedFile, type ExpectedFile } from './takeoffEval';
import { loadLiveLibrary0930 } from '../test/fixtures/realrun/live0930';
import {
  applyGroupMemberResolution, applyReconcileMemberResolution, enforcedCounts, reviewStatus, validateResolution, AUTO_BY,
  type ReviewItem, type ResolveInput,
} from '../ai/reviewItems';
import { isPdftoppmAvailable } from '../ai/documentPrep';
import type { CountResult } from '../ai/countingStage';

const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval/review-baseline-2026-10-01.json'), 'utf8')) as { jobs: Record<'kissimmee' | '36th', ReviewBaselineJob> };
const expectedOf = (f: string): ExpectedFile => validateExpectedFile(JSON.parse(fs.readFileSync(path.join(__dirname, '../../eval', f), 'utf8')));
const EXPECTED = { kissimmee: 'autozone-10077-kissimmee.expected.json', '36th': '36th-street-warehouse.expected.json' } as const;

/** One scripted answer per open blocking item (members one by one). */
function answerAll(items: ReviewItem[], stored?: Map<string, ReviewItem>): ReviewItem[] {
  return items.map(i0 => {
    let i = i0;
    if (i.resolution || i.blocking === false) return i;
    const s = stored?.get(i.id)?.resolution;
    if (s) return { ...i, resolution: s };
    if (i.groupedTypes?.length) {
      for (const m of i.groupedTypes) if (!m.resolution) i = applyGroupMemberResolution(i, m.key, { action: 'count', qty: 1 }, 'script');
      return i;
    }
    if (i.reconcileMembers?.length) {
      for (const m of i.reconcileMembers) {
        if (m.resolution) continue;
        const res = i.hostAssignment?.perPole ? { action: 'answer' as const, answer: i.options![0] } : { action: 'count' as const, qty: Math.max(1, m.currentQty) };
        i = applyReconcileMemberResolution(i, m.key, res, 'script');
      }
      return i;
    }
    const acts = i.actions ?? ['count'];
    const input: ResolveInput = acts.includes('answer') && i.options?.length ? { action: 'answer', answer: i.options[0] }
      : acts.includes('count') ? { action: 'count', qty: 1, reason: 'scripted answer for the gate' }
      : { action: 'confirm', reason: 'scripted answer for the gate' };
    const v = validateResolution(i, input, null);
    if (!v.ok) throw new Error(`${i.id}: ${v.error}`);
    return { ...i, resolution: { ...v.resolution, by: 'script', at: 't' } };
  });
}

/** The baseline's shape of a list: a checklist row back as its own count:<K>
 *  item (exactly what the baseline had), an automatic answer back as a
 *  human answer of the same value. */
function asBaseline(items: ReviewItem[]): ReviewItem[] {
  return items.flatMap(i => {
    if (i.id.startsWith('textzero:')) return (i.groupedTypes ?? []).map(m => ({ id: `count:${m.key}`, kind: 'count' as const, title: m.type, detail: 'Counted 0', typeKey: m.key, type: m.type, description: m.description, actions: ['count', 'markers', 'not_on_job'] as ReviewItem['actions'], ...(m.resolution ? { resolution: m.resolution } : {}) }));
    if (i.resolution?.auto) { const { auto: _a, ...r } = i.resolution; return [{ ...i, resolution: { ...r, by: 'human' } }]; }
    return [i];
  });
}

/** The count result with the enforced answers applied (for the expected-file diff). */
function enforcedResult(cr: CountResult, items: ReviewItem[]): CountResult {
  const ec = enforcedCounts(cr, items).byType;
  return { ...cr, types: cr.types.map(t => {
    if (!ec.has(t.key) && !ec.has(`${t.key}:heads`)) return t;
    const q = ec.get(t.key);
    const h = ec.get(`${t.key}:heads`);
    return { ...t, ...(ec.has(t.key) ? { count: q ?? 0, status: q ? 'counted' as const : t.status } : {}), ...(ec.has(`${t.key}:heads`) ? { heads: h ?? null } : {}) };
  }) };
}

const table = (job: string, b: ReviewCounts, a: ReviewCounts) => {
  const kinds = [...new Set([...Object.keys(b.byKind), ...Object.keys(a.byKind)])].sort();
  const cell = (c?: ReviewCounts['byKind'][string]) => (c ? `${c.asked}/${c.info}/${c.auto}/${c.scopeStep}` : '–');
  return [`${job}: KIND (asked/info/auto/scopeStep)   BEFORE        AFTER`, ...kinds.map(k => `  ${k.padEnd(28)} ${cell(b.byKind[k]).padEnd(13)} ${cell(a.byKind[k])}`),
    `  TOTAL items ${b.total} -> ${a.total}; asked ${b.asked} -> ${a.asked}; info ${b.info} -> ${a.info}; auto ${b.auto} -> ${a.auto}; scope step ${b.scopeStep} -> ${a.scopeStep}; members ${b.members} -> ${a.members}`].join('\n');
};

let have = false;
const r: Partial<Record<'kissimmee' | '36th', ReplayReview>> = {};
beforeAll(async () => {
  have = await isPdftoppmAvailable();
  if (!have) return;
  r.kissimmee = await replayReview('kissimmee');
  r['36th'] = await replayReview('36th');
}, 900_000);

describe('fewer-questions replay gate (vs review-baseline-2026-10-01)', () => {
  for (const job of ['kissimmee', '36th'] as const) {
    it(`${job}: no question disappears without a trace`, (ctx) => {
      if (!have) return ctx.skip();
      const after = r[job]!.items;
      const members = new Set(after.filter(i => i.id.startsWith('textzero:')).flatMap(i => (i.groupedTypes ?? []).map(m => m.key)));
      const missing = BASELINE.jobs[job].items.filter(b => {
        const same = after.find(i => i.id === b.id);
        if (same) {
          if (same.resolution?.auto) return !(same.resolution.auto.evidence.length > 0);
          return false;
        }
        return !(b.typeKey && members.has(b.typeKey));
      });
      expect(missing.map(m => m.id)).toEqual([]);
    });

    it(`${job}: blocking unchanged — unanswered is needs_review; scripted answers give the baseline's enforced counts`, (ctx) => {
      if (!have) return ctx.skip();
      const after = r[job]!.items;
      expect(reviewStatus(after)).toBe('needs_review');
      const stored = job === '36th' ? storedAnswers(r[job]!.live) : undefined;
      const answered = answerAll(after, stored);
      expect(reviewStatus(answered)).toBe('clear');
      const baselineAnswered = answerAll(asBaseline(after), stored);
      expect(new Set(baselineAnswered.map(i => i.id))).toEqual(new Set(BASELINE.jobs[job].items.map(i => i.id)));
      expect(Object.fromEntries(enforcedCounts(r[job]!.countResult, answered).byType)).toEqual(Object.fromEntries(enforcedCounts(r[job]!.countResult, baselineAnswered).byType));
    });

    it(`${job}: accuracy — the expected-file diff on the enforced counts is identical to the baseline answered the same way`, (ctx) => {
      if (!have) return ctx.skip();
      const after = r[job]!.items;
      const stored = job === '36th' ? storedAnswers(r[job]!.live) : undefined;
      const cr = r[job]!.countResult;
      const now = diffAgainstExpected(expectedOf(EXPECTED[job]), enforcedResult(cr, after));
      // baseline: nothing answered automatically; 36th with Jake's stored area answers
      const before = diffAgainstExpected(expectedOf(EXPECTED[job]), enforcedResult(cr, asBaseline(after).map(i => (i.resolution?.by === 'human' && !stored?.get(i.id) ? { ...i, resolution: undefined } : stored?.get(i.id)?.resolution && i.id.startsWith('area:') ? { ...i, resolution: stored.get(i.id)!.resolution } : i))));
      for (const b of before.rows) {
        const a = now.rows.find(x => x.id === b.id)!;
        if (b.verdict === 'pass') expect([a.id, a.verdict]).toEqual([b.id, 'pass']);
        if (b.delta != null && a.delta != null) expect(Math.abs(a.delta), a.id).toBeLessThanOrEqual(Math.abs(b.delta));
      }
      if (job === '36th') expect(now.rows.map(x => [x.id, x.actual])).toEqual(before.rows.map(x => [x.id, x.actual]));
    });
  }

  it("36th: the automatic answers are exactly Jake's stored answers; projected hours unchanged", async (ctx) => {
    if (!have) return ctx.skip();
    const x = r['36th']!;
    const stored = storedAnswers(x.live);
    const autos = x.items.filter(i => i.resolution?.auto);
    expect(autos.map(i => i.id).sort()).toEqual(['area:$', 'area:ELECTRICAL PANEL', 'area:PANEL B']);
    for (const i of autos) expect([i.resolution!.answer, i.resolution!.qty, i.resolution!.by]).toEqual([stored.get(i.id)!.resolution!.answer, stored.get(i.id)!.resolution!.qty, AUTO_BY]);
    const lib = loadLiveLibrary0930();
    const withJake = x.items.map(i => (stored.get(i.id)?.resolution && i.resolution?.auto ? { ...i, resolution: stored.get(i.id)!.resolution } : i));
    const a = await replayPricing(x.live, lib, { rows: 'projected', countResult: x.countResult, reviewItems: x.items, stage: 'due', ignoreCostLineSeeds: true });
    const b = await replayPricing(x.live, lib, { rows: 'projected', countResult: x.countResult, reviewItems: withJake, stage: 'due', ignoreCostLineSeeds: true });
    expect(a.hours).toBe(b.hours);
    expect(a.material).toBe(b.material);
  }, 300_000);

  it('pinned counts (update only with a report entry), printed before/after by kind', (ctx) => {
    if (!have) return ctx.skip();
    const k = reviewCounts(r.kissimmee!.items), t = reviewCounts(r['36th']!.items);
    // eslint-disable-next-line no-console
    console.log(`${table('Kissimmee', BASELINE.jobs.kissimmee.counts, k)}\n${table('36th Street', BASELINE.jobs['36th'].counts, t)}`);
    expect(k.asked).toBeLessThanOrEqual(10);
    expect(t.asked).toBeLessThanOrEqual(10);
    const pin = (c: ReviewCounts) => ({ total: c.total, asked: c.asked, info: c.info, auto: c.auto, scopeStep: c.scopeStep, byKind: Object.fromEntries(Object.entries(c.byKind).map(([kk, v]) => [kk, `${v.asked}/${v.info}/${v.auto}/${v.scopeStep}`])) });
    expect(pin(k)).toEqual({ total: 17, asked: 10, info: 4, auto: 0, scopeStep: 3, byKind: {
      textzero: '1/0/0/0', photo: '0/1/0/0', typicalassign: '1/0/0/0', typicalqty: '3/0/0/0', area: '2/0/0/0', 'legend-zero': '1/0/0/0', unscheduled: '2/0/0/0',
      scope: '0/0/0/3', pipepoles: '0/1/0/0', spotcheck: '0/2/0/0' } });
    expect(pin(t)).toEqual({ total: 19, asked: 8, info: 8, auto: 3, scopeStep: 0, byKind: {
      area: '0/0/3/0', textzero: '1/0/0/0', unlisted: '2/0/0/0', demosuggest: '3/0/0/0', count: '0/3/0/0', 'legend-zero': '1/0/0/0',
      schedule: '0/1/0/0', democompare: '0/1/0/0', reuse: '1/0/0/0', remodel: '0/2/0/0', 'legend-unused': '0/1/0/0' } });
    void kindOf;
  });
});
