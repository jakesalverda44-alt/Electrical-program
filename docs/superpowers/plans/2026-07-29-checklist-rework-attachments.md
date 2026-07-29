# Checklist Rework + Attachment Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kickoff-email attachments preview as PDFs in Outlook (extension fix); site-visit checklist gains multi-AC units, Sq/Ft, all-column loads + custom rows (tank fields removed); checklist exports become a clean vector paper-style PDF with Print Blank and Finalize modes (html2canvas screenshot export removed for the checklist).

**Architecture:** Backend: one pure helper in `bidAttachments.ts` fixes attachment filenames for every email. Frontend: `ChecklistData` v2 with in-`parseChecklist` migration (JSONB, no DB migration), reworked form UI, updated sizer autofill mapping, and a new `checklistPdf.ts` module that draws the paper form programmatically with jsPDF.

**Tech Stack:** Node/Express + pg (vitest tests in `backend/src/test/`), React + TS (verify via `npx tsc --noEmit` + `npm run build`), jsPDF (already a dependency, dynamic import).

**Spec:** `docs/superpowers/specs/2026-07-29-checklist-rework-attachments-design.md`

## Global Constraints

- Branch `feat/checklist-rework` off `main`. Push/PR only in the final task.
- Backend commands in `backend/`, frontend in `frontend/`. Backend DB tests skip gracefully without Postgres.
- `checklist_data` is JSONB — schema evolves in code only; old saved shapes MUST keep loading (real proposals exist with `acSize`/`lra`/`tankSize`/`tankType`).
- Checklist document category stays exactly `'site_checklist'`; uploaded filename must end `.pdf`.
- Do not touch SurveyMarkupEditor's html2canvas export.
- Paper-form colors for the PDF: header blue `#164a86`, ink `#1c2430`, muted `#6b7683`, rule `#dce3ec`.
- Commit messages: conventional style, each ending with:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SVuVEWkz3VSCWQoMxT8H2w
```

---

### Task 1: Backend — attachment filename extension fix

**Files:**
- Modify: `backend/src/email/bidAttachments.ts` (~line 91, the `name` computation in `loadLinkedDocumentsAsAttachments`)
- Test: `backend/src/test/attachmentFileName.test.ts` (new)

**Interfaces:**
- Produces: named export `attachmentFileName(displayName: string | null, originalName: string | null, fileType: string | null): string` from `backend/src/email/bidAttachments.ts`. Rules: base = trimmed `displayName` if non-empty else trimmed `originalName` else `'file'`; if base already ends in a 1-5 char alphanumeric extension (`/\.[A-Za-z0-9]{1,5}$/`), return it unchanged; else append the extension of `originalName` if it has one; else append by mime map `application/pdf`→`.pdf`, `image/png`→`.png`, `image/jpeg`→`.jpg`, `image/webp`→`.webp`, `image/heic`→`.heic`; else return base as-is.

- [ ] **Step 1: Write the failing test**

Create `backend/src/test/attachmentFileName.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { attachmentFileName } from '../email/bidAttachments';

