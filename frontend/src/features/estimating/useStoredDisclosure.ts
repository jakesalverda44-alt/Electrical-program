// UI cleanup round 2B — an open/closed section remembered per browser. Unlike
// useStoredToggle, nothing is stored until the estimator clicks: until then the
// section follows `defaultOpen` live (Quotes opens by itself once a quote exists).
import { useCallback, useState } from 'react';

function read(key: string): boolean | null {
  try {
    const v = window.localStorage.getItem(key);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

export function useStoredDisclosure(key: string, defaultOpen: boolean): { open: boolean; toggle: () => void } {
  const [stored, setStored] = useState<boolean | null>(() => read(key));
  const open = stored ?? defaultOpen;
  const toggle = useCallback(() => {
    const next = !open;
    setStored(next);
    try { window.localStorage.setItem(key, next ? '1' : '0'); } catch { /* private mode — works for this session only */ }
  }, [key, open]);
  return { open, toggle };
}
