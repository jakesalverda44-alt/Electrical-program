import { useCallback, useRef, useState } from 'react';
import { apiErrorMessage } from '../api/errors';
import { useOptionalShowToast } from '../contexts/AppContext';
import { Toast } from '../types';

/**
 * The one way this app writes to the API.
 *
 * Before this hook there were 27 save handlers whose only error handling was a
 * `finally` that cleared the busy flag: on a failed PATCH the spinner stopped,
 * the drawer stayed open, and nothing else happened, so the user assumed it
 * saved. Elsewhere the success toast fired before the request resolved, or
 * instead of it.
 *
 * `run` owns the busy flag, the failure toast and the rollback. Deliberately
 * small: no queueing, no retry, no cache invalidation.
 */

export interface UseMutationOptions<A extends unknown[], R> {
  /** Called with the resolved value after a successful run. */
  onSuccess?: (result: R, ...args: A) => void;
  /** Called with the raw error after a failed run (after the rollback). */
  onError?: (err: unknown, ...args: A) => void;
  /** Called after either outcome — the `finally` a caller would otherwise write. */
  onSettled?: (...args: A) => void;
  /**
   * Toast to show on success. A function receives the result, and may return
   * null to stay quiet for that particular outcome.
   */
  successToast?: Toast | ((result: R, ...args: A) => Toast | null);
  /**
   * Toast to show on failure. Defaults to
   * `{ title: 'Something went wrong', sub: apiErrorMessage(err), variant: 'error' }`.
   * A function receives the normalized message; `false` suppresses the toast
   * for the genuinely optional writes.
   */
  errorToast?: Toast | ((message: string, err: unknown, ...args: A) => Toast | null) | false;
  /**
   * Apply the change locally before the request and return the undo. Called
   * with the same arguments as `run`; the returned function is invoked if the
   * request fails. Modelled on SalesByRepPage's hand-written version, which was
   * the one site in the tree doing this correctly.
   */
  optimistic?: (...args: A) => () => void;
  /** Re-throw the error to the caller instead of swallowing it. Default false. */
  rethrow?: boolean;
  /** Title used by the default error toast. */
  errorTitle?: string;
  /**
   * Toast notifier to use instead of the one from <AppProviders>. Only needed
   * by components that take `showToast` as a prop (PcWorkspace).
   */
  showToast?: (t: Toast) => void;
}

export interface UseMutationResult<A extends unknown[], R> {
  /** Runs the mutation. Resolves to the result, or undefined if it failed. */
  run: (...args: A) => Promise<R | undefined>;
  saving: boolean;
  /** The normalized message from the most recent failure, or null. */
  error: string | null;
}

export function useMutation<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  options: UseMutationOptions<A, R> = {},
): UseMutationResult<A, R> {
  const contextToast = useOptionalShowToast();
  const showToast = options.showToast ?? contextToast;
  if (!showToast) {
    throw new Error('useMutation needs <AppProviders> or an explicit showToast option');
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs, not the state: two clicks in the same tick both read the pre-render
  // value of `saving`, so the guard has to be something that updates instantly.
  const busy = useRef(false);
  const inFlight = useRef<Promise<R | undefined> | null>(null);

  // Held in a ref so `run` keeps a stable identity and callers can safely put
  // it in an effect's dependency list.
  const optsRef = useRef(options);
  optsRef.current = options;
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    // Double-submit is a no-op: the second caller waits on the first request
    // rather than starting a second one.
    if (busy.current && inFlight.current) return inFlight.current;

    const opts = optsRef.current;
    const rollback = opts.optimistic?.(...args);

    busy.current = true;
    setSaving(true);
    setError(null);

    const promise = (async (): Promise<R | undefined> => {
      try {
        const result = await fnRef.current(...args);
        opts.onSuccess?.(result, ...args);
        const t = typeof opts.successToast === 'function'
          ? opts.successToast(result, ...args)
          : opts.successToast;
        if (t) toastRef.current(t);
        return result;
      } catch (err) {
        rollback?.();
        const message = apiErrorMessage(err);
        setError(message);
        if (opts.errorToast !== false) {
          const t = typeof opts.errorToast === 'function'
            ? opts.errorToast(message, err, ...args)
            : opts.errorToast ?? { title: opts.errorTitle ?? 'Something went wrong', sub: message };
          if (t) toastRef.current({ variant: 'error', ...t });
        }
        opts.onError?.(err, ...args);
        if (opts.rethrow) throw err;
        return undefined;
      } finally {
        // Cleared before `inFlight` is assigned below in the (rare) case where
        // `fn` throws synchronously — the guard reads `busy`, so a settled
        // promise left in `inFlight` is unreachable.
        busy.current = false;
        setSaving(false);
        opts.onSettled?.(...args);
      }
    })();

    inFlight.current = promise;
    return promise;
  }, []);

  return { run, saving, error };
}

export default useMutation;
