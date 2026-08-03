# Division-Hub Navigation Restructure — Design

**Date:** 2026-08-02
**Status:** Approved by Jake
**Scope:** Reorganize + consolidate. Full IA restructure into division hubs, page consolidation, deep-link migration, one new workflow feature (auto follow-up on quiet proposals).

## Problem

The sidebar has 14 items mixing generator, electrical, and estimating concerns with no division grouping. Two separate "home" pages (Command Center, Sales Dashboard) both blend divisions. Reps navigate by memorizing which of many flat tabs holds what. Industry pattern (ServiceTitan business units, JobNimbus per-workflow boards, Buildertrend hub-and-tab) is one small nav with division as a first-class section.

## New sidebar (14 → 8)

```
■ Home           (Command Center + sales KPIs merged)
⚡ Generators     → hub tabs: Overview · Leads · Pipeline · Jobs
🔧 Electrical     → hub tabs: Overview · Intake · Bids · Projects
■ Contacts
■ Calendar
■ Follow-ups
■ Documents
⚙ Settings       (bottom, admin-gated — unchanged)
```

Nav data stays a `NavGroup[]` in `AppShell.tsx`, but the mobile bottom bar and More sheet must derive from the same config (today they are a separate hardcoded duplication).

## Hub pages

Two new pages: `GeneratorsHubPage`, `ElectricalHubPage` (new `frontend/src/features/generators-hub/` and `frontend/src/features/electrical-hub/` dirs, or equivalent).

- **URL shape:** path segments matching the app's existing `/{view}/{param}` parsing — `/generators/{tab}/{recordId?}`, `/electrical/{tab}/{recordId?}`. Examples: `/generators/pipeline`, `/generators/leads/{leadId}`, `/electrical/bids/{bidId}`.
- Tab validated against the hub's tab list; unknown/missing falls back to `overview` (same defensive pattern as BidHubPage's `?tab=`).
- **Tab bodies are the existing page components mounted as-is** — `LeadsPage`, `GenPipelinePage`, `GenProjectsPage`, `ElecPipelinePage`, `IntakeInboxPage`, `ElecProjectsPage` are re-parented, not rewritten. Record deep-link props (`openId`/`onClearParam`) flow through the hub.
- Tab bar style: the underline division-tab pattern from today's `PipelinePage` (amber = generators, blue = electrical).
- The 2-tab `PipelinePage` wrapper is **deleted**. Its known bug dies with it (tab state seeded from `defaultTab` prop via `useState` — deep-linking to the electrical tab while the generator tab is mounted silently fails and never opens the record).

### Generators hub tabs
| Tab | Body |
|---|---|
| Overview | new (see below) |
| Leads | existing `LeadsPage` |
| Pipeline | existing `GenPipelinePage` |
| Jobs | existing `GenProjectsPage` |

### Electrical hub tabs
| Tab | Body |
|---|---|
| Overview | new (see below) |
| Intake | existing `IntakeInboxPage` |
| Bids | existing `ElecPipelinePage` |
| Projects | existing `ElecProjectsPage` |

## Overview tabs (new, one per division)

Division-scoped only. Content:

