import { describe, it, expect } from 'vitest';
import { blankGenForm, calcGenTotals, migrateGenForm } from './genCalc';
import { GenForm } from './genData';

describe('calcGenTotals', () => {
  it('computes subtotal, tax, total and 50% deposit consistently', () => {
    const form = blankGenForm();
    const t = calcGenTotals(form);

    // Subtotal is the sum of all line items
    const lineSum =
      t.genP + t.padAmt + t.genStandAmt + t.smmTotal + t.surgeTotal + t.batteryAmt + t.emPanelAmt + t.gasLineAmt + t.extraWireAmt +
      t.atsAmt + t.extWarrantyAmt + t.liftAmt + t.removalFee + t.laborAmt + t.permitAmt + t.startupAmt;
    expect(t.subtotal).toBe(lineSum);

    // Net subtotal = subtotal - discount; total = net subtotal + tax
    expect(t.netSubtotal).toBe(t.subtotal - t.discountAmt);
    expect(t.total).toBe(t.netSubtotal + t.tax);

    // Deposit is half the total (rounded)
    expect(t.deposit).toBe(Math.round(t.total * 0.5));
  });

  it('taxes goods only — labor, permit and startup are never taxed', () => {
    const form: GenForm = { ...blankGenForm(), taxRate: 7 };
    const t = calcGenTotals(form);

    expect(t.taxableBase).toBe(
      t.genP + t.padAmt + t.genStandAmt + t.batteryAmt + t.atsAmt + t.smmTotal + t.surgeTotal + t.extWarrantyAmt + t.emPanelAmt
    );
    expect(t.nonTaxableBase).toBe(
      t.gasLineAmt + t.extraWireAmt + t.liftAmt + t.removalFee + t.laborAmt + t.permitAmt + t.startupAmt
    );
    expect(t.taxableBase + t.nonTaxableBase).toBe(t.subtotal);

    // The service lines carry real money that must stay out of the tax base.
    expect(t.laborAmt + t.permitAmt + t.startupAmt).toBeGreaterThan(0);
    expect(t.tax).toBe(Math.round(t.taxableBase * 0.07));
    expect(t.tax).toBeLessThan(Math.round(t.subtotal * 0.07));
  });

  it('a free promo extended warranty adds no tax', () => {
    const paid: GenForm = { ...blankGenForm(), extWarranty: 'paid', taxRate: 7 };
    const promo: GenForm = { ...blankGenForm(), extWarranty: 'promo', taxRate: 7 };
    const tPaid = calcGenTotals(paid);
    const tPromo = calcGenTotals(promo);

    expect(tPromo.extWarrantyAmt).toBe(0);
    expect(tPromo.tax).toBeLessThan(tPaid.tax);
  });

  it('spreads a percentage discount pro-rata across taxable and non-taxable', () => {
    const form: GenForm = { ...blankGenForm(), discount: 10, discountType: '%', taxRate: 7 };
    const t = calcGenTotals(form);
    expect(t.discountAmt).toBe(Math.round(t.subtotal * 0.1));
    expect(t.taxedAmount).toBeCloseTo(t.taxableBase - (t.discountAmt * t.taxableBase) / t.subtotal, 6);
    expect(t.tax).toBe(Math.round(t.taxedAmount * 0.07));
  });

  it('applies a flat dollar discount pro-rata to the tax base', () => {
    const form: GenForm = { ...blankGenForm(), discount: 500, discountType: '$' };
    const t = calcGenTotals(form);
    expect(t.discountAmt).toBe(500);
    expect(t.netSubtotal).toBe(t.subtotal - 500);
    // Only the taxable share of the $500 comes off the tax base.
    expect(t.taxedAmount).toBeCloseTo(t.taxableBase - (500 * t.taxableBase) / t.subtotal, 6);
    expect(t.taxedAmount).toBeGreaterThan(t.taxableBase - 500);
  });

  it('air-cooled includes 1 ATS free — default qty of 1 bills nothing extra', () => {
    const form: GenForm = { ...blankGenForm(), coolingType: 'air-cooled', atsQty: 1 };
    const t = calcGenTotals(form);
    expect(t.atsIncluded).toBe(1);
    expect(t.atsBillableQty).toBe(0);
    expect(t.atsAmt).toBe(0);
  });

  it('liquid-cooled includes no ATS — every unit requested is billed', () => {
    const form: GenForm = { ...blankGenForm(), coolingType: 'liquid-cooled', size: '24KW', atsQty: 1 };
    const t = calcGenTotals(form);
    expect(t.atsIncluded).toBe(0);
    expect(t.atsBillableQty).toBe(1);
    expect(t.atsAmt).toBe(1000);
  });

  it('extended warranty: paid charges $1,100, promo waives it', () => {
    const paid  = calcGenTotals({ ...blankGenForm(), extWarranty: 'paid' });
    const promo = calcGenTotals({ ...blankGenForm(), extWarranty: 'promo', extWarrantyPromoStart: '2026-08-01', extWarrantyPromoEnd: '2026-09-30' });
    expect(paid.extWarrantyAmt).toBe(1100);
    expect(promo.extWarrantyAmt).toBe(0);
  });

  it('gen stand charges by size and replaces the pad, even if pad is still checked', () => {
    const small = calcGenTotals({ ...blankGenForm(), pad: true, genStand: 'small' });
    const big   = calcGenTotals({ ...blankGenForm(), pad: true, genStand: 'big' });
    expect(small.genStandAmt).toBe(2000);
    expect(small.padAmt).toBe(0);
    expect(big.genStandAmt).toBe(2500);
    expect(big.padAmt).toBe(0);
  });
});

describe('migrateGenForm', () => {
  it('translates old boolean smm/surgePro into qty', () => {
    const migrated = migrateGenForm({ coolingType: 'air-cooled', smm: true, surgePro: false });
    expect(migrated.smmQty).toBe(1);
    expect(migrated.surgeProQty).toBe(0);
  });

  it('translates old ats string into atsSize', () => {
    const migrated = migrateGenForm({ ats: '200A' });
    expect(migrated.atsSize).toBe('200A');
  });

  it('folds old lcATS + additionalATS into atsQty, air-cooled keeps its 1 included', () => {
    const migrated = migrateGenForm({ coolingType: 'air-cooled', lcATS: '150A', additionalATS: 1 });
    expect(migrated.atsQty).toBe(3); // 1 included + 1 lcATS + 1 additionalATS
  });

  it('folds old lcATS + additionalATS into atsQty, liquid-cooled has none included', () => {
    const migrated = migrateGenForm({ coolingType: 'liquid-cooled', lcATS: 'none', additionalATS: 1 });
    expect(migrated.atsQty).toBe(1); // 0 included + 0 lcATS + 1 additionalATS
  });

  it('defaults extWarranty to none and leaves already-current-shape data untouched', () => {
    const current = { ...blankGenForm(), smmQty: 2 };
    const migrated = migrateGenForm(current as unknown as Record<string, unknown>);
    expect(migrated).toEqual(current);
  });
});
