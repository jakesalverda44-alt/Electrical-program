# Plan: "Install Only" generator proposal type (APT CRM)

Repo: `/Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version` (main 56b4ac9). This was a read-only exploration. I edited nothing and ran nothing.

## Summary for Jake (≤120 words)

The builder gets a third Job Type button, **Install Only**, next to New Install and Swap-Out. It's for jobs where the customer supplies the generator. The generator price drops to $0. You pick the scope with checkboxes: set the generator, install the ATS (customer's, ours, or already installed), run conduit or just pull wire (with a length), pad, battery, gas and permit. Connecting the generator to the ATS and startup are always included. Four one-click presets cover the common jobs. The proposal says "Customer-Furnished Generator", lists only the work you checked, and covers workmanship only. The sales agreement gets one added clause, and you or your attorney need to approve it. Before this ships I need your prices (table below) and sign-off on the wording.

---

## 1. How New Install and Swap-Out work today

**Where the type lives.** `jobType: 'new-install' | 'swap-out'` is a field inside `form_data` JSONB (`frontend/src/features/builder/genData.ts:344`). There is no DB column or enum for it. `product_type` (`generator` | `ev_charger`, CHECK in `database/migrations/088_product_type.sql`) is a separate axis. **Install Only should stay `product_type='generator'`, so no migration is needed.**

**Selector.** It's a two-button toggle at `BuilderPage.tsx:350-372`.
- Swap-Out hard-codes `pad:false, labor:1500, permit:475`.
- New Install restores `labor`/`permit` from settings, falling back to 3000/1250, and sets `gasLine:false`.
- Both then re-filter sizes and apply the load-center lock (`:357-361`).
- An amber swap-out banner shows at `:373-378`.
- Swap-only fields: gas line `:403-408` and removal fee `:409-413`.

**Prices.** These are hardcoded constants, not settings:
- Frontend: `DEFAULT_PRICES` (`genData.ts:1-32`).
- Backend: `GEN_PRICES` / `ADDON_P` (`backend/src/routes/gens.ts:740-761`).
- Only labor, permit, startup, tax, deposit and valid-days come from settings (`genCalc.ts:5-38`, `blankGenForm`). They are copied into the form when the proposal is created.
- **Finding:** the settings `gen_default_pad/smm/surge_pro/battery/em_panel/extra_wire/lull/crane` and `gen_pricing_table` are saved by `ProposalDefaultsSection.tsx:11-52` / `GenPricingSection.tsx`, but nothing in genCalc reads them. They do nothing today.

**Calc.** `calcGenTotals` is at `genCalc.ts:185-242`.
- Labor is one lump `g.labor` (new install $3000, swap $1500).
- The only length-based price is `extraWire` at $25/ft. **There is no conduit or per-scope labor pricing.**
- `gasLine` is billed only when `jobType==='swap-out'` (`:197`). `removalFee` is swap-only (`:205`).
- Liquid-cooled forces `startupLC` $1595 (`:208`).
- Taxable vs non-taxable bases are split at `:225-226`.

**Backend mirror.** `calcFormTotals` (`gens.ts:792-852`) is used only by build-from-notes and has already drifted (no 12KW, no `genPriceOverride`, no load-center).
- **Bug-in-waiting:** `laborAmt = Number(g.labor) || ADDON_P.labor` and `permitAmt = Number(g.permit) || ADDON_P.permit` (`:817-818`). A deliberate 0 becomes $3000 / $1250.

**Document.** `ProposalPreview.tsx` branches on jobType in these places:
- Subtitle `:199`
- Intro `:253-258`
- Scope table `:261-346`: equipment row `:264-268`, scope `:269-277`, warranty `:293-305`, the "Permit Fees & Sales Tax Included" row `:306-310` (always shown), gas `:311-317`
- Breakdown `:356-421` (tax note `:419`)
- Spec sheet `:425`
- The Sales Agreement assumes APT sells the generator throughout:
  - ¶1 Sale of Goods, ¶2 deposit "after APT orders a generator", ¶3 "ALL GENERATOR SALES ARE FINAL" (`:506-508`)
  - ¶11 repossession, ¶12 title, ¶13a/c warranty and manufacturer-warranty assignment, ¶14 risk of loss (`:526-532`)
  - ¶15 security interest in the generator, ¶17 permits (`:543-545`)
