# Audit Batch 1 — Adversarial Review (Opus 5)

Branch `fix/audit-batch1`, 13 commits. Tree clean (`git status --short` empty) after two throwaway
`git checkout main -- <file>` probes, both reverted with `git checkout HEAD -- <file>`.

## 1. Merge recommendation: **MERGE AFTER FIXES**

Eleven of twelve tasks are correct, surgical, and well-tested; the two Critical findings (destructive
migrations, deactivated-user auth) are closed cleanly and I could not find a bypass. Task 5 is the
problem: the "fail-closed Drive proxy" only fails closed for the *restricted* roles (it sits inside
`if (scope)`), so the plan's literal requirement — "never fetch an untracked file id" — is not met for
managers/owners/read_only, and simultaneously it *does* break a legitimate flow for salespeople,
because job-site photos listed straight out of Drive (`GET /gens/:id/photos`, `/bids/:id/photos`) have
no `documents` row to match, and neither do Cloudinary-stored uploads whose Drive id is never
persisted. That is both an incomplete fix and a user-visible regression, which the plan explicitly
said this batch would not produce. Task 3 is also partial: the SELECT list is exactly right, but
`form_data` still ships whole and carries fields the codebase itself labels internal plus the full
price decomposition the rep chose to hide. Fix those three and this is a good merge.

## 2. Blocking findings

**B1 — Drive proxy still fetches untracked file ids for every non-restricted role.**
`backend/src/routes/documents.ts:203-215`
```ts
const scope = ownScopeId(req.user!);
if (scope) {
  ...
  if (!rows.length || (rows[0].uploaded_by !== req.user!.name && !(await ownsLinkedRecord(...)))) {
    return res.status(403).json({ error: 'You do not have access to this file' });
```
`ownScopeId` returns null for every role except `salesperson`/`salesperson_legacy`
(`backend/src/utils/scope.ts:5-13`), so a `read_only` or `technician` account can call
`GET /api/documents/drive-file/<any id>` and the backend streams it with the service account's
credentials — arbitrary read of anything the APT service account can see in Drive, which is the
audit Security #5 finding. Fix: move the "no row → 403" check outside the `if (scope)` block; keep the
ownership branch inside it.

**B2 — Regression: job-site photo thumbnails now 403 for salespeople.**
`backend/src/utils/storeDocument.ts:133-136`
```ts
if (!storageUrl) {
  if (driveFileId) storageUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
```
Two paths produce Drive file ids that are *not* in `documents.storage_url`: (a) `GET /gens/:id/photos`
(`routes/gens.ts:1374-1387`) and the bids equivalent list the Photos subfolder directly via
`listFolderFiles`, and `GenProjectsPage.tsx:77` / `ElecProjectsPage.tsx:1080` feed those raw ids to
`DriveImage` → `/documents/drive-file/:fileId`; (b) when Cloudinary is configured, `storageUrl` is the
Cloudinary URL and the Drive id is never stored, so even a legitimately uploaded document misses the
`LIKE '%fileId%'` lookup. Before this change a salesperson got the image (the guard fell through);
now they get 403 and a broken thumbnail on their own jobs. Fix: for restricted reps, authorize the
photo case by folder — check the id's parent against the `drive_*_folder_id` of a record they own —
or serve photos through an owned-record route (`/gens/:id/photos/:fileId` behind `loadOwnedGen`)
rather than the generic proxy. The report does not disclose this.

**B3 — `form_data` is still returned whole on the public proposal link.**
`backend/src/routes/gens.ts:1353` (`PUBLIC_PROPOSAL_COLUMNS` includes `form_data`)
`frontend/src/features/builder/genData.ts:321-341`
```ts
/** Internal site-detail fields — not shown on the customer proposal, used for the
 *  award kickoff email to the ops team. */
feedFt: number; genSide: ...; panelRel: ...; panelFt: number;
labor: number; permit: number; startup: number; discount: number; ...
```
`ProposalPreview.tsx:330` renders the price breakdown only `{form.includeBreakdown && ...}`, yet the
labor/permit/startup/discount/taxRate numbers ship to the browser regardless — so the rep's decision
to hide the breakdown is cosmetic on an unauthenticated link. Plan §3.2 excluded "`form_data`
internals not rendered" and §3.3 required a server-side projection exactly for this case. Fix:
project `form_data` server-side to the keys `ProposalPreview`/`EvProposalPreview` actually render,
dropping the four internal site-detail fields and the breakdown components when
`includeBreakdown` is false. The report claims no sub-projection was needed; that claim is wrong.

## 3. Non-blocking findings

