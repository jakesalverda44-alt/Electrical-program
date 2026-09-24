// @vitest-environment happy-dom
// Phase 3 Task 7 — the Proposal tab renders the composed BidData (Task 6's
// GET /proposal-preview) instead of the pre-Phase-3 ad-hoc propData/sow
// parsing, surfaces the verify-gate's 422 failures without failing silently,
// and wires the new Download Takeoff (.xlsx) / Generate Pre-Bid Package
// buttons to their Task 6 endpoints.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace } from './constants';
import { Bid } from '../../types';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const bid: Bid = {
  id: 'b1', name: 'Circle K #4521', loc: '1234 Main St', gc: 'ABC Construction', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
};

const AI_RESULTS_COMPLETE = {
  agent2_output: '{"scopeOfWork":{}}',
  agent4_status: 'complete',
  agent4_output: JSON.stringify({ sections: [], takeoff: [] }), // shape irrelevant — preview comes from /proposal-preview
};

const PREVIEW = {
  project_name: 'Circle K #4521',
  project_address: '1234 Main St, Eustis, FL',
  client: 'ABC Construction',
  contact: 'John Smith',
  job_number: 'JS.09022026',
  total_price: '$248,750',
  scope: ['Bullet 1', 'Bullet 2', 'Bullet 3', 'Bullet 4', 'Bullet 5', 'Bullet 6'],
  sections: [
    { title: 'A. Service & Distribution', bullets: ['Service entrance assembly and MDP (ECFECI).'] },
    { title: 'C. Lighting & Controls', bullets: [{ b: 'Complete lighting package (ECFECI) ', t: '— Southern Lighting Source.' }] },
  ],
  exclusions: ['Painting and patching are excluded.'],
  takeoff: [{ name: 'Service & Distribution', items: [{ item: '1.1', description: 'Panel', unit: 'EA', qty: 1, source: 'E1.0' }] }],
  terms: Array.from({ length: 10 }, (_, i) => `Term ${i + 1}`),
  alternates: ['VE Option 1 - Aluminum feeders: DEDUCT $6,400.00.'],
};

function baseMocks() {
  get.mockImplementation((url: string) => {
    if (url === `/preconstruction/${bid.id}/results`) return Promise.resolve({ data: AI_RESULTS_COMPLETE });
    if (url === `/preconstruction/${bid.id}/proposal-preview`) return Promise.resolve({ data: PREVIEW });
    if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
    if (url === `/preconstruction/${bid.id}/takeoff`) return Promise.resolve({ data: null });
    if (url === `/preconstruction/intelligence/${bid.id}`) return Promise.resolve({ data: null });
    if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
    if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: null });
    if (url === '/documents') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
}

function renderProposalTab() {
  const ws = { ...blankWorkspace('b1', 'Circle K #4521', 0), activeTab: 'proposal' as const };
  return render(
    <PcWorkspaceView
      ws={ws}
      bid={bid}
      onUpdate={() => {}}
      onBack={() => {}}
      onConverted={() => {}}
      onBidUpdated={() => {}}
      showToast={() => {}}
      embedded
    />,
  );
}