- Disclosures say "Permits and Sales Tax are included" (`:588`).
- The PDF is built client-side with html2canvas (no docx for gens). Save to Drive goes through `POST /gens/:id/drive-proposal` (`gens.ts:542`).

**Save, send and e-sign.**
- `persist()` (`BuilderPage.tsx:216-257`) POSTs or PATCHes `/gens` with `form_data` and `totals_data` (a snapshot) plus `mfr/model/kw/amount/addons`.
- The backend does not validate `form_data` (`gens.ts:151-231`, `:597-640`).
- The public page `GET /gens/p/:token` (`gens.ts:1356-1389`) runs `form_data` through the **whitelist** `GEN_FORM_KEYS` in `backend/src/utils/publicFormData.ts:58-72`.
- `ProposalPublicPage.tsx:174-180` then runs `migrateGenForm` and uses the stored totals, recomputing only if they're missing.
- `SignedContractCard.tsx:106` re-renders the preview from the row.

**AI.** `BuildFromNotesModal.tsx` → `POST /gens/:id/build-from-notes` → `extractFormFromNotes` (`gens.ts:854-993`). The prompt enum is at `:881`. Battery is forced true for anything that isn't swap-out (`:985`), so **it would force battery on install-only**. The calendar path `/from-calendar-event` uses the same extractor.

**Readers of the type or totals elsewhere:**
- Benchmark `GET /gens/benchmark` averages awarded totals by kW (`gens.ts:115-131`). The builder shows "X% below avg" (`BuilderPage.tsx:696-715`). Install-only totals would distort it and trigger false alarms.
- Kickoff email `buildAwardKickoffEmail` (`gens.ts:1187-1232`): subject "New {brand} Install", "Existing ATS" for swap.
- Send subject: `SendProposalModal.tsx:22` and backend fallback `gens.ts:1318`.
- Pipeline card brand pill (`GenPipelinePage.tsx:300-330`).
- No dashboard or brief query switches on jobType.

**Lead survey.**
- Job Type step `LeadSiteSurvey.tsx:183-188`, swap-step filter `:108`.
- Mapping is duplicated in `frontend/src/features/leads/surveyMap.ts:15,51,81` and `backend/src/routes/leads.ts:28-95`. The backend copy is the one that's actually used, via `convertLeadToProposal` `:271-300`, which saves a **partial** form_data with no labor or permit.

**Uncommitted work.** `ProposalPreview.tsx` has uncommitted changes in the main checkout: a shared `buildPdf()` (`:85-108`) used by Save to Drive and a new Download PDF button (`:128-139`, `:183-185`). Install Only edits are in the render body, not the toolbar, so they won't conflict logically, but **the builder must not reset or overwrite this file**. See Task 0.

---

## 2. Scope / variation model

Add one nested object to `GenForm`. Nesting means one whitelist key and one migrate default.

```ts
jobType: 'new-install' | 'swap-out' | 'install-only';
installOnly: InstallOnlyScope;   // only read when jobType === 'install-only'

interface InstallOnlyScope {
  setGenerator: boolean;                                  // set/place/level unit
  ats: 'customer-install' | 'apt-supply-install' | 'existing';
  conduit: 'run' | 'wire-only' | 'existing';              // gen→ATS
  runFt: number;                                          // required when conduit !== 'existing'
  gas: boolean;                                           // false = "Gas by others"
  permit: boolean;                                        // false = permit not included
  unitDesc: string;                                       // customer's make/model/serial (free text)
}
```

**Reused top-level fields:**
- `pad` (APT pad, LC tiers), `genStand`, `battery`, `liftType`, `atsQty` (number of ATS units installed), `atsSize`.
- `smmQty`, `surgeProQty`, `emPanel`, `evCharger`, `silverServicePromo`, `customItems`, `discount`, `notes`, `startup`.
- `permit` (amount), `labor` (relabeled **"Additional Labor"**, default 0).

