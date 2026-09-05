// @vitest-environment happy-dom
// Audit ux #3 (Medium) — "Error and success toasts are visually identical".
// Toast.tsx rendered <Icon name="check"/> unconditionally and styles.css
// hardcoded `.toast .t-ic{background:var(--green-soft);color:var(--green)}`, so
// "Delete failed" arrived with the same green checkmark as "Document removed".
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
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

  // Review round 1 S4: a double-click on "Undo" used to fire the restore POST
  // twice — the second call 404s on the already-restored row and surfaces a
  // false "Could not undo" error toast.
  describe('action button double-click guard (review round 1 S4)', () => {
    it('is a type="button" and calls the action only once no matter how many times it is clicked', () => {
      const onClick = vi.fn();
      render(<Toast toast={{ title: 'Generator project deleted', action: { label: 'Undo', onClick } }}/>);
      const btn = screen.getByText('Undo') as HTMLButtonElement;
      expect(btn.type).toBe('button');
      fireEvent.click(btn);
      fireEvent.click(btn);
      fireEvent.click(btn);
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(btn.disabled).toBe(true);
    });
  });

  // Review round 2 N3: `App.tsx` renders `{toast && <Toast toast={toast}/>}`
  // with no `key`, so `useToast`'s `showToast` replacing the toast object in
  // place re-renders the SAME Toast component instance rather than
  // remounting it. Round 1's S4 fix held `used` in component state with no
  // reset, so after clicking Undo on one toast, the guard stayed `true` and
  // the next toast's action button arrived permanently disabled/dead — even
  // though it is a different toast with its own action.
  describe('the used guard resets for the next toast (review round 2 N3)', () => {
    it('re-enables the action button, with a working onClick, when the same instance gets a new toast prop', () => {
      const onClickA = vi.fn();
      const onClickB = vi.fn();
      const { rerender } = render(
        <Toast toast={{ title: 'Generator project deleted', action: { label: 'Undo', onClick: onClickA } }}/>,
      );
      fireEvent.click(screen.getByText('Undo'));
      expect(onClickA).toHaveBeenCalledTimes(1);
      expect((screen.getByText('Undo') as HTMLButtonElement).disabled).toBe(true);

      // Same component instance (no key), new toast — the App.tsx pattern.
      rerender(
        <Toast toast={{ title: 'Electrical project deleted', action: { label: 'Undo', onClick: onClickB } }}/>,
      );
      const btnB = screen.getByText('Undo') as HTMLButtonElement;
      expect(btnB.disabled).toBe(false);
      fireEvent.click(btnB);
      expect(onClickB).toHaveBeenCalledTimes(1);
    });
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
