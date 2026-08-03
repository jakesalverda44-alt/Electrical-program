# Mobile Field Pack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the mobile field pack: lead site-survey wizard that pre-fills proposals, mobile lead cards, touch-fixed kanban/nav/tables foundation, readable customer e-sign page, builder form collapse, and PWA install.

**Architecture:** A pure survey→GenForm mapping module is the core (tested, deterministic, no AI); the wizard stores answers on `leads.survey_data` (new JSONB, migration 084) and `create-gen` merges them server-side. Everything else is CSS/layout surgery at audited file:line anchors plus a small install-prompt hook.

**Tech Stack:** React 18 + TS + vitest (frontend), Express + pg + vitest (backend), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-03-mobile-field-pack-design.md` — read first. Audit anchors cited below are from the 2026-08-02 mobile audit; line numbers may have drifted — match on content.

## Global Constraints

- Branch `feat/mobile-field-pack`. One PR. All existing tests stay green (frontend 116+, backend 256 passing / 2 pre-existing failures in `integration.test.ts` are NOT ours); `npx tsc --noEmit` clean both sides.
- Survey mapping is deterministic — NO AI calls anywhere in this plan.
- Survey field names mirror `GenForm` exactly where they overlap (`jobType`, `brand`, `coolingType`, `size`, `fuel`, `genSide`, `panelRel`, `panelFt`, `feedFt`, `genStand`, `pad`, `gasLine`, `removal`, `liftType`, `battery`, `emPanel`, `surgeProQty`, `smmQty`) plus survey-only `sizingNeeded: boolean`, `notes: string`.
- Gen Stand replaces pad: a survey choosing a stand must yield `pad: false` (mirror of the rule in `BuilderPage`/`gens.ts`).
- Desktop rendering and print output unchanged: mobile rules live under `@media (max-width: 768px)` (or `(hover: none) and (pointer: coarse)` for touch), embed-mode e-sign rules scoped under `.proposal-embed`.
- Touch targets ≥44px for new/modified mobile interactive elements.
- Commit at the end of every task with the given message + this repo's standard Co-Authored-By/Claude-Session trailer.

---

### Task 1: Survey types + pure survey→form mapper

**Files:**
- Create: `frontend/src/features/leads/surveyMap.ts`
- Test: `frontend/src/features/leads/surveyMap.test.ts`

**Interfaces:**
- Produces (Tasks 2 backend mirror + 3 wizard consume):

```ts
export interface LeadSurvey {
  jobType?: 'new-install' | 'swap-out';
  brand?: 'Kohler' | 'Generac';
  coolingType?: 'air-cooled' | 'liquid-cooled';
  size?: string;                 // e.g. '22KW'; unset when sizingNeeded
  sizingNeeded?: boolean;
  fuel?: 'Natural Gas' | 'LP';
  genSide?: '' | 'Left' | 'Right';
  panelRel?: '' | 'Same side as panel' | 'Opposite side of panel' | 'Next to panel';
  panelFt?: number;
  feedFt?: number;
  base?: 'pad' | 'stand-small' | 'stand-big' | 'existing-pad';
  gasLine?: boolean;             // swap-out only
  removal?: boolean;             // swap-out only
  liftType?: 'none' | 'lull' | 'crane';
  battery?: boolean;
  emPanel?: boolean;
  surgeProQty?: number;
  smmQty?: number;
  notes?: string;
}
/** Only answered questions produce keys — merge over blankGenForm/defaults downstream. */
export function surveyToGenFormFields(s: LeadSurvey): Record<string, unknown>
```

- Mapping rules (the whole point — implement exactly):
  - Pass-through when present: `jobType, brand, coolingType, fuel, genSide, panelRel, panelFt, feedFt, liftType, battery, emPanel, surgeProQty, smmQty, notes`.
  - `size`: only when `sizingNeeded` is not true and `size` set.
  - `base`: `'pad'` → `{ pad: true, genStand: 'none' }`; `'stand-small'` → `{ pad: false, genStand: 'small' }`; `'stand-big'` → `{ pad: false, genStand: 'big' }`; `'existing-pad'` → `{ pad: false, genStand: 'none' }`.
  - `gasLine`/`removal`: emitted only when `jobType === 'swap-out'`.
  - `panelFt`: dropped when `panelRel === 'Next to panel'`.
  - Empty survey (`{}`) → `{}`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/features/leads/surveyMap.test.ts
import { describe, it, expect } from 'vitest';
import { surveyToGenFormFields } from './surveyMap';

describe('surveyToGenFormFields', () => {
  it('empty survey produces no fields', () => {
    expect(surveyToGenFormFields({})).toEqual({});
  });
  it('passes through simple answers', () => {
    expect(surveyToGenFormFields({ jobType: 'new-install', brand: 'Generac', fuel: 'LP', feedFt: 40 }))
      .toEqual({ jobType: 'new-install', brand: 'Generac', fuel: 'LP', feedFt: 40 });
  });
  it('gen stand replaces pad', () => {
    expect(surveyToGenFormFields({ base: 'stand-big' })).toEqual({ pad: false, genStand: 'big' });
    expect(surveyToGenFormFields({ base: 'pad' })).toEqual({ pad: true, genStand: 'none' });
    expect(surveyToGenFormFields({ base: 'existing-pad' })).toEqual({ pad: false, genStand: 'none' });
  });
  it('sizingNeeded suppresses size', () => {
    expect(surveyToGenFormFields({ size: '22KW', sizingNeeded: true })).toEqual({});
    expect(surveyToGenFormFields({ size: '22KW' })).toEqual({ size: '22KW' });
  });
  it('gasLine/removal only apply to swap-outs', () => {
    expect(surveyToGenFormFields({ jobType: 'new-install', gasLine: true, removal: true }))
      .toEqual({ jobType: 'new-install' });
    expect(surveyToGenFormFields({ jobType: 'swap-out', gasLine: true, removal: true }))
      .toEqual({ jobType: 'swap-out', gasLine: true, removal: true });
  });
  it('panelFt dropped when next to panel', () => {
    expect(surveyToGenFormFields({ panelRel: 'Next to panel', panelFt: 12 }))
      .toEqual({ panelRel: 'Next to panel' });
    expect(surveyToGenFormFields({ panelRel: 'Opposite side of panel', panelFt: 12 }))
      .toEqual({ panelRel: 'Opposite side of panel', panelFt: 12 });
  });
});
```

