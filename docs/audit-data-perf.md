# APT Electrical CRM — Data Layer & Performance Audit

Read-only audit, 2026-09-03. Row counts are live from the local Postgres (`electrical_crm`, 19 MB).

**Scale today:** notifications 5,052 · lead_activity 314 · audit_log 130 · activity 111 · tasks 97 · intake_items 87 · leads 69 · documents 65 · generator_proposals 39 · bids 35 · customers 31 · projects 14 · users 2. Nothing is slow at this size — findings are ranked by **risk**, not current latency.

---

## Findings

### 1. HIGH — Two migrations `TRUNCATE` the business tables and stay in the boot chain forever
`database/migrations/025_clear_test_data.sql:2`
```sql
TRUNCATE TABLE takeoff_results, bid_workspaces, project_rfis, project_field_notes,
  project_change_orders, project_sections, communications, documents, activity,
  won_jobs, generator_proposals, bids CASCADE;
```
Plus `056_clear_test_leads.sql:4` — `TRUNCATE TABLE leads CASCADE;`

`backend/src/migrate.ts:154` runs on every boot and skips a file only if a row exists in `schema_migrations` — a table living *inside the same database*. Any case where data is present but tracking is not (a dump restored without `schema_migrations`, a hand-built DB, the wrong-`DATABASE_URL` mistake already documented at `render.yaml:29-38`) wipes every bid, proposal, document and lead on the next deploy.

**Fix:** neutralise both files now that they are applied everywhere (`-- historical no-op; see git history`), and add a guard in `migrate.ts` refusing any migration containing `TRUNCATE`/`DROP TABLE` unless `ALLOW_DESTRUCTIVE_MIGRATIONS=1`.

---

### 2. HIGH — Notifications regenerate every day and are never purged
`backend/src/notifications/engine.ts:70,110,139`
```ts
`followup:${t.id}:${day}`,   // dedup key contains the calendar day
`biddue:${b.id}:${day}`,
`lead_overdue:${l.id}:${day}`,
```
Because the day is in the dedup key, one still-open follow-up produces a *new* row every day it stays open. Live proof: 5,052 rows over 92 days (~55/day) for 2 users — `followup_due` 3,385 and `lead_overdue` 1,583 are 98% of the table, and **2,408 are unread**, which is why the bell badge is meaningless. `backend/src/utils/audit.ts:83-88` purges `audit_log` and soft-deleted bids/gens/documents/won_jobs — `notifications` is not in the list.

**Fix:** drop `:${day}` from the three dedup bases, and add to `purgeExpired`:
```sql
DELETE FROM notifications WHERE read AND created_at < now() - interval '60 days';
DELETE FROM notifications WHERE NOT read AND created_at < now() - interval '180 days';
CREATE INDEX notifications_created_idx ON notifications(created_at);
```

---

### 3. HIGH — Lead → proposal handoff writes six tables with no transaction
`backend/src/routes/leads.ts:670,687,695` → `convertLeadToProposal` at `:285,298,316,322`
```ts
await pool.query('UPDATE leads SET site_visit_at=$1, ... WHERE id=$3', ...);  // :687
const genId = await convertLeadToProposal(updated, req.user);                 // 4 more writes
```
The helper does INSERT `generator_proposals` → INSERT `proposal_activity` (timeline copy) → UPDATE `documents` (re-link files) → UPDATE `leads SET stage='converted'`. Six separate `pool.query` calls, no `BEGIN`. A crash or Render redeploy mid-flight leaves a lead marked converted with no proposal — it vanishes from both boards.

**Fix:** one `pool.connect()` client wrapped in `BEGIN…COMMIT` with `ROLLBACK` in `catch`, threaded through `convertLeadToProposal` — the pattern already used correctly in `routes/bids.ts` and `routes/gens.ts`.

---

### 4. HIGH — `leads` has no `org_id`; multi-tenancy is incomplete
`\d leads` has no `org_id`, while `bids`, `generator_proposals`, `documents`, `won_jobs`, `customers`, `tasks`, `notifications` and 12 others all carry `org_id uuid NOT NULL` (migration `043_multitenancy_foundation.sql`). Also missing on `lead_activity`, `proposal_activity`, `bid_estimates`, `bid_takeoffs`, `bid_cost_breakdown`, `bid_prebid_scope`, `push_subscriptions`. The moment a second organisation exists, `GET /api/leads` (`routes/leads.ts:466`) returns every org's leads — there is nothing to filter on.

