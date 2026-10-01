// @vitest-environment happy-dom
// Fewer-questions round Task 7 — the checklist card, "Answered for you" and
// the automatic-answer label. New bodies are NEW_UI_ONLY cases; every frozen
// 2A case is still driven by TakeoffReviewPanel.payloads.test.tsx.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ConfirmProvider } from '../../../../components/ConfirmDialog';

const post = vi.fn();
const get = vi.fn();
vi.mock('../../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/client')>('../../../../api/client');
  return { ...actual, default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a), put: vi.fn() } };
});

import { showOneButton } from './ChecklistCard';
import TakeoffReviewPanel, { type ReviewItem } from '../TakeoffReviewPanel';
import { NEW_UI_ONLY, AUTO_UNDO, AUTO_UNDO_MEMBER, GROUP_ID, CASES } from './payloadCases';

afterEach(cleanup);
beforeEach(() => { post.mockReset(); get.mockReset(); get.mockResolvedValue({ data: {} }); post.mockResolvedValue({ data: { status: 'needs_review', items: [] } }); });

const panel = (items: ReviewItem[]) => render(<ConfirmProvider><TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items }} /></ConfirmProvider>);
const CL = 'textzero:equipment';
const mid = (k: string) => `${CL}::${k}`;

describe('ChecklistCard', () => {
  it('shows each row with its quote, its proposal chip and the progress', () => {
    panel(NEW_UI_ONLY.checklistUseStated.items);
    expect(screen.getByTestId(`checklist-progress-${CL}`).textContent).toBe('0 of 4 answered');
    expect(screen.getByTestId(`checklist-quote-${mid('TSTAT')}`).textContent).toBe('“Thermostats #1 and #2 above electric panels (2)” — the equipment list');
    expect(screen.getByTestId(`checklist-chip-${mid('TSTAT')}`).textContent).toBe('Stated: 2');
    expect(screen.getByTestId(`checklist-chip-${mid('PYLON SIGN')}`).textContent).toBe('Covered by SIGNS');
    expect(screen.queryByTestId(`checklist-chip-${mid('MB')}`)).toBeNull();
    // legend row: no proposal, needs a number, a twin quick answer
    expect(screen.queryByTestId(`checklist-use-${mid('T')}`)).toBeNull();
    expect(screen.getByTestId(`checklist-twin-${mid('T')}`).textContent).toBe('Same item as TSTAT — not on this job');
    expect(screen.getByTestId(`checklist-drawn-${mid('PYLON SIGN')}`).textContent).toBe('Use those markers (1)');
  });
  it('NEW_UI_ONLY checklistUseStated — "Use 2" posts the count with its quote', async () => {
    panel(NEW_UI_ONLY.checklistUseStated.items);
    fireEvent.click(screen.getByTestId(`checklist-use-${mid('TSTAT')}`));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]).toStrictEqual(['/preconstruction/b1/review/resolve', NEW_UI_ONLY.checklistUseStated.expected]);
  });
  it('NEW_UI_ONLY checklistConfirmAll — the dialog lists every pre-filled row (the not-on-job one by name), then posts', async () => {
    panel(NEW_UI_ONLY.checklistConfirmAll.items);
    fireEvent.click(screen.getByTestId(`checklist-confirm-all-${CL}`));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    const list = within(screen.getByTestId('checklist-confirm-list'));
    expect(list.getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'TSTAT: 2 — Stated: "Thermostats #1 and #2 above electric panels (2)" (the equipment list) (“Thermostats #1 and #2 above electric panels (2)”, the equipment list)',
      'PYLON SIGN: not on this job — Covered by SIGNS (A-18) — already a counted line ("Front wall sign A-6, side wall signs A-14/A-16, pylon sign A-18") (“Pylon sign connection, circuit A-18”, the equipment list)',
    ]);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Confirm'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toStrictEqual(NEW_UI_ONLY.checklistConfirmAll.expected);
  });
  it('NEW_UI_ONLY checklistMemberNoj — equipment gets no ready-made reasons, typed only', async () => {
    panel(NEW_UI_ONLY.checklistMemberNoj.items);
    fireEvent.click(screen.getByTestId(`checklist-noj-${mid('MB')}`));
    const row = within(screen.getByTestId(`review-checklistrow-${mid('MB')}`));
    expect(row.queryAllByRole('button').filter(b => b.className.includes('tr-reason-preset'))).toHaveLength(0);
    fireEvent.change(screen.getByTestId(`checklist-reason-input-${mid('MB')}`), { target: { value: 'Meter base is by the utility here' } });
    fireEvent.click(screen.getByTestId(`checklist-noj-${mid('MB')}-save`));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toStrictEqual(NEW_UI_ONLY.checklistMemberNoj.expected);
  });
  it('the "1" quick button: one-noun text rows only — never a legend row, a length item or a plural', () => {
    panel(NEW_UI_ONLY.checklistUseStated.items);
    expect(screen.getByTestId(`checklist-one-${mid('MB')}`)).toBeTruthy();
    expect(screen.queryByTestId(`checklist-one-${mid('T')}`)).toBeNull(); // legend row
    expect(screen.queryByTestId(`checklist-one-${mid('TSTAT')}`)).toBeNull(); // has a proposal
    expect(showOneButton({ rowKind: 'text', description: 'NEMA 3R wireway, contractor provided', type: 'WIREWAY' })).toBe(false);
    expect(showOneButton({ rowKind: 'text', description: 'Exhaust fans', type: 'EF' })).toBe(false);
    expect(showOneButton({ rowKind: 'legend', description: 'Thermostat', type: 'T' })).toBe(false);
    expect(showOneButton({ rowKind: 'text', description: 'Meter base NEMA 3R, parallel (2)4#3/0 2"C', type: 'MB' })).toBe(true);
  });
  it('the checklist is never in the cross-item multi-select (equipment)', () => {
    panel([...NEW_UI_ONLY.checklistUseStated.items, ...CASES.zeroCount.items]);
    expect(screen.queryByLabelText(/^Select 4 items/)).toBeNull();
  });
});

