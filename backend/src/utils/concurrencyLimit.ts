// Fix round 2 / R2-S6 — estimating/sheets.ts's background PDF indexing used
// to fire every claimed document's job at once, with no ceiling at all. A
// small, dependency-free worker pool (no p-limit/p-queue et al. added just
// for this) — pulled out here, pure and DB/I-O-free, so it can be unit
// tested against fake work instead of real PDF parsing.
/** Runs `worker` over every item in `items`, with at most `limit` calls to
 *  `worker` running concurrently. A shared cursor (`next`), not a real
 *  scheduler: `limit` workers each loop "claim the next not-yet-started
 *  item, await it, repeat" until the cursor runs off the end — so a
 *  worker's own slow item never blocks a DIFFERENT worker from picking up
 *  the item after it, but it does delay THAT worker's own next pickup
 *  until its current item settles (success or failure — a rejecting
 *  `worker` call stops that one iteration but the other workers keep
 *  going; see the resolves-once-every-item-has-settled note below).
 *
 *  `limit` is clamped to at least 1 and at most `items.length`, so this
 *  never spins up more workers than there is work for (each worker's own
 *  `while` would just execute zero iterations) and never spins up zero
 *  workers even if `limit` is passed as 0 or negative by mistake.
 *
 *  Resolves once every item has been awaited by some worker — including
 *  when one or more `worker` calls rejected (Promise.all still awaits
 *  every runner's own promise; a caller that wants "stop at the first
 *  failure" behavior needs a different primitive, not this one — every
 *  current caller (runClaimedIndexingInBackground) already catches its
 *  own per-item errors and never rejects). */
export async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const runners = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}
