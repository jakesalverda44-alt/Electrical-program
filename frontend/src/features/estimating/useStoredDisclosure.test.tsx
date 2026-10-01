// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useStoredDisclosure } from './useStoredDisclosure';

function Probe({ k, def }: { k: string; def: boolean }) {
  const { open, toggle } = useStoredDisclosure(k, def);
  return <button type="button" data-testid="t" onClick={toggle}>{open ? 'open' : 'closed'}</button>;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('useStoredDisclosure', () => {
  it('follows defaultOpen on rerender until the estimator toggles', () => {
    const { rerender } = render(<Probe k="k1" def={false} />);
    expect(screen.getByTestId('t').textContent).toBe('closed');
    rerender(<Probe k="k1" def={true} />);
    expect(screen.getByTestId('t').textContent).toBe('open');
    expect(window.localStorage.getItem('k1')).toBeNull();
    fireEvent.click(screen.getByTestId('t'));
    expect(screen.getByTestId('t').textContent).toBe('closed');
    rerender(<Probe k="k1" def={true} />);
    expect(screen.getByTestId('t').textContent).toBe('closed');
  });

  it('writes 1 / 0 on toggle and a remount reads it back', () => {
    const { unmount } = render(<Probe k="k2" def={true} />);
    fireEvent.click(screen.getByTestId('t'));
    expect(window.localStorage.getItem('k2')).toBe('0');
    fireEvent.click(screen.getByTestId('t'));
    expect(window.localStorage.getItem('k2')).toBe('1');
    fireEvent.click(screen.getByTestId('t'));
    unmount();
    render(<Probe k="k2" def={true} />);
    expect(screen.getByTestId('t').textContent).toBe('closed');
  });

  it('ignores a garbage stored value', () => {
    window.localStorage.setItem('k3', 'maybe');
    render(<Probe k="k3" def={true} />);
    expect(screen.getByTestId('t').textContent).toBe('open');
  });

  it('still toggles when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<Probe k="k4" def={true} />);
    expect(screen.getByTestId('t').textContent).toBe('open');
    fireEvent.click(screen.getByTestId('t'));
    expect(screen.getByTestId('t').textContent).toBe('closed');
  });
});
