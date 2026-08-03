# Division-Hub Navigation Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 14-item sidebar into 8 items with two division hubs (Generators, Electrical), each hosting Overview/Leads-or-Intake/Pipeline-or-Bids/Jobs-or-Projects tabs; merge Sales Dashboard into Home; delete ReportingPage and the PipelinePage wrapper; migrate all deep links; add an auto follow-up sweep for quiet proposals.

**Architecture:** New hub pages re-parent existing page components as tabs (no rewrites). URL shape `/{hub}/{tab}/{recordId?}` rides the existing segments-based view parsing in App.tsx. A pure legacy-redirect module keeps every old URL working. Backend sweep follows the existing `startLeadNudgeScheduler` + `tasks`-table auto-followup pattern.

**Tech Stack:** React 18 + TS (frontend, vitest + Testing Library), Express + pg (backend, vitest), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-02-division-hub-nav-design.md` — read it first.

## Global Constraints

- One PR; `main` never holds a half-restructured state.
- All existing tests stay green: `cd frontend && npx vitest run` (92 tests at plan time) and `cd backend && npx vitest run`.
- Typecheck clean both sides: `npx tsc --noEmit` in `frontend/` and `backend/`.
- Existing page components (`LeadsPage`, `GenPipelinePage`, `GenProjectsPage`, `ElecPipelinePage`, `IntakeInboxPage`, `ElecProjectsPage`, `BuilderPage`, `SalesByRepPage`, `CommsPage`) are re-parented or left alone — do NOT rewrite their internals.
- Win-rate math everywhere excludes gen stage `'superseded'` (it is neither won nor lost).
- Legacy view keys must keep working via redirect: `gen-leads`, `pipeline`, `gen-proposals`, `elec-proposals`, `intake`, `gen-projects`, `elec-projects`, `sales-dashboard`, `reporting`, `preconstruction`.
- `git commit` at the end of every task with the exact message given; commit messages end with the standard Co-Authored-By/Claude-Session trailer used in this repo's recent history.
- Branch: `feat/division-hub-nav` (already exists, spec committed on it).

---

### Task 1: Legacy-route resolver (pure module + tests)

**Files:**
- Create: `frontend/src/lib/legacyRoutes.ts`
- Test: `frontend/src/lib/legacyRoutes.test.ts`

**Interfaces:**
- Produces: `resolveLegacyPath(pathname: string): string | null` — returns the new path for a legacy URL, or `null` when the path is not legacy. Task 3 wires it into App.tsx.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/legacyRoutes.test.ts
import { describe, it, expect } from 'vitest';
import { resolveLegacyPath } from './legacyRoutes';

describe('resolveLegacyPath', () => {
  it.each([
    ['/gen-leads',                '/generators/leads'],
    ['/gen-leads/abc-123',        '/generators/leads/abc-123'],
    ['/pipeline',                 '/generators/pipeline'],
    ['/gen-proposals',            '/generators/pipeline'],
    ['/gen-proposals/id-1',       '/generators/pipeline/id-1'],
    ['/elec-proposals',           '/electrical/bids'],
    ['/elec-proposals/id-2',      '/electrical/bids/id-2'],
    ['/intake',                   '/electrical/intake'],
    ['/gen-projects/id-3',        '/generators/jobs/id-3'],
    ['/elec-projects',            '/electrical/projects'],
    ['/sales-dashboard',          '/dashboard'],
    ['/reporting',                '/dashboard'],
    ['/preconstruction',          '/electrical/bids'],
  ])('%s → %s', (from, to) => {
    expect(resolveLegacyPath(from)).toBe(to);
  });

  it('returns null for non-legacy paths', () => {
    expect(resolveLegacyPath('/dashboard')).toBeNull();
    expect(resolveLegacyPath('/generators/pipeline')).toBeNull();
    expect(resolveLegacyPath('/bid/some-id')).toBeNull();
    expect(resolveLegacyPath('/builder')).toBeNull();
    expect(resolveLegacyPath('/')).toBeNull();
  });

  it('keeps URI-encoded record ids intact', () => {
    expect(resolveLegacyPath('/gen-leads/a%20b')).toBe('/generators/leads/a%20b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/legacyRoutes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/lib/legacyRoutes.ts
// Old flat view keys → new division-hub paths. Backend-emitted links
// (notifications link_view, daily-brief CTAs) and bookmarks predate the hub
// restructure, so these redirects are permanent, not transitional.
const LEGACY: Record<string, { to: string; keepsId: boolean }> = {
  'gen-leads':       { to: '/generators/leads',    keepsId: true },
  'pipeline':        { to: '/generators/pipeline', keepsId: true },
  'gen-proposals':   { to: '/generators/pipeline', keepsId: true },
  'elec-proposals':  { to: '/electrical/bids',     keepsId: true },
  'intake':          { to: '/electrical/intake',   keepsId: false },
  'gen-projects':    { to: '/generators/jobs',     keepsId: true },
  'elec-projects':   { to: '/electrical/projects', keepsId: true },
  'sales-dashboard': { to: '/dashboard',           keepsId: false },
  'reporting':       { to: '/dashboard',           keepsId: false },
  'preconstruction': { to: '/electrical/bids',     keepsId: false },
};

export function resolveLegacyPath(pathname: string): string | null {
  const segments = pathname.replace(/^\/+/, '').split('/');
  const entry = LEGACY[segments[0]];
  if (!entry) return null;
  const id = entry.keepsId && segments[1] ? '/' + segments[1] : '';
  return entry.to + id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/legacyRoutes.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/legacyRoutes.ts frontend/src/lib/legacyRoutes.test.ts
git commit -m "feat: legacy view-key redirect resolver for division-hub URLs"
```