- [ ] **Step 2:** `cd frontend && npx vitest run src/features/leads/surveyMap.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement per the mapping rules (straightforward conditionals; no cleverness).
- [ ] **Step 4:** Test → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat: lead site-survey types and pure survey-to-form mapper`

---

### Task 2: Migration 084 + backend survey plumbing

**Files:**
- Create: `database/migrations/084_lead_survey.sql`
- Modify: `backend/src/routes/leads.ts` (leadPatchSchema ~:45; PATCH handler ~:546 if columns are whitelisted; create-gen ~:687-707)
- Test: `backend/src/test/leadSurvey.test.ts`

**Interfaces:**
- Consumes: Task 1's mapping rules — mirrored server-side as a private `surveyToGenFormFields()` inside leads.ts (same rules verbatim; repo convention mirrors frontend calc in backend, see gens.ts pricing mirror).
- Produces: `PATCH /leads/:id` accepts `survey_data` (object, ≤20KB, nullable); `POST /leads/:id/create-gen` merges mapped survey fields into the inserted `form_data`.

Migration:

```sql
-- 084_lead_survey.sql
-- Site-survey answers captured on the lead by the mobile survey wizard; shape
-- mirrors GenForm field names so create-gen can merge them into form_data.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS survey_data JSONB;
```

create-gen merge (extend the existing formData literal at ~:694):

```ts
const surveyFields = surveyToGenFormFields((lead.survey_data ?? {}) as Record<string, unknown>);
const formData = {
  customer: lead.name, attn: lead.name, address: addr.address,
  city: addr.city, state: addr.state, zip: addr.zip,
  phone: lead.phone ?? '', email: lead.email ?? '',
  notes: [lead.notes, (lead.survey_data as { notes?: string } | null)?.notes].filter(Boolean).join('\n'),
  lead_source: lead.source,
  ...surveyFields,
};
```
(Watch the double-notes: surveyFields must NOT emit `notes` — strip it there and handle via the join above; adjust the mirror accordingly and note the difference from the frontend mapper in a comment.)

zod: `survey_data: z.record(z.unknown()).nullable().optional()` added to leadPatchSchema; confirm the PATCH handler's column list includes it (read how other JSONB-ish fields flow — mirror that).

- [ ] **Step 1: Failing test** — `backend/src/test/leadSurvey.test.ts` (mirror harness patterns from an existing leads/gens test): (a) PATCH lead with survey_data persists and returns it; (b) create-gen on a lead whose survey_data = `{ jobType:'swap-out', brand:'Generac', base:'stand-small', gasLine:true, notes:'gate code 1234' }` → inserted form_data contains `jobType:'swap-out'`, `brand:'Generac'`, `pad:false`, `genStand:'small'`, `gasLine:true`, and notes containing 'gate code 1234'; (c) create-gen with survey_data NULL behaves exactly as before (contact fields only).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement migration + schema + mirror + merge.
- [ ] **Step 4:** Test → PASS; full backend suite (only the 2 documented pre-existing failures); tsc clean.
- [ ] **Step 5: Commit** — `feat: lead survey_data column and create-gen survey merge`

