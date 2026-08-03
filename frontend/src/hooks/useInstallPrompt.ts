import { useCallback, useEffect, useState } from 'react';
import { isIOS, isStandalone as detectStandalone } from '../push';

// Mirrors push.ts's push-permission dismissal pattern: a plain localStorage flag so the
// iOS "Add to Home Screen" hint stays dismissed across sessions once the user closes it.
const IOS_HINT_DISMISSED_KEY = 'ios_a2hs_dismissed';

/** Chrome/Edge/Android fire this before showing their native install UI; Safari never does. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function readIosHintDismissed(): boolean {
  try {
    return localStorage.getItem(IOS_HINT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

interface UseInstallPromptResult {
  canInstall: boolean;
  promptInstall: () => Promise<void>;
  isIos: boolean;
  isStandalone: boolean;
  iosHintDismissed: boolean;
  dismissIosHint: () => void;
}

/**
 * Captures the browser's `beforeinstallprompt` event so the mobile More sheet can offer a
 * real "Install App" action on Chrome/Edge/Android. iOS Safari never fires that event, so
 * we separately surface isIos/isStandalone (reusing push.ts's detection, which already
 * drives the "install before enabling push" messaging) for a manual Add-to-Home-Screen hint.
 */
export function useInstallPrompt(): UseInstallPromptResult {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHintDismissed, setIosHintDismissed] = useState(readIosHintDismissed);

  const standalone = detectStandalone();
  const isIos = isIOS();

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    await deferredEvent.userChoice;
    // The captured event is single-use regardless of the user's choice — drop it either way.
    setDeferredEvent(null);
  }, [deferredEvent]);

  const dismissIosHint = useCallback(() => {
    try { localStorage.setItem(IOS_HINT_DISMISSED_KEY, '1'); } catch { /* private mode, etc. */ }
    setIosHintDismissed(true);
  }, []);

  return {
    canInstall: !!deferredEvent && !standalone,
    promptInstall,
    isIos,
    isStandalone: standalone,
    iosHintDismissed,
    dismissIosHint,
  };
}
