// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import PreBidTab from './PreBidTab';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
vi.mock('../../api/client', () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
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

  it('renders the size delta against a comparable', async () => {
    get.mockImplementation((url: string) => Promise.resolve({
      data: url.includes('/prebid-comparables')
        ? { bid: { id: 'b1', sq_ft: 7500 },
            comparables: [{ id: 'c1', name: 'Indian Oaks', sq_ft: 5000, project_type: 'self_storage',
                            stage: 'due', sq_ft_delta_pct: 50 }] }
        : pkg,
    }));
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Indian Oaks')).toBeTruthy());
    expect(screen.getByText(/50%\s*larger/i)).toBeTruthy();
  });

  it('prompts for upload when no package exists', async () => {
    get.mockResolvedValue({ data: { takeoff: null, scope: null } });
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/Upload the pre-bid package/i)).toBeTruthy());
  });

  it('hands parsed sections up so the Scope tab can import them', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/prebid-comparables') ? { comparables: [] } : pkg }));
    const onSectionsLoaded = vi.fn();
    render(<PreBidTab bidId="b1" onSectionsLoaded={onSectionsLoaded}/>);
    await waitFor(() => expect(onSectionsLoaded).toHaveBeenCalledWith(pkg.scope.sections));
  });
});
