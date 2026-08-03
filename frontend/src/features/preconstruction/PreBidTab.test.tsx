// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import PreBidTab from './PreBidTab';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
  },
}));

const pkg = {
  takeoff: {
    item_count: 49,
    categories: [
      { name: 'EXTERIOR / SITE LIGHTING', itemCount: 3, unresolvedCount: 3, totals: {},
        subcategories: [{ name: 'EXTERIOR / SITE LIGHTING', itemCount: 3, totals: {} }] },
      { name: 'BRANCH POWER', itemCount: 4, unresolvedCount: 1, totals: { EA: 6 },
        subcategories: [
          { name: 'BRANCH POWER — BUILDING', itemCount: 2, totals: { EA: 6 } },
          { name: 'BRANCH POWER — CAR WASH EQUIPMENT', itemCount: 2, totals: {} },
        ] },
    ],
    line_items: [
      { category: 'EXTERIOR / SITE LIGHTING', description: 'Site Light Pole', unit: 'EA',
        qty: null, qtyRaw: 'VERIFY', confidence: 'VERIFY', notes: 'Per photometric plan' },
    ],
    key_findings: ['Confidence key:'],
  },
  scope: {
    furnish_model: 'OFEI',
    furnish_note: 'This project is Owner Furnished / EC Installed for gear and lighting.',
    meta: { GC: 'Summit General Contractors' },
    sections: [{ id: 'A', title: 'Service & Distribution', items: ['gear'] }],
  },
};

describe('PreBidTab', () => {
  it('shows the OFEI banner when the job is owner-furnished', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/prebid-comparables') ? { comparables: [] } : pkg }));
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/Owner Furnished/i)).toBeTruthy());
    expect(screen.getByText(/OFEI/)).toBeTruthy();
  });

  it('lists unresolved items as the risk list', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/prebid-comparables') ? { comparables: [] } : pkg }));
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Site Light Pole')).toBeTruthy());
    expect(screen.getByText('VERIFY')).toBeTruthy();
  });

  it('flags a subcategory present on one side only as a cost driver', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/prebid-comparables') ? { comparables: [] } : pkg }));
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/CAR WASH EQUIPMENT/)).toBeTruthy());
  });

  it('renders the size delta against a smaller comparable, subject-first', async () => {
    // Subject 7,500 SF vs comp "Indian Oaks" 5,000 SF -> sq_ft_delta_pct = +50
    // (backend: ((subject - comp) / comp) * 100). The subject is the LARGER job here,
    // so the sentence must read "This job is ... larger than Indian Oaks" — not attach
    // "larger" to the comp's name, which would state the size relationship backwards.
    get.mockImplementation((url: string) => Promise.resolve({
      data: url.includes('/prebid-comparables')
        ? { bid: { id: 'b1', sq_ft: 7500 },
            comparables: [{ id: 'c1', name: 'Indian Oaks', sq_ft: 5000, project_type: 'self_storage',
                            stage: 'due', sq_ft_delta_pct: 50 }] }
        : pkg,
    }));
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Indian Oaks')).toBeTruthy());
    expect(screen.getByText(/This job is 50% larger than Indian Oaks/i)).toBeTruthy();
  });

  it('renders the size delta against a larger comparable, subject-first', async () => {
    // Subject 5,000 SF vs comp "Big Store" 7,500 SF -> sq_ft_delta_pct = -33.
    // The subject is the SMALLER job here, so the sentence must read "smaller".
    // Paired with the case above, an inverted larger/smaller label can never pass both.
    get.mockImplementation((url: string) => Promise.resolve({
      data: url.includes('/prebid-comparables')
        ? { bid: { id: 'b1', sq_ft: 5000 },
            comparables: [{ id: 'c1', name: 'Big Store', sq_ft: 7500, project_type: 'self_storage',
                            stage: 'due', sq_ft_delta_pct: -33 }] }
        : pkg,
    }));
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Big Store')).toBeTruthy());
    expect(screen.getByText(/This job is 33% smaller than Big Store/i)).toBeTruthy();
  });

  it('prompts for upload when no package exists, with an actual control to do it', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/prebid-comparables') ? { comparables: [] } : { takeoff: null, scope: null } }));
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/Upload the pre-bid package/i)).toBeTruthy());
    // Real controls, not just passive text telling the user to go find one elsewhere.
    expect(screen.getByText(/Scope narrative/i)).toBeTruthy();
    expect(screen.getByText('Quantity takeoff (.xlsx)')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Upload$/ })).toBeTruthy();
  });

  it('hands parsed sections up so the Scope tab can import them', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/prebid-comparables') ? { comparables: [] } : pkg }));
    const onSectionsLoaded = vi.fn();
    render(<PreBidTab bidId="b1" onSectionsLoaded={onSectionsLoaded}/>);
    await waitFor(() => expect(onSectionsLoaded).toHaveBeenCalledWith(pkg.scope.sections));
  });
});

