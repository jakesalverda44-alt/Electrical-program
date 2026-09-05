import { useCallback, useEffect, useState } from 'react';
import { AxiosResponse } from 'axios';
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
 * One request per key, an AbortController per request, and a response is
 * only applied if its own subscriber hasn't since unmounted/re-keyed.
 *
 * Request dedup (audit data #9): several components on the same screen can
 * ask for the exact same `url` + `params` at the same time — e.g. the gen
 * drawer's Overview/Checklist/Survey/Documents tabs each independently read
 * `/documents?linked_id=...`. Without dedup that's N identical GETs landing
 * on the server at once. `sharedRequests` below is a module-level map of
 * in-flight GETs keyed on `url + paramsKey (+ responseType)`; concurrent
 * `useApi` calls for the same key share one underlying axios call and a
 * reference count, so unmounting/aborting one subscriber never cancels the
 * request for the others still waiting on it — only the last one out actually
 * aborts it. There is deliberately no TTL cache: an entry lives only for the
 * duration of its one in-flight request and is deleted the moment it settles
 * (success or failure), so the very next call — shared or not — always hits
 * the network fresh.
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

/** One real in-flight GET, shared by every `useApi` subscriber asking for the
 *  same key at the same time. `refCount` is how many subscribers are
 *  currently waiting on it; the underlying request is only aborted when the
 *  last one leaves. */
interface SharedRequest<T = unknown> {
  controller: AbortController;
  promise: Promise<AxiosResponse<T>>;
  refCount: number;
}

// Module-level — shared across every component using this hook, not per-hook
// state, which is the whole point: two different components' `useApi` calls
// need to see the same entry.
const sharedRequests = new Map<string, SharedRequest>();

function requestKey(url: string, paramsKey: string, responseType?: string): string {
  // responseType is part of the key (not just url + paramsKey) so a JSON read
  // and a blob download of the same URL/params — a genuinely different
  // request shape — are never accidentally shared; two calls with the same
  // url, params, AND responseType are the identical-request case this exists
  // to dedup.
  return `${url}|${paramsKey}|${responseType ?? ''}`;
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

  useEffect(() => {
    if (!active) {
      setLoading(false);
      return;
    }
    // Per-subscriber flag — distinct from the shared request's own
    // AbortController, so this subscriber unmounting/re-keying stops it from
    // applying a (possibly still in-flight, shared) response to state
    // without cancelling that request for any other subscriber.
    let cancelled = false;
    setLoading(true);
    setError(null);

    const key = requestKey(url as string, paramsKey, responseType);
    let entry = sharedRequests.get(key) as SharedRequest<T> | undefined;
    if (!entry) {
      const controller = new AbortController();
      const promise = api.get<T>(url as string, {
        params,
        signal: controller.signal,
        ...(timeout ? { timeout } : {}),
        ...(responseType ? { responseType } : {}),
      });
      entry = { controller, promise, refCount: 0 };
      sharedRequests.set(key, entry);
      // Cleared on settle (either outcome): the entry only ever represents
      // ONE in-flight request, never a cached result, so the next call for
      // this key — even a millisecond later — issues a fresh request.
      // `.finally()` returns a new promise that re-rejects when `promise`
      // does; every subscriber below already attaches its own `.catch()` to
      // `promise` itself, but this internal bookkeeping chain has no
      // subscriber of its own, so it needs its own no-op `.catch()` or a
      // failed shared request would surface as an unhandled rejection here.
      promise
        .finally(() => {
          if (sharedRequests.get(key) === entry) sharedRequests.delete(key);
        })
        .catch(() => {});
    }
    entry.refCount += 1;
    const mine = entry;

    mine.promise
      .then(res => {
        if (cancelled) return;
        setData(res.data);
        setError(null);
      })
      .catch(err => {
        if (cancelled || isAbortError(err)) return;
        setError(apiErrorMessage(err));
        reportError(err, `useApi ${url}`);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      mine.refCount -= 1;
      // Only the last subscriber leaving actually aborts the shared request;
      // while any other subscriber is still waiting on it, it keeps running.
      if (mine.refCount <= 0) {
        mine.controller.abort();
        if (sharedRequests.get(key) === mine) sharedRequests.delete(key);
      }
    };
    // paramsKey/depsKey stand in for the objects they serialize.
  }, [url, active, paramsKey, depsKey, nonce, timeout, responseType]);

  const reload = useCallback(() => {
    // Bumping `nonce` reruns the effect above, whose own cleanup (run first,
    // synchronously, by React) already unsubscribes this instance from
    // whatever shared request it was on — aborting it only if this was the
    // last subscriber — before the new effect run joins or starts a fresh one.
    setNonce(n => n + 1);
  }, []);

  return { data, error, loading, reload };
}

export default useApi;
