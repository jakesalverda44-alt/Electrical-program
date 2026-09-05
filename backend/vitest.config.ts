import { defineConfig } from 'vitest/config';

// Audit batch 3 — no vitest.config.ts existed before this; every option below
// is additive to vitest's own defaults (file discovery, environment, etc. are
// untouched). testTimeout only: this session's extensive verification runs
// (12 tasks, each requiring a green `npm test`) have made the shared local
// Postgres container and this machine's CPU (bcrypt hashing in every
// makeUser() call, real DB round trips, no mocking) noticeably more loaded
// than a single normal run — several previously-reliable tests started
// missing vitest's 5000ms default under that load, unrelated to any
// product-code regression (re-running the same test alone always passes).
// 30s gives real work under real load reasonable headroom without masking a
// truly hung request. Post-review hardening (5f): a handful of tests that
// deliberately run longer than that (the pool/migration statement_timeout
// tests, the real soffice PDF conversion test) each set their own explicit
// per-test timeout as a third `it(...)` argument rather than relying on this
// global — see poolStatementTimeout.test.ts, migrateDestructiveGuard.test.ts,
// and bidstd/verifyBid.test.ts.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
