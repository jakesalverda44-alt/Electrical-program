// @vitest-environment happy-dom
// Covers the Estimating tab's "From Project Files" panel: clicking a file name
// should preview it in-app (arraybuffer fetch + FilePreviewModal), same as
// RecordFiles' view(), instead of doing nothing as it did before this fix.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
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

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const PROJECT_DOCS = [
  { id: 'doc-1', name: 'takeoff.xlsx', display_name: 'takeoff.xlsx', category: 'takeoff', file_type: XLSX_TYPE },
  // AI-eligible (PDF) so its checkbox isn't disabled — used to prove checkbox
  // clicks toggle selection without also triggering the name-click preview.
  { id: 'doc-2', name: 'plans.pdf', display_name: 'plans.pdf', category: 'plans', file_type: 'application/pdf' },
];

function mockApi() {
  get.mockImplementation((url: string) => {
    if (url.startsWith('/documents?linked_id=')) return Promise.resolve({ data: PROJECT_DOCS });
    if (/\/documents\/.+\/view/.test(url)) return Promise.resolve({ data: new ArrayBuffer(8) });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
}

const bid: Bid = {
  id: 'b1', name: 'Test Job', loc: '', gc: '', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
};

function renderFilesTab() {
  const ws = { ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'files' as const };
  render(
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

describe('PcWorkspace Files tab — "From Project Files" preview', () => {
  it('clicking a file name fetches it as an arraybuffer and opens the preview modal', async () => {
    mockApi();
    renderFilesTab();

    await waitFor(() => expect(screen.getByText('takeoff.xlsx')).toBeTruthy());

    fireEvent.click(screen.getByText('takeoff.xlsx'));

    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/documents/doc-1/view', { responseType: 'arraybuffer' });
    });
    // FilePreviewModal renders a "Loading preview…" state before xlsx parsing resolves.
    await waitFor(() => expect(screen.getByText(/loading preview|could not render/i)).toBeTruthy());
  });

  it('clicking the row checkbox toggles selection without opening the preview', async () => {
    mockApi();
    renderFilesTab();

    await waitFor(() => expect(screen.getByText('plans.pdf')).toBeTruthy());
    const row = screen.getByText('plans.pdf').closest('label') as HTMLElement;
    const checkbox = within(row).getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(true);
    // No preview fetch of any kind should have fired from the checkbox click.
    expect(get).not.toHaveBeenCalledWith('/documents/doc-2/view', expect.anything());
  });
});
