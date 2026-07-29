# Award Kickoff Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a gen proposal is moved to `awarded`, open an Award Kickoff modal that prompts for the signed proposal, shows kickoff-doc readiness, and drafts the kickoff email only on explicit request (signed proposal required); remove the current auto-draft on the stage transition.

**Architecture:** Backend: `PATCH /gens/:id/stage` stops fire-and-forget drafting; `POST /gens/:id/kickoff-email` gains a signed-proposal (`contract` doc) gate, a "To follow" line for missing docs, and stamps `generator_proposals.kickoff_email_drafted_at`. Frontend: `useStagePipeline` gains an `onMoved` callback so `GenPipelinePage` can open the drawer + a new `AwardKickoffModal` on award; the drawer's Overview tab gets a Kickoff section replacing the bare "Draft Kickoff Email" button.

**Tech Stack:** Node/Express + pg (backend, vitest + supertest tests in `backend/src/test/`), React + TS (frontend, no test runner — verify with `npx tsc --noEmit` and `npm run build`), SQL migrations in `database/migrations/` (auto-applied by `runMigrations`).

**Spec:** `docs/superpowers/specs/2026-07-29-award-kickoff-modal-design.md`

## Global Constraints

- Work on branch `feat/award-kickoff-modal` off `main`. Do not push or open a PR until the final task.
- Repo root: `~/projects/Electrical-program`. Backend commands run in `backend/`, frontend in `frontend/`.
- Backend tests skip gracefully without Postgres (`dbAvailable()` in `backend/src/test/harness.ts`). If `./crm.sh up` has been run, the Docker Postgres is available and tests run for real. Run `cd backend && npm test` either way; pure unit tests always run.
- Document category for the signed proposal is exactly `'contract'` (already in the DB constraint; auto-created by the e-sign flow at `backend/src/routes/gens.ts` `POST /p/:token/proposal-pdf`).
- `AWARD_DOC_CATEGORIES = ['contract', 'sizer_report', 'survey', 'labeled_survey', 'site_checklist']` — do not change the list.
- Never auto-send email; `graphCreateDraft` only (existing behavior).
- Frontend styling: reuse existing classes `.overlay`, `.modal`, `.modal-hdr`, `.modal-body`, `.modal-foot`, `.btn`, `.btn ghost`, `.close-x`, `.dtl-stage-label`, `.dtl-section` (see `frontend/src/styles.css:273-280`). Any fixed-height child added inside `.drawer-body` needs `flexShrink: 0` (flex-column squish gotcha).
- Commit messages: conventional style (`feat: …`, `test: …`), matching repo history.

---

### Task 1: Backend — migration, kickoff gate, "To follow" line, stamp, remove auto-draft

**Files:**
- Create: `database/migrations/081_kickoff_email_drafted.sql`
- Modify: `backend/src/routes/gens.ts` (lines ~308-313 auto-draft; ~755-843 kickoff helpers/route)
- Test: `backend/src/test/gens.kickoff.test.ts` (new)

**Interfaces:**
- Consumes: existing `loadOwnedGen`, `draftAwardKickoffEmail`, `AWARD_DOC_CATEGORIES`, `AWARD_DOC_LABELS`, `pool`, `escapeHtml`, test harness (`dbAvailable`, `makeUser`, `auth`).
- Produces: named export `missingKickoffLabels(existingCategories: string[]): string[]` from `backend/src/routes/gens.ts`; `POST /api/gens/:id/kickoff-email` response now includes `kickoff_email_drafted_at: string` (ISO timestamp) and `toFollow: string[]` on success, and returns `400 { error: 'Signed proposal required — upload it (or have the customer e-sign) before drafting the kickoff email.' }` when no `contract` doc exists. New nullable column `generator_proposals.kickoff_email_drafted_at TIMESTAMPTZ` (returned by every `SELECT *` on the table, so the Gen JSON the frontend receives carries it automatically).

- [ ] **Step 1: Write the migration**

Create `database/migrations/081_kickoff_email_drafted.sql`:

```sql
-- Stamp when the internal kickoff email draft was (last) created, so the drawer
-- can show kickoff status and the modal can offer "Re-draft" instead of "Draft".
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS kickoff_email_drafted_at TIMESTAMPTZ;
```

