// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import LeadSiteSurvey from './LeadSiteSurvey';
import { Lead } from '../../types';

afterEach(cleanup);

const get = vi.fn();
const patch = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    patch: (...a: unknown[]) => patch(...a),
    post: vi.fn(),
  },
}));

const baseLead: Lead = {
  id: 'lead-1',
  name: 'Jane Doe',
  source: 'kohler',
  contact_method: 'phone',
  interest_level: 'warm',
  stage: 'site-scheduled',
};

function setup(lead: Lead = baseLead) {
  get.mockResolvedValue({ data: [] }); // RecordFiles' /documents fetch on the Photos step
  patch.mockImplementation((_url: string, body: unknown) =>
    Promise.resolve({ data: { ...lead, ...(body as object) } }),
  );
  const onUpdated = vi.fn();
  const onBuildProposal = vi.fn();
  const onClose = vi.fn();
  render(
    <LeadSiteSurvey lead={lead} onUpdated={onUpdated} onBuildProposal={onBuildProposal} onClose={onClose} />,
  );
  return { onUpdated, onBuildProposal, onClose };
}

// Advances through every visible step by clicking "Next", yielding a tick between
// clicks so any in-flight async work (RecordFiles' /documents fetch, autosave) settles
// before the next navigation — avoids flaky "update on unmounted component" noise.
async function clickNextTimes(n: number) {
  for (let i = 0; i < n; i++) {
    fireEvent.click(screen.getByText('Next'));
    await new Promise(r => setTimeout(r, 0));
  }
}

describe('LeadSiteSurvey', () => {
  it('(a) renders step 1 with New Install / Swap-Out options', () => {
    setup();
    expect(screen.getByText('New Install')).toBeTruthy();
    expect(screen.getByText('Swap-Out')).toBeTruthy();
  });

  it('(b) swap-out shows the swap-out step; new-install skips it', async () => {
    // Branch 1: swap-out — the swap-out step appears after Placement.
    setup();
    fireEvent.click(screen.getByText('Swap-Out'));
    await clickNextTimes(4); // Job Type -> Unit -> Fuel -> Placement -> Swap-Out Details
    await waitFor(() =>
      expect(screen.getByText('Gas Line Disconnect & Reconnect Needed?')).toBeTruthy(),
    );
    cleanup();

    // Branch 2: new-install — the swap-out step is skipped entirely.
    setup();
    fireEvent.click(screen.getByText('New Install'));
    await clickNextTimes(4); // Job Type -> Unit -> Fuel -> Placement -> Access (skips swap-out)
    await waitFor(() => expect(screen.getByText('Lift Required')).toBeTruthy());
    expect(screen.queryByText('Gas Line Disconnect & Reconnect Needed?')).toBeNull();
  });

  it('(c) PATCH called with accumulated survey_data on step change', async () => {
    setup();
    fireEvent.click(screen.getByText('New Install'));
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith('/leads/lead-1', { survey_data: { jobType: 'new-install' } });
    });
  });

  it('(d) "Needs sizing" hides the size picker', async () => {
    setup();
    await clickNextTimes(1); // Job Type -> Unit
    fireEvent.click(screen.getByText('Kohler'));
    fireEvent.click(screen.getByText('Air-Cooled'));
    await waitFor(() => expect(screen.getByText('20KW')).toBeTruthy());
    fireEvent.click(screen.getByText('Needs Sizing'));
    await waitFor(() => expect(screen.queryByText('20KW')).toBeNull());
  });

  it("(e) finish step's Build Proposal button fires the callback", async () => {
    const { onBuildProposal } = setup();
    fireEvent.click(screen.getByText('New Install'));
    // Visible steps for new-install: Job Type, Unit, Fuel, Placement, Access, Extras,
    // Photos, Notes = 8 — 8 "Next" clicks lands on the Finish screen.
    await clickNextTimes(8);
    await waitFor(() => expect(screen.getByText('Build Proposal from Survey')).toBeTruthy());
    fireEvent.click(screen.getByText('Build Proposal from Survey'));
    await waitFor(() => expect(onBuildProposal).toHaveBeenCalled());
  });
});