**Fix:**
```sql
ALTER TABLE leads ADD COLUMN org_id uuid NOT NULL
  DEFAULT '00000000-0000-0000-0000-000000000001' REFERENCES organizations(id);
CREATE INDEX leads_org_idx ON leads(org_id);
```
Repeat for `lead_activity` and `proposal_activity`.

---

### 5. HIGH — Orphaned recursive poll in PcWorkspace can outlive the component
`frontend/src/features/preconstruction/PcWorkspace.tsx:411,449`
```js
pollRef.current = setTimeout(async () => {
  const { data } = await api.get(`/preconstruction/${bid.id}/results`);
  ...} else { pollForResults(startMs, nextA2, nextA3, 0); }   // :449 — reschedules
}, 3000);
```
Cleanup at `:507-510` clears only `pollRef.current`. If the component unmounts while the `await` is in flight, the continuation schedules a *new* timeout nothing owns — an un-cancellable request every 3 s for the rest of the session. Same shape in `pollAgent4` (`:463,477`). There is no elapsed cap either, so a stuck `running` status polls forever.

**Fix:** a `cancelled` ref checked after every `await` before rescheduling, plus a hard deadline (e.g. 10 min) that stops the loop and surfaces a timeout state.

---

### 6. MEDIUM — Whole tables fetched to the browser and filtered client-side
`frontend/src/features/elec-projects/ElecProjectsPage.tsx:133,148`
```js
api.get('/documents'), api.get('/comms'),
...
docs: (docRes.value.data as ProjDoc[]).filter(d => d.linked_id === id),
```
The backend already supports the filter (`routes/documents.ts:40`). Every project open transfers the whole document + comms corpus to discard nearly all of it. Same pattern at `features/docs/DocsPage.tsx:66` (all documents, filtered at `:133-141`) and `components/SearchBox.tsx:34` (`/leads?include_converted=1` — the entire lead history to show at most 4 rows).

**Fix:** pass `?linked_id=` on the project fetch; add server-side `q`/`category` filters + pagination to `/documents` and `/leads`.

---

### 7. MEDIUM — Core list endpoints return every row; pagination is opt-in and unused
`backend/src/routes/bids.ts:38-42`
```ts
let sql = `SELECT * FROM bids WHERE ${where.join(' AND ')}`;
sql += ' ORDER BY created_at DESC';
// Opt-in pagination: ?limit=N&offset=M. Omitted → return all rows (backward compatible).
```
Identical at `routes/gens.ts:135`; unbounded with no opt-in at `routes/leads.ts:466`, `wonJobs.ts:11-12`, `customers.ts:107-109`, and `preconstruction.ts:1335` (`SELECT * FROM bid_workspaces` — every workspace in the system, on app load). Measured: bids list 22 kB / 26 rows; **generator_proposals list 207 kB / 31 rows** (~6.8 kB per row — `form_data`, `totals_data`, `checklist_data`, `survey_markup` JSONB all ride along in `SELECT *`). At 500 proposals that is a 3–4 MB response per dashboard load.

**Fix:** name the columns the list view renders, leave JSONB blobs to the detail endpoint, and default `limit` to 100.

---

### 8. MEDIUM — `/brief` is 13 uncached queries, polled every 60 s per open tab
`frontend/src/features/command-center/CommandCenterPage.tsx:148`
```js
useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
```
Server side, `backend/src/services/brief.ts:211-296` is a `Promise.all` of 13 queries including whole-table `COUNT(*) FILTER (…)` scans over `intake_items`/`leads`/`won_jobs`/`generator_proposals`, a 10-subquery CTE (`:262-276`), and an unbounded union of every lead + customer email (`:281-283`). Only the Microsoft Graph half is cached (`brief.ts:110`); the SQL half is deliberately always-fresh.

**Fix:** wrap the SQL half in the same 60–120 s TTL + in-flight-collapse cache already written for the Graph snapshot. A morning digest does not need sub-second freshness.

---

### 9. MEDIUM — API client has no cache, dedup, timeout, or cancellation
`frontend/src/api/client.ts:3`
```js
const api = axios.create({ baseURL: '/api' });
```
23 lines: auth header + 401 redirect. There is **zero** `AbortController`/`signal:` usage anywhere in `frontend/src`. Direct consequence: `GenDetailDrawer.tsx:79,408,415,419` fires the *identical* `/documents?linked_id=<gen.id>` request four times in parallel on open (via `useKickoffDocs`, `DocSlot.tsx:19`, `SignedContractCard.tsx:81`, `RecordFiles.tsx:62`).

**Fix:** a small request-dedup + short-TTL cache keyed on method+URL+params in the axios layer, a default `timeout`, and an `AbortController` per in-flight request keyed to component lifetime.

---