describe('attachmentFileName', () => {
  it('appends the original filename extension when display name has none', () => {
    expect(attachmentFileName('Sizer Report', 'walter-sizer.pdf', 'application/pdf')).toBe('Sizer Report.pdf');
    expect(attachmentFileName('Signed Proposal', 'upload.PDF', null)).toBe('Signed Proposal.PDF');
  });
  it('keeps an existing extension untouched', () => {
    expect(attachmentFileName('Site Checklist.pdf', 'x.pdf', 'application/pdf')).toBe('Site Checklist.pdf');
  });
  it('falls back to the mime type when neither name has an extension', () => {
    expect(attachmentFileName('Labeled Survey', 'survey-final', 'application/pdf')).toBe('Labeled Survey.pdf');
    expect(attachmentFileName('Photo', 'img', 'image/jpeg')).toBe('Photo.jpg');
  });
  it('returns the base unchanged for unknown mimes and empty inputs', () => {
    expect(attachmentFileName('Mystery', 'blob', 'application/x-thing')).toBe('Mystery');
    expect(attachmentFileName(null, null, null)).toBe('file');
    expect(attachmentFileName('  ', 'doc.pdf', null)).toBe('doc.pdf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/test/attachmentFileName.test.ts`
Expected: FAIL — `attachmentFileName` not exported.

- [ ] **Step 3: Implement**

In `backend/src/email/bidAttachments.ts`, add above `loadLinkedDocumentsAsAttachments`:

```ts
const MIME_EXT: Record<string, string> = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg',
  'image/webp': '.webp', 'image/heic': '.heic',
};
const HAS_EXT = /\.[A-Za-z0-9]{1,5}$/;

/** Attachment filename with a real extension — Outlook won't preview an
 *  extensionless attachment, it forces a save instead. */
export function attachmentFileName(displayName: string | null, originalName: string | null, fileType: string | null): string {
  const display = (displayName || '').trim();
  const original = (originalName || '').trim();
  const base = display || original || 'file';
  if (HAS_EXT.test(base)) return base;
  const fromOriginal = original.match(HAS_EXT)?.[0];
  if (fromOriginal) return base + fromOriginal;
  const fromMime = fileType ? MIME_EXT[fileType.toLowerCase()] : undefined;
  return fromMime ? base + fromMime : base;
}
```

Then change the name computation in the loop (currently `const name = (doc.display_name || doc.name || 'file').trim();`) to:

```ts
    const name = attachmentFileName(doc.display_name, doc.name, doc.file_type);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/test/attachmentFileName.test.ts` → PASS.
Then `cd backend && npm test` → no new failures (known pre-existing GC-canonicalization flake may fail).

- [ ] **Step 5: Commit**

```bash
git add backend/src/email/bidAttachments.ts backend/src/test/attachmentFileName.test.ts
git commit -m "fix: give email attachments real file extensions so Outlook previews them"
```

---

### Task 2: Checklist data v2 + form rework + sizer mapping

**Files:**
- Modify: `frontend/src/features/gen-pipeline/SiteVisitChecklist.tsx`
- Modify: `frontend/src/features/gen-pipeline/sizerParse.ts`
- Modify: `frontend/src/features/gen-pipeline/GenDetailDrawer.tsx` (autofill merge only, ~lines 92-119)

**Interfaces:**
- Produces (consumed by Task 3): exported `AcUnit`, `CustomLoad`, new `ChecklistData` shape, `AC_TYPES`, unchanged `LOADS` (names only relevant), `BLANK`, `parseChecklist` stays internal but migration lives there.

```ts
export interface AcUnit { size: string; type: '' | 'Central' | 'Mini Split' | 'Heat Pump' | 'Other'; lra: string }
export interface CustomLoad extends LoadRow { name: string }
export const AC_TYPES = ['Central', 'Mini Split', 'Heat Pump', 'Other'] as const;
```

- [ ] **Step 1: Update types, BLANK, migration in `SiteVisitChecklist.tsx`**

Replace the `ChecklistData` interface and `BLANK` (keep `LoadRow` as-is):

```ts
export interface AcUnit { size: string; type: '' | 'Central' | 'Mini Split' | 'Heat Pump' | 'Other'; lra: string }
export interface CustomLoad extends LoadRow { name: string }
export const AC_TYPES = ['Central', 'Mini Split', 'Heat Pump', 'Other'] as const;

export interface ChecklistData {
  disc: '' | 'Yes' | 'No';
  em: '' | 'Yes' | 'No';
  powerCo: string;
  serviceAmps: string;
  atsQtyAmps: string;
  sqft: string;
  acUnits: AcUnit[];
  airHandler: '' | 'Electric' | 'Gas';
  gasType: '' | 'LP' | 'NG';
  loads: Record<number, LoadRow>;
  customLoads: CustomLoad[];
  feedLen: string;
  gasRunLength: string;
  locDesc: string;
  notes: string;
}

export const BLANK: ChecklistData = {
  disc: '', em: '', powerCo: '', serviceAmps: '', atsQtyAmps: '', sqft: '',
  acUnits: [], airHandler: '', gasType: '',
  loads: {}, customLoads: [], feedLen: '', gasRunLength: '', locDesc: '', notes: '',
};
```

Replace `parseChecklist` with a migrating version (legacy fields typed loosely):

```ts
function parseChecklist(raw: Gen['checklist_data']): ChecklistData {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      const p = parsed as Partial<ChecklistData> & { acSize?: string; lra?: string };
      const merged: ChecklistData = {
        ...BLANK, ...p,
        loads: { ...(p.loads || {}) },
        acUnits: Array.isArray(p.acUnits) ? p.acUnits : [],
        customLoads: Array.isArray(p.customLoads) ? p.customLoads : [],
      };
      // Legacy single AC fields → first AC unit. Old tankSize/tankType are dropped.
      if (!merged.acUnits.length && (p.acSize || p.lra)) {
        merged.acUnits = [{ size: p.acSize || '', type: '', lra: p.lra || '' }];
      }
      return merged;
    }
  } catch { /* fall through to blank */ }
  return { ...BLANK, loads: {}, acUnits: [], customLoads: [] };
}
```

Note: `{ ...BLANK, ...p }` may carry legacy `acSize`/`tankSize` keys along at runtime; that's harmless (unknown props, dropped on next explicit shape) — do NOT add delete gymnastics.

- [ ] **Step 2: Simplify `LOADS` and open all columns**

Replace the `LOADS` array with names only (order preserved — saved `loads` are keyed by index, so DO NOT reorder or remove entries; the two `Other` rows stay):

```ts
export const LOADS: { n: string }[] = [
  { n: 'Dryer' }, { n: 'Microwave' }, { n: 'Range Oven w/Top' }, { n: 'Cook Top' },
  { n: 'Oven' }, { n: 'Pool Heater' }, { n: 'Water Heater' },
  { n: 'Hot Tub (small)' }, { n: 'Hot Tub (large)' }, { n: 'Dishwasher' }, { n: 'Freezer' }, { n: 'Refrigerator' },
  { n: 'EV Charger' }, { n: 'Pool Pump' }, { n: 'Sump / Grinder Pump' },
  { n: 'Well Pump' }, { n: 'Garage Door Opener' }, { n: 'Water Softener' }, { n: 'Garbage Disposal' },
  { n: 'Shop / Shed / MIL Suite' }, { n: 'Boat House / Lift' },
  { n: 'Sprinkler Pump' }, { n: 'Other' }, { n: 'Other' },
];
```

In the loads `<tbody>`, every row now renders all four controls (no more `row.fuel ? … : '—'` conditionals):

```tsx
{LOADS.map((row, i) => {
  const lv = data.loads[i] || {};
  return (
    <tr key={i} style={{ borderBottom: `1px solid ${LINE}` }}>
      <td style={{ padding: '4px 6px', fontWeight: 600 }}>{row.n}</td>
      <td style={{ padding: '4px 6px' }}><ToggleGroup options={['Electric', 'Gas']} value={lv.fuel || ''} onChange={v => setLoad(i, { fuel: v as LoadRow['fuel'] })}/></td>
      <td style={{ padding: '4px 6px' }}><ToggleGroup options={['120V', '240V']} value={lv.volt || ''} onChange={v => setLoad(i, { volt: v as LoadRow['volt'] })}/></td>
      <td style={{ padding: '4px 6px' }}><input style={miniStyle} value={lv.hp || ''} onChange={e => setLoad(i, { hp: e.target.value })}/></td>
      <td style={{ padding: '4px 6px' }}><input style={miniStyle} value={lv.amps || ''} onChange={e => setLoad(i, { amps: e.target.value })}/></td>
    </tr>
  );
})}
{data.customLoads.map((row, i) => (
  <tr key={`c${i}`} style={{ borderBottom: `1px solid ${LINE}` }}>
    <td style={{ padding: '4px 6px' }}>
      <input style={{ ...inputStyle, width: 140 }} placeholder="Appliance" value={row.name}
        onChange={e => setCustom(i, { name: e.target.value })}/>
    </td>
    <td style={{ padding: '4px 6px' }}><ToggleGroup options={['Electric', 'Gas']} value={row.fuel || ''} onChange={v => setCustom(i, { fuel: v as LoadRow['fuel'] })}/></td>
    <td style={{ padding: '4px 6px' }}><ToggleGroup options={['120V', '240V']} value={row.volt || ''} onChange={v => setCustom(i, { volt: v as LoadRow['volt'] })}/></td>
    <td style={{ padding: '4px 6px' }}><input style={miniStyle} value={row.hp || ''} onChange={e => setCustom(i, { hp: e.target.value })}/></td>
    <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
      <input style={miniStyle} value={row.amps || ''} onChange={e => setCustom(i, { amps: e.target.value })}/>
      <button type="button" onClick={() => removeCustom(i)} style={{ marginLeft: 6, border: 'none', background: 'none', color: '#c0392b', cursor: 'pointer', fontWeight: 700 }}>✕</button>
    </td>
  </tr>
))}
```

Below the table (inside the same section div):

```tsx
<button type="button" className="btn ghost" style={{ marginTop: 4, fontSize: 12, height: 30, padding: '0 12px' }}
  onClick={() => setData(d => ({ ...d, customLoads: [...d.customLoads, { name: '' }] }))}>
  + Add appliance
</button>
```

And the helpers next to `setLoad`:

```ts
const setCustom = (i: number, patch: Partial<CustomLoad>) =>
  setData(d => ({ ...d, customLoads: d.customLoads.map((c, j) => j === i ? { ...c, ...patch } : c) }));
const removeCustom = (i: number) =>
  setData(d => ({ ...d, customLoads: d.customLoads.filter((_, j) => j !== i) }));
```

- [ ] **Step 3: Header/AC/gas sections**

Header grid: add Sq/Ft to the meta grid (after the Date cell):

```tsx
<div><b>Sq/Ft:</b> <input style={{ ...inputStyle, display: 'inline-block', width: 90, padding: '3px 8px' }} value={data.sqft} onChange={e => set('sqft', e.target.value)}/></div>
```

Replace the grid containing AC Unit Size / LRA / Air Handler AND the grid containing Gas Type / Tank Size / Tank Type with:

```tsx
<div style={{ marginBottom: 10 }}>
  <div style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>AC Units</div>
  {data.acUnits.map((u, i) => (
    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 1fr auto', gap: 8, marginBottom: 6, alignItems: 'center' }}>
      <input style={inputStyle} placeholder="Size (e.g. 3 Ton)" value={u.size} onChange={e => setAc(i, { size: e.target.value })}/>
      <ToggleGroup options={[...AC_TYPES]} value={u.type} onChange={v => setAc(i, { type: v as AcUnit['type'] })}/>
      <input style={inputStyle} placeholder="LRA" value={u.lra} onChange={e => setAc(i, { lra: e.target.value })}/>
      <button type="button" onClick={() => removeAc(i)} style={{ border: 'none', background: 'none', color: '#c0392b', cursor: 'pointer', fontWeight: 700 }}>✕</button>
    </div>
  ))}
  <button type="button" className="btn ghost" style={{ fontSize: 12, height: 30, padding: '0 12px' }}
    onClick={() => setData(d => ({ ...d, acUnits: [...d.acUnits, { size: '', type: '', lra: '' }] }))}>
    + Add AC unit
  </button>
</div>
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
  <Field label="Air Handler (Heat Strips)"><ToggleGroup options={['Electric', 'Gas']} value={data.airHandler} onChange={v => set('airHandler', v)}/></Field>
  <Field label="Gas Type"><ToggleGroup options={['LP', 'NG']} value={data.gasType} onChange={v => set('gasType', v)}/></Field>
</div>
```

With helpers:

```ts
const setAc = (i: number, patch: Partial<AcUnit>) =>
  setData(d => ({ ...d, acUnits: d.acUnits.map((u, j) => j === i ? { ...u, ...patch } : u) }));
const removeAc = (i: number) =>
  setData(d => ({ ...d, acUnits: d.acUnits.filter((_, j) => j !== i) }));
```

`ToggleGroup` accepts readonly options via spread `[...AC_TYPES]` — no signature change needed.

- [ ] **Step 4: Sizer mapping (`sizerParse.ts` + drawer merge)**

`SizerResult.fields` becomes:

```ts
export interface SizerResult {
  fields: Partial<Pick<ChecklistData, 'gasType' | 'airHandler' | 'sqft'>> & { acUnits?: AcUnit[] };
  loads: Record<number, LoadRow>;
  notesLine: string;
}
```

(Import `AcUnit` from `./SiteVisitChecklist`.) In `parseSizerLines`:
- Replace the `fields.lra` and `fields.acSize` assignments: keep extracting `lraVal` (same regex logic, into a local `let lraVal: string | undefined`) and the tonnage match; then

```ts
  if (ac) fields.acUnits = [{ size: `${ac[1]} Ton`, type: '', lra: lraVal || '' }];
```

- The sqft extraction already exists for the notes line (`const sqft = text.match(...)`); hoist it above the appliance loop and also set `fields.sqft = sqft[1].replace(/,/g, '')` when matched.
- In the notes-line builder, replace `if (fields.lra) parts.push(...)` with `if (lraVal) parts.push(\`LRA ${lraVal}\`)`.
- In the LOADS autofill loop, drop the `row.fuel`/`row.amps` gating (columns are now universal): for each matched appliance set `loads[i] = { fuel: 'Electric', amps: String(Math.round(amps)) }`.

In `GenDetailDrawer.tsx` `autofillFromSizer`, the merge currently spreads `...fields` over current. Keep that, but preserve hand-entered AC units:

```ts
const merged: ChecklistData = {
  ...current,
  ...fields,
  acUnits: current.acUnits.length ? current.acUnits : (fields.acUnits || []),
  loads: { ...current.loads, ...loads },
  notes,
};
```

(The count in the toast `Object.keys(fields).length` still works.)

- [ ] **Step 5: Verify compile**

Run: `cd frontend && npx tsc --noEmit` → clean. (The finalize/export path still uses html2canvas at this point — Task 3 replaces it; it must still compile.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/gen-pipeline/SiteVisitChecklist.tsx frontend/src/features/gen-pipeline/sizerParse.ts frontend/src/features/gen-pipeline/GenDetailDrawer.tsx
git commit -m "feat: checklist v2 — multi-AC units, sqft, all-column loads, custom rows; tank fields removed"
```

---

### Task 3: Vector PDF module + Print Blank / Finalize wiring

**Files:**
- Create: `frontend/src/features/gen-pipeline/checklistPdf.ts`
- Modify: `frontend/src/features/gen-pipeline/SiteVisitChecklist.tsx` (`finalize`, buttons)

**Interfaces:**
- Consumes: `ChecklistData`, `LOADS`, `AcUnit`, `CustomLoad` from `SiteVisitChecklist`; `Gen` type.
- Produces: `buildChecklistPdf(header: ChecklistHeader, data: ChecklistData, mode: 'blank' | 'filled'): Promise<import('jspdf').jsPDF>` where `ChecklistHeader = { customer: string; genLabel: string; proposalNo: string; address: string; date: string }`.

- [ ] **Step 1: Create `checklistPdf.ts`**

```ts
import { ChecklistData, LOADS } from './SiteVisitChecklist';

export interface ChecklistHeader {
  customer: string; genLabel: string; proposalNo: string; address: string; date: string;
}

const BLUE: [number, number, number] = [22, 74, 134];
const INK: [number, number, number] = [28, 36, 48];
const MUTED: [number, number, number] = [107, 118, 131];
const RULE: [number, number, number] = [190, 200, 212];

const PAGE_W = 612, PAGE_H = 792, MARGIN = 42;
const BOTTOM = PAGE_H - 48;

/** Draws the paper-style Site Visit Checklist. mode 'blank' = header identity
 *  filled, body left as write-in lines for the truck; 'filled' = all entered
 *  values typed in. Pure vector/text — small file, selectable, nothing clipped. */
export async function buildChecklistPdf(header: ChecklistHeader, data: ChecklistData, mode: 'blank' | 'filled') {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const filled = mode === 'filled';
  let y = 52;

  const ensureRoom = (need: number) => {
    if (y + need > BOTTOM) { doc.addPage(); y = 52; }
  };

  const sectionTitle = (t: string) => {
    ensureRoom(26);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...BLUE);
    doc.text(t, MARGIN, y);
    y += 14;
  };

  // Label + value on a write-in rule. Returns nothing; advances no shared state
  // (caller advances y per row).
  const field = (label: string, value: string, x: number, w: number, baseline: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(`${label}:`, x, baseline);
    const lx = x + doc.getTextWidth(`${label}:`) + 4;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.75);
    doc.line(lx, baseline + 2, x + w, baseline + 2);
    if (filled || value) {
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK);
      const fit = doc.splitTextToSize(value, x + w - lx);
      doc.text(fit[0] || '', lx + 2, baseline);          // first line on the rule…
      for (let i = 1; i < fit.length; i++) {              // …overflow wraps below
        doc.text(fit[i], x + 8, baseline + 11 * i);
      }
      return 11 * Math.max(0, fit.length - 1);
    }
    return 0;
  };

  // A Yes/No- or Electric/Gas-style choice: filled mode prints the chosen word,
  // blank mode prints all options separated by " / " for circling by hand.
  const choice = (label: string, options: string[], value: string, x: number, baseline: number) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(`${label}:`, x, baseline);
    const lx = x + doc.getTextWidth(`${label}:`) + 5;
    doc.setFontSize(9.5);
    if (filled && value) {
      doc.text(value, lx, baseline);
      const w = doc.getTextWidth(value);
      doc.setDrawColor(...BLUE); doc.setLineWidth(1);
      doc.ellipse(lx + w / 2, baseline - 3, w / 2 + 7, 8);   // hand-circled look
    } else {
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED);
      doc.text(options.join('  /  '), lx, baseline);
    }
    doc.setTextColor(...INK);
  };

  // ── Header ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...BLUE);
  doc.text('ACCURATE POWER & TECHNOLOGY, INC.', PAGE_W / 2, y, { align: 'center' });
  y += 15;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
  doc.text('15519 U.S. Hwy 441, Suite A101, Eustis, FL 32726 · 352-735-8285', PAGE_W / 2, y, { align: 'center' });
  y += 14;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...INK);
  doc.text('Site Visit Checklist', PAGE_W / 2, y, { align: 'center' });
  y += 22;

  field('Name', header.customer, MARGIN, 280, y);
  field('Gen Size / Brand', header.genLabel, MARGIN + 296, 234, y);
  y += 20;
  field('Date', header.date, MARGIN, 160, y);
  field('Proposal No.', header.proposalNo, MARGIN + 176, 190, y);
  field('Sq/Ft', filled ? data.sqft : data.sqft || '', MARGIN + 382, 148, y);
  y += 20;
  y += field('Address', header.address, MARGIN, PAGE_W - 2 * MARGIN, y);
  y += 24;

  // ── Service & System ──
  sectionTitle('Service & System');
  choice('Disconnect', ['Yes', 'No'], data.disc, MARGIN, y);
  choice('Em Panel', ['Yes', 'No'], data.em, MARGIN + 190, y);
  y += 20;
  field('Power Company', data.powerCo, MARGIN, 190, y);
  field('Service AMPS', data.serviceAmps, MARGIN + 206, 150, y);
  field('ATS Qty / AMPS', data.atsQtyAmps, MARGIN + 372, 158, y);
  y += 22;

  // AC units: existing entries in filled mode; three write-in unit lines in blank mode.
  const acRows = filled
    ? (data.acUnits.length ? data.acUnits : [{ size: '', type: '' as const, lra: '' }])
    : [0, 1, 2].map(() => ({ size: '', type: '' as const, lra: '' }));
  acRows.forEach((u, i) => {
    ensureRoom(20);
    field(`AC Unit ${i + 1} Size`, u.size, MARGIN, 170, y);
    field('Type', filled ? u.type : '', MARGIN + 186, 170, y);
    field('LRA', u.lra, MARGIN + 372, 158, y);
    y += 20;
  });
  ensureRoom(22);
  choice('Air Handler (Heat Strips)', ['Electric', 'Gas'], data.airHandler, MARGIN, y);
  choice('Gas Type', ['LP', 'NG'], data.gasType, MARGIN + 280, y);
  y += 26;

  // ── Loads table ──
  sectionTitle('Loads / Appliances');
  const COLS = [
    { h: 'Appliance', x: MARGIN, w: 150 },
    { h: 'Fuel', x: MARGIN + 154, w: 100 },
    { h: 'Volts', x: MARGIN + 258, w: 100 },
    { h: 'HP', x: MARGIN + 362, w: 70 },
    { h: 'AMPS', x: MARGIN + 436, w: 92 },
  ];
  const tableHead = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
    COLS.forEach(c => doc.text(c.h.toUpperCase(), c.x, y));
    y += 4;
    doc.setDrawColor(...RULE); doc.setLineWidth(1);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 13;
  };
  tableHead();
  const loadRow = (name: string, lv: { fuel?: string; volt?: string; hp?: string; amps?: string }) => {
    if (y + 16 > BOTTOM) { doc.addPage(); y = 52; tableHead(); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(name, COLS[0].w)[0] || '', COLS[0].x, y);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED); doc.setFontSize(8.5);
    if (filled) {
      doc.setTextColor(...INK); doc.setFontSize(9);
      if (lv.fuel) doc.text(lv.fuel, COLS[1].x, y);
      if (lv.volt) doc.text(lv.volt, COLS[2].x, y);
      if (lv.hp) doc.text(lv.hp, COLS[3].x, y);
      if (lv.amps) doc.text(lv.amps, COLS[4].x, y);
    } else {
      doc.text('Electric / Gas', COLS[1].x, y);
      doc.text('120V / 240V', COLS[2].x, y);
    }
    y += 3;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.5);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 13;
  };
  LOADS.forEach((row, i) => loadRow(row.n, data.loads[i] || {}));
  if (filled) {
    data.customLoads.filter(c => c.name.trim()).forEach(c => loadRow(c.name, c));
  } else {
    loadRow('', {}); loadRow('', {});
  }
  y += 10;

  // ── Footer fields ──
  ensureRoom(70);
  field('Gen Feed Length / Type', data.feedLen, MARGIN, 250, y);
  field('Gas Run Length', data.gasRunLength, MARGIN + 266, 262, y);
  y += 22;

  const bigField = (label: string, value: string, blankLines: number) => {
    ensureRoom(16 + blankLines * 16);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(`${label}:`, MARGIN, y);
    y += 14;
    if (filled && value.trim()) {
      doc.setFont('helvetica', 'normal');
      const wrapped = doc.splitTextToSize(value, PAGE_W - 2 * MARGIN - 8);
      wrapped.forEach((ln: string) => { ensureRoom(13); doc.text(ln, MARGIN + 4, y); y += 13; });
      y += 4;
    } else {
      doc.setDrawColor(...RULE); doc.setLineWidth(0.75);
      for (let i = 0; i < blankLines; i++) { ensureRoom(16); doc.line(MARGIN, y, PAGE_W - MARGIN, y); y += 16; }
    }
  };
  bigField('Gen Location Description', data.locDesc, 2);
  bigField('Notes', data.notes, 3);

  ensureRoom(24);
  y += 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK);
  doc.text('Rough Sketches On Back', PAGE_W / 2, y, { align: 'center' });

  return doc;
}
```

- [ ] **Step 2: Wire into `SiteVisitChecklist.tsx`**

Add import: `import { buildChecklistPdf } from './checklistPdf';`

Add a header builder inside the component (uses existing `form`/`address`):

```ts
const pdfHeader = () => ({
  customer: gen.customer || '',
  genLabel: [gen.mfr, gen.model, gen.kw ? `${gen.kw}kW` : ''].filter(Boolean).join(' '),
  proposalNo: gen.proposal_no || '',
  address,
  date: new Date().toLocaleDateString(),
});
```

Replace the whole `finalize` function body's PDF section — html2canvas/jsPDF imports and canvas code go away:

```ts
const finalize = async () => {
  setExporting(true);
  try {
    await save(true);
    const pdf = await buildChecklistPdf(pdfHeader(), data, 'filled');
    // Replace any prior finalized checklist so re-finalizing doesn't stack copies.
    try {
      const { data: docs } = await api.get('/documents', { params: { linked_id: gen.id } });
      const prior = (docs as { id: string; category: string }[]).filter(d => d.category === 'site_checklist');
      for (const d of prior) await api.delete(`/documents/${d.id}`);
    } catch { /* non-fatal — worst case a duplicate remains */ }
    const fd = new FormData();
    fd.append('file', pdf.output('blob'), `Site Visit Checklist - ${gen.customer}.pdf`);
    fd.append('linked_id', gen.id);
    fd.append('linked_name', gen.customer);
    fd.append('div', 'gen');
    fd.append('category', 'site_checklist');
    fd.append('display_name', `Site Visit Checklist — ${gen.customer}.pdf`);
    await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    showToast({ title: 'Checklist finalized', sub: 'Clean PDF attached to this job' });
  } catch {
    showToast({ title: 'Export failed', sub: 'Try again' });
  } finally {
    setExporting(false);
  }
};

