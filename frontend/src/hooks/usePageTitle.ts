import { useEffect } from 'react';

const SUFFIX = 'APT CRM';

/**
 * Sets `document.title` for as long as the calling page is mounted, restoring
 * the previous value on unmount. `document.title` was never set anywhere, so
 * every tab and PWA app-switcher card read "Accurate Power CRM" regardless of
 * what was open — comparing two bids in two tabs meant guessing (audit ux #18).
 *
 * Pass null while the record name is still loading to leave the title alone
 * rather than flashing an empty one.
 */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${SUFFIX}`;
    return () => { document.title = previous; };
  }, [title]);
}

export default usePageTitle;
