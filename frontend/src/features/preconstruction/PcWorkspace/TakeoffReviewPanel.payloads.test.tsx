// @vitest-environment happy-dom
// UI cleanup round 2A, Task 0 — payload parity. Each case drives the panel's
// UI to one answer and asserts the EXACT request body (toStrictEqual, so a
// stray `undefined` key fails) against the frozen bodies in
// review/payloadCases.ts. The drivers are the only thing that changes when
// the UI is rebuilt; the expected bodies never do.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ConfirmProvider } from '../../../components/ConfirmDialog';

const post = vi.fn();
const get = vi.fn();
const put = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } };
});

import TakeoffReviewPanel, { type TakeoffReview } from './TakeoffReviewPanel';
import { CASES, REOPEN, GROUP_ID } from './review/payloadCases';

afterEach(cleanup);
beforeEach(() => { post.mockReset(); get.mockReset(); put.mockReset(); get.mockResolvedValue({ data: {} }); });

const RESOLVE_URL = '/preconstruction/b1/review/resolve';
const row = (id: string) => within(screen.getByTestId(`review-item-${id}`));
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const mid = (key: string) => `${GROUP_ID}::${key}`;
const dialogConfirm = async () => {
  await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
  fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Confirm'));
};

type Driver = () => void | Promise<void>;
const DRIVERS: Record<string, Driver> = {
  zeroCount: () => { type(row('count:G').getByLabelText('Count for Type G — 6 in LED downlight'), '11'); fireEvent.click(row('count:G').getByText('Save count')); },
  zeroMarkers: () => { fireEvent.click(row('count:G').getByText('Use confirmed markers')); },
  zeroNotOnJob: () => { type(row('count:OS').getByLabelText('Why Type OS — Ceiling occupancy sensor is not on this job'), 'No sensors on this prototype'); fireEvent.click(row('count:OS').getByText('Not on this job')); },
  headsCount: () => { type(row('count:S1:heads').getByLabelText('Count for Type S1 — fixture heads'), '4'); fireEvent.click(row('count:S1:heads').getByText('Save count')); },
  coverageConfirm: () => { type(row('coverage:SL').getByLabelText(/^Why /), 'Checked E-1 by hand: 9 poles'); fireEvent.click(row('coverage:SL').getByText('Confirm 9')); },
  recountCount: () => { type(row('recount:A').getByLabelText(/^Count for /), '68'); fireEvent.click(row('recount:A').getByText('Save count')); },
  areaAnswer: () => { fireEvent.click(row('area:A').getByLabelText('Different areas — sum 75')); fireEvent.click(row('area:A').getByText('Save answer')); },
  areaCount: () => { type(row('area:A').getByLabelText(/^Count for /), '60'); fireEvent.click(row('area:A').getByText('Save count')); },
  areaBulkSum: () => { fireEvent.click(screen.getByTestId('group-area-sum-area:E-2 / E-2.1')); },
  areaBulkKeep: () => { fireEvent.click(screen.getByTestId('group-area-keep-area:E-2 / E-2.1')); },
  scopeAnswer: () => { fireEvent.click(row('scope:power_poles').getByLabelText('GC')); fireEvent.click(row('scope:power_poles').getByText('Save answer')); },
  scopeSuggested: () => { fireEvent.click(row('scope:power_poles:furnish').getByText('Save answer')); },
  scopeBulkAccept: () => { fireEvent.click(screen.getByTestId('group-scope-accept')); },
  reuseAnswer: () => { fireEvent.click(row('reuse:PANEL').getByLabelText('New install — the old one is removed')); fireEvent.click(row('reuse:PANEL').getByText('Save answer')); },
  demosuggestAnswer: () => { fireEvent.click(row('demosuggest:LIGHT').getByLabelText('Keep all 11 — every one shown is removed')); fireEvent.click(row('demosuggest:LIGHT').getByText('Save answer')); },
  demosuggestZero: () => { type(row('demosuggest:LIGHT').getByLabelText(/^Count for /), '0'); fireEvent.click(row('demosuggest:LIGHT').getByText('Save count')); },
  reclassifiedRestore: () => { fireEvent.click(row('statuscrop:reclassified').getByLabelText('Restore — count them as new, as the tile pass read them')); fireEvent.click(row('statuscrop:reclassified').getByText('Save answer')); },
  assignAtAnswer: () => { fireEvent.click(row('typicalassignat:PP-1..6:SIMPLEX').getByLabelText('The same outlet as the power pole package (−2)')); fireEvent.click(row('typicalassignat:PP-1..6:SIMPLEX').getByText('Save answer')); },
  conventionAnswer: () => { fireEvent.click(row('remodel:conventions').getByLabelText('All devices on these plans are new — count everything')); fireEvent.click(row('remodel:conventions').getByText('Save answer')); },
  unlistedCount: () => { type(row('unlisted:H').getByLabelText(/Count for Type H/), '13'); type(row('unlisted:H').getByPlaceholderText(/What is it\?/), '4ft LED strip, surface mounted'); fireEvent.click(row('unlisted:H').getByText('Save count')); },
  unlistedSameAs: () => { fireEvent.click(row('unlisted:H').getByLabelText('Same as Type A')); fireEvent.click(row('unlisted:H').getByText('Save answer')); },
  unlistedNotOnJob: () => { type(row('unlisted:H').getByPlaceholderText(/What is it\?/), 'Title block tag, not a fixture'); fireEvent.click(row('unlisted:H').getByText('Not on this job')); },
  legendMemberCount: () => { type(screen.getByTestId(`groupmember-qty-${mid('OS')}`), '6'); fireEvent.click(screen.getByTestId(`groupmember-count-${mid('OS')}`)); },
  legendMemberNoj: () => { type(screen.getByTestId(`groupmember-reason-input-${mid('MS')}`), 'Design-build scope, not this job'); fireEvent.click(screen.getByTestId(`groupmember-noj-${mid('MS')}`)); },
  legendAllRemaining: async () => { type(screen.getByTestId(`group-noj-all-reason-${GROUP_ID}`), 'Design-build scope, not this job'); fireEvent.click(screen.getByTestId(`group-noj-all-button-${GROUP_ID}`)); await dialogConfirm(); },
  gapfillMarkers: () => { fireEvent.click(screen.getByTestId('reconcilemember-markers-gapfill:GFCI::GFCI')); },
  gapfillReject: () => { type(screen.getByTestId('reconcilemember-reason-input-gapfill:GFCI::GFCI'), 'Suggested marks are dimension ticks, not GFCI receptacles'); fireEvent.click(screen.getByTestId('reconcilemember-reject-gapfill:GFCI::GFCI')); },
  reconcileCount: () => { type(screen.getByTestId('reconcilemember-qty-reconcile:S1+S2::S1'), '3'); fireEvent.click(screen.getByTestId('reconcilemember-count-reconcile:S1+S2::S1')); },
  needsHeads: () => { type(screen.getByTestId('reconcilemember-needs-qty-gapfill:S2::S2'), '3'); fireEvent.click(screen.getByTestId('reconcilemember-needs-save-gapfill:S2::S2')); },
  assignCount: () => { type(screen.getByTestId('reconcilemember-qty-typicalassign:PP-1..6::#1 Office power pole'), '1'); fireEvent.click(screen.getByTestId('reconcilemember-count-typicalassign:PP-1..6::#1 Office power pole')); },
  assignNone: () => { type(screen.getByTestId('reconcilemember-reason-input-typicalassign:PP-1..6::#4 Tester power pole'), 'No tester pole on this job'); fireEvent.click(screen.getByTestId('reconcilemember-reject-typicalassign:PP-1..6::#4 Tester power pole')); },
  confirmOnly: () => { type(row('counting:not_run').getByLabelText(/Why you confirm/), 'Checked E-3 by hand: 40 troffers'); fireEvent.click(row('counting:not_run').getByRole('button', { name: 'Confirm' })); },
  zeroBulkNoj: async () => { type(screen.getByTestId('group-reason-zero'), 'Not in this remodel scope'); fireEvent.click(screen.getByTestId('group-noj-zero')); await dialogConfirm(); },
  sheetsBulkConfirm: async () => { type(screen.getByTestId('group-reason-sheets'), 'Both are title sheets only'); fireEvent.click(screen.getByTestId('group-confirm-sheets')); await dialogConfirm(); },
  multiSelect: async () => {
    fireEvent.click(screen.getByLabelText('Select Type G — 6 in LED downlight'));
    fireEvent.click(screen.getByLabelText('Select Type OS — Ceiling occupancy sensor'));
    type(screen.getByLabelText('Why the selected types are not on this job'), 'Generic legend');
    fireEvent.click(screen.getByText('Mark selected not on this job'));
    await dialogConfirm();
  },
};

