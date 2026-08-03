# Signed Proposal: Initials, Effective Date, and a Guaranteed Archived Copy

**Date:** 2026-08-03
**Status:** Approved, ready for implementation

## Problem

The generator sales contract has nine places a buyer marks. E-signing fills two of them.

A wet-signed reference copy (an 8-page print of the CRM's own proposal page) carries:

| Location | Mark |
|---|---|
| Proposal page — BUYER block | signature + date |
| Sales Agreement — "entered into effective ____" | date, handwritten |
| Sales Agreement pages ×4 — `CUST INT ____` | initials |
| Sales Agreement — In Witness Whereof BUYER block | signature + date |
| Exhibit A pages ×2 — `CUST INT ____` | initials |
| Exhibit A end — "Sign to Accept This Proposal" canvas | **unused** |

The customer printed and wet-signed the whole thing and left the e-sign canvas blank,
because e-signing only produces one signature.

In `frontend/src/features/builder/ProposalPreview.tsx`:

- `SigBlock` renders twice (lines 445, 661) and both already receive `signatureImage` and
  `signedDate`. This part works.
- `CustInitFooter` renders six times (601, 621, 642, 663, 702, 729) and accepts no data at
  all — it is a hardcoded `CUST INT ________` that is always blank.
- The effective-date blank (line 586) is a static rule, never filled.

Two further defects surfaced while mapping this:

1. **A revisit shows a blank contract.** `ProposalPublicPage` sets `signedSig` only inside
   the signing session. Reopening the link renders the document with
   `signatureImage={undefined}`, so an already-executed contract comes back unsigned-looking.
   The public GET already returns `signature_data` (it selects `*`); it is simply never read.
2. **The archived PDF depends entirely on the customer's phone.** `saveSignedPdf`
   rasterizes the whole document with html2canvas at `scale: 1.5` in the buyer's browser,
   then uploads it — inside `try { … } catch { /* non-fatal */ }`. If html2canvas runs out
   of memory on a phone, or the buyer closes the tab mid-render, or the upload fails, the
   proposal is still marked signed and the "🎉 Proposal signed" email still goes out, but
   no document is ever attached and nobody is told. There is no server-side PDF library in
   the backend, so nothing else can produce it.

## Design

### 1. Initials capture

**Migration `086_gen_initials.sql`** — `generator_proposals.initials_data text`, nullable,
alongside the existing `signature_data`.

`POST /gens/p/:token/sign` accepts `{ signatureData, initialsData }`. `initialsData` stays
optional at the API level so a stale cached client cannot start 400-ing, but the UI
requires it.

`ProposalPublicPage` gains a second, smaller `SignatureCanvas` beside the signature box,
labelled "Your initials" (roughly 200×90 against the signature's full width). **Accept &
Sign stays disabled until both canvases are non-empty**, so nobody can sign and leave six
blanks behind. Both data URLs post together and are stamped into the DOM before the
existing rasterize step, so the archived PDF picks them up with no change to how it is built.

### 2. Rendering the marks

`ProposalPreview` takes one new optional prop, `initialsImage`.

- `CustInitFooter` accepts it and renders the image in place of the `________` rule when
  present. All six call sites pass it. This mirrors exactly what `SigBlock` already does
  with `signatureImage` — no new mechanism.
- The effective-date blank renders `signedDate` when set, falling back to the rule when not.

Unsigned proposals pass nothing, so the rep's builder preview and the printed wet-ink copy
are unchanged. That path keeps working for anyone who still prefers paper.

### 3. Revisit hydration

On load, `ProposalPublicPage` seeds `signedSig`, `initialsImage`, and `signedDate` from the
GET response (`signature_data`, `initials_data`, `signed_at`) rather than only from the
in-session signing. A customer reopening their link sees the executed document.

### 4. A guaranteed archived copy

Everything needed to reproduce the document byte-for-byte is already stored on the row:
`form_data`, `totals_data`, `signature_data`, `initials_data`, `signed_at`. So the copy on
the card does not need the customer's phone to have succeeded — it can be rebuilt on demand.

**Extract the rasterizer.** The html2canvas + jsPDF logic currently inline in
`ProposalPublicPage.saveSignedPdf` moves to `frontend/src/lib/signedContractPdf.ts`,
exporting a function that takes a rendered element and returns a PDF blob. Both the
customer-side path and the new rep-side path call it. This removes the duplication the
second caller would otherwise create.

**Fix the archive size while extracting it.** The page-slicing loop calls `addImage` with
the same full-resolution PNG once per page. Without an alias, jsPDF embeds a *separate
copy* of that bitmap for every page — a measured rebuild produced a **34MB** file for a
6-page contract. Passing a stable alias (and `'FAST'` compression) makes jsPDF store the
bytes once and reference them per page: the same document then measures **2.1MB**, a
15.8× reduction, with identical output. This is very likely the root cause of the missing
archives — a 34MB upload from a phone on cell data is exactly the kind of thing that dies
silently, which is what the swallowed catch then hid.

**On the gen card** (`GenDetailDrawer`), when `gen.signed_at` is set, show a "Signed
Contract" row:

- If a `documents` row already exists for this gen with `category = 'contract'` and a name
  starting `Signed Proposal`, the row opens it — the existing `RecordFiles` download path.
- If none exists, the row reads "Signed — PDF not archived" with a **Rebuild** action.
  Rebuild renders `ProposalPreview` offscreen with the stored form, totals, signature,
  initials, and signed date; rasterizes it via the shared module; uploads it through the
  authenticated `POST /documents` with `linked_id = gen.id`, `div = 'gen'`,
  `category = 'contract'`, named `Signed Proposal - {customer}.pdf` to match what the
  customer-side route produces; then the row becomes a normal document.

`GenDetailDrawer` receives its `gen` from the list query, which selects `*`, so
`form_data` / `totals_data` / `signature_data` / `initials_data` are present with no extra
fetch. Implementation must confirm this rather than assume it; if any snapshot is absent
from the list payload, fetch the single gen on demand instead of widening the list query.

**Stop swallowing the failure.** The customer-side `saveSignedPdf` catch logs the error to
the server so a missing archive is discoverable instead of invisible. It stays non-fatal —
signing already succeeded server-side, and the rep can now rebuild from the card.

### Data flow

```
customer signs (signature + initials)
  → POST /p/:token/sign         { signatureData, initialsData }   → stored on the row
  → marks stamped into the DOM
  → rasterize → POST /p/:token/proposal-pdf → documents row + Drive contract folder
       └─ on failure: logged, not silent; card offers Rebuild

rep opens card → signed, no document → Rebuild
  → ProposalPreview rendered offscreen from stored row data
  → same rasterizer → POST /documents → documents row
```

### Tests

- `CustInitFooter` renders an image when given one, the rule when not
- `ProposalPreview` stamps initials at all six spots and the signature at both blocks
- effective date fills from `signedDate`, falls back when absent
- Accept & Sign is disabled with only one of the two canvases filled
- the sign POST body carries both `signatureData` and `initialsData`
- the sign route persists `initials_data` and leaves it null when omitted
- revisiting a signed proposal renders the stored marks without re-signing
- the card shows Rebuild only when signed and no contract document exists
- `buildContractPdf` passes ONE alias and identical bytes across every page, so the
  per-page-copy regression cannot come back unnoticed

## Out of scope

- Per-spot tapping to initial each page individually, and typed-initials fonts. One drawn
  capture stamps all six.
- Server-side PDF generation. Rejected: needs headless Chromium on Render (~300MB image)
  or re-implementing the nine-page layout in a PDF library.
- Changes to who is notified on signing, the Drive folder structure, or the award flow.
