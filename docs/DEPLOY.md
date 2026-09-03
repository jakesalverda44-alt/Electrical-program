# Deploying to production

Read this in full before pushing `main` (or merging a feature branch into
it) to the remote. Nothing here is automatic protection — a push really
does trigger a real deploy against the real database and, unless
`EMAIL_DISABLED` is set, real outbound email. This is documentation and
config hygiene only; it does not push, deploy, or migrate anything by
itself.

## What `git push` actually triggers

1. **Render auto-deploy.** Render watches the `main` branch (via the GitHub
   integration configured in the Render dashboard, not anything in this
   repo) and, on push, runs `render.yaml`'s `buildCommand`
   (`npm run build` — builds the frontend, then the backend) and then
   restarts the service with `startCommand` (`node backend/dist/index.js`).
2. **Migrations run automatically at boot** — not via a separate CI step.
   `backend/src/index.ts` calls `runMigrations()` (`backend/src/migrate.ts`)
   before the server starts listening. `runMigrations()` walks
   `database/migrations/*.sql` in filename order and applies whichever
   files aren't yet recorded in the `schema_migrations` table, against
   whatever `DATABASE_URL` resolves to for that process (see below). A
   Render restart — deploy, or a manual restart from the dashboard — always
   re-runs this; it's a no-op once a migration is already recorded.
3. **`.github/workflows/migrate.yml` ("Migrate Data") is NOT part of this
   path.** It is a manual, `workflow_dispatch`-only job (you trigger it by
   hand from the GitHub Actions tab, choosing `verify` or `apply`) that runs
   `backend/recover-settings.js` — a one-off tool built for the 2026-09-02
   incident to recover `app_settings` values that a prior data migration's
   `ON CONFLICT DO NOTHING` had silently dropped. It reads `SOURCE_DB` (the
   old database) and writes only to `TARGET_DB` (repo secrets, not
   `render.yaml`), touches only the `app_settings` table, and `verify` mode
   writes nothing at all. A `git push` never invokes it, and it does not
   run the schema migrations in `database/migrations/`.

## The database: Supabase, not Render Postgres

Production runs on **Supabase** Postgres. `render.yaml`'s `DATABASE_URL` is
a dashboard-managed, `sync: false` env var — its real value (the Supabase
connection string) is set directly in the Render dashboard's Environment
tab, not committed here. `backend/src/db/pool.ts` uses it as a full
`connectionString` (with `ssl: { rejectUnauthorized: false }`) whenever
it's set, falling back to the discrete `DB_HOST`/`DB_NAME`/`DB_USER`/
`DB_PASS` vars (local dev defaults) only when it's absent.

`render.yaml` used to also declare a `databases:` block that provisioned a
**separate Render-managed Postgres instance** and wired `DATABASE_URL` to
it via `fromDatabase`. Nothing in this app ever wrote real data there — it
existed alongside the real Supabase database as an empty decoy. That block
is why the 2026-09-02 incident restored data to the *wrong* database: the
restore targeted whatever `DATABASE_URL` pointed at, and at the time that
resolved to the Render Postgres instance, not Supabase — the restore
"succeeded" against an empty, unused database and looked like data loss.
The block has been removed; `DATABASE_URL` is now the plain dashboard
secret described above with no `render.yaml`-declared database backing it.

**Before ever changing `DATABASE_URL` in the Render dashboard:** confirm
the connection string is Supabase's, not a stray Render Postgres instance —
check the host in the connection string (Supabase hosts look like
`db.<project-ref>.supabase.co` or the pooler host
`aws-0-<region>.pooler.supabase.com`; a Render-managed database's host ends
in `.render.com` / `.frankfurt-postgres.render.com` etc. — if you see that,
stop and verify with Jake before proceeding).

## Before syncing the blueprint (post-review FIX-10)

`render.yaml`'s `DATABASE_URL` is declared `sync: false` (dashboard-
managed) — the 2026-09-02 incident happened specifically because a
`render.yaml` change involving `DATABASE_URL` (that removed
`databases:`/`fromDatabase` block) interacted badly with what was actually
set in the dashboard at the time. Whenever you are about to push a
`render.yaml` change and let Render "sync" the blueprint against the live
service — this deploy included, since this phase's `render.yaml` cleanup
is exactly that kind of change — do this FIRST, every time, before
syncing:

1. Open the Render dashboard → this service → Environment tab.
2. Find `DATABASE_URL` and confirm its host is Supabase's — either
   `db.<project-ref>.supabase.co` or `aws-0-<region>.pooler.supabase.com`
   (see above). **If it shows a `.render.com` host instead, STOP.** Do not
   sync the blueprint. Investigate and verify with Jake first — that
   means `DATABASE_URL` is currently pointed at the wrong (decoy) database
   and syncing on top of that will not fix it.
