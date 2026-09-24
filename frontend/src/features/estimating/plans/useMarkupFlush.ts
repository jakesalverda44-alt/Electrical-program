// Re-run reset fix round S6 — lets the workspace save pending plan markup
// on demand before a re-run resets the takeoff (the reset would otherwise
// orphan markup still waiting on its debounce). Resolves true once the
// markup autosave settles as saved, false when the save fails or times out.
import { useEffect, useRef } from 'react';

type Status = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export function useMarkupFlush(
  status: Status,
  retryNow: () => void,
  register: ((flush: (() => Promise<boolean>) | null) => void) | undefined,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): void {
  const statusRef = useRef(status);
  statusRef.current = status;
  const retryRef = useRef(retryNow);
  retryRef.current = retryNow;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pollMs = opts.pollMs ?? 50;
  useEffect(() => {
    if (!register) return;
    const flush = async (): Promise<boolean> => {
      const settled = () => statusRef.current === 'idle' || statusRef.current === 'saved';
      if (settled()) return true;
      retryRef.current();
      const started = Date.now();
      let sawAttempt = false;
      while (Date.now() - started < timeoutMs) {
        await new Promise(r => setTimeout(r, pollMs));
        if (settled()) return true;
        if (statusRef.current === 'saving' || statusRef.current === 'pending') sawAttempt = true;
        // An 'error' left over from before the forced attempt is not its result.
        if (statusRef.current === 'error' && (sawAttempt || Date.now() - started > 300)) return false;
      }
      return false;
    };
    register(flush);
    return () => register(null);
  }, [register, timeoutMs, pollMs]);
}
