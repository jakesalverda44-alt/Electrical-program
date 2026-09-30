// @vitest-environment happy-dom
// UI cleanup round 1 — six steps: RFIs on their own step, the scope list only
// on Scope (with a pre-run hint on Takeoff), Scope done needs a takeoff.
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import PcWorkspaceView from './PcWorkspace';
import { blankWorkspace, PcWorkspace } from './constants';
import { Bid } from '../../types';

afterEach(cleanup);
beforeAll(() => import('../estimating/EstimatingWorkspace'));

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
  id: 'b1', name: 'Circle K #4521', loc: '1234 Main St', gc: 'ABC Construction', due: '', due_days: 0, amount: null,
  sheets: 0, contact: 'gc@example.com', stage: 'due', salesperson_name: '',
};

function baseMocks(aiResults: Record<string, unknown> = {}) {
  get.mockImplementation((url: string) => {
    if (url === `/preconstruction/${bid.id}/results`) return Promise.resolve({ data: aiResults });
    if (url === '/preconstruction/costs') return Promise.resolve({ data: [] });
    if (url === `/preconstruction/${bid.id}/takeoff`) return Promise.resolve({ data: null });
    if (url === `/preconstruction/intelligence/${bid.id}`) return Promise.resolve({ data: null });
    if (url === '/estimates/unit-costs') return Promise.resolve({ data: { global: {}, by_project_type: {} } });
    if (url === `/estimates/${bid.id}`) return Promise.resolve({ data: null });
    if (url === '/documents') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: null });
  });
  post.mockResolvedValue({ data: {} });
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
}

function Harness({ initial }: { initial: Partial<PcWorkspace> }) {
  const [ws, setWs] = useState<PcWorkspace>({ ...blankWorkspace('b1', 'Circle K #4521', 0), ...initial });
  return (
    <PcWorkspaceView ws={ws} bid={bid} onUpdate={setWs} onBack={() => {}} onConverted={() => {}}
      onBidUpdated={() => {}} showToast={() => {}} embedded />
  );
}

describe('step order (round 1)', () => {
  it('RFIs is step 4 on its own screen', async () => {
    baseMocks({});
    render(<Harness initial={{ activeTab: 'rfis' }}/>);
    await waitFor(() => expect(screen.getByTestId('est-work').textContent).toContain('4 · RFIs'));
  });

  it('Scope is step 3 and carries the scope list', async () => {
    baseMocks({});
    render(<Harness initial={{ activeTab: 'scope' }}/>);
    await waitFor(() => expect(screen.getByTestId('est-work').textContent).toContain('3 · Scope'));
    expect(await screen.findByTestId('scope-list')).toBeTruthy();
  });

  it('Takeoff has no scope list but a pre-run hint whose link opens Scope', async () => {
    baseMocks({});
    render(<Harness initial={{ activeTab: 'takeoff' }}/>);
    await screen.findByTestId('takeoff-scope-list-hint');
    expect(screen.queryByTestId('scope-list')).toBeNull();
    fireEvent.click(screen.getByTestId('takeoff-scope-list-link'));
    await waitFor(() => expect(screen.getByTestId('est-work').textContent).toContain('3 · Scope'));
  });

  it('the rail lists the six steps in order', async () => {
    baseMocks({});
    render(<Harness initial={{ activeTab: 'files' }}/>);
    await screen.findByTestId('est-rail');
    const text = screen.getByTestId('est-rail').textContent!;
    const labels = ['Documents', 'Takeoff', 'Scope', 'RFIs', 'Labor & Pricing', 'Review & Proposal'];
    const idx = labels.map(l => text.indexOf(l));
    idx.forEach((i, n) => { expect(i).toBeGreaterThan(-1); if (n) expect(i).toBeGreaterThan(idx[n - 1]); });
  });

  it('scope text alone does not make Scope done without a takeoff', async () => {
    baseMocks({});
    render(<Harness initial={{ activeTab: 'files', scope: { A: 'x' } }}/>);
    const step = (await screen.findAllByTestId('est-step-scope'))[0];
    expect(step.className).not.toContain('done');
  });

  it('the proposal notice jumps to Takeoff', async () => {
    baseMocks({});
    render(<Harness initial={{ activeTab: 'proposal' }}/>);
    fireEvent.click(await screen.findByTestId('proposal-go-takeoff'));
    await waitFor(() => expect(screen.getByTestId('est-work').textContent).toContain('2 · Takeoff'));
  });

  it('Next: RFIs from Scope lands on the RFIs step', async () => {
    baseMocks({});
    render(<Harness initial={{ activeTab: 'scope' }}/>);
    fireEvent.click(await screen.findByText('Next: RFIs'));
    await waitFor(() => expect(screen.getByTestId('est-work').textContent).toContain('4 · RFIs'));
  });
});
