# Gap analysis: CRM vs Chris (Accubid), Kissimmee and 36th Street. 2026-09-30

Read-only analysis on `feat/accuracy-pricing` (worktree `Electrical-program-wt-accuracy-p`, HEAD 3591cd0). No source edits, no DB, no model calls.

## Where the numbers come from

- **CRM figures.** Every CRM figure is the replay harness (`src/eval/replayEval.ts` `replayPricing`), run read-only by a scratch tsx script with `detail: true`. It uses the same options as `replayEval.test.ts:46-55`.
  - Kissimmee **SCRIPTED projected@due-fresh**: $85,294.44 / 697.90 h / material $33,109.58. "Automatic" is $81,535 / 660.1 h.
  - 36th **projected@due-fresh**: $21,357.35 / 167.54 h / material $4,536.59.
  - Both reproduce P's report exactly.
- **Chris figures.** Chris's rows are `parseAccubidBom` on `backend/src/test/fixtures/estimating/accubid/{kissimmee,36th-street}-bom.txt`. They parse with 0 warnings, and their footers match: Kissimmee $25,842.56 / 798.949 h, 36th $3,399.32 / 189.21 h.
- **Grouping.** Both sides are grouped by `estimating/hoursGroups.ts` (`classifyBomRow` / `classifyCrmLine`).
- **Recaps.** Every recap figure comes from `accubidRecapFrom`, using the bids' exported `pricingContext`:
  - Kissimmee: 1J $37 + 2A $27, 4% burden, $1.50 fringe, labor OH 38%, markup 20/20, no tax.
  - Chris's own Kissimmee job settings are in `accubidRecap.test.ts:104-122`: J $39, OH 18%, markup 22/22, adjustment 1%.
- **Marginal rates.** At the CRM's Kissimmee settings, **1 h = $54.6 selling** and **$1 material = $1.20 selling**. Every "$" below uses these rates.
- **Pending R.** Everything that depends on Builder R (site poles 6→3 / heads 10→4, power-pole hosts 2→6) is labeled **(after R)**.

---

## 1. Why Kissimmee's price is already ≥ Chris while hours are 101 h short

The selling price looks close because of two errors pulling in opposite directions. It is not close on substance.

| Recap scenario (accubidRecapFrom) | Material | Hours | Selling |
|---|---|---|---|
| A. CRM SCRIPTED as-is (CRM settings, equipment $4,350, GE $3,020) | $33,110 | 697.9 | **$85,294** |
| B. A minus AutoZone-furnished fixtures ($20,818) and panels ($2,900) | $9,392 | 697.9 | **$56,833** |
| C. **Chris's own inputs under the CRM's settings** (GE $3,770) | $25,843 | 798.9 | **$82,854** (GE $3,020: $82,104) |
| D. Chris's inputs, Chris's settings (check) | $25,843 | 798.9 | $79,112 ✓ |
| E. CRM inputs, Chris's settings | $33,110 | 697.9 | $82,345 |

1. **The CRM prices material the owner furnishes: $23,718, which is $28.5k selling.**
   - What Agent 1 already extracted (`agent1.furnishStatements`, kissimmee-live-2026-09-30.json):
     - "16500 LIGHTING (AutoZone Furnished Contractor Installed)";
     - "16480 PANELBOARDS (AutoZone Furnished Contractor Installed)";
     - "ITEMS FURNISHED BY AUTOZONE: A. FUSED DISCONNECTS B. PANELBOARDS C. CIRCUIT BREAKERS D. ALL LIGHT FIXTURES … K. SITE LIGHT POLES AND BRACKETS";
     - "PANEL A AUTOZONE PROVIDED" (E-4).
   - Chris carries every fixture, pole and panel row as `Quoted` with **no material**. Examples:
     - "4' Luminaire Linear Wraparound … 133 E … 0.750 99.750 Quoted";
     - "225A 42-Circuit … Panelboard … 2 E … Quoted".
   - Chris's recap has **no quotes**. So AutoZone's furnished material is simply not in his price.
   - The CRM carries:
     - interior fixtures $9,155;
     - site / exterior fixtures and poles $11,205;
     - per-fixture support hardware $458;
     - `PNL-225` 2 × $1,450.
   - This alone is +$28.5k of selling price.
2. **Without that material, the CRM is short on everything else: −$16.4k of material and −101 h.**
   - Scenario B gives $56.8k against Chris's $79.1k (−28%). This is the true gap.
   - The rows behind it are in §2 and §4.
3. **The CRM's settings price Chris's own estimate 4.7% above Chris.**
   - Scenario C gives $82,854 against $79,112. The CRM uses OH 38% / markup 20%. Chris's job used OH 18% / markup 22% / adjustment 1% with a $39 journeyman.
   - Jake's standing rule is 38 / 20 / 18 from 2025–26, so this is not a defect.
   - **The target for "CRM inputs = Chris inputs" at the CRM's settings is therefore about $82.9k, not $79.1k.** Measure accuracy on material + hours, not on selling price.
4. **Equipment and GE.**
   - Equipment matches ($4,350).
   - GE is $3,020 against $3,770. The missing $750 is Chris's camera pole. P calls it AutoZone-specific, but the spec makes it derivable: furnish statement "OxBlue camera support and mounting | Contractor … providing the support structure for the camera". The scope note is "Ground-up: 2 OxBlue cameras, contractor mounts". A GE rule keyed on OxBlue / construction-camera support gets the $750.
5. **Unit prices.** The library's wire and conduit prices are 40–65% of Chris's 2026 net costs (§5). This understates the CRM's real-scope material further.

**36th Street has the same pattern, but it hides a double count.**
- Library fixture material is $3,005 (troffers $1,330 + $170, exit $285, cans $440, H strips $780) plus $100 of per-fixture hardware.
- The bid *also* carries the quote "materials. vendor" $4,470 (budget_pending, 18% markup), and `fixturePackageQuoted` is false. Chris's two lighting quotes total exactly $4,466.72 with tax and his 10% markup (1965 + 1830 = 3795 × 1.07 × 1.10).
- So the fixtures are priced twice.
- Without the library fixture material, the CRM's 36th price is **$17,631** (−24% vs $23,230), not $21,357.
- Chris's own inputs under the CRM's settings give $20,904 (−10%). On this job Chris used OH 70% / markup 15% / 7% tax / 1% sales markup.
- The $4,470 quote is already Chris's taxed and marked-up figure. The CRM's 18% then adds $805 on top.

---

## 2. Hours by BOM group (one classifier for both sides)

### Kissimmee: CRM SCRIPTED vs Chris

