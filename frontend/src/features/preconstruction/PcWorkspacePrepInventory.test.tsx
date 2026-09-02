// @vitest-environment happy-dom
// Task 2 (phase 2 takeoff fidelity): a low-fidelity run used to be silent — one
// backend log line nobody saw. takeoff_results now carries prep_inventory (one
// row per classified page) and prep_fidelity ('tiled+text' | 'tiled' |
// 'document-fallback'), and the Plan Review tab's run-cost area renders a single
// line summarizing them: "Prep: N of M pages sent (<fidelity>)".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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
  id: 'b1', name: 'Test Job', loc: '', gc: '', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
};

function mockApi(results: Record<string, unknown> | null) {
  get.mockImplementation((url: string) => {
    if (url === `/preconstruction/${bid.id}/results`) return Promise.resolve({ data: results });
    if (url.startsWith('/documents?linked_id=')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
}

function renderTakeoffTab() {
  const ws = { ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'takeoff' as const };
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

describe('PcWorkspace Plan Review tab — prep inventory line', () => {
  it('renders "Prep: N of M pages sent (fidelity)" from prep_inventory + prep_fidelity', async () => {
    mockApi({
      status: 'complete',
      agent1_output: '{}',
      agent2_output: '{}',
      agent3_output: '{}',
      prep_inventory: [
        { file: 'combined.pdf', page: 1, sheetNo: 'COVER', title: 'Cover', discipline: 'cover', cls: 'plan', included: true, textChars: 50 },
        { file: 'combined.pdf', page: 2, sheetNo: 'E-101', title: 'Electrical Site Plan', discipline: 'electrical', cls: 'plan', included: true, textChars: 800 },
        { file: 'combined.pdf', page: 3, sheetNo: 'A-101', title: 'Floor Plan', discipline: 'architectural', cls: 'plan', included: false, textChars: 0 },
      ],
      prep_fidelity: 'tiled+text',
    });
    renderTakeoffTab();

    await waitFor(() => expect(screen.getByText(/Prep: 2 of 3 pages sent \(tiled\+text\)/)).toBeTruthy());
  });

  it('flags a document-fallback run distinctly (low fidelity — no tiling or text at all)', async () => {
    mockApi({
      status: 'complete',
      agent1_output: '{}',
      agent2_output: '{}',
      agent3_output: '{}',
      prep_inventory: [],
      prep_fidelity: 'document-fallback',
    });
    renderTakeoffTab();

    await waitFor(() => expect(screen.getByText(/Prep: 0 of 0 pages sent \(document-fallback\)/)).toBeTruthy());
  });

  it('renders nothing when the run predates prep_fidelity (older takeoff_results row)', async () => {
    mockApi({
      status: 'complete',
      agent1_output: '{}',
      agent2_output: '{}',
      agent3_output: '{}',
    });
    renderTakeoffTab();

    await waitFor(() => expect(screen.getByText('Drawing Analysis')).toBeTruthy());
    expect(screen.queryByText(/Prep:/)).toBeNull();
  });
});