- **T7** `GET /api/auth/microsoft` has no `authLimiter` and inserts an entry into the unbounded
  `oauthStates` Map per call with a 10-minute TTL (`routes/auth.ts:64,84-86`) — an unauthenticated
  attacker can grow it freely. Add `authLimiter` and/or a size cap.
- **T7** An invalid/expired state returns `res.status(400).json(...)` on a *browser navigation*
  (`auth.ts:118-121`), so the user sees raw JSON. Plan said 400, so this is compliant, but a backend
  restart mid-login (ts-node-dev `--respawn` locally, any Render deploy) drops the in-memory state and
  produces exactly this. Redirect to `/login?error=…` with the 400 instead.
- **T6** `link` is interpolated unescaped into `href="${link}"` (`email/proposalEmail.ts:18`). It comes
  from the admin-settable `frontend_url` setting, not `req.body`; the executor discloses the choice.
- **T8** `await closeLeadFollowups(lead.id)` runs after COMMIT and outside any try (`leads.ts:717`) —
  a throw there 500s a handoff that already succeeded. Wrap it like `pushSiteVisitToCalendar`. Also
  `client.release()` should be `client.release(err)` after a failed ROLLBACK.
- **T9** The health-check timeout (`index.ts:134-137`) never clears its 2 s timer and does not cancel
  the query; a wedged `pool.query` still holds a pool client. Cosmetic under normal load.
- **T11** `docker run --rm postgres:16-alpine pg_dump "$PROD_DATABASE_URL"` puts the connection string
  in the host process table (`ps aux`). Nothing is logged or echoed, so the plan's letter is met; pass
  it as `-e` and `sh -c` for defence in depth.
- **T11** `backup-db.sh`'s prune glob `electrical_crm-*.sql.gz` also matches
  `electrical_crm-prod-*.sql.gz` in the same `$DEST`. Same 30-day window today, so harmless, but the
  local job will silently prune prod dumps if the policies ever diverge.
- **T1** `DESTRUCTIVE_PATTERN` covers only `TRUNCATE|DROP\s+TABLE` — not `DELETE FROM`, `DROP SCHEMA`,
  or `DROP DATABASE`. Matches the plan exactly; worth widening later.
- **T1** `migrateDestructiveGuard.test.ts` writes real `999998_guard_test_*.sql` files into
  `database/migrations/`. Cleanup is in `afterEach`, but a killed run leaves a stray migration in the
  repo. Prefer a temp dir injected into `runMigrations`.
- **T5** `EXT_TO_MIME` maps `.dwg`/`.dxf` to `image/vnd.dwg`/`image/vnd.dxf`, which `serveDocument`'s
  `type.startsWith('image/')` treats as inlineable. Not exploitable (no browser renders them) but
  contrary to the intent of the allowlist.

## 4. Per-task table

