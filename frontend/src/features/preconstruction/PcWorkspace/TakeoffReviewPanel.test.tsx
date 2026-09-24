// @vitest-environment happy-dom
// Takeoff accuracy Task 7 — the Needs-review list in the Takeoff step.
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

import TakeoffReviewPanel, { parseCountTypes, type TakeoffReview, type ReviewItem } from './TakeoffReviewPanel';

afterEach(cleanup);
beforeEach(() => { post.mockReset(); get.mockReset(); put.mockReset(); });

const REVIEW: TakeoffReview = {
  status: 'needs_review',
  items: [
    { id: 'count:G', kind: 'count', title: 'Type G — 6 in LED downlight', detail: 'Counted 0: not found on any counted plan sheet.', aiCount: 0, sheets: [] },
    { id: 'count:OS', kind: 'count', title: 'Type OS — Ceiling occupancy sensor', detail: 'Counted 0: not found on any counted plan sheet.', aiCount: 0, sheets: [] },
    { id: 'count:S1:heads', kind: 'count', title: 'Type S1 — fixture heads', detail: '2 poles counted, but the schedule does not say how many heads each pole carries.' },
    { id: 'scope:power_poles', kind: 'scope_question', title: 'Power poles', detail: 'Who furnishes and installs the power poles? (APT / GC / Owner)', question: 'Who furnishes and installs the power poles? (APT / GC / Owner)', options: ['APT', 'GC', 'Owner'], notes: ['AI count: 8 power poles (E-2)'] },
  ],
};

function setup(review: TakeoffReview = REVIEW, countResult: React.ComponentProps<typeof TakeoffReviewPanel>['countResult'] = null, wrapper?: (children: React.ReactNode) => React.ReactElement) {
  const onReviewChange = vi.fn();
  const showToast = vi.fn();
  const el = <TakeoffReviewPanel bidId="b1" review={review} countResult={countResult} onReviewChange={onReviewChange} showToast={showToast} />;
  render(wrapper ? wrapper(el) : el);
  return { onReviewChange, showToast };
}

describe('TakeoffReviewPanel', () => {
  it('shows Needs review with the open count and every item', () => {
    setup();
    expect(screen.getByTestId('takeoff-review-status').textContent).toBe('Needs review — 4 open');
    expect(screen.getByTestId('review-item-count:G')).toBeTruthy();
    expect(screen.getByTestId('review-item-scope:power_poles').textContent).toContain('AI count: 8 power poles (E-2)');
    // Heads are not markers — no "Use confirmed markers" there.
    expect(screen.getByTestId('review-item-count:S1:heads').textContent).not.toContain('Use confirmed markers');
  });

  it('Save count POSTs the count and hands the server review back', async () => {
    const next: TakeoffReview = { status: 'needs_review', items: REVIEW.items.map(i => i.id === 'count:G' ? { ...i, resolution: { action: 'count', qty: 11, by: 'Jake', at: 't' } } : i) };
    post.mockResolvedValue({ data: next });
    const { onReviewChange } = setup();
    fireEvent.change(screen.getByLabelText('Count for Type G — 6 in LED downlight'), { target: { value: '11' } });
    fireEvent.click(screen.getAllByText('Save count')[0]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['count:G'], action: 'count', qty: 11 }));
    expect(onReviewChange).toHaveBeenCalledWith(next);
  });

  it('"Not on this job" is disabled until a reason is typed', async () => {
    post.mockResolvedValue({ data: REVIEW });
    setup();
    const btn = screen.getAllByText('Not on this job')[1] as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Why Type OS — Ceiling occupancy sensor is not on this job'), { target: { value: 'No sensors on this prototype' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['count:OS'], action: 'not_on_job', reason: 'No sensors on this prototype' }));
  });

  it('a scope question is answered from its options', async () => {
    post.mockResolvedValue({ data: REVIEW });
    setup();
    fireEvent.click(screen.getByLabelText('GC'));
    fireEvent.click(screen.getByText('Save answer'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['scope:power_poles'], action: 'answer', answer: 'GC' }));
  });

  it('bulk "Not on this job" across selected count items with one reason — behind a confirm dialog (S16)', async () => {
    post.mockResolvedValue({ data: REVIEW });
    setup(REVIEW, null, (children) => <ConfirmProvider>{children}</ConfirmProvider>);
    fireEvent.click(screen.getByLabelText('Select Type G — 6 in LED downlight'));
    fireEvent.click(screen.getByLabelText('Select Type OS — Ceiling occupancy sensor'));
    fireEvent.change(screen.getByLabelText('Why the selected types are not on this job'), { target: { value: 'Generic legend' } });
    fireEvent.click(screen.getByText('Mark selected not on this job'));
    await waitFor(() => expect(screen.getByText('Mark 2 selected not on this job?')).toBeTruthy());
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['count:G', 'count:OS'], action: 'not_on_job', reason: 'Generic legend' }));
  });

  it('a server refusal shows as an error toast, nothing changes', async () => {
    post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'No confirmed markers for this type yet — confirm or place them in the Plans view first.' } } });
    const { onReviewChange, showToast } = setup();
    fireEvent.click(screen.getAllByText('Use confirmed markers')[0]);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ variant: 'error', title: 'Could not save', sub: 'No confirmed markers for this type yet — confirm or place them in the Plans view first.' }));
    expect(onReviewChange).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('resolved items list who resolved them and can be reopened; a clear review says so', async () => {
    const clear: TakeoffReview = { status: 'clear', items: [{ id: 'count:G', kind: 'count', title: 'Type G', detail: '', resolution: { action: 'markers', qty: 10, by: 'Jake', at: 't', carriedOver: true } }] };
    post.mockResolvedValue({ data: REVIEW });
    setup(clear);
    expect(screen.getByTestId('takeoff-review-status').textContent).toBe('Takeoff review clear');
    expect(screen.getByTestId('review-resolved-count:G').textContent).toContain('10 EA — confirmed markers on the plans (Jake, from the previous run)');
    fireEvent.click(screen.getByText('Reopen'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/reopen', { itemId: 'count:G' }));
  });

  it('counting details show skipped sheets, the load check and rows removed from Agent 1', () => {
    setup(REVIEW, {
      ran: true,
      sheets: [{ label: 'E-3 "LIGHTING PLAN"', status: 'counted' }, { label: 'E-1 "SITE PLAN"', status: 'failed', error: 'the model declined to count this sheet' }],
      skippedSheets: [{ label: 'PH0.1 "PHOTOMETRIC SITE PLAN"', reason: 'photometric / lighting-calculation sheet — never counted' }],
      loadCheck: { ran: true, countedWatts: 6999, circuitVA: 5410, gapPct: -0.29, discrepancy: true },
      removedRows: [{ row: { item: 'Site lights', qty: 4, sourceSheet: 'E-7' }, reason: 'fixture row that matches no scheduled type' }],
      flags: [],
    });
    expect(screen.getByText(/Counted on E-3 · Not counted: E-1/)).toBeTruthy();
    fireEvent.click(screen.getByText('Counting details'));
    const d = screen.getByTestId('takeoff-count-details').textContent!;
    expect(d).toContain('PH0.1 "PHOTOMETRIC SITE PLAN" — photometric / lighting-calculation sheet — never counted');
    expect(d).toContain('E-1 "SITE PLAN" — the model declined to count this sheet');
    expect(d).toContain('counted fixtures 6,999 W vs lighting circuits 5,410 VA (-29%) — more than 20% apart');
    expect(d).toContain('Site lights × 4 (E-7) — fixture row that matches no scheduled type');
  });
});

