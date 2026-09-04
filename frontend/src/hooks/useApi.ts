import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { apiErrorMessage, isAbortError } from '../api/errors';
import { reportError } from '../lib/reportError';

/**
 * The one way this app reads from the API inside a component.
 *
 * Before this hook every screen hand-rolled the same effect, and none of them
 * cancelled: click bid A then bid B quickly and A's slower response landed
 * last, so B's page showed A's data. Six files had a hand-rolled cancellation
 * flag; thirty-five had nothing at all.
 *
 * Deliberately small: no cache, no dedup, no retry. One request per key, an
 * AbortController per request, and a response is only applied if its own
 * controller is still live.
 */

export interface UseApiOptions {
  /** Query string params. Compared by value, so an inline object is fine. */
  params?: Record<string, unknown>;
  /** When false the request is not made and `loading` is false. */
  enabled?: boolean;
  /** Extra values that should force a refetch when they change. */
  deps?: unknown[];
  /** Per-request timeout override, for the slow AI/backfill endpoints. */
  timeout?: number;
  /** Passed straight to axios; the binary routes need 'blob' or 'arraybuffer'. */
  responseType?: 'blob' | 'arraybuffer';
}

export interface UseApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Cancel any in-flight request and fetch again. */
  reload: () => void;
}

/**
 * @param url  request path, or null to make the call conditional
 */
export function useApi<T>(url: string | null, options: UseApiOptions = {}): UseApiResult<T> {
  const { params, enabled = true, deps, timeout, responseType } = options;
  const active = enabled && !!url;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(active);
  const [nonce, setNonce] = useState(0);

  // Serialized so a fresh-but-equal object does not retrigger the effect.
  const paramsKey = JSON.stringify(params ?? null);
  const depsKey = JSON.stringify(deps ?? null);

  // `reload` needs to abort the request that is running right now, which the
  // effect closure cannot reach from outside.
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!active) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);

    api
      .get<T>(url as string, {
        params,
        signal: controller.signal,
        ...(timeout ? { timeout } : {}),
        ...(responseType ? { responseType } : {}),
      })
      .then(res => {
        // A late response from a superseded request is dropped, not applied.
        if (controller.signal.aborted) return;
        setData(res.data);
        setError(null);
      })
      .catch(err => {
        if (controller.signal.aborted || isAbortError(err)) return;
        setError(apiErrorMessage(err));
        reportError(err, `useApi ${url}`);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    return () => controller.abort();
    // paramsKey/depsKey stand in for the objects they serialize.
  }, [url, active, paramsKey, depsKey, nonce, timeout, responseType]);

  const reload = useCallback(() => {
    controllerRef.current?.abort();
    setNonce(n => n + 1);
  }, []);

  return { data, error, loading, reload };
}

export default useApi;