- [ ] **Step 2: Write the failing tests**

Create `backend/src/test/gens.kickoff.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../index';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import { missingKickoffLabels } from '../routes/gens';

describe('missingKickoffLabels', () => {
  it('lists labels for absent categories, excluding contract', () => {
    expect(missingKickoffLabels([])).toEqual(['Sizer Report', 'Survey', 'Labeled Survey', 'Site Visit Checklist']);
    expect(missingKickoffLabels(['contract', 'sizer_report', 'survey'])).toEqual(['Labeled Survey', 'Site Visit Checklist']);
    expect(missingKickoffLabels(['contract', 'sizer_report', 'survey', 'labeled_survey', 'site_checklist'])).toEqual([]);
  });
});

describe('kickoff email gating', () => {
  let ok = false;
  beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

  // POST /api/gens returns the created gen row directly (res.json(gen)).
  async function createGen(token: string) {
    const res = await request(app).post('/api/gens').set(auth(token))
      .send({ customer: `Kickoff Test ${Date.now()}`, mfr: 'Kohler', model: '20RCA', kw: 20, amount: 15000 })
      .expect(200);
    return res.body as { id: string };
  }

  async function addContractDoc(genId: string) {
    await pool.query(
      `INSERT INTO documents (linked_id, div, name, display_name, category, uploaded_by)
       VALUES ($1, 'gen', 'signed-proposal.pdf', 'Signed Proposal', 'contract', 'test')`,
      [genId],
    );
  }

  it('400s without a contract doc, before any email-config check', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    const res = await request(app).post(`/api/gens/${gen.id}/kickoff-email`).set(auth(u.token)).expect(400);
    expect(res.body.error).toMatch(/Signed proposal required/);
  });

  it('passes the contract gate once a contract doc exists (503 = unconfigured mail, not 400)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    await addContractDoc(gen.id);
    // Test env has no Microsoft Graph config, so the draft step itself fails
    // with 503 — proving the request got past the 400 contract gate.
    const res = await request(app).post(`/api/gens/${gen.id}/kickoff-email`).set(auth(u.token)).expect(503);
    expect(res.body.error).toMatch(/Email is not configured/);
    // Stamp must only be written on successful drafts.
    const { rows } = await pool.query('SELECT kickoff_email_drafted_at FROM generator_proposals WHERE id=$1', [gen.id]);
    expect(rows[0].kickoff_email_drafted_at).toBeNull();
  });

  it('award transition no longer auto-drafts (stamp stays null)', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const gen = await createGen(u.token);
    await request(app).patch(`/api/gens/${gen.id}/stage`).set(auth(u.token)).send({ stage: 'awarded' }).expect(200);
    const { rows } = await pool.query('SELECT kickoff_email_drafted_at, stage FROM generator_proposals WHERE id=$1', [gen.id]);
    expect(rows[0].stage).toBe('awarded');
    expect(rows[0].kickoff_email_drafted_at).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/test/gens.kickoff.test.ts`
Expected: FAIL — `missingKickoffLabels` is not exported (import error). (DB-backed tests skip if Postgres is down; start it with `./crm.sh up` from repo root to run them for real.)

- [ ] **Step 4: Implement backend changes in `backend/src/routes/gens.ts`**

4a. **Remove the auto-draft** in `PATCH /:id/stage` (currently lines ~308-313). Delete:

```ts
      // Fire-and-forget: draft the internal kickoff email to the ops team.
      draftAwardKickoffEmail(rows[0]).catch(err => {
        logger.error({ err, genId: gen.id }, '[email] award kickoff draft failed');
      });
```

and replace with a comment so the intent isn't lost:

```ts
      // Kickoff email is drafted explicitly from the Award Kickoff modal
      // (POST /:id/kickoff-email) — not automatically on the transition.
```

If `logger` is now unused in this file, remove its import; otherwise leave it.

4b. **Add the pure helper** directly below `AWARD_DOC_LABELS` (~line 762):

```ts
/** Kickoff-kit categories with no uploaded document yet, as display labels.
 *  'contract' is excluded — drafting is blocked without it, so it can never
 *  be "to follow". */
export function missingKickoffLabels(existingCategories: string[]): string[] {
  return AWARD_DOC_CATEGORIES
    .filter(c => c !== 'contract' && !existingCategories.includes(c))
    .map(c => AWARD_DOC_LABELS[c]);
}
```

