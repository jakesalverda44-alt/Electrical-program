// Structural tests on the produced docx XML (adm-zip) — no LibreOffice, per
// the plan's environment note (Aptfile installs poppler only in production).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import { renderBidDocx, buildProposalDocx, bidDocxFilename, loadRequiredAsset, ProposalJSON } from './proposalDocx';
import { extractDocxText } from './bidDocParse';
import { BidData } from '../bidstd/bidData';
import { SECTION_HEADERS, CLOSING } from '../bidstd/boilerplate';

const fixture: BidData = JSON.parse(
  readFileSync(join(__dirname, '../test/fixtures/bidstd/bid_data.example.json'), 'utf8')
);

function documentXml(buf: Buffer): string {
  const zip = new AdmZip(buf);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('word/document.xml missing from produced docx');
  return entry.getData().toString('utf8');
}

describe('renderBidDocx', () => {
  it('renders the canonical fixture without throwing', async () => {
    const buf = await renderBidDocx(fixture);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('produces the exact section header strings', async () => {
    const buf = await renderBidDocx(fixture);
    const text = extractDocxText(buf);
    expect(text).toContain('SCOPE OF WORK');
    expect(text).toContain('A. Service & Distribution');
    expect(text).toContain('B. Branch Power');
    expect(text).toContain('C. Lighting & Controls');
    expect(text).toContain('D. Site Lighting, Underground Work & Allowances');
    expect(text).toContain('E. Low Voltage Infrastructure (Conduit & Boxes Only)');
    expect(text).toContain('F. Project Coordination & Closeout');
    expect(text).toContain('EXCLUSIONS & CLARIFICATIONS');
    expect(text).toContain('ELECTRICAL QUANTITY TAKEOFF');
    expect(text).toContain('TERMS, CONDITIONS & SPECIAL REQUIREMENTS');
  });

  it('every SECTION_HEADERS constant appears verbatim (drift guard)', async () => {
    const buf = await renderBidDocx(fixture);
    const text = extractDocxText(buf);
    for (const header of Object.values(SECTION_HEADERS)) {
      expect(text).toContain(header);
    }
  });

  it('renders the exact closing block lines verbatim', async () => {
    const buf = await renderBidDocx(fixture);
    const text = extractDocxText(buf);
    expect(text).toContain(CLOSING.respectfully);
    expect(text).toContain(CLOSING.costBasis);
    expect(text).toContain(CLOSING.acceptance);
    expect(text).toContain(CLOSING.print);
    expect(text).toContain(CLOSING.sign);
    expect(text).toContain(CLOSING.date);
    expect(text).toContain(CLOSING.thankYou);
  });

  it('renders the price summary label and the total line', async () => {
    const buf = await renderBidDocx(fixture);
    const text = extractDocxText(buf);
    expect(text).toContain('Proposal Price Summary');
    // Takeoff accuracy Task 13 — Cowork's line: amount in words + figure to the cent.
    expect(text).toContain('Total Electrical Scope — ');
    expect(text).toMatch(/and \d\d\/100 Dollars {3}\$[\d,]+\.\d\d/);
  });

  it('renders every takeoff item and category band', async () => {
    const buf = await renderBidDocx(fixture);
    const text = extractDocxText(buf);
    for (const cat of fixture.takeoff) {
      expect(text.toUpperCase()).toContain(cat.name.toUpperCase());
      for (const item of cat.items) {
        expect(text).toContain(item.description);
      }
    }
  });

  it('band headers are centered navy-shaded paragraphs that keep with their first bullet (Task 13: not one-cell tables)', async () => {
    const buf = await renderBidDocx(fixture);
    const xml = documentXml(buf);
    // PROJECT_INSTRUCTIONS §4: "section header text is centered in the navy
    // band — not left-aligned." Takeoff accuracy Task 13 renders the band as a
    // shaded paragraph (a table band broke keep-with-next and left pages half
    // empty).
    const bands = [...xml.matchAll(/<w:p>(?:(?!<\/w:p>).)*?w:fill="1F3864"(?:(?!<\/w:p>).)*?<\/w:p>/gs)].map(m => m[0])
      .filter(p => !p.includes('<w:tc'));
    expect(bands.length).toBeGreaterThanOrEqual(4);
    for (const b of bands) {
      expect(b).toMatch(/<w:jc w:val="center"\/>/);
      expect(b).toMatch(/<w:keepNext\/>/);
    }
  });

  it('the takeoff table column-width grid matches the spec exactly', async () => {
    const buf = await renderBidDocx(fixture);
    const xml = documentXml(buf);
    // The takeoff table is the only table with 5 gridCols totaling 9360 DXA —
    // pull every tblGrid. Takeoff accuracy Task 13: build_bid.js's 620 DXA ITEM
    // column wrapped the "ITEM" header to "ITE / M" at 10 pt; 100 DXA moved from
    // DESCRIPTION to ITEM (still totals 9360), fixed layout.
    const grids = [...xml.matchAll(/<w:tblGrid>(.*?)<\/w:tblGrid>/gs)].map(m =>
      [...m[1].matchAll(/w:w="(\d+)"/g)].map(g => Number(g[1]))
    );
    const takeoffGrid = grids.find(g => g.length === 5);
    expect(takeoffGrid).toEqual([720, 3540, 720, 700, 3680]);
    expect(takeoffGrid!.reduce((a, b) => a + b, 0)).toBe(9360);
    expect(xml).toContain('<w:tblLayout w:type="fixed"/>');
  });

  it('takeoff category band cells span all 5 columns', async () => {
    const buf = await renderBidDocx(fixture);
    const xml = documentXml(buf);
    const gridSpanCount = (xml.match(/<w:gridSpan w:val="5"\/>/g) ?? []).length;
    expect(gridSpanCount).toBe(fixture.takeoff.length);
  });

  it('throws when total_price is missing', async () => {
    await expect(renderBidDocx({ ...fixture, total_price: '' })).rejects.toThrow(/no price/i);
  });

  // FIX-8 — a missing brand asset must throw a clear error (matching
  // build_bid.js's own strictness), never silently render old/no branding.
  // Exercised against a scratch directory (never the real checked-in
  // backend/assets/) so this never touches real files on disk.
  describe('brand asset strictness (FIX-8)', () => {
    it('throws a clear error when a required asset file is missing', () => {
      expect(() => loadRequiredAsset(tmpdir(), 'APT_Logo_2026.jpg', 'company logo'))
        .toThrow(/Required brand asset missing: APT_Logo_2026\.jpg \(company logo\)/);
    });

    it('renderBidDocx uses the real checked-in assets and does not throw', async () => {
      // Sanity check the other direction: the actual backend/assets/ files
      // are present, so the standard render path is unaffected by FIX-8.
      await expect(renderBidDocx(fixture)).resolves.toBeInstanceOf(Buffer);
    });
  });

  describe('bidDocxFilename (FIX-10)', () => {
    it('builds APT_Bid_[ProjectSlug]_[LocationSlug].docx from the composed slugs', () => {
      expect(bidDocxFilename(
        { ...fixture, output_filename: undefined, project_slug: 'CircleK4521', location_slug: 'Eustis' },
        'fallback'
      )).toBe('APT_Bid_CircleK4521_Eustis.docx');
    });

    it('prefers an explicit output_filename when set', () => {
      expect(bidDocxFilename({ ...fixture, output_filename: 'Custom_Name.docx' }, 'fallback'))
        .toBe('Custom_Name.docx');
    });

    it('falls back to "Proposal - <fallbackAsciiName>.docx" when a slug is blank', () => {
      expect(bidDocxFilename({ ...fixture, output_filename: undefined, project_slug: '', location_slug: 'Eustis' }, 'Circle K 4521'))
        .toBe('Proposal - Circle K 4521.docx');
    });
  });
});

describe('buildProposalDocx (legacy compat path)', () => {
  const legacy: ProposalJSON = {
    date: '2026-09-02',
    gcName: 'ABC Construction',
    projectName: 'Circle K #4521',
    projectAddress: '1234 Main St, Eustis, FL',
    openingStatement: 'The project is understood to be electrical work.',
    scopeOfWork: {
      standard6Bullets: ['All work per plan.'],
      A_ServiceDistribution: ['Service entrance assembly and MDP (ECFECI).'],
      B_BranchPower: ['Branch circuit wiring per plan.'],
      C_LightingControls: ['Complete lighting package (ECFECI).', 'Controls and testing.', 'LED fixtures per schedule.'],
      D_SiteLightingUnderground: ['Site lighting per allowance.'],
      E_LowVoltage: ['Conduit and boxes only.'],
      F_Coordination: ['Coordinate with GC.'],
    },
    exclusions: ['Painting and patching.'],
    takeoff: [
      { category: 'Interior Lighting', item: 'LED Troffer 2x4', description: '40W 4000K fixture', unit: 'EA', qty: 48, sourceNotes: 'Per schedule E-401' },
    ],
    terms: ['Based on drawings dated 2026-09-02.'],
    totalPrice: '$425,000',
  };

  it('still renders old-shape ProposalJSON without throwing', async () => {
    const buf = await buildProposalDocx(legacy);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('maps old A-F sections onto the new canonical section titles', async () => {
    const buf = await buildProposalDocx(legacy);
    const text = extractDocxText(buf);
    expect(text).toContain('A. Service & Distribution');
    expect(text).toContain('C. Lighting & Controls');
    expect(text).toContain('Service entrance assembly and MDP (ECFECI).');
  });

  it('bidMeta (bid row values + validated price) overrides the data blob', async () => {
    const buf = await buildProposalDocx(legacy, {
      projectName: 'Authoritative Project',
      projectAddress: '999 Authoritative Ave',
      gcName: 'Authoritative GC',
      totalPrice: '$999,999.00',
    });
    const text = extractDocxText(buf);
    expect(text).toContain('Authoritative Project');
    expect(text).toContain('Authoritative GC');
    expect(text).toContain('$999,999.00');
    expect(text).not.toContain('Circle K #4521');
    expect(text).not.toContain('$425,000');
  });

  it('renders an empty-object legacy proposal without throwing, given a price', async () => {
    const buf = await buildProposalDocx({}, { projectName: 'Empty Test', totalPrice: '$1,000' });
    expect(buf.length).toBeGreaterThan(0);
  });

  // FIX-2 — a legacy row's priced allowances[] must not be silently dropped
  // on a re-download; they render as Section D bullets.
  it('folds legacy allowances[] into a rendered Section D bullet', async () => {
    const legacyWithAllowances: ProposalJSON = {
      ...legacy,
      allowances: [{ item: 'Underground conduit', footage: 400, unit: 'LF', notes: 'Per site plan' }],
    };
    const buf = await buildProposalDocx(legacyWithAllowances);
    const text = extractDocxText(buf);
    expect(text).toContain('D. Site Lighting, Underground Work & Allowances');
    expect(text).toMatch(/400' allowance — Underground conduit \(Per site plan\)/);
  });
});
