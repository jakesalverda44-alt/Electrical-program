// @vitest-environment happy-dom
// B2 (live test, bid 041c6d48, 2026-09-28) — the Documents step must never
// keep, or start with, a selection of trashed plan files.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace } from './constants';
import { Bid } from '../../types';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: () => Promise.resolve({ data: {} }),
    delete: () => Promise.resolve({ data: {} }),
  },
}));

const bid: Bid = {
  id: 'b1', name: 'Test Job', loc: '', gc: '', due: '', due_days: 0, amount: null,
  sheets: 0, contact: '', stage: 'due', salesperson_name: '',
};
const plan = (id: string, name: string) => ({ id, name, display_name: name, category: 'plans', file_type: 'application/pdf' });

function props(visible: boolean) {
  return {
    ws: { ...blankWorkspace('b1', 'Test Job', 0), activeTab: 'files' as const },
    bid, onUpdate: () => {}, onBack: () => {}, onConverted: () => {}, onBidUpdated: () => {}, showToast: () => {}, embedded: true, visible,
  };
}

beforeEach(() => { get.mockReset(); post.mockReset(); post.mockResolvedValue({ data: {} }); });

describe('Documents step selection vs. replaced / removed plans (B2)', () => {
  it('a prior run whose documents were all trashed falls back to ticking the current plan files', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/documents') return Promise.resolve({ data: [plan('new1', 'New Set.pdf')] });
      if (url === '/preconstruction/b1/results') return Promise.resolve({ data: { status: 'complete', run_id: 'r1', input_document_ids: ['old1', 'old2'] } });
      return Promise.resolve({ data: null });
    });
    render(<PcWorkspaceView {...props(true)} />);
    const box = await screen.findByTestId('project-doc-checkbox-new1') as HTMLInputElement;
    await waitFor(() => expect(box.checked).toBe(true));
  });

  it('a replace while the page is open drops the trashed ids and ticks the new files', async () => {
    let docs = [plan('old1', 'Old Set.pdf')];
    get.mockImplementation((url: string) => Promise.resolve({ data: url === '/documents' ? docs : null }));
    const { rerender } = render(<PcWorkspaceView {...props(true)} />);
    const oldBox = await screen.findByTestId('project-doc-checkbox-old1') as HTMLInputElement;
    await waitFor(() => expect(oldBox.checked).toBe(true));

    // The user goes to Overview (Estimating stays mounted, hidden) and replaces the set.
    rerender(<PcWorkspaceView {...props(false)} />);
    docs = [plan('new1', 'New Set.pdf')];
    rerender(<PcWorkspaceView {...props(true)} />);

    const newBox = await screen.findByTestId('project-doc-checkbox-new1') as HTMLInputElement;
    await waitFor(() => expect(newBox.checked).toBe(true));
    expect(screen.queryByTestId('project-doc-checkbox-old1')).toBeNull();
    // The next sheet check is posted for the new file only — never the trashed id.
    await waitFor(() => {
      const runs = post.mock.calls.filter(c => String(c[0]).endsWith('/sheet-check/run'));
      expect(runs.length).toBeGreaterThan(0);
      const last = runs[runs.length - 1][1] as FormData;
      expect(last.getAll('document_ids')).toEqual(['new1']);
    }, { timeout: 5000 });
  });

  it('a partial replace keeps the still-current ticks and prunes only the gone one', async () => {
    let docs = [plan('a', 'A.pdf'), plan('b', 'B.pdf')];
    get.mockImplementation((url: string) => Promise.resolve({ data: url === '/documents' ? docs : null }));
    const { rerender } = render(<PcWorkspaceView {...props(true)} />);
    await waitFor(() => expect((screen.getByTestId('project-doc-checkbox-b') as HTMLInputElement).checked).toBe(true));
    rerender(<PcWorkspaceView {...props(false)} />);
    docs = [plan('b', 'B.pdf'), plan('c', 'C.pdf')];
    rerender(<PcWorkspaceView {...props(true)} />);
    await waitFor(() => expect((screen.getByTestId('project-doc-checkbox-c') as HTMLInputElement).checked).toBe(true));
    expect((screen.getByTestId('project-doc-checkbox-b') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId('project-doc-checkbox-a')).toBeNull();
  });
});
