import { describe, it, expect } from 'vitest';
import { blankGenForm, calcGenTotals } from './genCalc';
import { GenForm } from './genData';

describe('calcGenTotals', () => {
  it('computes subtotal, tax, total and 50% deposit consistently', () => {
    const form = blankGenForm();
    const t = calcGenTotals(form);

    // Subtotal is the sum of all line items
    const lineSum =
      t.genP + t.padAmt + t.smmTotal + t.surgeTotal + t.batteryAmt + t.extraWireAmt +
      t.extraATS + t.lcATS + t.liftAmt + t.removalFee + t.laborAmt + t.permitAmt + t.startupAmt;
    expect(t.subtotal).toBe(lineSum);

    // Taxable = subtotal - discount; total = taxable + tax
    expect(t.taxable).toBe(t.subtotal - t.discountAmt);
    expect(t.total).toBe(t.taxable + t.tax);

    // Deposit is half the total (rounded)
    expect(t.deposit).toBe(Math.round(t.total * 0.5));
  });

  it('applies a percentage discount before tax', () => {
    const form: GenForm = { ...blankGenForm(), discount: 10, discountType: '%', taxRate: 7 };
    const t = calcGenTotals(form);
    expect(t.discountAmt).toBe(Math.round(t.subtotal * 0.1));
    expect(t.tax).toBe(Math.round(t.taxable * 0.07));
  });

  it('applies a flat dollar discount', () => {
    const form: GenForm = { ...blankGenForm(), discount: 500, discountType: '$' };
    const t = calcGenTotals(form);
    expect(t.discountAmt).toBe(500);
    expect(t.taxable).toBe(t.subtotal - 500);
  });
});
