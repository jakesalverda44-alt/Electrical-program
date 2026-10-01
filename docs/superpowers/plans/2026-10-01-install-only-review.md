# Review: Generator "Install Only" proposal type (feat/install-only)

Reviewer: Opus. Date: 2026-10-01. Range: `862ce66..195c2a1` (9 commits), worktree `Electrical-program-wt-install-only`.
Plan: `docs/superpowers/plans/2026-10-01-generator-install-only.md` (Reviewer focus §7).

## Verdict: MERGE AFTER FIXES

The core is solid. Legacy totals and renders are unchanged. The public whitelist is right. Frontend and backend calcs agree on the parity fixture. Clause 28 and the warranty text match the approved wording exactly. Tax and discount handling are correct.

Three customer-facing gaps have to be closed before this deploys:
- **F1:** an AI-built install-only proposal picks up $3,000 labor and a $1,250 permit.
- **F2:** Send isn't gated by the run-length validation.
- **F3:** the 12KW load-center unit gets no install scope and no install charge.

## What I ran

| Check | Result |
|---|---|
| Frontend `npx vitest run` | 163 files, **1900/1900 pass** |
| Frontend `npx tsc --noEmit` | clean |
| Backend `npx tsc --noEmit` | clean |
| Backend `npm test` on the 7 touched suites (genTotals, gens.benchmark, gens.buildFromNotes, gens.kickoff, gensPublicFormDataProjection, leadSurvey, settingsAllowedKeys), against electrical_crm_test with the DB up | **56/56 pass**, none skipped |
| Word-diff of the legacy snapshot fixtures, 64654ec → HEAD | The only changes are `Battery Maintainer` → `Battery` (5 totals rows and 3 rendered cells) |
| Function-body diff of legacy `calcGenTotals` (frontend) and `calcFormTotals` (backend) vs 862ce66 | The only additions are the `install-only` early return and `io*: 0` keys. No shared-path line was edited. |
| Clause 28 (a)–(f) and the warranty body vs plan §4 (grep) | Verbatim match |
| Scratch probe (vite-node, outside the repo) | Reproduced F3 and F4 |

## Must fix before merge

### F1: AI-built install-only proposals carry $3,000 "Additional Labor" and a $1,250 permit
- **Where:**
  - `backend/src/utils/genTotals.ts:284-287` (`normalizeInstallOnly` honors `parsed.labor` / `parsed.permit`)
  - the prompt at `backend/src/routes/gens.ts:811-812` still says `labor (default: 3000)` and `permit (default: 1250)`
  - `backend/src/test/gens.buildFromNotes.test.ts:53` locks this in: `expect(t.laborAmt).toBe(3000)`
- **Scenario:** The notes say "customer bought a Generac, install only, 40 ft run." Haiku follows the numeric-field defaults and returns `labor: 3000, permit: 1250`. The normalizer keeps both. The proposal now shows a $3,000 Additional Labor row and a $1,250 permit on what should be about a $3.5k job. Plan §6 named this exact risk. It also contradicts the claim that "AI ignores AI-supplied prices", because labor and permit are prices.
- **Fix:** For install-only, set `out.labor = 0` and `out.permit = defaults.permit` unconditionally, like `prices`. In the prompt, say "for install-only omit labor/permit". Flip the test to expect 0 and 475.

### F2: Validation doesn't cover the Send path or rows written by the AI or lead flows
- **Where:**
  - the drawer Send, `frontend/src/features/gen-pipeline/GenDetailDrawer.tsx:227` (`onSend`) → `:534` (`SendProposalModal`)
  - backend `POST /gens/:id/send`, `backend/src/routes/gens.ts:1245`. Neither checks `installOnlyIssues`.
  - The builder gate (`BuilderPage.tsx` `persist()` and the disabled Preview button) is correct, but it's only one entry point.
- **Scenario A (AI):**
  1. Drawer → Build from notes. The AI returns install-only with `runFt: 0`, which the prompt allows ("0 if not mentioned").
  2. `/build-from-notes` writes `form_data` and `totals_data` straight to the row.
  3. The rep closes the builder without saving and clicks **Send** in the drawer.
  4. The customer signs "Conduit & Wire, Generator to Transfer Switch (~0 ft)" priced at the $400 base.
  - `/from-calendar-event` goes the same way.
- **Scenario B (lead):** A lead converted as Install Only saves partial `form_data` with no labor, permit or `installOnly`, and possibly no totals. If it's sent before anyone opens the builder, the public page recomputes: `permit` defaults to true and `permitAmt` comes out $0. The customer then sees "Permit — permit fee included" at $0, plus the 0 ft run. The probe confirmed `permitAmt 0`.
- **Fix:**
  1. Add a backend `installOnlyIssues(form)` in `utils/genTotals.ts`. It should cover runFt (conduit ≠ existing), the pad/battery/stand/lift without set-generator rule, and ATS qty.
  2. Return 422 from `/send` when it finds issues.
  3. In the drawer, disable Send with the first issue as the tooltip. A tiny `isInstallOnlyGen` plus `installOnlyIssues` on the parsed form is enough.
  4. Optional: reject the same issues in `PATCH`/`POST /gens`.
  5. Add one backend test: send on an install-only row with runFt 0 returns 422.