### 10. MEDIUM — Email attachment builder loads every document's base64 before checking size
`backend/src/email/bidAttachments.ts:95-101`
```sql
SELECT id, name, display_name, category, file_type, file_size, file_data, storage_url
  FROM documents WHERE linked_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC
```
No `LIMIT`, and the "skip oversized" check (`:112`) runs in JS *after* every row is in the Node heap. Largest single `file_data` today is **2.4 MB** base64; a bid with a plan set could pull tens of MB per email draft.

**Fix:** two-pass — select metadata, apply the size budget, then fetch `file_data` only for surviving ids.

---

### 11. MEDIUM — `/api/dashboard` returns three full tables with a per-row correlated subquery
`backend/src/routes/dashboard.ts:13`
```sql
SELECT b.*, COALESCE((SELECT SUM(amount) FROM project_change_orders
   WHERE project_id=b.id AND status='approved'),0) AS co_approved_total, wj.date_won
  FROM bids b LEFT JOIN won_jobs wj ON wj.proposal_id=b.id::text …
```
`EXPLAIN ANALYZE` confirms the subplan runs once per bid (`loops=26`) and the `won_jobs` join is a nested loop with a seq scan per outer row (`Rows Removed by Join Filter: 201`).

**Fix:** `LEFT JOIN LATERAL` or a grouped CTE over `project_change_orders`; select explicit columns. `wj.proposal_id = b.id::text` is a `text`↔`uuid` mismatch — retyping `won_jobs.proposal_id` to `uuid` lets the planner use `won_jobs_proposal_id_key` cleanly.

---

### 12. MEDIUM — Missing indexes on foreign keys
Confirmed absent from `pg_indexes`: `bids.signed_document_id`, `customers.owner_id`, `generator_proposals.countersigned_by`, `intake_items.created_by`, `leads.linked_gen_id`. Each makes the *parent's* delete/reassign a seq scan of the child table.
```sql
CREATE INDEX CONCURRENTLY bids_signed_document_idx ON bids(signed_document_id) WHERE signed_document_id IS NOT NULL;
CREATE INDEX CONCURRENTLY customers_owner_idx ON customers(owner_id);
CREATE INDEX CONCURRENTLY gens_countersigned_by_idx ON generator_proposals(countersigned_by);
CREATE INDEX CONCURRENTLY intake_items_created_by_idx ON intake_items(created_by);
CREATE INDEX CONCURRENTLY leads_linked_gen_idx ON leads(linked_gen_id) WHERE linked_gen_id IS NOT NULL;
```

---

### 13. MEDIUM — Missing indexes on columns the routes filter and sort by
`leads` is ordered by `created_at DESC` with `deleted_at IS NULL` (`routes/leads.ts:466`) and filtered on `stage NOT IN (…)` in five brief queries (`services/brief.ts:218,240,252`), but has only `leads_stage_idx` and `leads_salesperson_id_idx`. `intake_items` is queried `WHERE status='pending' OR updated_at > now() - interval '7 days'` (`routes/intake.ts:95`) — the `OR updated_at` arm cannot use `intake_status_idx`. `tasks(linked_type, linked_id)` drives the action queue (`routes/leads.ts:498`) unindexed.
```sql
CREATE INDEX CONCURRENTLY leads_active_created_idx ON leads(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY intake_items_updated_idx ON intake_items(updated_at DESC);
CREATE INDEX CONCURRENTLY tasks_linked_idx ON tasks(linked_type, linked_id) WHERE status = 'open';
```

---

