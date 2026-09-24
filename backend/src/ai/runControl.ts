// Stop analysis — in-process cancellation for the AI runs of a bid.
//
// Two layers, because either alone is not enough:
//  1. The database: POST /:bidId/stop-analysis marks the run 'cancelled'
//     (takeoff_results.status / agent4_status / draft_status). Every write a
//     run makes is guarded on that, so a cancelled run can never write
//     results, even on another server process.
//  2. This registry: an AbortController per running job. Stopping aborts it,
//     which cancels the in-flight Anthropic stream at once (billing stops at
//     the tokens already generated) and makes every later call on the same
//     client reject immediately without a request.
import type Anthropic from '@anthropic-ai/sdk';

export type RunKind = 'analysis' | 'agent4' | 'draft';

/** Thrown at a pipeline checkpoint once the run has been stopped. */
export class RunCancelledError extends Error {
  constructor(message = 'The run was stopped') {
    super(message);
    this.name = 'RunCancelledError';
  }
}

/** True for our own cancellation and for the SDK's abort error — decided by
 *  error TYPE, never by message text (fix round N5: a real error whose
 *  message says "aborted" must still be retried / reported). Callers also
 *  treat an aborted run signal as a stop. */
export function isCancellationError(err: unknown): boolean {
  if (err instanceof RunCancelledError) return true;
  const name = (err as { name?: string } | null)?.name;
  const ctor = (err as { constructor?: { name?: string } } | null)?.constructor?.name;
  return name === 'APIUserAbortError' || ctor === 'APIUserAbortError' || name === 'AbortError';
}

interface Entry { controller: AbortController; runId: string | null }
const running = new Map<string, Set<Entry>>();
const keyOf = (bidId: string, kind: RunKind) => `${bidId}:${kind}`;

export interface RunHandle {
  signal: AbortSignal;
  /** Unregister; call in a finally block. */
  release: () => void;
}

/** Registers one job of one run. `runId` scopes a stop to that run only
 *  (fix round S3). */
export function registerRun(bidId: string, kind: RunKind, runId: string | null = null): RunHandle {
  const entry: Entry = { controller: new AbortController(), runId };
  const key = keyOf(bidId, kind);
  if (!running.has(key)) running.set(key, new Set());
  running.get(key)!.add(entry);
  return {
    signal: entry.controller.signal,
    release: () => {
      const set = running.get(key);
      if (!set) return;
      set.delete(entry);
      if (!set.size) running.delete(key);
    },
  };
}

/** Aborts the registered jobs of these kinds for the bid — only those of
 *  `runId` when it is given. Returns how many. */
export function abortRuns(bidId: string, kinds: RunKind[], runId?: string | null, reason = 'Stopped by the estimator'): number {
  let n = 0;
  for (const kind of kinds) {
    for (const e of running.get(keyOf(bidId, kind)) ?? []) {
      if (runId !== undefined && e.runId !== runId) continue;
      if (!e.controller.signal.aborted) { e.controller.abort(new RunCancelledError(reason)); n++; }
    }
  }
  return n;
}

/** Test/diagnostic helper. */
export function runningCount(bidId: string, kind: RunKind): number {
  return running.get(keyOf(bidId, kind))?.size ?? 0;
}

const RUN_SIGNAL = Symbol('runSignal');

/** The run signal an abortableClient carries (undefined for a plain client) —
 *  lets callWithRetry wake from its backoff on a stop (fix round N6). */
export function runSignalOf(client: unknown): AbortSignal | undefined {
  return (client as { [RUN_SIGNAL]?: AbortSignal } | null)?.[RUN_SIGNAL];
}

/** A client whose every messages.stream / messages.create carries `signal`
 *  (combined with any signal the caller passed). Nested helpers that take a
 *  client — the page classifier, the counter — are covered without change. */
export function abortableClient(client: Anthropic, signal: AbortSignal): Anthropic {
  const outer = runSignalOf(client);
  const runSignal = outer ? AbortSignal.any([outer, signal]) : signal;
  const withSignal = (opts?: { signal?: AbortSignal | null } & Record<string, unknown>) => ({
    ...(opts ?? {}),
    signal: opts?.signal ? AbortSignal.any([opts.signal, signal]) : signal,
  });
  const inner = client.messages as unknown as {
    stream: (params: unknown, opts?: Record<string, unknown>) => unknown;
    create: (params: unknown, opts?: Record<string, unknown>) => unknown;
  };
  const messages = new Proxy(client.messages as object, {
    get(target, prop, receiver) {
      if (prop === 'stream') return (params: unknown, opts?: Record<string, unknown>) => inner.stream.call(target, params, withSignal(opts));
      if (prop === 'create') return (params: unknown, opts?: Record<string, unknown>) => inner.create.call(target, params, withSignal(opts));
      return Reflect.get(target, prop, receiver);
    },
  });
  return new Proxy(client as object, {
    get(target, prop, receiver) {
      if (prop === 'messages') return messages;
      if (prop === RUN_SIGNAL) return runSignal;
      return Reflect.get(target, prop, receiver);
    },
  }) as Anthropic;
}