### F3: 12KW load-center unit gets no transfer-switch install scope and a $0 install (path-dependent)
- **Where:**
  - `frontend/src/features/builder/genCalc.ts:168-176`: `lockLoadCenter` forces `atsQty = 0`.
  - `genCalc.ts:386` and `backend/src/utils/genTotals.ts:223`: `ioAtsInstallAmt = atsQty × atsInstall`.
  - `frontend/src/features/builder/installOnlyScopeRows.ts:21`: `if (!lc)` drops the ATS row entirely.
  - The builder hides the ATS install price for LC.
- **Scenario:**
  1. A Kohler 12KW, Full preset, customer supplies the unit and its integrated load center. The probe output was `atsQty 0, ats 'customer-install', ioAtsInstallAmt 0, issues []`.
  2. The scope rows are Customer-Furnished Generator, Set, Conduit, Connection and Battery. Nothing says APT mounts and wires the load center or transfer switch, and nothing is charged for it.
  3. The intro and the "Not Included" row both mention the transfer switch, so the contract is ambiguous on the biggest piece of electrical work.
  4. On the AI path, `normalizeInstallOnly` (`genTotals.ts:290`) sets `atsQty ≥ 1`. So the same job built from notes *does* bill $750, but still has no scope row.
- **Fix (needs a call from Jake):** Either:
  - **(a)** When `lc && ats !== 'existing'`, bill `atsInstall × 1`. Add a scope row "Install Customer-Furnished {lc} Load Center (integrated transfer switch)" with the mount-and-wire body, and a breakdown row. Make the normalizer consistent with this.
  - **(b)** Block install-only for load-center sizes until Jake prices them. `getGenSizes` for install-only would exclude `LOAD_CENTER_UNITS`.

  Either way, add a parity case and a render test for 12KW.

## Should fix (same round is fine)

### F4: Clicking the already-active "Install Only" button silently wipes the scope and prices
- **Where:** `frontend/src/features/builder/BuilderPage.tsx:446`. The handler is `onClick={() => setForm(f => applyJobType(f, jt, s))}` with no same-type guard. `applyJobType` → `applyInstallOnlyDefaults` + Full preset.
- **Scenario:** The rep sets ATS = existing, wire-only, gas on, connect $600, permit $350 and additional labor $200, then taps "Install Only" again. Everything resets to Full preset and Settings prices, with labor 0 and permit 475. Only runFt and unitDesc survive. The probe confirmed this. If the rep doesn't notice, the customer gets the wrong scope and price.
- **Fix:** `if (f.jobType === jt) return f;` in the onClick. At minimum add it for install-only. Legacy buttons had the same pre-existing "reset labor" quirk, so putting the guard on all three is fine and harmless.

### F5: The proposal email body still sells a generator
- **Where:** `backend/src/email/proposalEmail.ts:54,65`, fed `spec` from `backend/src/routes/gens.ts:1258`.
- **Scenario:** The subject is fixed, but the body reads "Your **22KW Generac** standby generator proposal…" and the card says "22KW Generac Standby Generator" next to the total. A customer can read that as the price including the machine.
- **Fix:** For install-only, pass `spec` as undefined, or as a label like "Installation — customer-furnished 22KW Generac".

### F6: The builder lets you type $0 startup, but the proposal charges $695
- **Where:** `BuilderPage.tsx:577` (IoPrice accepts 0) vs `genCalc.ts:395` (0 → `DEFAULT_PRICES.startup`). The fallback is the hard-coded 695, not `gen_default_startup`.
- **Fix:** Set `min` to 1 or clamp on input. Or show the effective amount. Either way, fall back to the Settings startup value.

## Questions for Jake (not blockers)
- **SMM default.** `blankGenForm` has `smmQty: 1` (`genCalc.ts:27`), and switching to Install Only keeps it. Every new install-only proposal therefore includes a $250 taxable SMM unless the rep removes it. Intended?
- **Startup wording.** The builder added "APT will register the manufacturer warranty on the Buyer's behalf where the manufacturer allows." to the Startup row (`installOnlyText.ts`, `IO_STARTUP_BODY`). This follows your "APT registers" decision, but the hedge "where the manufacturer allows" is new wording. Approve it, or edit it.
- **Pre-existing legal-text typo, not from this branch.** Clause 13(b) says "THE WARRANTIES STATED IN PARAGRAPH 11(A)". It should say 13(a). Clause 28(c) points at 13(a), so worth fixing with the attorney pass.
- **Leftover comment.** `genData.ts:43` still has the comment "(or reuse $25?)". It's harmless, but the question is closed.

## Reviewer checklist results