const autoArea: ReviewItem = {
  id: 'area:$', kind: 'area', group: 'area:E1.0 / E2.0', title: 'Type $: same area or different areas?', detail: 'E1.0 3 / E2.0 9', options: ['Same area — keep 9', 'Different areas — sum 12'], actions: ['answer', 'count'],
  resolution: { action: 'answer', answer: 'Same area — keep 9', qty: 9, by: 'CRM (automatic)', at: 't', auto: { source: 'registration', reason: 'the sheets show the same devices in the same places and no sheet title names a floor', evidence: ['E1.0 / E2.0: 3 of 3 marks sit in the same place (building outlines aligned)', 'no sheet title names a floor or level — 17 titles checked'] } },
};
const memGroup: ReviewItem = {
  ...CASES.legendMemberCount.items[0],
  groupedTypes: CASES.legendMemberCount.items[0].groupedTypes!.map(m => (m.key === 'MS' ? { ...m, resolution: { action: 'not_on_job' as const, reason: 'From Lake Mary: not on the prototype', by: 'CRM (from Lake Mary)', at: 't', auto: { source: 'account_memory' as const, reason: 'Same account (AutoZone) — answered this way on Lake Mary', evidence: ['Lake Mary: Motion sensor — not on this job'], fromBid: { id: 'b2', name: 'Lake Mary' } } } } : m)),
};

describe('Answered for you', () => {
  it('lists every automatic answer with its reason and evidence visible (no Details click), and its source', () => {
    panel([autoArea, memGroup]);
    const strip = within(screen.getByTestId('review-auto'));
    expect(screen.getByTestId('review-auto').querySelector('summary')!.textContent).toBe('Answered for you (2)');
    expect(screen.getByTestId('review-auto-evidence-area:$').textContent).toContain('3 of 3 marks sit in the same place');
    expect(strip.getByText('From Lake Mary — change')).toBeTruthy();
    expect(strip.getByText('Why: Same account (AutoZone) — answered this way on Lake Mary')).toBeTruthy();
    // not in the person's resolved list
    expect(screen.queryByTestId('review-resolved-area:$')).toBeNull();
  });
  it('Undo = the existing reopen (item; and a member with its memberKey)', async () => {
    panel([autoArea, memGroup]);
    fireEvent.click(screen.getByTestId('review-auto-undo-area:$'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]).toStrictEqual([AUTO_UNDO.url, AUTO_UNDO.body]);
    fireEvent.click(screen.getByTestId(`review-auto-undo-${GROUP_ID}::MS`));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]).toStrictEqual([AUTO_UNDO_MEMBER.url, AUTO_UNDO_MEMBER.body]);
  });
});
