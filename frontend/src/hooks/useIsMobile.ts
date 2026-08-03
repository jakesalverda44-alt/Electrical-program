import { useEffect, useState } from 'react';

const QUERY = '(max-width: 768px)';

function getMatches(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

// Tracks the "(max-width: 768px)" breakpoint used across the app to switch between
// desktop and mobile-field layouts (e.g. Leads list cards vs. table, Task 6 builder).
// Falls back to `false` in environments without `matchMedia` (SSR, older test DOMs)
// instead of throwing.
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(getMatches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    // Safari <14 fallback.
    const legacy = mql as unknown as {
      addListener?: (h: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (h: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(handler);
    return () => legacy.removeListener?.(handler);
  }, []);

  return isMobile;
}