**Always included and not removable:**
- Generator→ATS connection (terminations plus control wiring).
- Startup & Commissioning.

Both show as disabled, checked rows.

**Dependencies and validation.** A pure `installOnlyIssues(form): string[]` in genCalc. It's shown inline, and it blocks Preview, Save and Send.
1. If `conduit` is `'run'` or `'wire-only'`, `runFt` must be > 0.
2. `pad`, `genStand` and `liftType` are enabled only when `setGenerator`. Unchecking setGenerator clears them to false / 'none' / 'none'. The validator also flags them, which covers the AI path.
3. `pad` and `genStand` stay mutually exclusive, as they are today.
4. `atsQty ≥ 1` unless `ats==='existing'`.
5. Load-center units (Kohler 12KW): show "Integrated load center (customer-furnished)". The ATS choice is limited to customer-install or existing, with no apt-supply option.
6. Forced while in install-only: `genPriceOverride=null`, `extWarranty='none'` (hidden), `removal=false`, `gasLine=false`, `extraWire=0` (hidden, because runFt replaces it).

**Presets.** These are derived from the fields, never stored, using `matchIoPreset(form)`. Any other combination shows "Custom".

| Preset | setGen | ATS | Conduit | pad | battery | permit |
|---|---|---|---|---|---|---|
| Full install, customer-furnished generator & ATS (default) | ✓ | customer-install | run | ✓ | ✓ | ✓ |
| Set & connect, ATS already installed | ✓ | existing | run | ✓ | ✓ | ✓ |
| Wire pull only (conduit in place) | ✗ | existing | wire-only | ✗ | ✗ | ✗ |
| Connect to existing ATS (conduit & wire in place) | ✗ | existing | existing | ✗ | ✗ | ✗ |

Applying a preset leaves `runFt` and `unitDesc` alone.

**Extras to confirm with Jake.** Don't build anything new for these. SMM/load management, surge, EM panel, EV, Silver Service and custom items already exist and keep working.
- Should Extended Warranty and the Kohler/Generac promo be offered on customer-supplied units? Default: hidden.
- Should "Other" brands (Champion, Briggs, Cummins) be selectable? v1: keep the Kohler/Generac and size selectors (they drive kW, LC startup and pad pricing) plus the free-text `unitDesc`.

---

## 3. Prices needed from Jake

New constants go in `DEFAULT_PRICES.installOnly` (frontend) and `ADDON_P.io*` (backend mirror), with a `// PLACEHOLDER — Jake to confirm` comment. This follows the existing pattern: add-on prices are constants, and those settings aren't wired.

| Input | Source today | Current value | Install Only use | Taxable |
|---|---|---|---|---|
| Generator equipment | `DEFAULT_PRICES.generators` | $4,900–$41,129 | **$0** (customer-furnished) | — |
| Set/place generator, air-cooled | none | — | **NEW `setGenAC` placeholder $750** | No |
| Set/place generator, liquid-cooled | none | — | **NEW `setGenLC` placeholder $1,500** (lift still separate) | No |
| Install customer ATS (per unit) | buried in $3,000 labor | — | **NEW `atsInstall` placeholder $750** | No |
| APT-furnished ATS equipment (per unit) | `DEFAULT_PRICES.ats` | $1,000 | ATS equipment, plus `atsInstall` labor | Yes |
| Conduit + wire run, base | none | — | **NEW `conduitBase` placeholder $400** | No* |
| Conduit + wire run, per ft | none (`extraWire` $25/ft is the only per-ft price) | — | **NEW `conduitPerFt` placeholder $30/ft** | No* |
| Wire pull only, base | none | — | **NEW `wirePullBase` placeholder $250** | No* |
| Wire pull only, per ft | `extraWire` | $25/ft | **NEW `wirePullPerFt` placeholder $12/ft** (or reuse $25?) | No* |
| Gen→ATS connection (always) | buried in labor | — | **NEW `connect` placeholder $450** | No |
| Startup (always) | `startup` setting / `DEFAULT_PRICES.startup`; LC `startupLC` | $695 / LC $1,595 | reused unchanged | No |
| Permit (optional) | `permit` field; new install $1,250, swap $475 hard-coded | — | **default $475 placeholder** | No |
| Pad (APT) | `pad`, `padLC_small`, `padLC_large` | $485 / $800 / $1,200 | reused | Yes |
| Battery (APT) | `battery` | $185 | reused | Yes |
| Gen stand | `genStandSmall` / `genStandBig` | $2,000 / $2,500 | reused | Yes |
| Lull / crane | `lull` / `crane` | $1,100 / $1,800 | reused (only with setGen) | No |
| Gas connection at unit (optional) | `gasLine` (swap D/R) | $500 | **NEW `ioGas` placeholder $500** | No |
| Additional labor | `labor` | new $3,000 / swap $1,500 | **default $0** | No |