describe('TakeoffReviewPanel — fix round 1', () => {
  it('B2: a "counts not verified" item is confirmed with a real reason, or the types are entered for the next run', async () => {
    const review: TakeoffReview = { status: 'needs_review', items: [
      { id: 'counting:not_run', kind: 'confirm', title: 'No fixture schedule/legend found — counts not verified', detail: 'Counting did not run: ...', actions: ['confirm'] },
    ] };
    post.mockResolvedValue({ data: { status: 'clear', items: [] } });
    put.mockResolvedValue({ data: {} });
    const { onReviewChange } = setup(review);
    const btn = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText(/Why you confirm/), { target: { value: 'short' } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Why you confirm/), { target: { value: 'Checked E-3 by hand: 40 troffers' } });
    fireEvent.click(btn);
    await waitFor(() => expect(onReviewChange).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['counting:not_run'], action: 'confirm', reason: 'Checked E-3 by hand: 40 troffers' });
    fireEvent.change(screen.getByLabelText(/Or enter the fixture types/), { target: { value: 'A — 2x4 LED troffer\nS1: LED area light on pole' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save types' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/preconstruction/b1/count-types', { types: [
      { type: 'A', description: '2x4 LED troffer', location: 'interior' },
      { type: 'S1', description: 'LED area light on pole', location: 'site' },
    ] }));
  });

  it('B4: an area question shows both numbers as its options', async () => {
    const review: TakeoffReview = { status: 'needs_review', items: [
      { id: 'area:A', kind: 'area', title: 'Type A: same area or different areas?', detail: 'E-2.1 40 / E-2.2 35 — same area (keep 40) or different areas (sum 75)?', options: ['Same area — keep 40', 'Different areas — sum 75'], actions: ['answer', 'count'] },
    ] };
    post.mockResolvedValue({ data: { status: 'clear', items: [] } });
    setup(review);
    fireEvent.click(screen.getByLabelText('Different areas — sum 75'));
    fireEvent.click(screen.getByRole('button', { name: 'Save answer' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['area:A'], action: 'answer', answer: 'Different areas — sum 75' }));
    expect(screen.queryByRole('button', { name: 'Use confirmed markers' })).toBeNull();
  });

  it('N4: an earlier answer the drawings changed is shown for re-confirmation', () => {
    setup({ status: 'needs_review', items: [
      { id: 'count:G', kind: 'count', title: 'Type G', detail: 'Counted 0', previousResolution: { action: 'count', qty: 11, by: 'Jake', at: 't' } },
    ] });
    expect(screen.getByTestId('review-previous-count:G').textContent).toContain('11 EA — entered by Jake');
  });

  it('B5: a run in progress says the proposal is blocked', () => {
    setup({ status: 'pending', items: [] });
    expect(screen.getByTestId('takeoff-review-status').textContent).toBe('Analysis running — proposal blocked until it finishes');
  });

  it('S5 / S8: a legacy bid gets the non-blocking note with its questions; the matched rule and its warning show', async () => {
    get.mockResolvedValueOnce({ data: { status: null, items: [], legacy: { message: 'Analyzed before accuracy checks — re-run analysis to enable counting and account rules.', accountRule: 'AutoZone ("AutoZone" in the brand)', questions: [{ label: 'Power poles — furnished by', question: 'Who FURNISHES the power poles?', notes: [] }] } } });
    setup({ status: null, items: [] });
    await waitFor(() => expect(screen.getByTestId('takeoff-review-legacy').textContent).toContain('Analyzed before accuracy checks'));
    expect(screen.getByTestId('takeoff-review-legacy').textContent).toContain('Who FURNISHES the power poles?');
    cleanup();
    get.mockResolvedValueOnce({ data: { status: 'clear', items: [], accountRule: { name: 'Default', matchedBy: 'default (no account rule matched)', warning: 'The bid\'s brand "Wawa" matched no account rule' } } });
    setup({ status: 'clear', items: [{ id: 'count:A', kind: 'count', title: 'A', detail: '', resolution: { action: 'count', qty: 3, by: 'J', at: 't' } }] });
    await waitFor(() => expect(screen.getByTestId('takeoff-review-rule').textContent).toContain('matched no account rule'));
  });

  it('parseCountTypes', () => {
    expect(parseCountTypes('D - LED wall pack\n\nM: 2x2 flat panel')).toEqual([
      { type: 'D', description: 'LED wall pack', location: 'exterior_building' },
      { type: 'M', description: '2x2 flat panel', location: 'interior' },
    ]);
  });
});

