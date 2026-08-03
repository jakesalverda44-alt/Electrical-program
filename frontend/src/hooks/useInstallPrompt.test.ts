// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInstallPrompt } from './useInstallPrompt';

const IOS_HINT_KEY = 'ios_a2hs_dismissed';

/** Chrome/Edge fire a real Event with prompt()/userChoice bolted on — mimic that shape. */
class FakeBeforeInstallPromptEvent extends Event {
  prompt = vi.fn().mockResolvedValue(undefined);
  userChoice = Promise.resolve({ outcome: 'accepted' as const, platform: 'web' });
  constructor() {
    super('beforeinstallprompt', { cancelable: true });
  }
}

function mockMatchMedia(standalone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(display-mode: standalone)' && standalone,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useInstallPrompt', () => {
  it('starts with canInstall false, then flips true once beforeinstallprompt fires', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);

    const event = new FakeBeforeInstallPromptEvent();
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    act(() => { window.dispatchEvent(event); });

    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);
    expect(result.current.canInstall).toBe(true);
  });

  it('promptInstall() calls the stashed event.prompt() and clears canInstall after userChoice', async () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useInstallPrompt());
    const event = new FakeBeforeInstallPromptEvent();
    act(() => { window.dispatchEvent(event); });
    expect(result.current.canInstall).toBe(true);

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.canInstall).toBe(false);
  });

  it('promptInstall() is a no-op when no event has been captured', async () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useInstallPrompt());
    await act(async () => {
      await expect(result.current.promptInstall()).resolves.toBeUndefined();
    });
    expect(result.current.canInstall).toBe(false);
  });

  it('reports isStandalone true and keeps canInstall false even if the event fires', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isStandalone).toBe(true);

    const event = new FakeBeforeInstallPromptEvent();
    act(() => { window.dispatchEvent(event); });

    expect(result.current.canInstall).toBe(false);
  });

  it('dismissIosHint() flips iosHintDismissed and persists it to localStorage', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.iosHintDismissed).toBe(false);
    expect(localStorage.getItem(IOS_HINT_KEY)).toBeNull();

    act(() => { result.current.dismissIosHint(); });

    expect(result.current.iosHintDismissed).toBe(true);
    expect(localStorage.getItem(IOS_HINT_KEY)).toBe('1');
  });

  it('reads a prior iOS hint dismissal from localStorage on mount', () => {
    mockMatchMedia(false);
    localStorage.setItem(IOS_HINT_KEY, '1');
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.iosHintDismissed).toBe(true);
  });

  it('removes the beforeinstallprompt listener on unmount', () => {
    mockMatchMedia(false);
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useInstallPrompt());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function));
  });
});
