import { describe, it, expect } from 'vitest';
import { blankEvForm, calcEvTotals, migrateEvForm, evPriceRows, evProposalNo } from './evCalc';
import { EvForm, EV_PRICES } from './evData';
import { CustomItem } from './genData';

function item(over: Partial<CustomItem> = {}): CustomItem {
  return { id: 'i1', desc: 'Extra 40 ft of run', amount: 400, taxable: false, ...over };
}

describe('calcEvTotals — distance tiers', () => {
  it('charges exactly one tier, at the published price', () => {
    expect(calcEvTotals({ ...blankEvForm(), distanceTier: 'le5' }).tierAmt).toBe(675);
    expect(calcEvTotals({ ...blankEvForm(), distanceTier: 'f6to15' }).tierAmt).toBe(993);
    expect(calcEvTotals({ ...blankEvForm(), distanceTier: 'f16to25' }).tierAmt).toBe(1275);
  });

  it('makes the tier the whole subtotal on a plain job', () => {
    const t = calcEvTotals({ ...blankEvForm(), distanceTier: 'f6to15' });
    expect(t.subtotal).toBe(993);
    expect(t.panelUpgradeAmt).toBe(0);
    expect(t.customTotal).toBe(0);
  });
});

describe('calcEvTotals — panel upgrade', () => {
  it('adds $2,200 only when selected', () => {
    const without = calcEvTotals({ ...blankEvForm(), panelUpgrade: false });
    const withUpgrade = calcEvTotals({ ...blankEvForm(), panelUpgrade: true });
    expect(without.panelUpgradeAmt).toBe(0);
    expect(withUpgrade.panelUpgradeAmt).toBe(2200);
    expect(withUpgrade.subtotal).toBe(without.subtotal + 2200);
  });
});

describe('calcEvTotals — custom line items', () => {
  it('folds described items into the subtotal', () => {
    const t = calcEvTotals({ ...blankEvForm(), customItems: [item({ amount: 400 }), item({ id: 'b', desc: 'Second charger', amount: 850 })] });
    expect(t.customTotal).toBe(1250);
    expect(t.subtotal).toBe(993 + 1250);
  });

  it('ignores a row whose description was never filled in', () => {
    const t = calcEvTotals({ ...blankEvForm(), customItems: [item({ desc: '  ', amount: 900 })] });
    expect(t.customTotal).toBe(0);
    expect(t.subtotal).toBe(993);
  });

  it('takes the taxable flag as irrelevant — EV tax is the flat amount either way', () => {
    const asGoods    = calcEvTotals({ ...blankEvForm(), customItems: [item({ amount: 400, taxable: true })] });
    const asServices = calcEvTotals({ ...blankEvForm(), customItems: [item({ amount: 400, taxable: false })] });
    expect(asGoods.tax).toBe(asServices.tax);
    expect(asGoods.total).toBe(asServices.total);
  });
});

describe('calcEvTotals — discount', () => {
  it('applies a flat dollar discount to the subtotal', () => {
    const t = calcEvTotals({ ...blankEvForm(), discount: 100, discountType: '$' });
    expect(t.discountAmt).toBe(100);
    expect(t.netSubtotal).toBe(t.subtotal - 100);
  });

  it('applies a percentage discount against the subtotal', () => {
    const t = calcEvTotals({ ...blankEvForm(), distanceTier: 'f16to25', discount: 10, discountType: '%' });
    expect(t.discountAmt).toBe(Math.round(1275 * 0.1));
    expect(t.netSubtotal).toBe(1275 - t.discountAmt);
  });
});

describe('calcEvTotals — flat tax', () => {
  it('defaults to $50 and never derives from the subtotal', () => {
    const cheap = calcEvTotals({ ...blankEvForm(), distanceTier: 'le5' });
    const dear  = calcEvTotals({ ...blankEvForm(), distanceTier: 'f16to25', panelUpgrade: true });
    expect(cheap.tax).toBe(EV_PRICES.tax);
    expect(dear.tax).toBe(EV_PRICES.tax);
    expect(dear.tax).toBe(cheap.tax);
  });

  it('is editable per quote', () => {
    expect(calcEvTotals({ ...blankEvForm(), taxAmount: 72 }).tax).toBe(72);
    expect(calcEvTotals({ ...blankEvForm(), taxAmount: 0 }).tax).toBe(0);
  });

  it('reads a non-finite amount as zero rather than poisoning the total', () => {
    const t = calcEvTotals({ ...blankEvForm(), taxAmount: NaN as unknown as number });
    expect(t.tax).toBe(0);
    expect(t.total).toBe(t.netSubtotal);
  });

  it('lands on the total after the discount, not before', () => {
    const t = calcEvTotals({ ...blankEvForm(), discount: 100, discountType: '$', taxAmount: 50 });
    expect(t.total).toBe(t.subtotal - 100 + 50);
  });
});

