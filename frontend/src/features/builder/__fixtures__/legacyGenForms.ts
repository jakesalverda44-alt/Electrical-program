// Fixed new-install / swap-out forms whose totals and rendered proposal must stay byte-identical
// as the Install Only type is added. Snapshots were captured BEFORE any Install Only change.
import { blankGenForm } from '../genCalc';
import type { GenForm } from '../genData';

export const LEGACY_FORMS: Record<string, GenForm> = {
  'new-blank': { ...blankGenForm(), customer: 'Jane Homeowner' },
  'new-lc-lift-ats-discount': {
    ...blankGenForm(), customer: 'Lc Customer', brand: 'Generac', coolingType: 'liquid-cooled', size: '48KW',
    atsQty: 3, atsSize: '400A', liftType: 'crane', extraWire: 40, smmQty: 2, surgeProQty: 1, emPanel: true,
    discount: 7.5, discountType: '%', extWarranty: 'paid', removal: true, includeBreakdown: true,
  },
  'new-12kw-loadcenter-promo': {
    ...blankGenForm(), customer: 'Lc Unit', size: '12KW', genStand: 'big', pad: false, extWarranty: 'promo',
    extWarrantyPromoStart: '2026-01-01', extWarrantyPromoEnd: '2026-12-31', silverServicePromo: '2yr',
    evCharger: true, customItems: [
      { id: 'a', desc: 'Relocate hose bib', amount: 350, taxable: false },
      { id: 'b', desc: 'Trim kit', amount: 120, taxable: true },
    ], notes: 'Gate code 1234', includeBreakdown: true,
  },
  'swap-basic': { ...blankGenForm(), customer: 'Swap Customer', jobType: 'swap-out', pad: false, labor: 1500, permit: 475 },
  'swap-gas-breakdown': {
    ...blankGenForm(), customer: 'Swap Gas', jobType: 'swap-out', pad: false, labor: 1500, permit: 475,
    gasLine: true, removalFee: 650, discount: 100, discountType: '$', includeBreakdown: true,
  },
};
