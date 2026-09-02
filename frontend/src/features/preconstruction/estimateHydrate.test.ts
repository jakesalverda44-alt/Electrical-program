import { describe, expect, it } from 'vitest';
import { overridesFromEstimate } from './estimateHydrate';
import { EstimateLineItem } from '../../types';

function li(over: Partial<EstimateLineItem>): EstimateLineItem {
  return {
    category: 'LIGHTING', item: 'Wall Pack Fixture', qty: 4, unit: 'EA',
    unit_cost: 100, total: 400, overridden: false,
    ...over,
  };
}

describe('overridesFromEstimate', () => {
  it('returns the category||item unit_cost for rows marked overridden', () => {
    const rows = [li({ overridden: true, unit_cost: 125 })];
    expect(overridesFromEstimate(rows)).toEqual({ 'LIGHTING||Wall Pack Fixture': 125 });
  });

  it('omits rows that were not overridden — those should keep tracking the library price', () => {
    const rows = [li({ overridden: false })];
    expect(overridesFromEstimate(rows)).toEqual({});
  });

  it('handles a mix of overridden and non-overridden rows across categories', () => {
    const rows = [
      li({ category: 'LIGHTING', item: 'Wall Pack Fixture', overridden: true, unit_cost: 125 }),
      li({ category: 'LIGHTING', item: 'Recessed Can', overridden: false, unit_cost: 45 }),
      li({ category: 'SERVICE', item: '400A Panel', overridden: true, unit_cost: 3200 }),
    ];
    expect(overridesFromEstimate(rows)).toEqual({
      'LIGHTING||Wall Pack Fixture': 125,
      'SERVICE||400A Panel': 3200,
    });
  });

  it('returns an empty object for an empty or missing line_items array', () => {
    expect(overridesFromEstimate([])).toEqual({});
    expect(overridesFromEstimate(undefined)).toEqual({});
    expect(overridesFromEstimate(null)).toEqual({});
  });

  it('keys collide the same way computePricingItems does when category and item repeat', () => {
    // Not a realistic saved-estimate shape, but the key composition must match
    // PcWorkspace's `${li.category}||${li.item}` exactly — a duplicate key here
    // means the later row wins, same as a plain object literal would.
    const rows = [
      li({ overridden: true, unit_cost: 100 }),
      li({ overridden: true, unit_cost: 200 }),
    ];
    expect(overridesFromEstimate(rows)).toEqual({ 'LIGHTING||Wall Pack Fixture': 200 });
  });
});