\*Conduit and wire material is non-taxable to match the existing precedent: extraWire is folded into the non-taxable "Labor & Electrical" (`genCalc.ts:221-226`). Jake and his accountant should confirm.

---

## 4. Wording for Jake to confirm

**Subtitle:** "Generator Installation Agreement — Customer-Furnished Equipment". Type label: "Install Only".

**Intro:** "{Company} proposes to furnish the labor and installation materials necessary to install the customer-furnished generator{ and transfer switch} described below, in accordance with the {year} National Electrical Code… THIS PROPOSAL IS VALID FOR {n} DAYS."

**Scope rows (only checked items appear):**
1. **Customer-Furnished Generator — {brand} {size}{ (unitDesc)}**: "The generator{ and automatic transfer switch} {is/are} furnished by the Buyer. APT provides installation labor and installation materials only, as listed below. Buyer is responsible for delivery to the site, condition, completeness (all parts, manuals, accessories) and compatibility with the home's electrical service."
2. **Set & Place Generator**: "Set and level the customer-furnished generator in its final location {on a new APT-furnished pad | on an APT-furnished adjustable gen stand | on the existing code-compliant pad/base}, maintaining manufacturer-required clearances."
3. ATS, one of three:
   - **Install Customer-Furnished Transfer Switch**: "Mount and wire the customer-furnished {atsSize} transfer switch{ (qty)}, including utility disconnect coordination, service and load-side connections, grounding and bonding."
   - **Furnish & Install {atsSize} Transfer Switch**: same text with "APT-furnished".
   - **Existing Transfer Switch**: "Connect to the transfer switch already installed. APT is not responsible for the existing switch's condition, rating or prior installation; defects found will be quoted separately."
4. Conduit, one of three:
   - **Conduit & Wire, Generator to Transfer Switch (~{ft} ft)**: "Furnish and install conduit, fittings, power conductors and control wiring."
   - **Wire Pull, Existing Conduit (~{ft} ft)**: "Conduit installed by others. Pull new power conductors and control wiring through it. If the existing conduit is obstructed, damaged or undersized, replacement will be quoted separately."
   - **Existing Conduit & Wiring**: "Conduit and conductors are existing (by others); APT terminates at both ends only."
5. **Generator-to-Transfer-Switch Connection (always)**: "Terminate power, neutral, ground and control/communication wiring at the generator and transfer switch; verify voltage and transfer operation."
6. **Battery (APT-furnished)**: "Furnish and install a new generator starting battery to manufacturer spec." **Flag:** the same `battery` field is labeled "Battery" in the builder but "Battery Maintainer" on the breakdown (`ProposalPreview.tsx:376`). Which is it?
7. **Startup & Commissioning (always)**: "Startup per manufacturer procedure: check oil, battery and fuel pressure at the unit (gas by others unless listed), configure the controller and exercise schedule, test transfer and retransfer, and review operation with the Buyer." Who registers the manufacturer warranty, APT or the Buyer? Choose one.
8. **Permit**:
   - Included: "APT will secure the permit and schedule inspections; permit fee included."
   - Not included: "Permits are not included. If the authority having jurisdiction requires a permit or inspection, it will be added by written change order."
9. **Gas**:
   - Not checked: "Gas — By Others: fuel supply, piping, regulator and gas connection are NOT included."
   - Checked: "Gas connection to existing stub-out at the generator."
