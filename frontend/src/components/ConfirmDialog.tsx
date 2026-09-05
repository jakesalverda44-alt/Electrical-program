import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Modal, { Z_ABOVE_DRAWER } from './Modal';

/**
 * The app's own confirm dialog, replacing `window.confirm(...)` at the 11
 * destructive-action call sites (audit ux #4). Built on `Modal` — an
 * `alertdialog`, never itself "dirty" — with `useConfirm()` returning a
 * promise so a call site reads `if (await confirm({ ... })) { ... }`, the
 * same shape `window.confirm` had.
 *
 * `useConfirm()` works with or without `<ConfirmProvider>` mounted: outside a
 * provider (an isolated unit test that doesn't touch this) it resolves to
 * `false` — the same "nothing happens" result `window.confirm` gives by
 * default in a test environment — rather than throwing, so a component that
 * calls it doesn't force every existing test of that component to be
 * rewired with a provider it has no reason to exercise. `<ConfirmProvider>`
 * is mounted once in `main.tsx`, so real usage always gets the dialog.
 */

export interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red primary button + focuses it by default — for permanent deletes. */
  destructive?: boolean;
}

export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const noProviderConfirm: ConfirmFn = () => Promise.resolve(false);

const ConfirmContext = createContext<ConfirmFn>(noProviderConfirm);

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // The dialog is rendered from `pending` directly (state), but `settle` also
  // needs the in-flight `resolve` at click time — a ref keeps that stable
  // across the render that starts closing the dialog.
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>(resolve => {
      // Review round 1 S12: a second confirm() call while one is already
      // pending used to just overwrite `pending` — the FIRST call's promise
      // then never settles (its `resolve` is dropped on the floor), which
      // leaves any `await confirm({...})` caller hanging forever. Settle the
      // outgoing one with `false` (same as Cancel/dismiss) before replacing it.
      setPending(prev => {
        prev?.resolve(false);
        return { ...opts, resolve };
      });
    });
  }, []);

  // Review round 1 S12: a pending confirm() whose provider unmounts (the app
  // navigating away, or a test tearing down) would otherwise also never
  // settle — same "await hangs forever" bug, just via unmount instead of a
  // second call.
  useEffect(() => {
    return () => { pendingRef.current?.resolve(false); };
  }, []);

  const settle = (value: boolean) => {
    pendingRef.current?.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={!!pending}
        title={pending?.title ?? ''}
        body={pending?.body}
        confirmLabel={pending?.confirmLabel}
        cancelLabel={pending?.cancelLabel}
        destructive={pending?.destructive}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive, onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    // Review round 2 N2: `ConfirmProvider` wraps `<App/>` in main.tsx, so
    // without this its `.overlay` sat at the plain default z-index (150) —
    // below every `.drawer-overlay` (160). `useConfirm()` is called from
    // inside drawer Modals (LeadDetailDrawer's delete/mark-lost,
    // GenDetailDrawer's close job), so the confirm box painted BEHIND the
    // drawer's own backdrop and a click on its destructive button actually
    // landed on the drawer overlay's mousedown, closing the drawer instead
    // of confirming. This is the one dialog in the app that is always
    // rendered at the root, above whatever else is open, by construction —
    // so it always gets the same above-everything z-index Modal exposes for
    // that purpose, not a per-caller guess.
    <Modal open={open} onClose={onCancel} role="alertdialog" title={title} overlayStyle={{ zIndex: Z_ABOVE_DRAWER }}>
      <>
        {body != null && (
          <div className="modal-body" style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.6 }}>
            {body}
          </div>
        )}
        <div className="modal-foot">
          <button type="button" className="btn ghost" onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            className="btn"
            autoFocus={!!destructive}
            onClick={onConfirm}
            style={destructive ? { background: 'var(--red)', borderColor: 'var(--red)' } : undefined}
          >
            {confirmLabel}
          </button>
        </div>
      </>
    </Modal>
  );
}

export default ConfirmDialog;