function renderCase(key: string) {
  const review: TakeoffReview = { status: 'needs_review', items: CASES[key].items };
  post.mockResolvedValue({ data: { status: 'needs_review', items: [] } });
  render(<ConfirmProvider><TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={review} /></ConfirmProvider>);
}

describe('payload parity — every answer the review UI can send', () => {
  it('has a driver for every frozen case and nothing extra', () => {
    expect(Object.keys(DRIVERS).sort()).toEqual(Object.keys(CASES).sort());
  });

  for (const key of Object.keys(CASES)) {
    it(`${key}`, async () => {
      renderCase(key);
      await DRIVERS[key]();
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      expect(post.mock.calls[0][0]).toBe(RESOLVE_URL);
      expect(post.mock.calls[0][1]).toStrictEqual(CASES[key].expected);
      expect(put).not.toHaveBeenCalled();
    });
  }

  it('reopen posts the item id to /review/reopen', async () => {
    post.mockResolvedValue({ data: { status: 'needs_review', items: [] } });
    const review: TakeoffReview = { status: 'clear', items: [{ id: 'count:G', kind: 'count', title: 'Type G', detail: '', resolution: { action: 'count', qty: 3, by: 'Jake', at: 't' } }] };
    render(<TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={review} />);
    fireEvent.click(screen.getByText('Reopen'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe(REOPEN.url);
    expect(post.mock.calls[0][1]).toStrictEqual(REOPEN.body);
  });

  it('count types PUT { types } to /count-types', async () => {
    put.mockResolvedValue({ data: {} });
    const review: TakeoffReview = { status: 'needs_review', items: CASES.confirmOnly.items };
    render(<TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={review} />);
    fireEvent.change(screen.getByLabelText(/Or enter the fixture types/), { target: { value: 'A — 2x4 LED troffer\nS1: LED area light on pole' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save types' }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0][0]).toBe('/preconstruction/b1/count-types');
    expect(put.mock.calls[0][1]).toStrictEqual({ types: [
      { type: 'A', description: '2x4 LED troffer', location: 'interior' },
      { type: 'S1', description: 'LED area light on pole', location: 'site' },
    ] });
    expect(post).not.toHaveBeenCalled();
  });
});
