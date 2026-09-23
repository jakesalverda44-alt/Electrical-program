// Estimating Phase B, Task 8 — the Takeoff step's List|Plans toggle state:
// `?step=takeoff&view=plans&sheet=<doc>:<page>&line=<key>`, merged onto
// whatever else is in the URL, plus a localStorage fallback (try/catch) so
// the estimator's last-used view (List vs Plans) is remembered across
// visits even before a sheet/line is picked. Router-optional, same pattern
// and same reasoning as useEstimateStepParam.ts (dozens of existing
// PcWorkspace*.test.tsx files render this tree with no <MemoryRouter>).
import { useCallback, useState } from 'react';
import { useSearchParams, useInRouterContext } from 'react-router-dom';

export type PlanViewMode = 'list' | 'plans';

const STORAGE_KEY = 'apt-estimating-takeoff-view';

function readStoredMode(): PlanViewMode | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'plans' || v === 'list' ? v : null;
  } catch {
    return null;
  }
}

function writeStoredMode(mode: PlanViewMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private browsing / storage disabled — the toggle still works for
    // this session, it just won't be remembered next time.
  }
}

export interface PlanViewParams {
  view: PlanViewMode;
  setView: (mode: PlanViewMode) => void;
  sheetKey: string | null;
  setSheetKey: (key: string | null) => void;
  lineKey: string | null;
  setLineKey: (key: string | null) => void;
}

function useRoutedPlanViewParams(): PlanViewParams {
  const [params, setParams] = useSearchParams();
  const raw = params.get('view');
  const view: PlanViewMode = raw === 'plans' || raw === 'list' ? raw : (readStoredMode() ?? 'list');

  const setView = useCallback((mode: PlanViewMode) => {
    writeStoredMode(mode);
    setParams(prev => {
      const merged = new URLSearchParams(prev);
      merged.set('view', mode);
      return merged;
    }, { replace: true });
  }, [setParams]);

  const setSheetKey = useCallback((key: string | null) => {
    setParams(prev => {
      const merged = new URLSearchParams(prev);
      if (key) merged.set('sheet', key); else merged.delete('sheet');
      return merged;
    }, { replace: true });
  }, [setParams]);

  const setLineKey = useCallback((key: string | null) => {
    setParams(prev => {
      const merged = new URLSearchParams(prev);
      if (key) merged.set('line', key); else merged.delete('line');
      return merged;
    }, { replace: true });
  }, [setParams]);

  return { view, setView, sheetKey: params.get('sheet'), setSheetKey, lineKey: params.get('line'), setLineKey };
}

function useLocalPlanViewParams(): PlanViewParams {
  const [view, setViewState] = useState<PlanViewMode>(() => readStoredMode() ?? 'list');
  const [sheetKeyState, setSheetKey] = useState<string | null>(null);
  const [lineKeyState, setLineKey] = useState<string | null>(null);
  const setView = useCallback((mode: PlanViewMode) => { writeStoredMode(mode); setViewState(mode); }, []);
  return { view, setView, sheetKey: sheetKeyState, setSheetKey, lineKey: lineKeyState, setLineKey };
}

export function usePlanViewParams(): PlanViewParams {
  const inRouter = useInRouterContext();
  // eslint-disable-next-line react-hooks/rules-of-hooks -- inRouter is invariant per mounted instance, same as useEstimateStepParam.ts.
  return inRouter ? useRoutedPlanViewParams() : useLocalPlanViewParams();
}
