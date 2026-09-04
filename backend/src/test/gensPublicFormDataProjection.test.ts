// Post-review fixes B3 / R1 / R2 / R3 (Opus 5 adversarial review + re-review of
// fix/audit-batch1).
//
// The first version of this projection gated the price-breakdown fields on
// `includeBreakdown` and dropped the pre-unification legacy field names
// entirely. That broke ProposalPublicPage.tsx's totals_data-missing fallback
// (calcGenTotals/calcEvTotals need several of the dropped fields — a wrong
// total/deposit on a signable page) and migrateGenForm's legacy-alias
// translation (smm/surgePro/ats/lcATS/additionalATS). See
// utils/publicFormData.ts's own comment for the full derivation (three
// sources: the preview components' own reads, the real grep output against
// genCalc.ts/evCalc.ts, and the five legacy aliases) and why the breakdown
// gate was removed entirely (totals_data already ships the same figures
// ungated, so hiding the breakdown page was never a confidentiality boundary).
//
// These tests check the ACTUAL behavioral requirement — every field the calc
// functions and migration need survives projection, unconditionally — rather
// than a hand-maintained key-set snapshot that would silently rot the next
// time genCalc.ts/evCalc.ts grow a new input (see frontend/src/pages/
// ProposalPublicPage.*.test.tsx for the end-to-end "the rendered total is
// unaffected by projection" tests this backend suite can't run itself, since
// backend can't import frontend calc code — cross-package import breaks
// `tsc --noEmit`'s rootDir check, confirmed directly while writing this fix).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const INTERNAL_SITE_DETAIL_KEYS = ['feedFt', 'genSide', 'panelRel', 'panelFt'];
// calcGenTotals inputs (genCalc.ts g.* grep) that a naive "hide the breakdown"
// gate would have dropped — must now always survive, regardless of
// includeBreakdown, because totals_data already carries the same dollar
// figures ungated on the same route (post-review R3).
const GEN_CALC_ONLY_KEYS = [
  'battery', 'discount', 'discountType', 'emPanel', 'evChargerPriceOverride',
  'gasLine', 'labor', 'pad', 'permit', 'removal', 'removalFee', 'startup',
  'genPriceOverride', 'taxRate',
];
const GEN_LEGACY_ALIAS_KEYS = ['smm', 'surgePro', 'ats', 'lcATS', 'additionalATS'];

function fullGenFormData(overrides: Record<string, unknown> = {}) {
  return {
    customer: 'Jane Doe', attn: 'Jane Doe', address: '1 Main St', city: 'Eustis', state: 'FL', zip: '32726',
    phone: '352-555-0100', email: 'jane@example.com',
    brand: 'Kohler', coolingType: 'air-cooled', size: '20KW', atsSize: '200A', atsQty: 1, fuel: 'Natural Gas',
    smmQty: 0, surgeProQty: 0, genStand: 'none', extWarranty: 'none',
    extWarrantyPromoStart: '', extWarrantyPromoEnd: '', silverServicePromo: 'none',
    evCharger: false, evChargerTier: 'le5',
    customItems: [{ id: 'x1', desc: 'Extra outlet', amount: 200, taxable: true, secretCostBasis: 999 }],
    notes: 'none', jobType: 'new-install', validDays: 30, depositPct: 50, extraWire: 0, liftType: 'none',
    // Internal site-detail fields — must never leave the server.
    feedFt: 42, genSide: 'Left', panelRel: 'Same side as panel', panelFt: 12,
    // calcGenTotals inputs — must always survive (not gated on includeBreakdown).
    battery: true, discount: 100, discountType: '$', emPanel: true, evChargerPriceOverride: null,
    gasLine: true, labor: 3000, pad: true, permit: 1250, removal: true, removalFee: 500,
    startup: 695, genPriceOverride: null, taxRate: 7,
    ...overrides,
  };
}

async function createGenWithForm(token: string, formData: Record<string, unknown>, productType?: string) {
  const res = await request(app).post('/api/gens').set(auth(token))
    .send({ customer: 'Jane Doe', product_type: productType, form_data: formData })
    .expect(200);
  return res.body as { id: string; proposal_token: string };
}

describe('Public proposal form_data projection (post-review B3/R1/R2/R3)', () => {
  it('drops the internal site-detail fields regardless of includeBreakdown', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    for (const includeBreakdown of [false, true]) {
      const gen = await createGenWithForm(u.token, fullGenFormData({ includeBreakdown }));
      const res = await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
      for (const key of INTERNAL_SITE_DETAIL_KEYS) expect(res.body.form_data).not.toHaveProperty(key);
    }
  });

  it('always keeps the calcGenTotals-input fields, even when includeBreakdown is false', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGenWithForm(u.token, fullGenFormData({ includeBreakdown: false }));
    const res = await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
    const formData = res.body.form_data;
    for (const key of GEN_CALC_ONLY_KEYS) {
      expect(formData).toHaveProperty(key);
    }
    // Spot-check actual values survive untouched, not just key presence.
    expect(formData.labor).toBe(3000);
    expect(formData.discount).toBe(100);
    expect(formData.pad).toBe(true);
  });

  it('passes through the pre-unification legacy field names when present', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const legacyForm = fullGenFormData({
      smmQty: undefined, surgeProQty: undefined, atsSize: undefined, atsQty: undefined,
      smm: true, surgePro: true, ats: '200A', lcATS: 'none', additionalATS: 0,
    });
    const gen = await createGenWithForm(u.token, legacyForm);
    const res = await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
    for (const key of GEN_LEGACY_ALIAS_KEYS) {
      expect(res.body.form_data).toHaveProperty(key);
    }
    expect(res.body.form_data.smm).toBe(true);
    expect(res.body.form_data.surgePro).toBe(true);
    expect(res.body.form_data.ats).toBe('200A');
  });

  it('strips unexpected fields from custom line items', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGenWithForm(u.token, fullGenFormData({ includeBreakdown: false }));
    const res = await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
    const item = res.body.form_data.customItems[0];
    expect(Object.keys(item).sort()).toEqual(['amount', 'desc', 'id', 'taxable']);
    expect(item).not.toHaveProperty('secretCostBasis');
  });

  it('projects EV-charger form_data, keeping every calcEvTotals input (nothing gated)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGenWithForm(u.token, {
      customer: 'Ev Customer', attn: 'Ev Customer', address: '2 Elm St', city: 'Eustis', state: 'FL', zip: '32726',
      phone: '352-555-0199', email: 'ev@example.com',
      distanceTier: 'le5', tierPriceOverride: 500, panelUpgrade: false,
      customItems: [], notes: '', includeBreakdown: false,
      validDays: 30, depositPct: 0, discount: 25, discountType: '$', taxAmount: 50,
    }, 'ev_charger');
    const res = await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
    const formData = res.body.form_data;
    expect(formData.tierPriceOverride).toBe(500);
    expect(formData.discount).toBe(25);
    expect(formData.discountType).toBe('$');
    expect(formData.taxAmount).toBe(50);
    expect(formData.distanceTier).toBe('le5');
    expect(formData.panelUpgrade).toBe(false);
  });
});
