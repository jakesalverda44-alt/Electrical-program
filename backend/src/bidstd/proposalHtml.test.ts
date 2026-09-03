// Phase 4 Task 2.1 — lock test: the public proposal page's HTML must derive
// ENTIRELY from the composed BidData + boilerplate.ts's constants. Two
// checks:
//   1. Every section-band header (SCOPE OF WORK, each present A-F title,
//      EXCLUSIONS & CLARIFICATIONS, ELECTRICAL QUANTITY TAKEOFF, TERMS...)
//      appears in the rendered HTML exactly once.
//   2. Word-level: every word of visible text in the rendered HTML is
//      traceable to either the BidData fixture or boilerplate.ts's
//      SECTION_HEADERS/CLOSING constants — with one small, explicitly
//      enumerated exception list for the template's own fixed UI chrome
//      (table column labels, "Attn:"/"Re:"/"Job No.", the bold opening
//      sentence, "Proposal Price Summary"/"Total for", brand image alt
//      text) — the SAME fixed strings renderBidDocx (the .docx renderer)
//      already hardcodes. A drift test proves this check actually catches
//      injected foreign content, not just passing vacuously.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { renderBidHtml } from './proposalHtml';
import { BidData } from './bidData';
import { SECTION_HEADERS, CLOSING } from './boilerplate';

const fixture: BidData = JSON.parse(
  readFileSync(join(__dirname, '../test/fixtures/bidstd/bid_data.example.json'), 'utf8')
);

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' '));
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g)) || [];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function bulletText(b: unknown): string {
  if (typeof b === 'string') return b;
  const o = b as { b?: string; t?: string };
  return `${o.b ?? ''}${o.t ?? ''}`;
}

function collectDataWords(data: BidData): Set<string> {
  const strings: string[] = [
    data.date, data.client, data.contact || '', data.email || '',
    data.project_name, data.project_address, data.job_number,
    data.plan_date || '', data.total_price,
  ];
  data.scope.forEach(b => strings.push(bulletText(b)));
  data.sections.forEach(s => { strings.push(s.title); s.bullets.forEach(b => strings.push(bulletText(b))); });
  data.exclusions.forEach(b => strings.push(bulletText(b)));
  data.takeoff.forEach(cat => {
    strings.push(cat.name);
    cat.items.forEach(it => {
      strings.push(it.item, it.description, it.unit, String(it.qty ?? ''), it.source, it.conf || '', it.furnish_by || '');
    });
  });
  data.terms.forEach(b => strings.push(bulletText(b)));
  (data.alternates || []).forEach(b => strings.push(bulletText(b)));
  const set = new Set<string>();
  strings.forEach(s => words(s).forEach(w => set.add(w)));
  return set;
}

function collectBoilerplateWords(data: BidData): Set<string> {
  const strings: string[] = [
    SECTION_HEADERS.scope, SECTION_HEADERS.exclusions, SECTION_HEADERS.takeoff, SECTION_HEADERS.terms,
    CLOSING.respectfully, CLOSING.costBasis, CLOSING.acceptance, CLOSING.print, CLOSING.sign, CLOSING.date, CLOSING.thankYou,
  ];
  // Section A-F titles are boilerplate too when they match the canonical
  // headers (composeBidData maps them there) — the fixture's own titles
  // already equal SECTION_HEADERS.A..F, so they're covered by
  // collectDataWords's section.title pass already. Included here too for
  // robustness against a fixture that only supplies some letters.
  (['A', 'B', 'C', 'D', 'E', 'F'] as const).forEach(letter => strings.push(SECTION_HEADERS[letter]));
  const set = new Set<string>();
  strings.forEach(s => words(s).forEach(w => set.add(w)));
  return set;
}

// The template's own fixed UI chrome — every word here is hardcoded in
// proposalHtml.ts (and mirrors a hardcoded string already in
// utils/proposalDocx.ts's renderBidDocx), never sourced from BidData or
// boilerplate.ts. Kept deliberately small and enumerated so this test
// actually constrains what "chrome" is allowed to grow into.
const CHROME_WHITELIST = new Set<string>([
  // "Please accept this proposal to complete the electrical work for
  //  {project} you have out for bid."
  'please', 'accept', 'this', 'proposal', 'to', 'complete', 'the', 'electrical',
  'work', 'for', 'you', 'have', 'out', 'bid',
  // Header block labels
  'attn', 're', 'job', 'no',
  // Price summary labels
  'price', 'summary', 'total',
  // Takeoff column headers
  'item', 'description', 'unit', 'qty', 'source', 'notes',
  // Brand image alt text
  'accurate', 'power', 'technology', 'jake', 'salverda', 'signature',
]);

describe('renderBidHtml — content lock', () => {
  const html = renderBidHtml(fixture);

  it('renders each section-band header exactly once', () => {
    const bands = [
      SECTION_HEADERS.scope,
      ...fixture.sections.map(s => s.title),
      SECTION_HEADERS.exclusions,
      SECTION_HEADERS.takeoff,
      SECTION_HEADERS.terms,
    ];
    for (const header of bands) {
      const needle = `>${escapeHtml(header)}<`;
      const count = html.split(needle).length - 1;
      expect(count, `expected "${header}" exactly once, found ${count}`).toBe(1);
    }
  });

  it('every word of visible text traces to BidData, boilerplate.ts, or the enumerated chrome whitelist', () => {
    const allowed = new Set<string>([
      ...collectDataWords(fixture), ...collectBoilerplateWords(fixture), ...CHROME_WHITELIST,
    ]);
    const rendered = words(stripTags(html));
    const foreign = rendered.filter(w => !allowed.has(w));
    expect(foreign, `unexpected words not traceable to data/boilerplate/chrome: ${[...new Set(foreign)].join(', ')}`).toEqual([]);
  });

  // Proves the check above isn't vacuous — injecting a made-up sentence
  // must fail it.
  it('DRIFT CHECK: the word-lock actually catches an injected foreign sentence', () => {
    const polluted = html.replace('</div>', '<p>Ask about our exclusive financing promotion today!</p></div>');
    const allowed = new Set<string>([
      ...collectDataWords(fixture), ...collectBoilerplateWords(fixture), ...CHROME_WHITELIST,
    ]);
    const rendered = words(stripTags(polluted));
    const foreign = rendered.filter(w => !allowed.has(w));
    expect(foreign.length).toBeGreaterThan(0);
  });

  it('embeds the logo and signature as data URIs (no external image requests from a public page)', () => {
    expect(html).toMatch(/src="data:image\/jpeg;base64,/);
    expect(html).toMatch(/src="data:image\/png;base64,/);
  });

  it('renders the Print/Sign/Date acceptance block as a stable signing-UI mount point', () => {
    expect(html).toContain('id="apt-accept-sign-mount"');
    expect(html).toContain(CLOSING.print);
    expect(html).toContain(CLOSING.sign);
    expect(html).toContain(CLOSING.date);
  });

  it('includes print-friendly CSS', () => {
    expect(html).toMatch(/@media print/);
  });

  it('never contains the raw {b,t} bullet object shape — mixed-run bullets render as bold lead + rest', () => {
    expect(html).not.toContain('[object Object]');
    const mixedBullet = fixture.sections[0].bullets.find(b => typeof b !== 'string') as { b: string; t: string };
    expect(html).toContain(`<strong>${escapeHtml(mixedBullet.b)}</strong>`);
  });
});