10. **Warranty — Workmanship Only**: "APT warrants its installation workmanship and APT-furnished materials for twelve (12) months from startup. Customer-furnished equipment is covered only by its manufacturer's warranty, if any; APT makes no warranty on it and is not responsible for manufacturer warranty claims, parts or labor. Manufacturer coverage may depend on registration and/or installation by an authorized dealer; Buyer is responsible for confirming eligibility."
11. **Not Included**: "Generator{ and transfer switch} equipment; gas work (unless listed); removal or disposal of packaging or old equipment; repairs to existing non-compliant wiring; anything not listed above."

**New Sales Agreement clause 28, "Customer-Furnished Equipment" (attorney review recommended).** Only rendered for install-only. Placed after ¶27, before the signature block.

"Where the Generator Proposal identifies equipment as furnished by Buyer:
(a) APT is not selling that equipment. Paragraphs 1, 3, 11, 12, 13(c), 14 and 15 apply only to goods and materials actually furnished by APT.
(b) The deposit under Paragraph 2 becomes nonrefundable once APT has applied for a permit, purchased job-specific materials, or scheduled the installation, whichever is first.
(c) The limited warranty in Paragraph 13(a) covers APT workmanship and APT-furnished materials only.
(d) Buyer represents the equipment is new or in good working order, complete and suitable for the site. APT is not liable for its defects, missing parts, shipping damage or performance. Extra trips or labor caused by defective or incomplete customer-furnished equipment are billed at APT's shop rate ($160/hr).
(e) Risk of loss of customer-furnished equipment remains with Buyer at all times.
(f) If the Proposal states permits are not included, Paragraph 17 applies only to permits later added by written change order."

**Disclosures `:588`:** "Permits and Sales Tax are included" becomes conditional: "Permits are {included | not included}; sales tax is included on taxable items."

**Questions for Jake:**
- Cancellation terms for install-only.
- Should the spec sheet be hidden? Proposed: hidden, because the customer's unit may differ.
- Proposal number prefix: keep JSKOHL/JSGNRC?

---

## 5. Tasks (Sonnet builds, Opus reviews)

**Task 0: Coordinate the uncommitted ProposalPreview changes.**
- Ask Jake to commit the Download PDF / `buildPdf` refactor on main first, or have the builder commit it **as-is** as its own first commit ("feat: Download PDF button") before branching `feat/install-only`.
- Never `git checkout`/`restore` that file.
- Acceptance: `git diff` on main is clean for ProposalPreview before feature work starts.

**Task 1: Data model and calc.** Files: `genData.ts`, `genCalc.ts`, `genCalc.test.ts`.
- Widen the `jobType` union. Add `InstallOnlyScope`, `DEFAULT_IO_SCOPE` (Full preset), and `DEFAULT_PRICES.installOnly` (placeholder constants, commented).
- `migrateGenForm`: default `installOnly` when it's missing or malformed (per-key coercion of enums and numbers).
- New helper `applyJobType(form, jt, settings)`, which holds the per-type defaults currently inline at `BuilderPage.tsx:354-361`.
  - install-only sets `labor:0`, `permit:475`, `genPriceOverride:null`, `extWarranty:'none'`, `removal:false`, `gasLine:false`, `extraWire:0`, `atsQty:max(1, atsQty)`, `installOnly: DEFAULT_IO_SCOPE`.
  - Also used by `genToForm`.
- `getGenSizes`: install-only returns all sizes.
- `calcGenTotals` install-only branch:
  - `genP=0`, `extWarrantyAmt=0`, `removalFee=0`, `gasLineAmt=0`, `extraWireAmt=0`.
  - New fields `ioSetGenAmt`, `ioAtsInstallAmt`, `ioConduitAmt`, `ioConnectAmt`, `ioGasAmt` (all non-taxable).
  - `atsAmt` = apt-supply × qty × `ats` (taxable).
  - `permitAmt` = permit if `installOnly.permit`, else 0.
  - startup unchanged (always). pad, battery and stand only if `setGenerator`.
  - New fields are 0 for the other types, so existing totals are byte-identical.
