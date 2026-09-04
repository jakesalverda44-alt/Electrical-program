// @vitest-environment happy-dom
// Regression test for review finding B3. On main `saveSection` was
// `await api.put(...)` with no catch, so a failed PUT REJECTED and the `await`
// in each of its five handlers aborted the rest — `onDataChange` never ran.
// Migrating it to useMutation made `run()` swallow the failure and resolve
// `undefined`, so `onDataChange(...)` ran unconditionally: a failed save wrote
// the unsaved draft into the parent, the section read as persisted, and the
// dirty check that feeds the task 8 guard went false. The user saw "Save
// failed" and then walked away from work that never reached the server.
//
// Asserted through the guard rather than by spying on `onDataChange`, because
// the guard going quiet is the actual harm.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ElecProjectsPage from './ElecProjectsPage';
import { AppProviders } from '../../contexts/AppContext';
import { UnsavedGuardProvider, useConfirmLeave } from '../../contexts/UnsavedGuardContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { Bid, Toast, User } from '../../types';

afterEach(cleanup);

const get = vi.fn();
const put = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: (...a: unknown[]) => put(...a),
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

const serverError = () => Object.assign(new Error('boom'), {
  isAxiosError: true, response: { status: 500, data: {} },
});

beforeEach(() => {
  shown.length = 0;
  get.mockReset();
  put.mockReset();
  // Every section starts empty, so any Overview text is a real change.
  get.mockResolvedValue({ data: [] });
  get.mockImplementation((url: string) => {
    if (url.includes('/section/')) return Promise.resolve({ data: {} });
    return Promise.resolve({ data: [] });
  });
});

const navigate = () => fireEvent.click(screen.getByText('Go to Dashboard'));

function Nav() {
  const confirmLeave = useConfirmLeave();
  return <button onClick={() => confirmLeave(() => { navigated = true; })}>Go to Dashboard</button>;
}
let navigated = false;

function renderWorkspace() {
  navigated = false;
  render(
    <AppProviders user={user} showToast={t => { shown.push(t); }} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <UnsavedGuardProvider>
        <Nav/>
        <ElecProjectsPage bids={[bid]} setBids={() => {}} setWonJobs={() => {}} openId={bid.id}/>
      </UnsavedGuardProvider>
    </AppProviders>,
  );
}

/** The Overview card's "Project Manager" row — a plain text input. */
async function projectManagerInput(): Promise<HTMLInputElement> {
  const label = await screen.findByText('Project Manager');
  const row = label.parentElement as HTMLElement;
  return row.querySelector('input') as HTMLInputElement;
}

/** The Contract Overview card's own Save button (the first of several). */
function overviewSaveButton(): HTMLElement {
  return screen.getAllByText('Save')[0].closest('button') as HTMLElement;
}

describe('ElecProjectsPage saveSection', () => {
  it('a failed PUT toasts, leaves the draft dirty, and keeps the unsaved guard armed', async () => {
    put.mockRejectedValue(serverError());
    renderWorkspace();

    const pm = await projectManagerInput();
    fireEvent.change(pm, { target: { value: 'Dana Reyes' } });

    fireEvent.click(overviewSaveButton());

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(shown.length).toBe(1));
    expect(shown[0]).toEqual({ variant: 'error', title: 'Save failed', sub: 'Server error' });

    // The draft must still count as unsaved: the guard is the only thing left
    // standing between the user and losing it.
    navigate();
    expect(await screen.findByText('You have unsaved changes')).toBeTruthy();
    expect(navigated).toBe(false);
  });

  it('a successful PUT toasts "Saved" and clears the dirty state', async () => {
    put.mockResolvedValue({ data: {} });
    renderWorkspace();

    const pm = await projectManagerInput();
    fireEvent.change(pm, { target: { value: 'Dana Reyes' } });

    fireEvent.click(overviewSaveButton());

    await waitFor(() => expect(shown).toEqual([{ title: 'Saved' }]));

    navigate();
    await waitFor(() => expect(navigated).toBe(true));
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
  });

  it('an untouched Overview does not arm the guard at all', async () => {
    put.mockResolvedValue({ data: {} });
    renderWorkspace();

    await projectManagerInput();
    navigate();

    await waitFor(() => expect(navigated).toBe(true));
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
  });
});
