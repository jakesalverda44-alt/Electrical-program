import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseTakeoffWorkbook } from '../utils/takeoffParse';

const fixture = (n: string) => readFileSync(join(__dirname, 'fixtures/prebid', n));
const autozone = () => parseTakeoffWorkbook(fixture('autozone_takeoff.xlsx'));
const carwash = () => parseTakeoffWorkbook(fixture('elcarwash_takeoff.xlsx'));

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