describe('next round A4 — Referenced sheet not in analysis', () => {
  it('offers Upload the sheet (supplement pass) and Confirm with a reason', async () => {
    const onSupplement = vi.fn(async () => {});
    render(<TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} onSupplement={onSupplement}
      review={{ status: 'needs_review', items: [{ id: 'refsheet:E9', kind: 'confirm', title: 'Referenced sheet E-9 not in analysis', detail: 'The drawing analysis found a reference to E-9 (see note 5 on E-3)…', actions: ['confirm'] }] }} />);
    expect(screen.getByTestId('review-item-refsheet:E9').textContent).toContain('Referenced sheet E-9 not in analysis');
    const file = new File([new Uint8Array(5000)], 'E-9.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('supplement-input-refsheet:E9'), { target: { files: [file] } });
    await waitFor(() => expect(onSupplement).toHaveBeenCalledWith([file]));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  });
});

describe('next round A6 — a "by G.C." note pre-fills APT', () => {
  it('APT is selected and saving sends it', async () => {
    post.mockResolvedValueOnce({ data: { status: 'clear', items: [] } });
    render(<TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null}
      review={{ status: 'needs_review', items: [{ id: 'scope:power_poles:furnish', kind: 'scope_question', title: 'Power poles — furnished by', detail: 'Who FURNISHES the power poles?', question: 'Who FURNISHES the power poles?', options: ['APT', 'GC', 'Owner', 'Vendor'], suggested: 'APT', notes: [] }] }} />);
    expect((screen.getByRole('radio', { name: 'APT' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save answer' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['scope:power_poles:furnish'], action: 'answer', answer: 'APT' }));
  });
});

describe('next round A7 — grouped by cause, bulk actions, info never blocks', () => {
  const ITEMS = [
    { id: 'count:L', kind: 'count' as const, title: 'Type L — LED wall sconce', detail: 'Counted 0: not found on any counted plan sheet.', group: 'zero' },
    { id: 'count:OS', kind: 'count' as const, title: 'Type OS — Ceiling occupancy sensor', detail: 'Counted 0: not found on any counted plan sheet.', group: 'zero' },
    { id: 'area:GFI', kind: 'area' as const, title: 'Type GFI: same area or different areas?', detail: 'E-2 "POWER PLAN" 16 / E-2.1 "SYSTEMS PLAN" 4 — same area (keep 16) or different areas (sum 20)?', options: ['Same area — keep 16', 'Different areas — sum 20'], actions: ['answer' as const, 'count' as const], group: 'area:E-2 / E-2.1' },
    { id: 'area:DUPLEX', kind: 'area' as const, title: 'Type DUPLEX: same area or different areas?', detail: 'E-2 11 / E-2.1 2', options: ['Same area — keep 11', 'Different areas — sum 13'], actions: ['answer' as const, 'count' as const], group: 'area:E-2 / E-2.1' },
    { id: 'scope:power_poles:furnish', kind: 'scope_question' as const, title: 'Power poles — furnished by', detail: 'Who FURNISHES the power poles?', options: ['APT', 'GC', 'Owner', 'Vendor'], suggested: 'APT', group: 'scope' },
    { id: 'scope:power_poles:install', kind: 'scope_question' as const, title: 'Power poles — installed by', detail: 'Who INSTALLS the power poles?', options: ['APT', 'GC', 'Owner', 'Vendor'], suggested: 'APT', group: 'scope' },
    { id: 'count:EF', kind: 'count' as const, title: 'Type EF — Exhaust fan', detail: 'Counted 0 … listed for information, not blocking.', blocking: false, group: 'info' },
  ];
  function renderGroups(wrapper?: (children: React.ReactNode) => React.ReactElement) {
    const el = <TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items: ITEMS }} />;
    render(wrapper ? wrapper(el) : el);
  }
  it('the status counts blocking items only; info is a collapsed group', () => {
    renderGroups();
    expect(screen.getByTestId('takeoff-review-status').textContent).toBe('Needs review — 6 open');
    expect(screen.getByTestId('review-group-info').tagName).toBe('DETAILS');
    expect(screen.getByTestId('review-group-info').textContent).toContain('1 for information');
    expect(screen.getByTestId('review-group-area:E-2 / E-2.1').textContent).toContain('Same area? E-2 / E-2.1 (2 types)');
  });
  it('one click answers the whole "same area?" group (each item its own option)', async () => {
    post.mockResolvedValueOnce({ data: { status: 'needs_review', items: ITEMS } });
    renderGroups();
    fireEvent.click(screen.getByTestId('group-area-sum-area:E-2 / E-2.1'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['area:GFI', 'area:DUPLEX'], action: 'answer', answerIndex: 1 }));
  });
  it('accept the pre-filled scope answers in one click', async () => {
    post.mockResolvedValueOnce({ data: { status: 'needs_review', items: ITEMS } });
    renderGroups();
    fireEvent.click(screen.getByTestId('group-scope-accept'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['scope:power_poles:furnish', 'scope:power_poles:install'], action: 'answer', useSuggested: true }));
  });
  it('mark a whole zero group not on this job with one reason — behind a confirm dialog (S16)', async () => {
    post.mockResolvedValueOnce({ data: { status: 'needs_review', items: ITEMS } });
    renderGroups((children) => <ConfirmProvider>{children}</ConfirmProvider>);
    fireEvent.change(screen.getByTestId('group-reason-zero'), { target: { value: 'Not in this remodel scope' } });
    fireEvent.click(screen.getByTestId('group-noj-zero'));
    // Fix round 3 / S16 — a bulk action now shows a confirm dialog listing
    // every member before anything is sent.
    await waitFor(() => expect(screen.getByText('Mark all 2 not on this job?')).toBeTruthy());
    const dialog = within(screen.getByRole('alertdialog'));
    expect(dialog.getByText('Type L — LED wall sconce')).toBeTruthy();
    expect(dialog.getByText('Type OS — Ceiling occupancy sensor')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['count:L', 'count:OS'], action: 'not_on_job', reason: 'Not in this remodel scope' }));
  });

  it('declining the confirm dialog (no ConfirmProvider = auto-decline) never posts', async () => {
    renderGroups();
    fireEvent.change(screen.getByTestId('group-reason-zero'), { target: { value: 'Not in this remodel scope' } });
    fireEvent.click(screen.getByTestId('group-noj-zero'));
    await waitFor(() => {}); // let the auto-declined promise settle
    expect(post).not.toHaveBeenCalled();
  });
});

