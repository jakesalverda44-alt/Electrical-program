# Pre-Bid Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store the Cowork pre-bid scope (.docx) and quantity takeoff (.xlsx) against a bid, and compare them to similar past jobs by project type and square footage — surfacing size delta, quantity differences, and cost drivers.

**Architecture:** Extends the existing bid-comparison subsystem rather than paralleling it. `bid_takeoffs` gains a `kind` discriminator (`'prebid' | 'final'`) so both takeoffs coexist on one bid; the existing `parseTakeoffWorkbook` is repaired and enriched rather than replaced; the existing per-1000-SF compare engine is reused with a `kind` filter. A new scope parser and a new `PreBidTab` component are the only genuinely new units.

**Tech Stack:** TypeScript, Express, Postgres (raw `pg`, no ORM), React 18 + Vite, Vitest (both packages), supertest for route integration, `adm-zip` for OOXML reading, `@anthropic-ai/sdk` for the optional AI pass.

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-07-29-prebid-package-design.md`. Findings referenced by number below are from that document.
- Branch: `feat/prebid-package`. Do not push; do not open a PR unless asked.
- Migrations are append-only, numbered, and run once in a transaction by `backend/src/migrate.ts` (lexicographic `readdirSync().sort()`). Next number is **082**. Never edit an existing migration.
- Both packages must pass `npm run typecheck`, `npm test`, and `npm run build` (CI runs all three — `.github/workflows/ci.yml`). Backend runs on Node 20, frontend on Node 22.
- Backend integration tests must degrade gracefully without a database: guard with `if (!ok) return ctx.skip()` using `dbAvailable()` from `src/test/harness.ts`.
- Frontend component tests need `// @vitest-environment happy-dom` as the first line.
- `documents.category` has a CHECK constraint that has been rewritten five times (068, 076, 077, 079, 080). It must be **restated in full**, never amended.
- The `'final'` takeoff path must remain byte-identical in behaviour. Every change to `takeoffParse.ts` is additive.
- No new npm dependencies. `adm-zip` is already present and is the only OOXML reader needed.

## PII Constraint (read before Task 2)

The real Cowork files contain live customer contact details — `AutoZone_Tavares_PreBid_Scope.docx` includes an owner contact name, phone number and email address. **Committing them verbatim would put third-party PII into git history permanently, where it cannot be removed without a history rewrite.**

Every fixture is therefore **redacted before it is committed**: personal names, phone numbers, email addresses and street addresses in the scope documents are replaced with obvious placeholders (`Jane Doe`, `(555) 555-0100`, `contact@example.com`, `123 Example St`). Structure, section headings, quantities, confidence flags and category names are preserved exactly, because those are what the tests assert on. The takeoff workbooks carry quantities rather than contacts and need only their header GC/owner lines redacted.

Task 2 Step 1 performs the redaction. Do not skip it and do not commit the originals.

## File Structure

**Created**
| Path | Responsibility |
|---|---|
| `database/migrations/082_prebid.sql` | `kind` discriminator + PK swap, `key_findings`, `bid_prebid_scope`, document categories |
| `backend/src/utils/prebidScopeParse.ts` | Parse the pre-bid scope .docx into meta + furnish model + sections |
| `backend/src/test/prebidScopeParse.test.ts` | Unit tests for the scope parser |
| `backend/src/test/takeoffParse.test.ts` | Unit tests for the repaired takeoff parser |
| `backend/src/test/prebid.test.ts` | Route integration tests (import, comparables, compare) |
| `backend/src/test/fixtures/prebid/` | Redacted real Cowork files |
| `frontend/src/features/preconstruction/PreBidTab.tsx` | The Pre-Bid tab UI |
| `frontend/src/features/preconstruction/prebidScope.ts` | `buildScopeFromPrebid` mapping (pure, testable) |
| `frontend/src/features/preconstruction/prebidScope.test.ts` | Mapping unit tests |
| `frontend/src/features/preconstruction/PreBidTab.test.tsx` | Component tests |

**Modified**
| Path | Change |
|---|---|
| `backend/src/utils/takeoffParse.ts` | Retain unresolved rows; add `categoryRaw`, `confidence`, ranges, `subcategories`, `keyFindings`; widen notes regex |
| `backend/src/routes/preconstruction.ts` | `ON CONFLICT (bid_id, kind)`; `kind` filters on three joins; `/import-prebid`; `/prebid-comparables`; `/compare?kind=`; `/prebid-analyze` |
| `backend/src/ai/prompts.ts` | `PREBID_COMPARE_SYSTEM` |
| `backend/src/utils/storeDocument.ts` | Drive folder routing for the two new categories |
| `frontend/src/features/preconstruction/constants.ts` | `PC_TABS` entry + `PcTabKey` |
| `frontend/src/features/preconstruction/PcWorkspace.tsx` | Tab case; Import-from-Pre-Bid button; non-destructive AI autofill |
| `frontend/src/components/RecordFiles.tsx` | Two new upload categories |
| `frontend/src/App.tsx` | `active_tab` validation accepts `prebid` |

---

### Task 1: Schema — `kind` discriminator and pre-bid scope table

**Files:**
- Create: `database/migrations/082_prebid.sql`
- Modify: `backend/src/routes/preconstruction.ts` (the `import-bid` upsert, currently `ON CONFLICT (bid_id)`)
- Test: `backend/src/test/prebid.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `bid_takeoffs.kind TEXT NOT NULL DEFAULT 'final'` with PK `(bid_id, kind)`; `bid_takeoffs.key_findings JSONB`; table `bid_prebid_scope`; `documents.category` accepts `'prebid_takeoff'` and `'prebid_scope'`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/test/prebid.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../db/pool';
import { dbAvailable, makeUser, auth } from './harness';
import request from 'supertest';
import { app } from '../index';

let ok = false;
beforeAll(async () => { ok = await dbAvailable(); }, 30_000);

describe('prebid schema', () => {
  it('stores a prebid and a final takeoff on the same bid', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `KindT ${Date.now()}`, gc: 'G' }).expect(200);
    const id = bid.body.id as string;

    for (const kind of ['prebid', 'final']) {
      await pool.query(
        `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
         VALUES ($1,$2,'[]'::jsonb,'[]'::jsonb,0)
         ON CONFLICT (bid_id, kind) DO UPDATE SET item_count = EXCLUDED.item_count`,
        [id, kind]
      );
    }

    const { rows } = await pool.query(
      'SELECT kind FROM bid_takeoffs WHERE bid_id=$1 ORDER BY kind', [id]
    );
    expect(rows.map(r => r.kind)).toEqual(['final', 'prebid']);
  });

  it('defaults existing-style inserts to final', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `DefaultT ${Date.now()}`, gc: 'G' }).expect(200);
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, categories, line_items, item_count)
       VALUES ($1,'[]'::jsonb,'[]'::jsonb,0)`, [bid.body.id]
    );
    const { rows } = await pool.query('SELECT kind FROM bid_takeoffs WHERE bid_id=$1', [bid.body.id]);
    expect(rows[0].kind).toBe('final');
  });

  it('accepts the new document categories', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `CatT ${Date.now()}`, gc: 'G' }).expect(200);
    for (const category of ['prebid_takeoff', 'prebid_scope']) {
      await expect(pool.query(
        `INSERT INTO documents (linked_id, linked_name, div, name, category)
         VALUES ($1,'x','elec','f.xlsx',$2)`, [bid.body.id, category]
      )).resolves.toBeTruthy();
    }
  });

  it('creates bid_prebid_scope keyed by bid', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `ScopeT ${Date.now()}`, gc: 'G' }).expect(200);
    await pool.query(
      `INSERT INTO bid_prebid_scope (bid_id, furnish_model, sections)
       VALUES ($1,'OFEI','[]'::jsonb)`, [bid.body.id]
    );
    const { rows } = await pool.query(
      'SELECT furnish_model FROM bid_prebid_scope WHERE bid_id=$1', [bid.body.id]
    );
    expect(rows[0].furnish_model).toBe('OFEI');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/test/prebid.test.ts`
Expected: FAIL — `column "kind" of relation "bid_takeoffs" does not exist`. (If no database is reachable the tests skip; start Postgres first, otherwise this task cannot be verified.)

- [ ] **Step 3: Write the migration**

Create `database/migrations/082_prebid.sql`:

```sql
-- Pre-bid package: the Cowork scope + quantity takeoff produced when a bid invite is
-- accepted, before any pricing exists. Pre-bid takeoffs are the comparison corpus, so a
-- later "Import Finished Bid" must not overwrite them — hence a kind discriminator
-- rather than reusing the single-row-per-bid shape from 078.

ALTER TABLE bid_takeoffs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'final';
ALTER TABLE bid_takeoffs DROP CONSTRAINT IF EXISTS bid_takeoffs_kind_check;
ALTER TABLE bid_takeoffs ADD CONSTRAINT bid_takeoffs_kind_check
  CHECK (kind IN ('prebid','final'));

-- Existing rows are all finished-bid imports and default to 'final', so widening the
-- key changes no data.
ALTER TABLE bid_takeoffs DROP CONSTRAINT IF EXISTS bid_takeoffs_pkey;
ALTER TABLE bid_takeoffs ADD PRIMARY KEY (bid_id, kind);

