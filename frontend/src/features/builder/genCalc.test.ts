import { describe, it, expect } from 'vitest';
import { blankGenForm, calcGenTotals, migrateGenForm, genPriceRows, activeCustomItems } from './genCalc';
import { GenForm, CustomItem } from './genData';

function item(over: Partial<CustomItem> = {}): CustomItem {
  return { id: 'i1', desc: 'Relocate hose bib', amount: 350, taxable: false, ...over };
}

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

  it('a free Silver Service promo (either year count) adds no tax', () => {
    const oneYear = calcGenTotals({ ...blankGenForm(), silverServicePromo: '1yr', taxRate: 7 });
    const twoYear = calcGenTotals({ ...blankGenForm(), silverServicePromo: '2yr', taxRate: 7 });
    const none    = calcGenTotals({ ...blankGenForm(), silverServicePromo: 'none', taxRate: 7 });
    expect(oneYear.tax).toBe(none.tax);
    expect(twoYear.tax).toBe(none.tax);
  });
});

describe('calcGenTotals — custom line items', () => {
  const base = () => ({ ...blankGenForm(), taxRate: 7 });

  it('a taxable item raises the taxable base and the tax charged', () => {
    const none = calcGenTotals(base());
    const t = calcGenTotals({ ...base(), customItems: [item({ amount: 400, taxable: true })] });

    expect(t.customTaxableAmt).toBe(400);
    expect(t.customNonTaxableAmt).toBe(0);
    expect(t.taxableBase).toBe(none.taxableBase + 400);
    expect(t.nonTaxableBase).toBe(none.nonTaxableBase);
    expect(t.tax).toBe(Math.round(t.taxableBase * 0.07));
    expect(t.tax).toBeGreaterThan(none.tax);
  });

  it('a non-taxable item raises the total but never the tax', () => {
    const none = calcGenTotals(base());
    const t = calcGenTotals({ ...base(), customItems: [item({ amount: 400, taxable: false })] });

    expect(t.customNonTaxableAmt).toBe(400);
    expect(t.nonTaxableBase).toBe(none.nonTaxableBase + 400);
    expect(t.taxableBase).toBe(none.taxableBase);
    expect(t.tax).toBe(none.tax);
    expect(t.total).toBe(none.total + 400);
  });

  it('splits a mix into both bases and keeps the discount prorated across them', () => {
    const form: GenForm = {
      ...base(),
      discount: 10,
      discountType: '%',
      customItems: [
        item({ id: 'a', desc: 'Extra 60A breaker', amount: 185, taxable: true }),
        item({ id: 'b', desc: 'Relocate hose bib', amount: 350, taxable: false }),
      ],
    };
    const t = calcGenTotals(form);

    expect(t.customTaxableAmt).toBe(185);
    expect(t.customNonTaxableAmt).toBe(350);
    expect(t.customTotal).toBe(535);
    expect(t.taxableBase + t.nonTaxableBase).toBe(t.subtotal);
    expect(t.taxedAmount).toBeCloseTo(t.taxableBase - (t.discountAmt * t.taxableBase) / t.subtotal, 6);
    expect(t.tax).toBe(Math.round(t.taxedAmount * 0.07));
  });

  it('ignores a row whose description was never filled in', () => {
    const none = calcGenTotals(base());
    const t = calcGenTotals({ ...base(), customItems: [item({ desc: '   ', amount: 900, taxable: true })] });

    expect(t.customTotal).toBe(0);
    expect(t.subtotal).toBe(none.subtotal);
    expect(t.tax).toBe(none.tax);
  });

  it('reads a negative amount as a credit against the subtotal', () => {
    const none = calcGenTotals(base());
    const t = calcGenTotals({ ...base(), customItems: [item({ desc: 'Courtesy credit', amount: -200, taxable: false })] });

    expect(t.customTotal).toBe(-200);
    expect(t.subtotal).toBe(none.subtotal - 200);
    expect(t.total).toBe(none.total - 200);
  });

  it('treats a non-finite amount as zero rather than poisoning the total', () => {
    const none = calcGenTotals(base());
    const t = calcGenTotals({ ...base(), customItems: [item({ amount: NaN as unknown as number, taxable: true })] });

    expect(t.customTotal).toBe(0);
    expect(t.total).toBe(none.total);
  });

  it('survives a form whose customItems came back malformed', () => {
    const none = calcGenTotals(base());
    const t = calcGenTotals({ ...base(), customItems: null as unknown as CustomItem[] });
    expect(t.total).toBe(none.total);
  });
});

describe('activeCustomItems', () => {
  it('keeps only the described rows, in order', () => {
    const items = [
      item({ id: 'a', desc: 'First' }),
      item({ id: 'b', desc: '' }),
      item({ id: 'c', desc: 'Second' }),
    ];
    expect(activeCustomItems({ customItems: items }).map(i => i.id)).toEqual(['a', 'c']);
  });
});

describe('genPriceRows — custom line items', () => {
  const fmt = (n: number) => `$${n}`;

  it('lists each described item with its own amount', () => {
    const form = { ...blankGenForm(), customItems: [item({ desc: 'Extra 60A breaker', amount: 185, taxable: true })] };
    const rows = genPriceRows(form, calcGenTotals(form), fmt);
    const row = rows.find(r => r.label === 'Extra 60A breaker');
    expect(row?.amount).toBe('$185');
  });

  it('omits a row with no description', () => {
    // 187 rather than a round number: it can't collide with a catalog price (the battery
    // maintainer is $185) and so proves the row itself is absent.
    const form = { ...blankGenForm(), customItems: [item({ desc: '', amount: 187 })] };
    const rows = genPriceRows(form, calcGenTotals(form), fmt);
    expect(rows.some(r => r.amount === '$187')).toBe(false);
  });
});

