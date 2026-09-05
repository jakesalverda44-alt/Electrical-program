// @vitest-environment happy-dom
// Audit batch 3, Task 5 (audit-data-perf.md #6) — ElecProjectsPage used to
// fetch every document and every comm in the system on every project open,
// then filter to the one project client-side. This proves the fix: the
// requests now carry `linked_id` so the server does the filtering.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import ElecProjectsPage from './ElecProjectsPage';
import { AppProviders } from '../../contexts/AppContext';
import { UnsavedGuardProvider } from '../../contexts/UnsavedGuardContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { Bid, Toast, User } from '../../types';

afterEach(cleanup);

const get = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const user: User = { id: 'u1', name: 'Jane', email: 'jane@x.com', role: 'owner' };

const bid: Bid = {
  id: 'b1', name: 'Circle K #4521', gc: 'ABC Construction', loc: 'Ocala, FL',
  due: '', due_days: 0, amount: 250000, sheets: 0, contact: '', stage: 'awarded',
  salesperson_name: '', elec_project_phase: 'signed',
} as unknown as Bid;

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url: string) => {
    if (url.includes('/section/')) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: [] });
  });
});

function renderWorkspace() {
  render(
    <AppProviders user={user} showToast={(_t: Toast) => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <UnsavedGuardProvider>
        <ElecProjectsPage bids={[bid]} setBids={() => {}} wonJobs={[]} setWonJobs={() => {}} openId={bid.id}/>
      </UnsavedGuardProvider>
    </AppProviders>,
  );
}

describe('ElecProjectsPage — documents/comms requests carry linked_id (Task 5)', () => {
  it('requests /documents and /comms with params.linked_id set to the open project id', async () => {
    renderWorkspace();

    await waitFor(() => expect(get).toHaveBeenCalledWith('/documents', { params: { linked_id: bid.id } }));
    expect(get).toHaveBeenCalledWith('/comms', { params: { linked_id: bid.id } });

    // The old client-side .filter(d => d.linked_id === id) is gone — nothing
    // about the request depends on it, and there's no bare (paramless)
    // /documents or /comms call in the same load.
    const docsCalls = get.mock.calls.filter(c => c[0] === '/documents');
    const commsCalls = get.mock.calls.filter(c => c[0] === '/comms');
    expect(docsCalls).toEqual([['/documents', { params: { linked_id: bid.id } }]]);
    expect(commsCalls).toEqual([['/comms', { params: { linked_id: bid.id } }]]);
  });
});