- Add `installOnlyIssues`, `matchIoPreset`, `IO_PRESETS`, and extend `genPriceRows`.
- Tests:
  - Each preset's total.
  - Each ATS mode × each conduit mode.
  - runFt scaling.
  - Liquid-cooled startup and set price; LC pad tiers.
  - Permit on/off.
  - Tax base excludes all io labor and includes pad, battery and APT ATS.
  - Discount pro-rata.
  - New-install and swap-out totals unchanged (snapshot of `blankGenForm()` totals before and after).
  - Migrate fills defaults.
  - Validator cases.
- Acceptance: `cd frontend && npm test && npm run typecheck` pass.

**Task 2: Builder UI.** File: `BuilderPage.tsx`.
- Three-button toggle (grid `1fr 1fr 1fr`) using `applyJobType`.
- `genToForm`: if `jobType==='install-only'` and the saved form lacks `installOnly` or `labor` (a fresh lead conversion), apply the defaults. Otherwise a lead-converted install-only would carry $3,000 "additional labor".
- New section "Install-Only Scope" (shown only for install-only):
  - Preset chips with a "Custom" indicator.
  - setGenerator checkbox, ATS radio (3), conduit radio (3), runFt input (shown unless existing).
  - Locked rows for "Connect gen to ATS — always included" and "Startup — always included".
  - pad, battery and stand nested under setGen.
  - Permit and gas checkboxes, plus a `unitDesc` input.
- Hide Generator Cost, Extended Warranty, Extra Wire and the swap fields.
- Relabel Labor as "Additional Labor".
- Install-only banner, like the swap one at `:373`.
- Summary panel: drop the Generator row, add the io rows.
- Skip the benchmark flag for install-only.
- `persist()` returns null with a toast when `installOnlyIssues` is non-empty. The Preview button is disabled with the same issues.
- The `addons` count is unchanged.
- Acceptance (manual): switching types round-trips without stale fields; presets set the checkboxes; unchecking setGen clears pad, stand and lift.

**Task 3: Proposal document.** Files: `ProposalPreview.tsx` (on top of Task 0), `ProposalPreview.test.tsx`.
- Install-only branches for: subtitle, intro, scope rows built from checked items (section 4), warranty row, permit row (replacing the always-on "Permit Fees & Sales Tax Included"), gas row, "Not Included" row.
- Breakdown: no generator row; io rows non-taxable; APT ATS taxable; tax note text.
- Hide the spec sheet.
- Add Clause 28 only for install-only. Disclosures permit sentence becomes conditional.
- Keep every other type pixel-identical.
- Tests, per preset plus each ATS and conduit mode:
  - Correct rows present and absent.
  - "Startup & Commissioning" is always present.
  - The "Customer-Furnished" text is present.
  - No generator price row.
  - Clause 28 present only for install-only.
  - The permit-not-included wording.
  - New-install and swap renders unchanged (existing tests keep passing).

**Task 4: Backend.** Files: `backend/src/routes/gens.ts`, `backend/src/utils/publicFormData.ts`, tests in `backend/src/test/`.
- **`publicFormData.ts` `GEN_FORM_KEYS`: add `'installOnly'`.** This is critical. Without it the public e-sign page migrates to the default scope and shows the customer the wrong scope. Update the header comment list.
- `ADDON_P`: io mirror constants.
- `calcFormTotals`: io branch matching Task 1. Inside it, use `Number.isFinite` instead of `|| default` for labor and permit, so a deliberate 0 stays 0.
- Build-from-notes:
  - Prompt: add `"install-only"` with a description ("customer supplies generator; set/ATS/conduit variations") and the `installOnly` object schema.
  - `extractFormFromNotes`: battery forced true **only** for `new-install` (fix `:985`). Add `normalizeInstallOnly()`: whitelist the enums, coerce runFt, force `genPriceOverride=null` and `extWarranty='none'`, apply the setGen dependency, and default labor to 0 and permit to the io default.