| Group | CRM h | CRM $ | Chris h | Chris $ | Gap h |
|---|---|---|---|---|---|
| feeders | 20.7 | 830 | 79.6 | 5,351 | **+59.0** |
| service gear | 19.3 | 2,912 | 42.0 | 2,733 | **+22.7** |
| equipment connections | 22.7 | 1,634 | 40.8 | 5,625 | **+18.2** |
| misc | 1.5 | 44 | 16.0 | 1,500 | **+14.5** |
| site / underground | 35.3 | 918 | 44.6 | 480 | +9.3 |
| controls | 6.3 | 180 | 14.6 | 1,030 | +8.3 |
| fittings | 52.1 | 355 | 59.9 | 316 | +7.9 |
| splices | 59.4 | 167 | 66.9 | 414 | +7.5 |
| wire & MC | 82.2 | 2,046 | 87.3 | 4,138 | +5.1 |
| hardware | 86.7 | 874 | 87.9 | 1,339 | +1.2 |
| boxes & rings | 36.9 | 444 | 35.7 | 473 | −1.2 |
| branch conduit | 61.5 | 923 | 52.8 | 1,605 | −8.7 |
| fixtures | 170.3 | **20,818** | 161.4 | **0** | −8.9 |
| devices | 43.2 | 964 | 9.4 | 837 | **−33.8** |
| **Total** | **697.9** | **33,110** | **798.9** | **25,843** | **+101.0** |

**The branch-wiring allowance is effectively right.**
- conduit + fittings + hardware: 200.3 h vs 200.6;
- boxes: 36.9 vs 35.7;
- splices: 59.4 vs 66.9.

**The 101 h sits in five places:**
- the service and feeders;
- service gear;
- power poles and fans;
- site PVC;
- Chris's misc lump.

It is partly offset by the receptacle double count (devices) and the pole double count (fixtures, until R lands).

**A classifier note for the eval.** The CRM's service lateral (2" PVC 58 LF 4.35 h + #3/0 232 LF 3.83 h) sits in the *Site / Underground* bucket, because `hoursGroups.ts:52` returns 'site / underground' from the category hint before the size rule runs. Chris's 2" PVC sits in *feeders*, by the ≥1-1/4" rule at `hoursGroups.ts:72`. So the bucket table overstates the Feeders gap and understates the Site gap by 8.2 h.

### 36th Street

| Group | CRM h | Chris h | Gap |
|---|---|---|---|
| branch conduit | 17.7 | 30.6 | **+12.9** |
| fixtures | 28.1 | 35.1 | +7.0 |
| wire & MC | 21.1 | 25.7 | +4.6 |
| hardware | 20.3 | 24.0 | +3.7 |
| feeders | 0 | 3.0 | +3.0 |
| fittings | 11.9 | 13.9 | +1.9 |
| controls | 0 | 1.65 | +1.6 |
| boxes & rings | 12.7 | 12.9 | +0.2 |
| devices | 6.0 | 4.9 | −1.0 |
| splices | 18.1 | 15.2 | −2.9 |
| equipment connections | 4.1 | 0 | −4.1 |
| demolition | 27.5 | 22.2 | −5.3 |
| **Total** | **167.5** | **189.2** | **+21.7** |

---

## 3. Line-by-line mapping, Kissimmee (every Chris BOM row → the CRM row that should carry it)

Units: Chris's "LU" is h per unit; C = per 100 ft, M = per 1,000 ft. The CRM unit is the line's h / qty. The cause codes are:
- **CNT** counting;
- **RAT** allowance ratio;
- **SCOPE** missing scope;
- **GEO** routing geometry;
- **UNIT** labor unit;
- **MAP** wrong mapping;
- **PAD** Chris's allowance / spares;
- **OF** owner-furnished.

### 3.1 Feeders and service (Chris 79.6 h; CRM 20.7 h Feeders + 8.2 h lateral in Site)

