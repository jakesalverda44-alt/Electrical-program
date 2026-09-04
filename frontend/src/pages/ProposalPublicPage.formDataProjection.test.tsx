// @vitest-environment happy-dom
// Post-review fixes R1 / R2 (Opus 5 re-review of fix/audit-batch1's B3 fix).
//
// backend/src/utils/publicFormData.ts's first version gated the price-breakdown
// fields on `includeBreakdown` and dropped the pre-unification legacy field
// names entirely. ProposalPublicPage.tsx:177-178 falls back to
// `calcGenTotals(form)` (":166-168" for EV, `calcEvTotals`) whenever a proposal
// has no `totals_data` snapshot — true for a real fraction of live proposals —
// and those functions read several of the fields the old whitelist dropped, so
// a customer on that fallback path would see a WRONG total and deposit on a
// page they can sign. These tests can't import the backend's publicFormData.ts
// (cross-package import breaks each side's own `tsc --noEmit` rootDir check —
// confirmed directly while writing this fix), so they hand-construct the exact
// projection the backend now performs — dropping ONLY genData.ts's declared
// internal site-detail fields (feedFt/genSide/panelRel/panelFt) — and assert
// the page computes the identical total/deposit it would from the original,
// unprojected form.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProposalPublicPage from './ProposalPublicPage';
import { GenForm } from '../features/builder/genData';
import { blankGenForm, calcGenTotals } from '../features/builder/genCalc';
import { EvForm } from '../features/builder/evData';
import { blankEvForm, calcEvTotals } from '../features/builder/evCalc';

// react-signature-canvas draws to a real <canvas>, which happy-dom does not
// implement (its 2D context is null) — ProposalPublicPage renders it
// unconditionally in the unsigned state, so every test here needs this stand-in
// regardless of whether it exercises signing (mirrors ProposalPublicPage.test.tsx).
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

// Capture whatever `totals` the preview components are given instead of
// rendering the full multi-page document (slow, and irrelevant to this
// regression — it's about the INPUT to calcGenTotals/calcEvTotals, not layout).
vi.mock('../features/builder/ProposalPreview', () => ({
  default: (props: Record<string, unknown>) => {
    const t = props.totals as { total: number; deposit: number };
    return <div data-testid="doc-gen" data-total={String(t.total)} data-deposit={String(t.deposit)}/>;
  },
}));
vi.mock('../features/builder/EvProposalPreview', () => ({
  default: (props: Record<string, unknown>) => {
    const t = props.totals as { total: number; deposit: number };
    return <div data-testid="doc-ev" data-total={String(t.total)} data-deposit={String(t.deposit)}/>;
  },
}));
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

// Mirrors backend/src/utils/publicFormData.ts's GEN_FORM_KEYS exclusion exactly:
// the ONLY fields dropped are genData.ts's own declared internal set (its exact
// comment: "Internal site-detail fields — not shown on the customer proposal,
// used for the award kickoff email to the ops team."). Everything else —
// including every calcGenTotals input and the legacy aliases — passes through.
function projectGenForm(form: GenForm): Partial<GenForm> {
  const { feedFt: _feedFt, genSide: _genSide, panelRel: _panelRel, panelFt: _panelFt, ...rest } = form;
  return rest;
}
function projectEvForm(form: EvForm): Partial<EvForm> {
  // EvForm has no field carrying genData.ts's "internal" comment — nothing is
  // excluded for EV at all (confirmed in publicFormData.ts's own EV_FORM_KEYS,
  // which lists all 19 EvForm fields).
  return { ...form };
}

describe('form_data projection preserves the totals_data-missing fallback total (R1)', () => {
  it('generator: renders the same total/deposit from a projected form + null totals_data as the unprojected original', async (ctx) => {
    void ctx;
    const original: GenForm = {
      ...blankGenForm(),
      pad: true, battery: true, emPanel: true, gasLine: true, removal: false,
      jobType: 'swap-out', removalFee: 600, extraWire: 10, liftType: 'crane',
      atsQty: 2, smmQty: 1, surgeProQty: 1, extWarranty: 'paid',
      discount: 150, discountType: '$', taxRate: 7,
      evCharger: true, evChargerTier: 'f6to15', evChargerPriceOverride: 900,
      customItems: [{ id: 'c1', desc: 'Extra outlet', amount: 150, taxable: true }],
    };
    const expected = calcGenTotals(original);
    const projected = projectGenForm(original);

    vi.stubGlobal('fetch', mockFetch({
      customer: original.customer || 'Jane Doe', product_type: 'generator',
      proposal_no: 'P-1', form_data: projected, totals_data: null,
    }));
    renderPage();

    const doc = await screen.findByTestId('doc-gen');
    await waitFor(() => expect(doc.getAttribute('data-total')).toBe(String(expected.total)));
    expect(doc.getAttribute('data-deposit')).toBe(String(expected.deposit));
  });

  it('EV charger: renders the same total/deposit from a projected form + null totals_data as the unprojected original', async (ctx) => {
    void ctx;
    const original: EvForm = {
      ...blankEvForm(),
      distanceTier: 'f16to25', tierPriceOverride: 1400, panelUpgrade: true,
      discount: 75, discountType: '$', taxAmount: 60, depositPct: 25,
      customItems: [{ id: 'c1', desc: 'Extra conduit run', amount: 80, taxable: true }],
    };
    const expected = calcEvTotals(original);
    const projected = projectEvForm(original);

    vi.stubGlobal('fetch', mockFetch({
      customer: original.customer || 'Ev Customer', product_type: 'ev_charger',
      proposal_no: 'P-EV-1', form_data: projected, totals_data: null,
    }));
    renderPage();

    const doc = await screen.findByTestId('doc-ev');
    await waitFor(() => expect(doc.getAttribute('data-total')).toBe(String(expected.total)));
    expect(doc.getAttribute('data-deposit')).toBe(String(expected.deposit));
  });
});
