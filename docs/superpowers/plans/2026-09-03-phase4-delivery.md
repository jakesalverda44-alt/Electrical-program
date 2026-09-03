# Phase 4 — Delivery & Follow-Through

**Date:** 2026-09-03
**Status:** Approved plan, pending implementation
**Planned by:** Fable 5 · **Execution:** Sonnet 5 · **Review:** Opus 5 (full) → Fable 5 (verdict)
**Depends on:** Phases 1–3 (all merged to local main 2026-09-02)

## Problem

An electrical proposal now composes, verifies, and files to the bid's documents —
and then dead-ends. The estimator downloads a .docx and leaves the app to email it.
Meanwhile the generator division has the full loop: send with one click, a public
proposal page, view tracking, e-signature, and an automatic follow-up sweep for
quiet proposals. Phase 4 gives electrical the same loop, plus cleans up the dead
surface area the original review flagged (fake RFI submit, fake "Suggest RFIs",
unrendered key_findings, never-written team_notified columns) and closes two
carried findings (Phase 2's F8 prompt-text sanitization; the job_number same-day
collision from the Phase 3 review).

**Authority artifacts:**
- Submittal email template (GC + the internal Chris email):
  `~/.claude/skills/apt-electrical-bid/templates/submittal_email.md` — verbatim;
  no price, no scope summary in the GC email, ever.
- The generator implementation is the working pattern to port: token/viewed
  schema `020_gen_proposal_email_signature.sql`, `proposal_activity`
  (`059_lead_proposal_handoff.sql`), send/sign/countersign in `routes/gens.ts`,
  `services/proposalQuietSweep.ts`, `pages/ProposalPublicPage.tsx`,
  `SendProposalModal.tsx`. Read them before designing anything parallel.
- The document standard: `backend/src/bidstd/*` (Phase 3). The public page renders
  from the SAME composed BidData + boilerplate — never a hand-maintained copy.

## Environment facts

- Migration numbering: main is at 093. **This plan owns 094** (one migration).
- No LibreOffice in production — the public page renders HTML from BidData; the
  downloadable artifact is the filed .docx.
- graphMailer is muted under NODE_ENV=test and honors EMAIL_DISABLED=true — every
  new send path goes through it. **No new email pathway may bypass graphMailer.**
- `bids.contact` may now hold a usable address (intake intelligence fills e.g.
  Bids@baytobayproperties.com); treat it as the default recipient, always editable.

## Ground rules (permanent)

- Worktree only: `git worktree add "../Electrical-program-wt-phase4" -b feat/phase4-delivery main`
  from `"/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version"`
  (quote paths). `npm install` both sides. Never touch Local Version or other
  worktrees. Never run dev servers. Tests only via `npm test`. No pushes.
- One commit per task, imperative messages,
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. TDD for pure
  functions. Feature report at `docs/superpowers/plans/2026-09-03-phase4-report.md`.
- Do not modify the gens pipeline (read it, port from it, never edit it).

## Task 1 — Schema + send-to-GC flow

