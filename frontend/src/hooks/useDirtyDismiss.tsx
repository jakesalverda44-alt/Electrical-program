import React, { useCallback, useEffect, useState } from 'react';
import { ConfirmLeaveDialog } from '../contexts/UnsavedGuardContext';

/**
 * For a modal or drawer with typed content: backdrop click, Escape and the
 * close-x all ask before throwing the typing away, and only when there is
 * something to throw away.
 *
 * Returns `requestClose` (use it everywhere the modal currently calls
 * `onClose`), and `discardDialog`, which the modal renders alongside itself.
 */
export function useDirtyDismiss(isDirty: boolean, onClose: () => void, opts?: {
  /** Also close on Escape. Default true. */
  escape?: boolean;
}) {
  const [asking, setAsking] = useState(false);

  const requestClose = useCallback(() => {
    if (isDirty) setAsking(true);
    else onClose();
  }, [isDirty, onClose]);

  useEffect(() => {
    if (opts?.escape === false) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A confirm dialog is already up; Escape there means "keep editing".
      if (asking) { setAsking(false); return; }
      requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose, asking, opts?.escape]);

  const discardDialog = asking ? (
    <ConfirmLeaveDialog
      title="Discard your changes?"
      body="You have unsaved changes in this form. Closing it will discard them."
      leaveLabel="Discard"
      onStay={() => setAsking(false)}
      onLeave={() => { setAsking(false); onClose(); }}
    />
  ) : null;

  return { requestClose, discardDialog };
}

export default useDirtyDismiss;