describe('PcWorkspace Proposal tab — preview (Task 7.1/7.5)', () => {
  it('renders sections by their real titles, exclusions, alternates, and terms from the composed BidData', async () => {
    baseMocks();
    renderProposalTab();

    await waitFor(() => expect(screen.getByText('Proposal Preview')).toBeTruthy());
    expect(screen.getByText('A. Service & Distribution')).toBeTruthy();
    expect(screen.getByText('C. Lighting & Controls')).toBeTruthy();
    expect(screen.getByText('Service entrance assembly and MDP (ECFECI).')).toBeTruthy();
    // {b,t} mixed-bold bullet: the lead is bold, the rest follows on the same line (Task 13)
    const lead = screen.getByText('Complete lighting package (ECFECI)');
    expect(lead.tagName).toBe('B');
    expect(lead.parentElement!.textContent).toBe('Complete lighting package (ECFECI) — Southern Lighting Source.');
    expect(screen.getByText('Painting and patching are excluded.')).toBeTruthy();
    expect(screen.getByText('VE Option 1 - Aluminum feeders: DEDUCT $6,400.00.')).toBeTruthy();
    expect(screen.getByText('Term 1')).toBeTruthy();
    expect(screen.getByText('Term 10')).toBeTruthy();
    expect(screen.getByText('Job No:  JS.09022026', { normalizer: t => t })).toBeTruthy();
    expect(screen.getByTestId('pp-price').textContent).toBe('Total Electrical Scope — $248,750');
  });

  it('Task 13 — a white Cowork-style page: backend header lines, intro, numbered borderless takeoff, price in words; corrections and hygiene warnings above it', async () => {
    baseMocks();
    const withPaper = {
      ...PREVIEW,
      takeoff: [
        { name: 'Service & Distribution', items: [{ item: 'Panel', description: '200A panel "A"', unit: 'EA', qty: 1, source: 'E1.0' }, { item: 'Disconnect', description: '60A NF', unit: 'EA', qty: 2, source: 'E2.0' }] },
        { name: 'Interior Lighting', items: [{ item: 'Type A', description: '2x4 LED troffer', unit: 'EA', qty: 24, source: 'E3.0' }] },
      ],
      accountCorrections: ['Disconnects set to APT furnishes and installs (account rule "AutoZone").'],
      hygieneWarnings: ['Owner-spec text for another region: "Puerto Rico stores only".'],
      paper: {
        headerLines: [{ text: 'September 23, 2026' }, { text: 'ABC Construction', bold: true }, { text: 'Attn:  John Smith' }, { text: 'Re:  Circle K #4521' }],
        introLine: 'Please accept this proposal to complete the electrical work for CIRCLE K #4521 you have out for bid.',
        priceLine: 'Total Electrical Scope — Two Hundred Forty-Eight Thousand Seven Hundred Fifty and 00/100 Dollars   $248,750.00',
        takeoffDescriptions: [['Panel — 200A panel "A"', 'Disconnect — 60A NF'], ['Type A — 2x4 LED troffer']],
      },
    };
    get.mockImplementation((url: string) => url === `/preconstruction/${bid.id}/proposal-preview`
      ? Promise.resolve({ data: withPaper })
      : url === `/preconstruction/${bid.id}/results` ? Promise.resolve({ data: AI_RESULTS_COMPLETE }) : Promise.resolve({ data: null }));
    renderProposalTab();
    const page = await screen.findByTestId('proposal-paper');
    expect(page.className).toBe('pp-sheet');
    const p = within(page);
    expect(p.getByText('ABC Construction').className).toBe('pp-bold');
    expect(p.getByText(/^Please accept this proposal/)).toBeTruthy();
    const bands = Array.from(page.querySelectorAll('.pp-band')).map(b => b.textContent);
    expect(bands).toEqual(['SCOPE OF WORK', 'A. Service & Distribution', 'C. Lighting & Controls', 'EXCLUSIONS & CLARIFICATIONS', 'ELECTRICAL QUANTITY TAKEOFF', 'TERMS, CONDITIONS & SPECIAL REQUIREMENTS']);
    const rows = Array.from(page.querySelectorAll('.pp-table tbody tr')).map(r => Array.from(r.querySelectorAll('td')).map(td => td.textContent));
    expect(rows).toEqual([
      ['Service & Distribution'],
      ['1', 'Panel — 200A panel "A"', 'EA', '1', 'E1.0'],
      ['2', 'Disconnect — 60A NF', 'EA', '2', 'E2.0'],
      ['Interior Lighting'],
      ['1', 'Type A — 2x4 LED troffer', 'EA', '24', 'E3.0'],
    ]);
    expect(Array.from(page.querySelectorAll('.pp-table th')).map(t => t.textContent)).toEqual(['ITEM', 'DESCRIPTION', 'UNIT', 'QTY', 'SOURCE / NOTES']);
    expect(screen.getByTestId('pp-price').textContent).toBe(withPaper.paper.priceLine);
    expect(within(screen.getByTestId('pp-corrections')).getByText(withPaper.accountCorrections[0])).toBeTruthy();
    expect(within(screen.getByTestId('pp-hygiene')).getByText(withPaper.hygieneWarnings[0])).toBeTruthy();
  });

  it('the download button is present and never silently fails on success', async () => {
    baseMocks();
    renderProposalTab();
    await waitFor(() => expect(screen.getByText('Proposal Preview')).toBeTruthy());
    expect(screen.getByText('Download .docx')).toBeTruthy();
    expect(screen.getByText('Download Takeoff (.xlsx)')).toBeTruthy();
  });
});

