// Typical fix (2026-09-28) — untyped hosts shared by several legend types
// become ONE blocking review item ("6 power poles, 5 pole types in #9 —
// assign a type to each pole"), answered type by type. Nothing is added
// until a type is answered; the suggestion is never counted.
import { describe, it, expect } from 'vitest';
import { applyReconcileMemberResolution, buildReviewItems, carryOverResolutions, enforcedCounts, groupOf, reviewItemIsOpen, riskRank, type ReviewItem } from './reviewItems';
import { expandTypicals, type TypicalPackage } from './evidence/typicals';
import type { CountTarget } from './countTargets';
import type { CountResult } from './countingStage';
import { loadKissimmeeLive0928 } from '../test/fixtures/realrun/kissimmeeLive';

const D = 'DUPLEX / FLOOR RECEPTACLE';

function fixture(hostCount = 6): CountResult {
  const live = loadKissimmeeLive0928();
  const targets = live.countResult.targets as CountTarget[];
  const packages = live.countResult.evidence.typicals as TypicalPackage[];
  const sheet = packages.find(p => p.hostTargetKey === 'PP-1..6')!.sheetKey;
  const r = expandTypicals(packages, new Map([
    ['PP-1..6', { count: hostCount, sheets: ['E-2'], marks: Array.from({ length: hostCount }, (_, i) => ({ sheetKey: sheet, x: i * 5, y: 0 })) }],
    ['FLEX J', { count: 3, sheets: ['E-1'], marks: [] }],
  ]), [], targets);
  const cr = live.countResult as unknown as CountResult;
  // Drawn counts only (what the fixed merge leaves before any answer).
  cr.types = cr.types.map(t => (t.key === D ? { ...t, count: 6 } : t.key === 'SIMPLEX' ? { ...t, count: 7 } : t));
  cr.evidence = { ...cr.evidence!, expansions: r.expansions, hostAssignments: r.hostGroups };
  return cr;
}

const itemOf = (items: ReviewItem[]) => items.find(i => i.id.startsWith('typicalassign:'))!;

describe('the host-type assignment item', () => {
  const cr = fixture();
  const items = buildReviewItems(cr);
  const item = itemOf(items);

  it('one blocking item in the typical group, ranked with the typical multipliers; no per-pole "same outlet?" questions', () => {
    expect(items.filter(i => i.id.startsWith('typicalassign:')).length).toBe(1);
    expect(item.id).toBe('typicalassign:PP-1..6');
    expect(reviewItemIsOpen(item)).toBe(true);
    expect([groupOf(item), riskRank(item)]).toEqual(['typical', 15]);
    expect(item.title).toBe('6 power poles, 5 power pole types in #9 POWER POLE LEGEND — assign a type to each power pole');
    expect(items.filter(i => i.id.startsWith('typicalat:'))).toEqual([]);
    expect(item.reconcileMembers!.every(m => m.currentQty === 0 && m.unit === 'count')).toBe(true);
    expect(item.actions).toEqual(['count', 'confirm']);
  });

  it('nothing is counted before an answer — the suggestion included', () => {
    const e = enforcedCounts(cr, items).byType;
    expect([e.get(D), e.get('SIMPLEX')]).toEqual([6, 7]);
  });

  it('each answered type adds its outlets x its poles; "keep current count 0" adds none; the item closes when every type is answered', () => {
    let it0 = applyReconcileMemberResolution(item, '#1 Office area power pole', { action: 'count', qty: 1 }, 'Jake');
    let e = enforcedCounts(cr, items.map(i => (i.id === it0.id ? it0 : i))).byType;
    expect([e.get(D), e.get('SIMPLEX')]).toEqual([8, 7]); // office: 2 duplex; its floor simplex is counted where drawn
    expect(reviewItemIsOpen(it0)).toBe(true);
    it0 = applyReconcileMemberResolution(it0, '#4 Test station power pole', { action: 'count', qty: 1 }, 'Jake');
    it0 = applyReconcileMemberResolution(it0, '#3 Parts pod power pole', { action: 'count', qty: 2 }, 'Jake');
    it0 = applyReconcileMemberResolution(it0, '#2 Checkout counter power pole', { action: 'confirm', reason: 'no checkout pole on this job' }, 'Jake');
    it0 = applyReconcileMemberResolution(it0, '#6 Commercial counter power pole', { action: 'count', qty: 1 }, 'Jake');
    expect(reviewItemIsOpen(it0)).toBe(false);
    e = enforcedCounts(cr, items.map(i => (i.id === it0.id ? it0 : i))).byType;
    expect([e.get(D), e.get('SIMPLEX')]).toEqual([6 + 2 + 1 + 2 + 2, 7 + 1]);
  });

  it('a device type marked not on this job stays off', () => {
    const it0 = applyReconcileMemberResolution(item, '#6 Commercial counter power pole', { action: 'count', qty: 1 }, 'Jake');
    const off: ReviewItem = { id: `count:${D}`, kind: 'count', title: D, detail: '', typeKey: D, resolution: { action: 'not_on_job', reason: 'owner supplies them', by: 'J', at: 't' } };
    const e = enforcedCounts(cr, [...items.map(i => (i.id === it0.id ? it0 : i)), off]).byType;
    expect(e.get(D)).toBeNull();
  });

  it('a re-run carries the member answers when nothing changed; not when the pole count changed', () => {
    const answered = applyReconcileMemberResolution(item, '#3 Parts pod power pole', { action: 'count', qty: 2 }, 'Jake');
    const same = itemOf(carryOverResolutions(buildReviewItems(fixture()), [answered]));
    expect(same.reconcileMembers!.find(m => m.key === '#3 Parts pod power pole')!.resolution).toMatchObject({ action: 'count', qty: 2, carriedOver: true });
    const changed = itemOf(carryOverResolutions(buildReviewItems(fixture(7)), [answered]));
    expect(changed.reconcileMembers!.every(m => !m.resolution)).toBe(true);
  });
});
