// @vitest-environment happy-dom
// Level 2 learning, Task 15 — Settings → Counting lessons & examples, and the
// run strip. The approve payload carries scope "all" by default; the strip
// lists every lesson / example the run used; "Make a lesson from this
// answer" and "Turn off for this bid" post the bodies in LEARNING_BODIES.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { ConfirmProvider } from '../../../components/ConfirmDialog';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), put: vi.fn(), delete: vi.fn(), defaults: {} } };
});

import { LearningSection } from './LearningSection';
import LearningUsedStrip from '../../preconstruction/PcWorkspace/review/LearningUsedStrip';
import TakeoffReviewPanel from '../../preconstruction/PcWorkspace/TakeoffReviewPanel';
import { LEARNING_BODIES } from '../../preconstruction/PcWorkspace/review/payloadCases';

afterEach(cleanup);
const LESSON = {
  id: 'L1', lineageId: 'G1', version: 1, text: 'An unscheduled tag drawn as "surface strip fixture (warehouse)" has been surface strip light, 4ft (H on 36th Street Warehouse).',
  appliesTo: ['review'], scopeKind: 'all', scopeValue: null, status: 'proposed', pattern: 'manual', proposedAt: 't',
  evidence: [{ bidId: 'b36', bidName: '36th Street Warehouse', itemId: 'unlisted:H', answer: '13', reason: 'H surface strip light, 4ft', at: '2026-09-30' }],
  suggestedScope: { kind: 'project_type', value: 'self_storage', label: 'this project type: self_storage' },
};
beforeEach(() => {
  get.mockReset(); post.mockReset();
  get.mockImplementation((url: string) => {
    if (url === '/learning/lessons') return Promise.resolve({ data: { lessons: [LESSON] } });
    if (url === '/learning/releases') return Promise.resolve({ data: { releases: [], activeId: null, waiting: { examples: 4, lessons: 1 }, estimatedCost: '$12–15' } });
    if (url === '/learning/releases/preview') return Promise.resolve({ data: { estimatedCost: '$12–15', jobs: [{ label: 'Kissimmee', willRun: true, note: 'will run (AI calls)' }, { label: '36th Street', willRun: false, note: 'no change — nothing in the bank applies to this job (no model calls)' }] } });
    if (url === '/learning/bids/b1') return Promise.resolve({ data: {
      learning: { releaseId: 3, tokensEst: 900, examplesUsed: [{ id: 'X1', targetKey: 'B', polarity: 'positive', sourceBidName: '36th Street Warehouse', meaning: '2x4 LED recessed troffer', sheets: ['E-1'] }, { id: 'X2', targetKey: 'GFCI', polarity: 'negative', sourceBidName: 'North Port Storage', meaning: 'Duplex receptacle', sheets: ['E-1'] }],
        lessonsUsed: [{ lessonId: '11111111-1111-4111-8111-111111111111', version: 2, text: 'Shaded receptacles are new.', sheets: ['E1.0'] }] },
      reviewHints: [], off: { all: false, examples: [], lessons: [] } } });
    return Promise.resolve({ data: {} });
  });
  post.mockImplementation((url: string) => Promise.resolve({ data: url.includes('/off') ? { off: { all: false, examples: [], lessons: ['11111111-1111-4111-8111-111111111111'] }, note: 'Takes effect on the next analysis run.' } : { lesson: { ...LESSON, status: 'approved' } } }));
});

describe('LearningSection', () => {
  it('approve sends scope "all" by default (the suggestion is shown, not preselected)', async () => {
    render(<ConfirmProvider><LearningSection /></ConfirmProvider>);
    await waitFor(() => expect(screen.getByTestId('lesson-L1')).toBeTruthy());
    const row = within(screen.getByTestId('lesson-L1'));
    expect((row.getByLabelText('All jobs') as HTMLInputElement).checked).toBe(true);
    expect(row.getByText(/This project type: self_storage/)).toBeTruthy();
    expect(screen.getByTestId('lesson-evidence-L1').textContent).toContain('36th Street Warehouse — unlisted:H: 13');
    fireEvent.click(screen.getByTestId('lesson-approve-L1'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]).toStrictEqual([LEARNING_BODIES.approveDefaultScope.url, LEARNING_BODIES.approveDefaultScope.body]);
  });
  it('"Check and release" asks first (with the cost) and does nothing on cancel', async () => {
    render(<ConfirmProvider><LearningSection /></ConfirmProvider>);
    await waitFor(() => expect(screen.getByTestId('learning-releases').textContent).toContain('4 new examples, 1 approved lesson waiting.'));
    fireEvent.click(screen.getByTestId('learning-check-release'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    expect(screen.getByRole('alertdialog').textContent).toContain('$12–15');
    expect(screen.getByTestId('check-preview').textContent).toContain('36th Street: no change — nothing in the bank applies to this job (no model calls)');
    expect(screen.getByTestId('check-preview').textContent).toContain('Kissimmee: will run');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Cancel'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(post).not.toHaveBeenCalled();
  });
});

describe('LearningUsedStrip', () => {
  it('lists every lesson and example the run used; turn off posts the body', async () => {
    render(<LearningUsedStrip bidId="b1" initial={(await get('/learning/bids/b1')).data} />);
    await waitFor(() => expect(screen.getByTestId('learning-used')).toBeTruthy());
    expect(screen.getByTestId('learning-used').querySelector('summary')!.textContent).toBe('Learning used on this run: 2 symbol examples, 1 lesson');
    expect(screen.getByTestId('learning-lesson-11111111-1111-4111-8111-111111111111').textContent).toContain('Used lesson: L1 v2 — “Shaded receptacles are new.”');
    expect(screen.getByTestId('learning-example-X1').textContent).toContain('Example X1 for B (is “2x4 LED recessed troffer”) — from 36th Street Warehouse');
    expect(screen.getByTestId('learning-example-X2').textContent).toContain('is not “Duplex receptacle”');
    fireEvent.click(screen.getByTestId('learning-off-lesson-11111111-1111-4111-8111-111111111111'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]).toStrictEqual([LEARNING_BODIES.learningOffForBid.url, LEARNING_BODIES.learningOffForBid.body]);
    await waitFor(() => expect(screen.getByText('off for this bid')).toBeTruthy());
  });
  it('hidden when the run used nothing', async () => {
    const { container } = render(<LearningUsedStrip bidId="b2" initial={{ learning: null, reviewHints: [], off: { all: false, examples: [], lessons: [] } }} />);
    await new Promise(r => setTimeout(r, 0));
    expect(container.querySelector('[data-testid="learning-used"]')).toBeNull();
  });
});

describe('"Make a lesson from this answer"', () => {
  it('posts the from-item body for a person\'s answer', async () => {
    const items = [{ id: 'unlisted:H', kind: 'count' as const, title: 'Type H drawn 13×', detail: 'd', resolution: { action: 'count' as const, qty: 13, reason: 'H surface strip light, 4ft', by: 'Jake', at: 't' } }];
    render(<TakeoffReviewPanel bidId="b1" showToast={vi.fn()} onReviewChange={vi.fn()} countResult={null} review={{ status: 'clear', items }} />);
    fireEvent.click(screen.getByTestId('lesson-from-unlisted:H'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]).toStrictEqual([LEARNING_BODIES.lessonFromItem.url, LEARNING_BODIES.lessonFromItem.body]);
  });
});