describe('PcWorkspace Proposal tab — verify-gate 422 panel (Task 7.2)', () => {
  it('lists each failure (check + matched text) when generate-docx 422s', async () => {
    baseMocks();
    const failureBody = {
      error: 'This proposal did not pass the bid-standard verification gate.',
      failures: [
        { check: 'banned_language', detail: 'Estimator/internal language found — strip before sending to the GC.', matches: ['RFI'] },
        { check: 'placeholders', detail: 'Unfilled bracketed placeholders found — fill them before sending.', matches: ['[JOB NUMBER]'] },
      ],
    };
    const blob = new Blob([JSON.stringify(failureBody)], { type: 'application/json' });
    get.mockImplementation((url: string, opts?: { responseType?: string }) => {
      if (url === `/preconstruction/${bid.id}/generate-docx` && opts?.responseType === 'blob') {
        return Promise.reject({ response: { data: blob } });
      }
      if (url === `/preconstruction/${bid.id}/results`) return Promise.resolve({ data: AI_RESULTS_COMPLETE });
      if (url === `/preconstruction/${bid.id}/proposal-preview`) return Promise.resolve({ data: PREVIEW });
      if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
      if (url === `/preconstruction/${bid.id}/takeoff`) return Promise.resolve({ data: null });
      if (url === `/preconstruction/intelligence/${bid.id}`) return Promise.resolve({ data: null });
      if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
      if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: null });
      if (url === '/documents') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });

    renderProposalTab();
    await waitFor(() => expect(screen.getByText('Proposal Preview')).toBeTruthy());

    fireEvent.click(screen.getByText('Download .docx'));

    await waitFor(() => expect(screen.getByText('Proposal Did Not Pass Verification')).toBeTruthy());
    expect(screen.getByText('banned language')).toBeTruthy();
    expect(screen.getByText('placeholders')).toBeTruthy();
    expect(screen.getByText('RFI')).toBeTruthy();
    expect(screen.getByText('[JOB NUMBER]')).toBeTruthy();
    expect(screen.getAllByText(/Re-run Agent 4/).length).toBeGreaterThan(0);
  });

  // Fix round B5 — the evidence gate's 409 names the offending Labor &
  // Pricing line by its line_key; Download .docx should jump straight to
  // it (switch to the pricing step, scroll to and focus its reason field)
  // instead of leaving the estimator to go hunting from a toast alone.
  it('jumps to Labor & Pricing and focuses the named line\'s reason field when the evidence gate 409s', async () => {
    baseMocks();
    const evidenceBody = {
      error: 'The takeoff needs review before a proposal can be generated or sent: 1 item open (Manual line missing its evidence/reason: Owner-furnished panel).',
      reviewItems: [{ id: 'evidence:line:lk-owner-panel', kind: 'confirm', title: 'Manual line missing its evidence/reason: Owner-furnished panel', detail: 'd', lineKey: 'lk-owner-panel' }],
    };
    const blob = new Blob([JSON.stringify(evidenceBody)], { type: 'application/json' });
    get.mockImplementation((url: string, opts?: { responseType?: string }) => {
      if (url === `/preconstruction/${bid.id}/generate-docx` && opts?.responseType === 'blob') {
        return Promise.reject({ response: { data: blob } });
      }
      if (url === `/preconstruction/${bid.id}/results`) return Promise.resolve({ data: AI_RESULTS_COMPLETE });
      if (url === `/preconstruction/${bid.id}/proposal-preview`) return Promise.resolve({ data: PREVIEW });
      if (url === `/estimating/${bid.id}`) {
        return Promise.resolve({
          data: {
            lines: [{ id: 'l1', line_key: 'lk-owner-panel', category: 'Service & Distribution', description: 'Owner-furnished panel', qty: 1, unit: 'EA', source: 'manual' }],
            settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: 0 },
            recap: { lines: [], categories: [], totals: { materialTotal: 0, laborHours: 0, laborCost: 0, materialTax: 0, consumables: 0, smallTools: 0, supervision: 0, overhead: 0, profit: 0, directCost: 0, grandTotal: 0 }, warnings: { unresolvedCount: 0, fuzzyMatchCount: 0 } },
            proposed: false, savedGrandTotal: null,
          },
        });
      }
      if (url === '/estimating/library') return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
      if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
      if (url === `/preconstruction/${bid.id}/takeoff`) return Promise.resolve({ data: null });
      if (url === `/preconstruction/intelligence/${bid.id}`) return Promise.resolve({ data: null });
      if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
      if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: null });
      if (url === '/documents') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });

    renderProposalTab();
    await waitFor(() => expect(screen.getByText('Proposal Preview')).toBeTruthy());
    fireEvent.click(screen.getByText('Download .docx'));

    await waitFor(() => expect(screen.getByLabelText('Evidence / reason for Owner-furnished panel')).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Evidence / reason for Owner-furnished panel')));
  });
});

