// Task 7 — URL: `?tab=estimating&step=<key>`. Reads/writes only the `step`
// param, merging onto whatever else is already in the URL (in particular
// BidHubPage's own `tab` param) rather than replacing the whole query string.
//
// Router-optional: PcWorkspaceView (the caller) is mounted, in production,
// under the app's <Router> (via BidHubPage) — but dozens of its existing unit
// tests render it standalone, with no <MemoryRouter> wrapper, because it had
// no router dependency before this hook existed. useInRouterContext() never
// throws either way, so branching on it (rather than letting useSearchParams()
// throw "useLocation() may be used only in the context of a <Router>" and
// corrupt every hook call after it in the same render) lets every one of
// those pre-existing tests keep working unchanged: outside a Router the step
// is component-local state only (no URL persistence, which is a fine
// degradation — the alternative is retrofitting a <MemoryRouter> onto every
// PcWorkspace*.test.tsx file). `inRouter` is invariant for the lifetime of a
// given mounted instance (whether a Router wraps you is a static fact about
// where you're rendered, not something that flips at runtime), so branching
// which hook implementation runs is safe despite looking like a conditional
// hook call.
import { useState } from 'react';
import { useSearchParams, useInRouterContext } from 'react-router-dom';
import { ESTIMATE_STEPS, EstimateStepKey } from './steps';

const VALID_STEPS = new Set<string>(ESTIMATE_STEPS.map(s => s.key));

function useRoutedStepParam(fallback: EstimateStepKey): [EstimateStepKey, (step: EstimateStepKey) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('step');
  const step: EstimateStepKey = raw && VALID_STEPS.has(raw) ? (raw as EstimateStepKey) : fallback;

  const setStep = (next: EstimateStepKey) => {
    setParams(prev => {
      const merged = new URLSearchParams(prev);
      merged.set('step', next);
      return merged;
    }, { replace: true });
  };

  return [step, setStep];
}

function useLocalStepState(fallback: EstimateStepKey): [EstimateStepKey, (step: EstimateStepKey) => void] {
  return useState<EstimateStepKey>(fallback);
}

export function useEstimateStepParam(fallback: EstimateStepKey): [EstimateStepKey, (step: EstimateStepKey) => void] {
  const inRouter = useInRouterContext();
  // eslint-disable-next-line react-hooks/rules-of-hooks -- see file header: inRouter is invariant per mounted instance.
  return inRouter ? useRoutedStepParam(fallback) : useLocalStepState(fallback);
}