describe('evidence round — enlarged-plan, typical, family and schedule groups', () => {
  it('each new cause is its own titled group; the enlarged-plan question shows both totals as options', async () => {
    setup({
      status: 'needs_review',
      items: [
        { id: 'viewport:GFCI', kind: 'area', group: 'viewport', title: 'Type GFCI — GFCI duplex receptacle: does the enlarged plan repeat the main plan?', detail: 'E-1 #3 RESTROOM POWER AND LIGHTING: 6 — where it sits on the main plan is not known. Repeats the main plan (keep 3) or adds devices (9)?', options: ['Repeats the main plan — keep 3', 'Adds devices — 9'], actions: ['answer', 'count'] },
        { id: 'typical:e2@9#3', kind: 'count', group: 'typical', title: 'Typical: Parts pod power pole — how many?', detail: '#9 POWER POLE LEGEND says each parts pod power pole carries 1 × DUPLEX RECEPTACLE / FLOOR RECEPTACLE', actions: ['count', 'not_on_job'] },
        { id: 'family:W2', kind: 'area', group: 'family', title: 'Same fixture on two schedules: W2 = L', detail: 'W2 has the same catalog number as L.', options: ['Keep L — 1', "Use W2's count — 4"], actions: ['answer'] },
        { id: 'schedule:panels-unread', kind: 'confirm', group: 'schedule', title: 'Panel schedule not read — branch circuits missing from the takeoff', detail: 'PANEL B (E-4) could not be read row by row.', actions: ['confirm'] },
      ],
    });
    expect(screen.getByText('Enlarged plans — repeat the main plan or add devices? (1)')).toBeTruthy();
    expect(screen.getByText('Typical packages — how many hosts? (1)')).toBeTruthy();
    expect(screen.getByText('Same fixture on two schedules (1)')).toBeTruthy();
    expect(screen.getByText('Schedules not read completely (1)')).toBeTruthy();
    expect(screen.getByText('Adds devices — 9')).toBeTruthy();
  });
});

