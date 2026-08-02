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

// A factory, not a module-level singleton: each caller must get its own `meta`/
// `generalItems`/`sections` instances. A shared singleton would let one caller's
// in-place mutation of an "empty" result leak into every other empty result for
// the life of the process — real risk in a long-running server handling many
// malformed-buffer requests.
function emptyResult(): ParsedPrebidScope {
  return {
    meta: {}, furnishModel: null, furnishNote: null,
    generalItems: [], sections: [], suggestedBrand: null,
  };
}

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
// Genuine header lines ("GC: Summit General Contractors", "Sheets Reviewed: C0.1; A0, ...")
// are short, single-paragraph facts — the longest confirmed real value across all three
// fixtures is ~180 chars (a dense "Owner / Engineer" line). A prose paragraph that merely
// starts with "Label:" (e.g. "NOTE: The architectural/engineering drawing title blocks...",
// or a future "IMPORTANT:"/"REMINDER:") runs several sentences and 300+ chars. Capping the
// value length rejects the prose case without hard-coding the specific lead-in word.
const META_VALUE_MAX_LEN = 200;

export function parsePrebidScope(buf: Buffer): ParsedPrebidScope {
  const paras = extractDocxParagraphs(buf);
  if (!paras.length) return emptyResult();

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
      if (metaM && metaM[2].trim().length <= META_VALUE_MAX_LEN) {
        meta[metaM[1].trim()] = metaM[2].trim();
      }
    }
  }

  const note = furnishNote ?? '';
  // Deviation notes often name the OFF model only to contrast it with the ON one
  // ("...the opposite of our usual ECFECI/Southern Lighting Source model"). Strip
  // that contrastive clause before counting mentions so it doesn't read as "mixed"
  // when the document is actually single-model.
  const noteForClassification = note.replace(
    /(?:the\s+)?opposite\s+of\s+(?:our\s+)?usual\s+(?:OFEI|ECFECI)[^.]*\.?/gi,
    ''
  );
  const ofei = /\bOFEI\b|Owner Furnished/i.test(noteForClassification);
  const ecfeci = /\bECFECI\b/i.test(noteForClassification);
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
