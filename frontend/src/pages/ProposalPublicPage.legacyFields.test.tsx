// @vitest-environment happy-dom
// Post-review fix R2 (Opus 5 re-review of fix/audit-batch1's B3 fix).
//
// backend/src/utils/publicFormData.ts's first version dropped the
// pre-unification legacy field names (ats/smm/surgePro/lcATS/additionalATS)
// from the public form_data entirely. migrateGenForm (genCalc.ts:45-74) exists
// specifically "so those scope-of-work lines still render correctly if a
// customer revisits an old link" — with the legacy names stripped before
// migration ever ran, an old proposal's ATS/SMM/SurgePro scope lines silently
// disappeared from a real customer's document. This renders the REAL
// ProposalPreview (unmocked) against a legacy-shaped form_data payload (no
// smmQty/surgeProQty/atsSize/atsQty — only smm/surgePro/ats, exactly what an
// old stored row looks like) and asserts those scope lines are present.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProposalPublicPage from './ProposalPublicPage';

// react-signature-canvas draws to a real <canvas>, which happy-dom does not
// implement (its 2D context is null) — ProposalPublicPage renders it
// unconditionally in the unsigned state (mirrors ProposalPublicPage.test.tsx).
vi.mock('react-signature-canvas', async () => {
  const React = await import('react');
  class FakeSignatureCanvas extends React.Component<Record<string, unknown>> {
    isEmpty() { return true; }
    clear() { /* no-op */ }
    toDataURL() { return 'data:image/png;base64,fake'; }
    render() { return React.createElement('div'); }
  }
  return { default: FakeSignatureCanvas };
});

vi.mock('../lib/signedContractPdf', () => ({
  buildContractPdf: vi.fn(),
  signedContractFilename: (c: string) => `Signed Proposal - ${c}.pdf`,
}));

function mockFetch(payload: Record<string, unknown>) {
  return vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response));
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/p/tok-1']}>
      <Routes><Route path="/p/:token" element={<ProposalPublicPage/>}/></Routes>
    </MemoryRouter>
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// Exactly what an old stored generator_proposals.form_data row looks like —
// and exactly what the public route now sends through unmodified (the
// whitelist passes both legacy and modern names through; this row never had
// the modern ones at all, matching a proposal saved before ATS unification).
const LEGACY_FORM_DATA = {
  customer: 'Legacy Customer', attn: 'Legacy Customer', address: '3 Oak St',
  city: 'Eustis', state: 'FL', zip: '32726', phone: '352-555-0177', email: 'legacy@example.com',
  brand: 'Kohler', coolingType: 'air-cooled', size: '20KW', genPriceOverride: null,
  fuel: 'Natural Gas', pad: true, battery: false, emPanel: false, gasLine: false, extraWire: 0,
  liftType: 'none', genStand: 'none', removal: false, extWarranty: 'none',
  extWarrantyPromoStart: '', extWarrantyPromoEnd: '', silverServicePromo: 'none',
  evCharger: false, evChargerTier: 'f6to15', evChargerPriceOverride: null,
  labor: 3000, permit: 1250, startup: 695, discount: 0, discountType: '$', taxRate: 7,
  customItems: [], notes: '', includeBreakdown: true, jobType: 'new-install', removalFee: 500,
  validDays: 30, depositPct: 50,
  // Legacy aliases only — no smmQty/surgeProQty/atsSize/atsQty at all.
  // migrateGenForm only derives atsQty when lcATS or additionalATS is present
  // (genCalc.ts:53-57) — an old stored row always had one of these two, since
  // they were the pre-unification "how many extra ATS" fields.
  smm: true, surgePro: true, ats: '200A', lcATS: 'none', additionalATS: 0,
};

describe('legacy field names still produce ATS/SMM/SurgePro scope lines after projection + migration (R2)', () => {
  it('renders the SMM, Surge Protector, and ATS scope lines from smm/surgePro/ats alone', async () => {
    vi.stubGlobal('fetch', mockFetch({
      customer: LEGACY_FORM_DATA.customer, product_type: 'generator',
      proposal_no: 'P-LEGACY-1', form_data: LEGACY_FORM_DATA, totals_data: null,
    }));
    renderPage();

    await waitFor(() => {
      expect(document.body.textContent).toContain(LEGACY_FORM_DATA.customer);
    });
    expect(document.body.textContent).toContain('Smart Management Module');
    expect(document.body.textContent).toContain('Whole-Home Surge Protector');
    expect(document.body.textContent).toContain('200A ATS');
  });
});