describe('Fix round N8 — the UI groups items in the SAME $-risk order the backend ranks them (riskRank)', () => {
  it('zero/family/gapfill/reconcile (high $ risk) come before scope questions and spot-checks (low $ risk, informational)', () => {
    setup({
      status: 'needs_review',
      items: [
        // Listed deliberately out of risk order, so this proves the UI
        // re-sorts them rather than just preserving array order.
        { id: 'scope:power_poles', kind: 'scope_question', group: 'scope', title: 'Power poles', detail: 'q', options: ['APT', 'GC'], notes: [] },
        { id: 'spotcheck:A', kind: 'confirm', group: 'spotcheck', blocking: false, title: 'Spot-check: confirm these 5 marks — Type A (73 auto-counted)', detail: 'd', actions: ['confirm'] },
        { id: 'count:MB', kind: 'count', group: 'zero', title: 'Type MB — Meter base', detail: 'Counted 0: not found on any counted plan sheet.', aiCount: 0 },
        { id: 'family:W2', kind: 'area', group: 'family', title: 'Same fixture on two schedules: W2 = L', detail: 'd', options: ['Keep L — 1', "Use W2's count — 4"], actions: ['answer'] },
        { id: 'gapfill:GFCI', kind: 'count', group: 'gapfill', title: 'Gap-fill found 1 possible GFCI — confirm on plans', detail: 'd', actions: ['markers', 'count', 'not_on_job'] },
        { id: 'reconcile:BATT CHGR', kind: 'confirm', group: 'reconcile', title: 'BATT CHGR: PANEL B lists 5, the plans account for 3', detail: 'd', actions: ['count', 'not_on_job'] },
      ],
    });
    // Blocking groups render as <h4 class="tr-group-title">; informational
    // ones (blocking: false — spotcheck here) render as <details><summary>
    // instead, so both need selecting to see the WHOLE list in DOM order.
    const titles = Array.from(document.querySelectorAll('.tr-group-title, [data-testid^="review-group-"] > summary')).map(el => el.textContent);
    const at = (needle: string) => titles.findIndex(t => t?.includes(needle));
    expect(at('counted 0')).toBeGreaterThanOrEqual(0); // 'zero' group rendered at all
    // zero, family, gapfill, reconcile all precede scope; scope precedes
    // the informational spot-check tail — never array/server order, the
    // UI's own $-risk order (GROUP_ORDER).
    expect(at('counted 0')).toBeLessThan(at('Same fixture'));
    expect(at('Same fixture')).toBeLessThan(at('Gap-fill'));
    expect(at('Gap-fill')).toBeLessThan(at('Reconciliation'));
    expect(at('Reconciliation')).toBeLessThan(at('Scope question'));
    expect(at('Scope question')).toBeLessThan(at('Spot-check'));
  });
});

