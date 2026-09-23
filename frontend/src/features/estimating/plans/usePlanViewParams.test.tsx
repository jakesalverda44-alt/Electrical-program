// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { usePlanViewParams } from './usePlanViewParams';

afterEach(cleanup);
beforeEach(() => { window.localStorage.clear(); });

function wrapper({ children, initialEntries }: { children: React.ReactNode; initialEntries: string[] }) {
  return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
}

describe('usePlanViewParams — inside a Router', () => {
  it('defaults to "list" when the URL has no view param and nothing is stored', () => {
    const { result } = renderHook(() => usePlanViewParams(), {
      wrapper: (p) => wrapper({ ...p, initialEntries: ['/bid/1?tab=estimating&step=takeoff'] }),
    });
    expect(result.current.view).toBe('list');
    expect(result.current.sheetKey).toBeNull();
    expect(result.current.lineKey).toBeNull();
  });

  it('reads view/sheet/line from the URL', () => {
    const { result } = renderHook(() => usePlanViewParams(), {
      wrapper: (p) => wrapper({ ...p, initialEntries: ['/bid/1?step=takeoff&view=plans&sheet=doc-1:0&line=k1'] }),
    });
    expect(result.current.view).toBe('plans');
    expect(result.current.sheetKey).toBe('doc-1:0');
    expect(result.current.lineKey).toBe('k1');
  });

  it('setView writes into the URL, merged with existing params, and persists to localStorage', () => {
    function Harness() {
      const { view, setView } = usePlanViewParams();
      const [params] = useSearchParams();
      return (
        <div>
          <span data-testid="view">{view}</span>
          <span data-testid="step-param">{params.get('step')}</span>
          <button onClick={() => setView('plans')}>Switch to Plans</button>
        </div>
      );
    }
    render(<MemoryRouter initialEntries={['/bid/1?step=takeoff']}><Harness/></MemoryRouter>);
    act(() => { fireEvent.click(screen.getByText('Switch to Plans')); });
    expect(screen.getByTestId('view').textContent).toBe('plans');
    expect(screen.getByTestId('step-param').textContent).toBe('takeoff'); // untouched
    expect(window.localStorage.getItem('apt-estimating-takeoff-view')).toBe('plans');
  });

  it('falls back to the stored mode when the URL has no view param', () => {
    window.localStorage.setItem('apt-estimating-takeoff-view', 'plans');
    const { result } = renderHook(() => usePlanViewParams(), {
      wrapper: (p) => wrapper({ ...p, initialEntries: ['/bid/1?step=takeoff'] }),
    });
    expect(result.current.view).toBe('plans');
  });

  it('setSheetKey/setLineKey write and clear their own params independently', () => {
    function Harness() {
      const { sheetKey, lineKey, setSheetKey, setLineKey } = usePlanViewParams();
      return (
        <div>
          <span data-testid="sheet">{sheetKey ?? 'none'}</span>
          <span data-testid="line">{lineKey ?? 'none'}</span>
          <button onClick={() => setSheetKey('doc-2:1')}>set sheet</button>
          <button onClick={() => setLineKey('k9')}>set line</button>
          <button onClick={() => setLineKey(null)}>clear line</button>
        </div>
      );
    }
    render(<MemoryRouter initialEntries={['/bid/1?step=takeoff']}><Harness/></MemoryRouter>);
    act(() => { fireEvent.click(screen.getByText('set sheet')); });
    act(() => { fireEvent.click(screen.getByText('set line')); });
    expect(screen.getByTestId('sheet').textContent).toBe('doc-2:1');
    expect(screen.getByTestId('line').textContent).toBe('k9');
    act(() => { fireEvent.click(screen.getByText('clear line')); });
    expect(screen.getByTestId('line').textContent).toBe('none');
    expect(screen.getByTestId('sheet').textContent).toBe('doc-2:1'); // untouched by clearing line
  });
});

describe('usePlanViewParams — outside a Router', () => {
  it('degrades to local state instead of throwing', () => {
    const { result } = renderHook(() => usePlanViewParams());
    expect(result.current.view).toBe('list');
    act(() => { result.current.setView('plans'); });
    expect(result.current.view).toBe('plans');
    act(() => { result.current.setSheetKey('doc-1:0'); });
    expect(result.current.sheetKey).toBe('doc-1:0');
  });

  it('still persists the view choice to localStorage outside a Router', () => {
    const { result } = renderHook(() => usePlanViewParams());
    act(() => { result.current.setView('plans'); });
    expect(window.localStorage.getItem('apt-estimating-takeoff-view')).toBe('plans');
  });
});
