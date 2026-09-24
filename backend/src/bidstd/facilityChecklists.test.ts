// Evidence round 4.6 — facility checklists.
import { describe, it, expect } from 'vitest';
import { facilityKindsFor, facilityChecklistItems } from './facilityChecklists';

describe('facilityKindsFor', () => {
  it('matches by project type keywords, case-insensitively', () => {
    expect(facilityKindsFor('C-Store / Fuel')).toEqual(['fuel_cstore']);
    expect(facilityKindsFor('Car Wash')).toEqual(['car_wash']);
    expect(facilityKindsFor('Self-Storage')).toEqual(['storage']);
    expect(facilityKindsFor('National Account Prototype Retail')).toEqual(['prototype_retail']);
  });
  it('an ordinary project type matches nothing', () => {
    expect(facilityKindsFor('Office Tenant Improvement')).toEqual([]);
    expect(facilityKindsFor(null)).toEqual([]);
  });
  it('a brand alone is never enough — "prototype" must be in the project type', () => {
    expect(facilityKindsFor('Retail Store', 'AutoZone')).toEqual([]);
  });
  it('more than one kind can apply', () => {
    expect(facilityKindsFor('Fuel c-store, national prototype')).toEqual(['fuel_cstore', 'prototype_retail']);
  });
});

describe('facilityChecklistItems', () => {
  it('flattens every matched kind\'s checklist, tagged with its kind', () => {
    const items = facilityChecklistItems('Car Wash');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(i => i.kind === 'car_wash')).toBe(true);
    expect(items.map(i => i.id)).toContain('vacuum-islands');
  });
  it('no match, no items', () => {
    expect(facilityChecklistItems('Office')).toEqual([]);
  });
});
