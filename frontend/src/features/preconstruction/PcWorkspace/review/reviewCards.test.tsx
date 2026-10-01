// @vitest-environment happy-dom
// UI cleanup round 2A — the card frame, the reason picker and the card layouts.
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const post = vi.fn();
const get = vi.fn();
vi.mock('../../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/client')>('../../../../api/client');
  return { ...actual, default: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a), put: vi.fn() } };
});

import TakeoffReviewPanel, { type ReviewItem } from '../TakeoffReviewPanel';
import ReviewCardShell from './ReviewCardShell';
import ReasonPicker from './ReasonPicker';

afterEach(cleanup);
beforeEach(() => { post.mockReset(); get.mockReset(); get.mockResolvedValue({ data: {} }); post.mockResolvedValue({ data: { status: 'needs_review', items: [] } }); });

const ZERO = (id: string, extra: Partial<ReviewItem> = {}): ReviewItem => ({ id: `count:${id}`, kind: 'count', group: 'zero', title: `Type ${id} — thing`, detail: 'Counted 0: not found on any counted plan sheet.', aiCount: 0, actions: ['count', 'markers', 'not_on_job'], ...extra });
const panel = (items: ReviewItem[]) => render(<TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items }} />);

describe('ReviewCardShell', () => {
  const LONG = 'x'.repeat(200);
  const shell = (item: ReviewItem) => render(<ul><ReviewCardShell item={item}><span>body</span></ReviewCardShell></ul>);
  it('the Details toggle flips aria-expanded and shows the hidden text', () => {
    shell({ ...ZERO('A'), sheets: ['E-1: 3'], notes: ['a note'] });
    const toggle = screen.getByTestId('review-details-toggle-count:A');
    const region = screen.getByTestId('review-details-count:A');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(region.hasAttribute('hidden')).toBe(true);
    expect(region.textContent).toContain('AI saw: E-1: 3'); // hidden, not unmounted
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(region.hasAttribute('hidden')).toBe(false);
    expect(toggle.getAttribute('aria-controls')).toBe(region.id);
  });
  it('a long detail is clamped until Details is opened; a short one has no toggle', () => {
    shell({ ...ZERO('A'), detail: LONG });
    const detail = screen.getByText(LONG);
    expect(detail.className).toContain('tr-detail-clamp');
    fireEvent.click(screen.getByTestId('review-details-toggle-count:A'));
    expect(detail.className).not.toContain('tr-detail-clamp');
    cleanup();
    shell(ZERO('B'));
    expect(screen.queryByTestId('review-details-toggle-count:B')).toBeNull();
  });
  it('the earlier-answer line shows without opening Details', () => {
    shell({ ...ZERO('A'), notes: ['n'], previousResolution: { action: 'count', qty: 11, by: 'Jake', at: 't' } });
    const line = screen.getByTestId('review-previous-count:A');
    expect(line.textContent).toContain('Earlier answer');
    expect(line.closest('[hidden]')).toBeNull();
  });
});

