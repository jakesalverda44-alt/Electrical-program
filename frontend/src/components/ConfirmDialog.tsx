import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from './Modal';

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
      setPending({ ...opts, resolve });
    });
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
    <Modal open={open} onClose={onCancel} role="alertdialog" title={title}>
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