- Benchmark SQL: `AND COALESCE(form_data->>'jobType','') <> 'install-only'`.
- Kickoff email:
  - Subject "New {brand} Install-Only (customer-furnished) - {customer}".
  - Lines listing setGen, ATS mode, conduit mode and ft, gas by others, and permit.
- Send fallback subject: "Generator Installation Proposal" for install-only.
- Tests:
  - Projection keeps `installOnly` (extend `gensPublicFormDataProjection.test.ts`).
  - Kickoff email for install-only (extend `gens.kickoff.test.ts`).
  - Unit tests for `calcFormTotals` (export it or move it to `utils/genTotals.ts`) with a **parity fixture**: the same 4 preset forms with expected totals asserted in both the frontend and backend suites.
  - `normalizeInstallOnly` sanitization.
  - Benchmark excludes install-only (if a DB test harness exists for that route; otherwise test the SQL builder).
- Acceptance: `cd backend && npm test && npm run typecheck`.

**Task 5: Lead survey.** Files: `LeadSiteSurvey.tsx`, `surveyMap.ts`, `backend/src/routes/leads.ts`, and the related tests.
- Add an "Install Only" OptionButton and widen both `LeadSurvey.jobType` unions.
- Mapping passes it through. gasLine and removal stay swap-only.
- Optional: an Install-Only Details step (ATS existing? conduit existing? runFt) mapped to `installOnly`. Recommended as a follow-up; v1 relies on Task 2's `genToForm` defaults.
- Tests: the mapping on both sides; the wizard shows three options.

**Task 6: Pipeline and send polish.** Files: `GenPipelinePage.tsx`, `SendProposalModal.tsx` / `BuilderPage.tsx:737`.
- Small "Install Only" tag on the card, read from `form_data.jobType` with a safe parse.
- Default email subject for install-only.
- Acceptance: visual check; existing pipeline tests pass.

Order: 0 → 1 → (2, 3, 4 in parallel once Task 1's types land) → 5 → 6. **Do not deploy until Jake fills in the price table and approves the wording.** The placeholders must not reach customers.

---

## 6. Risks

- **Public whitelist omission:** customers would sign a document showing the wrong scope. Task 4 is a must-fix.
- **Backend `|| default` calc** would turn $0 labor or permit into $3,000 / $1,250 on AI-built install-only proposals.
- **Lead-converted partial `form_data`** inherits `blankGenForm` labor of $3,000 unless `genToForm` applies install-only defaults.
- **Legal text:** the existing agreement sells and secures a generator APT isn't selling. Clause 28 needs Jake's and ideally counsel's approval.
- **Frontend/backend calc drift:** it already exists; mitigate with the shared parity fixture.
- **Benchmark pollution** if the exclusion is missed in the SQL or the UI.
- **Retroactive pricing:** prices are constants, so changing a placeholder changes re-opened drafts (same as today's add-ons). Sent and signed proposals use stored `totals_data`, so they're safe.
- **Tax treatment** of conduit and wire material: following precedent, but needs confirmation.
- **The uncommitted ProposalPreview refactor** could be lost or conflict if the builder resets the file.

## 7. Reviewer focus (Opus)

1. New-install and swap-out totals and renders are unchanged. Check the snapshot tests and diff `calcGenTotals` for any shared-path edits.
2. `installOnly` is in `GEN_FORM_KEYS`. The public page renders the stored scope, not migrated defaults.
3. The backend `calcFormTotals` io branch equals the frontend on the parity fixture. A 0 labor or permit stays 0.
4. Startup and connect can't be removed via UI, AI or migration. Validation blocks a missing runFt.
5. Clause 28 and the warranty/permit wording render only for install-only and match Jake-approved text verbatim. Placeholder prices are flagged and not shipped.
6. The Task 0 commit preserved `buildPdf` / Download PDF exactly.

### Critical Files for Implementation
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/builder/genCalc.ts
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/builder/BuilderPage.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/builder/ProposalPreview.tsx
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/routes/gens.ts
- /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/utils/publicFormData.ts
- (also) /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/builder/genData.ts, /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/backend/src/routes/leads.ts, /Users/jakesalverda/Programs & Projects/APT Electrical CRM/Local Version/frontend/src/features/leads/surveyMap.ts