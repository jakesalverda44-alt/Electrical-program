// Task 7 — the Estimating workspace shell: left step rail + center work area
// + right Bid Summary panel. Replaces the old TabStrip + StepTracker chrome
// inside PcWorkspaceView (state/autosave/data-fetching ownership is
// unchanged — this component only renders the chrome around whatever the
// caller passes as `children`/`summary` for the current step).
import React, { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import { ESTIMATE_STEPS, EstimateStepKey, stepHint } from './steps';
import './estimating.css';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type Breakpoint = 'desktop' | 'tablet' | 'mobile';

function getBreakpoint(): Breakpoint {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  if (window.matchMedia('(min-width: 1280px)').matches) return 'desktop';
  if (window.matchMedia('(min-width: 900px)').matches) return 'tablet';
  return 'mobile';
}

/** Tracks the two breakpoints the shell's 3-column/2-column/1-column layouts
 *  switch on. Same addEventListener-with-Safari-fallback shape as the app's
 *  existing useIsMobile() hook, just watching two queries instead of one. */
export function useEstimateBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(getBreakpoint);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mqlDesktop = window.matchMedia('(min-width: 1280px)');
    const mqlTablet = window.matchMedia('(min-width: 900px)');
    const update = () => setBp(getBreakpoint());
    update();

    const attach = (mql: MediaQueryList) => {
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', update);
        return () => mql.removeEventListener('change', update);
      }
      const legacy = mql as unknown as {
        addListener?: (h: () => void) => void;
        removeListener?: (h: () => void) => void;
      };
      legacy.addListener?.(update);
      return () => legacy.removeListener?.(update);
    };
    const detachDesktop = attach(mqlDesktop);
    const detachTablet = attach(mqlTablet);
    return () => { detachDesktop(); detachTablet(); };
  }, []);

  return bp;
}

export interface EstimateShellProps {
  currentStep: EstimateStepKey;
  onSelectStep: (key: EstimateStepKey) => void;
  doneByStep: Record<EstimateStepKey, boolean>;
  saveState: SaveState;
  summary: React.ReactNode;
  children: React.ReactNode;
  nextAction?: { label: string; onClick: () => void } | null;
}

function saveStateText(saveState: SaveState): string {
  switch (saveState) {
    case 'saving': return 'Saving…';
    case 'saved': return 'Saved';
    case 'error': return 'Not saved — retrying';
    default: return '';
  }
}

export function EstimateShell({
  currentStep, onSelectStep, doneByStep, saveState, summary, children, nextAction,
}: EstimateShellProps) {
  const breakpoint = useEstimateBreakpoint();
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const currentIndex = ESTIMATE_STEPS.findIndex(s => s.key === currentStep);
  const currentLabel = ESTIMATE_STEPS[currentIndex]?.label ?? '';

  const rail = (
    <nav className="est-rail" aria-label="Estimate steps" data-testid="est-rail">
      <div className="est-rail-header">
        <span className="est-rail-title">Estimate</span>
        <span
          data-testid="est-save-state"
          className={`est-save-state${saveState === 'error' ? ' est-save-state-error' : ''}`}
        >
          {saveStateText(saveState)}
        </span>
      </div>
      {ESTIMATE_STEPS.map((step, i) => {
        const done = !!doneByStep[step.key];
        const active = step.key === currentStep;
        const hint = stepHint(step.key, doneByStep);
        return (
          <button
            key={step.key}
            type="button"
            className={`est-rail-step${active ? ' est-rail-step-active' : ''}${done ? ' est-rail-step-done' : ''}`}
            onClick={() => onSelectStep(step.key)}
            data-testid={`est-step-${step.key}`}
            aria-current={active ? 'step' : undefined}
          >
            <span className="est-rail-step-marker">
              {done ? <Icon name="check" size={13} stroke={2.5} /> : i + 1}
            </span>
            <span className="est-rail-step-label">
              {step.label}
              {hint && <span className="est-rail-step-hint">{hint}</span>}
            </span>
          </button>
        );
      })}
    </nav>
  );

  const chipRow = (
    <nav className="est-chip-row" aria-label="Estimate steps" data-testid="est-rail">
      <div className="est-chip-row-savestate" data-testid="est-save-state-mobile">
        {saveStateText(saveState)}
      </div>
      <div className="est-chip-row-chips">
        {ESTIMATE_STEPS.map((step, i) => {
          const done = !!doneByStep[step.key];
          const active = step.key === currentStep;
          return (
            <button
              key={step.key}
              type="button"
              className={`est-chip${active ? ' est-chip-active' : ''}${done ? ' est-chip-done' : ''}`}
              onClick={() => onSelectStep(step.key)}
              data-testid={`est-step-${step.key}`}
            >
              {done ? <Icon name="check" size={12} stroke={2.5} /> : <span>{i + 1}</span>}
              {step.label}
            </button>
          );
        })}
      </div>
    </nav>
  );

  const work = (
    <main className="est-work" data-testid="est-work">
      <div className="est-work-header">
        <span className="est-work-step-index">{currentIndex + 1} · {currentLabel}</span>
      </div>
      <div className="est-work-body">{children}</div>
      {nextAction && (
        <div className="est-work-next">
          <button type="button" className="btn primary" onClick={nextAction.onClick}>
            Next: {nextAction.label}
          </button>
        </div>
      )}
    </main>
  );

  if (breakpoint === 'mobile') {
    return (
      <div className="est-shell est-shell-mobile" data-testid="est-shell" data-breakpoint={breakpoint}>
        {chipRow}
        {work}
        <div className="est-summary-bottom" data-testid="est-summary-bottom">{summary}</div>
      </div>
    );
  }

  if (breakpoint === 'tablet') {
    return (
      <div className="est-shell est-shell-tablet" data-testid="est-shell" data-breakpoint={breakpoint}>
        {rail}
        <div className="est-tablet-main">
          <button
            type="button"
            className="est-summary-slim"
            data-testid="est-summary-slim-toggle"
            onClick={() => setSummaryExpanded(v => !v)}
            aria-expanded={summaryExpanded}
          >
            <span>Bid Summary</span>
            <Icon name="chevron-down" size={14} stroke={2} style={summaryExpanded ? { transform: 'rotate(180deg)' } : undefined} />
          </button>
          {summaryExpanded && <div className="est-summary-slim-body" data-testid="est-summary-slim-body">{summary}</div>}
          {work}
        </div>
      </div>
    );
  }

  return (
    <div className="est-shell est-shell-desktop" data-testid="est-shell" data-breakpoint={breakpoint}>
      {rail}
      {work}
      <aside className="est-summary" data-testid="est-summary">{summary}</aside>
    </div>
  );
}