describe('Upload panel', () => {
  it('posts FormData to import-prebid, re-fetches, and surfaces sqFtApplied + suggestedBrand', async () => {
    let prebidCalls = 0;
    let comparablesCalls = 0;
    get.mockImplementation((url: string) => {
      if (url.includes('/prebid-comparables')) { comparablesCalls++; return Promise.resolve({ data: { comparables: [] } }); }
      prebidCalls++;
      return Promise.resolve({ data: { takeoff: null, scope: null } });
    });
    post.mockResolvedValue({
      data: { takeoff: { categories: [], itemCount: 12, unresolvedCount: 0 }, scope: null,
              sqFtApplied: true, suggestedBrand: 'ACME Retail' },
    });

    const { container } = render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/Scope narrative/i)).toBeTruthy());

    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs.length).toBe(2);
    const takeoffFile = new File(['data'], 'plan.xlsx', { type: 'application/octet-stream' });
    fireEvent.change(inputs[1], { target: { files: [takeoffFile] } });
    fireEvent.click(screen.getByRole('button', { name: /^Upload$/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [url, formData] = post.mock.calls[0];
    expect(url).toBe('/preconstruction/b1/import-prebid');
    expect(formData).toBeInstanceOf(FormData);
    expect((formData as FormData).get('takeoff')).toBe(takeoffFile);
    expect((formData as FormData).get('scope')).toBeNull();

    // Re-fetch: one call on mount, one after the successful import, for both endpoints.
    await waitFor(() => expect(prebidCalls).toBeGreaterThanOrEqual(2));
    expect(comparablesCalls).toBeGreaterThanOrEqual(2);

    await waitFor(() => expect(screen.getByText(/Square footage filled from the takeoff/i)).toBeTruthy());
    expect(screen.getByText('ACME Retail')).toBeTruthy();
  });

  it('applies the suggested brand with a one-click PATCH to the bid', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/prebid-comparables') ? { comparables: [] } : { takeoff: null, scope: null } }));
    post.mockResolvedValue({ data: { takeoff: null, scope: null, sqFtApplied: false, suggestedBrand: 'ACME Retail' } });
    patch.mockResolvedValue({ data: { bid: { id: 'b1', brand: 'ACME Retail' } } });

    const { container } = render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/Scope narrative/i)).toBeTruthy());
    const inputs = container.querySelectorAll('input[type="file"]');
    fireEvent.change(inputs[0], { target: { files: [new File(['x'], 'scope.docx')] } });
    fireEvent.click(screen.getByRole('button', { name: /^Upload$/ }));

    await waitFor(() => expect(screen.getByText('ACME Retail')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Apply$/ }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/bids/b1', { brand: 'ACME Retail' }));
    await waitFor(() => expect(screen.getByText(/Applied\./)).toBeTruthy());
  });
});

