# Intake Intelligence — Clean Bid Intake from Known Formats

**Date:** 2026-09-02
**Status:** Approved plan, pending implementation
**Planned by:** Fable 5 · **Execution:** Sonnet 5 · **Review:** Fable 5
**Runs in parallel with:** Phase 2 (takeoff fidelity) — file sets are disjoint; see
"Collision avoidance" below.

## Problem

The Intake Inbox imports bid-invitation emails with a light generic parser
(`backend/src/integrations/intakeEmailIngest.ts`). For the highest-volume sender —
**Bay to Bay Properties via Procore** — the result is jumbled (screenshot 2026-09-02):

- **Bid name** = the raw subject including its own duplication:
  `"7-Eleven #42901 (REBID) - Tampa, FL: Invitation to bid on 7-Eleven #42901 (REBID) - Tampa, FL"`.
  `parseProjectName` strips invitation phrases only from the *front*; Procore appends
  them as a *suffix*.
- **GC** = `"Estimating Department (Bay to Bay Properties, LLC)"` — the junk-wrapped
  sender display name. The unwrap logic exists (`extractCandidates` in
  `backend/src/utils/customerMatch.ts`) but only runs at accept-time for `bids.gc`,
  never for the intake display/prefill.
- **Contact** = `bay_to_bay_properties_notifications@procoretech.com` — a relay
  address that is never a usable contact. (`parseContact` falls through to the
  sender address; `NON_GC_DOMAINS` already knows procoretech.com is a relay but
  contact doesn't consult it.)
- **Notes** = the entire email body dumped verbatim.
- The Procore email's two useful links — **View in Procore** and **Download
  Documents** (the plans!) — are discarded: `outlookMail.ts` `toPlainText()` strips
  all HTML, and only the stripped text reaches the parser.
- Duplicate invites and REBIDs (three `[RFP] Nick & Moes Winter Haven` rows pending
  at once; `(REBID)` in the 7-Eleven name) get no hint that a related item/bid exists.

Procore's format is rigid — Bay to Bay "almost always sends the bids in the same
format" — so a deterministic format-specific parser fixes this permanently, with the
generic parser as fallback for everyone else.

## Ground rules (permanent safety rules from the 2026-09-02 incident)

- Tests only via `npm test` (forces `electrical_crm_test`; harness hard-fails on the
  live DB; graphMailer muted under test). Do not weaken any of it.
- Work in an isolated worktree; never touch the main checkout
  (`Local Version` — the dev server watches it). Create:
  `git worktree add "../Electrical-program-wt-intake" -b feat/intake-intelligence main`
  from `/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version`.
  `npm install` in backend/ and frontend/ first. Never run dev servers.
- One commit per task, imperative message. Read files before editing. TDD for pure
  functions. No pushes.
- Feature report at `docs/superpowers/plans/2026-09-02-intake-report.md`.

### Collision avoidance (Phase 2 is running concurrently)

Do NOT touch: `backend/src/ai/*`, `backend/src/routes/preconstruction.ts`,
`backend/src/utils/documentPrep-related code`, `frontend/src/features/preconstruction/*`,
`AISection.tsx`, or any migration number below 092. **This plan's migration is `092_intake_links.sql`**
(091 is left as a gap in case Phase 2 needs a second one; a gap is harmless — the
runner sorts by filename). If `npm test` shows failures in files this plan never
touched, note them and move on — they belong to the other branch.

## Task 1 — Procore format parser (pure, TDD against the real email)

**Files:** new `backend/src/integrations/intakeFormats.ts` + `intakeFormats.test.ts`,
`backend/src/integrations/outlookMail.ts` (one additive field).

1. `outlookMail.ts`: extend `GraphMailMessage` with `bodyHtml: string | null` — the
   raw `m.body.content` when `contentType === 'html'`, else null. Purely additive;
   `body` (stripped text) stays exactly as is.
2. New `intakeFormats.ts`:
   - `detectFormat(msg): 'procore' | null` — sender domain `procore.com` /
     `procoretech.com`, OR body containing `View in Procore`.
   - `parseProcore(msg): ProcoreParse` returning
     `{ name, gc, contact, due, dueTime, loc, links: { procore?, documents? }, summary }`:
     - **name**: subject cut at `/[:\-–—]\s*(?:invitation|reminder)\s+to\s+(?:bid|submit)/i`;
       fallback: body match `invited you to bid on (?:project )?(.+?)\s*\(/`. Then
       collapse an exact repeated half (the subject often contains the project twice).
     - **gc**: body match `from\s+(.+?)\s+has invited you/i` → company; then unwrap
       junk wrappers with `extractCandidates` from `../utils/customerMatch` (the
       parenthetical company wins: "Estimating Department (Bay to Bay Properties,
       LLC)" → "Bay to Bay Properties, LLC"). Fall back to unwrapping the sender
       display name the same way.
     - **due + dueTime**: `Bid Due:\s*(?:\w+day,\s*)?(<month name> <d>, <yyyy>)(?:\s+at\s+(\d{1,2}:\d{2}\s*[ap]m))?/i`
       → `due` as YYYY-MM-DD (reuse the month table already in intakeEmailIngest —
       export it or duplicate the 12 entries locally, executor's call), `dueTime` as
       e.g. `3:00 PM`.
     - **loc**: trailing `City, ST` of the cleaned name (reuse `parseLocation`'s
       subject regex by exporting it or calling `parseLocation(cleanedName, '')`).
     - **links**: from `bodyHtml` — anchors whose text contains `View in Procore` /
       `Download Documents` (case-insensitive; tolerate nested tags inside the
       anchor); absolute http(s) hrefs only, entity-decoded.
     - **contact**: `null` — the relay address is never a contact; if the body names
       a person with an email that is NOT on a relay domain, use that instead
       (rare in Procore notifications; null is the correct default).
     - **summary**: one clean line for the Notes prefill, e.g.
       `Procore invitation — bid due Monday, September 14, 2026 at 3:00 PM. Documents: <link present/absent>. 3 attachments.`
3. **Fixture:** embed the real observed email in the test file — subject
   `7-Eleven #42901 (REBID) - Tampa, FL: Invitation to bid on 7-Eleven #42901 (REBID) - Tampa, FL`,
   sender name `Estimating Department (Bay to Bay Properties, LLC)`, address
   `bay_to_bay_properties_notifications@procoretech.com`, body text
   `... Bid Due: Monday, September 14, 2026 at 03:00 pm Bay to Bay Properties 7-Eleven #42901 (REBID) - Tampa, FL Invitation to Bid Estimating Department from Bay to Bay Properties has invited you to bid on project 7-Eleven #42901 (REBID) - Tampa, FL () . View in Procore Download Documents Bid Submission via ema...`,
   plus a small synthetic HTML body carrying the two anchors. Assert: name
   `7-Eleven #42901 (REBID) - Tampa, FL`; gc `Bay to Bay Properties, LLC` (via
   extractCandidates — assert against whatever exact string it yields, verified by
   running it); contact null; due `2026-09-14`; dueTime `3:00 PM`; loc `Tampa, FL`;
   both links captured.

## Task 2 — Generic parser cleanups (helps every sender)

**Files:** `intakeEmailIngest.ts` + its test.

1. `parseProjectName`: also strip a *suffix* invitation fragment
   (`/[:\-–—]\s*(?:invitation|invite|reminder)\s+to\s+(?:bid|submit).*$/i`) and
   collapse `X: X`-style self-duplication (leading segment repeated verbatim later).
2. `parseContact`: never return an address whose domain is in `NON_GC_DOMAINS` —
   return null instead (export/share the set; blank beats junk, and the reviewer
   sees the sender in FROM OUTLOOK anyway).
3. New `displayGc(raw)`: run `extractCandidates` and prefer the parenthetical
   company for the *intake prefill* (accept-time canonicalization is untouched —
   this makes the form show the clean name instead of relying on accept to fix it).
   Wire into `importOne`.
4. Tests for each (Kingdom/Summit-style fixtures already in the test file must keep
   passing untouched).

## Task 3 — Wire formats into ingest + store links

**Files:** `intakeEmailIngest.ts`, migration `database/migrations/092_intake_links.sql`,
`backend/src/routes/intake.ts` (return the new fields).

1. Migration 092: `ALTER TABLE intake_items ADD COLUMN IF NOT EXISTS links JSONB
   NOT NULL DEFAULT '{}', ADD COLUMN IF NOT EXISTS due_time TEXT;`
2. `importOne`: run `detectFormat`; when a format parser matches, its non-null
   fields win over the generic parse per-field (generic fills the gaps). `notes`
   prefill becomes the parser `summary` when present (generic path keeps today's
   snippet). `body_snippet` stays the raw snippet — the FROM OUTLOOK panel should
   keep showing the real email.
3. The pending-item backfill block (existing never-overwrite rules) also backfills
   empty `links`/`due_time` on refresh.
4. `POST /intake/:id/accept` (`routes/intake.ts`): carry `due_time` nowhere for now
   (bids have no time field — out of scope) but append the summary line to the
   bid's notes if notes are empty, and keep filing exactly as today. Verify accept
   still canonicalizes GC via `resolveCustomer` (it does — don't touch it).
5. DB-gated route test: ingest the Procore fixture end-to-end (insert path) →
   intake row has clean name/gc, null contact, links populated, notes = summary.

## Task 4 — Duplicate / REBID hints

**Files:** new pure helper (backend, e.g. `backend/src/utils/intakeSimilar.ts` + test),
`backend/src/routes/intake.ts`, `frontend/src/features/intake/IntakeInboxPage.tsx`.

1. Pure `similarKey(name)`: lowercase, strip `(REBID)` / `[RFP]` / `RE:`-style
   tokens, punctuation, and whitespace runs. `findSimilar(subject, candidates)`
   returns candidates whose key equals or contains/is-contained-by the subject key
   (min 8 chars to avoid junk matches).
2. `GET /intake/:id` (or the list payload — match how the detail pane gets its
   data today) gains `similar: [{kind: 'intake'|'bid', id, name, stage?}]`, computed
   against other pending intake items and non-deleted bids. Cap 3.
3. UI: an amber chip row above BID NAME — `Possible duplicate of “…” (pending
   intake)` / `Possible rebid of “…” (bid — submitted)`. Chips are informational
   only (no auto-merge). Bid chips link to `/bid/<id>`.
4. Tests: the key normalization (REBID stripping, the three Nick & Moes duplicates
   collapse to one key); route test for `similar` on a seeded pair; a UI render test
   following `IntakeInboxPage`'s existing test patterns.

## Task 5 — Detail-pane polish

**Files:** `frontend/src/features/intake/IntakeInboxPage.tsx` (+ its tests).

1. Render `links` as two buttons beside "Open original email": **Open in Procore**
   and **Download Documents** (only when present; `target="_blank"`,
   `rel="noopener noreferrer"`).
2. Show `due_time` next to the due date when present (read-only text — the date
   input stays the editable field).
3. The GC input now prefills with the unwrapped company name (no component change
   needed beyond what Task 3 stores — verify and add a render assertion).
4. Mobile test file exists (`IntakeInbox.mobile.test.tsx`) — keep it green.

## Out of scope

- AI-assisted parsing of unknown formats (revisit after seeing how far the
  deterministic parsers get — most volume is Procore/Summit/Kingdom, all covered).
- Auto-accept, auto-merge of duplicates, or any change to accept-time
  canonicalization (`resolveCustomer`) and bid creation.
- BuildingConnected/PlanHub parsers — add later as new entries in the same
  registry once real samples are on hand.
- A `due_time` on bids.
- Everything belonging to Phases 2–4 of the estimating roadmap.

## Verification

1. Backend + frontend suites green in the worktree (modulo failures owned by the
   Phase 2 branch — list any you see and confirm the files are not yours).
2. Trace with the fixture: a Procore email ingests to a clean name, unwrapped GC,
   null contact, correct due date + time, working links, one-line notes; a
   Kingdom-style email still parses exactly as before (regression fixtures pass
   untouched).
3. Feature report updated with per-task evidence.
