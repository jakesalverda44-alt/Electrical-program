// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import LeadSiteSurvey from './LeadSiteSurvey';
import { Lead } from '../../types';

afterEach(() => {
  cleanup();
  patch.mockReset();
  get.mockReset();
});

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

  it('(f) Build Proposal does not fire the callback and shows an error when the final save fails', async () => {
    const { onBuildProposal } = setup();
    fireEvent.click(screen.getByText('New Install'));
    await clickNextTimes(8); // -> Finish
    await waitFor(() => expect(screen.getByText('Build Proposal from Survey')).toBeTruthy());

    patch.mockRejectedValueOnce(new Error('network error'));
    fireEvent.click(screen.getByText('Build Proposal from Survey'));

    await waitFor(() => expect(screen.getByText(/Couldn't save your answers/i)).toBeTruthy());
    expect(onBuildProposal).not.toHaveBeenCalled();
  });

  it('(g) Save & Close stays open and shows an error when unsaved answers fail to persist', async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByText('New Install'));
    await clickNextTimes(7); // Job Type -> ... -> Notes (index 7), all still saving fine

    // Every save from here on fails — including the fire-and-forget step-change save
    // that fires when leaving Notes, so the wizard reaches Finish still carrying an
    // unsaved edit.
    patch.mockRejectedValue(new Error('network error'));
    fireEvent.change(screen.getByPlaceholderText(/anything else worth noting/i), {
      target: { value: 'ladder access only' },
    });
    await new Promise(r => setTimeout(r, 0));
    fireEvent.click(screen.getByText('Next')); // Notes -> Finish (best-effort save fails silently)
    await new Promise(r => setTimeout(r, 0));

    await waitFor(() => expect(screen.getByText('Save & Close')).toBeTruthy());
    fireEvent.click(screen.getByText('Save & Close'));

    await waitFor(() => expect(screen.getByText(/Couldn't save your answers/i)).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('(h) does not PATCH on close when nothing changed since the last successful save', async () => {
    const { onClose } = setup();
    const closeBtn = document.querySelector('.drawer .close-x') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patch).not.toHaveBeenCalled();
  });

  it('(i) does not re-PATCH on step change once an answer has already been saved', async () => {
    setup();
    fireEvent.click(screen.getByText('New Install'));
    fireEvent.click(screen.getByText('Next')); // Job Type -> Unit; saves { jobType: 'new-install' }
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Next')); // Unit -> Fuel; no new answers since the last save
    await new Promise(r => setTimeout(r, 0));
    expect(patch).toHaveBeenCalledTimes(1);
  });
});
