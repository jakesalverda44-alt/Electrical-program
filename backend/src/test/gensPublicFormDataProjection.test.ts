// Post-review fix B3 (Opus 5 adversarial review of fix/audit-batch1).
//
// Task 3's column-list fix for GET /api/gens/p/:token still shipped `form_data`
// whole: the JSONB blob carries fields genData.ts's own comment labels
// "Internal site-detail fields — not shown on the customer proposal, used for
// the award kickoff email to the ops team" (feedFt, genSide, panelRel,
// panelFt), plus the full price decomposition (labor, permit, startup,
// discount, discountType, taxRate) that ProposalPreview.tsx only ever renders
// via pre-computed `totals.*Amt` fields — so a rep's decision to hide the
// price-breakdown page (`includeBreakdown: false`) was cosmetic on an
// unauthenticated link; the raw numbers still rode along in the JSON.
//
// utils/publicFormData.ts projects the blob to exactly the keys
// ProposalPreview.tsx / EvProposalPreview.tsx read for rendering (see that
// file's own comment for the full trace, including the two genCalc helpers
// they call — loadCenterFor needs coolingType; activeCustomItems /
// customItemAmount need customItems and each item's own fields).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { dbAvailable, makeUser, auth } from './harness';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

const INTERNAL_SITE_DETAIL_KEYS = ['feedFt', 'genSide', 'panelRel', 'panelFt'];
const GEN_BREAKDOWN_KEYS = ['labor', 'permit', 'startup', 'discount', 'discountType', 'taxRate'];
const GEN_ALLOWED_BASE_KEYS = [
  'customer', 'attn', 'address', 'city', 'state', 'zip', 'phone', 'email',
  'brand', 'coolingType', 'size', 'atsSize', 'atsQty', 'fuel',
  'smmQty', 'surgeProQty', 'genStand', 'extWarranty',
  'extWarrantyPromoStart', 'extWarrantyPromoEnd', 'silverServicePromo',
  'evCharger', 'evChargerTier', 'customItems', 'notes', 'includeBreakdown',
  'jobType', 'validDays', 'depositPct', 'extraWire', 'liftType',
].sort();

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
    // Price-breakdown components — gated on includeBreakdown.
    labor: 3000, permit: 1250, startup: 695, discount: 100, discountType: '$', taxRate: 7,
    ...overrides,
  };
}

async function createGenWithForm(token: string, formData: Record<string, unknown>, productType?: string) {
  const res = await request(app).post('/api/gens').set(auth(token))
    .send({ customer: 'Jane Doe', product_type: productType, form_data: formData })
    .expect(200);
  return res.body as { id: string; proposal_token: string };
}

describe('Public proposal form_data projection (post-review B3)', () => {
  it('drops internal site-detail fields and breakdown components when includeBreakdown is false', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGenWithForm(u.token, fullGenFormData({ includeBreakdown: false }));
    const res = await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
    const formData = res.body.form_data;
    for (const key of INTERNAL_SITE_DETAIL_KEYS) expect(formData).not.toHaveProperty(key);
    for (const key of GEN_BREAKDOWN_KEYS) expect(formData).not.toHaveProperty(key);
    expect(Object.keys(formData).sort()).toEqual(GEN_ALLOWED_BASE_KEYS);
  });

  it('includes the breakdown components when includeBreakdown is true, still drops site-detail fields', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGenWithForm(u.token, fullGenFormData({ includeBreakdown: true }));
    const res = await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
    const formData = res.body.form_data;
    for (const key of INTERNAL_SITE_DETAIL_KEYS) expect(formData).not.toHaveProperty(key);
    for (const key of GEN_BREAKDOWN_KEYS) expect(formData).toHaveProperty(key);
    expect(Object.keys(formData).sort()).toEqual([...GEN_ALLOWED_BASE_KEYS, ...GEN_BREAKDOWN_KEYS].sort());
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

  it('projects EV-charger form_data with the EV key list', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGenWithForm(u.token, {
      customer: 'Ev Customer', attn: 'Ev Customer', address: '2 Elm St', city: 'Eustis', state: 'FL', zip: '32726',
      phone: '352-555-0199', email: 'ev@example.com',
      distanceTier: 'le5', tierPriceOverride: 500, panelUpgrade: false,
      customItems: [], notes: '', includeBreakdown: false,
      validDays: 30, depositPct: 0, discount: 0, discountType: '$', taxAmount: 50,
    }, 'ev_charger');
    const res = await request(app).get(`/api/gens/p/${gen.proposal_token}?preview=1`).expect(200);
    const formData = res.body.form_data;
    expect(formData).not.toHaveProperty('tierPriceOverride');
    expect(formData).not.toHaveProperty('discount');
    expect(formData).not.toHaveProperty('taxAmount');
    expect(formData.distanceTier).toBe('le5');
    expect(formData.panelUpgrade).toBe(false);
  });
});
