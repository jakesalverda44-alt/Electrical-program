# Audit Batch 4 — Opus 5 review record (round 1)

**Date:** 2026-09-05 · **Branch:** `fix/audit-batch4` @ 860c253 (11 commits) · **Reviewer:** Claude Opus 5 (independent) · **Verdict to lead:** MERGE AFTER FIXES · **Lead (Fable 5.1) spot-checks:** all four blockers confirmed in code before the fix round was dispatched.

## Checklist results
- Frontend: typecheck clean; 77 files / 543 tests pass. Backend: typecheck clean; 100 files / 839 tests pass.
- `window.confirm` → 4 hits, all comments. PASS.
- `confirm(` → 4 bare native `confirm('…')` remain in `IntegrationsSection.tsx:33,48,63,78`. FAIL (S8).
- Hex status colors under `features/` → only the guard test. PASS.
- `role="dialog"` → Modal.tsx comment + pre-existing BriefDrawer.tsx. PASS.
- `aria-label="Close"` → 6 literal hits; centralized as Modal's `closeLabel` default. Accepted.
- Local fmtDate/fmtSize/dayOf definitions → only the guard test. PASS.
- Chunk table present and reproduced by a fresh build (PcWorkspace row stale after Task 9).
- Backend diff: exactly auth.ts, three restore routes, restorePermission.test.ts, migration 100. PASS.
- Nine pre-existing PcWorkspace tests byte-identical to main. PASS.

## Blockers
- **B1** `lib/date.ts:22` — `dayOf` only local-parses strings ≤10 chars; Postgres DATE columns arrive as `…T00:00:00.000Z` → one day early in US zones (HomeKpis, hub overview tabs, LeadsPage overdue math, ElecProjectsPage).
- **B2** `PcWorkspace/ui.tsx:14` — `pill()` does `color + '22'`; callers now pass `var(--green)` etc. → every AI risk/confidence pill lost its background.
- **B3** `GenDetailDrawer.tsx:563` — AwardKickoffModal is a sibling after the drawer; `.overlay` z-index 150 < `.drawer-overlay` 160 → unclickable on desktop.
- **B4** `Modal.tsx:145` — `stopPropagation()` on Escape in a document capture listener kills inner Escape handlers (SurveyMarkupEditor fullscreen, LeadDetailDrawer cancel-note).

## Should-fix
S1 `useApi.reload()` no-op when a sibling shares the key · S2 Tab trap armed while discard prompt shows · S3 focus restore to unmounted opener · S4 Undo double-click → false failure toast · S5 Undo restores only the primary list (wrong column in projects pages) · S6 restored row prepended not re-sorted · S7 modal stack registration-ordered, not depth-ordered · S8 four native confirms · S9 Email/Notifications chips changed geometry (accepted: plan mandates theme match) · S10 RequiredMark sr-only text not associated (no htmlFor) · S11 LogGenJobModal discard copy drifted · S12 ConfirmDialog orphans promise on overlap/unmount.

## Nits
`--slate`→`--text3` is a −26% luminance shift on three button backgrounds (plan-mandated; report mis-described it) · always-emitted `aria-labelledby` · hard-coded title ids · `timeout` not in useApi key · countersign disabled-only · React.lazy caches chunk-load rejection · `.ws-form-grid` dead · money locale `undefined` vs `en-US`.

## Plan deviations — reviewer agreed with all executor deviations; disagreed with three report claims (native confirms remaining, `--slate` affects backgrounds, five inline grid sites remain).

## Task 9 assessment
Strongest work in the batch: `pricingLineItems` memo byte-identical to the old `computePricingItems` with complete deps; `set` reads `wsRef.current` exactly as main did (two-set-per-tick quirk is pre-existing); `useAiPoller` faithful; importReducer transitions mirror old setters. `useStableFn` assigns a ref during render — latent under concurrent rendering only. Profiler "before" numbers not re-derived by reviewer (plausible).

## Fix round 1 (dispatched to Sonnet 5 by the lead)
B1–B4, S1–S8, S10–S12, plus the three one-line nits (timeout in key, countersign guard, aria-labelledby only when titled) and the report corrections. S9 and the remaining nits deferred as follow-ups.