---

### Task 3: Lead Site Survey wizard

**Files:**
- Create: `frontend/src/features/leads/LeadSiteSurvey.tsx`
- Modify: `frontend/src/features/leads/LeadDetailDrawer.tsx` (entry button + render; read the file first for its drawer structure, `doHandoff`/`createGen` at ~:125-196, and Lead type usage)
- Modify: `frontend/src/types/index.ts` (Lead interface: `survey_data?: Record<string, unknown> | null` — check where Lead type lives first; it may be local to features/leads)
- Test: `frontend/src/features/leads/LeadSiteSurvey.test.tsx`

**Interfaces:**
- Consumes: `LeadSurvey` + `surveyToGenFormFields` (Task 1) — wizard state IS a `LeadSurvey`; `PATCH /leads/:id { survey_data }` (Task 2); `RecordFiles` (`frontend/src/components/RecordFiles.tsx:48`: `{ linkedId, linkedName, div: 'gen'|'elec'|'lead', cameraFirst, title, emptyHint }`); existing `createGen()` flow in LeadDetailDrawer (`POST /leads/:id/create-gen` then `onEditGen(gen)`).
- Produces: `<LeadSiteSurvey lead={lead} onUpdated={(lead)=>void} onBuildProposal={()=>void} onClose={()=>void}/>` — full-screen mobile-friendly overlay (reuse `.drawer-overlay`/sheet styling), 9 steps per spec §2, progress dots, Back/Next/Skip, every step optional.

Behavior requirements:
- Autosave: debounce ~600ms after any answer change → `api.patch('/leads/'+lead.id, { survey_data })`; also save on step change and on close. Resume: initial state = `lead.survey_data ?? {}`.
- Branching: step 5 (gas line/removal) rendered only when `jobType === 'swap-out'`; size picker offers the real brand/cooling-specific sizes (import `getGenSizes` from `frontend/src/features/builder/genCalc.ts` — signature `getGenSizes({brand, coolingType, jobType})`) plus a "Needs sizing" toggle; panel-distance input hidden when `panelRel === 'Next to panel'`.
- Photos step: `<RecordFiles linkedId={lead.id} linkedName={lead.name} div="lead" cameraFirst title="Site Photos"/>`.
- Finish step: summary of answered fields + primary button **Build Proposal from Survey** → calls the drawer's existing createGen path (lift `createGen` so the survey can trigger it, or accept an `onBuildProposal` callback wired to it). Secondary: "Save & Close".
- Entry: prominent button in LeadDetailDrawer ("Start Site Survey" / "Resume Site Survey" when `survey_data` non-empty). Hide/disable when lead already has `linked_gen_id` (proposal exists — show "View proposal" hint instead).
- Touch: options are large tap buttons (min-height 44px), not dropdowns, for enum questions.

- [ ] **Step 1: Failing test** — `LeadSiteSurvey.test.tsx` with Testing Library: (a) renders step 1 with New Install / Swap-Out options; (b) answering jobType=swap-out and navigating shows the swap-out step; jobType=new-install skips it; (c) PATCH called with accumulated survey_data on step change (mock `api.patch`); (d) "Needs sizing" hides the size picker; (e) finish step's Build Proposal button fires the callback.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** New test + full frontend suite green; tsc clean.
- [ ] **Step 5: Commit** — `feat: lead site-survey wizard with autosave and proposal handoff`

---

### Task 4: Leads list mobile cards + drawer collapse

**Files:**
- Modify: `frontend/src/features/leads/LeadsPage.tsx` (7-col grid at ~:314 header and ~:332 rows, wrapper `overflow:'hidden'` ~:310, root padding ~:173)
- Modify: `frontend/src/features/leads/LeadDetailDrawer.tsx` (inline `1fr 1fr` grids ~:270, ~:289)
- Modify: `frontend/src/styles.css` (new `.lead-cards` mobile rules if class-based approach used)
- Test: `frontend/src/features/leads/LeadsPage.mobile.test.tsx`