1. **Legacy unchanged: PASS.**
   - The shared paths are byte-identical apart from the `install-only` early return and the zeroed `io*` keys. That holds in both calcs.
   - The snapshot fixtures were captured at 64654ec, before any feature code. The only diff since is the approved Battery label.
   - Sent and signed legacy proposals:
     - The public page and SignedContractCard use the stored `totals_data`, so the amounts are unchanged.
     - `migrateGenForm` adds a default `installOnly`, which is never read for legacy types.
     - The one visible change on re-render is the "Battery" label (approved). Archived PDFs are unaffected.
   - New legacy `totals_data` gains five `io*: 0` keys. Values are unchanged; the JSON isn't byte-identical, which is harmless.
2. **Public page: PASS.**
   - `installOnly` is in `GEN_FORM_KEYS` (`publicFormData.ts:77`).
   - The projection test round-trips the full scope, including `prices` and a deliberate `connect: 0`.
   - Public and SignedContractCard render the stored scope via `coerceInstallOnly`, and use the stored totals.
3. **Per-proposal overrides: PASS.** They persist in `form_data.installOnly.prices`, pass the whitelist, survive `coerceInstallOnly` (a deliberate 0 stays 0), and they are what the calc and the document use. What the customer signs is the stored snapshot. The F4 reset is the exception.
4. **Settings defaults: PASS.**
   - Defaults are copied into the form only in `blankGenForm` and when switching to Install Only (`applyJobType` / `applyInstallOnlyDefaults`).
   - **Existing install-only drafts keep their own stored prices.** Changing Settings never changes them.
   - Existing legacy drafts are unaffected until someone switches them to Install Only. At that point they take the current Settings.
   - Two cases re-pull current Settings and drop per-proposal edits: switching away and back, and the F4 re-click.
   - A stored proposal missing a price key falls back to the built-in default, not Settings. That's minor.
5. **Startup and connect unremovable: PASS for UI, AI and migration.**
   - Neither has a field. Both scope rows always render, and the calc always bills them. Startup can't be 0; connect can be a deliberate $0 per proposal, as designed.
   - Via the API, `totals_data` is client-supplied and stored verbatim by `PATCH /gens`. That's the pre-existing trust model for every type, open only to authenticated staff, so a crafted request can change amounts but cannot remove the rows. Not a regression.
6. **runFt validation: PASS in the builder (Preview, Save and builder Send all go through `persist`). FAIL for the drawer Send, the backend `/send`, and AI or lead rows sent without opening the builder.** See F2.
7. **Clause 28, warranty and permit text:**
   - The text is install-only-only. The legacy render snapshots contain no clause 28, and the disclosure sentence is conditional.
   - Clause 28 and the warranty body match the plan verbatim.
   - The paragraph references (1, 2, 3, 11, 12, 13(a)/(c), 14, 15, 17) match the agreement's numbering.
8. **Tax and discount: PASS.**
   - Taxable: pad, stand, battery, the APT-furnished ATS, SMM, surge, EM panel, and taxable custom items.
   - Non-taxable: all io labor (set, ATS install, conduit or wire, connect, gas), lift, additional labor, permit, startup and EV.
   - The discount is pro-rata using the same formula as legacy. The breakdown rows sum to the subtotal; I checked every amount field.
9. **Kickoff, benchmark and pipeline: PASS.**
   - The kickoff email subject and scope lines are correct.
   - The benchmark SQL excludes install-only (there's a DB test), and the builder flag is suppressed.
   - The pipeline tag and send subject are correct (the email body is F5).
10. **Render build: PASS.**
    - `backend/src/utils/genTotals.ts` imports nothing from the frontend.
    - The parity fixture is read only by `backend/src/test/genTotals.test.ts`, via `readFileSync` at test runtime. `tsc` compiles that file into `dist/test`, but nothing executes it in production. Render also builds from the full repo, so the path exists anyway.
    - No runtime code imports a frontend path. Frontend `tsc && vite build` only pulls the JSON fixture from test files.
11. **Task 0 (`buildPdf` / Download PDF): PASS.** The branch doesn't touch that region.

## Deviations judged
- **Settings group under Defaults instead of Gen Pricing:** OK. It's next to the other `gen_default_*` values, and the copy is clear.
- **Battery gated by "Set generator":** OK and consistent everywhere: calc, validator, AI normalizer and scope. It's a judgment call worth one line to Jake, since a customer unit that's already set might still need a battery.
- **Pad + stand not flagged:** OK. The UI makes them mutually exclusive, the calc charges pad only when there's no stand, and the scope text prefers the stand.
- **Switching to install-only applies Full preset, resets prices from Settings, keeps runFt 0:** OK on a real type change. Not OK on a same-type re-click (F4).
- **Legacy backend `|| default` kept for other types:** OK. Changing it would alter legacy AI-path totals, and the install-only branch uses explicit handling.
- **Backend 0% tax → 7%:** pre-existing in the legacy path. The install-only branch copied it, so the parity holds only for nonzero tax. It's low risk because the builder recomputes. Leave it, or fix both in a separate change.
- **Parity fixture read cross-package:** fine for the Render build; see 10.
