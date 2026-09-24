# AI Takeoff Accuracy: Counting Stage, Account Rules, Output Gates

**Date:** 2026-09-23
**Status:** Approved by Jake ("go"), pending implementation
**Planned by:** Opus 5.5 (main session) · **Execution:** Sonnet 5 · **Review:** Opus 5 (adversarial) → main session verdict
**Depends on:** local main `0b896bb` (Phase A + Phase B merged)

## Why

A real bid — AutoZone #10077 Kissimmee FL (Summit GC) — was run through the AI
takeoff and audited against the drawings. Service/distribution, equipment,
ceiling fans, power poles and site pole counts were right. Interior lighting
came back **0 for every type on E-3** (audited: A 73, B 52, M 6, C 2, G 11,
exit/emergency E/F/K/J 24 = 168 fixtures, most of the job's labor), devices 0
(~38 receptacles carried), wall packs double-counted and wrong (8 vs 5 type D,
no type L), site lights double-counted (poles S1×2 + S2×1 = 3 poles / 4 heads,
then a separate "4 site lights" from E-7 stacked on top). Scope errors read as
confident: lighting "by us through Southern Lighting Source" (AutoZone = owner
furnishes all fixtures via Graybar), service "furnish and install service
entrance assembly and MDP" (no MDP; AutoZone furnishes disconnects/panels),
"install AutoZone-furnished power poles" (E-2: GC furnishes, installs and
hard-wires), GC pulled as the owner (AutoZone Stores LLC) instead of Summit
General Contractors, utility marked VERIFIED while flagged not found, RFIs and
"field verify … 0 LF" allowances in output. Agent 3 (QA) caught it and said
"Do not submit" — the end gate works; the pipeline doesn't count.

Root causes confirmed in code (main session, 2026-09-23):

- **No counting step.** Agent 1 does everything in one pass; no prompt says
  "count every symbol of these types on this sheet."
- **Plan sheets are sent too coarse to count.** `ai/documentPrep.ts` class
  targets: `plan` = 16" tiles, DPI 130 → ~98 px/in after the API's 1568 px
  downscale. Schedules get 8" tiles (~196 px/in), which is why schedule data
  came through. The Sep-2 fidelity work assumed counting needs less
  resolution than reading text — Kissimmee disproves it.
- **Southern Lighting Source is hard-coded** in `ai/prompts.ts` (~115, 130,
  252) with national-account overrides only as prose.
- **"Missing sheets" never checked** against the loaded inventory; **zero
  quantities pass** as ASSUMED; **GC comes from the AI**; banned language
  leaks through allowances; **no truncation detection** (`stop_reason ===
  'max_tokens'` is only logged).

## Decisions (made; do not relitigate)

1. **New dedicated Counting stage ("Agent 1C")** after Agent 1, before Agent 2,
   default model **`claude-opus-5-5`** (setting `ai_takeoff_counter_model`,
   editable in Settings → AI like the other agents; max tokens setting too).
2. **Works for every project type**, not just national accounts. The list of
   types to count is built from, in order: luminaire/fixture schedule, device
   & symbol legend (E0.x / legend blocks), equipment/connection schedule (car
   washes, C-stores: equipment connections, disconnects), panel schedule
   circuit descriptions (fallback). Car wash / self-storage / office / etc.
   all flow through the same stage.
3. **Counting images:** each electrical **plan**-class sheet rendered at
   **300 DPI** and cut into overlapping tiles small enough to land at
   ≥ 190 px/in after the 1568 px downscale (≈ 8" tiles, ≥ 1" overlap). Title
   block strip excluded. One Opus call per sheet (all its tiles + the type
   list with each type's schedule description and symbol description), or
   per tile-group if a sheet exceeds the per-call image budget — executor
   picks and justifies.
4. **Counts come back with locations.** For every counted symbol: type,
   tile id, and position within the tile (normalized 0–1). Code converts to
   sheet coordinates in **PDF points** (same space as Phase B markups, origin
   and rotation aware — reuse Phase B's geometry), and **de-duplicates the
   overlap bands** (same type within a small radius → one). The locations are
   stored and shown in Phase B's Plans view as **suggested markers** ("AI"
   badge) the estimator confirms — they never roll into Apply until
   confirmed, exactly like text-tag suggestions.
5. **Cross-check:** where the panel schedule lists lighting circuits with
   loads and the fixture schedule gives wattages, compare counted load to
   circuit load per panel; > 20% gap → a flagged discrepancy (not a block).
6. **Zero-count gate:** any type on the schedule/legend whose final count is
   0 (or unreadable) puts the takeoff in **Needs review** — Agent 4 /
   proposal generation / send are blocked until the estimator either enters
   a count, confirms markers, or marks the type "Not on this job" (reason
   required). Never ASSUMED.
7. **Cross-sheet de-dup by fixture type:** one takeoff line per type;
   photometric (PH*), site-lighting-calc, and schedule sheets are never
   counted; exterior site fixtures counted only on the site electrical sheet;
   building-mounted exterior fixtures only on the building plan; **poles and
   heads are separate lines** (S1 ×2 + S2 ×1 = 3 poles, heads per schedule).
   A type counted on two plan sheets that depict the same area (enlarged
   plans) → flagged, larger count kept, not summed.
8. **Account rules** (table + Settings UI, admin-edit), matched by bid
   brand/owner (case-insensitive aliases) **and** optionally by project type.
   Rules carry: lighting furnish-by + vendor/contact, panels/disconnects
   furnish-by, power poles furnish/install-by, other equipment furnish-by,
   required scope bullets, forbidden phrases. Injected into Agent 2/4 prompts
   **and enforced deterministically after Agent 4** (scope text + takeoff
   `furnish_by` corrected/flagged; forbidden phrases blocked by verifyBid).
   Seed:
   - **Default** (no match): lighting ECFECI via Southern Lighting Source
     (770-242-4000) — moved out of the prompt text into this rule.
   - **AutoZone** (applies to every AutoZone — Jake, 2026-09-23): all
     fixtures owner-furnished via Graybar national account, EC receives and
     installs; disconnects & panels furnished by AutoZone, EC installs;
     power poles furnished, installed and hard-wired by GC (EC scope: none
     beyond what drawings assign); no MDP language unless an MDP is on the
     drawings.
   - **7-Eleven**: Graybar national account (Anson Sauce, 817-475-0178,
     7-eleven.national@graybar.com), furnish by GC / install by EC — copy
     exact terms from `~/.claude/skills/apt-electrical-bid/PROJECT_INSTRUCTIONS.md`
     (~19–23, 372–382).
   Project-type rules (car wash, etc.) start empty; Jake fills them in.
9. **Output hygiene (deterministic, not prompt-only):**
   - GC = the bid record's `gc`; the AI's GC/owner extraction goes to
     separate `owner` / `gc_extracted` fields, mismatch flagged, never
     overwrites.
   - "Missing sheets" filtered against the loaded sheet inventory
     (normalized sheet numbers); removed ones logged.
   - A value flagged not-found can never be VERIFIED/FIRM (downgrade + flag).
   - Square footage: keep extracted value + source note; if two different
     values are found, flag both.
   - verifyBid blocks RFI language, "field verify", "verify in field", "TBD",
     "±", and zero-quantity allowances in anything GC-facing (proposal docx,
     GC takeoff xlsx, send). RFIs remain in the internal RFI tab only.
   - Every agent call: `stop_reason === 'max_tokens'` → the run fails with
     "Agent N ran out of room — raise its Max Tokens" (no silent truncation).
10. **Eval harness:** `backend/scripts/evalTakeoff.ts` runs the full pipeline
    on a local PDF path + expected-counts JSON and prints a per-type diff and
    the run's token cost. Expected file for Kissimmee committed at
    `backend/eval/autozone-10077-kissimmee.expected.json` (counts above). The
    PDF itself is NOT committed (33 MB, client document) — the script takes
    its path. **The executor never runs it against the real API**; the main
    session runs it with Jake's OK.

## Out of scope

Conduit/wire footage from AI (stays with Phase B's measuring tool), symbol
detection by image matching (Phase C), Intake, Leads, Generators.

## Environment facts

- Pipeline: `routes/preconstruction.ts` (`/analyze`, Agent 1 ~574/612, Agent 2
  ~691, Agent 3 ~739, Agent 4 ~1706), `ai/documentPrep.ts` (pdftoppm tiling,
  class configs ~128–150), `ai/pageClassifier.ts` (sheet identity/class),
  `ai/agent1Batching.ts`, `ai/mergeAgent1.ts`, `ai/agent3CrossCheck.ts`,
  `ai/prompts.ts`, `bidstd/verifyBid.ts`, `bidstd/composeBidData.ts`.
- Phase B geometry: `frontend/src/features/estimating/plans/overlay.ts`
  (origin-aware `pdfToRenderMatrixWithOrigin`) — port the pure point math to a
  shared backend module rather than re-deriving it. Markups: `est_markups`
  (`status 'suggested'`), `est_sheets`.
- `pdftoppm` is installed locally (`/opt/homebrew/bin/pdftoppm`).
- Settings keys follow `ai_takeoff_agentN_model` / `ai_max_tokens_agentN`.
  Anthropic key is in app_settings — never log it, never print it.
- Migrations: main at **111**; this plan owns **112–115**.
- Known flakes: backend `notificationsRetention`, `intakeSimilarCache`
  (worker crash/timeout); frontend `SurveyMarkupEditor`.

## Ground rules (permanent)

- Worktree only, from Local Version:
  `git worktree add "../Electrical-program-wt-takeoff-accuracy" -b feat/takeoff-accuracy main`.
  Never edit Local Version. Never start dev servers. Tests via `npm test`
  only (backend → electrical_crm_test). No real Anthropic/Drive calls in
  tests — mock the client; record realistic fixture responses. No email. No
  push. **Do not use the Agent tool (no forks/subagents) for any purpose.**
- First commit: this plan. One commit per task, message ending
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Commit working
  pieces early (usage limits happen).
- Tests use REAL shapes: real Agent 1/2/4 output structure (see existing
  fixtures), real pdftoppm on a committed small vector test PDF with a
  fixture schedule and symbols.
- Report: `docs/superpowers/plans/2026-09-23-takeoff-accuracy-report.md`.

## Tasks

1. **Truncation detection + settings** — max_tokens detection on every agent
   call (incl. classifier); `ai_takeoff_counter_model` (default
   claude-opus-5-5) + `ai_max_tokens_counter` in settings allowlist + Settings
   → AI UI. Tests.
2. **Type list builder** (pure where possible): from Agent 1 output (fixture
   schedule, legend, equipment schedule, panel circuits) → `CountTarget[]`
   {type, description, symbol hint, wattage?, category}. Tests on real Agent 1
   fixture JSON, incl. a car-wash-style equipment schedule.
3. **Counting renderer**: 300 DPI plan-sheet rasters → overlapping tiles
   (tile geometry pure + tested; title block excluded; page origin/rotation
   aware), JPEG encoding within per-image limits.
4. **Counter agent**: prompt + call per sheet/tile-group with Opus 5.5;
   strict JSON (per symbol: type, tile, x, y normalized); robust parse;
   retries via existing `ai/retry.ts`; sanitize via `sanitizeForPrompt`.
   Overlap de-dup + tile→PDF-point conversion (pure, tested). Parallelism
   bounded (≤ 3 concurrent calls).
5. **Merge into takeoff**: counts replace Agent 1's counts for counted types;
   cross-sheet de-dup rules (Decision 7); poles vs heads; load cross-check
   (Decision 5). Stored with the takeoff result (migration) so Agent 2/4 and
   the UI read it. Tests with a Kissimmee-shaped fixture (PH0.1 + E-3 + E-7
   wall packs/site lights) proving no stacking.
6. **AI suggested markers**: counted locations written as `est_markups`
   `status='suggested'`, `source='ai_count'` (migration), line_key assigned
   when the type maps to a saved line (else unassigned). Plans view shows them
   with an "AI" badge; Confirm all / reject per sheet reuse Phase B UI. Never
   roll up unconfirmed.
7. **Zero-count gate**: Needs-review state, UI in Takeoff step to resolve each
   zero type (count / confirm markers / Not on this job + reason), gate on
   Agent 4, proposal docx, send. Tests.
8. **Account rules**: table (migration), seed (Default, AutoZone, 7-Eleven),
   matcher (brand/owner aliases + project type), prompt injection (remove the
   hard-coded Southern Lighting text from prompts.ts; render from the matched
   rule), deterministic post-Agent-4 enforcement, Settings UI. Tests incl. the
   exact Kissimmee scope errors being corrected/blocked.
9. **Output hygiene** (Decision 9 bullets). Tests for each Kissimmee error.
10. **Eval harness** (Decision 10) + expected JSON. Unit-test the diff logic;
    do not run against the real API.

## Review & merge

Opus adversarial review → fixes → main-session spot-check → Jake approves
merge → main session runs the Kissimmee eval with Jake's OK and reports the
per-type diff and cost.