describe('ReasonPicker', () => {
  const picker = (props: Partial<React.ComponentProps<typeof ReasonPicker>> = {}) => {
    const onSave = vi.fn(); const onCancel = vi.fn();
    render(<ReasonPicker idBase="t" inputLabel="Why it" presets={['Preset one reason']} busy={false} onSave={onSave} onCancel={onCancel} {...props} />);
    return { onSave, onCancel };
  };
  it('a preset click sends the exact preset text; the first preset has focus', () => {
    const { onSave } = picker();
    // Review fix S4: focus is the typed box, never a one-click preset.
    expect(document.activeElement).toBe(screen.getByLabelText('Why it'));
    fireEvent.click(screen.getByRole('button', { name: 'Preset one reason' }));
    expect(onSave).toHaveBeenCalledWith('Preset one reason');
  });
  it('typed text under 10 characters keeps Save disabled and shows the hint; a real reason sends untrimmed', () => {
    const { onSave } = picker();
    const save = screen.getByRole('button', { name: 'Save reason' }) as HTMLButtonElement;
    expect(screen.queryByText(/A few more words/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Why it'), { target: { value: 'short' } });
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/A few more words, please/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Why it'), { target: { value: '  A proper reason  ' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith('  A proper reason  ');
  });
  it('no presets: says equipment needs a typed reason and focuses the box; Escape cancels', () => {
    const { onCancel } = picker({ presets: [] });
    expect(screen.getByText('This one needs a typed reason.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Why it'));
    fireEvent.keyDown(screen.getByLabelText('Why it'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
  it('busy disables every button', () => {
    picker({ busy: true });
    expect((screen.getByRole('button', { name: 'Preset one reason' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('cards', () => {
  it('a zero card shows at most three buttons and no text box until Not on this job is clicked', () => {
    panel([ZERO('G'), ZERO('OS')]);
    const card = within(screen.getByTestId('review-item-count:G'));
    expect(card.getAllByRole('button').length).toBeLessThanOrEqual(3);
    expect(card.queryAllByRole('textbox')).toHaveLength(0);
    fireEvent.click(card.getByText('Not on this job'));
    expect(card.getAllByRole('textbox')).toHaveLength(1);
  });
  it('the trigger carries aria-expanded/aria-controls and Cancel / Escape return focus to it', () => {
    panel([ZERO('G')]);
    const card = within(screen.getByTestId('review-item-count:G'));
    const trigger = card.getByText('Not on this job');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(trigger.getAttribute('aria-controls')!)).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'Cancel' }));
    expect(card.queryByRole('group', { name: 'Why?' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.keyDown(card.getByRole('group', { name: 'Why?' }), { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });
  it('equipment: no ready-made reasons, no checkbox', () => {
    panel([ZERO('MB', { category: 'equipment' }), ZERO('OS')]);
    expect(screen.queryByLabelText('Select Type MB — thing')).toBeNull();
    expect(screen.getByLabelText('Select Type OS — thing')).toBeTruthy();
    fireEvent.click(screen.getByTestId('review-noj-count:MB'));
    expect(within(screen.getByTestId('review-item-count:MB')).queryByText('Not shown on the plans for this job')).toBeNull();
  });
  it('a choice button disables every option while the answer saves', async () => {
    let release!: (v: unknown) => void;
    post.mockReturnValueOnce(new Promise(r => { release = r; }));
    panel([{ id: 'area:A', kind: 'area', group: 'area', title: 'Type A: same?', detail: 'd', options: ['Same area — keep 40', 'Different areas — sum 75'], actions: ['answer'] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Same area — keep the larger (40)' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Different areas — add them (75)' }) as HTMLButtonElement).disabled).toBe(true));
    release({ data: { status: 'needs_review', items: [] } });
  });
  it('a preset not-on-job reason posts exactly that text', async () => {
    panel([ZERO('G'), ZERO('OS')]);
    const card = within(screen.getByTestId('review-item-count:G'));
    fireEvent.click(card.getByText('Not on this job'));
    fireEvent.click(card.getByRole('button', { name: 'Existing to remain — no new work' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toStrictEqual({ itemIds: ['count:G'], action: 'not_on_job', reason: 'Existing to remain — no new work' });
  });
  it('S4: a held Enter in the typed box does not save', () => {
    const onSave = vi.fn();
    render(<ReasonPicker idBase="t" inputLabel="Why it" presets={[]} busy={false} onSave={onSave} onCancel={vi.fn()} />);
    const box = screen.getByLabelText('Why it');
    fireEvent.change(box, { target: { value: 'A proper reason' } });
    fireEvent.keyDown(box, { key: 'Enter', repeat: true });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('A proper reason');
  });
  it('typed-only kinds show no ready-made reasons: counting, unlisted, unscheduled, heads, coverage not-on-job, typicalassign None, panel-dup', () => {
    const rows: Array<[ReviewItem, string]> = [
      [{ id: 'counting:not_run', kind: 'confirm', group: 'counting', title: 'Counting', detail: 'd', actions: ['confirm'] }, 'Confirm'],
      [{ id: 'panel-dup:A', kind: 'confirm', group: 'schedule', title: 'Panel A', detail: 'd', actions: ['confirm'] }, 'Confirm'],
      [{ id: 'unlisted:H', kind: 'count', group: 'unlisted', title: 'Type H', detail: 'd', aiCount: 13, actions: ['answer', 'count', 'not_on_job'], options: ['Same as Type A'] }, 'Not on this job'],
      [{ id: 'unscheduled:X', kind: 'count', group: 'unscheduled', title: 'Type X', detail: 'd', actions: ['count', 'not_on_job'] }, 'Not on this job'],
      [{ id: 'count:S1:heads', kind: 'count', group: 'heads', title: 'Type S1 heads', detail: 'd', actions: ['count', 'not_on_job'] }, 'Not on this job'],
      [{ id: 'coverage:SL', kind: 'count', group: 'coverage', title: 'Type SL', detail: 'd', aiCount: 9, actions: ['count', 'markers', 'confirm', 'not_on_job'] }, 'Not on this job'],
    ];
    for (const [it_, trigger] of rows) {
      cleanup();
      panel([it_]);
      const c = within(screen.getByTestId(`review-item-${it_.id}`));
      fireEvent.click(c.getByRole('button', { name: trigger }));
      expect(c.queryAllByRole('button').filter(b => b.className.includes('tr-reason-preset')), it_.id).toHaveLength(0);
      expect(c.getByText('This one needs a typed reason.')).toBeTruthy();
    }
    cleanup();
    panel([{ id: 'typicalassign:P', kind: 'count', group: 'typical', title: 'Poles', detail: 'd', actions: ['count', 'confirm'], reconcileMembers: [{ key: 'A', type: 'A', description: 'a', unit: 'count', currentQty: 0, headsPerPole: null }] }]);
    fireEvent.click(screen.getByTestId('assign-none-typicalassign:P::A'));
    expect(screen.getByText('This one needs a typed reason.')).toBeTruthy();
  });
  it('one-click choice answers show an Undo on the success toast that reopens the item', async () => {
    const showToast = vi.fn();
    post.mockResolvedValue({ data: { status: 'needs_review', items: [] } });
    render(<TakeoffReviewPanel bidId="b1" showToast={showToast} onReviewChange={vi.fn()} countResult={null} review={{ status: 'needs_review', items: [{ id: 'scope:p', kind: 'scope_question', group: 'scope', title: 'Poles', detail: 'q', options: ['APT', 'GC'] }] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'GC' }));
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    const t = showToast.mock.calls[0][0];
    expect(t.action.label).toBe('Undo');
    t.action.onClick();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]).toEqual(['/preconstruction/b1/review/reopen', { itemId: 'scope:p' }]);
  });
  it('TypicalAssignCard is self-contained: it imports nothing from reviewCards, and nothing else renders typicalassign', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(dir, 'TypicalAssignCard.tsx'), 'utf8');
    expect(src).not.toMatch(/reviewCards/);
    const cards = fs.readFileSync(path.join(dir, 'reviewCards.tsx'), 'utf8');
    expect(cards).not.toMatch(/typicalassign:/);
  });
});
