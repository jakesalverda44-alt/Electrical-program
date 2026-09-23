import { describe, it, expect } from 'vitest';
import { runWithConcurrencyLimit } from './concurrencyLimit';

/** Never actually sleeps — a promise this test itself controls when to
 *  settle, so concurrency (how many are simultaneously "in flight") is
 *  observed deterministically instead of racing real timers. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

/** A macrotask boundary, not just another microtask — guarantees every
 *  microtask queued by a just-resolved gate (including ones a resumed
 *  worker queues in turn, such as its OWN next iteration's work) has fully
 *  drained before the next line runs. Safer than counting a fixed number
 *  of `await Promise.resolve()` ticks, which is exact-implementation-
 *  dependent and would silently start under-counting if the pool's own
 *  internals ever grew one more `await` hop. */
function flushMicrotasks(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

describe('runWithConcurrencyLimit (Fix round 2 / R2-S6)', () => {
  it('5 items with limit 2 never have more than 2 running at the same instant', async () => {
    const items = [0, 1, 2, 3, 4];
    let inFlight = 0;
    let maxInFlight = 0;
    const gates = items.map(() => deferred<void>());

    const runPromise = runWithConcurrencyLimit(items, 2, async i => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gates[i].promise; // held open until the test explicitly releases it
      inFlight--;
    });

    // Only the first 2 items' workers should have started — the other 3
    // are still waiting for a worker to free up.
    await flushMicrotasks();
    expect(inFlight).toBe(2);
    expect(maxInFlight).toBe(2);

    gates[0].resolve();
    gates[1].resolve();
    await flushMicrotasks();
    // Item 2 and 3 should now be the ones running — still exactly 2.
    expect(inFlight).toBe(2);
    expect(maxInFlight).toBe(2); // never crept above 2, even as the pool rotated through all 5

    gates[2].resolve();
    gates[3].resolve();
    await flushMicrotasks();
    expect(inFlight).toBe(1); // only item 4 left

    gates[4].resolve();
    await runPromise;
    expect(inFlight).toBe(0);
    expect(maxInFlight).toBe(2); // the whole run, start to finish, never exceeded the limit
  });

  it('every item still runs exactly once, regardless of the concurrency limit', async () => {
    const items = [0, 1, 2, 3, 4];
    const seen: number[] = [];
    await runWithConcurrencyLimit(items, 2, async i => { seen.push(i); });
    expect(seen.slice().sort((a, b) => a - b)).toEqual(items);
  });

  it('a limit higher than the item count runs everything concurrently, not fewer than items.length workers', async () => {
    const items = [0, 1, 2];
    let inFlight = 0;
    let maxInFlight = 0;
    const gates = items.map(() => deferred<void>());

    const runPromise = runWithConcurrencyLimit(items, 10, async i => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await gates[i].promise;
      inFlight--;
    });
    await flushMicrotasks();
    expect(inFlight).toBe(3); // all 3 started — never blocked waiting on a nonexistent 4th slot

    gates.forEach(g => g.resolve());
    await runPromise;
    expect(maxInFlight).toBe(3);
  });

  it('one item rejecting does not stop the others from running', async () => {
    // Gated (not synchronous) deliberately — Promise.all settles (rejects)
    // as soon as item 1's worker rejects, WITHOUT waiting for item 2's
    // worker to finish; asserting on `seen` needs to wait for item 2's
    // gate to actually be released and processed, not just for the
    // aggregate promise to settle, or this would be racy by construction.
    const items = [0, 1, 2];
    const seen: number[] = [];
    const gates = items.map(() => deferred<void>());

    const runPromise = runWithConcurrencyLimit(items, 2, async i => {
      await gates[i].promise;
      seen.push(i);
      if (i === 1) throw new Error('item 1 failed');
    });
    const settled = runPromise.catch(() => {}); // never an unhandled rejection

    gates[0].resolve();
    gates[1].resolve();
    await settled; // the aggregate rejects here — item 2's worker may still be mid-flight
    gates[2].resolve();
    await flushMicrotasks(); // guarantees item 2's own push has drained before we assert

    expect(seen).toContain(0);
    expect(seen).toContain(2);
  });

  it('resolves immediately for an empty item list, without calling worker at all', async () => {
    let calls = 0;
    await runWithConcurrencyLimit([], 2, async () => { calls++; });
    expect(calls).toBe(0);
  });

  it('clamps a zero/negative limit to at least 1 worker instead of hanging forever', async () => {
    const items = [0, 1];
    const seen: number[] = [];
    await runWithConcurrencyLimit(items, 0, async i => { seen.push(i); });
    expect(seen.slice().sort()).toEqual([0, 1]);
  });
});
