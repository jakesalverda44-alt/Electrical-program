# Site-Visit Checklist Rework + Email Attachment Fix — Design

**Date:** 2026-07-29
**Status:** Approved

## Problems (user-reported, verified)

1. **Kickoff-email attachments won't preview in Outlook** — they force a save instead. Root cause: `loadLinkedDocumentsAsAttachments` (backend/src/email/bidAttachments.ts) names each Graph attachment with the document's `display_name` ("Sizer Report", "Signed Proposal", "Site Visit Checklist — X"), which has **no file extension**. Outlook decides previewability from the extension. Affects every attached doc including the sizer.
2. **Finalized checklist PDF is a screenshot** — html2canvas rasterizes the on-screen form: verified against a CRM-produced PDF (5.4MB, 4 pages, right columns cut off, typed values truncated at input-box width — data loss, UI toggle widgets baked in).
3. **Checklist form incomplete vs the real paper form** (verified against the scanned handwritten sheet): single AC Size/LRA fields but real sites have multiple AC units ("4 Ton / Mini Split", LRA "117 / N/A"); no Sq/Ft; loads table only enables certain columns per row, so "half the stuff is blank"; no way to add custom appliance rows.

## Decisions (user-confirmed)

- Sizer complaint = the same attachment-preview bug; the sizer file itself is fine.
- AC units: repeating rows of **Size + Type (Central / Mini Split / Heat Pump / Other) + LRA**, "Add AC unit" / per-row remove. Air handler stays one whole-house field.
- Loads table: **all four columns (Fuel, Volts, HP, AMPS) on every row**, plus "Add appliance" custom-named rows (removable).
- **Print Blank + Finalize filled**, both from one paper-style vector PDF layout. Blank = header pre-filled (customer/gen/proposal/address), body empty, for hand-filling on site.
- Header: **add Sq/Ft**; **remove Tank Size/Qty and Tank Type (AG/UG)** — gas section is just the LP/NG toggle.

## A. Attachment filename fix (backend)

In `loadLinkedDocumentsAsAttachments`, the attachment `name` must end in a real extension:

- Prefer `display_name`; if it has no extension, append the extension of the stored original `name` (e.g. `report.pdf` → `.pdf`).
- If neither has one, derive from `file_type` mime (`application/pdf`→`.pdf`, `image/png`→`.png`, `image/jpeg`→`.jpg`); fall back to no suffix.
- Extracted as a pure exported helper `attachmentFileName(displayName, name, fileType)` with unit tests.

Applies to all categories automatically (sizer, contract, checklist, survey, labeled survey) and to bid emails, which share this loader.

## B. Checklist data v2 + form rework (frontend)

`ChecklistData` changes (`SiteVisitChecklist.tsx`):

- Add `sqft: string`.
- Add `acUnits: AcUnit[]` where `AcUnit = { size: string; type: '' | 'Central' | 'Mini Split' | 'Heat Pump' | 'Other'; lra: string }`.
- Remove `acSize`, `lra`, `tankSize`, `tankType` from the active shape.
- `LoadRow` gains `volt`/`hp`/`amps`/`fuel` everywhere (shape already supports all four; the UI restriction goes away).
- Add `customLoads: CustomLoad[]` where `CustomLoad = { name: string } & LoadRow`.

**Migration** (in `parseChecklist`): old saved shapes keep working — if `acUnits` is absent and legacy `acSize`/`lra` exist, seed `acUnits = [{ size: acSize, type: '', lra }]`. Legacy `tankSize`/`tankType` are ignored (dropped on next save). Never a DB migration — `checklist_data` is JSONB.

**Form UI**: AC Units section (add/remove rows) replaces the AC Size + LRA fields; Sq/Ft input added to the header grid; Tank Size/Qty + AG/UG controls deleted; every loads row renders Fuel toggle + Volts toggle + HP input + AMPS input; "Add appliance" appends a custom row (name input + the four columns + remove).

**Sizer autofill** (`sizerParse.ts` + `autofillFromSizer` in GenDetailDrawer): parsed AC tonnage/LRA now produce `acUnits` entries (one unit per detected tonnage; LRA on the first unit) instead of `acSize`/`lra` strings. Existing `acUnits` entered by hand are preserved on merge (sizer units are appended only when `acUnits` is empty).

## C. Vector PDF module (frontend)

New `frontend/src/features/gen-pipeline/checklistPdf.ts`:

- `buildChecklistPdf(gen-, data, mode: 'blank' | 'filled'): jsPDF` — programmatic letter-size layout with typed text and ruled lines replicating the paper sheet: company title, Site Visit Checklist subtitle, header rows (Name, Gen Size/Brand, Date, Proposal No., Address, Sq/Ft), Service & System block (Disconnect Y/N, Em Panel Y/N, Power Company, Service AMPS, ATS Qty/AMPS), AC units lines, Air Handler, Gas type LP/NG, full-width loads table (Appliance / Fuel / Volts / HP / AMPS — fixed rows, then custom rows), Gen Feed Length/Type, Gas Run Length, Gen Location Description, Notes, "Rough Sketches On Back" footer.
- `mode: 'blank'` renders header identity fields filled from the gen, everything else as blank write-in lines (including 3 empty AC-unit lines and 2 extra blank appliance rows).
- `mode: 'filled'` renders entered values as text; long values wrap — nothing truncates. Selected toggles print as the chosen word (e.g. fuel column shows "Electric"); unselected print blank.
- Output is text+vector only (no html2canvas), tens of KB, selectable/printable.

**Wiring** (`SiteVisitChecklist.tsx`): "Print Blank" button opens the blank PDF in a new tab for printing; "Finalize / Export PDF" builds the filled PDF and uploads it as today (`site_checklist` category, filename ends `.pdf`). Before upload, delete any existing `site_checklist` doc for the gen so re-finalizing replaces instead of duplicating. html2canvas import removed from this file (SurveyMarkupEditor keeps it — image-based by nature).

## Out of scope

- Survey/labeled-survey export changes.
- Sizer parsing beyond the AC-units mapping.
- Any pricing/proposal-builder change.

## Testing

- Backend: unit tests for `attachmentFileName` (display name without extension + pdf original; with extension; mime fallback; unknown mime).
- Frontend: tsc + build; manual smoke — finalize a checklist, confirm small text-PDF; print-blank renders; kickoff draft attachment names end in `.pdf`.