3. Once confirmed Supabase: copy the full connection string value
   somewhere safe (a password manager entry, not a scratch file left
   lying around) BEFORE syncing. A `fromDatabase` → `sync: false`
   transition (or any blueprint sync touching an env var Render considers
   "managed by the blueprint") has a real chance of blanking or resetting
   a `sync: false` var that had no explicit `value`/`fromDatabase` binding
   in the old blueprint — having the real value in hand means a blanked
   `DATABASE_URL` is a two-minute paste-it-back-in fix instead of a
   scramble to find the Supabase project again.
4. Sync the blueprint. Immediately re-check `DATABASE_URL` in the
   dashboard against what you copied in step 3. If it changed or is
   empty, paste the saved value back in before the next deploy/restart
   picks up a bad or missing connection string.

## Environment variables production needs

Set these in the Render dashboard (Environment tab) — `render.yaml` only
declares which keys exist and how they're sourced (`generateValue`,
`sync: false` for dashboard-managed secrets, or a plain `value`).

| Variable | Purpose | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Set by `render.yaml`; also gates the graphMailer test-mute (see below) and log verbosity. |
| `JWT_SECRET` | Signs auth tokens | `generateValue: true` in `render.yaml` — Render generates and stores it; never set by hand. |
| `DATABASE_URL` | Supabase Postgres connection string | Dashboard-managed. See above — verify the host before touching this. |
| `AUTOMATION_API_KEY` | `X-API-Key` for `POST /api/leads` (browser extension / automation) | Dashboard-managed. |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | Microsoft Graph app-only credentials — **every** outbound email in this app goes through this (lead first-contact, proposal sends, RFI/notify-team/Chris drafts, delivery notifications) | Entra app registration, application permission `Mail.Send`, admin-consented, ideally scoped to `JakeS@accuratepowerandtechnology.com` via an Application Access Policy. Dashboard-managed. |
| `EMAIL_DISABLED` | Set to `true` to mute **all** outbound Graph mail (send + draft) without touching Graph credentials | **The brake.** Every send path (`graphSendMail`/`graphCreateDraft` in `backend/src/email/graphMailer.ts`) checks this before doing anything — same code path the test suite's `NODE_ENV=test` mute uses. Flip this on before testing a new send/draft path against production data, then unset it once verified. Not declared in `render.yaml` (unset = normal sending) — add it manually in the dashboard only when you want the brake on. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Drive service account credentials (job folders, file uploads) | Not yet in `render.yaml`'s `envVars` list — set in the dashboard. |
| `GOOGLE_IMPERSONATE_EMAIL` | Domain-wide-delegation impersonation target for the Drive service account | Set in the dashboard if the service account uses DWD. |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Large document upload storage | Set in the dashboard. |
| `ANTHROPIC_API_KEY` | Default AI key (Agent 1-4, pre-bid analysis, classifier) — overridable per-install via the `ai_anthropic_key` app_setting | Set in the dashboard. |
| `FRONTEND_URL` | Fallback base URL for public links (proposal/bid tokens) when the `frontend_url` app_setting is blank | The app_setting (Settings screen) wins when set; this is the floor so a blank setting never falls back to `localhost` in a public link. Should be the production URL. |
| `CORS_ORIGIN` | Allowed CORS origin(s); falls back to `FRONTEND_URL` | Only needed if the frontend is ever served from a different origin than the backend. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | First-boot admin bootstrap — only used when the `users` table is empty | Leave unset on an already-seeded database (i.e. always, in practice, after the first deploy) so it's a no-op. |
| `LOG_LEVEL` | Overrides the default (`info` in production) | Optional. |
| `ZAPIER_WEBHOOK_*` (4 vars) | Generator Lead Pipeline automation webhooks | Set in the dashboard if that automation is in use. |
| `INTAKE_POLL_DISABLED` / `LEAD_NUDGE_DISABLED` / `REMINDERS_DISABLED` | Kill switches for the respective background schedulers | Leave unset in normal operation. |

Zapier/optional integrations aside, the load-bearing ones for this phase's
delivery loop are `GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET`
(send-to-GC, RFI drafts, Chris drafts, sign notifications all route through
them) and `EMAIL_DISABLED` as the brake if anything looks wrong post-deploy.

## Migrations landing with this deploy

Main is currently at migration `093`. This phase adds two:

- **`094_bid_delivery.sql`** — adds `proposal_token`/`proposal_sent_at`/
  `proposal_sent_to`/`proposal_viewed_at`/`proposal_signed_at`/
  `signer_name`/`signature_data` to `bids`, and makes `proposal_activity`
  (from `059_lead_proposal_handoff.sql`) serve both `generator_proposals`
  and `bids` via a nullable `bid_id` + exactly-one-parent `CHECK`.
- **`095_public_bid_gate.sql`** (post-review FIX-3) — adds
  `documents.gate_passed` (`BOOLEAN NOT NULL DEFAULT false`) and
  `bids.signed_document_id` (FK to `documents`). Note the `NOT NULL
  DEFAULT false` on `gate_passed`: on a `documents` table with existing
  rows, Postgres has to rewrite every existing row to backfill the
  default — same class of "whole-table rewrite" caution as `094` below,
  though `documents` is typically far smaller than `bids`.

