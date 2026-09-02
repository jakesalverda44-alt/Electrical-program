# Intake Intelligence — Feature Report

## Summary

Implemented all five tasks of the approved plan
(`docs/superpowers/plans/2026-09-02-intake-intelligence.md`) on
`feat/intake-intelligence`, worked entirely inside the isolated worktree
`../Electrical-program-wt-intake` (never touched `Local Version` or the
sibling `Electrical-program-wt-phase2` worktree). One commit per task, TDD
for every pure parser, all tests run only via `npm test` (isolated
`electrical_crm_test`, hard live-DB guard, muted email — untouched and
verified intact). No dev servers run. No pushes.

Bay to Bay Properties (via Procore) invitations now ingest with a clean
project name, the unwrapped legal GC name, no junk relay-address "contact",
a correctly parsed due date **and** time, both invitation links captured,
and a one-line notes summary — instead of the raw duplicated subject, the
junk-wrapped sender name, and a blank/garbage due date the plan's screenshot
showed. Every other sender benefits from the same generic-parser cleanups
(suffix-invitation stripping, self-duplication collapse, relay-domain
contact suppression, GC display unwrapping). Pending items also now surface
duplicate/REBID hints against other pending items and existing bids.

## Task 1 — Procore format parser (pure, TDD against the real email)

**Commit `3663167`.**

- `backend/src/integrations/outlookMail.ts`: `GraphMailMessage` gained an
  additive `bodyHtml: string | null` field (raw HTML body when
  `contentType==='html'`, else `null`). The existing stripped `body` field
  and every current caller are untouched — purely additive.