const printBlank = async () => {
  try {
    const pdf = await buildChecklistPdf(pdfHeader(), { ...BLANK, sqft: data.sqft }, 'blank');
    window.open(URL.createObjectURL(pdf.output('blob')), '_blank', 'noopener');
  } catch {
    showToast({ title: 'Could not build blank form', sub: 'Try again' });
  }
};
```

Buttons row becomes three:

```tsx
<div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
  <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }} disabled={saving} onClick={() => save()}>
    {saving ? 'Saving…' : 'Save'}
  </button>
  <button className="btn ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={printBlank}>
    Print Blank
  </button>
  <button className="btn amber" style={{ flex: 1, justifyContent: 'center' }} disabled={exporting} onClick={finalize}>
    {exporting ? 'Exporting…' : 'Finalize / Export PDF'}
  </button>
</div>
```

`printRef` and its wrapping div can stay (screen layout unchanged) but the ref is now unused — remove `printRef`/`useRef` and change the wrapper to a plain `<div style={…}>`. Note: DocSlot delete route is admin-gated (`requireAdmin`); the prior-checklist delete loop's failures are swallowed by its try/catch — acceptable (duplicate instead of hard error) and noted in the spec follow-ups.

- [ ] **Step 3: Verify compile + build**

Run: `cd frontend && npx tsc --noEmit && npm run build` → clean; confirm `html2canvas` no longer appears in `SiteVisitChecklist.tsx` (`grep html2canvas frontend/src/features/gen-pipeline/SiteVisitChecklist.tsx` → empty).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/gen-pipeline/checklistPdf.ts frontend/src/features/gen-pipeline/SiteVisitChecklist.tsx
git commit -m "feat: paper-style vector checklist PDF — Print Blank + filled Finalize, screenshot export removed"
```