4c. **Add the "To follow" line** inside `draftAwardKickoffEmail` (~line 809). After the `loadLinkedDocumentsAsAttachments` call and before `graphCreateDraft`, query which categories exist and append the line; also extend the result type:

```ts
interface KickoffResult { drafted: boolean; reason?: 'email_not_configured' | 'no_recipients'; to: string[]; attachedLabels: string[]; skipped: string[]; toFollow: string[]; }
```

(Update the two early-return objects in `draftAwardKickoffEmail` to include `toFollow: []`.) Then, after the existing `skipped`/Drive-link lines are appended to `html`:

```ts
  const { rows: existing } = await pool.query(
    `SELECT DISTINCT category FROM documents
      WHERE linked_id = $1 AND deleted_at IS NULL AND category = ANY($2)`,
    [gen.id, AWARD_DOC_CATEGORIES],
  );
  const toFollow = missingKickoffLabels(existing.map(r => r.category));
  if (toFollow.length) html += `<p>To follow: ${escapeHtml(toFollow.join(', '))}.</p>`;
```

and include `toFollow` in the success return: `return { drafted: true, to, attachedLabels, skipped, toFollow };`

4d. **Gate + stamp in the route** (~line 831). Replace the whole `router.post('/:id/kickoff-email', ...)` handler body with:

```ts
router.post('/:id/kickoff-email', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const gen = await loadOwnedGen(req, res);
  if (!gen) return;

  // Signed proposal is the minimum kickoff kit — block drafting without it.
  const { rows: contract } = await pool.query(
    `SELECT 1 FROM documents
      WHERE linked_id = $1 AND category = 'contract' AND deleted_at IS NULL LIMIT 1`,
    [gen.id],
  );
  if (!contract.length) {
    return res.status(400).json({ error: 'Signed proposal required — upload it (or have the customer e-sign) before drafting the kickoff email.' });
  }

  const result = await draftAwardKickoffEmail(gen);
  if (!result.drafted) {
    return res.status(503).json({
      error: result.reason === 'email_not_configured'
        ? 'Email is not configured (Microsoft Graph).'
        : 'No award-email recipients set — add them in Settings → Email Delivery.',
    });
  }
  const { rows: stamped } = await pool.query(
    `UPDATE generator_proposals SET kickoff_email_drafted_at = now(), updated_at = now()
      WHERE id = $1 RETURNING kickoff_email_drafted_at`,
    [gen.id],
  );
  res.json({ ...result, kickoff_email_drafted_at: stamped[0].kickoff_email_drafted_at });
}));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/test/gens.kickoff.test.ts`
Expected: PASS (unit test always; the 3 DB tests PASS with Postgres up, SKIP without).
Then run the full suite: `cd backend && npm test` — no new failures.

- [ ] **Step 6: Commit**

```bash
git add database/migrations/081_kickoff_email_drafted.sql backend/src/routes/gens.ts backend/src/test/gens.kickoff.test.ts
git commit -m "feat: gate kickoff email on signed proposal, stamp drafts, drop auto-draft on award"
```

---

### Task 2: Frontend plumbing — Gen type, onMoved hook, onAwarded

**Files:**
- Modify: `frontend/src/types/index.ts` (Gen interface, ~line 76-100)
- Modify: `frontend/src/hooks/useStagePipeline.ts`
- Modify: `frontend/src/features/gen-pipeline/useGenPipeline.ts`

**Interfaces:**
- Consumes: existing `useStagePipeline` config object.
- Produces: `Gen.kickoff_email_drafted_at?: string | null`; `useStagePipeline` config option `onMoved?: (item: T, stage: K, prevStage: string) => void` (fires only after a successful server PATCH, with the server-synced item); `useGenPipeline` prop `onAwarded?: (gen: Gen) => void` (fires only on a genuine `→ awarded` transition). Task 4 consumes `onAwarded`.

- [ ] **Step 1: Add the Gen field**

In `frontend/src/types/index.ts`, inside `interface Gen` next to `checklist_data`/`survey_markup` (~line 98-99), add:

