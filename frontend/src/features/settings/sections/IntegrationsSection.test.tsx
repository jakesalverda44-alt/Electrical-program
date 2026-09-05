// @vitest-environment happy-dom
// Regression test for review-round-1 S8: the Google Drive card's four action
// buttons (Backfill bids, Reorganize bids, Backfill gen jobs, Reorganize gen
// jobs) used to call native `window.confirm(...)`, the last four remaining
// after Task 2 supposedly replaced all 11 sites. They now go through the
// shared `useConfirm()`/`ConfirmDialog`, same copy, same Cancel/Confirm shape.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { IntegrationsSection } from './IntegrationsSection';
import { ConfirmProvider } from '../../../components/ConfirmDialog';

afterEach(cleanup);

const post = vi.fn();
vi.mock('../../../api/client', () => ({
  default: {
    post: (...a: unknown[]) => post(...a),
  },
}));

function setup() {
  render(
    <ConfirmProvider>
      <IntegrationsSection />
    </ConfirmProvider>,
  );
}

describe('IntegrationsSection — Google Drive card confirms (review round 1 S8)', () => {
  afterEach(() => post.mockReset());

  it('Cancel on the confirm dialog does not call the backfill route', async () => {
    post.mockResolvedValue({ data: { processed: 0, skipped: 0, errors: [] } });
    setup();
    fireEvent.click(screen.getByText('Backfill existing bids'));
    expect(await screen.findByText(/create Google Drive folders for every bid/)).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText(/create Google Drive folders for every bid/)).toBeNull());
    expect(post).not.toHaveBeenCalled();
  });

  it('Confirming calls the backfill route', async () => {
    post.mockResolvedValue({ data: { processed: 3, skipped: 0, errors: [] } });
    setup();
    fireEvent.click(screen.getByText('Backfill existing bids'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByText('Confirm'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/admin/backfill-drive', {}, { timeout: 300_000 }));
  });
});