-- Trailing "LEGEND & KEY FINDINGS" narrative from the pre-bid workbook: confidence key,
-- counting methodology, and sheets that were not in the reviewed set.
ALTER TABLE bid_takeoffs ADD COLUMN IF NOT EXISTS key_findings JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS bid_prebid_scope (
  bid_id                UUID PRIMARY KEY REFERENCES bids(id) ON DELETE CASCADE,
  meta                  JSONB NOT NULL DEFAULT '{}',
  furnish_model         TEXT,
  furnish_note          TEXT,
  general_items         JSONB NOT NULL DEFAULT '[]',
  sections              JSONB NOT NULL DEFAULT '[]',
  ai_comparison         JSONB,
  ai_comparison_against UUID REFERENCES bids(id) ON DELETE SET NULL,
  ai_status             TEXT,
  ai_error              TEXT,
  source_file           TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE bid_prebid_scope DROP CONSTRAINT IF EXISTS bid_prebid_scope_furnish_check;
ALTER TABLE bid_prebid_scope ADD CONSTRAINT bid_prebid_scope_furnish_check
  CHECK (furnish_model IS NULL OR furnish_model IN ('OFEI','ECFECI','mixed'));

-- Restate the whole category list (068/076/077/079/080 each rewrote this constraint;
-- amending rather than restating is how categories got silently dropped before).
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check
  CHECK (category IS NULL OR category IN (
    'plans','contract','proposal','permit','invoice','photo',
    'sizer_report','survey','site_checklist','labeled_survey',
    'takeoff','cost_breakdown',
    'change_order','submittal','rfi',
    'prebid_takeoff','prebid_scope',
    'other'
  ));
```

- [ ] **Step 4: Fix the now-broken `import-bid` upsert**

Widening the primary key invalidates `ON CONFLICT (bid_id)`. In `backend/src/routes/preconstruction.ts`, inside `POST /:bidId/import-bid`, change the `bid_takeoffs` upsert to name the kind explicitly:

```ts
      await pool.query(
        `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count, source_file, updated_at)
         VALUES ($1,'final',$2::jsonb,$3::jsonb,$4,$5,now())
         ON CONFLICT (bid_id, kind) DO UPDATE SET
           categories=$2::jsonb, line_items=$3::jsonb, item_count=$4, source_file=$5, updated_at=now()`,
        [bidId, JSON.stringify(takeoff.categories), JSON.stringify(takeoff.lineItems),
         takeoff.lineItems.length, takeoffFile.originalname]
      );
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/test/prebid.test.ts && npm run typecheck`
Expected: 4 passed, typecheck clean.

- [ ] **Step 6: Verify no existing test regressed**

Run: `cd backend && npm test`
Expected: all suites pass — `comparables.test.ts` in particular, since it exercises the joins onto `bid_takeoffs`.

- [ ] **Step 7: Commit**

```bash
git add database/migrations/082_prebid.sql backend/src/routes/preconstruction.ts backend/src/test/prebid.test.ts
git commit -m "feat: add kind discriminator to bid_takeoffs and bid_prebid_scope table

Pre-bid and final takeoffs must coexist on one bid: the pre-bid set is the
comparison corpus, so a later Import Finished Bid cannot be allowed to
overwrite it. Widens the primary key to (bid_id, kind) and updates the
import-bid upsert accordingly."
```

---

### Task 2: Takeoff parser — retain unresolved rows, capture confidence and raw categories

**Files:**
- Create: `backend/src/test/fixtures/prebid/` (redacted fixtures)
- Create: `backend/src/test/takeoffParse.test.ts`
- Modify: `backend/src/utils/takeoffParse.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (pure function, no DB).
- Produces:
  ```ts
  export interface TakeoffLineItem {
    category: string;      // normalized
    categoryRaw: string;   // as written in the sheet
    description: string;
    unit: string;
    qty: number | null;    // null when the sheet says VERIFY / NONE IDENTIFIED
    qtyRaw?: string;       // the literal cell text when qty is null
    confidence?: 'FIRM' | 'APPROX' | 'VERIFY';
    qtyLow?: number;
    qtyHigh?: number;
    notes?: string;
  }
  export interface TakeoffSubcategory { name: string; itemCount: number; totals: Record<string, number> }
  export interface TakeoffCategory {
    name: string; itemCount: number; unresolvedCount: number;
    totals: Record<string, number>; subcategories: TakeoffSubcategory[];
  }
  export interface ParsedTakeoff {
    sqFt: number | null; price: number | null;
    categories: TakeoffCategory[]; lineItems: TakeoffLineItem[]; keyFindings: string[];
  }
  export function parseTakeoffWorkbook(buf: Buffer): ParsedTakeoff;
  ```

- [ ] **Step 1: Copy and redact the fixtures**

```bash
mkdir -p backend/src/test/fixtures/prebid
cp ~/Downloads/AutoZone_Tavares_Quantity_Takeoff.xlsx backend/src/test/fixtures/prebid/autozone_takeoff.xlsx
cp "$HOME/Downloads/El Car Wash Lehigh Acres_Quantity_Takeoff.xlsx" backend/src/test/fixtures/prebid/elcarwash_takeoff.xlsx
cp ~/Downloads/AutoZone_Tavares_PreBid_Scope.docx backend/src/test/fixtures/prebid/autozone_scope.docx
cp ~/Downloads/Indian_Oaks_PreBid_Scope.docx backend/src/test/fixtures/prebid/indianoaks_scope.docx
cp ~/Downloads/Nick_Moes_PreBid_Scope.docx backend/src/test/fixtures/prebid/nickmoes_scope.docx
```

Then run this redactor, which rewrites the text inside each OOXML part in place. It preserves every heading, quantity and confidence flag — only contact details change.

```bash
cat > /tmp/redact_fixtures.py <<'PY'
import re, sys, zipfile, shutil, pathlib

SUBS = [
    (re.compile(r'\b[\w.+-]+@[\w-]+\.[\w.]+\b'), 'contact@example.com'),
    (re.compile(r'\(\d{3}\)\s*\d{3}-\d{4}'), '(555) 555-0100'),
    (re.compile(r'\b\d{3}-\d{3}-\d{4}\b'), '555-555-0100'),
    (re.compile(r'Wade Davis'), 'Jane Doe'),
    (re.compile(r'Danny E\. Doss, P\.E\.'), 'Pat Roe, P.E.'),
    (re.compile(r'132 Kelley Drive, Rogers, AR 72756'), '123 Example St, Springfield, IL 62701'),
    (re.compile(r'North of 1986 FL-19, Tavares, FL 32778'), '456 Example Rd, Springfield, IL 62701'),
    (re.compile(r'Parcel ID [\d-]+'), 'Parcel ID 00-00-00-0000-000-00000'),
    (re.compile(r'Jake Salverda'), 'Alex Example'),
]

def scrub(text):
    for pat, rep in SUBS:
        text = pat.sub(rep, text)
    return text

for path in map(pathlib.Path, sys.argv[1:]):
    tmp = path.with_suffix(path.suffix + '.tmp')
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.endswith('.xml'):
                data = scrub(data.decode('utf8')).encode('utf8')
            zout.writestr(item, data)
    shutil.move(tmp, path)
    print('redacted', path.name)
PY
python3 /tmp/redact_fixtures.py backend/src/test/fixtures/prebid/*.xlsx backend/src/test/fixtures/prebid/*.docx
```

Verify nothing leaked before going further:

```bash
cd backend/src/test/fixtures/prebid && for f in *.docx *.xlsx; do
  unzip -p "$f" '*.xml' 2>/dev/null | grep -oE '[[:alnum:]._%+-]+@[[:alnum:].-]+|\([0-9]{3}\) [0-9]{3}-[0-9]{4}' | sort -u
done
```
Expected output: only `contact@example.com` and `(555) 555-0100`. **If anything else appears, fix the redactor and rerun — do not commit.**

- [ ] **Step 2: Write the failing tests**

Create `backend/src/test/takeoffParse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseTakeoffWorkbook } from '../utils/takeoffParse';

const fixture = (n: string) => readFileSync(join(__dirname, 'fixtures/prebid', n));
const autozone = () => parseTakeoffWorkbook(fixture('autozone_takeoff.xlsx'));
const carwash = () => parseTakeoffWorkbook(fixture('elcarwash_takeoff.xlsx'));

describe('parseTakeoffWorkbook — unresolved quantities', () => {
  it('keeps rows whose quantity reads VERIFY instead of dropping them', () => {
    const items = autozone().lineItems.filter(i => i.qty === null);
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.every(i => typeof i.qtyRaw === 'string' && i.qtyRaw.length > 0)).toBe(true);
  });

  it('keeps all three site and exterior lighting lines', () => {
    const ext = autozone().lineItems.filter(i => i.category === 'EXTERIOR / SITE LIGHTING');
    expect(ext).toHaveLength(3);
    expect(ext.every(i => i.qty === null)).toBe(true);
  });

  it('excludes unresolved rows from totals but counts them separately', () => {
    const cat = autozone().categories.find(c => c.name === 'EXTERIOR / SITE LIGHTING')!;
    expect(cat.unresolvedCount).toBe(3);
    expect(Object.values(cat.totals).every(v => Number.isFinite(v))).toBe(true);
  });
});

describe('parseTakeoffWorkbook — confidence and ranges', () => {
  it('captures the CONF. column', () => {
    const items = autozone().lineItems;
    expect(items.some(i => i.confidence === 'FIRM')).toBe(true);
    expect(items.some(i => i.confidence === 'APPROX')).toBe(true);
    expect(items.some(i => i.confidence === 'VERIFY')).toBe(true);
  });

  it('parses a stated range out of the notes', () => {
    const a = autozone().lineItems.find(i => i.description.startsWith('Type A'))!;
    expect(a.qty).toBe(64);
    expect(a.qtyLow).toBe(58);
    expect(a.qtyHigh).toBe(70);
  });

  it('captures notes from a SOURCE / BASIS / NOTES header', () => {
    expect(autozone().lineItems.filter(i => i.notes && i.notes.length > 0).length).toBeGreaterThan(20);
  });
});

describe('parseTakeoffWorkbook — job-type variation', () => {
  it('collapses the car wash branch power split for alignment', () => {
    const names = carwash().categories.map(c => c.name);
    expect(names.filter(n => n === 'BRANCH POWER')).toHaveLength(1);
  });

  it('preserves the raw split as subcategories so cost drivers survive', () => {
    const cat = carwash().categories.find(c => c.name === 'BRANCH POWER')!;
    const subs = cat.subcategories.map(s => s.name).sort();
    expect(subs).toEqual(['BRANCH POWER — BUILDING', 'BRANCH POWER — CAR WASH EQUIPMENT']);
    expect(autozone().categories.find(c => c.name === 'BRANCH POWER')!.subcategories).toHaveLength(1);
  });

  it('keeps categoryRaw on every line item', () => {
    expect(carwash().lineItems.every(i => typeof i.categoryRaw === 'string' && i.categoryRaw)).toBe(true);
  });
});

describe('parseTakeoffWorkbook — header and narrative', () => {
  it('reads gross square footage from the header block', () => {
    expect(autozone().sqFt).toBe(7381);
  });

  it('captures the trailing key findings block', () => {
    const kf = autozone().keyFindings;
    expect(kf.length).toBeGreaterThan(3);
    expect(kf.join(' ')).toMatch(/OFEI/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/test/takeoffParse.test.ts`
Expected: FAIL — unresolved rows are absent (the current `continue` drops them), `categoryRaw`/`subcategories`/`keyFindings` are undefined.

- [ ] **Step 4: Update the types**

In `backend/src/utils/takeoffParse.ts`, replace the three exported interfaces:

```ts
export interface TakeoffLineItem {
  category: string;
  // The header exactly as written, before normalizeCategory collapses qualifiers.
  // A car wash splits "BRANCH POWER — CAR WASH EQUIPMENT" out of plain "BRANCH POWER";
  // collapsing is right for lining two jobs up, but the split IS the cost driver, so
  // the raw name has to survive.
  categoryRaw: string;
  description: string;
  unit: string;
  // null when the sheet states VERIFY / NONE IDENTIFIED rather than a count. These are
  // the highest-risk, usually highest-dollar rows; dropping them made a category read
  // as empty and produced a fabricated -100% delta against a comp that had counts.
  qty: number | null;
  qtyRaw?: string;
  confidence?: 'FIRM' | 'APPROX' | 'VERIFY';
  qtyLow?: number;
  qtyHigh?: number;
  notes?: string;
}

export interface TakeoffSubcategory {
  name: string;
  itemCount: number;
  totals: Record<string, number>;
}

export interface TakeoffCategory {
  name: string;
  itemCount: number;
  unresolvedCount: number;
  totals: Record<string, number>;
  subcategories: TakeoffSubcategory[];
}

export interface ParsedTakeoff {
  sqFt: number | null;
  price: number | null;
  categories: TakeoffCategory[];
  lineItems: TakeoffLineItem[];
  keyFindings: string[];
}
```

- [ ] **Step 5: Widen the notes header match and add the confidence column**

In `findColumnMap`, replace the notes branch and add a confidence branch:

```ts
      else if (!notes && /(^NOTES?$)|(^(SOURCE|BASIS).*NOTES?$)/.test(v)) notes = col;
      else if (!conf && /^(CONF\.?|CONFIDENCE)$/.test(v)) conf = col;
```

Declare `conf` alongside the other locals (`let desc, unit, qty, notes, conf: string | undefined`), return it in the map object, and widen the return type to include `conf?: string`.

- [ ] **Step 6: Retain unresolved rows and capture confidence, ranges and raw category**

In `parseSheet`, replace the quantity guard and the `out.push` with:

```ts
    const description = row[map.desc];
    const qtyRaw = map.qty ? row[map.qty] : undefined;
    if (!description || qtyRaw === undefined) continue;
    if (/^(ITEM|DESCRIPTION|QTY|UNIT|CONF\.?)$/i.test(description.trim())) continue;

    const parsedQty = Number(String(qtyRaw).replace(/,/g, ''));
    const qty = Number.isFinite(parsedQty) ? parsedQty : null;
    const notes = map.notes ? row[map.notes]?.trim() : undefined;

    const confRaw = (map.conf ? row[map.conf] : '')?.trim().toUpperCase();
    const confidence = confRaw === 'FIRM' || confRaw === 'APPROX' || confRaw === 'VERIFY'
      ? confRaw as 'FIRM' | 'APPROX' | 'VERIFY'
      : undefined;

    // "…visual count of chained runs — range 58–70." Both dash forms occur.
    const rangeM = notes?.match(/range\s+(\d[\d,]*)\s*[–—-]\s*(\d[\d,]*)/i);
    const num = (s: string) => Number(s.replace(/,/g, ''));

    out.push({
      category,
      categoryRaw,
      description: description.trim(),
      unit: (map.unit ? row[map.unit] : '')?.trim() || 'EA',
      qty,
      qtyRaw: qty === null ? String(qtyRaw).trim() : undefined,
      confidence,
      qtyLow: rangeM ? num(rangeM[1]) : undefined,
      qtyHigh: rangeM ? num(rangeM[2]) : undefined,
      notes,
    });
```

Track the raw heading next to the normalized one. Where `parseSheet` currently assigns `category`, set both:

```ts
  let category = 'Uncategorized';
  let categoryRaw = 'Uncategorized';
  // …
    if (catM && isAlone) {
      categoryRaw = catM[2].trim();
      category = normalizeCategory(catM[2]);
      continue;
    }
    if (isAlone && seenHeader && looksLikeBareHeading(cells[0].val)) {
      categoryRaw = cells[0].val.trim();
      category = normalizeCategory(cells[0].val);
      continue;
    }
```

- [ ] **Step 7: Build the rollup with subcategories, and capture key findings**

Replace the rollup block at the end of `parseTakeoffWorkbook`:

```ts
  const byCategory = new Map<string, TakeoffCategory>();
  const subIndex = new Map<string, Map<string, TakeoffSubcategory>>();

  for (const item of lineItems) {
    let cat = byCategory.get(item.category);
    if (!cat) {
      cat = { name: item.category, itemCount: 0, unresolvedCount: 0, totals: {}, subcategories: [] };
      byCategory.set(item.category, cat);
      subIndex.set(item.category, new Map());
    }
    cat.itemCount += 1;

    const subs = subIndex.get(item.category)!;
    let sub = subs.get(item.categoryRaw);
    if (!sub) { sub = { name: item.categoryRaw, itemCount: 0, totals: {} }; subs.set(item.categoryRaw, sub); }
    sub.itemCount += 1;

    // Unresolved rows are counted, never summed — a VERIFY must not read as a zero.
    if (item.qty === null) { cat.unresolvedCount += 1; continue; }
    cat.totals[item.unit] = (cat.totals[item.unit] ?? 0) + item.qty;
    sub.totals[item.unit] = (sub.totals[item.unit] ?? 0) + item.qty;
  }

  for (const [name, subs] of subIndex) byCategory.get(name)!.subcategories = [...subs.values()];

  return { sqFt, price, categories: [...byCategory.values()], lineItems, keyFindings };
```

Extract `keyFindings` from the trailing narrative. Add this before the rollup, reusing `allText` already computed for the sq-ft scan:

```ts
  // Everything after "LEGEND & KEY FINDINGS" is prose: the confidence key, the counting
  // methodology, and which sheets were missing from the reviewed set. Worth keeping —
  // it is the estimator's read on how much to trust the counts.
  const keyFindings: string[] = [];
  const kfIdx = allText.search(/LEGEND\s*&\s*KEY FINDINGS/i);
  if (kfIdx >= 0) {
    for (const line of allText.slice(kfIdx).split('\n').slice(1)) {
      const t = line.trim();
      if (t) keyFindings.push(t);
    }
  }
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/test/takeoffParse.test.ts && npm run typecheck`
Expected: 10 passed. Typecheck will fail in `preconstruction.ts` if anything consumed `qty` as a plain number — fix by skipping nulls, never by coercing.

- [ ] **Step 9: Verify the `final` path did not regress**

Run: `cd backend && npm test`
Expected: all suites pass. Finished-bid workbooks have no `CONF.` column and all-numeric quantities, so their parse output is unchanged apart from the additive fields.

- [ ] **Step 10: Commit**

```bash
git add backend/src/utils/takeoffParse.ts backend/src/test/takeoffParse.test.ts backend/src/test/fixtures/prebid
git commit -m "fix: stop takeoff parser dropping unresolved quantity rows

Rows whose QTY reads VERIFY or NONE IDENTIFIED were discarded outright,
losing seven line items on the AutoZone pre-bid including all three
site and exterior lighting lines. A category then stored as empty and
compared against a job with real counts as a fabricated -100% delta.

Unresolved rows are now retained with qty null and counted separately
from totals. Also captures the CONF. column, stated ranges, notes from a
SOURCE / BASIS / NOTES header, the key-findings narrative, and the raw
category name so job-type splits survive normalization as subcategories.

Test fixtures are redacted copies of real Cowork output: contact names,
phone numbers, emails and addresses replaced with placeholders."
```

---

### Task 3: Pre-bid scope document parser

**Files:**
- Create: `backend/src/utils/prebidScopeParse.ts`
- Create: `backend/src/test/prebidScopeParse.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces:
  ```ts
  export interface PrebidScopeSection { id: string; title: string; items: string[] }
  export interface ParsedPrebidScope {
    meta: Record<string, string>;
    furnishModel: 'OFEI' | 'ECFECI' | 'mixed' | null;
    furnishNote: string | null;
    generalItems: string[];
    sections: PrebidScopeSection[];
    suggestedBrand: string | null;
  }
  export function parsePrebidScope(buf: Buffer): ParsedPrebidScope;
  ```

- [ ] **Step 1: Write the failing tests**

Create `backend/src/test/prebidScopeParse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePrebidScope } from '../utils/prebidScopeParse';

