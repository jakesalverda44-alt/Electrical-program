import { describe, it, expect } from 'vitest';
import {
  tilesForClass, estimatePageTokens, orderScheduleFirst, packPagesByBudget,
  TOKENS_PER_TILE, PAGE_TOKEN_OVERHEAD, AGENT1_INPUT_BUDGET,
} from './agent1Batching';
import { tileSettingsFor, type SheetClass } from './documentPrep';

describe('tilesForClass (pure)', () => {
  it('matches each class\'s maxTilesPerPage default', () => {
    expect(tilesForClass('schedule')).toBe(tileSettingsFor('schedule').maxTilesPerPage);
    expect(tilesForClass('detail')).toBe(tileSettingsFor('detail').maxTilesPerPage);
    expect(tilesForClass('plan')).toBe(tileSettingsFor('plan').maxTilesPerPage);
  });

  it('applies a maxTilesPerPage override', () => {
    expect(tilesForClass('schedule', { schedule: { maxTilesPerPage: 20 } })).toBe(20);
  });
});

describe('estimatePageTokens (pure)', () => {
  it('combines tile cost, text cost, and fixed overhead', () => {
    const tiles = tilesForClass('plan');
    expect(estimatePageTokens('plan', 400)).toBe(tiles * TOKENS_PER_TILE + Math.ceil(400 / 4) + PAGE_TOKEN_OVERHEAD);
  });

  it('is dominated by tile cost for a schedule page with little text', () => {
    const est = estimatePageTokens('schedule', 0);
    expect(est).toBe(tilesForClass('schedule') * TOKENS_PER_TILE + PAGE_TOKEN_OVERHEAD);
  });

  it('grows with text length', () => {
    expect(estimatePageTokens('plan', 8000)).toBeGreaterThan(estimatePageTokens('plan', 0));
  });
});

describe('orderScheduleFirst (pure, stable)', () => {
  it('groups schedule pages before detail before plan', () => {
    const units = [
      { id: 'a', cls: 'plan' as SheetClass },
      { id: 'b', cls: 'schedule' as SheetClass },
      { id: 'c', cls: 'detail' as SheetClass },
      { id: 'd', cls: 'schedule' as SheetClass },
    ];
    expect(orderScheduleFirst(units).map(u => u.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('preserves original relative order within the same class (stable sort)', () => {
    const units = [
      { id: 1, cls: 'plan' as SheetClass },
      { id: 2, cls: 'plan' as SheetClass },
      { id: 3, cls: 'plan' as SheetClass },
    ];
    expect(orderScheduleFirst(units).map(u => u.id)).toEqual([1, 2, 3]);
  });

  it('does not mutate the input array', () => {
    const units = [{ id: 'a', cls: 'plan' as SheetClass }, { id: 'b', cls: 'schedule' as SheetClass }];
    const copy = [...units];
    orderScheduleFirst(units);
    expect(units).toEqual(copy);
  });
});

describe('packPagesByBudget (pure)', () => {
  it('fits everything in one batch when the total is under budget', () => {
    const units = [{ id: 1, estTokens: 20_000 }, { id: 2, estTokens: 30_000 }, { id: 3, estTokens: 10_000 }];
    const batches = packPagesByBudget(units, 100_000);
    expect(batches).toHaveLength(1);
    expect(batches[0].map(u => u.id)).toEqual([1, 2, 3]);
  });

  it('splits into a new batch once the running total would exceed the budget', () => {
    const units = [
      { id: 1, estTokens: 45_000 },
      { id: 2, estTokens: 45_000 },
      { id: 3, estTokens: 45_000 }, // 45k+45k=90k fits; +45k=135k does not
    ];
    const batches = packPagesByBudget(units, 100_000);
    expect(batches).toHaveLength(2);
    expect(batches[0].map(u => u.id)).toEqual([1, 2]);
    expect(batches[1].map(u => u.id)).toEqual([3]);
  });

  it('isolates a single unit whose own estimate exceeds the budget into its own batch', () => {
    const units = [
      { id: 1, estTokens: 10_000 },
      { id: 2, estTokens: 150_000 }, // over budget alone
      { id: 3, estTokens: 10_000 },
    ];
    const batches = packPagesByBudget(units, 100_000);
    expect(batches).toHaveLength(3);
    expect(batches[0].map(u => u.id)).toEqual([1]);
    expect(batches[1].map(u => u.id)).toEqual([2]);
    expect(batches[2].map(u => u.id)).toEqual([3]);
  });

  it('preserves ordering across all batches — concatenating them reproduces the input order', () => {
    const units = Array.from({ length: 12 }, (_, i) => ({ id: i, estTokens: 12_000 }));
    const batches = packPagesByBudget(units, AGENT1_INPUT_BUDGET);
    const flattened = batches.flat().map(u => u.id);
    expect(flattened).toEqual(units.map(u => u.id));
    expect(batches.length).toBeGreaterThan(1);
  });

  it('realistic 62-page/19-selected-page scenario: every batch fits under budget', () => {
    // A plausible electrical section mix: a few dense schedule/one-line sheets,
    // mostly floor/power/lighting plans, a couple of detail sheets — the exact
    // count depends on the real set, but every resulting batch must fit.
    const mix: SheetClass[] = [
      'schedule', 'schedule', 'schedule',
      'detail', 'detail',
      'plan', 'plan', 'plan', 'plan', 'plan', 'plan', 'plan', 'plan', 'plan', 'plan', 'plan', 'plan', 'plan', 'plan',
    ];
    expect(mix).toHaveLength(19);
    const units = orderScheduleFirst(mix.map((cls, i) => ({
      page: 44 + i,
      cls,
      estTokens: estimatePageTokens(cls, 500),
    })));
    const batches = packPagesByBudget(units, AGENT1_INPUT_BUDGET);
    for (const batch of batches) {
      const total = batch.reduce((s, u) => s + u.estTokens, 0);
      expect(total).toBeLessThanOrEqual(AGENT1_INPUT_BUDGET);
    }
    // Concatenating the batches reproduces every page exactly once.
    expect(batches.flat().map(u => u.page).sort((a, b) => a - b)).toEqual(mix.map((_, i) => 44 + i));
    // The headline fix: this no longer goes out as one call carrying all 19
    // pages (~19 * up to 45k tokens, far over budget) — it's split.
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.length).toBeLessThan(19); // and it's not one call per page either
  });

  it('returns no batches for an empty input', () => {
    expect(packPagesByBudget([], 100_000)).toEqual([]);
  });
});