---

# Round 2 (Opus 5, independent) — delta 860c253..b5d77ed

**Verdict to lead:** MERGE AFTER FIXES (N1–N3). Both suites green (frontend 83/572, backend 100/839), typecheck clean, backend/database diff still the round-0 six files, no test-quality erosion in the delta.

Round-1 items: 15 of 18 VERIFIED; B1 PARTIAL (three raw `new Date(date_won)` sites survive); B3 PARTIAL/REGRESSED (N1, N2); S4 NOT FIXED (N3).

- **N1 HIGH** `AwardKickoffModal`, `LeadSiteSurvey.tsx:362` — inline `zIndex: 170` loses to the mobile `.drawer-overlay` 240 → both modals under the drawer on phones (regression from 165869c).
- **N2 HIGH** `ConfirmDialog` at root `.overlay` 150 < `.drawer-overlay` 160 → delete lead / mark lost / close job confirms paint behind the drawer on desktop; click closes the drawer instead. Regression vs native confirm on main.
- **N3 HIGH** `Toast.tsx` `used` state persists across toasts (no key, in-place replace) → the next toast's Undo is dead. Probe-verified.
- **N4 MED** `SalesByRepPage.tsx:58,62,70`, `CalendarPage.tsx:72`, `WonReports.tsx:23`, `FollowupsPage.tsx:47` still parse DATE columns raw (pre-existing, same class as B1).
- **N5 LOW** `originalIndex === -1` → `splice(-1,0,x)` inserts second-to-last (three Undo sites).
- N6 LOW restored wonJobs row appended (consumers re-sort) · N7 LOW `defaultPrevented` check precedes the Tab branch (latent) · N8 doc typo · N9 `#root` gets tabindex=-1 permanently.
- Note: `fmtDateTime` has zero production call sites, so the UTC-midnight-timestamp hazard of the B1 regex is unreachable today.

**Fix round 2 (dispatched to Sonnet 5 by the lead):** N1, N2, N3, N4, N5, N7, N8 with failing-first tests. N6, N9 deferred.

**Fix round 2 result (904c24c, 5206675, 208e62d):** N1/N2 fixed via exported `Z_ABOVE_DRAWER = 250` in Modal.tsx applied to AwardKickoffModal, LeadSiteSurvey, ConfirmDialog (tests tightened to >240); N3 fixed with `useEffect(() => setUsed(false), [toast])`; N4 four sites now use `dayOf`/`fmtDate` (new CalendarPage + WonReports tests); N5 `-1` index → append; N7 `defaultPrevented` check scoped to Escape; N8 typo. Executor confirmed every new test fails with the fix reverted. Deferred: N6, N9.

---

# Final verdict (Fable 5.1 lead)

**MERGE.** Lead verification on HEAD 208e62d (19 commits ahead of main):
- Frontend: 86 files / 579 tests pass; `tsc --noEmit` clean. Backend: 100 files / 839 tests pass; `tsc --noEmit` clean.
- `git diff --stat main..HEAD -- backend/ database/` = the six Task-2 files only.
- Lead spot-checks across the three rounds: useApi dedup ordering (cleanup `.finally` attached before subscriber `.then`), `set` reads `wsRef.current` as on main, B1 regex + formatter routing, B4 bubble-phase listener + `defaultPrevented`, N1–N3 arithmetic, round-2 `Z_ABOVE_DRAWER` usage and no remaining raw `new Date(date_won)`.

Follow-ups (not blocking): N6 wonJobs restore position; N9 `#root` tabindex; S9 Email/Notification chip geometry now matches theme (plan-mandated); `useStableFn` assigns a ref during render (latent under concurrent rendering); `fmtDateTime` unused in production — if wired up, note the UTC-midnight-timestamp edge; React.lazy caches chunk-load rejections (ErrorBoundary Reload works); `lib/money.ts` locale `undefined` vs proposalChrome's `en-US`; DELETE on bids/gens/documents still admin-only so the non-admin 10-minute restore path is unreachable via UI.
