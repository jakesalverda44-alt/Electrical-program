// Task 7 — the Estimating workspace shell: left step rail + center work area
// + right Bid Summary panel. Replaces the old TabStrip + StepTracker chrome
// inside PcWorkspaceView (state/autosave/data-fetching ownership is
// unchanged — this component only renders the chrome around whatever the
// caller passes as `children`/`summary` for the current step).
import React, { useEffect, useId, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import { ESTIMATE_STEPS, EstimateStepKey, stepHint } from './steps';
import { useStoredToggle } from './useStoredToggle';
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
  /** Phase B, Decision 1 — the Plans view needs the drawing's full width, so
   *  the Takeoff step forces the Bid Summary into its collapsed slim-bar
   *  form even at the desktop breakpoint (which otherwise always shows the
   *  full `<aside>`). Reuses the SAME slim-toggle chrome the tablet layout
   *  already has — the tablet layout is unaffected either way (it's already
   *  as collapsed as this makes desktop). Default false: every existing
   *  caller/step keeps today's desktop layout unchanged. */
  forceSlimSummary?: boolean;
  /** UI cleanup round 1 — the collapsed right sidebar's content (total +
   *  warning count). The summary collapse toggle only renders when this is
   *  provided, so a caller without a strip can never hide warnings. */
  summaryStrip?: React.ReactNode;
  /** UI cleanup round 1 — the takeoff is running; steps show "Takeoff running…". */
  analysisRunning?: boolean;
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
  currentStep, onSelectStep, doneByStep, saveState, summary, children, nextAction, forceSlimSummary, summaryStrip, analysisRunning,
}: EstimateShellProps) {
  const breakpoint = useEstimateBreakpoint();
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const currentIndex = ESTIMATE_STEPS.findIndex(s => s.key === currentStep);
  const currentLabel = ESTIMATE_STEPS[currentIndex]?.label ?? '';
  // UI cleanup round 1 — collapsible sidebars, remembered per browser.
  const [railCollapsed, toggleRail] = useStoredToggle('est-rail-collapsed');
  const [summaryCollapsed, toggleSummary] = useStoredToggle('est-summary-collapsed');
  const railStepsId = useId();
  const summaryPanelId = useId();
  // The summary toggle is a different element in each state, so move focus to
  // the new one after a toggle. (The rail toggle stays mounted.)
  const summaryToggleRef = useRef<HTMLButtonElement>(null);
  const summaryToggledRef = useRef(false);
  const onToggleSummary = () => { summaryToggledRef.current = true; toggleSummary(); };
  useEffect(() => {
    if (summaryToggledRef.current) { summaryToggledRef.current = false; summaryToggleRef.current?.focus(); }
  }, [summaryCollapsed]);
  const saveText = saveStateText(saveState);

  const railToggle = (
    <button
      type="button"
      className="est-panel-toggle"
      data-testid="est-rail-toggle"
      aria-expanded={!railCollapsed}
      aria-controls={railStepsId}
      aria-label={railCollapsed ? 'Expand steps' : 'Collapse steps'}
      title={railCollapsed ? 'Expand steps' : 'Collapse steps'}
      onClick={toggleRail}
    >
      <Icon name="chevron-down" size={14} stroke={2} style={{ transform: railCollapsed ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
    </button>
  );

  const rail = (
    <nav
      className={`est-rail${railCollapsed ? ' est-rail-collapsed' : ''}`}
      aria-label="Estimate steps"
      data-testid="est-rail"
      data-collapsed={String(railCollapsed)}
    >
      <div className="est-rail-header">
        {railCollapsed ? (
          <>
            {railToggle}
            <span
              data-testid="est-save-state"
              className={`est-save-state-compact${saveState === 'error' ? ' est-save-state-error' : ''}`}
              title={saveText || undefined}
            >
              {saveState === 'error' && <Icon name="alert" size={14} stroke={2} />}
              {saveState === 'saving' && <span aria-hidden="true">…</span>}
              <span className="est-sr-only">{saveText}</span>
            </span>
          </>
        ) : (
          <>
            <span className="est-rail-title">Estimate</span>
            <span
              data-testid="est-save-state"
              className={`est-save-state${saveState === 'error' ? ' est-save-state-error' : ''}`}
            >
              {saveText}
            </span>
            {railToggle}
          </>
        )}
      </div>
      <div id={railStepsId} className="est-rail-steps">
        {ESTIMATE_STEPS.map((step, i) => {
          const done = !!doneByStep[step.key];
          const active = step.key === currentStep;
          const hint = stepHint(step.key, doneByStep, { analysisRunning });
          const name = `${i + 1}. ${step.label}${done ? ' — done' : ''}${hint ? ` — ${hint}` : ''}`;
          return (
            <button
              key={step.key}
              type="button"
              className={`est-rail-step${active ? ' est-rail-step-active' : ''}${done ? ' est-rail-step-done' : ''}`}
              onClick={() => onSelectStep(step.key)}
              data-testid={`est-step-${step.key}`}
              aria-current={active ? 'step' : undefined}
              aria-label={railCollapsed ? name : undefined}
              title={railCollapsed ? name : undefined}
            >
              <span className="est-rail-step-marker">
                {done ? <Icon name="check" size={13} stroke={2.5} /> : i + 1}
              </span>
              {!railCollapsed && (
                <span className="est-rail-step-label">
                  {step.label}
                  {hint && <span className="est-rail-step-hint">{hint}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
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

  const slimSummary = (
    <>
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
    </>
  );

  if (breakpoint === 'tablet') {
    return (
      <div className="est-shell est-shell-tablet" data-testid="est-shell" data-breakpoint={breakpoint}>
        {rail}
        <div className="est-tablet-main">
          {slimSummary}
          {work}
        </div>
      </div>
    );
  }

  if (forceSlimSummary) {
    return (
      <div className="est-shell est-shell-desktop est-shell-slim" data-testid="est-shell" data-breakpoint={breakpoint}>
        {rail}
        <div className="est-tablet-main">
          {slimSummary}
          {work}
        </div>
      </div>
    );
  }

  return (
    <div className="est-shell est-shell-desktop" data-testid="est-shell" data-breakpoint={breakpoint}>
      {rail}
      {work}
      {summaryStrip && summaryCollapsed ? (
        <aside className="est-summary est-summary-collapsed" id={summaryPanelId} data-testid="est-summary-collapsed">
          <button
            type="button"
            ref={summaryToggleRef}
            className="est-summary-expand"
            data-testid="est-summary-toggle"
            aria-expanded={false}
            aria-controls={summaryPanelId}
            onClick={onToggleSummary}
          >
            <Icon name="chevron-down" size={14} stroke={2} style={{ transform: 'rotate(90deg)' }} />
            {summaryStrip}
          </button>
        </aside>
      ) : (
        <aside className="est-summary" id={summaryPanelId} data-testid="est-summary">
          {summaryStrip && (
            <div className="est-summary-head">
              <span className="est-summary-title">Bid summary</span>
              <button
                type="button"
                ref={summaryToggleRef}
                className="est-panel-toggle"
                data-testid="est-summary-toggle"
                aria-expanded={true}
                aria-controls={summaryPanelId}
                aria-label="Collapse bid summary"
                title="Collapse bid summary"
                onClick={onToggleSummary}
              >
                <Icon name="chevron-down" size={14} stroke={2} style={{ transform: 'rotate(-90deg)' }} />
              </button>
            </div>
          )}
          {summary}
        </aside>
      )}
    </div>
  );
}