**Files:** migration `094_bid_delivery.sql`, `backend/src/email/` (new
`bidSubmittalEmail.ts`), `backend/src/routes/bids.ts` or `preconstruction.ts`
(executor's call — keep delivery routes together and consistent),
`frontend/src/features/preconstruction/PcWorkspace.tsx` (send modal).

1. Migration 094, following `020_gen_proposal_email_signature.sql`'s shape, on
   `bids`: `proposal_token UUID UNIQUE DEFAULT gen_random_uuid()` (+ backfill),
   `proposal_sent_at TIMESTAMPTZ`, `proposal_sent_to TEXT[]`,
   `proposal_viewed_at TIMESTAMPTZ`, `proposal_signed_at TIMESTAMPTZ`,
   `signer_name TEXT`, `signature_data TEXT`. Reuse the existing
   `proposal_activity` table for the timeline with a discriminator — inspect its
   shape first; if `proposal_id` FKs to generator_proposals, add a nullable
   `bid_id UUID REFERENCES bids(id) ON DELETE CASCADE` + CHECK exactly-one-set
   in 094 rather than a new table.
2. `bidSubmittalEmail.ts`: subject/body from the authority template, verbatim
   structure (`[Project Name] – [Location] | Electrical Proposal`; "Hey, …";
   Jake's four-line signature). Pure builder + test locking the strings. A
   **guard test**: the built body must never contain the bid amount — feed a
   bid with an amount and assert the formatted number is absent.
3. `POST /:bidId/send-proposal` — body `{ to: string[], cc?: string[], subject,
   bodyText, includeTakeoff?: boolean }`:
   - Requires the most recent **filed, gate-passed** proposal docx (the
     `documents` row Phase 3 files) — 409 if none. Never re-render at send time;
     send exactly the reviewed bytes. Attach the takeoff xlsx only when
     `includeTakeoff` (per the template's rule).
   - Send via `graphSendMail` with attachments (follow `bidAttachments.ts`
     size-cap patterns). On success: stamp `proposal_sent_at`/`proposal_sent_to`,
     write a `proposal_activity` row, write an `activity` row, and — if the bid
     is still `due` — advance stage to `submitted` through the SAME code path
     the stage PATCH uses (timestamps + Drive move must fire; extract/reuse,
     don't duplicate).
   - The email body includes the public proposal link (Task 2) above the
     signature: "View and accept online: <link>".
4. Frontend: a Send Proposal modal (mirror `SendProposalModal.tsx`'s UX):
   prefilled to = bid contact when it looks like an email, editable subject/body
   (prefilled from the template), include-takeoff checkbox (off by default),
   explicit Send button with busy state; success shows sent-status chip
   ("Sent <date> to <first recipient>") on the Proposal tab; stage-advance is
   reported in the toast.
5. Also add the **internal Chris email** as a small secondary action on the
   pre-bid package flow: after generate-prebid-package succeeds, offer "Email to
   Chris (draft)" → `graphCreateDraft` with the template's Chris body and both
   files attached — a DRAFT, not a send (Jake reviews in Outlook).
6. Tests: route 409 without a filed proposal; success path stamps + activity +
   stage advance (DB-gated); the amount-absent guard; modal render test.

## Task 2 — Public proposal page (HTML from BidData) + view tracking

**Files:** new `backend/src/bidstd/proposalHtml.ts` (+ test), routes (public,
unauthenticated) `GET /api/bids/p/:token` + `GET /api/bids/p/:token/download`,
`frontend/src/pages/` new `BidProposalPublicPage.tsx`, `App.tsx` route.

1. `proposalHtml.ts`: `renderBidHtml(data: BidData): string` — the SAME document
   the docx renders, as a clean single-page HTML: navy `1F3864` bands (centered
   white bold), Arial stack, the 6 scope bullets, sections, exclusions, takeoff
   table with ACCENT category rows, terms, price summary
   (`Total for <project>:  <price>`), logo embedded as data URI from
   `backend/assets/APT_Logo_2026.jpg`. Source every string/structure from
   BidData + `boilerplate.ts` — zero copied literals (lock with a test: the
   HTML for the canonical fixture contains each section header exactly once and
   no string that isn't in the data/boilerplate). Print-friendly CSS. The
   Print/Sign/Date acceptance block renders as the signing UI mount point.
2. Public GET by token (follow `gens.ts`'s `/p/:token` handler): loads the bid,
   composes current BidData server-side (reuse `composeCurrentBidData` with
   `persist:false`), runs the verify gate — a bid whose current composition
   fails the gate returns the LAST FILED docx's provenance instead of failing
   the viewer (comment why). Stamps `proposal_viewed_at = COALESCE(...)` except
   with `?preview=1` (same bypass as gens), writes a `viewed` proposal_activity
   row on first view, and fires the existing notification engine ("Proposal
   viewed — <bid>") to Jake.
3. `/download` streams the most recent filed proposal docx (the exact reviewed
   bytes), content-disposition with the `APT_Bid_…` filename.
4. Frontend public page: renders the HTML (dangerously-set from the API or
   server-returned document — match how gens does it), Download button, Accept &
   Sign section (Task 3). No auth, no app chrome. Route `/bp/:token` (distinct
   from gens' `/p/`), registered beside it in `App.tsx`.
5. Tests: token 404s on unknown; preview bypasses the viewed stamp; first view
   stamps once; HTML lock test above.

## Task 3 — Accept & e-sign → auto-award

**Files:** public route `POST /api/bids/p/:token/sign`, `BidProposalPublicPage.tsx`
(port the signature-canvas component usage from `ProposalPublicPage.tsx` /
`SignedContractCard` patterns), notifications.

1. Sign endpoint (port gens' `/p/:token/sign`): body `{ signerName,
   signatureDataUrl }`; validations per gens (non-empty, size cap on the data
   URL); idempotent — a second sign attempt on a signed bid returns the signed
   state, never re-stamps. Stamps `proposal_signed_at`/`signer_name`/
   `signature_data`, writes proposal_activity, then advances the bid to
   `awarded` **through the shared stage-transition path** (won_job + project +
   Drive moves + audit must all fire exactly as a manual award does — reuse the
   extraction from Task 1.3).
2. Notify Jake on sign: notification engine + webPush (mirror whatever gens does
   on sign — read it and match).
3. Public page: signature canvas + typed name + Accept button; after signing
   shows the confirmation state with the signed timestamp; page revisits render
   the signed state.
4. Tests: sign stamps + awards + won_job created (DB-gated); double-sign
   idempotent; oversized signature rejected.

## Task 4 — Quiet-proposal sweep for electrical

**Files:** `backend/src/services/proposalQuietSweep.ts` (extend — this service
already exists for gens; ADD a bids pass rather than forking a copy), settings.

1. Tier A: `proposal_sent_at` set, `proposal_viewed_at` null, quiet ≥
   `elec_followup_quiet_days` (app_setting, default 5) → task "Proposal quiet —
   <bid>" linked_type `'bid'`. Tier B: viewed, not signed, ≥
   `elec_followup_viewed_days` (default 3) → "Proposal viewed but unsigned —
   <bid>". Same title-prefix dedup convention as the gens pass; skip bids no
   longer in `submitted` stage; resolveOwner fallback per the existing helper.
2. Same scheduler cadence; still a NODE_ENV=test no-op. Settings surfaced next
   to the gen equivalents in the Notifications/Email settings section (follow
   the existing `gen_followup_*` UI pattern).
3. Tests: pure eligibility function extracted + unit-tested (sent/viewed/signed
   /stage matrix); dedup respected.

## Task 5 — Real RFIs and the dead-surface cleanup

**Files:** `PcWorkspace.tsx`, `backend/src/routes/` (RFI draft endpoint),
`PreBidTab.tsx`, `routes/bids.ts` + `routes/intake.ts` (team_notified).

1. **RFI submit becomes real**: `POST /:bidId/rfi-draft` builds an Outlook DRAFT
   (`graphCreateDraft`, never send) to the bid contact listing the open RFIs
   (numbered, with the question text), subject
   `[Project Name] – RFIs / Bid Clarifications`. Marks those rfis
   `submitted: true` with a timestamp in the workspace only after the draft
   succeeds; the toast links the Outlook draft webLink. Remove the fake
   "GC will be notified" toast path.
2. **"Suggest RFIs" stops being fake**: delete the hardcoded keyword table and
   `setTimeout` theater; the button now imports Agent 2's real `rfis[]` from
   `takeoff_results.agent2_output` (parse, dedupe against existing workspace
   rfis by question text) — label it "Import from AI analysis"; disabled with a
   hint when no analysis exists.
3. **key_findings rendered**: `PreBidTab` shows the parsed `key_findings` block
   (it's fetched and typed already) under the takeoff rollup.
4. **team_notified wired**: `POST /bids/:id/notify-team` and the intake accept
   team-email path stamp `team_notified_at`/`team_notified_to`; the existing
   "Sent to team" badges in `IntakeInboxPage` start working. (Columns exist —
   073/074 — write them, don't re-add.)
5. Tests: RFI draft endpoint (draft mocked at graphMailer level — it returns the
   noop draft under test, assert on the builder's body); suggest-import dedupe;
   key_findings render; team_notified stamps.

## Task 6 — Hardening (carried findings)

**Files:** `backend/src/ai/pdfText.ts`, `backend/src/ai/pageClassifier.ts`,
`backend/src/ai/agent3CrossCheck.ts`, `backend/src/bidstd/boilerplate.ts` or
`composeBidData.ts`.

1. **Prompt-text sanitization (Phase 2 F8)**: a pure `sanitizeForPrompt(text)`
   applied to PDF-extracted page text, uploaded filenames entering the
   classifier prompt, and workbook descriptions entering Agent 3's cross-check:
   neutralize our own delimiter grammar (any line starting `---` gets the
   dashes replaced with `—`), strip control chars, collapse >2 consecutive
   newlines. Test: embedded fake `--- Sheet … EXTRACTED TEXT …` header in a
   page's text arrives defanged; legitimate schedule text passes through
   byte-identical otherwise.
2. **job_number same-day uniqueness**: on persist (generate endpoints only), if
   another non-deleted bid already holds the computed `JS.MMDDYYYY`, suffix
   `-2`, `-3`, … (first free). Existing/manual values never touched. Test:
   two bids generated same day get distinct numbers; an explicit manual value
   survives.

## Task 7 — Deploy readiness (docs + config only; NO push)

**Files:** `render.yaml`, new `docs/DEPLOY.md`.

1. Remove the stale `databases:` block from render.yaml (production runs on
   Supabase; the declared Render Postgres is the legacy trap that caused the
   Sep-2 wrong-database restore) — verify nothing in render.yaml references it
   (`fromDatabase` etc.) before deleting; if referenced, fix the reference to
   an env var instead.
2. `docs/DEPLOY.md`: the push-to-production checklist — what `git push` triggers
   (Render auto-deploy + `.github/workflows/migrate.yml` — read it and document
   which DB it migrates and which env var must point at Supabase), the env vars
   production needs (EMAIL live means real sends — call out that
   `EMAIL_DISABLED` is available as a brake), migrations 089–094 applying on
   deploy, and a post-deploy smoke list (intake refresh, takeoff run, proposal
   generate + gate, send-to-GC dry check with EMAIL_DISABLED first).
3. No pushes, no deploys — this task produces documentation and config hygiene
   only.

## Out of scope

- Actually pushing/deploying (Jake triggers after a local test drive).
- LibreOffice/PDF in production (public page is the HTML answer; revisit only
  if GCs demand PDF attachments).
- Countersign flow for electrical (gens has it; add later if Jake wants it).
- SMS/text notifications; payment collection on acceptance.
- Editing the gens pipeline in any way.

## Verification

1. Both suites green in the worktree (backend: only the known Kohler flake;
   frontend: only the 9 known pre-existing).
2. Trace by reading final code: send uses filed bytes only; the public page's
   HTML derives entirely from BidData+boilerplate; sign → award runs the shared
   stage path (won_job/project/Drive verified in test); no email pathway
   bypasses graphMailer; the GC submittal body cannot contain the amount.
3. Feature report with per-task evidence + measured token/dedup notes where
   relevant.