| Chris row | Chris qty × LU = h | CRM row(s) | CRM qty × unit = h | Cause |
|---|---|---|---|---|
| 2" Conduit – PVC 40 (adj +25%) | 474 ft × 6.8/C ×1.25 = 40.29 | "2" PVC Sch 40, underground (incl. fittings/glue)" `PVC-200` (lateral) + "2" EMT (incl. couplings/straps)" (meter→wireway, discon→panel) | 58 ft × 7.5/C = 4.35; 49 ft × 8.5/C = 4.17 | GEO + SCOPE + UNIT (see §3.1a) |
| 2" Elbow 90 PVC (adj +25%) | 22 × 0.40 ×1.25 = 11.0 | in `PVC-200` "incl. fittings" + `ALW-FIT-PVC` 1.2/C | — | UNIT (CRM 2" PVC system 8.7 h/C vs Chris 12.1 h/C) |
| 2" Coupling / Locknut / Male adapter | 22 each: 0.70 + 1.50 + 3.96 | same | — | UNIT |
| #3/0 Black THHN | 872 ft × 18.8/M = 16.39 | "#3/0 THHN/THWN" `THHN-3_0` | 428 ft × 16.5/M = 7.07 | GEO (lateral, feeders) + UNIT 16.5 vs 18.8 |
| #6 Black THHN | 498 × 8.9/M = 4.43 | `THHN-6` (RTU-1/RTU-2 3#6) | 588 × 7.0/M = 4.1 | GEO (RTU-1 121 ft, RTU-2 75 ft) + UNIT 7.0 vs 8.9 |
| #6 Green THHN | 66 × 8.9/M = 0.59 | `THHN-6` (discon→panel #6G) | 27 × 7.0/M = 0.19 | GEO (16 / 11 ft vs ~33 ft each) |
| 2" 2-Piece Strut Clamp | 8.8 C × 8.6 = 0.76 | in `EMT-200` | — | — |
| (RTU #10 G, raceway) | in Chris's 3/4" EMT / #10 rows | 3/4" EMT 196 ft × 4.0/C = 7.84; #10 196 = 1.1 | — | — |

#### 3.1a Reconciling Chris's #3/0 872 LF and 2" PVC 474 LF

The E-4 "Schematic One Line – Electrical Service" (detail 2/E-4, read off the local PDF page 52) has four segments:

| Segment | One-line text | Conductors |
|---|---|---|
| XFMR → meter base | "PARALLEL (2)4#3/0, 2"C" | 8 |
| meter base → wireway | "PARALLEL (2)4#3/0, 2"C" | 8 |
| wireway → each 200A switch | "4#3/0, 2"C" ×2 | 4 + 4 |
| switch → Panel A / B | "4#3/0, #6G, 2"C" ×2 | 4 + 4 + 2 #6 G |

Working from Chris's BOM:
- His only #6 green is 66 ft. That has to be the two switch→panel grounds, so **~33 ft per feeder**. It also cleanly equals 60 × 1.10, the only BOM wire quantity that fits a 1.10 multiplier: 498, 872 and the MC quantities do not.
- His feeders therefore carry 8 × 33 = **264 LF #3/0**.
- The remainder is 872 − 264 = **608 = 8 × 76 ft**. So lateral + meter→wireway + taps ≈ 76 ft per conductor.
- With meter→wireway at ~11 ft (the CRM's own estimate) and taps of ~5 ft, **Chris's lateral is ≈ 60 ft per conductor.**
- **The 2" PVC cannot all carry #3/0.** 872 / 474 = 1.84 conductor-ft per conduit-ft, but every service / feeder conduit carries 4.
  - The #3/0 runs explain at most 2 × 60 + 2 × 11 + 2 × 33 ≈ 208 ft of 2" conduit.
  - **About 266 ft of 2" PVC is conduit with no #3/0 in it.**
  - The BOM cannot say what that is. Candidates from the drawings:
    - the "TWO 4" DIA. CONDUIT" the C4.1 Utility Service Note gives the GC ("POWER CO. TO PROVIDE UNDERGROUND 120/208/3 PHASE SERVICE. GENERAL CONTRACTOR TO PROVIDE AND INSTALL TWO 4" DIA. CONDUIT W/ SECONDARY WIRE TO UTILITY COMPANY POINT OF CONNECTION"), priced as 2";
    - the Duke primary along the "E" line, which runs from the pad south and then east along the south property line (C4.1);
    - the telephone service conduit to the telco pedestal (scope notes "UG telephone service conduit to telco pedestal/pole", "PVC phone service entrance stub up").
  - The 22 elbows / 22 male adapters / 22 locknuts mean ≈ 11 conduit runs with 2 ends each. The 4 service / feeder runs account for only ~8–12 elbows.
- **The CRM's 428 LF** is:
  - lateral 29 ft × 8 = 232;
  - meter→wireway 11 ft × 8 = 88 (2 sets, already correct: 22 ft of 2" EMT);
  - feeders 16 × 4 + 11 × 4 = 108;
  - taps 0 (`feederGraph.ts:160`, wireway→discon are "taps").
- **The transformer geometry is real.** On C4.1 the pad is ~10 ft off the west wall: pin (584.6, 1082) against the building face at x≈619 pt × 0.2776 ft/pt. So 29 ft is a defensible *geometric* lateral, and Chris's ~60 ft is his routing / makeup, or a different meter location.
- Conclusion:
  - **fixable without Chris:** feeders and taps, +196 LF #3/0;
  - **judgment:** the lateral (+248 LF #3/0, +62 ft PVC) and the 266 ft of empty 2" (≈ 31 h at Chris's 12.1 h/C).

### 3.2 Service gear (Chris 42.0 h; CRM 19.3 h)

| Chris row | Chris | CRM row | CRM | Cause |
|---|---|---|---|---|
| 225A 42-Circuit Panelboard MLO (Quoted, no material) | 2 × 3.6 = 7.2 h, $0 | "Panels A & B, 10kAIC" → `PNL-225` | 2 × **8.0** = 16.0 h, **$2,900** | UNIT (8.0 vs 3.6) + OF |
| 200A Safety Switch Fusible NEMA 1 | 2 × 3.1 = 6.2 h, $254.54 | "200A fused switch NEMA 3R" → 200A fusible assembly (mig 158) | **qty 0** "COUNT PENDING ESTIMATOR REVIEW" | CNT (schedule says "(TYP OF 2)"; not a mark target) |
| 200A Fuse RK5 | 6 × 0.1 = 0.6 h, $370.32 | inside that assembly | 0 | CNT |
| 200A Meter Socket (Quoted) | 1 × 1.5 h | "MB — Meter base NEMA 3R … (connection)" → Meter base / CT cabinet | **qty 0** pending | CNT |
| Polaris Taps | 8 × 1.2 = 9.6 h, $360 | — (taps are listed in `feederGraph` but priced nowhere) | — | SCOPE |
| Service Gutter | 1 × 6 = 6 h, $600 | "Wireway NEMA 3R 12x12" | 1 EA, **no_unit hold** | MAP / no unit |
| Grounding Materials | 1 × 6 = 6 h, $890 | "Ground rod, building steel, water pipe, 20' Ufer" 1 LS; "Concrete-encased electrode #2 CU" 20 LF | **unit_unknown / no_unit holds** | MAP / no unit |
| Fire Rated Playwood | 1 × 4 = 4 h, $250 | "3/4" FRT plywood backboard" (Low Voltage) | **no_unit hold** | MAP / no unit |
| #6 Wire Lug Compression | 6 × 0.15 = 0.9 h | — | — | SCOPE (small) |
| — | — | "Phone ground bus to MGB" bonding jumper | 0.3 h | (CRM only) |

**The fix for this group is mostly giving holds a unit.** The DISCON / meter rows are a counting gap: the gear is on the one-line, not on a plan.

### 3.3 Equipment connections and devices (Chris 40.8 + 9.4 h; CRM 22.7 + 43.2 h)

| Chris row | Chris | CRM row(s) | CRM | Cause |
|---|---|---|---|---|
| Power Poles | 8 × 3.5 = **28.0 h, $5,200** | "PP-1..6 — Power pole circuits (connection)" → power pole set-and-wire | 2 × 3.5 = 7.0 h, $1,300 | CNT (host 2 → 6 after R's B) |
| — | — | "PP-1..6 — Power poles #1 office, #2 checkout, #3 parts pod (2), #4 tester, #6 commercial counter; #5 PVC data/security pipes …" → `RISER-PIPEPOLE` | 2 × 1.5 = 3.0 h | **MAP: the same six poles as the host row.** After R it becomes 6 × 1.5 = 9 h, a double count |
| (part of the 8?) | | "3" PVC data/security pipes at pole #5" → `RISER-PIPEPOLE` | 2 × 1.5 = 3.0 h | judgment (Chris's 8 = 6 + 2?) |
| Hang Fans | 3 × 2.5 = **7.5 h**, $195 | "Ceiling fan (CF)", "CF1-CF3 — Ceiling fans …", "FSC — Ceiling fan speed controls" → all three on Ceiling fan hang | **qty 0** (pending) | CNT; and **MAP risk**: once counted, 3 rows × 3 = a triple count; FSC is a control device |
| 60A Safety Switch NF 3R | 2 × 1.55 = 3.1 h, $229.88 | "RTU disconnects" → DISC-60 | 2 × 1.55 = 3.1 h, $290 | ✓ (material $145 vs $114.94) |
| #6 Motor Termination | 2 × 1.12 = 2.24 h | "60/3, Panel B ckt 1,3,5 …" / "ckt 2,4,6" → #6 termination | 2 × 1.12 = 2.24 h | ✓ |
| — (none) | 0 | ≤#10 terminations: WH, MINI-TUNE, DF, ALC 0.72 each; SIGNS 3 × 0.72; Exhaust fan 2 × 0.72; Lighting contactors 6 × 0.72 (in Lighting Controls) | **10.80 h** | judgment: Chris carries none |
| Duplex 20A | 11 × 0.20 = 2.2 h | "Duplex / floor receptacle" ×8, "A-37 (4), A-39 (1) …" ×5, "Duplex receptacle landscape control" ×1, "Weatherproof duplex GFI" ×4 → **ASM-DUPLEX "20A duplex receptacle circuit, complete"** | 18 × **1.8613** = 33.50 h | **MAP: assembly double count.** D6 measured 22.70 h of EMT + #12; the BOX-4SQ inside it doubles the box allowance |
| GFCI duplex | 16 × 0.25 = 4.0 h | "GFCI receptacle" ×7, "WP GFCI RTU convenience" ×2 → GFCI | 9 × **0.40** = 3.6 h | UNIT 0.40 vs 0.25 (+ plate 0.03) |
| 20A single (Quoted) + 15A decorator single | 8 × 0.20 + 3 × 0.15 = 2.05 h | "Simplex receptacle" ×4 → simplex w/ plate | 4 × 0.23 = 0.92 h | CNT (11 vs 4) |
| Wallplates (4 rows) | 38 × 0.03 = 1.14 h | in device units | — | — |
| — | — | "Recessed WP/GFCI exterior receptacle +24"" ×2 | no_unit hold | MAP |
| — | — | "Junction box w/ 1" empty conduit" ×15, "Display baseflex J-box" ×4 → 4" square box | 19 × 0.25 = 4.75 h | CRM only (Chris: in box allowance / misc) |

### 3.4 Fixtures (Chris 161.4 h, $0 material; CRM 170.3 h, $20,818)

| Chris row | Chris | CRM row(s) | CRM | Cause |
|---|---|---|---|---|
| 4' Luminaire Linear Wraparound (Quoted) | 133 × **0.75** = 99.75 h | 8' strip 42W ×73, 8' strip 21W ×52, 4' strip ×6, 4' wall light ×2 → `LTG-STRIP4` | 133 × **0.65** = 86.45 h, **$7,980** | UNIT (count matches exactly: 133) + OF |
| 5" Recessed Downlight (Quoted) | 11 × **0.9** = 9.9 h | "Soffit" ×11 → `LTG-DOWN` | 11 × **0.6** = 6.6 h, $605 | UNIT + OF |
| Exit Light Single Face (Quoted) | 22 × 0.55 = 12.1 h | EM light ×13, exit ×5, exit ×1 (interior); "Outside above door" ×5 (exterior) → LTG-EM / exit | 24 × 0.60 = 14.4 h, $1,500 | CNT (22 vs 24) + UNIT |
| Wall Mount LED ≤175W (Quoted) | 3 × **1.1** = 3.3 h | (possibly CRM's "Outside above door" ×5) | — | CNT / identification |
| Wall Mount LED ≤250W (Quoted) | 6 × **1.6** = 9.6 h | DSXW1 1000 wall pack ×5 → `LTG-WPACK`; "DSXW1 LED 10C 530" ×1 | 5 × **1.0** = 5.0 h; 1 **no_unit hold** | UNIT (1.0 vs 1.6) + MAP |
| 20' Pole Round Steel (Quoted) | 3 × 4.8 = 14.4 h | site pole rows ×2 + ×1 + ×3 → `LTG-POLE` | **6** × 4.8 = 28.8 h, $5,700 | CNT (R's A: 6 → 3) + OF |
| Pole-top head ≤250W (Quoted) | 4 × 2.2 = 8.8 h | DSX1 heads ×2 + ×2 + ×6 → `LTG-POLEHEAD` | **10** × 2.2 = 22.0 h, $3,850 | CNT (R's A: 10 → 4) + OF |
| Anchor Bolt Template + 4 × Anchor Bolt | 3 × 0.7 + 12 × 0.12 = 3.54 h | "Pole anchor-bolt set + template" | **6** × 1.18 = 7.08 h | CNT (after R: 3 → 3.54 h ✓) |

- **After R,** the pole, head and anchor rows reproduce Chris exactly (26.74 h). Exterior / Site Lighting becomes ≈ 41.3 h. That is my sum of the CRM rows: poles 26.74 + wall packs 5.0 + soffit 6.6 + above-door 3.0.
- **Chris's 49.5 h** uses the replay's `extraExterior` for the 5" downlight. He is +8.2 h above the CRM from wall-mount units and the downlight unit.

### 3.5 Branch wiring allowance (Chris 407 h incl. misc; CRM 383 h)

| Chris rows | Chris | CRM row | CRM | Cause |
|---|---|---|---|---|
| #12 Black 5,976 + Green 1,371 (5.15/M) | 7,347 ft = 37.84 h, $1,528 | `THHN-12` | 4,515 ft = 23.25 h, $429 | RAT (`wire10Share` 0.47 vs Chris's Kissimmee 0.32) |
| #10 Black 2,520 + Green 1,006 (5.65/M) | 3,526 ft = 19.92 h, $1,163 | `THHN-10`: branch 4,004 + site 1,585 + RTU G 196 | 5,785 ft = 32.7 h | RAT. Total #12 + #10: CRM 10,300 vs 10,873 (−5%), so the hours wash |
| #12/2 MC (15.2/M) | **1,942.5 ft × 15.2/M = 29.53 h**, $1,448 | `MC-1202` "12/2 MC cable" (`seed/laborUnits.ts:147`, 2.5/C) | **1,452 ft × 25/M = 36.30 h**, $1,016 | RAT (`mcPerFixture` 7.89) + UNIT (2.5/C vs 1.52/C) |
| 3/8" MC Connector Saddle (0.08) | 406 × 0.08 = 32.48 h | `ALW-FIT-MC` 2.2/C of MC ft | 1,452 × 2.2/C = 31.94 h | ✓ (the driver should be whips, not ft) |
| 3/4" EMT 1,475 (3.2/C) + 1" EMT 130 (4.05) + 1" LFMC 6 | 52.8 h, $1,605 | `EMT-075` "3/4" EMT (incl. couplings/straps)" 4.0/C | 1,538 ft = 61.52 h, $923 | UNIT. `ALW-FIT-EMT` is calibrated as the residual above 4.0/C (`seed/laborUnits.ts:371`); see the check below |
| EMT couplings 136 + 13, connectors 198 + 4, LT conn 4, bushing 4, locknut 10 | 27.5 h | `ALW-FIT-EMT` 1.13/C | 1,783 ft = 20.15 h | ✓ |
| 17 hardware rows (straps, clips, anchors, chain 510, S-hook 170, purlin straps 170 …) | 87.9 h | `ALW-HW-RACEWAY` 2.68/C | 3,235 ft = 86.70 h | ✓ |
| 4" sq box 112, ring 50, cover 52, bracket 50, ground screw 38 | 35.7 h | `ALW-BOX` 0.19 / point | 194 pts = 36.86 h | ✓ |
| Wire connectors #16–#10 ×901 (0.07), #12–#6 ×27 (0.10), polytwine | 66.9 h | `ALW-SPLICE` 0.27 / point | 220 pts = 59.40 h | RAT (−7.5 h) |
| **Misc Materials 1 E, $1,500, 16 h** | **16.0 h** | — | — | **PAD / SCOPE, judgment** (only Kissimmee among the 5 BOMs has it) |

**MC whips: Chris carries ~13 ft per fixture on both jobs.**
- Per *interior luminaire excluding exit / emergency*:
  - Kissimmee: 1,942.5 / (133 + 11) = **13.5 ft**;
  - 36th: 377.5 / (13 + 2 + 14) = **13.0 ft**.
- Per MC connector, three of Chris's five BOMs are exactly **3.75 ft** (North Port 4,200 / 1,120; Orlando 1,072.5 / 286; Rockledge 1,980 / 528). That is 7.5 ft per whip with 2 connectors per whip.
- Kissimmee (4.78) and 36th (5.10) carry extra MC beyond the whips.
- The CRM's `mcPerFixture` 7.89 (`footageAllowance.ts:59`) divides by *all* fixture points: 184 on Kissimmee, which includes exits, exterior and poles.

**Checking the "incl. couplings/straps" double count.**
- Branch conduit + fittings + hardware come to 200.3 h (CRM) vs 200.6 h (Chris).
- So the 4.0/C EMT unit and the residual-calibrated allowances do not double count in total.
- They do misallocate between groups, which only matters for the eval's per-group view.

### 3.6 Site / underground (Chris 44.6 h; CRM 35.3 h incl. the 8.2 h lateral and PVC fittings 4.5 h)

| Chris row | Chris | CRM row | CRM | Cause |
|---|---|---|---|---|
| 1" Conduit – PVC 40 (adj +25%) | **750 ft** × 4.2/C × 1.25 = 39.38 h, $388.65 | "1" PVC Sch 40 (incl. fittings/glue)" `PVC-100` 4.3/C (E1 site geometry) | **317 ft** = 13.63 h, $111 | **GEO** |
| 1" Elbow PVC (+25%), coupling, male adapter (10 each) | 2.75 + 0.20 + 1.20 = 4.15 h | `ALW-FIT-PVC` share | ≈ 3.8 h | ✓ |
| PVC Cement | 1.03 h | in `PVC-100` | — | — |
| (site #10 sits in Chris's #10 rows) | — | #10 ×5 in the site conduit | 1,585 ft = 8.96 h | GEO (chain 5#10 vs radial 3 × 3#10) |
| — | — | "Trenching & backfill allowance" | 346 ft, **excluded** | ✓ (Chris carries none) |

#### 3.6a How Chris gets 750 ft for 3 poles

- **E-4 Panel A** shows the site lights as three circuits with different loads:
  - A-15 "SITE LIGHTING" 209 VA;
  - A-17 418 VA;
  - A-19 209 VA.
- **PH0.1** has S1 (1 head), S2 (twin) and S1 (1 head). So it is **one circuit per pole**, and separate homeruns are natural.
- **Measured on PH0.1** with the count marks (S1 (462.6, 634), S2 (501.5, 869), S1 (758.9, 868) displayed pt; 0.2776 ft/pt from the graphic scale):
  - the service corner is registered from C4.1: the meter pin sits 7.5 pt west and 156 pt south of the building's NW corner, about (316, 1286);
  - the three **radial Manhattan homeruns** are 167 + 240 + 222 = **628 ft**;
  - adding 3 × 2 × (2 + 3) ft stub-ups gives **658 ft**;
  - adding the interior to the panel gives **~670–700 ft**.
  - That is −7 to −11% against Chris. The pylon sign (A-18, "EC to provide circuit/conduit") or the landscape stub would cover the rest.
  - The 10 elbows mean 5 runs.
- **The CRM's E1** (`siteGeometry.ts:5-6, 136`) does something different:
  - it starts at "the building edge point nearest the first pole", which is the north face, not the service corner at the SW;
  - it **chains** nearest-neighbour;
  - it uses straight-line distance × 1.15.
  - Result: 282 ft + 20 ft of stubs.
- A chain from the service corner would be 167 + 73 + 76 = 316 ft. **The ~430 ft difference is routing method (radial vs chain) plus the start point.** It is not scale or counting.

### 3.7 Lighting controls (Chris 14.6 h; CRM 6.3 h)

| Chris row | Chris | CRM row | CRM | Cause |
|---|---|---|---|---|
| CMP #24-4 pair control cable | 1,000 ft × 8.6/M = **8.6 h**, $230 | — | — | **SCOPE**: E-4 note "THE ELECTRICAL CONTRACTOR WILL INSTALL LIGHTING CONTROL PANEL, ALL ACCESSORIES, DATA CONCENTRATOR AND DATA CABLE" (furnish statements) |
| Lighting Contactor (lump) | 1 × 6.0 h, $800 | "Semi-recessed, circuit B-25" → `LC-CONTACTOR` 2.0 h $180; 6 contactor terminations 4.32 h; ALC 0.72 | 7.0 h, $180 | ✓ hours; material $800 vs $180 |
| — | — | Motion / occupancy sensor ×3 | 1.2 h | CRM only |
| — | — | "Lighting control & telephone" → Lighting relay/control panel | **confirm_match hold** | MAP |
| — | — | "Dusk on, 50% reduction after close" 1 LS | unit_unknown hold | note, not scope |

---

## 4. Line-by-line mapping, 36th Street

| Chris row(s) | Chris | CRM row(s) | CRM | Cause |
|---|---|---|---|---|
| 1/2" EMT 320 (2.78/C) + 1" EMT 350 (4.05/C) | 23.07 h, $844 | `EMT-075` | 442 ft × 4.0/C = 17.68 h | RAT (`emtPerPoint` 6.6 × 67 pts; Chris ≈ 10 ft/pt on this remodel) |
| **"1" EMT & Wire" 300 C (Quoted, 2.5/C)** | **7.5 h** | the HVAC equipment-circuit feeder edges | **holds** (the 0930 count has no "PANEL A" mark) | CNT / locate (on 0929: 392 ft 3/4" EMT + 3#6) |
| **"2" EMT & Wire" 100 C (Quoted, 3.0/C)** | **3.0 h** | riser | **skipped as existing** ("Existing per riser / existing to remain, verify") | judgment |
| #12 1,056 + 352 G; #10 1,870 + 385 G | 3,663 ft = 20.0 h, $667 | #12 1,298 + #10 1,151 | 2,449 ft = 13.2 h | RAT (follows the conduit) |
| #12/2 MC | 377.5 × 15.2/M = 5.74 h | `MC-1202` | 316 × 25/M = 7.90 h | RAT + UNIT |
| 2x4 Flat Lens "(High Bay)" | 13 × **1.0** = 13.0 h | "Type H — surface strip light, 4ft × 13" → `LTG-STRIP4` | 13 × **0.65** = 8.45 h | MAP / UNIT |
| 2x4 recessed troffer | 14 × 0.7 = 9.8 h | `LTG-TROF24` | 14 × **0.75** = 10.5 h | UNIT |
| 2x2 troffer | 2 × 0.6 = 1.2 h | `LTG-TROF22` | 2 × **0.7** = 1.4 h | UNIT |
| **2-Heads 80W Unit Equipment (Emergency)** | 8 × **1.25** = **10.0 h** | "Incandescent can light, mfr unknown" ×8 → `LTG-DOWN` | 8 × 0.6 = 4.8 h, $440 | **identification** (the same 8 marks read as can lights) |
| Exit single face | 2 × 0.55 = 1.1 h | "Emergency exit combo" ×3 | 3 × 0.75 = 2.25 h | CNT / UNIT |
| Time Switch 24-Hour | 1 × 1.65 h, $150 | — | — | SCOPE / CNT |
| Toggle switches 4 + 12, plates 16 | 3.2 h | single-pole ×9 (0.30), 3-way ×6 (0.35) | 4.8 h | UNIT (0.30 vs 0.14–0.18 + plate 0.03) |
| Duplex 5, GFCI 2, plates 7 | 1.71 h | duplex ×1 (0.35), GFCI ×2 (0.40) | 1.15 h | CNT |
| Demo 2x4 fluorescent 52, HID 2, exit / EM 2, J-box 2, recept 18, sw 1P 6, 3W 2 | 22.21 h | demo fluor 56, exit / EM 5, recept 18, switch 11, device other 1, **disconnect / equipment 5 × 0.75** | 27.55 h | CNT + CRM-only 3.75 h |
| — | 0 | #6 terminations (COMP / AHU) 3 × 1.12; EF terminations 2 × 0.72 | 4.80 h | judgment (Chris carries none) |
| Boxes / fittings / hardware / splices (allowance groups) | 66.0 h | `ALW-*` | 63.0 h | ✓ |
| — | Chris lighting quotes $4,466.72 | library fixture material $3,005 + quote $4,470 | **double carried** | §1 |

---

## 5. Material: unit prices and owner-furnished items

**Unit prices: library seed vs Chris's Kissimmee BOM net cost (6/18/2026).** No library row carries a `material_price_date`.

| Item | CRM library | Chris | Ratio |
|---|---|---|---|
| #12 THHN | $95 / M | $208.00 / M | 0.46 |
| #10 THHN | $150 / M | $329.70 / M | 0.45 |
| #6 THHN | $360 / M | $895.50 / M | 0.40 |
| #3/0 THHN | $1,870 / M | $4,735 / M | 0.39 |
| 3/4" EMT | $60 / C | $92.38 / C | 0.65 |
| 1" PVC | $35 / C | $51.82 / C | 0.68 |
| 2" PVC (underground) | $85 / C | $105.68 / C | 0.80 |
| 12/2 MC | $70 / C | $74.52 / C | 0.94 |
| Lighting contactor | $180 | $800 (lump) | — |

- **Impact on Kissimmee's own quantities:** +$3,797 material, which is **+$4.6k selling**.
- **Chris's own prices move a lot between jobs.** His 36th rows are #12 $137.38 / M, #10 $210.40 / M, MC $626.05 / M. A price refresh needs Jake to choose a source.

**Kissimmee material, CRM minus Chris by group, after removing the owner-furnished $23,718.**

| Group | CRM | Chris | Difference | What drives it |
|---|---|---|---|---|
| Power poles | $1,300 | $5,200 | −$3.9k | |
| Feeders + lateral | $1,313 | $5,351 | −$4.0k | price + quantity |
| Service gear | $12 | $2,733 | −$2.7k | |
| Misc | $0 | $1,500 | −$1.5k | |
| Wire / MC | | | −$2.1k | price |
| Controls | | | −$0.85k | |
| Conduit | | | −$0.7k | |

---

## 6. Rows Chris has that the CRM lacks entirely (or holds at $0)

**Kissimmee.**

| Chris row | Hours | Material | CRM state |
|---|---|---|---|
| Misc Materials | 16 h | $1,500 | missing |
| CMP control cable | 8.6 h | $230 | missing |
| Polaris taps | 9.6 h | $360 | missing |
| Service gutter | 6 h | $600 | wireway no_unit hold |
| Grounding materials | 6 h | $890 | LS hold |
| Fire-rated plywood | 4 h | $250 | no_unit hold |
| 200A fusible switches + fuses | 6.8 h | $625 | pending, 0 |
| Meter socket | 1.5 h | — | pending, 0 |
| Hang fans | 7.5 h | $195 | pending, 0 |
| #6 lugs | 0.9 h | — | missing |
| ~266 ft of 2" PVC with no conductors | ≈ 31 h at Chris's units | — | missing |
| Camera pole (GE) | — | $750 | missing |

**36th Street.**

| Chris row | Hours | Material | CRM state |
|---|---|---|---|
| Time switch | 1.65 h | $150 | missing |
| "1" EMT & Wire" 300 ft | 7.5 h | — | held |
| "2" EMT & Wire" 100 ft | 3.0 h | — | skipped as existing |
| 1/2" and 1" EMT sizes | — | — | the CRM has 3/4" only |
| 4-11/16" boxes | — | — | the allowance carries them |

## 7. Rows the CRM has that Chris lacks

**Kissimmee.**

| CRM row | Hours | Material |
|---|---|---|
| Owner-furnished material (fixtures $20,818, panels $2,900) | — | $23,718 |
| Receptacle-assembly EMT / #12 / box | 29 h | — |
| Pole / head / anchor double count (until R) | 31.1 h | — |
| ≤#10 terminations | 10.8 h | — |
| Pipe-pole risers | 6 h (half of them a duplicate of the power poles) | — |
| Empty-conduit J-boxes | 4.75 h | — |
| Panel unit excess | 8.8 h | — |
| MC unit excess | 6.8 h | — |

**36th Street.**

| CRM row | Hours | Material |
|---|---|---|
| Library fixture material (beside the quote) | — | $3,005 |
| #6 / EF terminations | 4.8 h | — |
| Disconnect demolition | 3.75 h | — |
| Extra demolition counts | ~1.6 h | — |
| MC unit excess | 2.2 h | — |

---

## 8. Top 10 fixable gaps (ranked by $ impact at the CRM's settings, $54.6 / h and ×1.20 on material)

| # | Gap | Hours (toward Chris) | $ selling | Proposed fix (code / data / risk) | Ask Chris? |
|---|---|---|---|---|---|
| 1 | **Owner-furnished material priced** (Kissimmee fixtures + poles + panels). 36th fixtures carried in the library *and* the quote | 0 | **−$28.5k** K; **−$3.6k** 36th | `bidEstimate.ts:389-394` `ResolveOptions` already zeroes fixture material when `fixturePackageQuoted`. Add an evidence-backed **owner-furnished** decision per line from `agent1.furnishStatements` (lighting, panelboards, poles; quote on the line, visible, overridable), applied in the pre-mapping decisions. Separately, prompt when a bid has a lighting / "materials. vendor" quote but `fixture_package` is false. **Data:** already extracted. **Risk:** medium. Never apply to "by GC" (standing rule: GC = APT). Conflicting statements (power poles, 200A switches) must ask, not guess | Q5 |
| 2 | **Service and feeders** (#3/0 428 vs 872; 2" raceway 107 vs 474 ft; 2" PVC unit) | **+51 h** in all (+10 fixable now) | **+$7.6k** | (a) `feederRoute.ts:169` adjacent-gear rule: an exterior disconnect → interior panel passes through the wall. Route up and over (Chris ≈ 33 ft per feeder, from #6 G 66): +156 LF #3/0, +39 ft 2" conduit, ≈ +6 h. (b) Price the wireway→discon taps that `feederGraph.ts:160` already lists: 2 × 4 × ~5 ft #3/0 plus the nipples. (c) Underground PVC labor: Chris applies +25% to buried PVC and elbows on Kissimmee. Either add an "underground adjustment" setting on the PVC-200 / PVC-100 site rows, or raise PVC-200 to 8.5 / C + an elbow allowance (seed change, needs Jake). (d) `THHN-3_0` 16.5 → 18.8 / M and `THHN-6` 7.0 → 8.9 / M (Chris; needs Jake). (e) Eval: classify feeder-size Site lines as 'feeders' (`hoursGroups.ts:52`). **Risk:** low for a–b and e; c–d are seed / labor moves | Q1, Q2, Q12 |
| 3 | **Power poles** (8 × 3.5 h + $650 vs 2 hosts) | +15 h now (+1 h after R) | +$5.5k now (+$1.6k after R) | R's B (hosts 2 → 6). **MAP fix:** the "PP-1..6 — Power poles #1 office … #5 PVC data/security pipes" row lists the *same* poles as the host row. Make it a note / duplicate (`equipmentConnection.ts` circuit-reference path), not `RISER-PIPEPOLE` (×6 after R = 9 h double). The two "3" PVC data/security pipes" stay on the plan's open question (8 = 6 + 2). **Risk:** low | Q4 |
| 4 | **Service gear lines held or pending** (DISCON A/B, fuses, meter, Polaris taps, gutter, grounding, plywood, lugs); panel unit 8.0 vs 3.6 | +34.8 h / −8.8 h | **+$4.7k** | (a) Gear named on a one-line or schedule with "(TYP OF 2)" gets a schedule count, proposed as a visible review answer (counting / reviewItems, R's area; P's locate[] already knows DISCON A/B / METER). (b) New alias-only items at Chris's units, the mig 158 pattern: service gutter / wireway 12×12 6 h $600; grounding materials (service) 6 h $890; fire-rated plywood backboard 4 h $250; Polaris tap 1.2 h $45 × the tapped conductors from `feederGraph` taps (= 8); #6 lug 0.15 h. (c) `PNL-225` 8.0 → 3.6 (surface) / 4.5 (flush) (`seed/laborUnits.ts:275`; needs Jake). **Risk:** low. The units are Chris's; cite the BOM rows | Q8 |
| 5 | **Library material prices** at 40–65% of Chris's 2026 net cost (wire / conduit) | 0 | **+$4.6k** K (more at Chris's quantities) | Refresh `material_cost` for the THHN / EMT / PVC / MC rows from Chris's BOM net costs, with `material_price_date`. Data: 5 BOMs; Kissimmee 6/18/2026 is the most recent. **Risk:** Chris's prices differ ±50% between jobs. Jake picks the source (newest BOM vs supplier sheet) | Jake decision |
| 6 | **Misc Materials lump** (1 × $1,500 / 16 h) | +16 h | **+$2.7k** | No code until Chris answers. It appears on only 1 of 5 BOMs. If it is a rule (ground-up, or by size), add it as a default cost line or an allowance row with the rule quoted. **Risk:** pure padding if it is not a rule | Q6 |
| 7 | **Site 1" PVC 317 vs 750 ft** | +27 h (+20 h from radial routing) | +$1.8k | `siteGeometry.ts:136-158`: (a) start at the service / panel location: the C4.1 XFMR / METER pin or located panel, registered onto PH0.1 by the building outline; both sheets are 0.2776 ft / pt. (b) When the panel schedule gives **one site circuit per pole** (Kissimmee A-15 / A-17 / A-19 = 209 / 418 / 209 VA = S1 / S2-twin / S1), route **radial homeruns, Manhattan**, with stub-ups per run and 2#10 + #10G each. Measured: ≈ 670–700 ft vs 750. (c) Keep the chain when one circuit feeds several poles. **Risk:** medium; only 2 BOMs have poles | Q3 |
| 8 | **Fixture labor units** (strip / wrap 0.65 vs 0.75; downlight 0.6 vs 0.9; wall mount 1.0 vs 1.1 / 1.6; DSXW1 530 held; 36th 2-head EM units read as cans; H as high bay 1.0) | +22.2 h K (+16.6 interior, +7.9 wall, −2.3 exit); +9.8 h 36th | +$1.2k K; +$0.5k 36th | Seed moves (`seed/laborUnits.ts:247, 248, 263`) to Chris's BOM units, plus wattage-tiered wall-mount aliases (≤175 W 1.1; ≤250 W 1.6). Map "DSXW1 … 530" to a wall pack (today a no_unit hold). The 36th "incandescent can light" ×8 is an identification issue for the reader (R): Chris's 8 "2-Heads 80W Unit Equipment". **Risk:** seed changes need Jake's OK (like decision 1) | Q11, Q10 |
| 9 | **Receptacle "complete circuit" assembly double count** | **−29 h** | −$1.6k | Mapper: when the footage allowance carries the bid's branch wiring, map receptacles to the **device** item (Chris: duplex 0.20, GFCI 0.25, plate 0.03), not `ASM-DUPLEX` (`seed/laborUnits.ts:592`: EMT 0.25 C + #12 + BOX-4SQ). D6 already measures 22.70 h. GFCI 0.40 → 0.28 (−1.1 h). **Risk:** lowers hours. It must land together with #2 / #4 / #7 or the gate's "hours ≥ baseline" check fails. That is correct and intended | — |
| 10 | **36th branch raceway and HVAC circuits** (EMT 442 vs 670 ft + "1" EMT & Wire" 300 ft held + riser 100 ft skipped) | +~20 h (36th) | +$1.1k + material | (a) HVAC edges: R's locate[] / a pin for "PANEL A" (the 0929 export resolved 392 ft). (b) The `emtPerPoint` ratio under-predicts remodels (Chris ≈ 10 ft / pt on 36th vs 6.6). Add a remodel / warehouse ratio, or use the v2 geometry when the scale resolves. (c) The riser stays skipped unless Chris says he always carries it. **Risk:** medium (ratio LOO ±35%) | Q13 |

**Next five, below the cut:**

| Item | Hours | $ | Fix | Ask Chris? |
|---|---|---|---|---|
| ≤#10 terminations Chris doesn't carry | −10.8 h K, −4.8 h 36th | −$0.6k / −$0.3k | | Q7 |
| Venstar data cable | +8.6 h, +$230 | +$0.75k | rule off the LCP furnish statement | Q9 |
| 36th time switch | +1.65 h | +$0.27k | | |
| Ceiling fans pending | +7.5 h | +$0.64k | count from "CF1-CF3"; map FSC to a control device, so the three rows don't triple-count | |
| MC | −6.8 h K, −2.2 h 36th; +490 ft material | | `MC-1202` 2.5 → 1.52 / C; `mcPerFixture` recalibrated per interior luminaire (≈ 13.3), with connectors 2 per whip | |
| Camera-pole GE | | +$750 | OxBlue rule | |

**If every item above lands, after R:**
- Kissimmee comes to ≈ **794–800 h** and ≈ **$25.4k** material, against 798.9 h / $25.8k.
- At the CRM's settings that is ≈ **$82.5–83k**, which is Chris's inputs at the CRM's percentages (§1, scenario C).
- **The remaining distance to $79,112 is Jake's settings decision** (OH 38% vs Chris's 18% on this job), not estimating.

---

## 9. Exact questions for Chris (judgment calls)

1. **Q1 (service, Kissimmee).**
   - "Your 872' of #3/0 and 474' of 2" PVC: how long did you take the transformer-to-meter lateral, per conductor including makeup? Your feeders and grounds imply ~60 ft. The pad on C4.1 is ~10 ft off the west wall.
   - "Does the 2" PVC include conduit with no wire in it? For example the two utility conduits the C4.1 note gives the GC ('TWO 4" DIA. CONDUIT', which you priced as 2"), Duke primary along the south 'E' line, or telephone service. About 266 ft of your 2" carries no #3/0."
2. **Q2 (feeders).** "Disconnect A/B outside → Panel A/B inside: you carried ~33 ft per feeder (66 ft #6 G). Do you always route exterior disconnect → interior panel up through the wall and over, never a back-to-back nipple?"
3. **Q3 (site lighting).** "750 ft of 1" PVC for 3 poles: did you run a separate homerun from the building to each pole (A-15, A-17, A-19), or chain them? Does it include the pylon sign (A-18) or the landscape-control stub?"
4. **Q4 (power poles).** "8 power poles at 3.5 h + $650: is that the 6 store poles (#1–#6) plus the two 3" PVC data/security poles? The spec says AutoZone furnishes the Hubbell poles, and E-2 says 'GENERAL CONTRACTOR TO FURNISH ALL POWER POLES'. Why $650 each?"
5. **Q5 (owner-furnished gear).**
   - "E-4 says the 200A fused switches are 'AUTOZONE PROVIDED', but you priced them ($254.54 + 6 fuses $370.32). Do you always carry the fused mains on AutoZone jobs?"
   - "Fixtures, poles and panels at $0: confirm that AutoZone-furnished lighting and panels are labor only."
6. **Q6 (misc).** "Misc Materials, 1 at $1,500 / 16 h, is on Kissimmee only. Is that a standard allowance for ground-up jobs? How do you size it?"
7. **Q7 (terminations).** "You carry no equipment terminations for the water heater, exhaust fans, drinking fountain, signs, mini-tune or contactors (CRM: 15 × 0.72 h = 10.8 h). On 36th, none for the AC / AHU either. Are those inside your circuit / device units, or in Misc?"
8. **Q8 (panels).** "You used 3.6 h for the 225A panels, but E-4 says 'MOUNTING FLUSH'. Should flush be 4.5?"
9. **Q9 (Venstar).** "Venstar data cable at 1,000 ft: measured, or a standard per store?"
10. **Q10 (36th fixtures).** "The 8 '2-Heads 80W Unit Equipment' at 1.25 h: which plan symbol are they? Our reader saw 8 can lights. And why did you price Type H as a 2x4 high bay at 1.0 h rather than a strip?"
11. **Q11 (fixture units).** "Do 8' strips get the 4' wraparound unit (0.75)? Are wall packs 1.1 / 1.6 by wattage on every job?"
12. **Q12 (underground).** "Is the +25% labor adjustment on buried PVC and elbows standard? Kissimmee has +25%, Orlando +5%, North Port and Rockledge none."
13. **Q13 (36th).** "'1" EMT & Wire' at 300 ft and 2.5 h / C: which circuits? And '2" EMT & Wire' at 100 ft for the riser, which the drawings say is existing to remain: always carry it?"

## Method notes / caveats

- **Measurements.** PH0.1 / C4.1 / E-4 were read from the local plan set (`…/Summit GC/Autozone Kissimmee, FL/Plans/1.0 - AZ #10077 - Kissimmee, FL FULL SET.pdf`, pages 15, 19, 52). The radial site estimate and the lateral reasoning are hand measurements, so they are **SCRIPTED-grade**: use them as targets, not as fixtures.
- **Hours sums.** Every hours sum in §2 comes from the replay line detail through `classifyCrmLine` / `classifyBomRow`. The bucket figures in P's report differ only by the `extraExterior` downlight rule.
- **The 1.10 wire multiplier.** It is not consistent in Chris's Kissimmee BOM. Only #6 G (66 = 60 × 1.1) fits; #6 B 498, #3/0 872 and the MC quantities do not. Treat Chris's quantities as run length + makeup, not × 1.10.
