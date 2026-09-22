// Task 7 — URL: `?tab=estimating&step=<key>`. Reads/writes only the `step`
// param, merging onto whatever else is already in the URL (in particular
// BidHubPage's own `tab` param) rather than replacing the whole query string.
import { useSearchParams } from 'react-router-dom';
import { ESTIMATE_STEPS, EstimateStepKey } from './steps';

const VALID_STEPS = new Set<string>(ESTIMATE_STEPS.map(s => s.key));

export function useEstimateStepParam(fallback: EstimateStepKey): [EstimateStepKey, (step: EstimateStepKey) => void] {
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
