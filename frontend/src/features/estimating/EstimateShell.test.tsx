// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EstimateShell } from './EstimateShell';
import { EstimateStepKey } from './steps';

afterEach(cleanup);

function mockMatchMedia(widthPx: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const m = /min-width:\s*(\d+)px/.exec(query);
    const threshold = m ? Number(m[1]) : 0;
    return {
      matches: widthPx >= threshold,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
}

const ALL_DONE: Record<EstimateStepKey, boolean> = {
  documents: true, takeoff: true, pricing: false, scope: false, review: false,
};

function renderShell(overrides: Partial<React.ComponentProps<typeof EstimateShell>> = {}) {
  const onSelectStep = vi.fn();
  render(
    <EstimateShell
      currentStep="takeoff"
      onSelectStep={onSelectStep}
      doneByStep={ALL_DONE}
      saveState="idle"
      summary={<div data-testid="summary-content">Summary</div>}
      {...overrides}
    >
      <div data-testid="work-content">Work</div>
    </EstimateShell>
  );
  return { onSelectStep };
}

describe('EstimateShell — rail', () => {
  it('renders all five steps in order', () => {
    mockMatchMedia(1400);
    renderShell();
    const rail = screen.getByTestId('est-rail');
    const labels = ['Documents', 'Takeoff', 'Labor & Pricing', 'Scope & RFIs', 'Review & Proposal'];
    for (const label of labels) expect(rail.textContent).toContain(label);
    // Order: each label appears after the previous one in the rail's text.
    const indices = labels.map(l => rail.textContent!.indexOf(l));
    for (let i = 1; i < indices.length; i++) expect(indices[i]).toBeGreaterThan(indices[i - 1]);
  });

  it('marks done steps with a checkmark and the active step distinctly', () => {
    mockMatchMedia(1400);
    renderShell({ currentStep: 'takeoff', doneByStep: ALL_DONE });
    expect(screen.getByTestId('est-step-documents').className).toContain('est-rail-step-done');
    expect(screen.getByTestId('est-step-takeoff').className).toContain('est-rail-step-active');
    expect(screen.getByTestId('est-step-pricing').className).not.toContain('est-rail-step-done');
  });

  it('every step is clickable regardless of done status (no hard lock)', () => {
    mockMatchMedia(1400);
    const { onSelectStep } = renderShell();
    fireEvent.click(screen.getByTestId('est-step-review'));
    expect(onSelectStep).toHaveBeenCalledWith('review');
  });

  it('shows a "needs X first" hint under a step whose predecessor is not done', () => {
    mockMatchMedia(1400);
    renderShell({
      currentStep: 'documents',
      doneByStep: { documents: false, takeoff: false, pricing: false, scope: false, review: false },
    });
    expect(screen.getByTestId('est-step-pricing').textContent).toContain('Needs Takeoff first');
  });

  it('shows the save-state text in the rail header', () => {
    mockMatchMedia(1400);
    renderShell({ saveState: 'error' });
    const el = screen.getByTestId('est-save-state');
    expect(el.textContent).toBe('Not saved — retrying');
    expect(el.className).toContain('est-save-state-error');
  });
});

describe('EstimateShell — work area', () => {
  it('renders the step index/label header and the children content', () => {
    mockMatchMedia(1400);
    renderShell({ currentStep: 'pricing' });
    expect(screen.getByTestId('est-work').textContent).toContain('3 · Labor & Pricing');
    expect(screen.getByTestId('work-content')).toBeTruthy();
  });

  it('renders a "Next: <label>" action when provided', () => {
    mockMatchMedia(1400);
    const onClick = vi.fn();
    renderShell({ nextAction: { label: 'Labor & Pricing', onClick } });
    const btn = screen.getByText('Next: Labor & Pricing');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('EstimateShell — responsive layout', () => {
  it('renders the 3-column desktop layout at >=1280px', () => {
    mockMatchMedia(1400);
    renderShell();
    const shell = screen.getByTestId('est-shell');
    expect(shell.getAttribute('data-breakpoint')).toBe('desktop');
    expect(screen.getByTestId('est-summary')).toBeTruthy();
  });

  it('collapses the summary to a slim toggle bar between 900-1279px', () => {
    mockMatchMedia(1000);
    renderShell();
    const shell = screen.getByTestId('est-shell');
    expect(shell.getAttribute('data-breakpoint')).toBe('tablet');
    expect(screen.queryByTestId('est-summary')).toBeNull();
    expect(screen.queryByTestId('est-summary-slim-body')).toBeNull();
    fireEvent.click(screen.getByTestId('est-summary-slim-toggle'));
    expect(screen.getByTestId('est-summary-slim-body')).toBeTruthy();
  });

  it('renders a chip row rail and a sticky bottom summary below 900px', () => {
    mockMatchMedia(700);
    renderShell();
    const shell = screen.getByTestId('est-shell');
    expect(shell.getAttribute('data-breakpoint')).toBe('mobile');
    expect(screen.getByTestId('est-summary-bottom')).toBeTruthy();
    expect(screen.getByTestId('est-save-state-mobile')).toBeTruthy();
  });
});

// Phase B, Decision 1 — the Plans view forces the Bid Summary into its
// slim-bar form even at the desktop breakpoint.
describe('EstimateShell — forceSlimSummary (Phase B, Decision 1)', () => {
  it('at desktop width, WITHOUT forceSlimSummary, shows the full aside as before', () => {
    mockMatchMedia(1400);
    renderShell();
    expect(screen.getByTestId('est-summary')).toBeTruthy();
    expect(screen.queryByTestId('est-summary-slim-toggle')).toBeNull();
  });

  it('at desktop width, WITH forceSlimSummary, shows the slim toggle instead of the full aside', () => {
    mockMatchMedia(1400);
    renderShell({ forceSlimSummary: true });
    expect(screen.queryByTestId('est-summary')).toBeNull();
    expect(screen.getByTestId('est-summary-slim-toggle')).toBeTruthy();
  });

  it('the slim summary still expands to show its content on click, same as tablet', () => {
    mockMatchMedia(1400);
    renderShell({ forceSlimSummary: true });
    expect(screen.queryByTestId('summary-content')).toBeNull();
    fireEvent.click(screen.getByTestId('est-summary-slim-toggle'));
    expect(screen.getByTestId('summary-content')).toBeTruthy();
  });

  it('forceSlimSummary has no effect at the tablet/mobile breakpoints (already collapsed/bottom)', () => {
    mockMatchMedia(1000);
    renderShell({ forceSlimSummary: true });
    expect(screen.getByTestId('est-shell').getAttribute('data-breakpoint')).toBe('tablet');
    expect(screen.getByTestId('est-summary-slim-toggle')).toBeTruthy(); // same as the non-forced tablet case
  });
});