const fixture = (n: string) => readFileSync(join(__dirname, 'fixtures/prebid', n));
const autozone = () => parsePrebidScope(fixture('autozone_scope.docx'));

describe('parsePrebidScope', () => {
  it('extracts the six lettered sections with their items', () => {
    const s = autozone().sections;
    expect(s.map(x => x.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(s[0].title).toMatch(/Service & Distribution/);
    expect(s[0].items.length).toBeGreaterThan(2);
  });

  it('classifies the furnish model as OFEI and keeps the source paragraph', () => {
    const p = autozone();
    expect(p.furnishModel).toBe('OFEI');
    expect(p.furnishNote).toMatch(/Owner Furnished|OFEI/i);
  });

  it('reads the header metadata block', () => {
    const m = autozone().meta;
    expect(m['GC']).toMatch(/Summit/);
    expect(m['Job Number']).toBeTruthy();
  });

  it('decodes XML entities in item text', () => {
    const joined = autozone().sections.flatMap(s => s.items).join(' ');
    expect(joined).not.toMatch(/&amp;|&apos;|&quot;/);
    expect(joined).toMatch(/&/);
  });

  it('collects the general items that precede the lettered sections', () => {
    expect(autozone().generalItems.some(i => /permit/i.test(i))).toBe(true);
  });

  it('suggests a brand from the Re: line', () => {
    expect(autozone().suggestedBrand).toMatch(/AutoZone/);
  });

  it('parses the other two current-generation documents to the same shape', () => {
    for (const f of ['indianoaks_scope.docx', 'nickmoes_scope.docx']) {
      const p = parsePrebidScope(fixture(f));
      expect(p.sections.map(s => s.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
      expect(p.sections.every(s => s.items.length > 0)).toBe(true);
    }
  });

  it('returns an empty shape rather than throwing on a non-docx buffer', () => {
    const p = parsePrebidScope(Buffer.from('not a zip'));
    expect(p.sections).toEqual([]);
    expect(p.furnishModel).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/test/prebidScopeParse.test.ts`
Expected: FAIL — `Cannot find module '../utils/prebidScopeParse'`.

- [ ] **Step 3: Write the parser**

Create `backend/src/utils/prebidScopeParse.ts`:

```ts
// Parses the Cowork pre-bid scope document (<Job>_PreBid_Scope.docx) into structured
// sections, the header metadata block, and the furnish-model classification.
//
// Deliberately does NOT reuse extractDocxText from bidDocParse: that flattens the
// document to plain text and discards w:pStyle, which is what separates a section
// heading from the bullets under it. Reading paragraphs with their style keeps the
// two apart without guessing from punctuation.
//
// Targets the current generation of Cowork output (2026-07 onward: ListParagraph
// bullets, lettered A-F sections, a Label: value header block). The superseded
// 2025 format (Heading1/ListBullet, seven differently-named sections, inline
// [MEP Plans | PDF] citations) is out of scope and degrades to an empty result.
import AdmZip from 'adm-zip';

export interface PrebidScopeSection {
  id: string;
  title: string;
  items: string[];
}

export interface ParsedPrebidScope {
  meta: Record<string, string>;
  furnishModel: 'OFEI' | 'ECFECI' | 'mixed' | null;
  furnishNote: string | null;
  generalItems: string[];
  sections: PrebidScopeSection[];
  suggestedBrand: string | null;
}

interface DocxParagraph { style: string; text: string }

const EMPTY: ParsedPrebidScope = {
  meta: {}, furnishModel: null, furnishNote: null,
  generalItems: [], sections: [], suggestedBrand: null,
};

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Ordered paragraphs with their style name, so headings stay distinguishable from bullets. */
export function extractDocxParagraphs(buf: Buffer): DocxParagraph[] {
  let xml: string;
  try {
    const entry = new AdmZip(buf).getEntry('word/document.xml');
    if (!entry) return [];
    xml = entry.getData().toString('utf8');
  } catch {
    return [];
  }

  const out: DocxParagraph[] = [];
  for (const para of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const text = decodeEntities(
      [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('')
    ).trim();
    if (!text) continue;
    out.push({ style: /w:pStyle w:val="([^"]+)"/.exec(para)?.[1] ?? '', text });
  }
  return out;
}

const isBullet = (p: DocxParagraph) => /List/i.test(p.style);
const SECTION_RE = /^([A-Z])\.\s+(.{3,80})$/;
const META_RE = /^([A-Z][A-Za-z ()./]{1,30}):\s*(.+)$/;

export function parsePrebidScope(buf: Buffer): ParsedPrebidScope {
  const paras = extractDocxParagraphs(buf);
  if (!paras.length) return { ...EMPTY };

  const meta: Record<string, string> = {};
  const generalItems: string[] = [];
  const sections: PrebidScopeSection[] = [];
  let furnishNote: string | null = null;
  let current: PrebidScopeSection | null = null;
  let inScope = false;
  let awaitingFurnishNote = false;

  for (const p of paras) {
    if (!inScope && /^SCOPE OF WORK$/i.test(p.text)) { inScope = true; continue; }

    // The deviation block is a heading followed by one or more prose paragraphs. Collect
    // them until the next heading so a two-paragraph note isn't truncated to its first half.
    if (/SCOPE DEVIATION|ESTIMATING NOTE/i.test(p.text) && !isBullet(p)) {
      awaitingFurnishNote = true;
      continue;
    }
    if (awaitingFurnishNote) {
      if (isBullet(p) || SECTION_RE.test(p.text) || /^SCOPE OF WORK$/i.test(p.text)) {
        awaitingFurnishNote = false;
      } else {
        furnishNote = furnishNote ? `${furnishNote}\n\n${p.text}` : p.text;
        continue;
      }
    }

    const sectionM = !isBullet(p) && SECTION_RE.exec(p.text);
    if (sectionM) {
      current = { id: sectionM[1], title: sectionM[2].trim(), items: [] };
      sections.push(current);
      inScope = true;
      continue;
    }

    if (isBullet(p)) {
      (current ? current.items : generalItems).push(p.text);
      continue;
    }

    if (!inScope) {
      const metaM = META_RE.exec(p.text);
      if (metaM) meta[metaM[1].trim()] = metaM[2].trim();
    }
  }

  const note = furnishNote ?? '';
  const ofei = /\bOFEI\b|Owner Furnished/i.test(note);
  const ecfeci = /\bECFECI\b/i.test(note);
  const furnishModel: ParsedPrebidScope['furnishModel'] =
    ofei && ecfeci ? 'mixed' : ofei ? 'OFEI' : ecfeci ? 'ECFECI' : null;

  // "Re: AutoZone Store #11074 — Tavares, FL (Electrical Pre-Bid Package)" -> "AutoZone".
  // First token run before a store number, dash or parenthesis; suggestion only, never
  // written to bids.brand automatically.
  const re = meta['Re'] ?? '';
  const brandM = /^([A-Za-z][A-Za-z'&.\- ]{1,40}?)(?:\s+(?:Store|#)|\s*[—–(-]|$)/.exec(re.trim());
  const suggestedBrand = brandM ? brandM[1].trim() : null;

  return { meta, furnishModel, furnishNote, generalItems, sections, suggestedBrand };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/test/prebidScopeParse.test.ts && npm run typecheck`
Expected: 8 passed, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/prebidScopeParse.ts backend/src/test/prebidScopeParse.test.ts
git commit -m "feat: parse the Cowork pre-bid scope document

Reads paragraphs with their w:pStyle so section headings stay separable
from bullets, which extractDocxText cannot do since it flattens to text.
Extracts the header metadata block, the lettered sections, the general
items, and classifies the furnish model from the scope-deviation note.
Targets the current Cowork generation; the superseded 2025 format
degrades to an empty result rather than mis-parsing."
```

---

### Task 4: Import route

**Files:**
- Modify: `backend/src/routes/preconstruction.ts`
- Modify: `backend/src/utils/storeDocument.ts:13-25` (`CATEGORY_TO_FOLDER`)
- Test: `backend/src/test/prebid.test.ts` (append)

**Interfaces:**
- Consumes: `parseTakeoffWorkbook` (Task 2), `parsePrebidScope` (Task 3), schema from Task 1.
- Produces: `POST /api/preconstruction/:bidId/import-prebid` returning
  `{ takeoff: { categories, itemCount, unresolvedCount } | null, scope: { sections, furnishModel } | null, sqFtApplied: boolean, suggestedBrand: string | null }`;
  `GET /api/preconstruction/:bidId/prebid` returning `{ takeoff, scope }` or nulls.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/test/prebid.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const fx = (n: string) => join(__dirname, 'fixtures/prebid', n);

describe('import-prebid', () => {
  it('imports takeoff and scope, and fills sq_ft when empty', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Imp ${Date.now()}`, gc: 'G', project_type: 'retail' }).expect(200);

    const r = await request(app)
      .post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .attach('takeoff', fx('autozone_takeoff.xlsx'))
      .attach('scope', fx('autozone_scope.docx'))
      .expect(200);

    expect(r.body.takeoff.itemCount).toBeGreaterThan(30);
    expect(r.body.takeoff.unresolvedCount).toBeGreaterThanOrEqual(6);
    expect(r.body.scope.furnishModel).toBe('OFEI');
    expect(r.body.sqFtApplied).toBe(true);
    expect(r.body.suggestedBrand).toMatch(/AutoZone/);

    const { rows } = await pool.query('SELECT sq_ft, brand FROM bids WHERE id=$1', [bid.body.id]);
    expect(Number(rows[0].sq_ft)).toBe(7381);
    expect(rows[0].brand).toBeNull();          // suggested, never auto-written
  });

  it('never overwrites an existing sq_ft', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Sq ${Date.now()}`, gc: 'G', sq_ft: 1234 }).expect(200);
    const r = await request(app)
      .post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .attach('takeoff', fx('autozone_takeoff.xlsx')).expect(200);
    expect(r.body.sqFtApplied).toBe(false);
    const { rows } = await pool.query('SELECT sq_ft FROM bids WHERE id=$1', [bid.body.id]);
    expect(Number(rows[0].sq_ft)).toBe(1234);
  });

  it('accepts a scope document alone', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `ScopeOnly ${Date.now()}`, gc: 'G' }).expect(200);
    const r = await request(app)
      .post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .attach('scope', fx('autozone_scope.docx')).expect(200);
    expect(r.body.takeoff).toBeNull();
    expect(r.body.scope.sections).toHaveLength(6);
  });

  it('rejects a request with neither file', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `None ${Date.now()}`, gc: 'G' }).expect(200);
    await request(app)
      .post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .expect(400);
  });

  it('does not disturb a final takeoff on the same bid', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Both ${Date.now()}`, gc: 'G' }).expect(200);
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'final','[]'::jsonb,'[]'::jsonb,99)`, [bid.body.id]
    );
    await request(app)
      .post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .attach('takeoff', fx('autozone_takeoff.xlsx')).expect(200);
    const { rows } = await pool.query(
      `SELECT item_count FROM bid_takeoffs WHERE bid_id=$1 AND kind='final'`, [bid.body.id]
    );
    expect(Number(rows[0].item_count)).toBe(99);
  });

  it('reads the package back', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Read ${Date.now()}`, gc: 'G' }).expect(200);
    await request(app).post(`/api/preconstruction/${bid.body.id}/import-prebid`).set(auth(u.token))
      .attach('takeoff', fx('autozone_takeoff.xlsx'))
      .attach('scope', fx('autozone_scope.docx')).expect(200);
    const r = await request(app)
      .get(`/api/preconstruction/${bid.body.id}/prebid`).set(auth(u.token)).expect(200);
    expect(r.body.takeoff.categories.length).toBeGreaterThan(5);
    expect(r.body.scope.furnish_model).toBe('OFEI');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/test/prebid.test.ts`
Expected: FAIL with 404 — the routes do not exist.

- [ ] **Step 3: Route the new document categories to Drive folders**

In `backend/src/utils/storeDocument.ts`, add to `CATEGORY_TO_FOLDER` so both land in the estimates folder beside `takeoff` and `cost_breakdown`:

```ts
  prebid_takeoff: 'drive_estimates_folder_id',
  prebid_scope:   'drive_estimates_folder_id',
```

- [ ] **Step 4: Add the import and read routes**

In `backend/src/routes/preconstruction.ts`, import the scope parser alongside the takeoff one:

```ts
import { parsePrebidScope } from '../utils/prebidScopeParse';
```

Add both routes near `/import-bid`:

```ts
// POST import-prebid — the Cowork pre-bid package: a scope .docx and a quantity .xlsx
// produced right after a bid invite is accepted, before any pricing exists. Stored under
// kind='prebid' so a later finished-bid import cannot overwrite it; the pre-bid set is
// the comparison corpus and is the only takeoff data most jobs will ever have.
router.post('/:bidId/import-prebid', requireAuth, documentUpload.fields([
  { name: 'takeoff', maxCount: 1 },
  { name: 'scope', maxCount: 1 },
]), asyncHandler(async (req: AuthRequest, res) => {
  const { bidId } = req.params;
  const bid = await loadAccessibleBid(res, req.user!, bidId);
  if (!bid) return;

  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const takeoffFile = files?.takeoff?.[0];
  const scopeFile = files?.scope?.[0];
  if (!takeoffFile && !scopeFile) {
    return res.status(400).json({ error: 'takeoff or scope file required' });
  }

  const ext = (f: Express.Multer.File) => (f.originalname.split('.').pop() || '').toLowerCase();
  if (takeoffFile && ext(takeoffFile) !== 'xlsx') {
    return res.status(400).json({ error: 'takeoff must be .xlsx' });
  }
  if (scopeFile && ext(scopeFile) !== 'docx') {
    return res.status(400).json({ error: 'scope must be .docx' });
  }

  // Keep the upload even if parsing fails — an unreadable file is still the estimator's
  // document, and losing it is worse than a failed import.
  const keep = (f: Express.Multer.File, category: string) =>
    storeDocument({
      file: f, linkedId: bidId, linkedName: bid.name, div: 'elec', category,
      uploadedBy: req.user!.name, replaceExisting: true,
    }).catch(err => { logger.error({ err, bidId, category }, '[import-prebid] document store failed'); return null; });

  let takeoffSummary: { categories: unknown[]; itemCount: number; unresolvedCount: number } | null = null;
  let parsedSqFt: number | null = null;

  if (takeoffFile) {
    await keep(takeoffFile, 'prebid_takeoff');
    const t = parseTakeoffWorkbook(takeoffFile.buffer);
    parsedSqFt = t.sqFt;
    if (t.lineItems.length) {
      await pool.query(
        `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count, key_findings, source_file, updated_at)
         VALUES ($1,'prebid',$2::jsonb,$3::jsonb,$4,$5::jsonb,$6,now())
         ON CONFLICT (bid_id, kind) DO UPDATE SET
           categories=$2::jsonb, line_items=$3::jsonb, item_count=$4,
           key_findings=$5::jsonb, source_file=$6, updated_at=now()`,
        [bidId, JSON.stringify(t.categories), JSON.stringify(t.lineItems),
         t.lineItems.length, JSON.stringify(t.keyFindings), takeoffFile.originalname]
      );
      takeoffSummary = {
        categories: t.categories,
        itemCount: t.lineItems.length,
        unresolvedCount: t.lineItems.filter(i => i.qty === null).length,
      };
    }
  }

  let scopeSummary: { sections: unknown[]; furnishModel: string | null } | null = null;
  let suggestedBrand: string | null = null;

  if (scopeFile) {
    await keep(scopeFile, 'prebid_scope');
    const s = parsePrebidScope(scopeFile.buffer);
    suggestedBrand = s.suggestedBrand;
    await pool.query(
      `INSERT INTO bid_prebid_scope (bid_id, meta, furnish_model, furnish_note,
         general_items, sections, source_file, updated_at)
       VALUES ($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7,now())
       ON CONFLICT (bid_id) DO UPDATE SET
         meta=$2::jsonb, furnish_model=$3, furnish_note=$4, general_items=$5::jsonb,
         sections=$6::jsonb, source_file=$7, updated_at=now()`,
      [bidId, JSON.stringify(s.meta), s.furnishModel, s.furnishNote,
       JSON.stringify(s.generalItems), JSON.stringify(s.sections), scopeFile.originalname]
    );
    scopeSummary = { sections: s.sections, furnishModel: s.furnishModel };
  }

  // Comparable matching ranks on square footage, so a bid without one cannot be compared
  // at all. Fill it from the parsed header when absent — but never overwrite a value a
  // human entered, which may be the leasable area rather than the gross footprint.
  let sqFtApplied = false;
  if (parsedSqFt && (bid.sq_ft === null || bid.sq_ft === undefined)) {
    await pool.query('UPDATE bids SET sq_ft=$2 WHERE id=$1 AND sq_ft IS NULL', [bidId, parsedSqFt]);
    sqFtApplied = true;
  }

  // brand is returned as a suggestion only. It outranks project_type in comp ranking, so
  // a wrong auto-set would silently skew every future comparison on this job.
  res.json({ takeoff: takeoffSummary, scope: scopeSummary, sqFtApplied, suggestedBrand });
}));

// GET prebid — the stored package for this bid, for the Pre-Bid tab.
router.get('/:bidId/prebid', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  if (!(await loadAccessibleBid(res, req.user!, req.params.bidId))) return;
  const [takeoff, scope] = await Promise.all([
    pool.query(
      `SELECT categories, line_items, item_count, key_findings, source_file
         FROM bid_takeoffs WHERE bid_id=$1 AND kind='prebid'`, [req.params.bidId]),
    pool.query('SELECT * FROM bid_prebid_scope WHERE bid_id=$1', [req.params.bidId]),
  ]);
  res.json({ takeoff: takeoff.rows[0] ?? null, scope: scope.rows[0] ?? null });
}));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/test/prebid.test.ts && npm run typecheck`
Expected: 10 passed, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/preconstruction.ts backend/src/utils/storeDocument.ts backend/src/test/prebid.test.ts
git commit -m "feat: import the pre-bid package against a bid

Accepts the scope .docx and takeoff .xlsx together or singly, stores the
takeoff under kind='prebid' so a finished-bid import cannot overwrite it,
and files both originals as documents.

Fills bids.sq_ft from the parsed header only when it is null, since comp
matching ranks on square footage and cannot run without it. Brand is
returned as a suggestion and never written: it outranks project_type in
comp ranking, so a wrong value would silently skew every comparison."
```

---

### Task 5: Comparison endpoints

**Files:**
- Modify: `backend/src/routes/preconstruction.ts` (three joins, plus two route changes)
- Test: `backend/src/test/prebid.test.ts` (append)

**Interfaces:**
- Consumes: schema from Task 1, import route from Task 4.
- Produces: `GET /:bidId/prebid-comparables` → `{ bid: {...}, comparables: [{ id, name, gc, stage, brand, project_type, sq_ft, amount, sq_ft_delta_pct }] }`; `GET /:bidId/compare?kind=prebid|final` (default `final`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/test/prebid.test.ts`:

```ts
describe('prebid comparables', () => {
  it('matches unpriced jobs that have a prebid takeoff', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const type = `t_${Date.now()}`;

    const comp = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Comp ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 5000 }).expect(200);
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'prebid','[]'::jsonb,'[]'::jsonb,5)`, [comp.body.id]
    );

    const subj = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Subj ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 7500 }).expect(200);

    const r = await request(app)
      .get(`/api/preconstruction/${subj.body.id}/prebid-comparables`).set(auth(u.token)).expect(200);

    const hit = r.body.comparables.find((c: { id: string }) => c.id === comp.body.id);
    expect(hit).toBeTruthy();                       // matched despite amount being null
    expect(Math.round(hit.sq_ft_delta_pct)).toBe(50); // 7500 vs 5000
  });

  it('excludes jobs with no prebid takeoff', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const type = `t2_${Date.now()}`;
    const bare = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Bare ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 4000 }).expect(200);
    const subj = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `S2 ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 4200 }).expect(200);
    const r = await request(app)
      .get(`/api/preconstruction/${subj.body.id}/prebid-comparables`).set(auth(u.token)).expect(200);
    expect(r.body.comparables.map((c: { id: string }) => c.id)).not.toContain(bare.body.id);
  });

  it('a bid with both kinds appears once in comparables', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const brand = `Dup${Date.now()}`;
    const other = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Dup ${Date.now()}`, gc: 'G', brand, amount: 100000, sq_ft: 4000 }).expect(200);
    for (const kind of ['prebid', 'final']) {
      await pool.query(
        `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
         VALUES ($1,$2,'[]'::jsonb,'[]'::jsonb,1)`, [other.body.id, kind]
      );
    }
    const subj = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `DupS ${Date.now()}`, gc: 'G', brand, amount: 90000 }).expect(200);
    const r = await request(app)
      .get(`/api/preconstruction/${subj.body.id}/comparables`).set(auth(u.token)).expect(200);
    const hits = r.body.comparables.filter((c: { id: string }) => c.id === other.body.id);
    expect(hits).toHaveLength(1);
  });

  it('compare selects rows by kind', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const subj = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `Cmp ${Date.now()}`, gc: 'G', sq_ft: 5000 }).expect(200);
    const comp = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `CmpC ${Date.now()}`, gc: 'G', sq_ft: 5000 }).expect(200);
    for (const id of [subj.body.id, comp.body.id]) {
      await pool.query(
        `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
         VALUES ($1,'prebid','[{"name":"LIGHTING","itemCount":2,"unresolvedCount":0,"totals":{"EA":10},"subcategories":[]}]'::jsonb,'[]'::jsonb,2)`,
        [id]
      );
    }
    const r = await request(app)
      .get(`/api/preconstruction/${subj.body.id}/compare?kind=prebid&against=${comp.body.id}`)
      .set(auth(u.token)).expect(200);
    expect(r.body.categoryNames).toContain('LIGHTING');
    expect(r.body.jobs).toHaveLength(2);
  });

  it('rep cannot pull another rep job into prebid comparables', async (ctx) => {
    if (!ok) return ctx.skip();
    const rep1 = await makeUser('salesperson');
    const rep2 = await makeUser('salesperson');
    const type = `t3_${Date.now()}`;
    const hidden = await request(app).post('/api/bids').set(auth(rep1.token))
      .send({ name: `H ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 5000 }).expect(200);
    await pool.query(
      `INSERT INTO bid_takeoffs (bid_id, kind, categories, line_items, item_count)
       VALUES ($1,'prebid','[]'::jsonb,'[]'::jsonb,1)`, [hidden.body.id]
    );
    const mine = await request(app).post('/api/bids').set(auth(rep2.token))
      .send({ name: `M ${Date.now()}`, gc: 'G', project_type: type, sq_ft: 5100 }).expect(200);
    const r = await request(app)
      .get(`/api/preconstruction/${mine.body.id}/prebid-comparables`).set(auth(rep2.token)).expect(200);
    expect(r.body.comparables.map((c: { id: string }) => c.id)).not.toContain(hidden.body.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/test/prebid.test.ts`
Expected: FAIL — `/prebid-comparables` 404s, and the duplicate-row test fails because the unfiltered join returns the bid twice.

- [ ] **Step 3: Add `kind` filters to the three existing joins**

In `backend/src/routes/preconstruction.ts`, every `LEFT JOIN bid_takeoffs bt ON bt.bid_id = b.id` must pin the kind, or a bid holding both takeoffs multiplies into two rows. There are three — in `/comparables-preview`, `/comparables`, and `/compare`. For the first two:

```sql
      LEFT JOIN bid_takeoffs bt ON bt.bid_id = b.id AND bt.kind = 'final'
```

For `/compare`, the kind is a parameter (Step 4).

- [ ] **Step 4: Make `/compare` kind-aware**

In the `/compare` handler, read the parameter and thread it into the join:

```ts
  const kind = req.query.kind === 'prebid' ? 'prebid' : 'final';
```

```sql
      LEFT JOIN bid_takeoffs bt ON bt.bid_id = b.id AND bt.kind = $3
```

Pass it as the third bind: `[ids, scope, kind]`. The `bid_cost_breakdown` join is untouched — cost breakdowns only ever come from a finished bid.

- [ ] **Step 5: Add the relaxed matcher**

Add near `/comparables`:

```ts
// GET prebid-comparables — comps for a pre-bid comparison. Same ranking as /comparables
// (same brand beats same project type, then nearest square footage), with one deliberate
// difference: the amount > 0 requirement is dropped. Pre-bid corpus jobs have not been
// priced yet, so requiring an amount would filter out exactly the rows this feature runs
// on. Candidates must instead carry a prebid takeoff, which is what there is to compare.
router.get('/:bidId/prebid-comparables', requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const bid = await loadAccessibleBid(res, req.user!, req.params.bidId);
  if (!bid) return;

  const scope = ownScopeId(req.user!);
  const { rows } = await pool.query(`
    SELECT b.id, b.name, b.gc, b.stage, b.brand, b.project_type, b.sq_ft, b.amount,
           b.updated_at, bt.item_count
      FROM bids b
      JOIN bid_takeoffs bt ON bt.bid_id = b.id AND bt.kind = 'prebid'
     WHERE b.id <> $1
       AND b.deleted_at IS NULL
       AND ($2::text IS NOT NULL AND b.brand = $2
            OR $3::text IS NOT NULL AND b.project_type = $3)
       AND ($5::uuid IS NULL OR b.salesperson_id = $5::uuid)
     ORDER BY ((($2::text IS NOT NULL) AND b.brand = $2)) DESC,
              CASE WHEN $4::numeric IS NULL OR b.sq_ft IS NULL THEN 1 ELSE 0 END,
              ABS(COALESCE(b.sq_ft, 0) - COALESCE($4::numeric, 0)),
              b.updated_at DESC
     LIMIT 25
  `, [bid.id, bid.brand, bid.project_type, bid.sq_ft, scope]);

  const subjectSqFt = bid.sq_ft != null ? Number(bid.sq_ft) : null;
  res.json({
    bid: { id: bid.id, name: bid.name, brand: bid.brand,
           project_type: bid.project_type, sq_ft: bid.sq_ft },
    comparables: rows.map(r => ({
      ...r,
      // How much bigger or smaller this job is than the comp, the headline number.
      sq_ft_delta_pct: subjectSqFt && r.sq_ft
        ? ((subjectSqFt - Number(r.sq_ft)) / Number(r.sq_ft)) * 100
        : null,
    })),
  });
}));
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/test/prebid.test.ts src/test/comparables.test.ts && npm run typecheck`
Expected: all pass — `comparables.test.ts` confirms the `kind` filters did not change existing behaviour.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/preconstruction.ts backend/src/test/prebid.test.ts
git commit -m "feat: pre-bid comparables and kind-aware compare

Pins kind='final' on the three existing bid_takeoffs joins so a bid
holding both takeoffs no longer multiplies into duplicate comparables.

Adds prebid-comparables, which deliberately drops the amount > 0 filter
the priced comparables list uses: pre-bid corpus jobs are unpriced by
definition, so requiring an amount would exclude every row the feature
depends on. Candidates must carry a prebid takeoff instead."
```

---

### Task 6: Scope of Work population

**Files:**
- Create: `frontend/src/features/preconstruction/prebidScope.ts`
- Create: `frontend/src/features/preconstruction/prebidScope.test.ts`
- Modify: `frontend/src/features/preconstruction/PcWorkspace.tsx` (autofill at `:362`, scope tab at `:1635`)

**Interfaces:**
- Consumes: `sections` from `GET /:bidId/prebid` (Task 4).
- Produces: `buildScopeFromPrebid(sections: PrebidSection[]): Record<string, string>` where `PrebidSection = { id: string; title: string; items: string[] }`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/preconstruction/prebidScope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildScopeFromPrebid } from './prebidScope';

const S = (id: string, title: string, items = ['x']) => ({ id, title, items });

describe('buildScopeFromPrebid', () => {
  it('maps by title, not by letter', () => {
    const out = buildScopeFromPrebid([
      S('D', 'Site Lighting, Underground Work & Allowances', ['pole bases']),
      S('E', 'Low Voltage Infrastructure (Conduit & Boxes Only)', ['empty conduit']),
    ]);
    // Cowork D is Site -> CRM F. Cowork E is Low Voltage -> CRM D. Never letter-aligned.
    expect(out.F).toContain('pole bases');
    expect(out.D).toContain('empty conduit');
    expect(out.E).toBeUndefined();
  });

  it('maps the straightforward sections', () => {
    const out = buildScopeFromPrebid([
      S('A', 'Service & Distribution', ['gear']),
      S('B', 'Branch Power', ['receptacles']),
      S('C', 'Lighting & Controls', ['fixtures']),
      S('F', 'Project Coordination & Closeout', ['commissioning']),
    ]);
    expect(out.A).toContain('gear');
    expect(out.B).toContain('receptacles');
    expect(out.C).toContain('fixtures');
    expect(out.G).toContain('commissioning');
  });

  it('resolves a job-type qualified heading to its base section', () => {
    const out = buildScopeFromPrebid([S('B', 'Branch Power — Car Wash Equipment', ['turbines'])]);
    expect(out.B).toContain('turbines');
  });

  it('appends an unrecognized section to G with its heading retained', () => {
    const out = buildScopeFromPrebid([S('H', 'Tunnel Conveyor Controls', ['vfd'])]);
    expect(out.G).toContain('Tunnel Conveyor Controls');
    expect(out.G).toContain('vfd');
  });

  it('leaves Fire Alarm untouched', () => {
    expect(buildScopeFromPrebid([S('A', 'Service & Distribution')]).E).toBeUndefined();
  });

  it('renders items as bullet lines and skips empty sections', () => {
    const out = buildScopeFromPrebid([S('A', 'Service & Distribution', ['one', 'two']), S('B', 'Branch Power', [])]);
    expect(out.A).toBe('• one\n• two');
    expect(out.B).toBeUndefined();
  });

  it('returns an empty object for no sections', () => {
    expect(buildScopeFromPrebid([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/preconstruction/prebidScope.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the mapping**

Create `frontend/src/features/preconstruction/prebidScope.ts`:

```ts
// Maps Cowork pre-bid scope sections into the CRM's Scope of Work sections (SCOPE_SECS).
//
// Mapping is by TITLE, never by letter. The two schemes collide: Cowork D is Site while
// CRM D is Low Voltage / Data, and Cowork E is Low Voltage while CRM E is Fire Alarm.
// Letter alignment would file site lighting under Low Voltage and low voltage under Fire
// Alarm — plausible-looking and wrong. buildScopeFromAgent2 in PcWorkspace.tsx already
// does the same kind of deliberate remapping for Agent 2 output.
export interface PrebidSection { id: string; title: string; items: string[] }

// Keys are normalized titles; values are SCOPE_SECS ids.
const TITLE_TO_SECTION: Record<string, string> = {
  'SERVICE & DISTRIBUTION': 'A',
  'BRANCH POWER': 'B',
  'LIGHTING & CONTROLS': 'C',
  'SITE LIGHTING, UNDERGROUND WORK & ALLOWANCES': 'F',
  'LOW VOLTAGE INFRASTRUCTURE': 'D',
  'PROJECT COORDINATION & CLOSEOUT': 'G',
};

// Same shape of normalization the takeoff categories use: drop a trailing parenthetical
// and any em/en-dash qualifier, so "Branch Power — Car Wash Equipment" and "Low Voltage
// Infrastructure (Conduit & Boxes Only)" still resolve. Sections are job-type dependent,
// so this has to tolerate wording it has never seen.
function normalizeTitle(raw: string): string {
  return raw
    .replace(/\s*\(.*\)\s*$/, '')
    .replace(/\s*[—–-]\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function buildScopeFromPrebid(sections: PrebidSection[]): Record<string, string> {
  const blocks: Record<string, string[]> = {};

  for (const sec of sections) {
    const items = (sec.items ?? []).map(i => i.trim()).filter(Boolean);
    if (!items.length) continue;

    const target = TITLE_TO_SECTION[normalizeTitle(sec.title)];
    const lines = items.map(i => `• ${i}`);

    // An unrecognized section keeps its heading and lands in G rather than being dropped:
    // an overloaded Special Systems box is a far better failure than missing scope.
    if (target) (blocks[target] ??= []).push(...lines);
    else (blocks.G ??= []).push(`${sec.title}:`, ...lines);
  }

  const out: Record<string, string> = {};
  for (const [id, lines] of Object.entries(blocks)) out[id] = lines.join('\n');
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/preconstruction/prebidScope.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Make the AI autofill non-destructive**

In `frontend/src/features/preconstruction/PcWorkspace.tsx` around line 362, the AI currently overwrites with `{ ...prev.scope, ...scopeFill }`. The pre-bid lands first, so this would silently replace the better Cowork text. Fill only empty sections:

```ts
        if (data?.status === 'complete') {
          setAiResults(data);
          const scopeFill = buildScopeFromAgent2(data?.agent2_output);
          set(prev => {
            // Only write sections the estimator hasn't already got text in. The pre-bid
            // package lands before analysis runs and its scope is the better source, so
            // the AI must not clobber it. The explicit "Import from AI Takeoff" button
            // still overwrites — that one is a deliberate choice.
            const merged = { ...prev.scope };
            let filled = 0;
            for (const [k, v] of Object.entries(scopeFill)) {
              if (!(merged[k] ?? '').trim()) { merged[k] = v; filled++; }
            }
            return {
              aiRunning: false, aiDone: true,
              scope: filled ? merged : prev.scope,
              aiLog: [...(prev.aiLog ?? []), filled
                ? '✓ Analysis complete — Scope of Work auto-filled. See Plan Review tab.'
                : '✓ Analysis complete — see Plan Review tab.'],
            };
          });
        } else if (data?.status === 'error') {
```

- [ ] **Step 6: Add the Import from Pre-Bid button**

In the `case 'scope':` block, add the import alongside the existing one. `prebidSections` comes from the `GET /:bidId/prebid` fetch wired in Task 7; declare it as component state defaulting to `[]`.

```tsx
        const importPrebid = () => {
          const fill = buildScopeFromPrebid(prebidSections);
          if (!Object.keys(fill).length) {
            showToast({ title: 'Nothing to import', sub: 'No scope sections found in the pre-bid package' });
            return;
          }
          set({ scope: { ...ws.scope, ...fill } });
          showToast({ title: 'Scope imported', sub: 'Filled from the pre-bid package — review and edit as needed' });
        };
```

Render it before the AI button inside the same flex row:

```tsx
              {prebidSections.length > 0 && (
                <button className="btn ghost" onClick={importPrebid} style={{ fontSize: 13, color: 'var(--blue)' }}
                  title="Fill these sections from the Cowork pre-bid scope. Existing text in sections the pre-bid doesn't cover is kept.">
                  <Icon name="spark" size={14} stroke={1.9}/> Import from Pre-Bid
                </button>
              )}
```

Import the helper at the top of the file:

```ts
import { buildScopeFromPrebid, PrebidSection } from './prebidScope';
```

- [ ] **Step 7: Run the frontend suite**

Run: `cd frontend && npm test && npm run typecheck`
Expected: all pass. `prebidSections` must be declared (Task 7 adds the fetch; for now `const [prebidSections, setPrebidSections] = useState<PrebidSection[]>([]);` is enough to typecheck).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/preconstruction/prebidScope.ts frontend/src/features/preconstruction/prebidScope.test.ts frontend/src/features/preconstruction/PcWorkspace.tsx
git commit -m "feat: populate Scope of Work from the pre-bid package

Maps Cowork sections into SCOPE_SECS by title rather than letter. The two
schemes collide -- Cowork D is Site while CRM D is Low Voltage, Cowork E
is Low Voltage while CRM E is Fire Alarm -- so letter alignment would
file site lighting under Low Voltage and low voltage under Fire Alarm.
Unrecognized sections land in G with their heading rather than vanishing.

Also makes the AI autofill fill-blanks-only. The pre-bid arrives before
plan analysis runs, so the old spread merge would have silently replaced
the Cowork scope with Agent 2 output."
```

---

### Task 7: Pre-Bid tab

**Files:**
- Create: `frontend/src/features/preconstruction/PreBidTab.tsx`
- Create: `frontend/src/features/preconstruction/PreBidTab.test.tsx`
- Modify: `frontend/src/features/preconstruction/constants.ts:13-30`
- Modify: `frontend/src/features/preconstruction/PcWorkspace.tsx` (tab case, prebid fetch)
- Modify: `frontend/src/App.tsx:102-112`
- Modify: `frontend/src/components/RecordFiles.tsx:19-31`

**Interfaces:**
- Consumes: `GET /:bidId/prebid`, `POST /:bidId/import-prebid`, `GET /:bidId/prebid-comparables`, `GET /:bidId/compare?kind=prebid`.
- Produces: `<PreBidTab bidId={string} onSectionsLoaded={(s: PrebidSection[]) => void} />`; `PcTabKey` includes `'prebid'`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/preconstruction/PreBidTab.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import PreBidTab from './PreBidTab';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
vi.mock('../../api/client', () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

const pkg = {
  takeoff: {
    item_count: 49,
    categories: [
      { name: 'EXTERIOR / SITE LIGHTING', itemCount: 3, unresolvedCount: 3, totals: {},
        subcategories: [{ name: 'EXTERIOR / SITE LIGHTING', itemCount: 3, totals: {} }] },
      { name: 'BRANCH POWER', itemCount: 4, unresolvedCount: 1, totals: { EA: 6 },
        subcategories: [
          { name: 'BRANCH POWER — BUILDING', itemCount: 2, totals: { EA: 6 } },
          { name: 'BRANCH POWER — CAR WASH EQUIPMENT', itemCount: 2, totals: {} },
        ] },
    ],
    line_items: [
      { category: 'EXTERIOR / SITE LIGHTING', description: 'Site Light Pole', unit: 'EA',
        qty: null, qtyRaw: 'VERIFY', confidence: 'VERIFY', notes: 'Per photometric plan' },
    ],
    key_findings: ['Confidence key:'],
  },
  scope: {
    furnish_model: 'OFEI',
    furnish_note: 'This project is Owner Furnished / EC Installed for gear and lighting.',
    meta: { GC: 'Summit General Contractors' },
    sections: [{ id: 'A', title: 'Service & Distribution', items: ['gear'] }],
  },
};

describe('PreBidTab', () => {
  it('shows the OFEI banner when the job is owner-furnished', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/prebid-comparables') ? { comparables: [] } : pkg }));
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/Owner Furnished/i)).toBeTruthy());
    expect(screen.getByText(/OFEI/)).toBeTruthy();
  });

  it('lists unresolved items as the risk list', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/prebid-comparables') ? { comparables: [] } : pkg }));
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Site Light Pole')).toBeTruthy());
    expect(screen.getByText('VERIFY')).toBeTruthy();
  });

  it('flags a subcategory present on one side only as a cost driver', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/prebid-comparables') ? { comparables: [] } : pkg }));
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/CAR WASH EQUIPMENT/)).toBeTruthy());
  });

  it('renders the size delta against a comparable', async () => {
    get.mockImplementation((url: string) => Promise.resolve({
      data: url.includes('/prebid-comparables')
        ? { bid: { id: 'b1', sq_ft: 7500 },
            comparables: [{ id: 'c1', name: 'Indian Oaks', sq_ft: 5000, project_type: 'self_storage',
                            stage: 'due', sq_ft_delta_pct: 50 }] }
        : pkg,
    }));
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText('Indian Oaks')).toBeTruthy());
    expect(screen.getByText(/50%\s*larger/i)).toBeTruthy();
  });

  it('prompts for upload when no package exists', async () => {
    get.mockResolvedValue({ data: { takeoff: null, scope: null } });
    render(<PreBidTab bidId="b1" onSectionsLoaded={() => {}}/>);
    await waitFor(() => expect(screen.getByText(/Upload the pre-bid package/i)).toBeTruthy());
  });

  it('hands parsed sections up so the Scope tab can import them', async () => {
    get.mockImplementation((url: string) =>
      Promise.resolve({ data: url.includes('/prebid-comparables') ? { comparables: [] } : pkg }));
    const onSectionsLoaded = vi.fn();
    render(<PreBidTab bidId="b1" onSectionsLoaded={onSectionsLoaded}/>);
    await waitFor(() => expect(onSectionsLoaded).toHaveBeenCalledWith(pkg.scope.sections));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/preconstruction/PreBidTab.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `frontend/src/features/preconstruction/PreBidTab.tsx`. Follow the existing panel markup (`className="panel"` / `panel-hdr` / `panel-title`) used throughout `PcWorkspace.tsx`, and read data through `api` from `../../api/client`.

```tsx
import { useEffect, useState } from 'react';
import api from '../../api/client';
import { PrebidSection } from './prebidScope';

interface Subcategory { name: string; itemCount: number; totals: Record<string, number> }
interface Category {
  name: string; itemCount: number; unresolvedCount: number;
  totals: Record<string, number>; subcategories: Subcategory[];
}
interface LineItem {
  category: string; description: string; unit: string;
  qty: number | null; qtyRaw?: string; confidence?: string; notes?: string;
}
interface Comparable {
  id: string; name: string; sq_ft: number | null; project_type: string | null;
  stage: string; sq_ft_delta_pct: number | null;
}

export default function PreBidTab({ bidId, onSectionsLoaded }: {
  bidId: string;
  onSectionsLoaded: (s: PrebidSection[]) => void;
}) {
  const [pkg, setPkg] = useState<{ takeoff: null | {
    item_count: number; categories: Category[]; line_items: LineItem[]; key_findings: string[];
  }; scope: null | {
    furnish_model: string | null; furnish_note: string | null;
    meta: Record<string, string>; sections: PrebidSection[];
  } } | null>(null);
  const [comps, setComps] = useState<Comparable[]>([]);
  const [selected, setSelected] = useState<Comparable | null>(null);

  useEffect(() => {
    api.get(`/preconstruction/${bidId}/prebid`).then(r => {
      setPkg(r.data);
      if (r.data?.scope?.sections) onSectionsLoaded(r.data.scope.sections);
    });
    api.get(`/preconstruction/${bidId}/prebid-comparables`)
      .then(r => setComps(r.data?.comparables ?? []))
      .catch(() => setComps([]));
  }, [bidId, onSectionsLoaded]);

  if (!pkg) return <div style={{ padding: '20px 24px' }}>Loading…</div>;

  const takeoff = pkg.takeoff;
  const scope = pkg.scope;

  if (!takeoff && !scope) {
    return (
      <div style={{ padding: '20px 24px' }}>
        <div className="panel"><div style={{ padding: 16 }}>
          Upload the pre-bid package (scope .docx and quantity takeoff .xlsx) to compare
          this job against similar past bids.
        </div></div>
      </div>
    );
  }

  const unresolved = (takeoff?.line_items ?? []).filter(i => i.qty === null);

  return (
    <div style={{ padding: '20px 24px' }}>
      {scope?.furnish_model === 'OFEI' && (
        <div className="panel" style={{ marginBottom: 14, borderColor: 'var(--amber)' }}>
          <div className="panel-hdr"><span className="panel-title">OFEI — Owner Furnished, EC Installed</span></div>
          <div style={{ padding: '10px 16px', fontSize: 13 }}>
            Gear and fixtures are owner-furnished on this job, so its cost per square foot
            reads structurally low against ECFECI comparables. {scope.furnish_note}
          </div>
        </div>
      )}

      {comps.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr"><span className="panel-title">Similar jobs</span></div>
          <div style={{ padding: '10px 16px' }}>
            {comps.map(c => (
              <button key={c.id} onClick={() => setSelected(c)}
                style={{ display: 'block', width: '100%', textAlign: 'left', font: 'inherit',
                         fontSize: 13, background: 'none', border: 'none', padding: '6px 0', cursor: 'pointer' }}>
                <strong>{c.name}</strong>
                {c.sq_ft_delta_pct != null && (
                  <span style={{ marginLeft: 8, color: 'var(--muted)' }}>
                    {Math.abs(Math.round(c.sq_ft_delta_pct))}%{' '}
                    {c.sq_ft_delta_pct >= 0 ? 'larger' : 'smaller'} than this job
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {takeoff && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr">
            <span className="panel-title">Quantity takeoff — {takeoff.item_count} items</span>
          </div>
          <div style={{ padding: '10px 16px', fontSize: 13 }}>
            {takeoff.categories.map(cat => (
              <div key={cat.name} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 700 }}>
                  {cat.name}
                  <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>
                    {cat.itemCount} items
                    {cat.unresolvedCount > 0 && ` · ${cat.unresolvedCount} unresolved`}
                  </span>
                </div>
                {cat.subcategories.length > 1 && cat.subcategories.map(s => (
                  <div key={s.name} style={{ paddingLeft: 14, color: 'var(--muted)' }}>
                    {s.name} — {s.itemCount} items
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {unresolved.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="panel-hdr">
            <span className="panel-title">Unresolved — {unresolved.length} items need verification</span>
          </div>
          <div style={{ padding: '10px 16px', fontSize: 13 }}>
            {unresolved.map((i, n) => (
              <div key={n} style={{ marginBottom: 6 }}>
                <strong>{i.description}</strong>{' '}
                <span style={{ color: 'var(--amber)' }}>{i.qtyRaw ?? i.confidence}</span>
                {i.notes && <div style={{ color: 'var(--muted)' }}>{i.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && <div style={{ fontSize: 13, color: 'var(--muted)' }}>Comparing against {selected.name}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Register the tab**

In `frontend/src/features/preconstruction/constants.ts`, add the entry first in `PC_TABS` (the pre-bid happens before plan review) and to `PcTabKey`:

```ts
export const PC_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'prebid',   label: 'Pre-Bid'  },
  { key: 'files',    label: 'Files'    },
  // …existing entries unchanged
];
```

Add `'prebid'` to the `PcTabKey` union.

In `frontend/src/App.tsx:102-112`, add `'prebid'` to the list of keys accepted when restoring `active_tab`, so a saved pre-bid tab is not discarded on reload.

In `frontend/src/components/RecordFiles.tsx:19-31`, add the two categories so the files can also be uploaded from the Files tab:

```ts
  { value: 'prebid_scope',   label: 'Pre-Bid Scope'   },
  { value: 'prebid_takeoff', label: 'Pre-Bid Takeoff' },
```

- [ ] **Step 5: Wire the tab into PcWorkspace**

In `PcWorkspace.tsx`, import the component and add the case beside the others:

```tsx
      case 'prebid':
        return <PreBidTab bidId={bidId} onSectionsLoaded={setPrebidSections}/>;
```

`setPrebidSections` is the state declared in Task 6 Step 7 — this is what supplies the Scope tab's import button.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npm test && npm run typecheck && npm run build`
Expected: 6 new tests pass, existing suites unaffected, build clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/preconstruction/PreBidTab.tsx frontend/src/features/preconstruction/PreBidTab.test.tsx frontend/src/features/preconstruction/constants.ts frontend/src/features/preconstruction/PcWorkspace.tsx frontend/src/App.tsx frontend/src/components/RecordFiles.tsx
git commit -m "feat: add the Pre-Bid tab

Own component file rather than another branch of the PcWorkspace switch,
which is already ~2300 lines. Surfaces the OFEI banner, the category
rollup with subcategories so job-type cost drivers stay visible, the
size delta against matched comparables, and the unresolved-items risk
list that the parser fix made possible."
```

---

### Task 8: AI scope comparison

**Files:**
- Modify: `backend/src/ai/prompts.ts`
- Modify: `backend/src/routes/preconstruction.ts`
- Test: `backend/src/test/prebid.test.ts` (append)

**Interfaces:**
- Consumes: `bid_prebid_scope` (Task 1), package data (Task 4), comps (Task 5).
- Produces: `POST /:bidId/prebid-analyze?against=<bidId>` → `{ status: 'running' }`; result readable from `GET /:bidId/prebid` as `ai_comparison` = `{ majorDifferences: string[], costDrivers: string[], missingScope: string[], notes: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/test/prebid.test.ts`:

```ts
describe('prebid-analyze', () => {
  it('requires an against parameter', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const bid = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `AI ${Date.now()}`, gc: 'G' }).expect(200);
    await pool.query(
      `INSERT INTO bid_prebid_scope (bid_id, sections) VALUES ($1,'[]'::jsonb)`, [bid.body.id]);
    await request(app)
      .post(`/api/preconstruction/${bid.body.id}/prebid-analyze`).set(auth(u.token))
      .expect(400);
  });

  it('404s when the bid has no pre-bid scope', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const a = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `AIa ${Date.now()}`, gc: 'G' }).expect(200);
    const b = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `AIb ${Date.now()}`, gc: 'G' }).expect(200);
    await request(app)
      .post(`/api/preconstruction/${a.body.id}/prebid-analyze?against=${b.body.id}`)
      .set(auth(u.token)).expect(404);
  });

  it('marks the run as running and records the comparison target', async (ctx) => {
    if (!ok) return ctx.skip();
    const u = await makeUser('owner');
    const a = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `AIc ${Date.now()}`, gc: 'G' }).expect(200);
    const b = await request(app).post('/api/bids').set(auth(u.token))
      .send({ name: `AId ${Date.now()}`, gc: 'G' }).expect(200);
    for (const id of [a.body.id, b.body.id]) {
      await pool.query(
        `INSERT INTO bid_prebid_scope (bid_id, sections)
         VALUES ($1,'[{"id":"A","title":"Service & Distribution","items":["gear"]}]'::jsonb)`, [id]);
    }
    const r = await request(app)
      .post(`/api/preconstruction/${a.body.id}/prebid-analyze?against=${b.body.id}`)
      .set(auth(u.token)).expect(200);
    expect(r.body.status).toBe('running');
    const { rows } = await pool.query(
      'SELECT ai_status, ai_comparison_against FROM bid_prebid_scope WHERE bid_id=$1', [a.body.id]);
    expect(rows[0].ai_status).toBe('running');
    expect(rows[0].ai_comparison_against).toBe(b.body.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/test/prebid.test.ts -t prebid-analyze`
Expected: FAIL with 404 — route missing.

- [ ] **Step 3: Add the prompt**

Append to `backend/src/ai/prompts.ts`:

```ts
export const PREBID_COMPARE_SYSTEM = `You are a chief estimator for a commercial electrical contractor.

You are given two pre-bid packages: a SUBJECT job being priced now, and a COMPARABLE past
job. Each has a scope of work broken into sections, a quantity-takeoff category rollup, a
gross square footage, and a furnish model.

Report only differences that change the price. Ignore boilerplate that appears on every
job (normal working hours, permits, change-order terms, coordination language).

Rules:
- Normalize by square footage before calling a quantity difference significant. A job 50%
  larger is expected to have roughly 50% more of most things; say so rather than reporting
  the raw gap as a finding.
- A furnish-model difference (OFEI vs ECFECI) is ALWAYS a primary cost driver and must be
  reported first when present. Under OFEI the owner supplies gear and fixtures and the
  contractor only installs them, so the two jobs' costs are not directly comparable — say
  this explicitly rather than comparing their quantities as if they bought the same scope.
- A takeoff SUBCATEGORY present on one job and absent on the other is strong evidence of a
  real cost driver (for example "BRANCH POWER — CAR WASH EQUIPMENT" against a job with only
  plain "BRANCH POWER"). Report these.
- Items marked unresolved (quantity VERIFY or NONE IDENTIFIED) are risks, not differences.
  List them under missingScope with what must be confirmed.
- Do not invent quantities, prices or scope that is not in the input.

Return ONLY valid JSON, no prose or code fences:
{
  "majorDifferences": ["..."],
  "costDrivers": ["..."],
  "missingScope": ["..."],
  "notes": "..."
}`;
```

- [ ] **Step 4: Add the route**

In `backend/src/routes/preconstruction.ts`, mirroring the async status machine used by `run-agent4`:

```ts
// POST prebid-analyze — compare this pre-bid against one comparable's pre-bid. On demand
// only and cached to ai_comparison: re-running against the same comp is free, and it never
// fires on upload.
router.post('/:bidId/prebid-analyze', requireAuth, requireAIPermission('run_analysis'),
  asyncHandler(async (req: AuthRequest, res) => {
    const { bidId } = req.params;
    const bid = await loadAccessibleBid(res, req.user!, bidId);
    if (!bid) return;

    const against = String(req.query.against || '').trim();
    if (!against) return res.status(400).json({ error: 'against required' });
    if (!(await loadAccessibleBid(res, req.user!, against))) return;

    const { rows } = await pool.query(
      `SELECT s.bid_id, s.sections, s.furnish_model, b.sq_ft, b.name,
              t.categories
         FROM bid_prebid_scope s
         JOIN bids b ON b.id = s.bid_id
         LEFT JOIN bid_takeoffs t ON t.bid_id = s.bid_id AND t.kind = 'prebid'
        WHERE s.bid_id = ANY($1::uuid[])`,
      [[bidId, against]]
    );
    const subject = rows.find(r => r.bid_id === bidId);
    const comp = rows.find(r => r.bid_id === against);
    if (!subject || !comp) {
      return res.status(404).json({ error: 'both bids need a pre-bid scope' });
    }

    await pool.query(
      `UPDATE bid_prebid_scope
          SET ai_status='running', ai_error=NULL, ai_comparison_against=$2, updated_at=now()
        WHERE bid_id=$1`, [bidId, against]);
    res.json({ status: 'running' });

    // Fire and forget, exactly as run-agent4 does — the client polls GET /prebid.
    // callWithRetry takes a THUNK: it wraps the whole SDK call, it does not take a
    // prompt pair. Mirrors the Agent 2 call site.
    void (async () => {
      try {
        const config = await loadAIConfig();
        const payload = JSON.stringify({
          subject: { name: subject.name, sqFt: subject.sq_ft, furnishModel: subject.furnish_model,
                     sections: subject.sections, categories: subject.categories ?? [] },
          comparable: { name: comp.name, sqFt: comp.sq_ft, furnishModel: comp.furnish_model,
                        sections: comp.sections, categories: comp.categories ?? [] },
        });
        const resp = await callWithRetry(() => client.messages.create({
          model: config.modelA2,
          max_tokens: config.maxTokensA2,
          temperature: config.temperature,
          system: [{ type: 'text', text: PREBID_COMPARE_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: `Compare these two pre-bid packages.\n\n${payload}` }],
        }), { onRetry: (a, _e, d) => console.warn(`[prebid-analyze] transient error, retry ${a} in ${d}ms`) });

        const parsed = parseAIJSON(extractText(resp));
        if (!parsed) throw new Error('model did not return parseable JSON');
        await pool.query(
          `UPDATE bid_prebid_scope
              SET ai_comparison=$2::jsonb, ai_status='complete', updated_at=now()
            WHERE bid_id=$1`, [bidId, JSON.stringify(parsed)]);
      } catch (err) {
        logger.error({ err, bidId }, '[prebid-analyze] failed');
        await pool.query(
          `UPDATE bid_prebid_scope SET ai_status='error', ai_error=$2, updated_at=now() WHERE bid_id=$1`,
          [bidId, describeAIError(err)]
        );
      }
    })();
  }));
```

Add `PREBID_COMPARE_SYSTEM` to the existing `../ai/prompts` import at `preconstruction.ts:8`. Everything else this route uses — `client`, `extractText`, `describeAIError`, `parseAIJSON`, `callWithRetry`, `requireAIPermission` — is already imported or defined in the file; do not add duplicate imports.

`loadAIConfig` is whatever helper `runPipeline` uses to read model, token budget and temperature from `app_settings` (defined around `preconstruction.ts:60-80`). Read that function and call it by its real name — reuse it rather than re-reading settings inline, so the pre-bid pass honours the same configuration as the other agents.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/test/prebid.test.ts && npm run typecheck`
Expected: all pass. The three AI tests exercise validation and the status transition only — they never call the model, so no API key is needed.

- [ ] **Step 6: Full verification**

```bash
cd backend && npm run typecheck && npm test && npm run build
cd ../frontend && npm run typecheck && npm test && npm run build
```
Expected: everything green, matching what CI will run.

- [ ] **Step 7: Commit**

```bash
git add backend/src/ai/prompts.ts backend/src/routes/preconstruction.ts backend/src/test/prebid.test.ts
git commit -m "feat: optional AI comparison of two pre-bid packages

On-demand only and cached to ai_comparison, so it never runs on upload
and re-running against the same comparable costs nothing. The prompt is
told to normalize by square footage before calling a quantity difference
significant, to treat a furnish-model mismatch as a primary cost driver
rather than comparing quantities across it, and to read a one-sided
subcategory as evidence of a real driver."
```

---

## Self-Review

**Spec coverage:** §A → Task 1. §B → Task 2. §C → Task 3. §D → Task 4. §E → Task 5. §F → Task 7. §G → Task 6. §H → Task 8. §I → distributed across every task. All nine sections covered.

**Placeholder scan:** No TBD/TODO. Every code step carries real code. The one deliberate instruction to consult existing code is Task 8 Step 4's `loadAIConfig` — the settings-reading helper is named by its behaviour rather than guessed, because using the wrong name would silently bypass the configured model and token budget.

**Symbol verification:** every referenced symbol was checked against the source. `callWithRetry(fn, opts)` takes a thunk (`ai/retry.ts:35`), not a prompt pair; JSON extraction is `parseAIJSON` / `extractJSONText` (`ai/json.ts:1,25`), there is no `extractJson`; `takeoff` maps to `drive_estimates_folder_id` (`storeDocument.ts:19`); `requireAIPermission`, `ownScopeId`, `loadAccessibleBid`, `parseTakeoffWorkbook` and `storeDocument` are all already imported in `preconstruction.ts:1-20`.

**Type consistency:** `TakeoffLineItem.qty: number | null` is defined in Task 2 and consumed as nullable in Tasks 4, 7, 8. `categoryRaw`/`subcategories` defined Task 2, consumed Tasks 7 and 8. `PrebidSection` defined Task 6, imported by Task 7 and returned by Task 3's `sections`. `buildScopeFromPrebid` named identically in Tasks 6 and 7. Route paths match between producer and consumer tasks.

**Known ordering constraint:** Task 6 declares `prebidSections` state that Task 7 populates. Task 6 typechecks standalone because the state defaults to `[]`; the button simply stays hidden until Task 7 lands. If executing out of order, do 6 before 7.

## Risks

- **Task 1 changes a primary key.** The table holds ~0–3 rows, so the migration is near-zero risk, but it is irreversible in place. If `bid_takeoffs` is unexpectedly large in production, stop and re-plan.
- **Fixture redaction is a hard gate.** Task 2 Step 1's verification must show only placeholder contacts. Real customer PII in git history cannot be removed without rewriting history.
- **`/prebid-comparables` deliberately diverges** from `/comparables` by dropping the amount filter. The two lists will legitimately show different jobs — expected, not a bug.
- **Unverified assumption:** no current-generation car wash *scope* document exists to test against, so a car-wash-specific scope section has never been observed. Task 6 handles it defensively (unrecognized → `G` with heading retained), and Task 6 Step 1 tests that path with a synthetic section.
