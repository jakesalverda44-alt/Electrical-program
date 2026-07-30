import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseTakeoffWorkbook } from '../utils/takeoffParse';

const fixture = (dir: string, n: string) => readFileSync(join(__dirname, 'fixtures', dir, n));
const autozone = () => parseTakeoffWorkbook(fixture('prebid', 'autozone_takeoff.xlsx'));
const carwash = () => parseTakeoffWorkbook(fixture('prebid', 'elcarwash_takeoff.xlsx'));

// Synthetic fixture in the older finished-bid shape: ITEM | DESCRIPTION | UNIT | QTY |
// NOTES columns, no CONF. column, all-numeric quantities. Real Cowork workbooks on disk
// are all pre-bid-shaped (CONF. column + unresolved rows), so there is no ready-made
// "final" sample to assert against — this is generated (see the repo history for the
// build script) to guard the one behaviour this task must not change: the finished-bid
// parse path.
const finalShaped = () => parseTakeoffWorkbook(fixture('final', 'final_takeoff.xlsx'));

describe('parseTakeoffWorkbook — unresolved quantities', () => {
  it('keeps rows whose quantity reads VERIFY instead of dropping them', () => {
    const items = autozone().lineItems.filter(i => i.qty === null);
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.every(i => typeof i.qtyRaw === 'string' && i.qtyRaw.length > 0)).toBe(true);
  });

  it('keeps all three site and exterior lighting lines', () => {
    const ext = autozone().lineItems.filter(i => i.category === 'EXTERIOR / SITE LIGHTING');
    expect(ext).toHaveLength(3);
    expect(ext.every(i => i.qty === null)).toBe(true);
  });

  it('excludes unresolved rows from totals but counts them separately', () => {
    const cat = autozone().categories.find(c => c.name === 'EXTERIOR / SITE LIGHTING')!;
    expect(cat.unresolvedCount).toBe(3);
    expect(Object.values(cat.totals).every(v => Number.isFinite(v))).toBe(true);
  });
});

describe('parseTakeoffWorkbook — confidence and ranges', () => {
  it('captures the CONF. column', () => {
    const items = autozone().lineItems;
    expect(items.some(i => i.confidence === 'FIRM')).toBe(true);
    expect(items.some(i => i.confidence === 'APPROX')).toBe(true);
    expect(items.some(i => i.confidence === 'VERIFY')).toBe(true);
  });

  it('parses a stated range out of the notes', () => {
    const a = autozone().lineItems.find(i => i.description.startsWith('Type A'))!;
    expect(a.qty).toBe(64);
    expect(a.qtyLow).toBe(58);
    expect(a.qtyHigh).toBe(70);
  });

  it('captures notes from a SOURCE / BASIS / NOTES header', () => {
    expect(autozone().lineItems.filter(i => i.notes && i.notes.length > 0).length).toBeGreaterThan(20);
  });
});

describe('parseTakeoffWorkbook — job-type variation', () => {
  it('collapses the car wash branch power split for alignment', () => {
    const names = carwash().categories.map(c => c.name);
    expect(names.filter(n => n === 'BRANCH POWER')).toHaveLength(1);
  });

  it('preserves the raw split as subcategories so cost drivers survive', () => {
    const cat = carwash().categories.find(c => c.name === 'BRANCH POWER')!;
    const subs = cat.subcategories.map(s => s.name).sort();
    expect(subs).toEqual(['BRANCH POWER — BUILDING', 'BRANCH POWER — CAR WASH EQUIPMENT']);
    expect(autozone().categories.find(c => c.name === 'BRANCH POWER')!.subcategories).toHaveLength(1);
  });

  it('keeps categoryRaw on every line item', () => {
    expect(carwash().lineItems.every(i => typeof i.categoryRaw === 'string' && i.categoryRaw)).toBe(true);
  });
});

describe('parseTakeoffWorkbook — header and narrative', () => {
  it('reads gross square footage from the header block', () => {
    expect(autozone().sqFt).toBe(7381);
  });

  it('captures the trailing key findings block', () => {
    const kf = autozone().keyFindings;
    expect(kf.length).toBeGreaterThan(3);
    expect(kf.join(' ')).toMatch(/OFEI/i);
  });
});

describe('parseTakeoffWorkbook — final (finished-bid) path regression guard', () => {
  it('never marks a resolved row as unresolved', () => {
    const items = finalShaped().lineItems;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(i => i.qty !== null)).toBe(true);
    expect(items.every(i => i.qtyRaw === undefined)).toBe(true);
  });

  it('never assigns a confidence when there is no CONF. column', () => {
    expect(finalShaped().lineItems.every(i => i.confidence === undefined)).toBe(true);
  });

  it('has zero unresolved rows in every category', () => {
    expect(finalShaped().categories.every(c => c.unresolvedCount === 0)).toBe(true);
  });

  it('sums category totals to the raw numeric quantities', () => {
    const cats = finalShaped().categories;
    const service = cats.find(c => c.name === 'SERVICE & DISTRIBUTION')!;
    const branch = cats.find(c => c.name === 'BRANCH POWER')!;
    expect(service.totals).toEqual({ EA: 3 }); // 1 (panel) + 2 (meter base)
    expect(branch.totals).toEqual({ EA: 30 }); // 24 (duplex) + 6 (GFCI)
  });

  it('gives every category exactly one subcategory matching the raw heading and totals', () => {
    for (const cat of finalShaped().categories) {
      expect(cat.subcategories).toHaveLength(1);
      expect(cat.subcategories[0].totals).toEqual(cat.totals);
    }
    const branch = finalShaped().categories.find(c => c.name === 'BRANCH POWER')!;
    expect(branch.subcategories[0].name).toBe('BRANCH POWER — BUILDING');
  });

  it('populates categoryRaw, and the em-dash qualifier survives normalization as a difference', () => {
    const items = finalShaped().lineItems;
    expect(items.every(i => typeof i.categoryRaw === 'string' && i.categoryRaw.length > 0)).toBe(true);
    const branchItem = items.find(i => i.category === 'BRANCH POWER')!;
    expect(branchItem.categoryRaw).toBe('BRANCH POWER — BUILDING');
    expect(branchItem.categoryRaw).not.toBe(branchItem.category);
  });

  it('reads gross square footage from the header block', () => {
    expect(finalShaped().sqFt).toBe(5200);
  });

  it('still captures notes on a finished-bid workbook', () => {
    expect(finalShaped().lineItems.filter(i => i.notes && i.notes.length > 0).length).toBeGreaterThan(0);
  });
});
