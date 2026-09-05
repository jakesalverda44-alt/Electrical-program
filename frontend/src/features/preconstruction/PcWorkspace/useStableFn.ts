import { useCallback, useRef } from 'react';

/**
 * A callback whose identity never changes but which always calls the latest
 * closure it was given.
 *
 * The workspace parent re-renders on every keystroke (its `ws` lives in
 * App.tsx), so a handler declared inline is a new function each time. Handing
 * one of those to a `React.memo` tab defeats the memo entirely. Wrapping it
 * here fixes the identity without changing when or with what the handler runs
 * — the ref is reassigned during render, so by the time any event fires it
 * already points at this render's version.
 */
export function useStableFn<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