describe('calcEvTotals — deposit', () => {
  it('defaults to no deposit', () => {
    const form = blankEvForm();
    expect(form.depositPct).toBe(0);
    expect(calcEvTotals(form).deposit).toBe(0);
  });

  it('computes from the percentage when the rep sets one', () => {
    const t = calcEvTotals({ ...blankEvForm(), depositPct: 50 });
    expect(t.deposit).toBe(Math.round(t.total * 0.5));
  });
});

describe('evPriceRows', () => {
  const fmt = (n: number) => `$${n}`;

  it('names the tier on the installation row', () => {
    const form: EvForm = { ...blankEvForm(), distanceTier: 'f16to25' };
    const rows = evPriceRows(form, calcEvTotals(form), fmt);
    expect(rows[0].label).toBe('Wall Connector Installation — 16 to 25 feet');
    expect(rows[0].amount).toBe('$1275');
  });

  it('omits the panel upgrade row unless selected', () => {
    const off: EvForm = { ...blankEvForm(), panelUpgrade: false };
    const on: EvForm  = { ...blankEvForm(), panelUpgrade: true };
    expect(evPriceRows(off, calcEvTotals(off), fmt).some(r => r.label.includes('Service Upgrade'))).toBe(false);
    expect(evPriceRows(on, calcEvTotals(on), fmt).some(r => r.label.includes('Service Upgrade'))).toBe(true);
  });

  it('lists each described custom item', () => {
    const form: EvForm = { ...blankEvForm(), customItems: [item({ desc: 'Extra 40 ft of run', amount: 400 })] };
    const rows = evPriceRows(form, calcEvTotals(form), fmt);
    expect(rows.find(r => r.label === 'Extra 40 ft of run')?.amount).toBe('$400');
  });
});

describe('migrateEvForm', () => {
  it('fills in every field a partially-shaped saved form is missing', () => {
    const migrated = migrateEvForm({});
    expect(migrated.customItems).toEqual([]);
    expect(migrated.distanceTier).toBe('f6to15');
    expect(migrated.panelUpgrade).toBe(false);
    expect(migrated.taxAmount).toBe(EV_PRICES.tax);
    expect(migrated.depositPct).toBe(0);
    expect(migrated.validDays).toBe(30);
  });

  it('coerces a malformed customItems value to an empty list', () => {
    expect(migrateEvForm({ customItems: null }).customItems).toEqual([]);
    expect(migrateEvForm({ customItems: 'nope' }).customItems).toEqual([]);
  });

  it('leaves a current-shape form untouched', () => {
    const current = { ...blankEvForm(), distanceTier: 'le5' as const };
    expect(migrateEvForm(current as unknown as Record<string, unknown>)).toEqual(current);
  });
});

describe('evProposalNo', () => {
  it('uses the JSEV prefix and the MMDDYYYY-### shape', () => {
    expect(evProposalNo()).toMatch(/^JSEV-\d{8}-\d{3}$/);
  });
});

describe('calcEvTotals — install price override', () => {
  it('defaults to no override, charging the tier price', () => {
    const form = blankEvForm();
    expect(form.tierPriceOverride).toBe(null);
    expect(calcEvTotals(form).tierAmt).toBe(993);
  });

  it('charges the typed price instead of the tier price', () => {
    const t = calcEvTotals({ ...blankEvForm(), distanceTier: 'le5', tierPriceOverride: 750 });
    expect(t.tierAmt).toBe(750);
    expect(t.subtotal).toBe(750);
  });

  it('accepts an override of zero — a giveaway install is not a missing override', () => {
    expect(calcEvTotals({ ...blankEvForm(), tierPriceOverride: 0 }).tierAmt).toBe(0);
  });

  it('falls back to the tier price when the override is non-finite', () => {
    const t = calcEvTotals({ ...blankEvForm(), distanceTier: 'f16to25', tierPriceOverride: NaN as unknown as number });
    expect(t.tierAmt).toBe(1275);
  });

  it('flows the override through to the total', () => {
    const t = calcEvTotals({ ...blankEvForm(), tierPriceOverride: 1500, taxAmount: 50 });
    expect(t.total).toBe(1550);
  });

  it('migrates a form saved before the override existed to no override', () => {
    expect(migrateEvForm({}).tierPriceOverride).toBe(null);
  });
});

describe('evPriceRows — install price override', () => {
  it('still names the tier, at the overridden amount', () => {
    const form: EvForm = { ...blankEvForm(), distanceTier: 'le5', tierPriceOverride: 750 };
    const rows = evPriceRows(form, calcEvTotals(form), (n: number) => `$${n}`);
    expect(rows[0].label).toBe('Wall Connector Installation — 5 feet or less');
    expect(rows[0].amount).toBe('$750');
  });
});