### 14. MEDIUM — Six tables grow without bound; `file_data` bloats every backup
`utils/audit.ts:83-88` is the only retention job. Uncovered: `notifications` (5,052, see #2), `intake_items` (87, email poller every 20 min, no `deleted_at`, never deleted), `lead_activity` (314), `proposal_activity` (62, copied wholesale on every conversion at `leads.ts:298`), `activity` (111), `communications`. Separately, 65 documents already hold **3.8 MB** of base64 inside the row heap — base64 costs 33% over the raw bytes and, unlike Cloudinary/Drive storage, lands in every `pg_dump`.

**Fix:** extend `purgeExpired` with the tables above; stop writing `file_data` when a `storage_url` exists (`utils/storeDocument.ts:139` writes both), then backfill `file_data = NULL WHERE storage_url IS NOT NULL`.

---

### 15. MEDIUM — Intake inbox recomputes an O(pending × all-bids) match per request
`backend/src/routes/intake.ts:104-113`
```ts
const { rows: bidRows } = await pool.query(`SELECT id, name, stage FROM bids WHERE deleted_at IS NULL`);
withSimilar = rows.map(item => { … findSimilar(item.name, [...intakeCandidates, ...bidCandidates]) });
```
87 × 35 is nothing today; 2,000 intake items × 800 bids is 1.6 M string comparisons per request on an endpoint the sidebar badge polls.

**Fix:** compute `similar` once at ingest and store it, or cache keyed on `max(updated_at)` of both tables.

---

### 16. MEDIUM — PcWorkspace fires 7 GETs on every mount, and remounts on every tab switch
`frontend/src/features/preconstruction/PcWorkspace.tsx:491,513-525` issues `/preconstruction/costs`, `/{id}/takeoff`, `/intelligence/{id}`, `/estimates/unit-costs`, `/estimates/{id}`, `/documents?linked_id={id}`, `/{id}/results`. `BidHubPage.tsx:114` renders it as `{tab === 'estimating' && (<PcWorkspaceView …/>)}`, so it unmounts/remounts per tab click and all seven refire — including `/preconstruction/costs` and `/estimates/unit-costs`, which are global constants. The autosave effect at `:378-394` has no first-run guard, so each open also writes a no-op `PUT /workspace` 800 ms later.

**Fix:** keep the component mounted (`hidden` instead of unmount), hoist the two global fetches to app scope, and guard the autosave with a `didMount` ref.

---

### 17. MEDIUM — Hourly reminder scan is an N+1 insert loop
`backend/src/notifications/engine.ts:52-58`
```ts
for (const uid of targets) {
  if (await createNotification(uid, { ...n, dedupKey: `${dedupBase}:${uid}` })) created = true;
}
```
Called once per row of `tasks` (`:66`), `generator_proposals` (`:87`), `bids` (`:105`) and `leads` (`:131`). ~97 open tasks × 2 admins = ~194 sequential round-trips per hour today; 1,000 tasks × 6 users is 6,000.

**Fix:** one multi-row `INSERT … SELECT … ON CONFLICT DO NOTHING` per reminder type.

---

### 18. LOW — Three independent 60 s pollers where one would do
`App.tsx:157` (`/intake/unread-count`), `hooks/useNotifications.ts:44` (`/notifications`), `CommandCenterPage.tsx:148` (`/brief`). All are cleaned up correctly — but `/brief` already returns the intake unread/today/yesterday counts (`services/brief.ts:226-230`), so the dashboard makes 3 requests/min for 2 requests' worth of data.

**Fix:** derive the sidebar intake badge from the brief payload on the Command Center route.

---

### 19. LOW — Duplicate index on `documents(linked_id)`
`database/migrations/015_create_documents.sql:15` creates `doc_linked_idx`; `019_add_indexes.sql:5` creates `docs_linked_idx` — identical definition, different name, so `IF NOT EXISTS` never caught it. Both are live in `pg_indexes`. Doubles write and vacuum cost on the table with the largest rows. **Fix:** `DROP INDEX docs_linked_idx;`

---

### 20. LOW — Connection pool has no explicit sizing or statement timeout
`backend/src/db/pool.ts:5-14` sets no `max`, `idleTimeoutMillis`, `connectionTimeoutMillis` or `statement_timeout`; `pg` defaults to `max: 10`. `/api/brief` alone issues 13 concurrent queries, so one Command Center load saturates the pool and queues.
```ts
new Pool({ …, max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, statement_timeout: 15_000 })
```

---

### 21. LOW — Polymorphic `linked_id` columns are untyped TEXT with no FK
`documents.linked_id`, `communications.linked_id`, `tasks.linked_id` are all `text` with no foreign key — they hold a bid, proposal or lead id depending on `div`. Purge routines enumerate them by hand (`routes/bids.ts:697-699`, `gens.ts:708`), and any missed path orphans rows silently; `services/proposalQuietSweep.ts:30` explicitly records that "the Render database move landed orphans that the FK would have blocked."

**Fix:** not worth retyping at this size — add `CREATE INDEX documents_linked_div_idx ON documents(div, linked_id) WHERE deleted_at IS NULL;` and a nightly orphan report.

---

### 22. LOW — Soft-delete filter missed in the countersign gate
`backend/src/routes/gens.ts:1528`
```sql
SELECT 1 FROM documents WHERE linked_id = $1 AND category = 'contract' AND name LIKE 'Signed Proposal%' LIMIT 1
```
No `deleted_at IS NULL`, so a trashed signed proposal still satisfies the "already filed" check and the route returns `{ skipped: true }` without re-filing. Every other document gate in the file filters correctly (`:1246`, `:1265`) — an isolated miss. **Fix:** add `AND deleted_at IS NULL`.

---

### 23. LOW — Background schedulers are guarded in-process only
`integrations/intakePoller.ts:21`, `leadNudge.ts:147`, `proposalQuietSweep.ts:307` and `notifications/engine.ts` all use `if (running) return; running = true;` — correct for one Node process. `render.yaml` declares no `numInstances`, so there is exactly one today, but scaling to 2 would double every poll: duplicate nudge emails and duplicate Outlook drafts.

**Fix:** before scaling, move the guard to `SELECT pg_try_advisory_lock(<constant>)` held for the tick.

---

### 24. LOW — Unanchored `ILIKE` search and ambiguous migration numbering
`routes/customers.ts:77` — `name ILIKE '%q%' OR company ILIKE '%q%'` cannot use a btree; at ~5,000 customers add `pg_trgm` + a GIN index. Separately, `database/migrations/` has two files at prefix `053`, a hyphen-separated block (`044-…` through `048-…`) among underscore-separated ones, and a gap at `090`/`091`; `migrate.ts:23` orders by plain lexicographic `.sort()`. Verified healthy today: all 94 files on disk are in `schema_migrations` and no applied row lacks a file — **zero drift**.

---

## Done well

- **Money is `numeric` everywhere** — `bids.amount`, `won_jobs.value`/`commission_amount`, all of `bid_cost_breakdown`, `projects.contract_value`. Zero floats in money columns.
- **All timestamps are `timestamptz`** — an `information_schema.columns` sweep for `timestamp without time zone` returns nothing.
- **25 `CHECK` constraints** cover the enum-ish text columns: `bids_stage_check`, `leads_stage_check`, `leads_source_check`, `documents_category_check`, `users_role_check`, `intake_items_status_check`. Stage typos cannot enter the database.
- **Migrations are tracked, transactional, and fail closed** — `migrate.ts:34-45` wraps each file in `BEGIN`/`COMMIT` with `ROLLBACK` + `throw`; `index.ts:180-183` aborts startup on failure. No partial-application risk within a file.
- **No connection leaks** — all 15 `pool.connect()` sites have a matching `client.release()`, every one in a `finally`.
- **Soft-delete discipline is near-total** — a sweep of all queries on the six soft-delete tables found exactly one real miss (#22).
- **JSONB is opaque storage, never queried** — zero `@>`, `->>`, `#>` or `jsonb_*` operators in `backend/src`, so the absence of GIN indexes is correct, not a gap.
- **Partial indexes used well** — `bids_active_idx`, `gens_active_idx`, `documents_active_idx`, `projects_source_idx` are all `WHERE deleted_at IS NULL`.
- **The `/documents` list endpoint never selects `file_data`** (`routes/documents.ts:57` enumerates columns) — the classic base64-in-a-list-endpoint trap is already avoided.
- **Graph API calls are cached with in-flight collapsing** — `services/brief.ts:110-112`. Exactly the pattern the SQL half needs.
- **Every one of 204 frontend `useEffect` call sites has an explicit dependency array** — no missing-dep fetch loops anywhere; all four non-recursive timers clear on unmount, and `PreBidAnalyze.tsx:61` adds a redundant safety-net `clearInterval`.
- **App bootstrap is a proper fan-out, not a waterfall** — `App.tsx:94` `Promise.all([/dashboard, /users, /preconstruction/workspaces])`; `ElecProjectsPage.tsx:123-124` uses `Promise.allSettled` across 11 endpoints behind an `if (projData[id]) return;` cache guard.
- **Deep-link effects use ref sentinels** (`ElecProjectsPage.tsx:162-171`, `LeadsPage.tsx:137-153`) so a fetch fires strictly once per id.

---

## Unverified

- **Production row counts and index set.** All measurements are against the local Docker Postgres. Production runs on Supabase (`render.yaml:38`, dashboard-managed `DATABASE_URL`) and was not reachable. If production is materially larger, #6, #7, #8, #11 and #15 move up in severity.
- **Whether Supabase sits behind PgBouncer**, which would soften #20 and may already impose a server-side `statement_timeout`.
- **Real-world `file_data` sizes.** Local max is 2.4 MB; production plan sets could make #10 an out-of-memory risk rather than memory pressure.
- **Index usage statistics.** `pg_stat_user_indexes` shows `idx_scan = 0` for every index locally, so no index could be called genuinely unused — #19 rests on identical *definitions*, not usage.
- **Whether the `/brief` 60 s poll runs in production with Graph configured.** If `GRAPH_*` is set and the user is privileged, each poll also makes three Microsoft Graph calls (cached by TTL), which was not measured live.