describe('Quantity comparison + cost drivers', () => {
  const COMPARABLES = [{ id: 'c1', name: 'Big Store', sq_ft: 8000, project_type: 'retail',
                          stage: 'due', sq_ft_delta_pct: -50 }];
  const COMPARE_DATA = {
    subjectId: 'b1',
    categoryNames: ['LIGHTING & CONTROLS', 'SITE UTILITIES'],
    jobs: [
      { id: 'b1', name: 'This Bid', sq_ft: 4000, categories: [
          { name: 'SITE UTILITIES', itemCount: 8, unresolvedCount: 0, totals: { EA: 8 },
            subcategories: [{ name: 'SITE UTILITIES — IRRIGATION CONTROL', itemCount: 8, totals: { EA: 8 } }] },
          { name: 'LIGHTING & CONTROLS', itemCount: 10, unresolvedCount: 0, totals: { EA: 10 },
            subcategories: [{ name: 'LIGHTING & CONTROLS', itemCount: 10, totals: { EA: 10 } }] },
        ] },
      { id: 'c1', name: 'Big Store', sq_ft: 8000, categories: [
          { name: 'SITE UTILITIES', itemCount: 4, unresolvedCount: 0, totals: { EA: 4 },
            subcategories: [{ name: 'SITE UTILITIES', itemCount: 4, totals: { EA: 4 } }] },
        ] },
    ],
  };

  function setupGet() {
    get.mockImplementation((url: string) => {
      if (url.includes('/prebid-comparables')) return Promise.resolve({ data: { comparables: COMPARABLES } });
      if (url.endsWith('/compare')) return Promise.resolve({ data: COMPARE_DATA });
      if (url.endsWith('/c1/prebid')) return Promise.resolve({ data: { takeoff: null, scope: null } });
      return Promise.resolve({ data: pkg });
    });
  }

  it('renders per-1,000-SF quantities and flags a gap category', async () => {
    setupGet();
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Big Store')).toBeTruthy());
    fireEvent.click(screen.getByText('Big Store'));

    // SITE UTILITIES: subject 8/4000*1000 = 2.0, comp 4/8000*1000 = 0.5.
    await waitFor(() => expect(screen.getByText(/2\.0 \/1k SF/)).toBeTruthy());
    expect(screen.getByText(/0\.5 \/1k SF/)).toBeTruthy();
    // Delta must be (subject - comp) / comp, not the inverse: (2.0 - 0.5) / 0.5 = +300%.
    // A prior version of this exact feature shipped an inverted delta once already —
    // this assertion is the regression guard for that class of bug.
    expect(screen.getByText('+300%')).toBeTruthy();
    // LIGHTING & CONTROLS exists only on the subject — a gap, not hidden.
    expect(screen.getByText(/Not in Big Store.s takeoff/i)).toBeTruthy();
  });

  it('flags a one-sided subcategory as a cost driver', async () => {
    setupGet();
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Big Store')).toBeTruthy());
    fireEvent.click(screen.getByText('Big Store'));
    await waitFor(() => expect(screen.getByText(/IRRIGATION CONTROL/)).toBeTruthy());
    expect(screen.getByText(/only on this job/i)).toBeTruthy();
  });
});

