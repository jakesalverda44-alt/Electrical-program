// One-time backfill: walk the OneDrive Bids tree, find every quantity-takeoff
// spreadsheet, pair it with the proposal and Accubid breakdown sitting beside it, and
// load the lot into the CRM so the bid-comparison view has a comp library from day one.
//
//   npx tsx scripts/backfillBids.ts --root "/path/to/OneDrive/Bids"          # preview
//   npx tsx scripts/backfillBids.ts --root "/path/to/OneDrive/Bids" --write  # apply
//
// Preview mode prints exactly what would be created/updated and writes nothing.
// Re-running is safe: bids are matched on name and updated in place, never duplicated.
import fs from 'fs';
import path from 'path';
import { pool } from '../src/db/pool';
import { extractDocxText, extractPdfText, parseBidDocText } from '../src/utils/bidDocParse';
import { parseTakeoffWorkbook } from '../src/utils/takeoffParse';
import { parseAccubidBreakdown } from '../src/utils/accubidParse';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const ROOT = args[args.indexOf('--root') + 1];
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

if (!ROOT || !fs.existsSync(ROOT)) {
  console.error('Usage: npx tsx scripts/backfillBids.ts --root <bids-folder> [--write] [--limit N]');
  process.exit(1);
}

// Brand/prototype inference — chain stores are built to near-identical prototypes, so a
// same-brand comp beats a same-type one. Order matters: first match wins.
// Matched against the job name only (never the full path — "CloudStorage" in the
// OneDrive path would otherwise classify everything as self-storage). Underscores are
// normalized to spaces first, since scratch copies are named "7Eleven_42759".
const BRANDS: [RegExp, string, string][] = [
  [/autozone/i,                          'AutoZone',       'retail'],
  [/7\s?-?\s?eleven|7-11/i,              '7-Eleven',       'cstore_fuel'],
  [/el car wash/i,                       'El Car Wash',    'car_wash'],
  [/sud\s?stop/i,                        'Sud Stop',       'car_wash'],
  [/tommy'?s/i,                          "Tommy's",        'car_wash'],
  [/aquasonic/i,                         'Aquasonic',      'car_wash'],
  [/big dan'?s/i,                        "Big Dan's",      'car_wash'],
  [/bubble down/i,                       'Bubble Down',    'car_wash'],
  [/waters car wash/i,                   'Waters',         'car_wash'],
  [/goddard/i,                           'Goddard School', 'other'],
  [/smoothie king/i,                     'Smoothie King',  'restaurant'],
  [/hotworx/i,                           'HotWorx',        'retail'],
];

// Fallback project type by keyword when no brand matched.
const TYPES: [RegExp, string][] = [
  [/car\s?wash/i,             'car_wash'],
  [/self[\s-]?storage|storage/i, 'self_storage'],
  [/restaurant|bbq|tequila|pizza|grill/i, 'restaurant'],
  [/medical|eye|dental|clinic/i, 'medical'],
  [/warehouse/i,              'warehouse'],
  [/office|condo/i,           'office'],
  [/c[\s-]?store|convenience|fuel|gas station/i, 'cstore_fuel'],
  [/retail|shell building/i,  'retail'],
];

interface Candidate {
  dir: string;
  jobName: string;
  takeoffPath: string;
  proposalPath?: string;
  breakdownPath?: string;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Folders that hold the documents for a job but aren't its name.
const GENERIC_DIR = /^(bid submitt?al( docs)?|pre-?bid|plans? review.*|submittal docs|documents|current)$/i;

// Walks up out of generic subfolders ("Bid Submittal", "Pre-bid") to the real job name.
function jobNameFor(dir: string): string {
  let d = dir;
  for (let i = 0; i < 3 && GENERIC_DIR.test(path.basename(d)); i++) d = path.dirname(d);
  return path.basename(d);
}

// Working/scratch areas that mirror real job folders — used to break dedupe ties, not
// to exclude outright (some jobs only exist here).
const SCRATCH = /Commercial Proposal Builder|Jake Bids/i;

// A job's files live together, but not always in the same folder as the takeoff —
// many jobs put the takeoff in "Pre-bid/" and the proposal in "Bid Submittal/".
// Searches the job folder and everything under it.
function findCandidates(root: string): Candidate[] {
  const all = walk(root);
  const takeoffs = all.filter(f => /(quantity[_ ]?takeoff|bid[_ ]takeoff)\.xlsx$/i.test(path.basename(f)));

  const candidates: Candidate[] = [];
  for (const t of takeoffs) {
    const dir = path.dirname(t);
    if (/_Reference|[/\\]scripts([/\\]|$)/i.test(dir)) continue;

    // Anchor on the real job folder, then consider every file beneath it.
    let jobRoot = dir;
    for (let i = 0; i < 3 && GENERIC_DIR.test(path.basename(jobRoot)); i++) jobRoot = path.dirname(jobRoot);
    const scope = all.filter(f => f.startsWith(jobRoot + path.sep));

    const proposal = scope.find(f =>
      /\.(docx|pdf)$/i.test(f) &&
      /(submittal|submital|proposal)/i.test(path.basename(f)) &&
      !/breakdown|takeoff|quote|plan|geotech|matrix/i.test(path.basename(f))
    );
    const breakdown = scope.find(f => /breakdown.*\.pdf$/i.test(path.basename(f)));

    // A takeoff loose in a scratch container has no job folder to name it — fall back
    // to the takeoff filename ("SudStop_Quantity_Takeoff.xlsx" → "SudStop").
    let jobName = path.basename(jobRoot);
    if (SCRATCH.test(jobName) || GENERIC_DIR.test(jobName)) {
      jobName = path.basename(t).replace(/[_ ]?(quantity|bid)[_ ]?takeoff.*$/i, '').replace(/[_-]+/g, ' ').trim();
    }
    candidates.push({ dir, jobName, takeoffPath: t, proposalPath: proposal, breakdownPath: breakdown });
  }

  // Dedupe on the parsed takeoff itself rather than the folder name — the same job is
  // filed under wildly different names ("7Eleven_42859_Auburndale" vs
  // "7-Eleven #42859 - Auburndale, FL"), but its takeoff content is identical.
  const best = new Map<string, Candidate>();
  const rank = (c: Candidate) =>
    (c.proposalPath ? 2 : 0) + (c.breakdownPath ? 2 : 0) + (SCRATCH.test(c.dir) ? 0 : 1);

  for (const c of candidates) {
    let key: string;
    try {
      const t = parseTakeoffWorkbook(fs.readFileSync(c.takeoffPath));
      key = `${t.lineItems.length}:${t.categories.map(x => `${x.name}=${x.itemCount}`).sort().join(',')}`;
    } catch {
      key = c.takeoffPath;
    }
    const prev = best.get(key);
    if (!prev || rank(c) > rank(prev)) best.set(key, c);
  }

  // Same job, different revisions (SudStop at 68 vs 75 items) still land separately
  // above because their content differs. They'd collide on name at write time and
  // silently overwrite each other, so keep only the most complete revision.
  const byName = new Map<string, { c: Candidate; items: number }>();
  for (const c of best.values()) {
    let items = 0;
    try { items = parseTakeoffWorkbook(fs.readFileSync(c.takeoffPath)).lineItems.length; } catch { /* keep 0 */ }
    const key = c.jobName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const prev = byName.get(key);
    if (!prev || items > prev.items) byName.set(key, { c, items });
  }
  return [...byName.values()].map(v => v.c);
}

function classify(jobName: string): { brand: string | null; projectType: string | null } {
  const text = jobName.replace(/[_-]+/g, ' ');
  for (const [re, brand, type] of BRANDS) if (re.test(text)) return { brand, projectType: type };
  for (const [re, type] of TYPES) if (re.test(text)) return { brand: null, projectType: type };
  return { brand: null, projectType: null };
}

async function main() {
  const candidates = findCandidates(ROOT).slice(0, LIMIT);
  console.log(`Found ${candidates.length} job folder(s) with a quantity takeoff.\n`);

  const { rows: userRows } = await pool.query(
    `SELECT id, name FROM users WHERE role IN ('owner','admin') ORDER BY created_at LIMIT 1`
  );
  const owner = userRows[0];
  if (!owner && WRITE) { console.error('No owner/admin user to attribute bids to.'); process.exit(1); }

  let created = 0, updated = 0, skipped = 0;

  for (const c of candidates) {
    const label = c.jobName;
    try {
      const takeoff = parseTakeoffWorkbook(fs.readFileSync(c.takeoffPath));
      if (!takeoff.lineItems.length) { console.log(`SKIP  ${label} — takeoff parsed 0 items`); skipped++; continue; }

      let amount: number | null = null;
      let scopeText = '';
      if (c.proposalPath) {
        const text = /\.docx$/i.test(c.proposalPath)
          ? extractDocxText(fs.readFileSync(c.proposalPath))
          : await extractPdfText(fs.readFileSync(c.proposalPath));
        const parsed = parseBidDocText(text);
        amount = parsed.amount;
        scopeText = parsed.scopeText;
      }

      const breakdown = c.breakdownPath
        ? parseAccubidBreakdown(await extractPdfText(fs.readFileSync(c.breakdownPath)))
        : null;

      // Fall back to Accubid's selling price, then to a price stamped in the takeoff
      // header — many pre-bid takeoffs never got a saved proposal document.
      if (amount === null && breakdown?.sellingPrice) amount = breakdown.sellingPrice;
      if (amount === null && takeoff.price) amount = takeoff.price;

      const { brand, projectType } = classify(label);
      const sqFt = takeoff.sqFt;

      console.log(
        `${amount ? 'OK   ' : 'PART '} ${label}\n` +
        `        type=${projectType ?? '—'} brand=${brand ?? '—'} sqft=${sqFt ?? '—'} ` +
        `amount=${amount ? '$' + amount.toLocaleString() : '—'} ` +
        `items=${takeoff.lineItems.length} cats=${takeoff.categories.length} ` +
        `labor=${breakdown?.laborHours ? breakdown.laborHours + 'h' : '—'}`
      );

      if (!WRITE) { skipped++; continue; }

      const { rows: existing } = await pool.query(
        'SELECT id FROM bids WHERE lower(name) = lower($1) AND deleted_at IS NULL LIMIT 1', [label]
      );

      let bidId: string;
      if (existing.length) {
        bidId = existing[0].id;
        await pool.query(
          `UPDATE bids SET
             amount = COALESCE($1, amount), sq_ft = COALESCE($2, sq_ft),
             project_type = COALESCE(project_type, $3), brand = COALESCE(brand, $4),
             notes = COALESCE(NULLIF($5,''), notes), updated_at = now()
           WHERE id = $6`,
          [amount, sqFt, projectType, brand, scopeText, bidId]
        );
        updated++;
      } else {
        const { rows: ins } = await pool.query(
          `INSERT INTO bids (name, gc, loc, amount, due, notes, salesperson_id, salesperson_name,
                             project_type, sq_ft, brand, stage)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'submitted')
           RETURNING id`,
          [label, path.basename(path.dirname(c.dir)) || '—', '—', amount, 'imported',
           scopeText || null, owner.id, owner.name, projectType, sqFt, brand]
        );
        bidId = ins[0].id;
        created++;
      }

      await pool.query(
        `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count, source_file, updated_at)
         VALUES ($1,'final',$2::jsonb,$3::jsonb,$4,$5,now())
         ON CONFLICT (bid_id, kind) DO UPDATE SET
           categories=$2::jsonb, line_items=$3::jsonb, item_count=$4, source_file=$5, updated_at=now()`,
        [bidId, JSON.stringify(takeoff.categories), JSON.stringify(takeoff.lineItems),
         takeoff.lineItems.length, path.basename(c.takeoffPath)]
      );

      if (breakdown && (breakdown.sellingPrice || breakdown.laborHours)) {
        await pool.query(
          `INSERT INTO bid_cost_breakdown (bid_id, material_total, labor_total, equipment_total,
             quotes_total, prime_cost, total_overhead, total_markup, selling_price, labor_hours,
             journeyman_hours, apprentice_hours, avg_labor_rate, avg_crew_size, labor_risk_ratio,
             source_file, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())
           ON CONFLICT (bid_id) DO UPDATE SET
             material_total=$2, labor_total=$3, equipment_total=$4, quotes_total=$5,
             prime_cost=$6, total_overhead=$7, total_markup=$8, selling_price=$9,
             labor_hours=$10, journeyman_hours=$11, apprentice_hours=$12, avg_labor_rate=$13,
             avg_crew_size=$14, labor_risk_ratio=$15, source_file=$16, updated_at=now()`,
          [bidId, breakdown.materialTotal, breakdown.laborTotal, breakdown.equipmentTotal,
           breakdown.quotesTotal, breakdown.primeCost, breakdown.totalOverhead, breakdown.totalMarkup,
           breakdown.sellingPrice, breakdown.laborHours, breakdown.journeymanHours,
           breakdown.apprenticeHours, breakdown.avgLaborRate, breakdown.avgCrewSize,
           breakdown.laborRiskRatio, path.basename(c.breakdownPath!)]
        );
      }
    } catch (err) {
      console.log(`FAIL  ${label} — ${(err as Error).message}`);
      skipped++;
    }
  }

  console.log(
    `\n${WRITE ? 'Applied' : 'Preview only (re-run with --write to apply)'}: ` +
    `${created} created, ${updated} updated, ${skipped} skipped.`
  );
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
