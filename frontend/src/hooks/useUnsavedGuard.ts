import { useEffect, useRef } from 'react';
import { useUnsavedGuardContext } from '../contexts/UnsavedGuardContext';

/**
 * Call from any screen that holds work in memory until an explicit Save.
 *
 * `isDirty` should be a comparison against the last saved snapshot, not a
 * boolean flipped on every keystroke: a keystroke flag never resets when the
 * user undoes their edit, so the screen stays "dirty" forever and the dialog
 * becomes noise the user learns to click through.
 *
 * Registers a `beforeunload` handler (covers reload, tab close and browser
 * back out of the app) and a predicate the in-app navigation points consult.
 */
export function useUnsavedGuard(isDirty: boolean) {
  // Read at check time rather than captured, so the registration itself never
  // has to churn.
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const guard = useUnsavedGuardContext();

  useEffect(() => {
    if (!guard) return;
    const id = {};
    guard.register(id, () => dirtyRef.current);
    return () => guard.unregister(id);
  }, [guard]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // The wording is the browser's; only the cancellation is ours.
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);
}

export default useUnsavedGuard;