describe('Scope side-by-side', () => {
  it('aligns sections by normalized title, never by letter (D/E crossover)', async () => {
    const subjectPkg = {
      takeoff: null,
      scope: {
        furnish_model: null, furnish_note: null, meta: {},
        sections: [
          { id: 'D', title: 'Site Lighting, Underground Work & Allowances', items: ['pole bases'] },
          { id: 'E', title: 'Low Voltage Infrastructure', items: ['empty conduit'] },
        ],
      },
    };
    const compPkg = {
      takeoff: null,
      scope: {
        furnish_model: null, furnish_note: null, meta: {},
        sections: [
          { id: 'D', title: 'Low Voltage Infrastructure (Conduit & Boxes Only)', items: ['data cabling'] },
          { id: 'E', title: 'Site Lighting, Underground Work & Allowances', items: ['bollards'] },
        ],
      },
    };
    get.mockImplementation((url: string) => {
      if (url.includes('/prebid-comparables')) {
        return Promise.resolve({ data: { comparables: [{ id: 'c1', name: 'Comp Job', sq_ft: null,
          project_type: null, stage: 'due', sq_ft_delta_pct: null }] } });
      }
      if (url.endsWith('/compare')) return Promise.resolve({ data: { subjectId: 'b1', categoryNames: [], jobs: [] } });
      if (url.endsWith('/c1/prebid')) return Promise.resolve({ data: compPkg });
      return Promise.resolve({ data: subjectPkg });
    });

    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Comp Job')).toBeTruthy());
    fireEvent.click(screen.getByText('Comp Job'));
    await waitFor(() => expect(screen.getByText(/pole bases/)).toBeTruthy());

    // Subject's "D" (Site Lighting) must land in the same row as the comp's "E" (also Site
    // Lighting) — never with the comp's "D" (Low Voltage), which is what naive letter
    // alignment would (wrongly) produce.
    const subjectItem = screen.getByText(/pole bases/);
    const row = subjectItem.parentElement?.parentElement;
    expect(row?.textContent).toContain('bollards');
    expect(row?.textContent).not.toContain('data cabling');
  });
});

describe('Analyze panel', () => {
  const COMPARABLES = [{ id: 'c1', name: 'Comp Job', sq_ft: null, project_type: null,
                          stage: 'due', sq_ft_delta_pct: null }];

  function setupGet(subjectData: unknown = pkg) {
    get.mockImplementation((url: string) => {
      if (url.includes('/prebid-comparables')) return Promise.resolve({ data: { comparables: COMPARABLES } });
      if (url.endsWith('/compare')) return Promise.resolve({ data: { subjectId: 'b1', categoryNames: [], jobs: [] } });
      if (url.endsWith('/c1/prebid')) return Promise.resolve({ data: { takeoff: null, scope: null } });
      return Promise.resolve({ data: subjectData });
    });
  }

  it('shows an "AI is not configured" message when the backend returns 503', async () => {
    setupGet();
    post.mockRejectedValue({
      response: { status: 503, data: { error: 'AI analysis is not configured. Add an Anthropic API key in Settings > AI or set ANTHROPIC_API_KEY in Render.' } },
    });
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Comp Job')).toBeTruthy());
    fireEvent.click(screen.getByText('Comp Job'));
    const button = await screen.findByRole('button', { name: /Analyze against Comp Job/i });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/not configured/i)).toBeTruthy());
  });

  it('moves to the running state on a successful kickoff', async () => {
    setupGet();
    post.mockResolvedValue({ data: { status: 'running' } });
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Comp Job')).toBeTruthy());
    fireEvent.click(screen.getByText('Comp Job'));
    const button = await screen.findByRole('button', { name: /Analyze against Comp Job/i });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: /Analyzing/i })).toBeTruthy());
  });

  it('renders ai_comparison when the package already reports it complete for this comparable', async () => {
    const completePkg = {
      ...pkg,
      scope: {
        ...pkg.scope,
        ai_comparison_against: 'c1',
        ai_status: 'complete',
        ai_error: null,
        ai_comparison: {
          majorDifferences: ['Subject is OFEI; this comp is ECFECI, so quantities are not directly comparable.'],
          costDrivers: ['Comp carries car-wash equipment branch circuits not present on the subject.'],
          missingScope: [],
          notes: 'Treat with caution given the furnish-model mismatch.',
        },
      },
    };
    setupGet(completePkg);
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Comp Job')).toBeTruthy());
    fireEvent.click(screen.getByText('Comp Job'));
    await waitFor(() => expect(screen.getByText(/Subject is OFEI; this comp is ECFECI/)).toBeTruthy());
    expect(screen.getByText(/car-wash equipment branch circuits/)).toBeTruthy();
    expect(screen.getByText(/Treat with caution/)).toBeTruthy();
  });
});