// Takeoff accuracy Task 12 — the pre-bid package moved from Review & Proposal
// to the END of the Takeoff step (it builds from the pre-bid draft, before
// any price); these tests now open the Takeoff step.
function renderTakeoffStep() {
  const ws = { ...blankWorkspace('b1', 'Circle K #4521', 0), activeTab: 'takeoff' as const };
  return render(
    <PcWorkspaceView ws={ws} bid={bid} onUpdate={() => {}} onBack={() => {}} onConverted={() => {}} onBidUpdated={() => {}} showToast={() => {}} embedded />,
  );
}

describe('PcWorkspace Takeoff step — pre-bid package (Task 7.3, moved by takeoff accuracy Task 12)', () => {
  it('is no longer in Review & Proposal', async () => {
    baseMocks();
    renderProposalTab();
    await waitFor(() => expect(screen.getByText('Proposal Preview')).toBeTruthy());
    expect(screen.queryByText('Generate Pre-Bid Package for Chris')).toBeNull();
  });

  it('the Generate Pre-Bid Package button posts to generate-prebid-package and renders download links', async () => {
    baseMocks();
    post.mockImplementation((url: string) => {
      if (url === `/preconstruction/${bid.id}/generate-prebid-package`) {
        return Promise.resolve({ data: { scopeDocumentId: 'doc-scope-1', takeoffDocumentId: 'doc-takeoff-1' } });
      }
      return Promise.resolve({ data: {} });
    });

    renderTakeoffStep();
    await waitFor(() => expect(screen.getByText('Generate Pre-Bid Package for Chris')).toBeTruthy());

    fireEvent.click(screen.getByText('Generate Pre-Bid Package for Chris'));

    await waitFor(() => expect(post).toHaveBeenCalledWith(`/preconstruction/${bid.id}/generate-prebid-package`));
    await waitFor(() => expect(screen.getByText('Download Pre-Bid Scope')).toBeTruthy());
    expect(screen.getByText('Download Pre-Bid Takeoff')).toBeTruthy();
  });

  it('is labeled as an internal-only, no-price action', async () => {
    baseMocks();
    renderTakeoffStep();
    await waitFor(() => expect(screen.getByText('Pre-Bid Package for Chris')).toBeTruthy());
    expect(within(screen.getByText('Pre-Bid Package for Chris').closest('span') as HTMLElement).getByText('Internal only · no price')).toBeTruthy();
  });
});