describe('Fix round B6 — a legend-zero group answers member by member, never one bulk action for the whole group', () => {
  const GROUP_ID = 'legend-zero:MS-OS-PC';
  function groupItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
    return { ...baseGroupItem(), ...overrides };
  }
  function baseGroupItem(): ReviewItem {
    return {
      id: GROUP_ID, kind: 'count' as const,
      title: '3 legend items not found on any counted sheet — answer each one',
      detail: 'Motion sensor; Occupancy sensor; Photocell.',
      actions: ['count' as const, 'markers' as const, 'not_on_job' as const],
      groupedTypes: [
        { key: 'MS', type: 'Motion sensor', description: 'Motion sensor' },
        { key: 'OS', type: 'Occupancy sensor', description: 'Occupancy sensor' },
        { key: 'PC', type: 'Photocell', description: 'Photocell' },
      ],
    };
  }
  function renderGroup(item = groupItem(), wrapper?: (children: React.ReactNode) => React.ReactElement) {
    const el = <TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items: [item] }} />;
    render(wrapper ? wrapper(el) : el);
  }

  it('never adds the group to the cross-item multi-select (no checkbox — the bottom bulk bar can\'t touch it)', () => {
    renderGroup();
    expect(screen.queryByLabelText(`Select ${groupItem().title}`)).toBeNull();
  });

  it('each member has its OWN count / not-on-job controls; answering one never posts for the others', async () => {
    post.mockResolvedValueOnce({ data: { status: 'needs_review', items: [groupItem()] } });
    renderGroup();
    // Three independent rows, one per member.
    expect(screen.getByTestId(`review-groupmember-${GROUP_ID}::MS`)).toBeTruthy();
    expect(screen.getByTestId(`review-groupmember-${GROUP_ID}::OS`)).toBeTruthy();
    expect(screen.getByTestId(`review-groupmember-${GROUP_ID}::PC`)).toBeTruthy();

    fireEvent.change(screen.getByTestId(`groupmember-reason-input-${GROUP_ID}::MS`), { target: { value: 'Design-build scope, not this job' } });
    fireEvent.click(screen.getByTestId(`groupmember-noj-${GROUP_ID}::MS`));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', {
      itemIds: [GROUP_ID], action: 'not_on_job', reason: 'Design-build scope, not this job', memberKey: 'MS',
    }));
    expect(post).toHaveBeenCalledTimes(1); // only MS — never OS or PC
  });

  it('a member answered with a count sends that member\'s own qty and memberKey', async () => {
    post.mockResolvedValueOnce({ data: { status: 'needs_review', items: [groupItem()] } });
    renderGroup();
    fireEvent.change(screen.getByTestId(`groupmember-qty-${GROUP_ID}::OS`), { target: { value: '6' } });
    fireEvent.click(screen.getByTestId(`groupmember-count-${GROUP_ID}::OS`));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', {
      itemIds: [GROUP_ID], action: 'count', qty: 6, memberKey: 'OS',
    }));
  });

  it('an already-answered member shows its resolution instead of controls', () => {
    renderGroup(groupItem({
      groupedTypes: [
        { key: 'MS', type: 'Motion sensor', description: 'Motion sensor', resolution: { action: 'not_on_job', reason: 'Design-build scope', by: 'Jake', at: 't' } },
        { key: 'OS', type: 'Occupancy sensor', description: 'Occupancy sensor' },
        { key: 'PC', type: 'Photocell', description: 'Photocell' },
      ],
    }));
    expect(screen.getByTestId(`review-groupmember-done-${GROUP_ID}::MS`).textContent).toContain('Not on this job — Design-build scope');
    expect(screen.queryByTestId(`groupmember-noj-${GROUP_ID}::MS`)).toBeNull();
    expect(screen.getByTestId(`groupmember-noj-${GROUP_ID}::OS`)).toBeTruthy();
  });

  it('"mark all remaining" only appears with 2+ unanswered, requires a reason, and is gated behind a confirm dialog listing every remaining member', async () => {
    renderGroup(groupItem({
      groupedTypes: [
        { key: 'MS', type: 'Motion sensor', description: 'Motion sensor', resolution: { action: 'not_on_job', reason: 'x', by: 'J', at: 't' } },
        { key: 'OS', type: 'Occupancy sensor', description: 'Occupancy sensor' },
        { key: 'PC', type: 'Photocell', description: 'Photocell' },
      ],
    }));
    // OS and PC remain: the shortcut is offered.
    const button = screen.getByTestId(`group-noj-all-button-${GROUP_ID}`) as HTMLButtonElement;
    expect(button.disabled).toBe(true); // no reason yet
    fireEvent.change(screen.getByTestId(`group-noj-all-reason-${GROUP_ID}`), { target: { value: 'Design-build scope, not this job' } });
    expect(button.disabled).toBe(false);
  });

  it('never posts on click alone — only after the confirm dialog is accepted; declining (no ConfirmProvider) posts nothing', async () => {
    renderGroup(groupItem({
      groupedTypes: [
        { key: 'MS', type: 'Motion sensor', description: 'Motion sensor' },
        { key: 'OS', type: 'Occupancy sensor', description: 'Occupancy sensor' },
        { key: 'PC', type: 'Photocell', description: 'Photocell' },
      ],
    }));
    fireEvent.change(screen.getByTestId(`group-noj-all-reason-${GROUP_ID}`), { target: { value: 'Design-build scope, not this job' } });
    fireEvent.click(screen.getByTestId(`group-noj-all-button-${GROUP_ID}`));
    await waitFor(() => {}); // let the auto-declined (no ConfirmProvider) promise settle
    expect(post).not.toHaveBeenCalled();
  });

  it('accepting the confirm (which lists every remaining member) resolves them all, each still getting its own recorded answer server-side (no memberKey — the "apply to all unanswered" call)', async () => {
    post.mockResolvedValueOnce({ data: { status: 'needs_review', items: [groupItem()] } });
    renderGroup(groupItem(), (children) => <ConfirmProvider>{children}</ConfirmProvider>);
    fireEvent.change(screen.getByTestId(`group-noj-all-reason-${GROUP_ID}`), { target: { value: 'Design-build scope, not this job' } });
    fireEvent.click(screen.getByTestId(`group-noj-all-button-${GROUP_ID}`));
    // The confirm dialog lists every remaining member by name before anything is sent.
    await waitFor(() => expect(screen.getByText('Mark all 3 remaining not on this job?')).toBeTruthy());
    expect(screen.getByText('Motion sensor')).toBeTruthy();
    expect(screen.getByText('Occupancy sensor')).toBeTruthy();
    expect(screen.getByText('Photocell')).toBeTruthy();
    expect(post).not.toHaveBeenCalled(); // not yet — only after Confirm is clicked
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', {
      itemIds: [GROUP_ID], action: 'not_on_job', reason: 'Design-build scope, not this job',
    }));
  });
});