Approach: extract the row rendering into two variants — desktop grid (unchanged markup) and mobile card — switched by a `useIsMobile()` hook (`window.matchMedia('(max-width: 768px)')`, listener-updated; place in `frontend/src/hooks/useIsMobile.ts`, export for reuse by Task 6). Card content: name (bold), source badge, stage chip (existing stage colors from `features/leads/constants.ts`), `tel:` link rendering the phone (stopPropagation so tapping phone doesn't open the drawer), days-in-stage. Whole card tap → open drawer. Root padding `20px 24px` → `12px 14px` under 768 (className-based so CSS can reach it).
Drawer: the two `1fr 1fr` inline grids become `repeat(auto-fit, minmax(140px, 1fr))` (works both widths, no hook needed).

- [ ] **Step 1: Failing test** — mock matchMedia to mobile: lead renders as card with tel: href and no 7-col grid header; desktop mode still renders grid header row.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** suite green + tsc clean.
- [ ] **Step 5: Commit** — `feat: mobile lead cards with tap-to-call, drawer grid collapse`

---

### Task 5: Foundation CSS + HubTabs + table wrappers

**Files:**
- Modify: `frontend/src/styles.css` (mobile block ~:515-630 + new rules)
- Modify: `frontend/src/features/hubs/HubTabs.tsx`
- Modify: every `.ctable` render site with a wrapper div: `frontend/src/features/contacts/ContactsPage.tsx:188`, `frontend/src/features/docs/DocsPage.tsx:292`, `frontend/src/features/elec-projects/ElecProjectsPage.tsx` (6 sites ~:484,539,624,681,747,1170), `frontend/src/features/sales-by-rep/SalesByRepPage.tsx` + `WonReports.tsx`, `frontend/src/features/settings/sections/UsersSection.tsx`, `frontend/src/features/preconstruction/PcWorkspace.tsx` (grep `className="ctable"` for the authoritative list)

Exact CSS changes (styles.css):

```css
/* touch devices: stage-advance always visible, comfortable target */
@media (hover: none) and (pointer: coarse) {
  .bcard-adv { opacity: 1; }
  .adv-btn { width: 40px; height: 40px; }
}
/* generic horizontal scroll wrapper for data tables */
.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.table-scroll .ctable { min-width: 560px; }
```

Inside the existing 768px block:
- `.app { padding-bottom: calc(64px + env(safe-area-inset-bottom)); }` (replaces flat 64px at ~:517)
- `.drawer-overlay { z-index: 240; }` and `.gp-detail-panel`'s sheet variant likewise above 200 (audit: nav z-index 200 at ~:651, overlay 160 at ~:299 — raise overlay/drawer stack above nav so open sheets cover it)
- `.split { grid-template-columns: 1fr !important; }` replaces the dead flex rule at ~:635 (`.split` is grid at ~:156) — move/keep at the 480px block per current placement
- Delete dead rule `.sd-col .amt { font-size: 9px }` (~:622; element is display:none from 980px)
- `.field-row { grid-template-columns: 1fr; }` added to the 480px block (~:632-638)

HubTabs.tsx: bar style gains `overflowX:'auto', whiteSpace:'nowrap'`; buttons gain `flexShrink:0, minHeight:44`.

- [ ] **Step 1:** Apply CSS + HubTabs edits.
- [ ] **Step 2:** Wrap every `.ctable` site: `<div className="table-scroll"><table className="ctable">...</table></div>` (purely mechanical; do not alter table internals).
- [ ] **Step 3:** `cd frontend && npx vitest run` green (PipelineBoard/ContactsPage tests must still pass) + tsc clean.
- [ ] **Step 4: Commit** — `fix: mobile foundation — touch advance, nav layering, safe area, table scroll, hub tabs`

---

### Task 6: Builder mobile collapse + customer e-sign embed CSS

**Files:**
- Modify: `frontend/src/features/builder/BuilderPage.tsx` (inner grids ~:52 `'1fr 1fr'`, ~:234 `'80px 1fr'`, ~:288 `'1fr 1fr'` — switch to `repeat(auto-fit, minmax(150px,1fr))` or className-based mobile collapse; inputs get 44px min-height on mobile via CSS class, not inline)
- Modify: `frontend/src/styles.css` (builder mobile input sizing; `.proposal-embed` rules)
- Modify: `frontend/src/features/builder/ProposalPreview.tsx` ONLY if required to attach classes for embed scoping (prefer pure-CSS via the existing `.proposal-embed` wrapper class at ~:245 — currently defined nowhere)

`.proposal-embed` rules (customer phone e-sign — the audit's worst customer-facing finding: 8-9px type in ~271px):

```css
/* Customer-facing proposal embed (public e-sign page). Desktop/print untouched. */
@media (max-width: 768px) {
  .proposal-embed > div { max-width: 100% !important; }
  .proposal-embed [style] { /* do NOT fight inline styles globally — scope below */ }
  .proposal-embed { font-size: 12px; }
}
```
NOTE for the implementer: inline styles in ProposalPreview (docStyle fontSize:10, pageStyle padding '0 36px 36px', body copy 8-9px) beat stylesheet rules — the practical fix is: in `ProposalPreview.tsx`, when `embed` is true, feed mobile-aware values into `docStyle`/`pageStyle` (e.g. `padding: embed ? '0 12px 24px' : '0 36px 36px'`, base font bump) and add relative font-sizes for the smallest text (8-9px → minimum 11px in embed mode). Print path (`!embed`) and PDF snapshot must remain pixel-identical — gate every change on the `embed` prop, and verify by rendering both modes in the existing test if one exists (check `frontend/src` for ProposalPreview tests; if none, add a smoke test asserting embed mode applies the mobile padding and non-embed keeps 36px).

- [ ] **Step 1:** Failing smoke test for embed-mode padding/type floor (render ProposalPreview embed vs not; assert style differences).
- [ ] **Step 2:** FAIL → **Step 3:** implement builder + embed changes → **Step 4:** full suite green + tsc clean. Existing genCalc tests unaffected.
- [ ] **Step 5: Commit** — `fix: mobile builder form collapse and readable customer e-sign embed`

---

### Task 7: PWA install

**Files:**
- Modify: `frontend/src/main.tsx` (boot SW registration)
- Create: `frontend/src/hooks/useInstallPrompt.ts`
- Modify: `frontend/src/features/layout/AppShell.tsx` (More sheet: Install App item; iOS hint card)
- Test: `frontend/src/hooks/useInstallPrompt.test.ts`

**Interfaces:**
- `useInstallPrompt(): { canInstall: boolean; promptInstall: () => Promise<void>; isIos: boolean; isStandalone: boolean; iosHintDismissed: boolean; dismissIosHint: () => void }`
  - `beforeinstallprompt` captured (preventDefault, stash event) → `canInstall`; `promptInstall()` calls `event.prompt()` and clears state after user choice.
  - `isIos`: reuse detection pattern from `frontend/src/push.ts:22`; `isStandalone`: `matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone`.
  - `iosHintDismissed` persisted at localStorage key `ios_a2hs_dismissed`.
- main.tsx boot registration (idempotent with push.ts's lazy registration — both use `navigator.serviceWorker.register('/sw.js')`, which is safe to call twice):

```ts
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
```
- AppShell: in `mobileMoreNav` area — when `canInstall`, an "Install App" sheet item calling `promptInstall()`; when `isIos && !isStandalone && !iosHintDismissed`, a small dismissible card at the top of the More sheet: "Install this app: Share → Add to Home Screen" with an × calling `dismissIosHint()`.

- [ ] **Step 1: Failing hook test** — simulate `beforeinstallprompt` event → `canInstall` true; `promptInstall` calls the stashed event's `prompt()`; standalone mode → `canInstall` false path; iOS dismissal persists to localStorage.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** suite green + tsc clean.
- [ ] **Step 5: Commit** — `feat: PWA install — boot SW registration, install prompt, iOS hint`

---

### Task 8: Final verification + PR

- [ ] **Step 1:** Full suites + tsc both sides (only the 2 documented pre-existing backend failures).
- [ ] **Step 2:** Mobile viewport manual pass (controller/human): 375px — leads cards, survey end-to-end (answers → create proposal → builder pre-filled), drawer covers nav, hub tabs scroll, builder single-column, public e-sign readable, install affordances present.
- [ ] **Step 3:** Push; `gh pr create` summarizing all six areas; standard footer. Final whole-branch review (Fable) before merge — do not merge in this task.

---

## Self-Review (done at plan time)

- Spec coverage: §1→T5, §2→T1+T2+T3, §3→T4, §4→T6, §5→T7, testing→per-task+T8. Photos-on-lead lives in T3 (RecordFiles div='lead' already supported — verified at RecordFiles.tsx:48-49). Lead→gen file carryover: files are linked by `linked_id` — they stay on the lead record; the gen links back via `lead_id`, and the survey wizard is the capture surface — carryover check deferred to T8 manual pass; if photos don't surface on the gen, file a follow-up rather than expanding T3.
- Placeholders: none — every step has code, exact rules, or a precise anchored instruction.
- Type consistency: `LeadSurvey`/`surveyToGenFormFields` (T1) consumed by T2 mirror + T3; `useIsMobile` (T4) available to T6; `useInstallPrompt` shape fixed in T7.
- Known judgment point recorded for implementers: backend mirror in T2 must NOT emit `notes` in surveyFields (merged separately) — the frontend mapper DOES pass notes through; the difference is deliberate and commented.