---

### Task 2: Division stats module (pure calc + tests)

**Files:**
- Create: `frontend/src/lib/divisionStats.ts`
- Test: `frontend/src/lib/divisionStats.test.ts`

**Interfaces:**
- Consumes: `Bid`, `Gen`, `WonJob` from `frontend/src/types/index.ts`.
- Produces (Task 5's Overview tabs consume these exact shapes):

```ts
export interface StageSlice { key: string; label: string; count: number; value: number }
export interface DivisionStats {
  ytdSales: number;           // sum of this division's wonJobs value, current calendar year
  openCount: number;
  openValue: number;
  wonCount: number;           // all-time awarded
  winRate: number | null;     // 0-100 rounded, null when no decided deals
  stages: StageSlice[];       // count + $ per pipeline stage, pipeline stages only
  monthly: number[];          // Jan..current month won-value, current year
}
export function genDivisionStats(gens: Gen[], wonJobs: WonJob[], now?: Date): DivisionStats
export function elecDivisionStats(bids: Bid[], wonJobs: WonJob[], now?: Date): DivisionStats
export function genFunnel(gens: Gen[]): { sent: number; viewed: number; signed: number }
```

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/divisionStats.test.ts
import { describe, it, expect } from 'vitest';
import { genDivisionStats, elecDivisionStats, genFunnel } from './divisionStats';
import { Bid, Gen, WonJob } from '../types';

const NOW = new Date('2026-08-15T12:00:00');

const gen = (o: Partial<Gen>): Gen => ({
  id: Math.random().toString(), customer: 'C', loc: 'L', mfr: 'Kohler', model: '20KW',
  kw: 20, amount: 10000, tax: 0, stage: 'building', built_on: '2026-01-01',
  addons: 0, salesperson_name: 'Rep', ...o,
} as Gen);

const bid = (o: Partial<Bid>): Bid => ({
  id: Math.random().toString(), name: 'B', stage: 'due', amount: 50000, ...o,
} as Bid);

const won = (type: 'Generator' | 'Electrical', value: number, dateWon: string): WonJob =>
  ({ id: Math.random().toString(), proposal_type: type, value, date_won: dateWon } as WonJob);

describe('genDivisionStats', () => {
  it('counts open pipeline, excludes terminal stages', () => {
    const s = genDivisionStats([
      gen({ stage: 'building', amount: 100 }),
      gen({ stage: 'sent',     amount: 200 }),
      gen({ stage: 'signed',   amount: 400 }),
      gen({ stage: 'awarded',  amount: 800 }),
      gen({ stage: 'declined', amount: 1600 }),
      gen({ stage: 'superseded', amount: 3200 }),
    ], [], NOW);
    expect(s.openCount).toBe(3);
    expect(s.openValue).toBe(700);
  });

  it('win rate excludes superseded from both sides', () => {
    const s = genDivisionStats([
      gen({ stage: 'awarded' }), gen({ stage: 'awarded' }),
      gen({ stage: 'declined' }),
      gen({ stage: 'superseded' }), gen({ stage: 'superseded' }),
    ], [], NOW);
    expect(s.winRate).toBe(67); // 2 / (2+1)
  });

  it('winRate is null with no decided deals', () => {
    expect(genDivisionStats([gen({ stage: 'sent' })], [], NOW).winRate).toBeNull();
  });

  it('ytdSales and monthly use only Generator wonJobs in the current year', () => {
    const s = genDivisionStats([], [
      won('Generator', 1000, '2026-01-10'),
      won('Generator', 2000, '2026-08-01'),
      won('Electrical', 999,  '2026-08-01'),
      won('Generator', 5000, '2025-12-31'),
    ], NOW);
    expect(s.ytdSales).toBe(3000);
    expect(s.monthly).toHaveLength(8); // Jan..Aug
    expect(s.monthly[0]).toBe(1000);
    expect(s.monthly[7]).toBe(2000);
  });

  it('stage breakdown has one slice per pipeline stage with $ totals', () => {
    const s = genDivisionStats([gen({ stage: 'sent', amount: 10 }), gen({ stage: 'sent', amount: 5 })], [], NOW);
    const sent = s.stages.find(x => x.key === 'sent')!;
    expect(sent.count).toBe(2);
    expect(sent.value).toBe(15);
  });
});

describe('elecDivisionStats', () => {
  it('open = due + submitted; win rate = awarded/(awarded+lost)', () => {
    const s = elecDivisionStats([
      bid({ stage: 'due', amount: 10 }),
      bid({ stage: 'submitted', amount: 20 }),
      bid({ stage: 'awarded' }),
      bid({ stage: 'lost' }), bid({ stage: 'lost' }),
    ], [], NOW);
    expect(s.openCount).toBe(2);
    expect(s.openValue).toBe(30);
    expect(s.winRate).toBe(33);
  });
});

describe('genFunnel', () => {
  it('sent counts open sent proposals; viewed and signed nest inside', () => {
    const f = genFunnel([
      gen({ stage: 'sent', sent_at: '2026-08-01' }),
      gen({ stage: 'sent', sent_at: '2026-08-01', viewed_at: '2026-08-02' }),
      gen({ stage: 'signed', sent_at: '2026-08-01', viewed_at: '2026-08-02', signed_at: '2026-08-03' }),
      gen({ stage: 'awarded', sent_at: '2026-08-01' }), // terminal — out of funnel
    ]);
    expect(f).toEqual({ sent: 3, viewed: 2, signed: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/divisionStats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/lib/divisionStats.ts
import { Bid, Gen, WonJob } from '../types';

export interface StageSlice { key: string; label: string; count: number; value: number }
export interface DivisionStats {
  ytdSales: number;
  openCount: number;
  openValue: number;
  wonCount: number;
  winRate: number | null;
  stages: StageSlice[];
  monthly: number[];
}

const GEN_STAGES: { key: Gen['stage']; label: string }[] = [
  { key: 'building', label: 'Building' },
  { key: 'sent',     label: 'Proposal Sent' },
  { key: 'signed',   label: 'Signed' },
  { key: 'awarded',  label: 'Awarded' },
  { key: 'declined', label: 'Declined' },
];

const ELEC_STAGES: { key: Bid['stage']; label: string }[] = [
  { key: 'due',       label: 'Due' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'awarded',   label: 'Awarded' },
  { key: 'lost',      label: 'Lost' },
];

const sum = (a: { amount?: number | null }[]) => a.reduce((s, x) => s + Number(x.amount ?? 0), 0);

function wonSlices(wonJobs: WonJob[], type: 'Generator' | 'Electrical', now: Date) {
  const year = now.getFullYear();
  const mine = wonJobs.filter(j => j.proposal_type === type);
  const thisYear = mine.filter(j => new Date(j.date_won).getFullYear() === year);
  const monthly: number[] = Array.from({ length: now.getMonth() + 1 }, () => 0);
  for (const j of thisYear) {
    const m = new Date(j.date_won).getMonth();
    if (m <= now.getMonth()) monthly[m] += Number(j.value ?? 0);
  }
  return { ytdSales: thisYear.reduce((s, j) => s + Number(j.value ?? 0), 0), monthly };
}

export function genDivisionStats(gens: Gen[], wonJobs: WonJob[], now: Date = new Date()): DivisionStats {
  const open = gens.filter(g => g.stage === 'building' || g.stage === 'sent' || g.stage === 'signed');
  const awarded = gens.filter(g => g.stage === 'awarded').length;
  const declined = gens.filter(g => g.stage === 'declined').length; // superseded excluded by construction
  const decided = awarded + declined;
  const { ytdSales, monthly } = wonSlices(wonJobs, 'Generator', now);
  return {
    ytdSales,
    openCount: open.length,
    openValue: sum(open),
    wonCount: awarded,
    winRate: decided > 0 ? Math.round((awarded / decided) * 100) : null,
    stages: GEN_STAGES.map(st => {
      const group = gens.filter(g => g.stage === st.key);
      return { key: st.key, label: st.label, count: group.length, value: sum(group) };
    }),
    monthly,
  };
}

export function elecDivisionStats(bids: Bid[], wonJobs: WonJob[], now: Date = new Date()): DivisionStats {
  const open = bids.filter(b => b.stage === 'due' || b.stage === 'submitted');
  const awarded = bids.filter(b => b.stage === 'awarded').length;
  const lost = bids.filter(b => b.stage === 'lost').length;
  const decided = awarded + lost;
  const { ytdSales, monthly } = wonSlices(wonJobs, 'Electrical', now);
  return {
    ytdSales,
    openCount: open.length,
    openValue: sum(open),
    wonCount: awarded,
    winRate: decided > 0 ? Math.round((awarded / decided) * 100) : null,
    stages: ELEC_STAGES.map(st => {
      const group = bids.filter(b => b.stage === st.key);
      return { key: st.key, label: st.label, count: group.length, value: sum(group) };
    }),
    monthly,
  };
}

/** Proposal telemetry funnel: every gen that went out and is not yet decided/declined. */
export function genFunnel(gens: Gen[]): { sent: number; viewed: number; signed: number } {
  const out = gens.filter(g => g.sent_at && g.stage !== 'awarded' && g.stage !== 'declined' && g.stage !== 'superseded');
  return {
    sent: out.length,
    viewed: out.filter(g => g.viewed_at).length,
    signed: out.filter(g => g.signed_at).length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/divisionStats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/divisionStats.ts frontend/src/lib/divisionStats.test.ts
git commit -m "feat: pure division stats module for hub overview tabs"
```

---

### Task 3: Hub pages + App routing + redirects wired

**Files:**
- Create: `frontend/src/features/hubs/HubTabs.tsx`
- Create: `frontend/src/features/hubs/GeneratorsHubPage.tsx`
- Create: `frontend/src/features/hubs/ElectricalHubPage.tsx`
- Create: `frontend/src/features/hubs/constants.ts`
- Modify: `frontend/src/App.tsx` (view parsing ~:54-62, renderView ~:197-298, imports)
- Test: `frontend/src/features/hubs/hubRouting.test.tsx`

**Interfaces:**
- Consumes: `resolveLegacyPath` (Task 1). Existing pages' prop contracts exactly as currently invoked in App.tsx:208-278 (copy prop wiring verbatim from the current `renderView` cases).
- Produces:
  - `frontend/src/features/hubs/constants.ts`:
    ```ts
    export const GEN_HUB_TABS = [
      { key: 'overview', label: 'Overview' },
      { key: 'leads',    label: 'Leads' },
      { key: 'pipeline', label: 'Pipeline' },
      { key: 'jobs',     label: 'Jobs' },
    ] as const;
    export const ELEC_HUB_TABS = [
      { key: 'overview', label: 'Overview' },
      { key: 'intake',   label: 'Intake' },
      { key: 'bids',     label: 'Bids' },
      { key: 'projects', label: 'Projects' },
    ] as const;
    export type GenHubTab  = typeof GEN_HUB_TABS[number]['key'];
    export type ElecHubTab = typeof ELEC_HUB_TABS[number]['key'];
    export function coerceGenTab(raw: string | null): GenHubTab {
      return (GEN_HUB_TABS.some(t => t.key === raw) ? raw : 'overview') as GenHubTab;
    }
    export function coerceElecTab(raw: string | null): ElecHubTab {
      return (ELEC_HUB_TABS.some(t => t.key === raw) ? raw : 'overview') as ElecHubTab;
    }
    ```
  - `HubTabs` — presentational tab bar, underline style copied from today's `frontend/src/features/pipeline/PipelinePage.tsx:34-63` (amber accent for generators, blue for electrical):
    ```ts
    interface HubTabsProps {
      tabs: readonly { key: string; label: string }[];
      active: string;
      accent: 'amber' | 'blue';
      onSelect: (key: string) => void;   // parent navigates
      counts?: Record<string, number>;    // optional badge per tab key
    }
    ```
  - `GeneratorsHubPage` / `ElectricalHubPage` props: `tab`, `recordId: string | null`, `onSelectTab(key)`, plus the pass-through props each body page needs (copy exactly from current App.tsx cases: leads → LeadsPage props, pipeline → GenPipelinePage props, jobs → GenProjectsPage props; intake → IntakeInboxPage props, bids → ElecPipelinePage props, projects → ElecProjectsPage props). Overview tab renders a placeholder `<div>Overview</div>` in THIS task — Task 5 fills it.
- URL contract (Task 4/6 depend on it): `/generators/{tab}/{recordId?}`, `/electrical/{tab}/{recordId?}`; `onNav('generators/pipeline', id)` works because `setView` concatenates path segments.

Key App.tsx edits:

1. Add imports; add legacy redirect before the shell renders:
```tsx
// inside App(), after `view` is derived (~line 56):
const legacyTarget = resolveLegacyPath(location.pathname);
// in the signed-in <Routes> return (~line 324), FIRST route:
//   {legacyTarget && <Route path="*" element={<Navigate to={legacyTarget} replace/>}/>}
// Simpler equivalent: early in `shell` render path — if (legacyTarget) return <Navigate to={legacyTarget} replace/> inside renderView? NO —
// implement as: in renderView(), first line:
//   if (legacyTarget) return <Navigate to={legacyTarget} replace/>;
```
2. Hub segment parsing: for `view === 'generators' || view === 'electrical'`, `hubTab = segments[1] ?? null`, `hubRecordId = segments[2] ? decodeURIComponent(segments[2]) : null`. `clearParam` for hub views must strip only the third segment: `navigate('/' + view + '/' + (segments[1] ?? 'overview'), { replace: true })` — adjust the existing `clearParam` callback to be hub-aware.
3. `renderView` cases `'generators'` and `'electrical'` render the hub pages with all pass-through props (move the prop wiring bodies from the old `pipeline`/`gen-leads`/`gen-projects`/`intake`/`elec-projects` cases into the hubs). Keep old cases DELETED — the legacy resolver handles those URLs before the switch.
4. `openNewBid` (App.tsx:164-168): `setView('elec-proposals')` → `setView('electrical/bids')`.
5. IntakeInboxPage `onBidAccepted` (App.tsx:234): `setView('elec-proposals')` → `setView('electrical/bids')`.
6. BuilderPage `onSaved` (App.tsx:243): `setView('gen-proposals')` → `setView('generators/pipeline')`.
7. `ElecPipelinePage` is currently only mounted via PipelinePage — mount it directly in ElectricalHubPage with the same props PipelinePage passes it today (read `frontend/src/features/pipeline/PipelinePage.tsx` for the exact prop list before writing).

- [ ] **Step 1: Write the failing routing test**

```tsx
// frontend/src/features/hubs/hubRouting.test.tsx
import { describe, it, expect } from 'vitest';
import { coerceGenTab, coerceElecTab, GEN_HUB_TABS, ELEC_HUB_TABS } from './constants';

describe('hub tab coercion', () => {
  it('accepts valid tabs', () => {
    for (const t of GEN_HUB_TABS) expect(coerceGenTab(t.key)).toBe(t.key);
    for (const t of ELEC_HUB_TABS) expect(coerceElecTab(t.key)).toBe(t.key);
  });
  it('falls back to overview on unknown/missing', () => {
    expect(coerceGenTab('nope')).toBe('overview');
    expect(coerceGenTab(null)).toBe('overview');
    expect(coerceElecTab('leads')).toBe('overview'); // gen-only tab is invalid here
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `cd frontend && npx vitest run src/features/hubs/hubRouting.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement `constants.ts` + `HubTabs.tsx`** (code above; HubTabs visual: flex row, per-tab button, active = `borderBottom: '2px solid var(--amber|--blue)'`, `fontWeight 800`, inactive `var(--text3)` — copy the exact style block from PipelinePage.tsx:34-63 before deleting it in Task 7).

- [ ] **Step 4: Implement `GeneratorsHubPage.tsx` and `ElectricalHubPage.tsx`** — column layout `height:100%; display:flex; flexDirection:'column'`; `<HubTabs>` on top; body `flex:1; overflow:hidden` rendering the active tab's page component with pass-through props. Overview renders `<div className="scroll view-enter" style={{padding:32}}>Overview — coming in Task 5</div>`.

- [ ] **Step 5: Wire App.tsx** (edits 1-7 above; delete switch cases `pipeline|elec-proposals|gen-proposals`, `gen-leads`, `gen-projects`, `elec-projects`, `intake`, `sales-dashboard`, `reporting` — the first group replaced by hub cases, the last two now legacy-redirect to `/dashboard`; keep `builder`, `bid`, `sales-by-rep`, `comms`, `docs`, `followups`, `calendar`, `contacts`, `admin`, `dashboard` cases).

- [ ] **Step 6: Verify** — `cd frontend && npx vitest run && npx tsc --noEmit` → all green (some existing tests exercise PipelinePage internals directly; those still pass because the component still exists until Task 7).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/hubs frontend/src/App.tsx
git commit -m "feat: division hub pages with tab routing and legacy redirects"
```

---

### Task 4: AppShell — 8-item sidebar, config-driven mobile nav, topbar rekey

**Files:**
- Modify: `frontend/src/features/layout/AppShell.tsx` (nav array :98-121, TB map :48-67, dynamic tb :126-132, mobile arrays :135-153, renderActions :155-169)

**Interfaces:**
- Consumes: view keys `dashboard`, `generators`, `electrical`, `contacts`, `calendar`, `followups`, `docs`, `admin`; `onNav('generators/pipeline')`-style composite paths.
- Produces: sidebar active-state matches on the FIRST path segment (`view === it.id` still works because App passes `segments[0]` as `view` — `generators` matches for any hub tab).

Exact new nav data:

```tsx
const nav: NavGroup[] = [
  { group: '', items: [
    { id: 'dashboard',  label: 'Home',       icon: 'dashboard' },
    { id: 'generators', label: 'Generators', icon: 'bolt', tone: 'amber', count: genProposalCount },
    { id: 'electrical', label: 'Electrical', icon: 'pipeline', count: elecProposalCount + newIncoming },
  ]},
  { group: 'Workspace', items: [
    { id: 'contacts',  label: 'Contacts',   icon: 'users' },
    { id: 'calendar',  label: 'Calendar',   icon: 'clock' },
    { id: 'followups', label: 'Follow-ups', icon: 'checkc', count: followupCount },
    { id: 'docs',      label: 'Documents',  icon: 'clip' },
  ]},
];
```

New TB entries (replace the killed keys; keep `dashboard`, `builder`, `comms`, `followups`, `docs`, `calendar`, `contacts`, `admin`, `sales-by-rep` rows):

```ts
generators: { title: 'Generators', sub: 'Leads · Proposals · Installs — Generator division' },
electrical: { title: 'Electrical', sub: 'Intake · Bids · Projects — Electrical division' },
dashboard:  { title: 'Home',       sub: null },   // briefSub() logic keys off title — update the condition at :130 to title === 'Home'
```

Mobile (both derive from one source now):

```tsx
const mobileBottomNav = [
  { id: 'dashboard',           label: 'Home',       icon: 'dashboard', count: 0 },
  { id: 'generators/pipeline', label: 'Generators', icon: 'bolt',      count: genProposalCount },
  { id: 'electrical/bids',     label: 'Electrical', icon: 'pipeline',  count: elecProposalCount },
];
// active check for composite ids: view === it.id.split('/')[0]
const mobileMoreNav = [
  { id: 'contacts',  label: 'Contacts',   icon: 'users',  count: 0 },
  { id: 'calendar',  label: 'Calendar',   icon: 'clock',  count: 0 },
  { id: 'followups', label: 'Follow-ups', icon: 'checkc', count: followupCount },
  { id: 'docs',      label: 'Documents',  icon: 'clip',   count: 0 },
  ...(canAdmin ? [{ id: 'admin', label: 'Settings', icon: 'gear', count: 0 }] : []),
];
```

`renderActions()` rekey: `sales-dashboard`/`gen-proposals` condition → `view === 'generators'`; `elec-proposals` condition → `view === 'electrical'`; `comms` row unchanged. Mobile bottom-bar active check changes from `view === it.id` to `view === it.id.split('/')[0]`.

- [ ] **Step 1: Apply all AppShell edits above.**
- [ ] **Step 2: Verify** — `cd frontend && npx vitest run && npx tsc --noEmit` → green; manually confirm no TB key references dead views.
- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/layout/AppShell.tsx
git commit -m "feat: 8-item sidebar with division hubs, config-driven mobile nav"
```

---

### Task 5: Overview tabs (Generators + Electrical)

**Files:**
- Create: `frontend/src/features/hubs/GenOverviewTab.tsx`
- Create: `frontend/src/features/hubs/ElecOverviewTab.tsx`
- Modify: `frontend/src/features/hubs/GeneratorsHubPage.tsx`, `frontend/src/features/hubs/ElectricalHubPage.tsx` (replace Task 3 placeholders; add `wonJobs` to hub props — App already holds it)
- Modify: `frontend/src/App.tsx` (pass `wonJobs` + `bids` into hubs as needed)

**Interfaces:**
- Consumes: `genDivisionStats`, `elecDivisionStats`, `genFunnel` (Task 2 — exact shapes there), `moneyShort` from `frontend/src/lib/money.ts`, stage colors from `frontend/src/features/gen-pipeline/constants.ts` (GEN_STAGES) and `frontend/src/features/pipeline/constants.ts` (ELEC_STAGES).
- Produces: `<GenOverviewTab gens wonJobs onSelectTab/>`, `<ElecOverviewTab bids wonJobs onSelectTab/>` — `onSelectTab` navigates to the sibling tab when a stage row/KPI is clicked (open pipeline → pipeline/bids tab; won → jobs/projects tab).

Layout per overview (match existing panel styling — `className="panel"` cards as used in DashboardPage):
1. KPI row (4 tiles): YTD Sales (`fmt ytdSales`), Open Pipeline (`openValue` + `openCount` sub), Jobs Won (`wonCount`), Win Rate (`winRate ?? '—'`%). Reuse the stat-tile markup pattern from `frontend/src/features/dashboard/DashboardPage.tsx` KPI section — copy markup, division-scope the numbers.
2. Stage breakdown: one row per `stats.stages` slice — dot in stage color, label, `count`, `moneyShort(value)`; row click → `onSelectTab('pipeline'|'bids')`.
3. Monthly bar chart: `stats.monthly` as simple flex bars (copy the bar markup pattern from DashboardPage's monthly chart, single series, division accent color).
4. Recent wins: last 5 of this division's `wonJobs` sorted by `date_won` desc — customer, value, date.
5. Extras: Gen → funnel strip `sent → viewed → signed` from `genFunnel(gens)`. Elec → "Due soon" list: bids `stage==='due'` sorted by due date ascending, top 5 (bid has `withDueDays` fields; use `due_date` if present).

- [ ] **Step 1: Implement both overview components** (data via Task 2 module — no fetching, props only).
- [ ] **Step 2: Replace hub placeholders; thread `wonJobs` through App → hubs.**
- [ ] **Step 3: Verify** — `cd frontend && npx vitest run && npx tsc --noEmit` → green.
- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/hubs frontend/src/App.tsx
git commit -m "feat: division overview tabs with stage-value rollups"
```

---

### Task 6: Home merge (Command Center absorbs sales KPIs) + emitter/caller rekey

**Files:**
- Create: `frontend/src/features/command-center/HomeKpis.tsx`
- Modify: `frontend/src/features/command-center/CommandCenterPage.tsx` (accept + render `<HomeKpis>` below the brief content; new props `bids`, `gens`, `wonJobs`, `repNames`)
- Modify: `frontend/src/App.tsx` (pass those props at the `dashboard` case; delete `sales-dashboard` case if still present)
- Modify: `frontend/src/components/SearchBox.tsx:53,59,68` (`elec-projects→electrical/projects`, `elec-proposals→electrical/bids`, `gen-projects→generators/jobs`, `gen-proposals→generators/pipeline`, `gen-leads→generators/leads`)
- Modify: `frontend/src/features/gen-pipeline/useGenPipeline.ts:32` (`gen-projects` → `generators/jobs`)
- Modify: `frontend/src/features/leads/LeadDetailDrawer.tsx:141,193,463` (`gen-proposals` → `generators/pipeline`)
- Modify: `frontend/src/features/command-center/CommandCenterPage.tsx:178-204` chips (`gen-proposals→generators/pipeline`, `pipeline→electrical/bids` for bids-due chip, `gen-leads→generators/leads`, `intake→electrical/intake`; `followups` unchanged)
- Modify: `backend/src/notifications/engine.ts:66,87,106,135` (`gen-proposals→generators/pipeline`, `elec-proposals→electrical/bids`, `gen-leads→generators/leads`; `followups` unchanged)
- Modify: `backend/src/services/brief.ts:319,335,336,352,368,398,425` (same mapping; `pipeline→electrical/bids` at :425 — it's the bids-due CTA)
- Modify: `backend/src/routes/gens.ts` (~:1240 area, `link_view: 'gen-proposals'` → `'generators/pipeline'`)

**Interfaces:**
- Consumes: DashboardPage internals — copy these blocks into `HomeKpis.tsx` before DashboardPage is deleted in Task 7: KPI computations (DashboardPage.tsx:60-107 — YTD/month/winRate/avgDeal/open-pipeline; keep the superseded-aware winRate lines exactly), monthly stacked chart (:89-99 + its JSX), leaderboard + commissions + goal bar (manager-gated via the file's existing `MANAGER_ROLES` constant — copy it too), panel links to `sales-by-rep` (keep key — it survives).
- Produces: `<HomeKpis bids gens wonJobs repNames onNav/>`, rendered by CommandCenterPage under the needs-action section.

- [ ] **Step 1: Build `HomeKpis.tsx`** by extracting the listed DashboardPage blocks (copy, then division-agnostic cleanup — it keeps company-wide totals and the stacked elec/gen chart).
- [ ] **Step 2: Render it in CommandCenterPage; thread props from App.**
- [ ] **Step 3: Rekey every emitter/caller listed above.** Grep-verify zero remaining live references: `grep -rn "gen-proposals\|elec-proposals\|gen-leads\|gen-projects\|elec-projects\|sales-dashboard" frontend/src backend/src --include="*.ts*" | grep -v legacyRoutes | grep -v test` → only comments/legacy-resolver hits allowed.
- [ ] **Step 4: Verify** — both `npx tsc --noEmit` runs + `cd frontend && npx vitest run` green.
- [ ] **Step 5: Commit**

```bash
git add -A frontend/src backend/src
git commit -m "feat: merge sales KPIs into Home, rekey all deep-link emitters to hub paths"
```

---

### Task 7: Deletions — PipelinePage wrapper, ReportingPage, DashboardPage

**Files:**
- Delete: `frontend/src/features/pipeline/PipelinePage.tsx`
- Delete: `frontend/src/features/reporting/ReportingPage.tsx` (and `frontend/src/features/reporting/` if then empty)
- Delete: `frontend/src/features/dashboard/DashboardPage.tsx` (keep `sales-dashboard.css` ONLY if HomeKpis imports it; otherwise delete it too)
- Modify: `frontend/src/App.tsx` (remove dead imports)

- [ ] **Step 1: Confirm nothing imports the three files** — `grep -rn "PipelinePage\|ReportingPage\|from './features/dashboard/DashboardPage'\|DashboardPage" frontend/src --include="*.ts*" | grep -v test` → only App.tsx imports remain, then remove them. If `frontend/src/features/pipeline/ElecPipelinePage.tsx` or tests import anything from PipelinePage, move that dependency first.
- [ ] **Step 2: Delete the files; fix any test that mounted PipelinePage** (check `frontend/src/features/pipeline/ElecPipelinePage.test.tsx` and `AddBidModal.test.tsx` — they test children, likely unaffected).
- [ ] **Step 3: Verify** — `cd frontend && npx vitest run && npx tsc --noEmit` green.
- [ ] **Step 4: Commit**

```bash
git add -A frontend/src
git commit -m "refactor: delete PipelinePage wrapper, ReportingPage, DashboardPage"
```

---

### Task 8: Auto follow-up sweep for quiet proposals (backend)

**Files:**
- Create: `backend/src/services/proposalQuietSweep.ts`
- Modify: `backend/src/index.ts` (~:155-157 — add `startProposalQuietSweep();` beside the other schedulers, plus import)
- Test: `backend/src/test/proposalQuietSweep.test.ts`

**Interfaces:**
- Consumes: `pool` (`../db/pool`), `logger` (`../utils/logger`), `getSetting` (`../routes/settings`), `createNotification` (`../notifications/engine`) — signature `createNotification(userId, { type, title, body, linkView, linkId, dedupKey })`.
- Produces: `sweepQuietProposals(now?: Date): Promise<{ created: number }>` (testable core) and `startProposalQuietSweep(): void` (immediate run + `setInterval` every 6h).

Settings keys (read via `getSetting`, numeric, with defaults): `gen_followup_quiet_days` = 5, `gen_followup_viewed_days` = 3.

Task title conventions (the dedup key — one per tier per proposal, EVER, regardless of open/done):
- Tier A (never viewed): `Proposal quiet {N}d — {customer}`
- Tier B (viewed, unsigned): `Proposal viewed but unsigned — {customer}`

Core SQL shape:

```ts
// tier A candidates
const { rows: quiet } = await pool.query(
  `SELECT g.* FROM generator_proposals g
    WHERE g.stage = 'sent' AND g.deleted_at IS NULL AND g.signed_at IS NULL
      AND g.viewed_at IS NULL AND g.sent_at < $1
      AND NOT EXISTS (
        SELECT 1 FROM tasks t
         WHERE t.linked_type = 'gen' AND t.linked_id = g.id
           AND t.title LIKE 'Proposal quiet%')`,
  [new Date(now.getTime() - quietDays * 86_400_000)]
);
// tier B candidates: same shape with viewed_at IS NOT NULL AND viewed_at < cutoffB
// and NOT EXISTS title LIKE 'Proposal viewed but unsigned%'
```

Per candidate: `INSERT INTO tasks (title, notes, due_date, linked_type, linked_id, linked_name, assigned_to) VALUES ($1,$2,$3,'gen',$4,$5,$6)` — `notes` = `Sent {sent_at::date}. {Viewed {viewed_at::date} | Never viewed}.`, `due_date` = today, `assigned_to` = `g.salesperson_id` (nullable-safe), `linked_name` = `g.customer`. Then `createNotification(g.salesperson_id, { type:'proposal_quiet', title, body: notes, linkView:'generators/pipeline', linkId: g.id, dedupKey: 'proposal-quiet-'+tier+'-'+g.id })` — skip notification when `salesperson_id` is null. Wrap the whole sweep in try/catch (log, never throw) mirroring `leadFollowups.ts`.

- [ ] **Step 1: Write the failing test** — use the existing harness pattern (`backend/src/test/harness.ts`; mirror how `gens.kickoff.test.ts` seeds a gen row). Cases: (a) sent 6 days ago, never viewed → 1 task, correct title/assignee; (b) re-run → 0 new (dedupe, even after task closed: `UPDATE tasks SET status='done'` then re-run → still 0); (c) sent 6d ago but viewed 1d ago → no tier-A, no tier-B (viewed cutoff not reached); (d) viewed 4 days ago, unsigned → tier-B task; (e) stage `awarded`/`superseded`/`declined` → never touched.
- [ ] **Step 2: Run to verify FAIL** — `cd backend && npx vitest run src/test/proposalQuietSweep.test.ts`.
- [ ] **Step 3: Implement module + boot wiring.**
- [ ] **Step 4: Run to verify PASS**, then full backend suite: `cd backend && npx vitest run` → green.
- [ ] **Step 5: Commit**

```bash
git add backend/src/services/proposalQuietSweep.ts backend/src/test/proposalQuietSweep.test.ts backend/src/index.ts
git commit -m "feat: auto follow-up sweep for quiet sent proposals"
```

---

### Task 9: Final verification + PR

- [ ] **Step 1: Full suites** — `cd frontend && npx vitest run && npx tsc --noEmit`; `cd backend && npx vitest run && npx tsc --noEmit`. All green.
- [ ] **Step 2: Manual route sweep** — `npm run dev` (frontend) and click every sidebar item, every hub tab, one legacy URL by hand (`/gen-leads`), one record deep link from global search into each hub. Mobile viewport (<768px): bottom bar shows Home/Generators/Electrical/More; More sheet lists the 4-5 shared items.
- [ ] **Step 3: Push + PR** — `git push -u origin feat/division-hub-nav`; `gh pr create` with a summary listing: 8-item sidebar, hubs, Home merge, deletions, redirects, quiet-proposal sweep. Standard PR footer.
- [ ] **Step 4: Final review is done by Fable 5 before merge (per spec Execution model) — do not merge in this task.**

---

## Self-Review (completed at plan time)

- **Spec coverage:** sidebar (T4), hubs (T3), overviews (T2+T5), Home merge (T6), deep-link migration (T1+T3+T6), mobile (T4), sweep (T8), deletions (T7), testing/PR (T9). Builder nav removal falls out of T4 (no builder nav item) with route kept in T3. Comms untouched — verified no task touches it.
- **Placeholder scan:** none — every step has code or an exact anchored edit.
- **Type consistency:** `DivisionStats`/`StageSlice` used identically in T2/T5; `coerceGenTab`/`coerceElecTab` in T3; `resolveLegacyPath` in T1/T3; `sweepQuietProposals` signature in T8 only.
