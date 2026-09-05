// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from './ConfirmDialog';

afterEach(cleanup);

function Harness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  const ask = async () => {
    const ok = await confirm({ title: 'Delete lead "Jane Doe"?', body: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true });
    onResult(ok);
  };
  return <button onClick={ask}>Delete</button>;
}

describe('useConfirm / ConfirmDialog', () => {
  it('resolves false and does nothing when Cancel is clicked', async () => {
    const onResult = vi.fn();
    render(<ConfirmProvider><Harness onResult={onResult} /></ConfirmProvider>);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(screen.getByText('Delete lead "Jane Doe"?')).toBeTruthy());
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByText('Delete lead "Jane Doe"?')).toBeNull();
  });

  it('resolves true when the destructive confirm button is clicked', async () => {
    const onResult = vi.fn();
    render(<ConfirmProvider><Harness onResult={onResult} /></ConfirmProvider>);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(screen.getByText('This cannot be undone.')).toBeTruthy());
    // Two "Delete" texts now exist (the opener button and the confirm button)
    // — the confirm button is inside the dialog.
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByText('Delete'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it('Escape cancels the confirmation', async () => {
    const onResult = vi.fn();
    render(<ConfirmProvider><Harness onResult={onResult} /></ConfirmProvider>);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('resolves false with no provider mounted, instead of throwing', async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});
