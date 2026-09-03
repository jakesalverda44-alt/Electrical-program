# Phase 4 — Delivery & Follow-Through — Feature Report

**Plan:** `docs/superpowers/plans/2026-09-03-phase4-delivery.md`
**Branch:** `feat/phase4-delivery` (worktree: `../Electrical-program-wt-phase4`)
**Execution:** Sonnet 5

## Summary

All 7 tasks implemented, one commit each, per the plan. Electrical now has
the same send/view/sign/follow-up loop the generator pipeline has: send a
filed proposal to the GC in one click, a public proposal page rendered from
the same BidData the docx renders, view tracking, e-signature that
auto-awards through the shared stage-transition path, and a quiet-proposal
follow-up sweep. The dead surface area (fake RFI submit, fake "Suggest
RFIs", unrendered key_findings, never-written team_notified columns) is
cleaned up, and two carried findings (Phase 2 F8 prompt-text sanitization;
the Phase 3-review job_number same-day collision) are closed.

## Per-task status

### Task 1 — Schema + send-to-GC flow — **done**
- Migration `094_bid_delivery.sql`: `bids` gains `proposal_token` (unique,
  defaulted + backfilled), `proposal_sent_at`, `proposal_sent_to`,
  `proposal_viewed_at`, `proposal_signed_at`, `signer_name`,
  `signature_data`. `proposal_activity` (059) is reused for both gens and
  bids: `proposal_id` made nullable, a nullable `bid_id` FK added, and a
  `CHECK` enforcing exactly one parent is ever set.
- `backend/src/email/bidSubmittalEmail.ts`: pure builders for the GC
  submittal email and the internal Chris email, both sourced verbatim from
  the authority template. A guard test locks that neither body can ever
  contain the bid amount in any formatting, even though a full bid row
  (amount included) is a valid input.
- `backend/src/services/bidStage.ts`: extracted the stage-transition logic
  straight out of the pre-existing `PATCH /:id/stage` handler (unchanged
  behavior, just relocated) — `transitionBidStage` (stage + lifecycle
  timestamps + won_job/project/activity, inside the caller's transaction)
  and `applyBidStagePostCommit` (Drive folder move + award subfolders,
  fire-and-forget after commit). `PATCH /:id/stage` now calls these; Task
  1's send-proposal auto-advance and Task 3's sign auto-award reuse the
  exact same functions — no duplicated award logic anywhere.
- `POST /bids/:id/send-proposal`: 409s without a filed, gate-passed
  proposal docx (queries `documents` for the most recent `category='proposal'`
  row with the docx mimetype — never re-renders). Attaches the takeoff xlsx
  only when `includeTakeoff` is set. Sends via `graphSendMail`, stamps
  `proposal_sent_at`/`_to`, logs `proposal_activity` + `activity`, and
  advances `due → submitted` via `transitionBidStage` when applicable.
- `POST /bids/:id/email-prebid-chris`: a DRAFT (never sent) with the filed
  pre-bid scope + takeoff attached.
- `graphMailer.ts` gained optional `cc` support (additive; the
  `NODE_ENV=test`/`EMAIL_DISABLED` mute is untouched).
- Frontend: `SendBidProposalModal.tsx` (mirrors `SendProposalModal.tsx`'s
  UX) wired into the Proposal tab's new **Send Proposal** button, a
  sent-status chip, and an **Email to Chris (draft)** action after the
  pre-bid package generates.
- Tests: `bidSubmittalEmail.test.ts` (10), `bidSendProposal.test.ts` (7),
  `SendBidProposalModal.test.tsx` (6).

### Task 2 — Public proposal page + view tracking — **done**
- `backend/src/bidstd/proposalHtml.ts`'s `renderBidHtml(data)` renders the
  identical composed BidData the docx renders, as self-contained,
  print-friendly HTML (logo + signature embedded as data URIs — no
  external image requests from an unauthenticated page).
- **Lock test** (`proposalHtml.test.ts`): every section-band header appears
  exactly once; every visible word in the rendered output traces to
  BidData, `boilerplate.ts`'s constants, or a small explicitly-enumerated
  UI-chrome whitelist (table labels, the opening sentence, etc. — the same
  fixed strings `renderBidDocx` already hardcodes). A **drift check**
  proves this isn't vacuous: injecting a made-up sentence into the
  rendered HTML makes the word-lock fail.
- `GET /bids/p/:token` (public): composes the bid's CURRENT BidData via
  `preconstruction.ts`'s newly-exported `composeCurrentBidData(persist:false)`
  and runs the same verify gate `generate-docx` does (renders the docx
  buffer, runs `verifyBidDocx`). On failure, falls back to the
  `bid_data.json` filed alongside the last generated docx, so a customer
  who already has the link never sees a broken viewer over an estimator's
  in-progress edit — a comment in the code explains why. Stamps
  `proposal_viewed_at` once (`COALESCE`), skipped under `?preview=1`, logs
  a `proposal_activity` "viewed" row on first view only, and fires an
  opt-in notification to Jake.
- `GET /bids/p/:token/download` streams the exact bytes of the most
  recently filed proposal docx.
- Frontend: `BidProposalPublicPage.tsx`, route `/bp/:token` (registered
  beside gens' `/p/:token` in both the signed-out and signed-in route
  blocks of `App.tsx`).
- Tests: `proposalHtml.test.ts` (7), `bidPublicProposal.test.ts` (8).

### Task 3 — Accept & e-sign → auto-award — **done**
- `POST /bids/p/:token/sign` (public): ports gens' `/p/:token/sign`
  (non-empty signature + typed name required) and adds an explicit 60KB
  cap on the signature data URL (ahead of Express's raw 100KB body-parser
  limit, so an oversized signature gets a clean 400 instead of a raw
  413). Idempotent under a row lock (`FOR UPDATE`) — a second sign attempt
  returns the already-signed state unchanged, never re-stamps or
  re-awards. Stamps `proposal_signed_at`/`signer_name`/`signature_data`,
  logs `proposal_activity`, then awards through `transitionBidStage` (Task
  1's extraction) — `won_job`, project registration, the activity feed,
  and the Drive folder moves/award subfolders (`applyBidStagePostCommit`)
  all fire identically to a manual pipeline-drag award. (Deliberately does
  NOT write to the privileged `audit_log` — that requires an authenticated
  `req.user`, which a public route doesn't have; matches gens' own public
  sign route, which also skips it. The `activity` table entry
  `transitionBidStage` writes is this action's audit trail.)
- Notifies Jake on sign: in-app notification (opt-in via the existing
  "Proposal Signed" toggle) + web push + a team-mailbox heads-up email —
  the same three channels gens' sign route uses.
- Frontend: `BidProposalPublicPage.tsx` gained the Accept & Sign section
  (typed name + `react-signature-canvas` + Accept button); after signing,
  or on a page revisit, it renders the signed confirmation state straight
  from the API response.
- Tests: `bidSign.test.ts` (7) — stamps + awards + `won_jobs` row created;
  double-sign idempotent (including against a bid already manually
  awarded); oversized signature rejected.

### Task 4 — Quiet-proposal sweep for electrical — **done**
- Extended `services/proposalQuietSweep.ts` (not forked) with a bids pass.
  `classifyBidQuietTier` is a pure, independently unit-tested eligibility
  function covering the full sent/viewed/signed/stage matrix — Tier A
  (sent, never viewed, quiet ≥ `elec_followup_quiet_days`, default 5),
  Tier B (viewed, unsigned, quiet ≥ `elec_followup_viewed_days`, default
  3), both gated on `stage === 'submitted'` and no `proposal_signed_at`.
  `sweepQuietBids` fetches the (sent, unsigned, not-deleted) candidate
  pool and lets the pure function decide tier per row, so the cutoff
  arithmetic lives in exactly one place. Same title-prefix dedup
  convention as the gens pass (`tasks.linked_type='bid'`), same 6h
  scheduler cadence (both passes now run from one tick), still a
  `NODE_ENV=test` no-op.
- Settings: `elec_followup_quiet_days`/`elec_followup_viewed_days`
  surfaced in Settings → Notifications, next to the existing follow-up
  reminder settings (there was no equivalent UI for the generator
  pipeline's own `gen_followup_*` settings to sit "next to" — those are
  still app_settings-only, unchanged, untouched).
- Tests: `bidQuietSweep.test.ts` (13) — 7 pure matrix cases + 6 integration
  (dedup across re-runs and after task close; stage-skip; signed-skip;
  `resolveOwner` fallback).

### Task 5 — Real RFIs and dead-surface cleanup — **done**
- **RFI submit becomes real**: `POST /preconstruction/:bidId/rfi-draft`
  builds an Outlook DRAFT (`graphCreateDraft`, never sent) to the bid
  contact, listing every open RFI as a numbered (`<ol>`) list, subject
  `[Project Name] – RFIs / Bid Clarifications`. Workspace RFIs are marked
  `submitted:true` only after the draft actually succeeds. The fake
  per-row "Submit" (client-only, "GC will be notified" toast) is replaced
  by one batch action ("Submit N Open RFIs to GC") that surfaces the
  Outlook draft link via the toast's `action` button.
- **"Suggest RFIs" stops being fake**: the hardcoded 10-entry keyword
  table and `setTimeout` theater are deleted. **"Import from AI analysis"**
  imports Agent 2's real `rfis[]` (`takeoff_results.agent2_output`),
  deduping against the existing workspace RFIs by question text
  (case/whitespace-insensitive) and against duplicates within the
  imported batch itself; disabled with a hint when no analysis exists.
- **key_findings rendered**: `PreBidTab.tsx` now shows the parsed
  `key_findings` block under the takeoff rollup — it was fetched and typed
  but never displayed.
- **team_notified wired**: `POST /bids/:id/notify-team` now stamps
  `bids.team_notified_at`/`_to`; the Intake accept panel's opt-in team
  draft now stamps `intake_items.team_notified_at`/`_to`. Both column
  pairs already existed (073/074) and are written, not re-added.
- Tests: `rfiDraftEmail.test.ts` (4, pure), `rfiDraft.test.ts` (3,
  integration — mocked at graphMailer level per the plan, asserting on the
  submitted-count and that already-submitted RFIs are left untouched),
  `PcWorkspaceRfi.test.tsx` (5 — including a fix to the render harness
  that a no-op `onUpdate` silently defeated `set()`-driven UI updates; the
  original "Submit" assertion was a false positive matching an unrelated
  "Submitted" step-bar label, caught and corrected), `PreBidTab.test.tsx`
  (+2), `teamNotified.test.ts` (3).

### Task 6 — Hardening (carried findings) — **done**
- `sanitizeForPrompt` (`backend/src/ai/sanitizeForPrompt.ts`, pure):
  neutralizes the pipeline's own AI-prompt delimiter grammar in untrusted
  text before it reaches a prompt — a line starting with 3+ dashes can no
  longer impersonate one of the app's own `--- Sheet ... ---` /
  `--- INDEPENDENT PRE-BID TAKEOFF ... ---` system headers (leading dashes
  become a single em dash); strips control characters (keeping `\n`/`\t`);
  collapses 3+ consecutive newlines to 2. Legitimate text passes through
  byte-identical. A "drift check"-style test embeds a fake
  `--- Sheet ... EXTRACTED TEXT ...` header and confirms it arrives
  defanged. Wired into the three points the plan named: `pdfText.ts`'s
  `pageTextBlock` (PDF-extracted page text), `pageClassifier.ts`'s
  `classifyPages` (the uploaded filename), `agent3CrossCheck.ts`'s
  `buildPrebidCrossCheck` (workbook category/description text). Note:
  `documentPrep.ts` has the same `--- Sheet: <filename> ... ---` pattern
  for Agent 1's own content blocks but was **not** in the plan's file list
  for this task and was left untouched — flagging as a candidate for a
  future, explicitly-scoped follow-up rather than scope-creeping this one.
- `resolveUniqueJobNumber` (`boilerplate.ts`, pure): given a freshly
  computed `JS.MMDDYYYY` and the set of job_numbers other non-deleted bids
  already hold, returns the candidate unchanged if free, else the first
  free `-2`, `-3`, ... Wired into `composeCurrentBidData`'s persist branch
  only (`jobNumberGenerated && persist`) — an existing or
  manually-entered job_number is never passed through it, so it's never
  touched (verified directly, including a same-day *collision* between two
  manually-set identical values, which is correctly left alone).
- Tests: `sanitizeForPrompt.test.ts` (9), `boilerplate.test.ts` (+4, the
  pure resolver), `jobNumberCollision.test.ts` (3, integration).
- **Deviation**: one pre-existing test
  (`bidStandardGeneration.test.ts` — "generates and persists a job number
  on first use") asserted no suffix (`/^JS\.\d{8}$/`). Once collision
  detection is live, a suffix is correct, expected behavior whenever the
  shared test database (which is not reset per file/run) already holds a
  same-day bid — which reliably happens once `jobNumberCollision.test.ts`
  runs in the same `npm test` invocation. Loosened that one assertion to
  `/^JS\.\d{8}(-\d+)?$/`; the exact "first free suffix" arithmetic is
  covered precisely, deterministically, by the pure unit tests instead of
  a fragile exact-value integration assertion.

### Task 7 — Deploy readiness (docs + config only) — **done**
- `render.yaml`: removed the stale `databases:` block. It WAS referenced
  (`DATABASE_URL`'s `fromDatabase`), so that key was changed to a plain
  dashboard-managed (`sync: false`) env var instead, with a comment
  explaining the 2026-09-02 wrong-database-restore connection and what to
  check (the connection string's host) before ever changing it.
- `docs/DEPLOY.md`: what `git push` triggers (Render auto-deploy; automatic
  migrations at boot via `runMigrations()` — clarified that
  `.github/workflows/migrate.yml` is a *separate*, manual,
  `workflow_dispatch`-only settings-recovery tool, not part of the deploy
  path, since conflating the two seemed like exactly the kind of mistake
  worth documenting against); the full production env var list including
  `EMAIL_DISABLED` as the brake; migrations `089`/`092`/`093`/`094`
  landing with this deploy (noted the `090`/`091` numbering gap is
  harmless); a post-deploy smoke list matching the plan's five items plus
  a public-page and RFI-draft check.
- No pushes, no deploys, no migrations were run against anything but the
  local `electrical_crm_test` database throughout this work.

## Deviations from the plan (all reasoned, none silent)

1. **Task 1's Chris draft and RFI draft routes live in different files
   than send-proposal.** Send-to-GC and the Chris draft both live in
   `routes/bids.ts` (bid-identity/email delivery concerns); the RFI draft
   lives in `routes/preconstruction.ts` alongside `PUT /:bidId/workspace`,
   since it reads/writes `bid_workspaces.rfis`, a preconstruction-workspace
   concept, not a bid-record concern. The plan left this as "executor's
   call."
2. **Testing technique for Graph-mail-gated success paths**: this
   codebase's established pattern (see `gens.kickoff.test.ts`'s own
   comment) is that a Graph-gated route can only be proven to reach its
   mail step by observing the 503 "not configured" response in this test
   environment — no prior test in the suite exercises the actual send/draft
   success path end-to-end. Task 1.6/5.5/Task 5.4's tests needed to verify
   real DB side effects (stamps, activity rows, awards) that only happen
   *after* a successful send/draft, so those specific test files mock
   `isGraphMailConfigured` to `true` via `vi.mock` — `graphMailer`'s own
   `NODE_ENV=test` mute (unmocked, unmodified) still no-ops the actual
   network call underneath. This is a testing technique, not a safety
   change: no email path was weakened, and the mute itself was never
   touched.
3. **`bidStandardGeneration.test.ts` assertion loosened** — see Task 6
   above.
4. **`documentPrep.ts` left unsanitized** — see Task 6 above (explicitly
   out of the plan's named file list; flagged, not silently skipped).
5. **Job-number collision tests use relative, not exact, assertions** —
   see Task 6 above (the shared, non-reset test database makes exact
   suffix prediction across a full suite run unreliable; the pure function
   is tested exactly and deterministically instead).
6. **One test file (`bidSendProposal.test.ts`) initially used a
   non-unique, literal GC name (`'Bay to Bay'`)**, which persisted into
   the shared `customers` table and briefly broke an unrelated
   integration test (`GC name canonicalization`) via fuzzy-name matching
   two test runs later. Caught during full-suite verification, fixed to a
   per-call unique GC name, and the one polluted `customers`/`bids` row
   was cleaned out of `electrical_crm_test` directly. Documented here
   because it's exactly the class of glue-code bug prior phases' reviews
   flagged — a test's own fixture data corrupting another test's
   assumptions through shared, non-isolated state.

## Final test counts

- **Backend** (`npm test`, `electrical_crm_test`): **737 passed, 1 failed**
  (`command center brief (integration) > surfaces a needs-call Kohler lead
  as a lead-call item with a tel: CTA` — the plan's documented known
  Kohler-brief flake; pre-existing, unrelated to this phase, reproduced
  stably across three separate full-suite runs both before and after every
  task in this phase).
- **Frontend** (`npm test`): **339 passed, 9 failed** — all 9 in the two
  pre-existing files the plan names as known: `useInstallPrompt.test.ts`
  (7) and `CustomerHub.test.tsx` (2). No new frontend test files introduced
  a new failure; `npm test` was re-run after every task and stayed at
  exactly this baseline.
- `npx tsc --noEmit` clean on both `backend/` and `frontend/` as of the
  final commit.

## Safety confirmation

- **Tests only ever ran against `electrical_crm_test`.** Every test
  invocation in this session used
  `NODE_ENV=test DB_NAME=electrical_crm_test` (or the `npm test` script,
  which sets the same), against the pre-existing local Postgres container
  (`electrical-program-db-1`, already running before this session started
  — not something this session started or needed to start). `harness.ts`'s
  live-DB hard guard (refuses outright, doesn't skip, if
  `current_database() = 'electrical_crm'`) was never tripped in any run.
- **Zero real emails sent.** Every new email pathway (send-proposal,
  email-prebid-chris, rfi-draft, sign notifications, notify-team,
  intake-accept team draft) goes through the shared `graphMailer.ts`
  (`graphSendMail`/`graphCreateDraft`) — no new pathway bypasses it. Direct
  evidence, captured from the actual unmodified `graphMailer.ts` under
  `NODE_ENV=test DB_NAME=electrical_crm_test` with no Graph credentials
  configured in this environment:

  ```
  [graphMailer] NO-OP send (muted: NODE_ENV=test or EMAIL_DISABLED=true) — no email sent
      to: ["gc@example.com"]
      cc: []
      subject: "Test"
  ```

  Additional behavioral proof: this environment has no `GRAPH_TENANT_ID`/
  `GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET` set (confirmed — no `.env` file
  exists in the worktree's `backend/`). Tests that reach a "success" path
  past the `isGraphMailConfigured()` gate (via the `vi.mock` technique
  described in Deviation 2) only pass because `graphSendMail`/
  `graphCreateDraft`'s own internal `emailMuted()` check short-circuits
  before ever calling `getGraphToken()` — had the mute been bypassed, the
  missing credentials would have thrown, and those tests would have failed
  with a 502/500 instead of the 200 they got. The mute in `graphMailer.ts`
  itself was never edited to weaken it (only additive `cc` support was
  added to `SendArgs`/`graphSendMail`).
- **No pushes.** `git log main..HEAD` shows 7 local commits on
  `feat/phase4-delivery`; `git push` was never run.
- **Clean tree.** `git status` is clean as of the final commit (verified
  below).

## Trace verification (plan's Verification §2)

- **Send uses filed bytes only**: `loadMostRecentBidDoc` in
  `routes/bids.ts` queries `documents` for the most recent
  `category='proposal'` row with the docx mimetype and streams those exact
  bytes via `fetchDocBytes` — `renderBidDocx` is never called in the send
  path. Verified by test (`never re-renders` case in
  `bidSendProposal.test.ts`).
- **The public page's HTML derives entirely from BidData + boilerplate**:
  `proposalHtml.test.ts`'s word-level lock test + drift check (Task 2).
- **Sign → award runs the shared stage path**: `bidSign.test.ts` asserts
  `won_jobs` and `projects` rows are created on sign, matching a manual
  award's side effects exactly, because both call `transitionBidStage`.
- **No email pathway bypasses graphMailer**: every new `graphSendMail`/
  `graphCreateDraft` call site was added in this phase's own diff (`git
  grep` for `graphSendMail\|graphCreateDraft` in the phase's changed files
  shows only calls into `graphMailer.ts`'s exports, no raw `fetch`/SMTP).
- **The GC submittal body cannot contain the amount**:
  `bidSubmittalEmail.test.ts`'s GUARD tests (Task 1).

## Post-review fixes

An adversarial review of this phase's PUBLIC surface (the unauthenticated
`/bids/p/:token*` routes) found several serious defects, tracked as
FIX-1 through FIX-11 below. All are addressed, each in its own commit
(FIX-3 alone, per the review's instruction; the others grouped where they
share a route or a file). `git log 609c82d..HEAD` on
`feat/phase4-delivery` shows the full sequence:

| # | Commit | Status |
|---|---|---|
| FIX-1 (blocking) | `73ade8f` | done |
| FIX-2 (blocking) | `73ade8f` | done |
| FIX-3 (blocking) | `8ff0949` | done |
| FIX-4 | `5c150e4` (+ `070cde3` fixup) | done |
| FIX-5 | `80f1842` | done |
| FIX-6 (blocking) | `d954020` | done |
| FIX-7 | `75c7320` | done |
| FIX-8 | `d954020` | done |
| FIX-9 | `3273f85` | done |
| FIX-10 | `febe466` | done |
| FIX-11 | `5c3f0dc` | done |

### FIX-1 (blocking) — public data disclosure — done, `73ade8f`

`GET /bids/p/:token` returned the ENTIRE `bids` row — notes, loss_reason,
competitor, amount, salesperson/customer ids, team_notified_to, Drive
folder ids, and `signature_data` — to anyone holding the token. Replaced
with `publicBidProjection()`, an explicit 9-field projection matching the
frontend's `PublicBid` contract (`BidProposalPublicPage.tsx`).
`signature_data` is never returned publicly; `proposal_signed_at` +
`signer_name` are enough to render the signed state. Applied to all
three public bid routes (view, sign-idempotent, sign-award) — the
disclosure was present in the sign responses too, not just the GET the
review cited by line number.

### FIX-2 (blocking) — hang on malformed token — done, `73ade8f`

All three `/p/:token*` routes are now wrapped in `asyncHandler`
(`utils/asyncHandler.ts`) and validate the token's UUID shape up front
(`proposal_token` is a UUID column; a non-UUID string previously made
Postgres throw `22P02` with the rejection never reaching `res`, hanging
the request). Every failure mode — malformed token, unknown token,
nothing to show yet — now returns the identical `{error:'Proposal not
found'}` body.

### FIX-3 (blocking, own commit) — filed snapshot, gated, rate-limited — done, `8ff0949`

Redesigned as specified:
- Migration `095_public_bid_gate.sql` adds `documents.gate_passed`
  (default `false`) and `bids.signed_document_id` (FK to `documents`).
- The three Phase 3 generate-* routes (`generate-docx`,
  `generate-takeoff-xlsx`, `generate-prebid-package`) set
  `gate_passed=true` on every row they file, only after their own verify
  gate passes (`utils/storeDocument.ts` gained a `gatePassed` input).
  Nothing else ever sets it.
- `loadMostRecentBidDoc` now filters on `gate_passed=true` — the one
  query `send-proposal`, `email-prebid-chris`, and public `/download` all
  share, so send-proposal now 409s whenever no gate-passed docx exists.
- `GET /p/:token` no longer composes/renders/verifies anything live: it
  loads the most recent gate-passed `bid_data.json` and renders straight
  from it (`renderBidHtml`). No live compose, no docx render, no verify
  gate, no `soffice` probe on the view path.
- `POST /p/:token/sign` records `signed_document_id` — the
  `bid_data.json` document on screen at sign time.
- `express-rate-limit` on all three public routes (60/15min view+
  download, 20/15min sign), mirroring `routes/auth.ts`'s `authLimiter`.

Tests rewritten per the review's (f): no-snapshot -> 404; a filed-but-
not-gate-passed document (bid_data.json or docx) is treated as if
nothing were filed; the snapshot renders verbatim; and the previously-
missing case — a bid with no current composition at all (no
`takeoff_results` row — the strongest form of "would fail the gate")
still serves its filed snapshot fine, because the view path never
re-composes or re-verifies.

### FIX-4 — dead settings — done, `5c150e4` (+ `070cde3` fixup)

`elec_followup_quiet_days`/`elec_followup_viewed_days` added to
`routes/settings.ts`'s `ALLOWED_KEYS`. Round-trip test added
(`settingsAllowedKeys.test.ts`). **Self-caught regression**: that test's
first version set both keys to non-default values and never reset them
— `app_settings` is a single shared row per key, so the custom values
leaked into `bidQuietSweep.test.ts`'s integration tests (which rely on
the 5/3-day defaults), causing 3 unrelated failures on a full-suite run.
Caught during the full-suite verification pass below, fixed in `070cde3`
(reset both keys to `''` at the end of the test — `numericSetting`'s
`raw || String(fallback)` falls back to the default), and the
already-polluted rows cleaned out of `electrical_crm_test` directly.
Documented here because it's the same class of test-isolation bug
Deviation 6 in the original report called out.

### FIX-5 — double signature — done, `80f1842`

`send-proposal`'s `graphSendMail` call and `email-prebid-chris`'s
`graphCreateDraft` call now pass `appendSignature: false` — both bodies
(`bidSubmittalEmail.ts`) already end with the authority template's own
sign-off, and without the flag `graphMailer` appended the branded HTML
signature a second time. `leadFirstContact.ts` already did this
correctly. Extended `bidSubmittalEmail.test.ts` to lock that each
builder's own sign-off is genuinely the last thing in the rendered body.

### FIX-6 (blocking) — sign gating — done, `d954020`

`GET /p/:token` and `POST /p/:token/sign` both now require
`proposal_sent_at IS NOT NULL` (else the uniform 404) — migration 094's
blanket token backfill meant a lost or never-sent bid's link was
otherwise still live. A fresh sign additionally requires
`stage IN ('due','submitted')`, else 409
`{error:'This proposal is no longer available for acceptance'}` (the
existing generic error-banner UI on the public page already renders this
message; no separate UI state was needed). The signed-idempotency
short-circuit is unchanged and still takes priority. Tests: signing a
lost bid 409s with no `won_jobs`/audit side effects; signing an
already-(manually-)awarded bid 409s with no duplicate award (replacing a
prior test that asserted the old, now-incorrect behavior); viewing or
signing an unsent bid 404s.

### FIX-7 — sanitization gap — done, `75c7320`

`sanitizeForPrompt` now also covers `pdfText.ts`'s `sheetLabel` (was
interpolated unsanitized into the function's own trusted delimiter,
right next to the already-sanitized page text) and `documentPrep.ts`'s
two label sites (~469 filename, ~507 `sel.label`) that a prior task
explicitly left out of scope. Tests at all three sites confirm a hostile
label/filename containing the `--- ... ---` delimiter grammar arrives
defanged.

### FIX-8 — audit on e-sign award — done, `d954020`

Added `writeAuditAs` (`utils/audit.ts`) — `writeAudit` is now a thin
wrapper over it — which takes an explicit actor instead of `req.user`,
for actions with no authenticated request behind them. The sign route
calls it with actor name `"Customer e-signature (<signerName>)"` and
null `user_id`, recording the same `'award'` action a manual
`PATCH /:id/stage` drag logs. Test confirms exactly one `audit_log`
`'award'` row exists after a sign-triggered award.

### FIX-9 — behavior drift — done, `3273f85`

`services/bidStage.ts` restored `opts.lossReason || null` /
`opts.competitor || null` (was `?? null`, which doesn't fall back on an
empty string) — matches main's original semantics. Test added for the
empty-string case.

### FIX-10 — DEPLOY.md corrections — done, `febe466`

(a) Explicit warning that `EMAIL_DISABLED` mutes only the outbound Graph
mail call — the smoke list's send-proposal and rfi-draft steps still, for
real, advance stage/move the Drive folder and mark RFIs submitted; both
steps now specify a throwaway bid. (b) A new "Before syncing the
blueprint" section: verify `DATABASE_URL` currently resolves to a
Supabase host and copy the value somewhere safe before syncing — with an
explicit STOP if the host shown is `*.render.com`. (c) Noted migration
094's volatile-default full-table rewrite of `bids` (quiet-window
deploy) and added a `pg_dump --schema-only` snapshot step before
deploying 094/095; migration 095 (this same post-review round) is now
listed alongside 094.

### FIX-11 — nits (one commit) — done, `5c3f0dc`

- The sign route's try/catch/finally now guards only the transaction
  itself; Drive folder moves, the audit write, the response, and
  notifications all live outside it in their own locally-guarded block,
  so a post-commit failure is logged, never turned into a second
  `res.status(500)` after a response may already be sent.
- `bidSubmittalEmail.test.ts`'s amount-guard tests gained decimal
  variants ($248,750.00 / 248750.00).
- `rfi-draft` now returns `submittedIds` (the exact ids it actually
  drafted); the frontend marks only those ids submitted instead of every
  currently-unsubmitted RFI, so a blank-question RFI (excluded
  server-side) correctly stays unsubmitted client-side too.
- Chris's email moved out of the hardcoded frontend value into an
  `prebid_chris_email` app_setting (added to `ALLOWED_KEYS`, defaulting
  to the previously-hardcoded address); the server resolves it,
  the frontend stopped hardcoding it.
- Removed the unused `loc` local in `defaultPrebidChrisSubject`.

## Post-review: final test counts

- **Backend** (`npm test`, `electrical_crm_test`): **760 passed, 1
  failed** — the same pre-existing, documented Kohler-brief flake
  (`command center brief (integration) > surfaces a needs-call Kohler
  lead as a lead-call item with a tel: CTA`), unrelated to this round.
  23 new/extended test files' worth of coverage added across the 11
  fixes; no new failures.
- **Frontend** (`npm test`): **340 passed, 9 failed** — the same 9
  pre-existing failures in the same two known files
  (`useInstallPrompt.test.ts`, `CustomerHub.test.tsx`), unrelated to this
  round. One new test added (`PcWorkspaceRfi.test.tsx`'s blank-question-
  RFI case) and passing.
- `npx tsc --noEmit` clean on both `backend/` and `frontend/` as of the
  final commit.

## Post-review: safety confirmation

- **Tests only ever ran against `electrical_crm_test`**, via `npm test`
  (`NODE_ENV=test DB_NAME=electrical_crm_test`) or the equivalent direct
  `vitest run` invocations used while iterating on individual fixes.
  `harness.ts`'s live-DB guard was never tripped.
- **Never ran a dev server.** All verification was `npx tsc --noEmit` and
  `vitest`/`npm test`.
- **Zero real emails sent** — no new or changed email pathway bypasses
  `graphMailer.ts`; `graphSendMail`/`graphCreateDraft` still self-mute
  under `NODE_ENV=test`. FIX-5's `appendSignature:false` change and
  FIX-11's Chris-email-as-setting change are both additive to existing
  `graphMailer` call sites, not new send paths.
- **No pushes.** All work is local commits on `feat/phase4-delivery` in
  the `Electrical-program-wt-phase4` worktree.
- **Clean tree** as of the final commit (verified below).
