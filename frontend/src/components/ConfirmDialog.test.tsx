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

  // Review round 2 N2: `ConfirmProvider` wraps `<App/>` in main.tsx, so this
  // dialog's overlay used to sit at the plain `.overlay` default (150) —
  // below every `.drawer-overlay` (160), and below the mobile bump to 240.
  // `useConfirm()` is called from inside drawer Modals (LeadDetailDrawer's
  // delete/mark-lost, GenDetailDrawer's close job), so the confirm box
  // painted behind the drawer's backdrop and a click on it actually landed
  // on the drawer overlay, closing the drawer instead of confirming. This is
  // the one dialog that must always be topmost by construction.
  it("the confirm dialog's overlay z-index clears every drawer overlay (240 on mobile, 160 on desktop)", async () => {
    const onResult = vi.fn();
    render(<ConfirmProvider><Harness onResult={onResult} /></ConfirmProvider>);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
    const overlay = document.querySelector('.overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(Number(overlay.style.zIndex)).toBeGreaterThan(240);
  });

  it('resolves false with no provider mounted, instead of throwing', async () => {
    const onResult = vi.fn();
    render(<Harness onResult={onResult} />);
    fireEvent.click(screen.getByText('Delete'));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  // Review round 1 S12: overlapping confirm() calls used to orphan the
  // earlier one's promise (its `resolve` overwritten, never called) — any
  // `await confirm({...})` caller for the first call would hang forever.
  describe('overlapping confirms and provider unmount (review round 1 S12)', () => {
    function TwoAskHarness({ onFirst, onSecond }: { onFirst: (v: boolean) => void; onSecond: (v: boolean) => void }) {
      const confirm = useConfirm();
      return (
        <div>
          <button onClick={async () => onFirst(await confirm({ title: 'First question?' }))}>Ask first</button>
          <button onClick={async () => onSecond(await confirm({ title: 'Second question?' }))}>Ask second</button>
        </div>
      );
    }

    it('settles the outgoing confirm with false when a second one replaces it before being answered', async () => {
      const onFirst = vi.fn();
      const onSecond = vi.fn();
      render(<ConfirmProvider><TwoAskHarness onFirst={onFirst} onSecond={onSecond}/></ConfirmProvider>);

      fireEvent.click(screen.getByText('Ask first'));
      await waitFor(() => expect(screen.getByText('First question?')).toBeTruthy());

      // The first dialog is still open (never answered) when a second call comes in.
      fireEvent.click(screen.getByText('Ask second'));
      await waitFor(() => expect(onFirst).toHaveBeenCalledWith(false));
      await waitFor(() => expect(screen.getByText('Second question?')).toBeTruthy());
      expect(onSecond).not.toHaveBeenCalled();
    });

    it('settles a pending confirm with false when the provider unmounts', async () => {
      const onResult = vi.fn();
      const { unmount } = render(<ConfirmProvider><Harness onResult={onResult}/></ConfirmProvider>);
      fireEvent.click(screen.getByText('Delete'));
      await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
      unmount();
      await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    });
  });
});
