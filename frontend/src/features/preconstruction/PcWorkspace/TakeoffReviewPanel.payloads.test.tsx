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
import { CASES, NEW_UI_ONLY, REOPEN, GROUP_ID } from './review/payloadCases';

afterEach(cleanup);
beforeEach(() => { post.mockReset(); get.mockReset(); put.mockReset(); get.mockResolvedValue({ data: {} }); });

const RESOLVE_URL = '/preconstruction/b1/review/resolve';
const row = (id: string) => within(screen.getByTestId(`review-item-${id}`));
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const mid = (key: string) => `${GROUP_ID}::${key}`;
const click = (el: HTMLElement) => fireEvent.click(el);
const btn = (r: ReturnType<typeof row>, name: string | RegExp) => r.getByRole('button', { name });
/** Open a card's "Why?" picker from its trigger, type a reason, save it. */
const viaPicker = (id: string, trigger: string | RegExp, label: string | RegExp, text: string) => {
  const r = row(id);
  click(btn(r, trigger));
  type(r.getByLabelText(label), text);
  click(btn(r, 'Save reason'));
};
/** Open a card's picker and click a ready-made reason. */
const viaPreset = (id: string, trigger: string | RegExp, preset: string) => {
  const r = row(id);
  click(btn(r, trigger));
  click(btn(r, preset));
};
const dialogConfirm = async () => {
  await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
  fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Confirm'));
};

