# Countersigning a Signed Proposal

**Date:** 2026-08-04
**Status:** Approved, ready for implementation

## Problem

A customer can e-sign a generator proposal, but nobody at APT ever signs it back. The
`SigBlock` component renders an APT column — `By: Authorized Representative` over a rule,
and `Date` over another — and both stay empty forever. The archived contract is therefore
half-executed: signed by the buyer, unsigned by the seller.

Awarding the deal today is a manual drag on the pipeline board, entirely separate from any
signature.

## Design

### Data

**Migration `087_countersign.sql`**

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_data text;

ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS countersigned_at   timestamptz;
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS countersignature_data text;
ALTER TABLE generator_proposals ADD COLUMN IF NOT EXISTS countersigned_by   uuid REFERENCES users(id);
```

`users.signature_data` is the reusable saved signature. The *image* is copied onto the
proposal at countersign time rather than referenced, so re-saving a signature later can
never silently alter an already-executed contract.

### Saving a signature

A **My Signature** block in Settings: the same `SignatureCanvas` the customer draws on,
saved to the current user's row via `PATCH /users/me/signature`. Countersigning requires
one; when it is missing the card's button routes to Settings rather than failing.

### Countersigning

`POST /gens/:id/countersign`, `requireAuth`, ownership-checked like its neighbours.

1. `409` unless `signed_at` is set — a contract the customer has not signed cannot be
   executed.
2. `400` when the caller has no saved signature.
3. Already countersigned → return the proposal unchanged. Idempotent, so a double tap
   cannot double-award.
4. Otherwise, in **one transaction**: stamp `countersigned_at`, `countersignature_data`
   (copied from the user), `countersigned_by`, then award the deal.

**Awarding reuses the existing code, it is not reimplemented.** The `stage === 'awarded'`
block currently sits inline in `PATCH /:id/stage`: `commissionRate` → `won_jobs` insert
→ `ensureProject` → activity row → `supersedeGroupSiblings`. That block moves into a
shared `awardGen(client, gen)` helper that both the stage route and this route call, so a
countersigned award and a dragged award cannot drift apart.

Response: `{ gen, wonJob, superseded }`, matching what the stage route already returns.

### The confirmation

Countersigning awards the deal, so a single tap books a won job, earns commission, creates
a project, and reclassifies every other option in the group as superseded. The confirm
dialog states those consequences plainly, and when the proposal belongs to a group it
**names the sibling proposals about to be superseded**. Irreversible work does not happen
behind a one-word button.

### Rendering

`SigBlock` takes `countersignImage` and `countersignDate` and fills the APT column exactly
as the buyer column already works. Both call sites (the cover page and *In Witness
Whereof*) pass them, so an executed agreement reads as executed on both pages.

Immediately after a successful countersign the card rebuilds the archived PDF, so the
document on file shows both signatures rather than staying half-executed.

### On the card

`SignedContractCard` gains a third state:

| Condition | Shows |
|---|---|
| not signed | nothing (unchanged) |
| signed, not countersigned | "Signed {date} — awaiting your signature" + **Countersign** |
| countersigned | "Executed {date}" + **Open** |

The existing archived/not-archived distinction and its **Rebuild** action are preserved
within those states.

## Tests

- countersign rejects a proposal the customer has not signed
- countersign rejects a caller with no saved signature
- countersign is idempotent — a second call neither re-stamps nor awards twice
- countersign awards exactly once: one `won_jobs` row, project created, siblings superseded
- `awardGen` produces identical results whether reached by stage drag or by countersign
- `SigBlock` renders the APT mark only when given one, and the buyer side is unaffected
- the card shows Countersign only in the signed-but-not-countersigned state

## Out of scope

- A queue of deals awaiting countersignature. The card is the entry point.
- Countersigning from the public proposal page. This is an internal, authenticated action.
- Any change to the buyer signing flow, the notification/email set, or Drive folders.

## Noted risk

Making the signature the trigger for commission and superseding means countersigning to
tidy up paperwork on a deal that later collapses requires unwinding a won job. The
alternative — countersign executes the document, the drag still awards — was offered and
declined; the confirmation dialog above is the mitigation.
