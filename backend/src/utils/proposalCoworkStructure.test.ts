// Takeoff accuracy Task 13 — the CRM proposal matches the Cowork proposal's
// STRUCTURE (header block, section order, table columns and sections, numbered
// items, the price block with the amount in words, closing order), rendered
// from the Kissimmee reference BidData. Where soffice is installed the PDF is
// produced too and must not run longer than Cowork's 6 pages.
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import AdmZip from 'adm-zip';
import { renderBidDocx } from './proposalDocx';
import { standardScope6, standardTerms } from '../bidstd/boilerplate';
import { formatSheetCitation } from '../bidstd/composeBidData';
import { findSoffice } from '../bidstd/verifyBid';
import type { BidData } from '../bidstd/bidData';

const FIX = path.join(__dirname, '../test/fixtures/bidstd');
const outline = JSON.parse(fs.readFileSync(path.join(FIX, 'cowork-kissimmee.outline.json'), 'utf8'));

function kissimmee(): BidData {
  const d = JSON.parse(fs.readFileSync(path.join(FIX, 'kissimmee.bid_data.json'), 'utf8')) as BidData;
  d.scope = standardScope6(d.plan_date || '', formatSheetCitation(['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7', 'PH0.1', 'A-101']), d.client);
  d.terms = standardTerms(d.plan_date || '', { lightingBullet: 'Lighting fixtures furnished by the Owner through the Graybar national account. EC to receive, inventory, and install.' });
  return d;
}

/** Paragraph texts in document order (table cells included, one per cell). */
function paragraphs(buf: Buffer): string[] {
  const xml = new AdmZip(buf).readAsText('word/document.xml');
  return [...xml.matchAll(/<w:p[ >].*?<\/w:p>/gs)]
    .map(m => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'"))
    .filter(t => t.trim());
}

describe('proposal structure matches Cowork', () => {
  it('header lines, intro, band order, table columns/sections, numbering, price block and closing', async () => {
    const p = paragraphs(await renderBidDocx(kissimmee()));
    // Header block: the first 7 paragraphs, in Cowork's order.
    outline.header_lines.forEach((re: string, i: number) => expect(p[i]).toMatch(new RegExp(re)));
    expect(p[7]).toBe(outline.intro);
    // Band order.
    const bands = p.filter(t => outline.bands.includes(t));
    expect(bands).toEqual(outline.bands);
    // Table: header columns, then the sections in order, items numbered from 1 in each.
    const colAt = p.indexOf('ITEM');
    expect(p.slice(colAt, colAt + 5)).toEqual(outline.table_columns);
    const sections = p.filter(t => outline.table_sections.includes(t));
    expect(sections).toEqual(outline.table_sections);
    const firstItem = p.indexOf('Service & Distribution', colAt) + 1;
    expect(p[firstItem]).toBe('1');
    const lighting = p.indexOf('Interior Lighting', colAt);
    expect(p[lighting + 1]).toBe('1');
    // Price block, then the closing.
    const priceAt = p.indexOf(outline.price_block[0]);
    expect(p[priceAt + 1]).toMatch(new RegExp(outline.price_block[1]));
    expect(p.slice(priceAt + 2, priceAt + 4)).toEqual(outline.closing_after_price);
    // Sheet citation (electrical + civil/photometric, never A/S sheets).
    expect(p.find(t => t.startsWith('Based on the electrical'))).toContain('Sheets: E-1 through E-7 and the civil/photometric set (Sheet PH0.1).');
    // Jake's corrections to Cowork's content: GC approves change orders; disconnects are APT's.
    expect(p.some(t => /Change Order approved by the Owner|signed by the Owner/.test(t))).toBe(false);
    expect(p.some(t => /disconnects? .*furnished by AutoZone/i.test(t))).toBe(false);
  });

  it('bullets are small "•" with a tight hanging indent; the takeoff table has no cell borders', async () => {
    const zip = new AdmZip(await renderBidDocx(kissimmee()));
    const numbering = zip.readAsText('word/numbering.xml');
    expect(numbering).toContain('<w:lvlText w:val="•"/>');
    expect(numbering).toMatch(/<w:ind w:left="360" w:hanging="180"\/>/);
    const doc = zip.readAsText('word/document.xml');
    expect(doc).not.toMatch(/<w:tcBorders>(?:(?!<\/w:tcBorders>).)*w:val="single"/s);
    expect(doc).toContain('<w:tblHeader/>');
  });

  it('LibreOffice PDF: no longer than Cowork\'s 6 pages', async (ctx) => {
    const soffice = findSoffice();
    if (!soffice) return ctx.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-'));
    try {
      fs.writeFileSync(path.join(dir, 'p.docx'), await renderBidDocx(kissimmee()));
      execFileSync(soffice, [`-env:UserInstallation=file://${path.join(dir, 'profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, path.join(dir, 'p.docx')], { timeout: 120_000, stdio: 'ignore' });
      const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [path.join(dir, 'p.pdf')]).toString())?.[1]);
      expect(pages).toBeGreaterThan(0);
      expect(pages).toBeLessThanOrEqual(outline.pages);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 150_000);
});