```ts
  kickoff_email_drafted_at?: string | null;
```

- [ ] **Step 2: Add `onMoved` to `useStagePipeline`**

In `frontend/src/hooks/useStagePipeline.ts`:

Add to `UseStagePipelineConfig` (after `wonToast`):

```ts
  /** Called after a successful server-confirmed move, with the synced item. */
  onMoved?: (item: T, stage: K, prevStage: string) => void;
```

Destructure `onMoved` from `cfg` alongside the others. In `moveToStage`, inside the `try` block after the `data.wonJob` handling (i.e. just before the `catch`), add:

```ts
      if (prev) onMoved?.({ ...(data[responseKey] as T), stage }, stage, prev.stage);
```

Add `onMoved` to the `useCallback` dependency array.

- [ ] **Step 3: Add `onAwarded` to `useGenPipeline`**

In `frontend/src/features/gen-pipeline/useGenPipeline.ts`:

Add to `UseGenPipelineProps`:

```ts
  onAwarded?: (gen: Gen) => void;
```

Destructure it in the hook signature and pass into the `useStagePipeline` config (after `wonToast`):

```ts
    onMoved: (gen, stage, prevStage) => {
      if (stage === 'awarded' && prevStage !== 'awarded') onAwarded?.(gen);
    },
```

- [ ] **Step 4: Verify compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (same as before the change — this repo compiles clean on main).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/hooks/useStagePipeline.ts frontend/src/features/gen-pipeline/useGenPipeline.ts
git commit -m "feat: surface award transitions to the gen pipeline via onMoved/onAwarded"
```

---

### Task 3: AwardKickoffModal component + DocSlot onChanged

**Files:**
- Create: `frontend/src/features/gen-pipeline/AwardKickoffModal.tsx`
- Modify: `frontend/src/features/gen-pipeline/DocSlot.tsx`

**Interfaces:**
- Consumes: `DocSlot` (`{ genId, category, label, accept?, onUploaded? }`), `api` client, `useShowToast`, `Gen` type, `Icon` component.
- Produces:
  - `DocSlot` gains optional prop `onChanged?: () => void`, called after any successful upload or remove (in addition to the existing `onUploaded`).
  - Default export `AwardKickoffModal` with props `{ gen: Gen; onClose: () => void; onOpenTab: (tab: 'checklist' | 'survey') => void; onUpdated: (gen: Gen) => void; onSizerUploaded?: (file: File) => void }`.
  - Named export `useKickoffDocs(genId: string): { docs: { category: string }[]; refresh: () => void; loading: boolean }` — Task 4's Overview chips reuse it.
  - Named export `KICKOFF_ROWS: { category: string; label: string }[]` (the five categories with display labels).

- [ ] **Step 1: Add `onChanged` to DocSlot**

In `frontend/src/features/gen-pipeline/DocSlot.tsx`, extend the props type:

```ts
{ genId: string; category: string; label: string; accept?: string; onUploaded?: (file: File) => void; onChanged?: () => void }
```

Call `onChanged?.()` in `upload` right after `load(); onUploaded?.(file);`, and in `remove` after `setDoc(null)`.

- [ ] **Step 2: Create the modal**

Create `frontend/src/features/gen-pipeline/AwardKickoffModal.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import api from '../../api/client';
import { Gen } from '../../types';
import { useShowToast } from '../../contexts/AppContext';
import DocSlot from './DocSlot';

export const KICKOFF_ROWS = [
  { category: 'contract',       label: 'Signed Proposal' },
  { category: 'sizer_report',   label: 'Sizer Report' },
  { category: 'survey',         label: 'Survey' },
  { category: 'labeled_survey', label: 'Labeled Survey' },
  { category: 'site_checklist', label: 'Site Visit Checklist' },
];

interface DocRow { id: string; category: string }

/** Shared fetch of a gen's kickoff-kit documents (also used by the drawer's
 *  Overview chips). One row per category matters; extra fields ignored. */
export function useKickoffDocs(genId: string) {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    api.get('/documents', { params: { linked_id: genId } })
      .then(({ data }) => setDocs(data as DocRow[]))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [genId]);
  useEffect(refresh, [refresh]);
  return { docs, refresh, loading };
}

