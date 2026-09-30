// UI cleanup round 1 — a boolean remembered per browser in localStorage (used
// for the collapsible sidebars). Same guarded-storage pattern as
// plans/usePlanViewParams.ts: every read/write is try/caught, so private mode
// or blocked storage just means the choice lasts for this session only.
import { useCallback, useEffect, useRef, useState } from 'react';

function read(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    return v === '1' ? true : v === '0' ? false : fallback;
  } catch {
    return fallback;
  }
}

export function useStoredToggle(key: string, fallback = false): [boolean, () => void] {
  const [value, setValue] = useState<boolean>(() => read(key, fallback));
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    try { window.localStorage.setItem(key, value ? '1' : '0'); } catch { /* private mode — works for this session only */ }
  }, [key, value]);
  const toggle = useCallback(() => setValue(v => !v), []);
  return [value, toggle];
}
