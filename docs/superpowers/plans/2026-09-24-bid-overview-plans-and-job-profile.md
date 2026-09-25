# Bid Overview: Plans Upload + Job Profile (auto-categorize the bid)

**Date:** 2026-09-24 · **Status:** Approved by Jake · **Execution:** Sonnet · **Review:** Opus
**Depends on:** main `f0e3b76` + `8724d30`. Migrations start at **140**.

## Why
Intake creates the bid card under the GC. Later, plans get uploaded (today only inside
Estimating → Documents). Jake wants plans uploaded on the bid's **home page (Bid Hub →
Overview)**, and once the sheet check sorts the pages, the CRM should **categorize the job
from the plans** (project type, brand/client, store #, prototype, address, SF, plan date,
owner/architect/engineer) and **update the bid card**.

## Decisions (Jake-approved)
1. **Upload lives on Overview** in a new "Plans & Job Profile" panel (dropzone, per-file
   status/page count, detected profile, sheet summary, "Open in Estimating →"). Files are the
   bid's documents — Estimating → Documents shows the same files; no second upload path is
   required there (keep the existing one working, same storage).
2. **Sheet check** runs on upload exactly as today (reuse `services/sheetCheck.ts`); Overview
   shows a one-line summary (N sheets in set · N electrical · N missing refs); the detailed
   panel stays in Estimating → Documents.
3. **Job profile** runs right after the sheet check, cheaply: cover sheet(s) + title blocks +
   sheet index, **text layer first**; vision (Sonnet) on the cover/title-block crop only when
   there is no text. Structured output with evidence (sheet + quote) per field:
   project_type (existing PROJECT_TYPES values), brand/client, store_number, prototype,
   site address, city/state, building SF (+ gross/net label), plan date, owner, architect,
   engineer of record, new build vs remodel/tenant fit-out, notable systems (fuel, site
   lighting, fire alarm present/absent, generator, EV), and a suggested bid name
   ("<Brand> #<store> – <City>, <ST>" or "<Project> – <City>, <ST>").
   Brands known to APT: AutoZone, 7-Eleven, Big Dan's, Bubble Down, Tommy's, Murrell,
   plus free text; match to account rules.
4. **Bid card update rules (never clobber human input):**
   - Empty card fields → auto-fill, tagged "from plans (sheet X)".
   - Filled fields that differ → a suggestion chip ("Plans say 7,381 SF — card says 7,000.
     Update?") the user accepts/ignores. Never silent overwrite.
   - **GC is never changed from plans.** Bid name is only ever suggested, never auto-renamed.
   - Accepting brand sets the account-rule match; project type drives facility checklist.
   - Every applied/accepted field is logged (who/when/source) — reuse labeled-events or activity.
5. **New fields** (migration): prototype, plan_date, owner_name, architect, engineer,
   store_number, build_type (new/remodel/tenant), profile JSON with evidence. Existing:
   name, gc, loc, sq_ft, project_type, brand, sheets.
6. **Re-run:** new/changed plan files re-run the sheet check + profile; suggestions refresh;
   previously accepted values stay unless the user accepts a new suggestion.
7. Cost: cents per bid (text-first; Haiku/Sonnet only on small crops). Model configurable
   (`ai_job_profile_model`, default Sonnet 5; Haiku acceptable if tests show equal extraction).
8. Permissions: same as document upload + bid edit; AI step requires `run_analysis`? No —
   profiling is cheap metadata; require bid edit permission, and respect the AI enabled setting.

## Out of scope
Intake-email auto-download of plans (later), pipeline board redesign, pricing changes.

## Tests (real shapes)
- Real cover/title-block text from the Kissimmee set (pages A-0/C0.1/E-1 title blocks) →
  AutoZone / retail / #10077 / 7N2-L / 2860 N Old Lake Wilson Rd, Kissimmee FL / plan date
  09/22/2025 / engineer Danny E. Doss P.E.
- Car wash (Big Dan's / Bubble Down), 7-Eleven, storage (Murrell) fixtures from their real
  drawing title text where available in OneDrive (read-only):
  `…/Bids/Bay To Bay Properties/…` and the Golf Simulator / Seminole State sets.
- Card update rules: empty fill; conflict → suggestion; GC untouched; name suggested only.
- Overview panel UI: upload, status, profile, suggestions accept/ignore, link to Estimating.
- Mobile layout sane.

## Ground rules
Worktree `../Electrical-program-wt-jobprofile`, branch `feat/job-profile`. Standard rules
(never edit Local Version; no dev servers; tests only; no real API/Drive/email calls — mock;
no push; no Agent tool; never touch the live DB; commit per task; full suites once at end).
Report: `docs/superpowers/plans/2026-09-24-job-profile-report.md`.