describe('Fix round 3 / S16 (frontend) — equipment is never in a bulk action', () => {
  const EQUIP_ITEMS: ReviewItem[] = [
    { id: 'count:MB', kind: 'count', title: 'Type MB — Meter base', detail: 'Counted 0: not found on any counted plan sheet.', category: 'equipment', group: 'zero' },
    { id: 'count:WIREWAY', kind: 'count', title: 'Type WIREWAY — Wireway', detail: 'Counted 0: not found on any counted plan sheet.', category: 'equipment', group: 'zero' },
    { id: 'count:OS', kind: 'count', title: 'Type OS — Occupancy sensor', detail: 'Counted 0: not found on any counted plan sheet.', category: 'lighting_control', group: 'zero' },
  ];
  function renderEquip(wrapper?: (children: React.ReactNode) => React.ReactElement) {
    const el = <TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items: EQUIP_ITEMS }} />;
    render(wrapper ? wrapper(el) : el);
  }

  it('an equipment item never gets a cross-item multi-select checkbox', () => {
    renderEquip();
    expect(screen.queryByLabelText('Select Type MB — Meter base')).toBeNull();
    expect(screen.queryByLabelText('Select Type WIREWAY — Wireway')).toBeNull();
    expect(screen.getByLabelText('Select Type OS — Occupancy sensor')).toBeTruthy();
  });

  it('the group "mark all" bulk excludes equipment: only the 1 non-equipment item counts, so no bulk button renders for 1', () => {
    renderEquip();
    // nojIds excludes MB/WIREWAY, leaving just OS (1) — the bulk button
    // only renders for 2+, so it's gone entirely even though the group
    // has 3 items total.
    expect(screen.queryByTestId('group-noj-zero')).toBeNull();
    // Each equipment item still has its OWN individual "Not on this job".
    expect(screen.getByLabelText('Why Type MB — Meter base is not on this job')).toBeTruthy();
    expect(screen.getByLabelText('Why Type WIREWAY — Wireway is not on this job')).toBeTruthy();
  });

  it('the group bulk (2+ non-equipment) still shows a confirm dialog that lists only the non-equipment members', async () => {
    const items: ReviewItem[] = [
      ...EQUIP_ITEMS,
      { id: 'count:PC', kind: 'count', title: 'Type PC — Photocell', detail: 'Counted 0: not found on any counted plan sheet.', category: 'lighting_control', group: 'zero' },
    ];
    post.mockResolvedValueOnce({ data: { status: 'needs_review', items } });
    render(<ConfirmProvider><TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items }} /></ConfirmProvider>);
    fireEvent.change(screen.getByTestId('group-reason-zero'), { target: { value: 'Design-build scope, not this job' } });
    fireEvent.click(screen.getByTestId('group-noj-zero'));
    await waitFor(() => expect(screen.getByText('Mark all 2 not on this job?')).toBeTruthy());
    const dialog = within(screen.getByRole('alertdialog'));
    expect(dialog.getByText('Type OS — Occupancy sensor')).toBeTruthy();
    expect(dialog.getByText('Type PC — Photocell')).toBeTruthy();
    expect(dialog.queryByText('Type MB — Meter base')).toBeNull();
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', {
      itemIds: ['count:OS', 'count:PC'], action: 'not_on_job', reason: 'Design-build scope, not this job',
    }));
  });

  it('an equipment item still resolves fine entirely on its own', async () => {
    post.mockResolvedValueOnce({ data: { status: 'needs_review', items: EQUIP_ITEMS } });
    renderEquip();
    fireEvent.change(screen.getByLabelText('Why Type MB — Meter base is not on this job'), { target: { value: 'Design-build scope, not this job' } });
    fireEvent.click(screen.getByLabelText('Why Type MB — Meter base is not on this job').closest('.tr-actions')!.querySelector('button:last-child')!);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', { itemIds: ['count:MB'], action: 'not_on_job', reason: 'Design-build scope, not this job' }));
  });
});

