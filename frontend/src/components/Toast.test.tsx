// @vitest-environment happy-dom
// Audit ux #3 (Medium) — "Error and success toasts are visually identical".
// Toast.tsx rendered <Icon name="check"/> unconditionally and styles.css
// hardcoded `.toast .t-ic{background:var(--green-soft);color:var(--green)}`, so
// "Delete failed" arrived with the same green checkmark as "Document removed".
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';

afterEach(cleanup);

/** The rendered <svg>'s path markup, which is how the icon identity shows up. */
function iconMarkup(): string {
  const svg = document.querySelector('.toast .t-ic svg');
  return svg?.innerHTML ?? '';
}

const CHECK = 'M20 6L9 17l-5-5';

describe('Toast variants', () => {
  it('renders the alert icon and the error class for variant: error', () => {
    render(<Toast toast={{ title: 'Delete failed', sub: 'Server error', variant: 'error' }}/>);

    const el = document.querySelector('.toast')!;
    expect(el.classList.contains('t-error')).toBe(true);
    // Screen readers get it too, not just sighted users.
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('aria-live')).toBe('assertive');

    // Not the green check.
    expect(iconMarkup()).not.toContain(CHECK);
    // The alert triangle plus its exclamation dot.
    expect(iconMarkup()).toContain('M12 3.2 1.8 20.8h20.4L12 3.2z');
    expect(screen.getByText('Delete failed')).toBeTruthy();
  });

  it('still renders the green check and no variant class by default', () => {
    render(<Toast toast={{ title: 'Document removed' }}/>);

    const el = document.querySelector('.toast')!;
    expect(el.classList.contains('t-error')).toBe(false);
    expect(el.classList.contains('t-info')).toBe(false);
    expect(el.getAttribute('role')).toBe('status');
    expect(iconMarkup()).toContain(CHECK);
  });

  it('renders a neutral icon for variant: info', () => {
    render(<Toast toast={{ title: 'No amount found', variant: 'info' }}/>);

    expect(document.querySelector('.toast')!.classList.contains('t-info')).toBe(true);
    expect(iconMarkup()).not.toContain(CHECK);
  });
});

describe('useToast timing', () => {
  it('holds an error toast for 7s and a success toast for 4.2s', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useToast());

      act(() => result.current.showToast({ title: 'Saved' }));
      act(() => { vi.advanceTimersByTime(4199); });
      expect(result.current.toast).not.toBeNull();
      act(() => { vi.advanceTimersByTime(2); });
      expect(result.current.toast).toBeNull();

      act(() => result.current.showToast({ title: 'Save failed', variant: 'error' }));
      act(() => { vi.advanceTimersByTime(4300); });
      expect(result.current.toast).not.toBeNull();
      act(() => { vi.advanceTimersByTime(2800); });
      expect(result.current.toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('replacing a toast cancels the previous timer instead of cutting the new one short', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useToast());

      act(() => result.current.showToast({ title: 'First' }));
      act(() => { vi.advanceTimersByTime(4000); });
      act(() => result.current.showToast({ title: 'Second' }));
      // The first toast's 4.2s deadline lands here and must not clear the second.
      act(() => { vi.advanceTimersByTime(300); });
      expect(result.current.toast?.title).toBe('Second');
    } finally {
      vi.useRealTimers();
    }
  });
});