describe('PcWorkspace Proposal tab — fix round 2 / S3: propPrice and Agent 4 read the engine\'s latest saved total', () => {
  const EMPTY_TOTALS = {
    materialSubtotal: 0, consumables: 0, materialTax: 0, laborHours: 0, laborCost: 0,
    smallTools: 0, directCost: 0, overhead: 0, profit: 0, sellPerSf: null, crewWeeks: 0,
  };
  const EMPTY_WARNINGS = { unmatchedCount: 0, verifyCount: 0, zeroMaterialMatchedCount: 0, excludedCount: 0, unverifiedMaterialShare: 0, unitUnknownCount: 0 };
  const ESTIMATING_SETTINGS = {
    labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3,
    supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: 0,
  };
  const ESTIMATING_LINE = { id: 'l1', category: 'Branch Power', description: 'Duplex', qty: 10, unit: 'EA' as const, source: 'manual' as const };

  function mocksWithEngineTotal(grandTotal: number) {
    get.mockImplementation((url: string) => {
      if (url === `/preconstruction/${bid.id}/results`) return Promise.resolve({ data: AI_RESULTS_COMPLETE });
      if (url === `/preconstruction/${bid.id}/proposal-preview`) return Promise.resolve({ data: PREVIEW });
      if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
      if (url === `/preconstruction/${bid.id}/takeoff`) return Promise.resolve({ data: null });
      if (url === `/preconstruction/intelligence/${bid.id}`) return Promise.resolve({ data: null });
      if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
      if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: null });
      if (url === '/documents') return Promise.resolve({ data: [] });
      // The new engine — a SAVED (not proposed) bid whose recap's grandTotal
      // is what propPrice and Agent 4 must read.
      if (url === `/estimating/${bid.id}`) return Promise.resolve({
        data: {
          lines: [ESTIMATING_LINE], settings: ESTIMATING_SETTINGS,
          recap: { lines: [], categories: [], totals: { ...EMPTY_TOTALS, grandTotal }, warnings: EMPTY_WARNINGS },
          proposed: false, savedGrandTotal: grandTotal,
        },
      });
      return Promise.resolve({ data: null });
    });
    post.mockResolvedValue({ data: {} });
    put.mockResolvedValue({ data: {} });
    del.mockResolvedValue({ data: {} });
  }

  it('propPrice equals the engine\'s saved grand total, in cents, not rounded to a whole dollar (N4)', async () => {
    mocksWithEngineTotal(12345.67);
    renderProposalTab();
    await waitFor(() => expect(screen.getByText('Proposal Preview')).toBeTruthy());
    const priceInput = await screen.findByPlaceholderText('e.g. 285000') as HTMLInputElement;
    await waitFor(() => expect(priceInput.value).toBe('12345.67'));
  });

  it('Agent 4 receives exactly that total as `price` when Run Agent 4 is clicked', async () => {
    mocksWithEngineTotal(12345.67);
    renderProposalTab();
    await waitFor(() => expect(screen.getByText('Proposal Preview')).toBeTruthy());
    const priceInput = await screen.findByPlaceholderText('e.g. 285000') as HTMLInputElement;
    await waitFor(() => expect(priceInput.value).toBe('12345.67'));

    fireEvent.click(screen.getByText(/Re-run Agent 4|Run Agent 4/));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      `/preconstruction/${bid.id}/run-agent4`,
      expect.objectContaining({ price: '12345.67' }),
    ));
  });

  it('shows a mismatch warning with a "Use engine total" action once the estimator hand-types a different price', async () => {
    mocksWithEngineTotal(12345.67);
    renderProposalTab();
    await waitFor(() => expect(screen.getByText('Proposal Preview')).toBeTruthy());
    const priceInput = await screen.findByPlaceholderText('e.g. 285000') as HTMLInputElement;
    await waitFor(() => expect(priceInput.value).toBe('12345.67'));

    fireEvent.change(priceInput, { target: { value: '99999' } });
    expect(await screen.findByTestId('propprice-mismatch-warning')).toBeTruthy();

    fireEvent.click(screen.getByTestId('propprice-use-engine-total'));
    await waitFor(() => expect(priceInput.value).toBe('12345.67'));
    expect(screen.queryByTestId('propprice-mismatch-warning')).toBeNull();
  });
});

describe('Fix round 2 / N-R2-6 — the legacy note shows in Review & Proposal too', () => {
  it('a bid analysed before the accuracy checks (no review status, no run id)', async () => {
    baseMocks();
    get.mockImplementation((url: string) => url === `/preconstruction/${bid.id}/results`
      ? Promise.resolve({ data: { ...AI_RESULTS_COMPLETE, agent1_output: '{}', review_status: null, run_id: null } })
      : url === `/preconstruction/${bid.id}/proposal-preview` ? Promise.resolve({ data: PREVIEW }) : Promise.resolve({ data: null }));
    renderProposalTab();
    await waitFor(() => expect(screen.getByTestId('proposal-legacy-note').textContent).toContain('Analyzed before accuracy checks'));
  });
});