describe('genPriceRows — Silver Service line item', () => {
  const fmt = (n: number) => `$${n}`;

  it('omits the line when no promo is selected', () => {
    const form = { ...blankGenForm(), silverServicePromo: 'none' as const };
    const rows = genPriceRows(form, calcGenTotals(form), fmt);
    expect(rows.some(r => r.label.includes('Silver Service'))).toBe(false);
  });

  it('states 1 year and its $395 value explicitly', () => {
    const form = { ...blankGenForm(), silverServicePromo: '1yr' as const };
    const rows = genPriceRows(form, calcGenTotals(form), fmt);
    const row = rows.find(r => r.label.includes('Silver Service'));
    expect(row?.label).toBe('1-Year Silver Service — Promo: $395 → FREE');
    expect(row?.amount).toBe('$0');
  });

  it('states 2 years and the doubled $790 value explicitly', () => {
    const form = { ...blankGenForm(), silverServicePromo: '2yr' as const };
    const rows = genPriceRows(form, calcGenTotals(form), fmt);
    const row = rows.find(r => r.label.includes('Silver Service'));
    expect(row?.label).toBe('2-Year Silver Service — Promo: $790 → FREE');
    expect(row?.amount).toBe('$0');
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

  it('translates the old boolean silverServicePromo (true) into the 1yr enum', () => {
    const migrated = migrateGenForm({ silverServicePromo: true });
    expect(migrated.silverServicePromo).toBe('1yr');
  });

  it('translates the old boolean silverServicePromo (false) and missing values into none', () => {
    expect(migrateGenForm({ silverServicePromo: false }).silverServicePromo).toBe('none');
    expect(migrateGenForm({}).silverServicePromo).toBe('none');
  });

  it('leaves an already-migrated silverServicePromo string untouched', () => {
    expect(migrateGenForm({ silverServicePromo: '2yr' }).silverServicePromo).toBe('2yr');
  });

  it('defaults a proposal saved before the charger add-on to no charger', () => {
    const migrated = migrateGenForm({});
    expect(migrated.evCharger).toBe(false);
    expect(migrated.evChargerTier).toBe('f6to15');
  });

  it('gives a proposal saved before custom items an empty list', () => {
    expect(migrateGenForm({}).customItems).toEqual([]);
  });

  it('coerces a malformed customItems value to an empty list', () => {
    expect(migrateGenForm({ customItems: null }).customItems).toEqual([]);
    expect(migrateGenForm({ customItems: 'nope' }).customItems).toEqual([]);
    expect(migrateGenForm({ customItems: { a: 1 } }).customItems).toEqual([]);
  });

  it('leaves a real customItems list untouched', () => {
    const items = [item()];
    expect(migrateGenForm({ customItems: items }).customItems).toEqual(items);
  });
});

describe('calcGenTotals — bundled EV charger', () => {
  const base = () => ({ ...blankGenForm(), taxRate: 7 });

  it('is off by default and costs nothing', () => {
    const form = blankGenForm();
    expect(form.evCharger).toBe(false);
    expect(calcGenTotals(form).evChargerAmt).toBe(0);
  });

  it('charges the same tier prices as a standalone charger quote', () => {
    expect(calcGenTotals({ ...base(), evCharger: true, evChargerTier: 'le5' }).evChargerAmt).toBe(675);
    expect(calcGenTotals({ ...base(), evCharger: true, evChargerTier: 'f6to15' }).evChargerAmt).toBe(993);
    expect(calcGenTotals({ ...base(), evCharger: true, evChargerTier: 'f16to25' }).evChargerAmt).toBe(1275);
  });

  it('joins the non-taxable base, so it raises the total but never the tax', () => {
    const without = calcGenTotals(base());
    const withCharger = calcGenTotals({ ...base(), evCharger: true, evChargerTier: 'f6to15' });

    expect(withCharger.nonTaxableBase).toBe(without.nonTaxableBase + 993);
    expect(withCharger.taxableBase).toBe(without.taxableBase);
    expect(withCharger.tax).toBe(without.tax);
    expect(withCharger.total).toBe(without.total + 993);
  });

  it('costs nothing when the tier is set but the box is unchecked', () => {
    const t = calcGenTotals({ ...base(), evCharger: false, evChargerTier: 'f16to25' });
    expect(t.evChargerAmt).toBe(0);
  });

  it('still prorates a discount correctly with a charger on the job', () => {
    const t = calcGenTotals({ ...base(), evCharger: true, evChargerTier: 'f16to25', discount: 10, discountType: '%' });
    expect(t.taxableBase + t.nonTaxableBase).toBe(t.subtotal);
    expect(t.taxedAmount).toBeCloseTo(t.taxableBase - (t.discountAmt * t.taxableBase) / t.subtotal, 6);
    expect(t.tax).toBe(Math.round(t.taxedAmount * 0.07));
  });
});

describe('genPriceRows — bundled EV charger', () => {
  const fmt = (n: number) => `$${n}`;

  it('names the tier on its own row when quoted', () => {
    const form = { ...blankGenForm(), evCharger: true, evChargerTier: 'f16to25' as const };
    const rows = genPriceRows(form, calcGenTotals(form), fmt);
    const row = rows.find(r => r.label.startsWith('Tesla Wall Connector'));
    expect(row?.label).toBe('Tesla Wall Connector Installation — 16 to 25 feet');
    expect(row?.amount).toBe('$1275');
  });

  it('omits the row when the charger is not part of the job', () => {
    const form = { ...blankGenForm(), evCharger: false };
    const rows = genPriceRows(form, calcGenTotals(form), fmt);
    expect(rows.some(r => r.label.includes('Wall Connector'))).toBe(false);
  });
});
