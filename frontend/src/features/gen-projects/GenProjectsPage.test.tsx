// @vitest-environment happy-dom
// Regression test for review-round-1 S5/S6: Undo on a deleted generator
// project used to restore only the gen itself — prepended to the front of
// the list (wrong order for a created_at DESC list) — and dropped the local
// `wonJobs` row and Kanban `phases` entry the delete had cleared, so a
// restored project reappeared in the wrong phase column and out of order.
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import GenProjectsPage from './GenProjectsPage';
import api from '../../api/client';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import { Gen, WonJob, Toast as ToastType } from '../../types';
import ToastBar from '../../components/Toast';

afterEach(cleanup);

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock('../../contexts/AppContext', () => ({
  useShowToast: vi.fn(() => vi.fn()),
  useOptionalShowToast: vi.fn(() => vi.fn()),
}));

import { useShowToast, useOptionalShowToast } from '../../contexts/AppContext';

function gen(id: string, customer: string, phase: string): Gen {
  return {
    id, customer, loc: 'Ocala, FL', mfr: 'Kohler', model: '20RCAL', kw: 20,
    amount: 15000, tax: 0, stage: 'awarded', built_on: 'builder', addons: 0,
    salesperson_name: 'Jane Owner', gen_install_phase: phase,
  } as Gen;
}

const genA = gen('a', 'Alice Adams', 'engineering');
const genB = gen('b', 'Bob Brown', 'permitting');
const genC = gen('c', 'Carla Cruz', 'installation');

function Harness() {
  const [gens, setGens] = useState<Gen[]>([genA, genB, genC]);
  const [wonJobs, setWonJobs] = useState<WonJob[]>([
    { id: 'w-b', salesperson_name: 'Jane Owner', customer: 'Bob Brown', proposal_id: 'b', proposal_type: 'Generator', value: 15000, date_won: '2026-08-01' },
  ]);
  const [toast, setToast] = useState<ToastType | null>(null);
  vi.mocked(useShowToast).mockReturnValue(setToast);
  vi.mocked(useOptionalShowToast).mockReturnValue(setToast);
  return (
    <>
      <GenProjectsPage gens={gens} setGens={setGens} wonJobs={wonJobs} setWonJobs={setWonJobs}/>
      {toast && <ToastBar toast={toast}/>}
      {/* Test hooks — the board only shows customer name + phase column, not
          the underlying wonJobs array directly. */}
      <div data-testid="gen-order">{gens.map(g => g.id).join(',')}</div>
      <div data-testid="won-jobs">{wonJobs.map(w => w.proposal_id).join(',')}</div>
    </>
  );
}

function renderHarness() {
  return render(<ConfirmProvider><Harness/></ConfirmProvider>);
}

describe('GenProjectsPage — delete Undo restores gens order, wonJobs, and phase (review round 1 S5/S6)', () => {
  it('restores the gen at its original index, its won-job row, and its Kanban phase', async () => {
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url === '/gens/b/restore') return Promise.resolve({ data: { ...genB } });
      return Promise.resolve({ data: {} });
    });
    renderHarness();

    expect(screen.getByTestId('gen-order').textContent).toBe('a,b,c');
    expect(screen.getByTestId('won-jobs').textContent).toBe('b');

    // Open Bob Brown's detail panel (in the "Permitting" column) and delete it.
    fireEvent.click(screen.getByText('Bob Brown'));
    fireEvent.click(screen.getByText('Delete Project'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Delete'));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/gens/b'));
    await waitFor(() => expect(screen.getByTestId('gen-order').textContent).toBe('a,c'));
    expect(screen.getByTestId('won-jobs').textContent).toBe('');

    fireEvent.click(await screen.findByText('Undo'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/gens/b/restore'));

    // Restored at its ORIGINAL index (between a and c), not prepended.
    await waitFor(() => expect(screen.getByTestId('gen-order').textContent).toBe('a,b,c'));
    // The won-job row is back.
    expect(screen.getByTestId('won-jobs').textContent).toBe('b');
    // The card is back on the board (also present in the restore toast's
    // sub-text, hence multiple "Bob Brown" matches) in its original phase
    // column (Permitting), not reset to the default 'deposit' column.
    const permittingCol = screen.getByText('Permitting').closest('.col') as HTMLElement;
    expect(within(permittingCol).getByText('Bob Brown')).toBeTruthy();
  });
});