// Coordinator gap 2 (re-review) — the evidence gate is not special to
// generate-docx: the backend already applies it to generate-takeoff-xlsx,
// draft-proposal (send) and run-agent4 too (routes/preconstruction.ts,
// routes/bids.ts — all four call evidenceGate(); only generate-prebid-
// package for Chris is exempt). Each of those four paths' frontend error
// handler must jump to the offending Labor & Pricing line the same way
// Download .docx's already does.
describe('Fix round B5/gap 2 — every GC-facing output jumps to the evidence-gate line, not just Download .docx', () => {
  const EVIDENCE_BODY = {
    error: 'The takeoff needs review before a proposal can be generated or sent: 1 item open.',
    reviewItems: [{ id: 'evidence:line:lk-owner-panel', kind: 'confirm', title: 'Manual line missing its evidence/reason: Owner-furnished panel', detail: 'd', lineKey: 'lk-owner-panel' }],
  };
  function mocksWithEstimatingLine() {
    get.mockImplementation((url: string, opts?: { responseType?: string }) => {
      if (url === `/preconstruction/${bid.id}/generate-takeoff-xlsx` && opts?.responseType === 'blob') {
        return Promise.reject({ response: { data: new Blob([JSON.stringify(EVIDENCE_BODY)], { type: 'application/json' }) } });
      }
      if (url === `/preconstruction/${bid.id}/results`) return Promise.resolve({ data: AI_RESULTS_COMPLETE });
      if (url === `/preconstruction/${bid.id}/proposal-preview`) return Promise.resolve({ data: PREVIEW });
      if (url === `/estimating/${bid.id}`) {
        return Promise.resolve({
          data: {
            lines: [{ id: 'l1', line_key: 'lk-owner-panel', category: 'Service & Distribution', description: 'Owner-furnished panel', qty: 1, unit: 'EA', source: 'manual' }],
            settings: { labor_rate: 40, factor_ids: [], material_tax_pct: 7, small_tools_pct: 3, supervision_pct: 0, consumables_pct: 2, overhead_pct: 10, profit_pct: 15, crew_size: 3, floors_above_2: 0 },
            recap: { lines: [], categories: [], totals: { materialTotal: 0, laborHours: 0, laborCost: 0, materialTax: 0, consumables: 0, smallTools: 0, supervision: 0, overhead: 0, profit: 0, directCost: 0, grandTotal: 0 }, warnings: { unresolvedCount: 0, fuzzyMatchCount: 0 } },
            proposed: false, savedGrandTotal: null,
          },
        });
      }
      if (url === '/estimating/library') return Promise.resolve({ data: { items: [], assemblies: [], factors: [] } });
      if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
      if (url === `/preconstruction/${bid.id}/takeoff`) return Promise.resolve({ data: null });
      if (url === `/preconstruction/intelligence/${bid.id}`) return Promise.resolve({ data: null });
      if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
      if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: null });
      if (url === '/documents') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: null });
    });
  }

  it('Download Takeoff (.xlsx): jumps to the named line on a 409', async () => {
    baseMocks();
    mocksWithEstimatingLine();
    renderProposalTab();
    await waitFor(() => expect(screen.getByText('Proposal Preview')).toBeTruthy());
    fireEvent.click(screen.getByText('Download Takeoff (.xlsx)'));
    await waitFor(() => expect(screen.getByLabelText('Evidence / reason for Owner-furnished panel')).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Evidence / reason for Owner-furnished panel')));
  });

  it('Run Agent 4: jumps to the named line on a 409 (JSON, not a blob)', async () => {
    baseMocks();
    mocksWithEstimatingLine();
    post.mockImplementation((url: string) => url === `/preconstruction/${bid.id}/run-agent4`
      ? Promise.reject({ response: { status: 409, data: EVIDENCE_BODY } })
      : Promise.resolve({ data: {} }));
    renderProposalTab();
    await waitFor(() => expect(screen.getByText('Proposal Preview')).toBeTruthy());
    const priceInput = await screen.findByPlaceholderText('e.g. 285000');
    fireEvent.change(priceInput, { target: { value: '250000' } });
    fireEvent.click(screen.getByText(/Re-run Agent 4|Run Agent 4/));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/preconstruction/${bid.id}/run-agent4`, expect.objectContaining({ price: '250000' })));
    await waitFor(() => expect(screen.getByLabelText('Evidence / reason for Owner-furnished panel')).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Evidence / reason for Owner-furnished panel')));
  });

  it('Draft Proposal Email (draft-proposal / send): closes the modal and jumps to the named line on a 409', async () => {
    baseMocks();
    mocksWithEstimatingLine();
    post.mockImplementation((url: string) => url === `/bids/${bid.id}/draft-proposal`
      ? Promise.reject({ response: { status: 409, data: EVIDENCE_BODY } })
      : Promise.resolve({ data: {} }));
    renderProposalTab();
    await waitFor(() => expect(screen.getByText('Proposal Preview')).toBeTruthy());
    fireEvent.click(screen.getByText('Draft Proposal Email'));
    const toField = await screen.findByPlaceholderText('bids@generalcontractor.com');
    fireEvent.change(toField, { target: { value: 'gc@example.com' } });
    fireEvent.click(screen.getByText('Create Outlook Draft'));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/bids/${bid.id}/draft-proposal`, expect.anything()));
    // The modal is gone (jumped away, not left open showing the raw error).
    await waitFor(() => expect(screen.queryByPlaceholderText('bids@generalcontractor.com')).toBeNull());
    // Labor & Pricing is focused on the named line.
    await waitFor(() => expect(screen.getByLabelText('Evidence / reason for Owner-furnished panel')).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Evidence / reason for Owner-furnished panel')));
  });
});
