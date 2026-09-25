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
    // useApi sends the linked_id as an axios `params` object rather than an
    // inline query string, so match on the path.
    if (url === '/documents') return Promise.resolve({ data: PROJECT_DOCS });
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

function renderFilesTab(extra?: { onGoOverview?: () => void }) {
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
      onGoOverview={extra?.onGoOverview}
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
    // Job profile fix round S5 — a plan file arrives pre-ticked.
    await waitFor(() => expect(checkbox.checked).toBe(true));

    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(false);
    // No preview fetch of any kind should have fired from the checkbox click.
    expect(get).not.toHaveBeenCalledWith('/documents/doc-2/view', expect.anything());
  });
});

describe('PcWorkspace Documents step — fix round 2 / S3: S4 render check (Import Finished Bid + notes)', () => {
  it('renders the Workspace Notes textarea and the Import Finished Bid panel', async () => {
    mockApi();
    renderFilesTab();
    await waitFor(() => expect(screen.getByText('takeoff.xlsx')).toBeTruthy());
    expect(screen.getByTestId('documents-workspace-notes')).toBeTruthy();
    expect(screen.getByText('Import Finished Bid')).toBeTruthy();
  });
});

describe('PcWorkspace Documents step — coordinator override (2026-09-24): no plan dropzone, link to Overview', () => {
  it('has no upload dropzone and no "Clear All" — the plan list is read-only', async () => {
    mockApi();
    renderFilesTab();
    await waitFor(() => expect(screen.getByText('takeoff.xlsx')).toBeTruthy());

    expect(screen.queryByText(/drop plan sheets here/i)).toBeNull();
    expect(screen.queryByText(/clear all/i)).toBeNull();
    expect(screen.queryByText(/uploaded plan files/i)).toBeNull();
  });

  it('shows a page count next to a plan file and a link that navigates to Overview', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/documents') {
        return Promise.resolve({
          data: [{ id: 'doc-2', name: 'plans.pdf', display_name: 'plans.pdf', category: 'plans', file_type: 'application/pdf', page_count: 55 }],
        });
      }
      return Promise.resolve({ data: null });
    });
    post.mockResolvedValue({ data: {} });

    const onGoOverview = vi.fn();
    renderFilesTab({ onGoOverview });

    await waitFor(() => expect(screen.getByText('plans.pdf')).toBeTruthy());
    expect(screen.getByText('55 pg')).toBeTruthy();

    fireEvent.click(screen.getByText(/add or replace plans on the bid overview/i));
    expect(onGoOverview).toHaveBeenCalledTimes(1);
  });
});

describe('Job profile fix round — S5 / S6 / S9 in the Documents step', () => {
  const DOCS = [
    { id: 'p1', name: 'E-Set.pdf', display_name: 'E-Set.pdf', category: 'plans', file_type: 'application/pdf' },
    { id: 'z1', name: 'Arch.zip', display_name: 'Arch.zip', category: 'plans', file_type: 'application/zip' },
    { id: 'g1', name: 'Proposal.pdf', display_name: 'Proposal.pdf', category: 'proposal', file_type: 'application/pdf', generated: true },
    { id: 's1', name: 'Old Proposal.pdf', display_name: 'Old Proposal.pdf', category: 'proposal', file_type: 'application/pdf', generated: true, superseded_at: '2026-01-01' },
  ];

  it('S5 / S6 — the current plan files (a ZIP included) arrive ticked; generated files never', async () => {
    get.mockImplementation((url: string) => Promise.resolve({ data: url === '/documents' ? DOCS : null }));
    post.mockResolvedValue({ data: {} });
    renderFilesTab();
    const e = await screen.findByTestId('project-doc-checkbox-p1') as HTMLInputElement;
    await waitFor(() => expect(e.checked).toBe(true));
    const zip = screen.getByTestId('project-doc-checkbox-z1') as HTMLInputElement;
    expect(zip.disabled).toBe(false);
    expect(zip.checked).toBe(true);
    expect((screen.getByTestId('project-doc-checkbox-g1') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('project-doc-checkbox-g1') as HTMLInputElement).disabled).toBe(true);
  });

  it('S5 — with an earlier run, its inputs are the default instead', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: DOCS });
      if (url === '/preconstruction/b1/results') return Promise.resolve({ data: { status: 'complete', run_id: 'r1', input_document_ids: ['z1'] } });
      return Promise.resolve({ data: null });
    });
    post.mockResolvedValue({ data: {} });
    renderFilesTab();
    const zip = await screen.findByTestId('project-doc-checkbox-z1') as HTMLInputElement;
    await waitFor(() => expect(zip.checked).toBe(true));
    expect((screen.getByTestId('project-doc-checkbox-p1') as HTMLInputElement).checked).toBe(false);
  });

  it('S9 — a per-sheet Upload is filed as a plan document, shown and ticked, and the job profile re-reads the plans', async () => {
    let docs = [DOCS[0]];
    get.mockImplementation((url: string) => Promise.resolve({ data: url === '/documents' ? docs : null }));
    post.mockImplementation((url: string) => {
      if (url === '/documents') {
        docs = [...docs, { id: 'm1', name: 'M-1.pdf', display_name: 'M-1.pdf', category: 'plans', file_type: 'application/pdf' }];
        return Promise.resolve({ data: { id: 'm1' } });
      }
      return Promise.resolve({ data: {} });
    });
    renderFilesTab();
    await screen.findByTestId('project-doc-checkbox-p1');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['%PDF-1.4'], 'M-1.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    const m1 = await screen.findByTestId('project-doc-checkbox-m1') as HTMLInputElement;
    await waitFor(() => expect(m1.checked).toBe(true));
    const docPost = post.mock.calls.find(c => c[0] === '/documents')!;
    expect((docPost[1] as FormData).get('category')).toBe('plans');
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/job-profile/run', {}));
    // Unticking removes it from the run like any other plan file.
    fireEvent.click(m1);
    expect(m1.checked).toBe(false);
  });
});

