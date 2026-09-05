// @vitest-environment happy-dom
// Regression test for audit ux #21: the CO / Pay App / RFI / Key Material /
// Field Note quick-add rows built their own inline `onClick={async () => {...}}`
// handlers with no busy flag, so a fast double-click could fire the POST
// twice. They now go through `useMutation`, whose `saving` flag disables the
// button (and swaps its label) for the duration of the request, and whose
// single-flight guard collapses a second call onto the first in-flight one
// regardless.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ElecProjectsPage from './ElecProjectsPage';
import { AppProviders } from '../../contexts/AppContext';
import { UnsavedGuardProvider } from '../../contexts/UnsavedGuardContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { Bid, Toast, User } from '../../types';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const user: User = { id: 'u1', name: 'Jane', email: 'jane@x.com', role: 'owner' };
const shown: Toast[] = [];

const bid: Bid = {
  id: 'b1', name: 'Circle K #4521', gc: 'ABC Construction', loc: 'Ocala, FL',
  due: '', due_days: 0, amount: 250000, sheets: 0, contact: '', stage: 'awarded',
  salesperson_name: '', elec_project_phase: 'signed',
} as unknown as Bid;

beforeEach(() => {
  shown.length = 0;
  get.mockReset();
  post.mockReset();
  get.mockImplementation((url: string) => {
    if (url.includes('/section/')) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: [] });
  });
});

function renderWorkspace() {
  render(
    <AppProviders user={user} showToast={t => { shown.push(t); }} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <UnsavedGuardProvider>
        <ElecProjectsPage bids={[bid]} setBids={() => {}} setWonJobs={() => {}} openId={bid.id}/>
      </UnsavedGuardProvider>
    </AppProviders>,
  );
}

describe('ElecProjectsPage quick-add rows — double-submit protection (audit ux #21)', () => {
  it('the RFI row cannot fire the POST twice on a fast double-click', async () => {
    let resolvePost: (v: { data: unknown }) => void;
    post.mockImplementation(() => new Promise(res => { resolvePost = res; }));
    renderWorkspace();

    fireEvent.click(await screen.findByText('Request Log'));

    const question = (await screen.findByPlaceholderText('Describe the information request…')) as HTMLInputElement;
    fireEvent.change(question, { target: { value: 'Confirm panel schedule revision' } });

    // Same DOM node throughout — its label/disabled state changes underneath,
    // but re-querying by the now-stale "Submit RFI" name would fail once the
    // button flips to "Submitting…".
    const submit = screen.getByRole('button', { name: /Submit RFI/ }) as HTMLButtonElement;
    fireEvent.click(submit);
    // Still in flight — a second and third, fast click must not issue more requests.
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(submit.textContent).toContain('Submitting…');
    expect(submit.disabled).toBe(true);

    resolvePost!({ data: { id: 'rfi1', rfi_number: 'RFI-001', question: 'Confirm panel schedule revision', status: 'open' } });
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(submit.textContent).toContain('Submit RFI');
    expect(post).toHaveBeenCalledTimes(1);
  });
});