type Driver = () => void | Promise<void>;
const DRIVERS: Record<string, Driver> = {
  zeroCount: () => { type(row('count:G').getByLabelText('Count for Type G — 6 in LED downlight'), '11'); fireEvent.click(row('count:G').getByText('Save count')); },
  zeroMarkers: () => { fireEvent.click(row('count:G').getByText('Use confirmed markers')); },
  zeroNotOnJob: () => viaPicker('count:OS', 'Not on this job', 'Why Type OS — Ceiling occupancy sensor is not on this job', 'No sensors on this prototype'),
  headsCount: () => { type(row('count:S1:heads').getByLabelText('Count for Type S1 — fixture heads'), '4'); fireEvent.click(row('count:S1:heads').getByText('Save count')); },
  coverageConfirm: () => viaPicker('coverage:SL', 'Confirm AI count 9', /^Why you confirm/, 'Checked E-1 by hand: 9 poles'),
  recountCount: () => { type(row('recount:A').getByLabelText(/^Count for /), '68'); fireEvent.click(row('recount:A').getByText('Save count')); },
  areaAnswer: () => { click(btn(row('area:A'), 'Different areas — add them (75)')); },
  areaCount: () => { type(row('area:A').getByLabelText(/^Count for /), '60'); fireEvent.click(row('area:A').getByText('Save count')); },
  areaBulkSum: () => { fireEvent.click(screen.getByTestId('group-area-sum-area:E-2 / E-2.1')); },
  areaBulkKeep: () => { fireEvent.click(screen.getByTestId('group-area-keep-area:E-2 / E-2.1')); },
  scopeAnswer: () => { click(btn(row('scope:power_poles'), 'GC')); },
  scopeSuggested: () => { click(btn(row('scope:power_poles:furnish'), /^APT/)); },
  scopeBulkAccept: () => { fireEvent.click(screen.getByTestId('group-scope-accept')); },
  reuseAnswer: () => { click(btn(row('reuse:PANEL'), /^New install/)); },
  demosuggestAnswer: () => { click(btn(row('demosuggest:LIGHT'), 'Keep all 11 — every one shown is removed')); },
  demosuggestZero: () => { type(row('demosuggest:LIGHT').getByLabelText(/^Count for /), '0'); fireEvent.click(row('demosuggest:LIGHT').getByText('Save count')); },
  reclassifiedRestore: () => { click(btn(row('statuscrop:reclassified'), /^Restore/)); },
  assignAtAnswer: () => { click(btn(row('typicalassignat:PP-1..6:SIMPLEX'), /^The same outlet/)); },
  conventionAnswer: () => { click(btn(row('remodel:conventions'), /^All devices on these plans are new/)); },
  unlistedCount: () => { type(row('unlisted:H').getByLabelText(/Count for Type H/), '13'); type(row('unlisted:H').getByPlaceholderText(/What is it\?/), '4ft LED strip, surface mounted'); fireEvent.click(row('unlisted:H').getByText('Save count')); },
  unlistedSameAs: () => { type(row('unlisted:H').getByLabelText('Same as which type?'), 'Same as Type A'); click(screen.getByTestId('unlisted-same-save-unlisted:H')); },
  unlistedNotOnJob: () => viaPicker('unlisted:H', 'Not on this job', /^Why /, 'Title block tag, not a fixture'),
  legendMemberCount: () => { type(screen.getByTestId(`groupmember-qty-${mid('OS')}`), '6'); fireEvent.click(screen.getByTestId(`groupmember-count-${mid('OS')}`)); },
  legendMemberNoj: () => { click(screen.getByTestId(`groupmember-noj-${mid('MS')}`)); type(screen.getByTestId(`groupmember-reason-input-${mid('MS')}`), 'Design-build scope, not this job'); click(screen.getByTestId(`groupmember-noj-${mid('MS')}-save`)); },
  legendAllRemaining: async () => { type(screen.getByTestId(`group-noj-all-reason-${GROUP_ID}`), 'Design-build scope, not this job'); fireEvent.click(screen.getByTestId(`group-noj-all-button-${GROUP_ID}`)); await dialogConfirm(); },
  gapfillMarkers: () => { fireEvent.click(screen.getByTestId('reconcilemember-markers-gapfill:GFCI::GFCI')); },
  gapfillReject: () => { click(screen.getByTestId('reconcilemember-reject-gapfill:GFCI::GFCI')); type(screen.getByTestId('reconcilemember-reason-input-gapfill:GFCI::GFCI'), 'Suggested marks are dimension ticks, not GFCI receptacles'); click(screen.getByTestId('reconcilemember-reject-gapfill:GFCI::GFCI-save')); },
  reconcileCount: () => { type(screen.getByTestId('reconcilemember-qty-reconcile:S1+S2::S1'), '3'); fireEvent.click(screen.getByTestId('reconcilemember-count-reconcile:S1+S2::S1')); },
  needsHeads: () => { type(screen.getByTestId('reconcilemember-needs-qty-gapfill:S2::S2'), '3'); fireEvent.click(screen.getByTestId('reconcilemember-needs-save-gapfill:S2::S2')); },
  assignCount: () => { type(screen.getByTestId('assign-qty-typicalassign:PP-1..6::#1 Office power pole'), '1'); click(screen.getByTestId('assign-save-typicalassign:PP-1..6::#1 Office power pole')); },
  assignNone: () => { click(screen.getByTestId('assign-none-typicalassign:PP-1..6::#4 Tester power pole')); type(screen.getByTestId('assign-reason-input-typicalassign:PP-1..6::#4 Tester power pole'), 'No tester pole on this job'); click(screen.getByTestId('assign-none-typicalassign:PP-1..6::#4 Tester power pole-save')); },
  confirmOnly: () => viaPicker('counting:not_run', 'Confirm', /Why you confirm/, 'Checked E-3 by hand: 40 troffers'),
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

  for (const [key, drive] of Object.entries({
    zeroNotOnJobPreset: () => viaPreset('count:OS', 'Not on this job', 'Not shown on the plans for this job'),
    coverageConfirmPreset: () => viaPreset('coverage:SL', 'Confirm AI count 9', 'Checked on the plans — 9 is right'),
    gapfillRejectPreset: () => { click(screen.getByTestId('reconcilemember-reject-gapfill:GFCI::GFCI')); click(within(screen.getByTestId('review-reconcilemember-gapfill:GFCI::GFCI')).getByRole('button', { name: 'Checked the plans — keep the current count' })); },
    coverageMarkers: () => { click(btn(row('coverage:SL'), 'Use confirmed markers')); },
    coverageNotOnJob: () => viaPicker('coverage:SL', 'Not on this job', /^Why /, 'Counted on all three site sheets already'),
    recountConfirm: () => viaPicker('recount:A', /^Confirm AI count/, /^Why you confirm/, 'Recount missed a sheet, 70 is right'),
    needsPoles: () => { type(screen.getByTestId('reconcilemember-needs-qty-gapfill:S3::S3'), '2'); click(screen.getByTestId('reconcilemember-needs-save-gapfill:S3::S3')); },
    countingTypedOnly: () => {
      const r = row('counting:not_run');
      click(btn(r, 'Confirm'));
      expect(r.queryAllByRole('button').filter(b => b.className.includes('tr-reason-preset'))).toHaveLength(0);
      type(r.getByLabelText(/^Why you confirm/), 'Checked E-3 by hand: 40 troffers');
      click(btn(r, 'Save reason'));
    },
    equipmentNoPresets: () => {
      const r = row('count:MB');
      click(btn(r, 'Not on this job'));
      // Equipment: typed reason only — no ready-made reasons are offered.
      expect(r.queryByRole('button', { name: /Not shown on the plans/ })).toBeNull();
      expect(r.getByText('This one needs a typed reason.')).toBeTruthy();
      expect(screen.queryByLabelText('Select Type MB — Meter base')).toBeNull();
      type(r.getByLabelText('Why Type MB — Meter base is not on this job'), 'Design-build scope, not this job');
      click(btn(r, 'Save reason'));
    },
  } as Record<string, Driver>)) {
    it(`NEW_UI_ONLY ${key}`, async () => {
      const c = NEW_UI_ONLY[key];
      post.mockResolvedValue({ data: { status: 'needs_review', items: [] } });
      render(<ConfirmProvider><TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items: c.items }} /></ConfirmProvider>);
      await drive();
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      expect(post.mock.calls[0][0]).toBe(RESOLVE_URL);
      expect(post.mock.calls[0][1]).toStrictEqual(c.expected);
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
