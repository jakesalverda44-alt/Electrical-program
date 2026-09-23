// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { useEstimateStepParam } from './useEstimateStepParam';

afterEach(cleanup);

function wrapper({ children, initialEntries }: { children: React.ReactNode; initialEntries: string[] }) {
  return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
}

describe('useEstimateStepParam', () => {
  it('falls back to the given step when the URL has no step param', () => {
    const { result } = renderHook(() => useEstimateStepParam('documents'), {
      wrapper: (p) => wrapper({ ...p, initialEntries: ['/bid/1?tab=estimating'] }),
    });
    expect(result.current[0]).toBe('documents');
  });

  it('reads an initial step from the URL', () => {
    const { result } = renderHook(() => useEstimateStepParam('documents'), {
      wrapper: (p) => wrapper({ ...p, initialEntries: ['/bid/1?tab=estimating&step=pricing'] }),
    });
    expect(result.current[0]).toBe('pricing');
  });

  it('falls back for an invalid/unrecognized step value rather than crashing', () => {
    const { result } = renderHook(() => useEstimateStepParam('documents'), {
      wrapper: (p) => wrapper({ ...p, initialEntries: ['/bid/1?tab=estimating&step=bogus'] }),
    });
    expect(result.current[0]).toBe('documents');
  });

  it('setStep writes the step into the URL, merged with other params (never dropping `tab`)', () => {
    function Harness() {
      const [step, setStep] = useEstimateStepParam('documents');
      const [params] = useSearchParams();
      return (
        <div>
          <span data-testid="step">{step}</span>
          <span data-testid="tab-param">{params.get('tab')}</span>
          <span data-testid="step-param">{params.get('step')}</span>
          <button onClick={() => setStep('review')}>go</button>
        </div>
      );
    }
    render(<MemoryRouter initialEntries={['/bid/1?tab=estimating']}><Harness/></MemoryRouter>);
    expect(screen.getByTestId('tab-param').textContent).toBe('estimating');
    act(() => { fireEvent.click(screen.getByText('go')); });
    expect(screen.getByTestId('step').textContent).toBe('review');
    expect(screen.getByTestId('step-param').textContent).toBe('review');
    expect(screen.getByTestId('tab-param').textContent).toBe('estimating'); // untouched
  });
});

describe('useEstimateStepParam — outside a Router', () => {
  it('degrades to local component state instead of throwing (most PcWorkspaceView tests render with no Router)', () => {
    const { result } = renderHook(() => useEstimateStepParam('documents'));
    expect(result.current[0]).toBe('documents');
    act(() => { result.current[1]('review'); });
    expect(result.current[0]).toBe('review');
  });
});