/** 'done' = finalized doc uploaded; 'progress' = tab has saved-but-unfinalized
 *  work (checklist_data / survey_markup JSONB); 'missing' = nothing yet. */
export function kickoffStatus(gen: Gen, docs: DocRow[], category: string): 'done' | 'progress' | 'missing' {
  if (docs.some(d => d.category === category)) return 'done';
  if (category === 'site_checklist' && gen.checklist_data) return 'progress';
  if ((category === 'survey' || category === 'labeled_survey') && gen.survey_markup) return 'progress';
  return 'missing';
}

const DOT: Record<'done' | 'progress' | 'missing', { bg: string; label: string }> = {
  done:     { bg: 'var(--green)',   label: 'Ready' },
  progress: { bg: 'var(--amber)',   label: 'In progress' },
  missing:  { bg: 'var(--border2)', label: 'Missing' },
};

interface Props {
  gen: Gen;
  onClose: () => void;
  onOpenTab: (tab: 'checklist' | 'survey') => void;
  onUpdated: (gen: Gen) => void;
  /** Forwarded to the sizer DocSlot so the existing checklist auto-fill keeps working. */
  onSizerUploaded?: (file: File) => void;
}

export default function AwardKickoffModal({ gen, onClose, onOpenTab, onUpdated, onSizerUploaded }: Props) {
  const showToast = useShowToast();
  const { docs, refresh, loading } = useKickoffDocs(gen.id);
  const [drafting, setDrafting] = useState(false);

  const hasContract = docs.some(d => d.category === 'contract');
  const redraft = !!gen.kickoff_email_drafted_at;

  const draftKickoff = async () => {
    setDrafting(true);
    try {
      const { data } = await api.post(`/gens/${gen.id}/kickoff-email`);
      const n = data.attachedLabels?.length || 0;
      const follow = data.toFollow?.length ? ` — to follow: ${data.toFollow.join(', ')}` : '';
      showToast({ title: 'Kickoff draft created in Outlook', sub: `${n} doc${n === 1 ? '' : 's'} attached${follow}` });
      onUpdated({ ...gen, kickoff_email_drafted_at: data.kickoff_email_drafted_at });
      onClose();
    } catch (e: any) {
      showToast({ title: 'Could not create draft', sub: e?.response?.data?.error || 'Try again' });
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 520 }}>
        <div className="modal-hdr">
          <h3>🎉 Job Awarded — Kickoff</h3>
          <button className="close-x" onClick={onClose}><Icon name="x" size={16} stroke={2}/></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '62vh', overflowY: 'auto' }}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            Get the kickoff kit together for <b>{gen.customer}</b>, then draft the team email. The signed proposal is required; everything else can follow.
          </div>

          {/* Signed proposal — auto-filled when the customer e-signed online. */}
          <DocSlot genId={gen.id} category="contract" label="Signed Proposal" accept="application/pdf,image/*" onChanged={refresh}/>
          {hasContract && gen.signed_at && (
            <div style={{ fontSize: 11.5, color: 'var(--green)', marginTop: -8 }}>Signed online by the customer — already attached.</div>
          )}

          <DocSlot genId={gen.id} category="sizer_report" label="Sizer Report" onUploaded={onSizerUploaded} onChanged={refresh}/>

          {/* Checklist + survey live in their drawer tabs — show status, link there. */}
          {KICKOFF_ROWS.filter(r => ['survey', 'labeled_survey', 'site_checklist'].includes(r.category)).map(r => {
            const st = kickoffStatus(gen, docs, r.category);
            return (
              <div key={r.category} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', border: '1px solid var(--border2)', borderRadius: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: DOT[st].bg, flexShrink: 0 }}/>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{r.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{loading ? '…' : DOT[st].label}</div>
                  </div>
                </div>
                <button className="btn ghost" style={{ fontSize: 11, height: 28, padding: '0 10px' }}
                  onClick={() => onOpenTab(r.category === 'site_checklist' ? 'checklist' : 'survey')}>
                  Open {r.category === 'site_checklist' ? 'Checklist' : 'Survey'} tab
                </button>
              </div>
            );
          })}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Later</button>
          <button className="btn" disabled={drafting || loading || !hasContract}
            title={!hasContract ? 'Upload the signed proposal first' : undefined}
            onClick={draftKickoff}>
            <Icon name="mail" size={14} stroke={1.9}/>
            {drafting ? 'Drafting…' : redraft ? 'Re-draft kickoff email' : 'Draft kickoff email'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean. (The modal isn't rendered anywhere yet — that's Task 4.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/gen-pipeline/AwardKickoffModal.tsx frontend/src/features/gen-pipeline/DocSlot.tsx
git commit -m "feat: Award Kickoff modal with doc readiness and gated draft button"
```

---

### Task 4: Wire modal into drawer + pipeline page, Overview Kickoff section

**Files:**
- Modify: `frontend/src/features/gen-pipeline/GenDetailDrawer.tsx`
- Modify: `frontend/src/features/gen-pipeline/GenPipelinePage.tsx`

**Interfaces:**
- Consumes: `AwardKickoffModal`, `useKickoffDocs`, `kickoffStatus`, `KICKOFF_ROWS` (Task 3); `onAwarded` (Task 2); existing `autofillFromSizer` in the drawer.
- Produces: `GenDetailDrawer` props gain `autoKickoff?: boolean; onAutoKickoffHandled?: () => void`. `GenPipelinePage` opens the drawer + modal on any award (drawer stage button, board drag, card advance arrow).

- [ ] **Step 1: Drawer — state, modal render, Overview section**

In `frontend/src/features/gen-pipeline/GenDetailDrawer.tsx`:

1a. Imports:

```ts
import AwardKickoffModal, { useKickoffDocs, kickoffStatus, KICKOFF_ROWS } from './AwardKickoffModal';
```

1b. Props interface — add:

```ts
  /** True when the page just awarded this gen — opens the kickoff modal once. */
  autoKickoff?: boolean;
  onAutoKickoffHandled?: () => void;
```

and destructure both in the component signature.

1c. State + effect (next to the other `useState` calls):

```ts
  const [showKickoff, setShowKickoff] = useState(!!autoKickoff);
  useEffect(() => {
    if (autoKickoff) { setShowKickoff(true); onAutoKickoffHandled?.(); }
  }, [autoKickoff, onAutoKickoffHandled]);
  const kickoffDocs = useKickoffDocs(gen.id);
```

(`useEffect` needs adding to the React import: `import React, { useState, useEffect } from 'react';`.)

1d. **Delete** the old always-visible "Draft Kickoff Email" button block (lines ~356-365, the `<button ... onClick={draftKickoff}>` and its comment) **and** the now-unused `draftKickoff` function and `drafting` state (lines ~46, ~121-135).

1e. In its place (same spot in the Overview JSX), add the awarded-only Kickoff section:

```tsx
          {gen.stage === 'awarded' && (
            <div className="dtl-section" style={{ marginTop: 16 }}>
              <div className="dtl-stage-label" style={{ marginBottom: 8 }}>Kickoff</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {KICKOFF_ROWS.map(r => {
                  const st = kickoffStatus(gen, kickoffDocs.docs, r.category);
                  return (
                    <span key={r.category} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border2)', color: st === 'done' ? 'var(--text)' : 'var(--text3)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: st === 'done' ? 'var(--green)' : st === 'progress' ? 'var(--amber)' : 'var(--border2)' }}/>
                      {r.label}
                    </span>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
                {gen.kickoff_email_drafted_at
                  ? `Kickoff email drafted ${fmtTs(gen.kickoff_email_drafted_at)}`
                  : 'Kickoff email not drafted yet'}
              </div>
              <button className="btn ghost" style={{ width: '100%', justifyContent: 'center', color: 'var(--blue)', borderColor: 'rgba(59,130,246,.4)' }}
                onClick={() => setShowKickoff(true)}>
                <Icon name="mail" size={14} stroke={1.9}/>Open Kickoff
              </button>
            </div>
          )}
```

1f. Render the modal next to `BuildFromNotesModal` at the bottom:

```tsx
      {showKickoff && (
        <AwardKickoffModal
          gen={gen}
          onClose={() => { setShowKickoff(false); kickoffDocs.refresh(); }}
          onOpenTab={t => { setShowKickoff(false); setTab(t); }}
          onUpdated={g => onUpdated(g)}
          onSizerUploaded={autofillFromSizer}
        />
      )}
```

- [ ] **Step 2: Page — open drawer + modal on award**

In `frontend/src/features/gen-pipeline/GenPipelinePage.tsx`:

2a. State (next to `detail`):

```ts
  const [autoKickoff, setAutoKickoff] = useState(false);
```

2b. Pass `onAwarded` into `useGenPipeline`:

```ts
  const { moveToStage, advance, pendingDeclined, cancelDeclined } = useGenPipeline({
    gens, setGens, setWonJobs, showToast, onNav,
    onAwarded: gen => { setDetail(gen); setAutoKickoff(true); },
  });
```

2c. Drawer props — add:

```tsx
          autoKickoff={autoKickoff}
          onAutoKickoffHandled={() => setAutoKickoff(false)}
```

and reset on close: `onClose={() => { setDetail(null); setAutoKickoff(false); }}`.

- [ ] **Step 3: Verify compile + build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: clean compile, successful build.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/gen-pipeline/GenDetailDrawer.tsx frontend/src/features/gen-pipeline/GenPipelinePage.tsx
git commit -m "feat: open Award Kickoff modal on award; Overview kickoff status section"
```

---

### Task 5: Full verification + smoke test + PR

**Files:** none new.

- [ ] **Step 1: Full test + build pass**

```bash
cd backend && npm test
cd ../frontend && npx tsc --noEmit && npm run build
```
Expected: all green.

- [ ] **Step 2: Manual smoke (requires Docker running)**

```bash
cd ~/projects/Electrical-program && ./crm.sh up
```

Then in the browser at `localhost:3000` (login `admin@local.test`, password from `backend/.env` `SEED_ADMIN_PASSWORD`):
1. Gen pipeline → drag (or advance-arrow) a non-awarded proposal to Awarded → drawer opens with the Kickoff modal; "Draft kickoff email" is disabled with the tooltip.
2. Upload a PDF into the Signed Proposal slot → button enables. Click it → expect the toast (in local dev without Graph config the toast shows the 503 "Email is not configured" error — that is correct behavior locally; the gate and stamp path are covered by the backend tests).
3. "Later" → Overview shows the Kickoff section with 5 status chips; "Open Kickoff" reopens the modal.
4. "Open Checklist tab" / "Open Survey tab" buttons switch tabs.
5. Award → re-open drawer: no auto-draft happened (no stamp shown until an explicit draft succeeds).

Report any smoke failures rather than patching blind.

- [ ] **Step 3: Push branch + PR**

```bash
git push -u origin feat/award-kickoff-modal
gh pr create --title "Award Kickoff modal: signed-proposal gate, doc readiness, no auto-draft" --body "$(cat <<'EOF'
Moving a gen to Awarded now opens an Award Kickoff modal instead of silently auto-drafting the team email.

- Modal: kickoff-doc readiness (signed proposal / sizer / survey / labeled survey / site checklist), inline signed-proposal + sizer upload slots, links to the Checklist/Survey tabs, explicit Draft button.
- Backend: POST /gens/:id/kickoff-email now 400s without a `contract` doc, appends a "To follow: …" line for missing docs, and stamps `kickoff_email_drafted_at` (migration 081). Auto-draft on the stage transition removed.
- Drawer Overview: awarded jobs get a Kickoff section (status chips + drafted-at + reopen button), replacing the bare Draft Kickoff Email button.

Spec: docs/superpowers/specs/2026-07-29-award-kickoff-modal-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

- Spec coverage: modal contents (Task 3), re-entry section (Task 4), backend gate/stamp/to-follow/auto-draft removal (Task 1), board-drag-with-closed-drawer (Task 4 `onAwarded` sets `detail`), re-award reopen (transition check in `onMoved` fires again; stamp preserved → "Re-draft" label), e-sign idempotency untouched.
- The old drawer `draftKickoff` + `drafting` state are removed in Task 4 after the modal takes over — Task 3 compiles standalone because the modal is unreferenced until then.
- `kickoffStatus` treats a raw `survey` upload and `labeled_survey` markup as separate rows but both use `survey_markup` for the "in progress" state; a raw survey uploaded via the Survey tab creates a `survey` doc → 'done' for that row, and the labeled row stays 'progress'/'missing' until finalized. Matches spec.
