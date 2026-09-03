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