1. **KPI row:** total sales YTD, open pipeline ($ + count), jobs won/closed, win rate.
2. **Stage breakdown with $ value per stage** — count and dollars sitting in each pipeline stage (ported/adapted from ReportingPage's divisions tab).
3. **Monthly revenue chart** (division-filtered).
4. **Recent wins** list.
5. **Division extras:** Generators → sent→viewed→signed proposal funnel (telemetry already exists); Electrical → bids due soon.

Data source: the existing `/dashboard` payload already fetched in `App.tsx` (bids, gens, wonJobs). No new endpoints for overviews. Win-rate math must respect the `superseded` stage exclusion (see 2026-08 award-grouping work).

## Home (merge)

`CommandCenterPage` stays the skeleton: daily brief, needs-action chips, agenda, reply queue. It absorbs from the dying `DashboardPage`:

- Company-wide KPI strip
- Stacked elec/gen monthly revenue chart
- Rep leaderboard + commissions (manager-gated — same `MANAGER_ROLES` rules; note the existing discrepancy between `MANAGER_ROLES` in DashboardPage and `PRIVILEGED_ROLES` in useAuth carries over as-is, not in scope to reconcile)

`SalesByRepPage` survives, linked from Home. View keys `sales-dashboard` and `reporting` die.

## Deep-link migration

Old view keys are emitted by the **backend** (notifications engine `link_view`, daily-brief `cta.navTo`) and exist in bookmarks. Two layers:

1. **Redirect map in `App.tsx`** (permanent):
   - `gen-leads[/{id}]` → `/generators/leads[/{id}]`
   - `pipeline`, `gen-proposals[/{id}]` → `/generators/pipeline[/{id}]`
   - `elec-proposals[/{id}]` → `/electrical/bids[/{id}]`
   - `intake` → `/electrical/intake`
   - `gen-projects[/{id}]` → `/generators/jobs[/{id}]`
   - `elec-projects[/{id}]` → `/electrical/projects[/{id}]`
   - `builder` → stays a real route (nav item removed, page survives — reached via New Proposal / From Calendar / lead handoff buttons)
   - `sales-dashboard`, `reporting` → `/` (Home)
   - `preconstruction` → `/electrical/bids` (replaces the current `/pipeline` redirect)
2. **Backend emitters updated** to emit new keys going forward: `backend/src/notifications/engine.ts`, `backend/src/services/brief.ts`, `backend/src/routes/gens.ts:1240`-area.

Frontend `onNav` callers updated: `SearchBox.tsx`, `CustomerHub.tsx` (`bid` links unchanged), `useGenPipeline.ts` toast, `LeadDetailDrawer.tsx`, Command Center chips, Home panel links. `/bid/{id}` Bid Hub route untouched. Topbar `TB` title map and contextual action buttons re-keyed to the new views.

## Mobile

Bottom bar: **Home · Generators · Electrical · More**. Division tap lands on Pipeline/Bids tab (field-usage default); hub tab bar scrolls horizontally on narrow screens. More sheet: Contacts, Calendar, Follow-ups, Docs, Settings (admin-gated). Both derive from the shared nav config.

## Feature: auto follow-up on quiet proposals

Server-side sweep, every 6 hours (timer started at server boot; pattern like existing pollers). Logic per run:

- Find generator proposals in stage `sent` where `sent_at` is older than the threshold, `signed_at IS NULL`, `deleted_at IS NULL`, and no **open** follow-up task already linked to that proposal.
- Two thresholds (Settings, new keys): `gen_followup_quiet_days` default **5** (sent, never viewed), `gen_followup_viewed_days` default **3** (viewed but unsigned — hotter lead, shorter fuse).
- Action: create a Follow-ups task linked to the proposal — "Proposal quiet {N} days — {customer}, sent {date}, viewed {yes/no}" — assigned to the proposal's salesperson, plus an in-app notification to that rep.
- Idempotent: **one auto-created task per proposal per threshold tier, ever** (marked via a metadata flag or naming convention on the task). No re-arm logic in v1 — a proposal can get at most two auto-tasks total (one from the never-viewed tier, one from the viewed-unsigned tier if the customer later views it).
- **No automatic customer emails in v1.** The task surfaces it; the rep decides.

## Kill / consolidation list

| Today | Fate |
|---|---|
| `PipelinePage` 2-tab wrapper | deleted |
| `ReportingPage` | deleted — divisions tab content → hub Overviews; company charts → Home |
| `DashboardPage` (`sales-dashboard`) | merged into Home, then deleted |
| Builder nav item | removed from nav; page + route survive (action-entry only) |
| `CommsPage` | untouched — stays an orphaned route exactly as today |
| `SalesByRepPage` | survives, linked from Home |

## Testing

- Existing suite (92 tests) stays green.
- New tests: hub tab routing (valid/invalid/missing tab, record deep-link pass-through), redirect map (every legacy key, with and without record id), follow-up sweep (threshold edges, idempotency, viewed-vs-unviewed thresholds).
- Ships as **one PR**; no intermediate half-restructured state on main.

## Execution model

- Plan authored with Fable 5 (this doc + the implementation plan).
- Implementation executed by Sonnet 5 subagents, phase by phase per the implementation plan.
- Final review pass by Fable 5 before the PR merges.
