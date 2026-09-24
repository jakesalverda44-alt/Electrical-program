// @vitest-environment happy-dom
// Takeoff accuracy Task 12 — the pre-bid package panel's draft states.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } };
});

import PrebidPackagePanel from './PrebidPackagePanel';
import type { Bid } from '../../../types';

afterEach(cleanup);
beforeEach(() => { get.mockReset(); post.mockReset(); });

const bid = { id: 'b1', name: 'AZ' } as Bid;
function setup(aiResults: Record<string, unknown>) {
  const setAiResults = vi.fn();
  const generate = vi.fn();
  render(<PrebidPackagePanel bid={bid} aiResults={aiResults} setAiResults={setAiResults} generatePrebidPackage={generate}
    prebidBusy={false} prebidResult={null} downloadFiledDocument={vi.fn()} emailPrebidToChris={vi.fn()} chrisDraftBusy={false} chrisDraftLink={null} showToast={vi.fn()} />);
  return { setAiResults, generate };
}

describe('PrebidPackagePanel', () => {
  it('hidden until the analysis is done', () => {
    setup({ status: 'agent2_running' });
    expect(screen.queryByTestId('prebid-package')).toBeNull();
  });
  it('waits on the takeoff review; the button is disabled', () => {
    setup({ status: 'complete', review_status: 'needs_review' });
    expect(screen.getByTestId('prebid-waiting-review')).toBeTruthy();
    expect((screen.getByText(/Generate Pre-Bid Package/).closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
  it('ready once the draft is complete — no Agent 4 run needed', () => {
    const { generate } = setup({ status: 'complete', review_status: 'clear', draft_status: 'complete', draft_output: '{}' });
    fireEvent.click(screen.getByText(/Generate Pre-Bid Package/));
    expect(generate).toHaveBeenCalled();
  });
  it('a failed draft shows why and offers to compose it again', async () => {
    post.mockResolvedValue({ data: { status: 'running' } });
    const { setAiResults } = setup({ status: 'complete', review_status: 'clear', draft_status: 'error', draft_error: 'Agent 4 (pre-bid draft) ran out of room' });
    expect(screen.getByTestId('prebid-draft-error').textContent).toContain('ran out of room');
    fireEvent.click(screen.getByText('Compose the draft again'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/compose-draft'));
    expect(setAiResults).toHaveBeenCalledWith(expect.objectContaining({ draft_status: 'running' }));
  });
  it('S12 — an out-of-date draft is never used: the package waits, "Compose the draft again" is offered', () => {
    setup({ status: "complete", review_status: "clear", draft_status: "complete", draft_output: "{}", draft_stale: true, run_id: "r1" });
    expect(screen.getByTestId('prebid-draft-stale')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Generate Pre-Bid Package/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Compose the draft again' })).toBeTruthy();
  });
});