- New `backend/src/integrations/intakeFormats.ts`:
  - `detectFormat(msg)` → `'procore' | null` — sender domain
    `procore.com`/`procoretech.com`, or (belt-and-suspenders) a
    `View in Procore` cue in the body/HTML.
  - `parseProcore(msg)` returns `{ name, gc, contact, due, dueTime, loc,
    links, summary }`:
    - **name**: cuts the subject at the suffix invitation phrase (Procore
      appends, doesn't prepend, its "Invitation to bid on …" boilerplate),
      with a body-sentence fallback and a defensive exact-duplicate collapse.
    - **gc**: prefers unwrapping the sender display name via the existing
      `extractCandidates` (`../utils/customerMatch`) when it's
      parenthesis-wrapped — this recovers the fuller legal name (often with
      the LLC/Inc suffix) that the body's plain "from `<Company>` has
      invited you" sentence omits; falls back to unwrapping the body mention,
      then the raw sender name.
    - **due/dueTime**: parses the `Bid Due: <weekday,> <Month> <day>, <year>
      [at <time>]` field; `due` as `YYYY-MM-DD`, `dueTime` normalized to
      `3:00 PM` form (strips the leading zero, uppercases AM/PM).
    - **loc**: reuses `parseLocation` from `intakeEmailIngest.ts` against the
      cleaned name (trailing `City, ST`).
    - **links**: a small tag-tolerant anchor scanner over `bodyHtml` matches
      anchor text against `/view in procore/i` / `/download documents/i`,
      keeps only absolute `http(s)` hrefs, entity-decodes them.
    - **contact**: `null` by default (the relay address is never a contact);
      scans the body for a non-relay-domain email as a rare override.
    - **summary**: one line, e.g. *"Procore invitation — bid due Monday,
      September 14, 2026 at 3:00 PM. Documents: link present. Has
      attachments."*
- **Documented deviation:** the plan's illustrative summary said "3
  attachments" (a count). `GraphMailMessage` only carries a `hasAttachments`
  boolean (the real count needs a separate Graph call, made later —
  asynchronously — by `importOne`/`listAttachmentNames`), and `parseProcore`
  is a pure, synchronous function of `msg` alone. The summary reports
  attachment **presence**, not a count.
- Fixture: the real observed Bay to Bay email (subject with the
  self-duplicated "(REBID)" project name, junk-wrapped sender display name,
  the exact `Bid Due:` body text, a small synthetic `bodyHtml` carrying both
  anchors). All 8 assertions from the plan's acceptance list verified:
  name `7-Eleven #42901 (REBID) - Tampa, FL`; gc `Bay to Bay Properties,
  LLC` (confirmed by running `extractCandidates` — the parenthetical wins
  over the junk "Estimating Department" wrapper); contact `null`; due
  `2026-09-14`; dueTime `3:00 PM`; loc `Tampa, FL`; both links captured,
  entity-decoded, absolute-only (verified with a negative case: a relative
  href and a `javascript:` href are both rejected).

**Verification:** `intakeFormats.test.ts` 14/14 (written and passing on
first run — TDD against the fixture up front). `intakeEmailIngest.test.ts`
36/36 untouched/unchanged. Typecheck clean.

## Task 2 — Generic parser cleanups (helps every sender)

**Commit `a1d72ec`.**

- `parseProjectName`: strips a Procore-style **suffix** invitation phrase
  (`"<Project>: Invitation to bid on <Project>"`) in addition to the
  existing prefix forms, and collapses generic `"X: … X"` self-duplication
  (guarded by a 4-char minimum on the leading segment so short/generic
  leads like `"ABC"` or the `"7"` in `"7-Eleven"` never false-fire).
- `parseContact`: now never returns an address on a domain in
  `NON_GC_DOMAINS` (exported from `intakeEmailIngest.ts` so `intakeFormats.ts`
  shares one relay/free-mail list) — returns `null` instead. **This changes
  one existing fixture's expected value**: `parseContact(null,
  'noreply@procoretech.com', …)` used to assert the bare relay address back;
  it now asserts `null`, matching exactly the behavior the plan calls for.
  Kingdom/Summit fixtures are untouched and still pass with their original
  expected values.
- New `displayGc(raw)`: runs `extractCandidates` and prefers the
  parenthetical company, for the **intake display prefill only** — wired
  into `importOne`. Accept-time canonicalization (`resolveCustomer`) is
  untouched, per the plan.
- `importOne` wiring subtlety: `parseContact`'s "is the sender name just the
  GC company?" comparison is computed against the **raw** (pre-unwrap) GC
  string, not the unwrapped display GC — unwrapping first would make a
  junk-wrapped sender name look "different" from the (also junk-wrapped) raw
  GC parseGc fell back to, and wrongly hand the junk string back as the
  contact. Documented inline in the code.

**Verification:** `intakeEmailIngest.test.ts` grew from 36 to 44 tests, all
passing on first run (suffix-strip, self-dup collapse incl. the short-lead
guard, relay-domain contact suppression, `displayGc`). Typecheck clean.

## Task 3 — Wire formats into ingest + store links

**Commit `bff91c8`.**

- New migration `database/migrations/092_intake_links.sql` (this plan's
  assigned number — 091 left as the documented gap for Phase 2):
  `intake_items.links JSONB NOT NULL DEFAULT '{}'`,
  `intake_items.due_time TEXT`.
- `importOne` now calls `detectFormat`/`parseProcore` and merges per field —
  a format parser's non-null field wins, the generic parse fills any gap
  (name, gc, loc, contact, due all follow this rule; `dueTime`/`links` have
  no generic equivalent). `notes` becomes the format summary when present,
  otherwise today's raw snippet; `body_snippet` is **always** the raw email
  snippet regardless, so the "From Outlook" panel keeps showing the real
  email.
- The pending-item never-overwrite backfill block (existing loc/contact/due
  rules) now also backfills empty `due_time`/`links` on refresh, same
  "never overwrite a reviewer-set or already-filled value" rule.
- `routes/intake.ts` `POST /:id/accept`: if the reviewer leaves `notes`
  empty on an email-sourced item, falls back to the intake item's raw
  `body_snippet` rather than filing a blank-notes bid. **Documented
  interpretation of the plan's "append the summary line … if notes are
  empty":** there is no separately persisted "summary" column — the summary
  already **is** the notes prefill from ingest (Task 3's own wiring) — so
  the only place a fallback is meaningful is when the reviewer actively
  clears the field; `body_snippet` (always populated for email-sourced
  items) is the best available substitute. `due_time` is intentionally not
  carried onto bids (no time field there — explicitly out of scope).
  Verified `resolveCustomer`-based GC canonicalization at accept is
  unchanged (read, not modified).
- DB-gated route test `intakeProcoreIngest.test.ts`: mocks only
  `fetchTaggedBidEmails`/`listAttachmentNames` (never touches the network),
  POSTs `/api/intake/refresh` with the Bay to Bay fixture, and asserts the
  resulting `intake_items` row end-to-end: clean name/gc, null contact,
  `loc`, `due`, `due_time`, both `links`, and `notes === summary` — plus a
  second test proving Graph-message-id dedupe (a second refresh with the
  same message imports 0 and leaves exactly one row).

**Verification:** `intakeProcoreIngest.test.ts` 2/2 on first run. Full
backend suite: 385/386 that run (1 pre-existing failure — see Verification
section below). Typecheck clean.

## Task 4 — Duplicate / REBID hints

**Commit `38c5146`.**

- New pure `backend/src/utils/intakeSimilar.ts`: `similarKey(name)`
  lowercases, strips bracketed `(REBID)`/`[RFP]` tags, a leading
  `RE:`/`FW:`/`FWD:`, loose rebid/rfp/rfq/itb tokens, punctuation, and
  whitespace runs. `findSimilar(subjectName, candidates, max=3)` matches
  candidates whose key equals, contains, or is contained by the subject's
  key — both sides guarded by an 8-char minimum so short/generic keys
  (`"Bid"`, `"ITB"`) never produce a false positive.
- `GET /api/intake` (the same list payload the detail pane already reads —
  no extra round-trip added) now attaches `similar: [{kind, id, name,
  stage?}]` to every pending item, computed against every *other* pending
  intake item and every non-deleted bid, capped at 3.
- `IntakeInboxPage.tsx`: an amber chip row above the Bid Name field —
  *"Possible duplicate of "…" (pending intake)"* for another pending item,
  *"Possible rebid of "…" (bid — `<stage>`)"* for a bid, the bid name
  linking to `/bid/<id>`. Chips are informational only (no auto-merge).
  **Documented implementation choice:** the link is a plain `<a href>` (full
  navigation), not react-router's `Link`/`useNavigate` — no other feature
  page in this codebase calls `useNavigate` directly (navigation is always
  threaded down as a prop from `App.tsx`), and `IntakeInbox.mobile.test.tsx`
  renders `IntakeInboxPage` with no `<Router>` wrapper, which a router hook
  would break.

**Verification:** `intakeSimilar.test.ts` 12/12 (incl. the three-way "Nick &
Moes" REBID/RFP/RE: collapsing to one key), a DB-gated route test seeding a
REBID pending item against a submitted bid (2/2), and a new frontend render
test `IntakeInbox.similar.test.tsx` (2/2) for both chip kinds plus the
empty case — all passing on first run. `IntakeInbox.mobile.test.tsx` stayed
green (2/2, unchanged). Typecheck clean both sides.

## Task 5 — Detail-pane polish

**Commit (this one, with this report).**

- `IntakeInboxPage.tsx`: the "From Outlook" panel's link row now renders
  **Open in Procore** / **Download Documents** buttons beside "Open original
  email" whenever `links.procore`/`links.documents` are present
  (`target="_blank"`, `rel="noopener noreferrer"`); absent links render
  nothing.
- `due_time` renders as read-only text next to the "Due Date" label
  (`FormFields` gained an optional `dueTime` parameter, threaded only from
  the pending-item detail view — the Add-new-item form has no `due_time`
  and is unaffected) — the date `<input>` stays the sole editable field.
- GC prefill: no component change was needed beyond what Task 3 already
  stores (`edit.gc = item.gc || ''`, and `item.gc` is already the
  Task-3-unwrapped display name) — added a render assertion proving it.
- `IntakeInbox.mobile.test.tsx` stayed green untouched.

**Verification:** new `IntakeInbox.detail.test.tsx` (4/4 on first fix —
see note below): link buttons + correct hrefs/`target`/`rel`, due-time
shown next to the date label (and absent when `due_time` is `null`), GC
input prefilled with the unwrapped name. **One test-writing correction made
during this task:** the first draft of the due-time assertions used a
page-wide `getByText(/3:00 PM/)` regex, which also matched the Notes
textarea (the notes summary text itself contains "3:00 PM") — DOM-scoped
the assertion to the label immediately preceding the date `<input>` instead
of a global text search; not a product bug, a test-authoring fix caught by
running the test red before green.

## Verification (whole plan, plan's Verification section)

1. **Backend:** `npm run typecheck` — clean. `npm test` — **399 tests
   total, 398 pass.** The one failure
   (`src/test/integration.test.ts` → `command center brief (integration) >
   surfaces a needs-call Kohler lead as a lead-call item with a tel: CTA`)
   is in a file this plan never touches (Kohler lead / command-center brief
   logic) and was **confirmed pre-existing**: reproduced identically
   (same assertion, same line) on a disposable detached worktree checked
   out at this plan's base commit (`b754534`, i.e. before any of this
   branch's changes), then removed. Not caused by this work.
2. **Frontend:** `npm run typecheck` — clean. `npx vitest run` — **314
   tests total, 305 pass** across 37 files (35 files fully green). The 9
   failures span exactly 2 files —
   `src/hooks/useInstallPrompt.test.ts` (7 tests) and
   `src/features/contacts/CustomerHub.test.tsx` (2 tests, a
   `localStorage.getItem` undefined error in `CustomerHub.tsx`'s
   `viewDoc`) — neither of which this plan touches. Both **confirmed
   pre-existing** the same way as the backend failure: reproduced
   identically on the same disposable pre-branch worktree, then removed.
3. **Fixture trace:**
   - Procore email → clean name, unwrapped GC, null contact, correct due
     date + time, both working links, one-line notes summary: proven at
     three layers — the pure-parser fixture test (`intakeFormats.test.ts`),
     the generic-parser regression fixture with the same subject
     (`intakeEmailIngest.test.ts`), and the DB-gated end-to-end ingest test
     (`intakeProcoreIngest.test.ts`), plus a frontend render test proving
     the resulting UI (`IntakeInbox.detail.test.tsx`). ✓
   - Kingdom-style email still parses exactly as before: the original 36
     `intakeEmailIngest.test.ts` fixtures for `parseDueDate`, `parseGc`,
     `parseLocation`, `parseProjectName` (Kingdom "from …for…" shape) all
     pass unchanged; only the one procoretech.com-address `parseContact`
     fixture was deliberately updated to the plan's new, documented
     behavior. ✓
4. This report, committed with the final task's changes.

## Safety confirmation

- Every test run in this session went through `npm test`
  (`NODE_ENV=test DB_NAME=electrical_crm_test`), never bare `vitest` —
  confirmed the one time it was run bare that `harness.ts`'s hard live-DB
  guard fires correctly (it refused to run and threw, rather than silently
  connecting to `electrical_crm`).
- No dev server was started at any point.
- No file inside `Local Version` (main checkout) or
  `Electrical-program-wt-phase2` (the sibling Phase 2 worktree) was read
  from or written to, except two disposable detached worktrees created
  under the scratchpad directory *from* `Local Version`'s `main` branch —
  used only to reproduce the two pre-existing test failures against a clean
  base commit for this report, and removed (`git worktree remove --force`)
  immediately after each check. Neither disposable worktree shared any
  files with, or was ever the active working directory alongside,
  `Local Version` or `wt-phase2` at the same time as this branch's own
  edits.
- Collision avoidance respected: `backend/src/ai/*`,
  `routes/preconstruction.ts`, `documentPrep`-related code,
  `frontend/src/features/preconstruction/*`, and `AISection.tsx` were never
  read or edited. Migration number used: `092` (091 left as the documented
  gap). No migration below 092 was touched.
- No pushes were made.

## Files touched

- `backend/src/integrations/outlookMail.ts` (additive field only)
- `backend/src/integrations/intakeFormats.ts` (new) + `.test.ts` (new)
- `backend/src/integrations/intakeEmailIngest.ts` + `.test.ts`
- `backend/src/routes/intake.ts`
- `backend/src/utils/intakeSimilar.ts` (new) + `.test.ts` (new)
- `backend/src/test/intakeProcoreIngest.test.ts` (new)
- `backend/src/test/intakeSimilar.route.test.ts` (new)
- `database/migrations/092_intake_links.sql` (new)
- `frontend/src/features/intake/IntakeInboxPage.tsx`
- `frontend/src/features/intake/IntakeInbox.similar.test.tsx` (new)
- `frontend/src/features/intake/IntakeInbox.detail.test.tsx` (new)
- `docs/superpowers/plans/2026-09-02-intake-report.md` (this file)
