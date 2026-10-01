// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { EstimateShell } from './EstimateShell';
import { EstimateStepKey } from './steps';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

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
  documents: true, takeoff: true, scope: false, rfis: false, pricing: false, review: false,
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
  it('renders all six steps in order', () => {
    mockMatchMedia(1400);
    renderShell();
    const rail = screen.getByTestId('est-rail');
    const labels = ['Documents', 'Takeoff', 'Scope', 'RFIs', 'Labor & Pricing', 'Review & Proposal'];
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
      doneByStep: { documents: false, takeoff: false, scope: false, rfis: false, pricing: false, review: false },
    });
    expect(screen.getByTestId('est-step-pricing').textContent).toContain('Needs RFIs first');
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
    expect(screen.getByTestId('est-work').textContent).toContain('5 · Labor & Pricing');
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

// UI cleanup round 1 — collapsible sidebars.
describe('EstimateShell — collapsible rail', () => {
  it('collapses via the toggle, keeping steps clickable and remembering the choice', () => {
    mockMatchMedia(1400);
    const { onSelectStep } = renderShell();
    const rail = screen.getByTestId('est-rail');
    fireEvent.click(screen.getByTestId('est-rail-toggle'));
    expect(rail.getAttribute('data-collapsed')).toBe('true');
    const toggle = screen.getByTestId('est-rail-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const controlled = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(controlled).toBeTruthy();
    expect(within(controlled!).getByTestId('est-step-takeoff')).toBeTruthy();
    const takeoff = screen.getByTestId('est-step-takeoff');
    expect(takeoff.getAttribute('aria-label')).toBe('2. Takeoff — done');
    expect(takeoff.getAttribute('title')).toBe('2. Takeoff — done');
    expect(rail.textContent).not.toContain('Labor & Pricing');
    expect(localStorage.getItem('est-rail-collapsed')).toBe('1');
    fireEvent.click(screen.getByTestId('est-step-review'));
    expect(onSelectStep).toHaveBeenCalledWith('review');
  });

  it('mounts collapsed when the preference is stored', () => {
    localStorage.setItem('est-rail-collapsed', '1');
    mockMatchMedia(1400);
    renderShell();
    expect(screen.getByTestId('est-rail').getAttribute('data-collapsed')).toBe('true');
  });

  it('never hides a save error when collapsed', () => {
    localStorage.setItem('est-rail-collapsed', '1');
    mockMatchMedia(1400);
    renderShell({ saveState: 'error' });
    expect(screen.getByTestId('est-save-state').textContent).toBe('Not saved — retrying');
  });

  it('also collapses at tablet width', () => {
    mockMatchMedia(1000);
    renderShell();
    fireEvent.click(screen.getByTestId('est-rail-toggle'));
    expect(screen.getByTestId('est-rail').getAttribute('data-collapsed')).toBe('true');
  });

  it('falls back to expanded (and does not throw) when storage is blocked', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    mockMatchMedia(1400);
    renderShell();
    expect(screen.getByTestId('est-rail').getAttribute('data-collapsed')).toBe('false');
    fireEvent.click(screen.getByTestId('est-rail-toggle'));
    expect(screen.getByTestId('est-rail').getAttribute('data-collapsed')).toBe('true');
  });

  it('shows "Takeoff running…" on later steps while the analysis runs', () => {
    mockMatchMedia(1400);
    renderShell({ analysisRunning: true, doneByStep: { documents: true, takeoff: false, scope: false, rfis: false, pricing: false, review: false } });
    expect(screen.getByTestId('est-step-scope').textContent).toContain('Takeoff running…');
  });
});

describe('EstimateShell — collapsible bid summary', () => {
  const strip = <span data-testid="strip">$1K</span>;

  it('has no summary toggle without a summaryStrip (warnings can never be hidden)', () => {
    mockMatchMedia(1400);
    renderShell();
    expect(screen.queryByTestId('est-summary-toggle')).toBeNull();
  });

  it('collapses to the strip, remembers it, moves focus, and expands again', () => {
    mockMatchMedia(1400);
    renderShell({ summaryStrip: strip });
    fireEvent.click(screen.getByTestId('est-summary-toggle'));
    expect(screen.queryByTestId('est-summary')).toBeNull();
    const collapsed = screen.getByTestId('est-summary-collapsed');
    expect(within(collapsed).getByTestId('strip')).toBeTruthy();
    expect(screen.getByTestId('est-summary-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('est-summary-collapsed')).toBe('1');
    expect(document.activeElement).toBe(screen.getByTestId('est-summary-toggle'));
    fireEvent.click(screen.getByTestId('est-summary-toggle'));
    expect(screen.getByTestId('est-summary')).toBeTruthy();
    expect(screen.getByTestId('summary-content')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('est-summary-toggle'));
  });

  it('ignores the preference at tablet width and with forceSlimSummary', () => {
    localStorage.setItem('est-summary-collapsed', '1');
    mockMatchMedia(1000);
    renderShell({ summaryStrip: strip });
    expect(screen.getByTestId('est-summary-slim-toggle')).toBeTruthy();
    expect(screen.queryByTestId('est-summary-collapsed')).toBeNull();
    cleanup();
    mockMatchMedia(1400);
    renderShell({ summaryStrip: strip, forceSlimSummary: true });
    expect(screen.getByTestId('est-summary-slim-toggle')).toBeTruthy();
    expect(screen.queryByTestId('est-summary-collapsed')).toBeNull();
  });
});