| Task | Plan compliance | Correctness | Notes |
|---|---|---|---|
| 1 Migrations | Full | Correct | Guard runs pre-execute, comments stripped so the neutralised files don't self-trip. Test proves both directions. |
| 2 Deactivated users | Full | Correct | All four paths use `status='active'`. No other token-issuing path exists: `requireAuth` only verifies the JWT, `requireAuthOrApiKey` issues nothing, `initJwtSecret`/seed-admin mint no user token. Existing 12 h tokens survive deactivation — Security #21, explicitly out of scope. |
| 3 Public proposal | Partial | Incomplete | Column list matches `ProposalPublicPage.tsx` exactly (all 10 fields read are present, nothing extra). `form_data` blob not projected — **B3**. |
| 4 VAPID key | Full | Correct | `INTERNAL_KEYS=['jwt_secret','vapid_private_key']`; key is absent from `ALLOWED_KEYS`, so PUT cannot set or echo it; GET filter precedes masking. |
| 5 Documents | Partial | Two defects | Ownership check correctly precedes `storeDocument`. Content-type map cannot be bypassed by double extension, case, or missing extension (unknown → `octet-stream` → `attachment`); all four serve paths use the stored type. Proxy — **B1**, **B2**. |
| 6 Escape/sanitize | Full | Correct | Every `req.body`-derived value escaped, `nl2br` after escaping; `validDays` is `Number()`-coerced. `sanitizeForPrompt` applied to `filename`/`label`/`cls` in both branches. `buildAgent1Content` grep = 0 hits, dead helper genuinely removed. |
| 7 MS OAuth | Full | Correct | 32-byte state, one-time (deleted on read), verified before the Microsoft token exchange; code is 60 s, single-use, 404 on replay; frontend captures `?mscode` in the `useState` initializer, strips it via `replaceState`, module-level in-flight guard blocks StrictMode double-spend. `mstoken` grep = 0 hits. See non-blockers. |
| 8 Atomic handoff | Full | Correct | All six writes plus both activity inserts on `client`; Outlook push and follow-up close-out after COMMIT; ROLLBACK in `catch`, `release()` in `finally`. The test injects a *real* Postgres error into the relink (which follows the proposal insert), so a green assertion genuinely requires rollback. |
| 9 Logs/proxy/health | Full | Correct | Redact paths are valid pino syntax and hit pino-http's `req.headers`/`res.headers` serializer output; `trust proxy = 1` is right for Render's single hop; health does `SELECT 1` under a 2 s race. |
| 10 DB allowlist | Full | Correct | `!currentDb.endsWith('_test')` — `electrical_crm` cannot satisfy it by any route, nor can `postgres` (Supabase's default), which the old blocklist missed. |
| 11 Backups | Full | Correct | SUCCESS log now sits immediately after `mv "$TMP" "$FINAL"`, before mirror and both prunes; iCloud prune has `\|\| true`; env-file check fires before any docker/pg call, so a missing file fails clean with no URL touched; `.env.*` + `!.env.example` verified by `git check-ignore` (`backend/.env.pre-migration` ignored, `.env.example` still trackable); `.crm/` already ignored. |
| 12 Deps | Full | Correct | `adm-zip 0.6.0`, `sharp 0.35.4`, `axios 1.20.0` in package.json, lockfiles, and `node_modules` alike. The only other lock deltas are sharp's own platform binaries (`@img/*`) and the `color`/`is-arrayish` chain it dropped. multer/jspdf/xlsx untouched. |

## 5. Test results I measured

| | typecheck | tests |
|---|---|---|
| backend run 1 | `tsc --noEmit` clean (exit 0) | **6 failed / 758 passed / 764**, 4 failed files |
| backend run 2 | — | **3 failed / 759 passed / 2 skipped / 764**, 2 failed files |
| frontend | `tsc --noEmit` clean (exit 0) | **9 failed / 347 passed / 356**, 2 failed files |

Backend failures land in `prebid.test.ts`, `bidStandardGeneration.test.ts`, `integration.test.ts`,
`jobNumberCollision.test.ts` — none of which this batch modifies. The set is genuinely
non-deterministic (6 → 3 across two runs, same source). I verified the most suspicious ones directly:
`prebid.test.ts` exercises `storeDocument`, so I restored main's `storeDocument.ts`, `upload.ts` and
`documents.ts` and re-ran it — **identical 3 failures**, so they pre-date Task 5. The failure modes
are environmental (`401 API key is invalid` where the test expects an unconfigured key; row-count
off-by-one; `soffice` conversion). Frontend: 7 × `useInstallPrompt` (happy-dom has no `localStorage`)
and 2 × `CustomerHub`; I restored main's `useAuth.ts` and re-ran `CustomerHub.test.tsx` — identical
2 failed / 4 passed. **I agree these are pre-existing**, but not with the executor's exact "5 backend"
figure; the suite is too flaky for a fixed number, and that flakiness itself deserves a batch.

Plan verification checklist, run literally, all as required:
`SELECT \* FROM generator_proposals WHERE proposal_token` → 0 hits; `mstoken` → 0; `file.mimetype` → 0;
`buildAgent1Content` → 0. `git diff --stat main..HEAD -- frontend/src/features/` → empty (LoginPage.tsx
was allowed but not needed). Gens pipeline: `routes/gens.ts` +13/-4, the one public route only;
`src/ai/` changes are Task 6's authorized deletions and the new sanitization test. No unauthorized
file in the 37-file diff.

## 6. Could not verify

- `backup-prod-db.sh`'s dry run — I did not execute it (safety rules). Verified by inspection that
  `fail` returns before any `docker`/`pg_dump` invocation when `.crm/prod-db.env` is absent, and that
  no code path prints `PROD_DATABASE_URL`. Note the script does `mkdir -p "$REPO/.crm"` and appends a
  `FAILURE (prod)` line to Local Version's `.crm/backup.log` before that check, as the report says.
- The launchd plist actually loading (`launchctl bootstrap`) — Jake's manual step.
- `adm-zip 0.6.0` behavioural parity beyond what the suite covers. An
  `ADM-ZIP: Invalid or unsupported zip format` line appears in both backend runs, but it is a logged
  error from a passing negative-path test in `preconstruction.ts`'s takeoff import, present in both.
- Whether Render actually terminates TLS through exactly one proxy hop (`trust proxy = 1`); it does by
  default, but I could not confirm the deployment config from here.

---

# Re-review — commits `cb5175e..HEAD` (bc0f326, 65c4a85, 7df8130, 3a7e612)

## Verdict: **MERGE AFTER FIXES**

B1 and all seven non-blockers are fixed correctly. B3's fix is the problem: it strips keys the
public page still needs, and the confidentiality benefit it claims does not exist because
`totals_data` ships the same numbers ungated.

## Blocking

**R1 — the projection breaks legacy proposals' totals, showing a wrong price on a signable contract.**
`frontend/src/pages/ProposalPublicPage.tsx:177-178`
```ts
const totals = parseSnapshot<GenTotals>(gen?.totals_data)
  ?? (form ? calcGenTotals(form as GenForm) : null);
```
`calcGenTotals` (genCalc.ts:185-243) reads `g.pad, g.battery, g.emPanel, g.gasLine, g.removal,
g.removalFee, g.genPriceOverride` — none of which are in `GEN_FORM_KEYS`
(`backend/src/utils/publicFormData.ts:17-24`) — plus `g.labor, g.permit, g.startup, g.discount,
g.discountType, g.taxRate`, which are dropped whenever `includeBreakdown` is false. On any proposal
saved without a `totals_data` snapshot (the exact case that fallback exists for, per the comment at
:175-176) the customer now sees a wrong total and deposit. EV is identical: `calcEvTotals`
(evCalc.ts:1-24) needs `e.tierPriceOverride` (absent from `EV_FORM_KEYS`) and `e.taxAmount`
(breakdown-gated). Fix: add the calc-input keys, and prefer computing totals server-side when
`totals_data` is null rather than gating inputs the math needs.

**R2 — legacy field migration is now dead.**
`frontend/src/pages/ProposalPublicPage.tsx:170-174` migrates `smm, surgePro, ats, lcATS,
additionalATS` (migrateGenForm, genCalc.ts:45-60) precisely "so those scope-of-work lines still
render correctly if a customer revisits an old link." The whitelist drops all five before
`migrateGenForm` ever sees them, so pre-unification proposals lose their ATS/SMM/SurgePro lines.
Fix: whitelist the five legacy aliases.

**R3 — the breakdown gating is ineffective, so the comment and commit message overstate it.**
`backend/src/routes/gens.ts:1353` still returns `totals_data` whole, and `GenTotals` carries
`laborAmt, permitAmt, startupAmt, discountAmt, subtotal, taxableBase, nonTaxableBase, taxedAmount`.
`ProposalPreview.tsx` reads `totals.laborAmt/permitAmt/startupAmt` *outside* the
`{form.includeBreakdown && …}` block (verified: all three appear before line 330), so the page needs
them and they cannot simply be dropped. Net effect: hiding the breakdown remains cosmetic, contrary
to `publicFormData.ts:14-16`. Fix: either correct the claim, or gate the breakdown-only `totals_data`
keys (`subtotal, taxableBase, nonTaxableBase, taxedAmount, discountAmt`) too. My original B3 concern
about the four internal site-detail fields **is** genuinely closed.

## Non-blocking

- `GET /api/auth/microsoft` now shares `authLimiter` (auth.ts:14-20, max 10 / 15 min) with `/login`,
  `/forgot-password`, `/reset-password`. Behind Render + `trust proxy 1`, an office NAT gets 10
  combined auth attempts per 15 minutes; failed passwords now also burn the SSO budget. Consider a
  separate, looser limiter for `/microsoft`.
- `/documents/drive-file/:fileId` has zero remaining frontend callers (grep: only DriveImage's own
  fallback). Correct and locked down, but now effectively dead code.
- The new `gensPublicFormDataProjection.test.ts` asserts the key set only — nothing covers the
  no-`totals_data` fallback or a legacy-aliased form, which is why R1/R2 slipped through.
- Scope: `frontend/src/features/` is now touched (GenProjectsPage.tsx:77,
  ElecProjectsPage.tsx:1080), which the plan's checklist restricted to LoginPage.tsx. Both changes
  are one-line `src=` props required by the B2 fix I asked for — flagging for the record.

## Verified good

B1: the `documents` row check now sits outside `if (scope)` (documents.ts:205-215) — every role fails
closed. B2: `/gens/:id/photos/:fileId` (gens.ts:1391-1408) and `/bids/:id/photos/:fileId`
(bids.ts:651-668) sit behind `loadOwnedGen`/`loadOwnedBid` and require
`getFileParents(fileId).includes(record.drive_photos_folder_id)`; a rep guessing another rep's photo
id fails the parent check, a file elsewhere in the job folder (signed contracts) fails it too, and
`getFileParents` returns `null`/`[]` → 403 on any Drive error. Nothing else proxied untracked ids.
Non-blockers: state map capped at 1000 with oldest-first eviction before insert; bad state now
redirects to `/login?error=oauth_state`; `closeLeadFollowups` `.catch`-guarded; exactly one
`client.release()` per path with `release(rollbackErr)` on a failed ROLLBACK; `.dwg/.dxf` →
`application/acad`/`application/dxf`; `-e PGURL` + `sh -c`; prune glob `electrical_crm-[0-9]*`.

## Tests I measured (one run each)

- backend: `tsc --noEmit` clean; **5 failed / 763 passed / 5 skipped of 773**, 4 failed files —
  `bidStandardGeneration`, `integration`, `jobNumberCollision`, `prebid`: the same pre-existing flaky
  set, none touched by this branch.
- frontend: `tsc --noEmit` clean; **9 failed / 347 passed of 356** — identical `useInstallPrompt` (7)
  and `CustomerHub` (2), both confirmed pre-existing earlier.

Tree clean (`git status --short` empty); no commits, no pushes.

---

# Final pass — commits `3a7e612..HEAD` (470486a, f3d1b68, 8fb42c4)

## Verdict: **MERGE**

R1, R2 and R3 are all closed. No new findings; nothing blocking.

**(1) Key lists.** I recomputed the required sets mechanically (union of `g.*` and `out.*` in
`genCalc.ts`, `e.*` in `evCalc.ts`, and `form.*` in `ProposalPreview.tsx` / `EvProposalPreview.tsx`)
and set-diffed them against `backend/src/utils/publicFormData.ts:63-78` (GEN, 49 keys) and `:80-86`
(EV, 19 keys):

```
MISSING from GEN: feedFt, genSide, panelFt, panelRel
EXTRA in GEN   : (none)
MISSING from EV : (none)
EXTRA in EV    : customItems
```

Exactly the four internal site-detail fields are excluded, and nothing else — `migrateGenForm`
(genCalc.ts:70-73) defaults all four, so dropping them is safe. The `customItems` "extra" on EV is
real: `activeCustomItems(e)` reaches it indirectly. All five legacy aliases (`smm, surgePro, ats,
lcATS, additionalATS`) are present, as are every `calcGenTotals` input I named in R1 (`pad, battery,
emPanel, gasLine, removal, removalFee, genPriceOverride, evChargerPriceOverride`) and
`tierPriceOverride`/`taxAmount` for EV. The `includeBreakdown` gate is gone (the function body at
:110-116 has no conditional branch), and both the module comment (:17-26) and `gens.ts:1373-1379`
now state accurately that `totals_data` already carries the same figures ungated.

**(2) Tests.** `ProposalPublicPage.formDataProjection.test.tsx:92-137` renders the real page with
`totals_data: null` and asserts `data-total`/`data-deposit` equal `calcGenTotals`/`calcEvTotals` on
the *unprojected* original — genuine proof for both product types.
`ProposalPublicPage.legacyFields.test.tsx:67-87` feeds a form with only `smm/surgePro/ats/lcATS/
additionalATS` and asserts the "Smart Management Module", "Whole-Home Surge Protector" and "200A ATS"
lines render. The frontend projection helper is a hand-written mirror (cross-package import breaks
`rootDir`, documented), but `gensPublicFormDataProjection.test.ts:82-111` covers the real backend
list directly — asserting every calc input and every legacy alias survives the actual HTTP response,
ungated. Together they close the gap.

**(3) Limiter.** `auth.ts:22-35` defines a separate `msLoginLimiter` (30 / 15 min); `authLimiter`
(10 / 15 min) still guards `/login`, `/forgot-password`, `/reset-password`.
`authMicrosoftOAuth.test.ts:45-48` asserts `ratelimit-limit: 30`; the state/replay/exchange tests are
unchanged and pass.

**(4) Scope.** Diff is only those two route files, three test files, `publicFormData.ts`, two new
frontend tests, and the report. Nothing else.

## Tests (one run each)

- backend: `tsc --noEmit` clean; **4 failed / 764 passed / 7 skipped of 775**, 3 failed files
  (`integration`, `jobNumberCollision`, `prebid`) — the known pre-existing flaky set.
- frontend: `tsc --noEmit` clean; **9 failed / 350 passed of 359** — the same `useInstallPrompt` (7)
  and `CustomerHub` (2), both confirmed pre-existing.

Tree clean (`git status --short` empty); no commits, no pushes.