describe('Review N3 — the Documents step is done only with real plan files', () => {
  it('a generated proposal alone does not count; a plan file does', async () => {
    get.mockImplementation((url: string) => Promise.resolve({ data: url === '/documents'
      ? [{ id: 'g1', name: 'Proposal.pdf', display_name: 'Proposal.pdf', category: 'proposal', file_type: 'application/pdf', generated: true }] : null }));
    post.mockResolvedValue({ data: {} });
    renderFilesTab();
    await screen.findByTestId('project-doc-checkbox-g1');
    for (const el of screen.getAllByTestId('est-step-documents')) expect(el.className).not.toMatch(/done/);
    cleanup();
    get.mockImplementation((url: string) => Promise.resolve({ data: url === '/documents'
      ? [{ id: 'p1', name: 'E-Set.pdf', display_name: 'E-Set.pdf', category: 'plans', file_type: 'application/pdf' }] : null }));
    renderFilesTab();
    await screen.findByTestId('project-doc-checkbox-p1');
    await waitFor(() => expect(screen.getAllByTestId('est-step-documents')[0].className).toMatch(/done/));
  });
});

describe('Round 2 R2-S3 — a newer upload replaces the older plan set in the selection', () => {
  it('unticks Rev 1 when the sheet check says Rev 2 carries its sheets, and says so', async () => {
    const docs = [
      { id: 'r1', name: 'Elec Rev 1.pdf', display_name: 'Elec Rev 1.pdf', category: 'plans', file_type: 'application/pdf' },
      { id: 'r2', name: 'Elec Rev 2.pdf', display_name: 'Elec Rev 2.pdf', category: 'plans', file_type: 'application/pdf' },
    ];
    const pages = [
      { key: 'a#1', file: 'Elec Rev 1.pdf', documentId: 'r1', page: 1, sheetNo: 'E-1', title: 'POWER', discipline: 'electrical', cls: 'plan', hasTextLayer: true, role: 'excluded', reason: 'replaced by Elec Rev 2.pdf', replacedBy: 'Elec Rev 2.pdf' },
      { key: 'b#1', file: 'Elec Rev 2.pdf', documentId: 'r2', page: 1, sheetNo: 'E-1', title: 'POWER', discipline: 'electrical', cls: 'plan', hasTextLayer: true, role: 'analysis', reason: 'electrical sheet' },
    ];
    get.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: docs });
      if (url === '/preconstruction/b1/sheet-check') return Promise.resolve({ data: { status: 'complete', pages, missing: [], unclassifiedFiles: [], otherFiles: [], error: null, checkedAt: 'now' } });
      return Promise.resolve({ data: null });
    });
    post.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith('/sheet-check/run') ? { status: 'complete', pages, missing: [], unclassifiedFiles: [], otherFiles: [], error: null, checkedAt: 'now' } : {} }));
    renderFilesTab();
    const r1 = await screen.findByTestId('project-doc-checkbox-r1') as HTMLInputElement;
    const r2 = screen.getByTestId('project-doc-checkbox-r2') as HTMLInputElement;
    await waitFor(() => expect(r1.checked).toBe(false));
    expect(r2.checked).toBe(true);
    expect(screen.getByTestId('plan-replaced-notices').textContent).toContain('Elec Rev 2.pdf replaced Elec Rev 1.pdf for analysis.');
  });
});
