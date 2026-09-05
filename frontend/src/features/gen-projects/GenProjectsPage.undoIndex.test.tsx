// @vitest-environment happy-dom
// Review round 2 N5: `originalIndex` is -1 when the deleted row's index
// can't be found in `gens` at delete time (e.g. it was already removed from
// local state by a concurrent update while its detail panel was still open —
// simulated here directly). `Math.min(-1, next.length)` evaluates to -1, and
// `next.splice(-1, 0, restored)` — a NEGATIVE splice index counts from the
// end — inserts BEFORE the last element rather than appending after it. The
// fix treats a negative `originalIndex` as "append at the end" instead of
// feeding it to `splice` raw.
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
  const [wonJobs, setWonJobs] = useState<WonJob[]>([]);
  const [toast, setToast] = useState<ToastType | null>(null);
  vi.mocked(useShowToast).mockReturnValue(setToast);
  vi.mocked(useOptionalShowToast).mockReturnValue(setToast);
  return (
    <>
      <GenProjectsPage gens={gens} setGens={setGens} wonJobs={wonJobs} setWonJobs={setWonJobs}/>
      {toast && <ToastBar toast={toast}/>}
      <div data-testid="gen-order">{gens.map(g => g.id).join(',')}</div>
      {/* Test-only hook simulating a concurrent update (e.g. a refetch or
          another tab's action) that removes 'b' from local state while its
          detail panel is still open with a stale reference — this is what
          makes `gens.findIndex(g => g.id === gen.id)` return -1 inside
          `deleteProject` when the user then confirms the delete. */}
      <button onClick={() => setGens(prev => prev.filter(g => g.id !== 'b'))}>simulate-race</button>
    </>
  );
}

describe('GenProjectsPage — Undo re-insert with a -1 originalIndex (review round 2 N5)', () => {
  it('appends the restored gen at the end instead of inserting it before the last element', async () => {
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url === '/gens/b/restore') return Promise.resolve({ data: { ...genB } });
      return Promise.resolve({ data: {} });
    });
    render(<ConfirmProvider><Harness/></ConfirmProvider>);

    expect(screen.getByTestId('gen-order').textContent).toBe('a,b,c');

    fireEvent.click(screen.getByText('Bob Brown'));

    // Simulate 'b' having already been removed from local state (e.g. a
    // concurrent refetch) BEFORE the user clicks Delete — the detail panel
    // still shows it (it holds its own copy of the Gen), but `gens` no
    // longer contains it, so `deleteProject`'s `gens.findIndex(...)` (read
    // fresh at click time, from the render this "Delete Project" click is
    // bound to) will come back -1.
    fireEvent.click(screen.getByText('simulate-race'));
    expect(screen.getByTestId('gen-order').textContent).toBe('a,c');

    fireEvent.click(screen.getByText('Delete Project'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Delete'));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/gens/b'));

    fireEvent.click(await screen.findByText('Undo'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/gens/b/restore'));

    // Fixed: appended after 'c'. Buggy `splice(-1, 0, x)` would instead
    // insert BEFORE 'c' (the array's last element), giving 'a,b,c'.
    await waitFor(() => expect(screen.getByTestId('gen-order').textContent).toBe('a,c,b'));
  });
});