describe('Fix round 3 / B10, B11 (frontend) — gap-fill/reconcile items answer per type, never "not on this job"', () => {
  const GFCI_ITEM: ReviewItem = {
    id: 'gapfill:GFCI', kind: 'count', title: 'Gap-fill found 2 possible GFCI — confirm on plans', detail: 'd',
    actions: ['markers', 'confirm', 'count'],
    reconcileMembers: [{ key: 'GFCI', type: 'GFCI', description: 'GFCI duplex receptacle', unit: 'count', currentQty: 7, headsPerPole: null }],
  };
  const S1S2_ITEM: ReviewItem = {
    id: 'reconcile:S1+S2', kind: 'confirm', title: 'Possible shortfall: S1/S2 vs LUMINAIRE SCHEDULE', detail: 'd',
    actions: ['confirm', 'count'],
    reconcileMembers: [
      { key: 'S1', type: 'S1', description: 'Pole light', unit: 'heads', currentQty: 2, headsPerPole: 1 },
      { key: 'S2', type: 'S2', description: 'Dual-head pole light', unit: 'heads', currentQty: 2, headsPerPole: 2 },
    ],
  };

  it('never renders "Not on this job" anywhere for a gap-fill/reconcile item', () => {
    render(<TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items: [GFCI_ITEM, S1S2_ITEM] }} />);
    expect(screen.queryByText('Not on this job')).toBeNull();
    expect(screen.queryByLabelText(/is not on this job/)).toBeNull();
  });

  it('B10 — "No more on this job" rejects only, showing the CURRENT count; "Confirm the found marks" and "Enter correct count" are the other two', async () => {
    post.mockResolvedValueOnce({ data: { status: 'needs_review', items: [GFCI_ITEM] } });
    render(<TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items: [GFCI_ITEM] }} />);
    expect(screen.getByText('Confirm the found marks on the plans')).toBeTruthy();
    expect(screen.getByText('No more on this job — keep current count 7')).toBeTruthy();
    expect(screen.getByText('Enter correct count')).toBeTruthy();
    fireEvent.change(screen.getByTestId('reconcilemember-reason-input-gapfill:GFCI::GFCI'), { target: { value: 'Suggested marks are dimension ticks, not GFCI receptacles' } });
    fireEvent.click(screen.getByText('No more on this job — keep current count 7'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', {
      itemIds: ['gapfill:GFCI'], action: 'confirm', memberKey: 'GFCI', reason: 'Suggested marks are dimension ticks, not GFCI receptacles',
    }));
  });

  it('B11 — S1 and S2 each answer their OWN count field, in heads, with memberKey — never one broadcast field', async () => {
    post.mockResolvedValueOnce({ data: { status: 'needs_review', items: [S1S2_ITEM] } });
    render(<TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items: [S1S2_ITEM] }} />);
    // Two independent rows, each its own "currently N heads".
    expect(screen.getByTestId('review-reconcilemember-reconcile:S1+S2::S1').textContent).toContain('currently 2 heads');
    expect(screen.getByTestId('review-reconcilemember-reconcile:S1+S2::S2').textContent).toContain('currently 2 heads');
    fireEvent.change(screen.getByTestId('reconcilemember-qty-reconcile:S1+S2::S1'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('reconcilemember-count-reconcile:S1+S2::S1'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/review/resolve', {
      itemIds: ['reconcile:S1+S2'], action: 'count', qty: 3, memberKey: 'S1',
    }));
    // S2's own field is untouched by S1's answer.
    expect((screen.getByTestId('reconcilemember-qty-reconcile:S1+S2::S2') as HTMLInputElement).value).toBe('');
  });

  it('a resolved member shows its resolution text instead of controls', () => {
    const resolved: ReviewItem = {
      ...GFCI_ITEM,
      reconcileMembers: [{ ...GFCI_ITEM.reconcileMembers![0], resolution: { action: 'confirm', qty: 7, reason: 'Dimension ticks', by: 'Jake', at: 't' } }],
    };
    render(<TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items: [resolved] }} />);
    expect(screen.getByTestId('review-reconcilemember-done-gapfill:GFCI::GFCI').textContent).toContain('Dimension ticks');
    expect(screen.queryByTestId('reconcilemember-reject-gapfill:GFCI::GFCI')).toBeNull();
  });
});

describe('fix round 4 / B13, N9 — a half-done site-light member asks for the missing number', () => {
  it('poles confirmed, heads per pole unknown -> "enter the heads" and Save heads posts a count for that member', async () => {
    post.mockResolvedValue({ data: { status: 'needs_review', items: [] } });
    setup({ status: 'needs_review', items: [{
      id: 'gapfill:S2', kind: 'count', title: 'Gap-fill found 1 possible S2', detail: 'schedule 4 heads, plans 2', actions: ['markers', 'confirm', 'count'],
      reconcileMembers: [{ key: 'S2', type: 'S2', description: 'Twin-head area light', unit: 'heads', currentQty: 2, headsPerPole: null,
        resolution: { action: 'markers', poles: 2, needs: 'heads', by: 'Jake', at: 't' } }],
    }] });
    expect(screen.getByTestId('review-reconcilemember-needs-gapfill:S2::S2').textContent).toMatch(/2 poles confirmed — heads per pole is not on the schedule: enter the heads/);
    fireEvent.change(screen.getByTestId('reconcilemember-needs-qty-gapfill:S2::S2'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('reconcilemember-needs-save-gapfill:S2::S2'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ action: 'count', qty: 3, memberKey: 'S2' });
  });
});