**`094` in particular rewrites the entire `bids` table** — it adds a
column (`proposal_token`) with a **volatile** default
(`gen_random_uuid()`), which Postgres cannot apply as a fast metadata-only
change; it has to compute and write a new value into every existing row.
On a `bids` table with a lot of history this can take real time and hold
a lock. Deploy `094` (and `095`, same session) in a quiet window, not
during business hours, and see the `pg_dump` note immediately below.

**Before deploying `094`/`095`: take a schema-only snapshot.** From a
machine with `psql`/`pg_dump` and the Supabase connection string (see
"Before syncing the blueprint" above for how to get it safely):

```
pg_dump --schema-only --no-owner "$SUPABASE_DATABASE_URL" > pre_094_095_schema_snapshot.sql
```

This is a schema (not data) backup — cheap, fast, and exactly what you'd
need to compare against or roll a botched migration's DDL back by hand.
It is not a substitute for Supabase's own data backups/PITR, just an
extra, fast local artifact to have on hand before a migration that
rewrites a live table.

(Migrations `090`/`091` don't exist in this repo — a gap in the numbering,
not missing files; `runMigrations()` just applies whichever `.sql` files
are present, so this is harmless.) All of `089_prep_inventory.sql` through
`095_public_bid_gate.sql` apply automatically on the next deploy's boot, in
filename order, in one pass — no manual step.

## Post-deploy smoke list

Run through these against production immediately after a deploy that
includes this phase's changes, **with `EMAIL_DISABLED=true` set first** for
anything that sends or drafts mail — flip it off only once you've confirmed
the feature works and are ready for a real send.

**Use a real, throwaway bid for steps 4 and 6 — not a real GC's live bid**
(post-review FIX-10). `EMAIL_DISABLED=true` mutes only the outbound Graph
mail call; it does NOT mute anything else those two routes do. Step 4
(send-proposal) still, for real: stamps `proposal_sent_at`, advances the
bid's stage `due → submitted` if applicable, and moves the Drive job
folder to the submitted-bids location. Step 6 (RFI draft) still, for
real: flips the bid's open RFIs to `submitted:true` in the workspace.
None of that is reversible with a config flip the way a muted email is —
running these against a bid that actually matters will visibly move it
in the pipeline and mark its RFIs submitted whether or not any email
actually went out. Create (or reuse) a bid named something like `zzz
smoke test — do not use` for these two checks, and delete/trash it
afterward.

1. **Intake refresh** — Electrical hub → Intake tab → trigger a refresh;
   confirm items load and (if any are accepted during this check) the
   "Sent to team" badge reflects reality afterward.
2. **Takeoff run** — open an existing bid's Pre-Construction workspace, run
   (or re-run) the 3-agent takeoff analysis on a small/known plan set;
   confirm it completes and the Scope/Takeoff tabs populate.
3. **Proposal generate + gate** — run Agent 4 on that bid, then
   **Download .docx**; confirm it either downloads cleanly or shows the
   verify-gate's failure list (never a silent 500). Check the **Key
   findings** panel under the takeoff rollup renders when present.
4. **Send-to-GC dry check — use the throwaway bid, not step 2/3's bid if
   that one is real.** With `EMAIL_DISABLED=true` still set, open **Send
   Proposal**, fill in a real-looking recipient, and send. Confirm: a 200
   response, the sent-status chip appears, the stage auto-advances
   `due → submitted` if applicable, and — check the Render logs — a
   `[graphMailer] NO-OP send (muted...)` line, proving nothing actually
   went out. The stage advance and Drive folder move happen regardless of
   `EMAIL_DISABLED` (see the callout above) — that's exactly why this step
   uses the throwaway bid. Only then unset `EMAIL_DISABLED` and do one
   real send to a real internal test address before trusting the path for
   GCs.
5. **Public proposal page** — open the bid's public link (`/bp/:token`)
   in an incognito window; confirm the HTML renders, the Download button
   works, and `proposal_viewed_at` stamps (check the bid record) on that
   first load. (This step is safe against a real bid — it's read/view-only
   until you actually sign.)
6. **RFI draft — use the throwaway bid.** From the RFI tab, with at least
   one open RFI and a usable contact email, click **Submit Open RFIs to
   GC**; confirm (with `EMAIL_DISABLED=true`) the RFIs flip to Submitted
   and the response indicates a draft was created, without an actual
   email going out. The RFIs are marked Submitted for real regardless of
   `EMAIL_DISABLED` — that's why this one also needs the throwaway bid,
   not a real open RFI you still need answered.

If any of these fail, `EMAIL_DISABLED=true` is the fastest way to keep
looking without risking a real send while you investigate — it does not
require a redeploy, just a dashboard env var flip (which does trigger a
restart, but not a rebuild).

## Out of scope here

This document and the `render.yaml` cleanup are configuration hygiene
only. Actually pushing this branch and triggering the deploy above is
Jake's call, after a local test drive — nothing in this phase's
implementation pushes, deploys, or migrates production.