---

### Task 4: Full verification + smoke + PR

- [ ] **Step 1: Suites**

```bash
cd backend && npm test
cd ../frontend && npx tsc --noEmit && npm run build
```
Expected: green (GC-canonicalization flake excepted).

- [ ] **Step 2: Manual smoke (stack via `./crm.sh up`, login admin@local.test)**

1. Open an awarded gen → Checklist tab: AC Units section with add/remove; Sq/Ft present; no tank fields; every loads row has Fuel/Volts/HP/AMPS; "+ Add appliance" works.
2. A gen with OLD saved checklist data still loads (legacy acSize/lra appear as AC Unit 1).
3. Print Blank → opens a clean paper-style PDF, header pre-filled, blank rules.
4. Fill some fields incl. a long Gen Location Description → Finalize → doc uploads; download it: text-selectable, small (tens of KB), long text wrapped not truncated.
5. Upload a sizer → checklist auto-fill produces an AC unit entry + amps.
6. Kickoff modal → Draft (or re-draft) with docs present → in Outlook draft, attachments named `….pdf` and preview inline. (Local without Graph: instead verify via the attachment-name unit tests — CI covers it.)

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/checklist-rework
gh pr create --title "Checklist v2 + attachment preview fix: multi-AC, full loads grid, vector PDF export" --body "$(cat <<'EOF'
- Email attachments (sizer, signed proposal, checklist, surveys) now carry real .pdf/.png extensions so Outlook previews them inline instead of forcing a save.
- Site Visit Checklist v2: multiple AC units (size/type/LRA, add/remove), Sq/Ft field, tank fields removed (LP/NG stays), every appliance row takes Fuel/Volts/HP/AMPS, custom appliance rows. Old saved checklists migrate automatically.
- Checklist export rebuilt as a programmatic vector PDF replicating the paper form — Print Blank (hand-fill on site) + Finalize (typed values, wrapping, ~tens of KB). html2canvas screenshot export removed for the checklist; re-finalize replaces the prior doc.
- Sizer autofill now feeds the AC-units list and Sq/Ft.

Spec: docs/superpowers/specs/2026-07-29-checklist-rework-attachments-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01SVuVEWkz3VSCWQoMxT8H2w
EOF
)"
```

---

## Self-review notes

- Spec coverage: A → Task 1; B → Task 2 (types, migration, UI, sizer mapping, drawer merge); C → Task 3 (module, blank/filled, wiring, replace-on-finalize, html2canvas removal). All decisions traced.
- Type consistency: `AcUnit`/`CustomLoad`/`AC_TYPES` defined once in SiteVisitChecklist, imported by sizerParse (`AcUnit`) and checklistPdf (`ChecklistData`, `LOADS`). `buildChecklistPdf` async (dynamic jspdf import) — both call sites await it.
- Migration keyed on `acUnits` absence; `loads` index keying unchanged so existing saved loads line up with the same LOADS order.
- Known accepted risks (in spec/testing): prior-checklist delete is admin-gated (non-admin re-finalize may duplicate); blank-mode Sq/Ft carries current value by design (header identity).
