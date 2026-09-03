// Phase 4 Task 6.1 — carries Phase 2's F8 finding: our own AI prompts use a
// delimiter grammar to frame machine-read content as authoritative —
// pdfText.ts's `--- Sheet <label> p<n> — EXTRACTED TEXT (machine-read, treat
// as FIRM source) ---`, documentPrep.ts's `--- Sheet: <filename> (<class>)
// ---`, agent3CrossCheck.ts's `--- INDEPENDENT PRE-BID TAKEOFF ... ---`.
// Content we did NOT author — a PDF's text layer, an uploaded filename, a
// workbook cell — flows into these same prompts. Left unsanitized, any of
// those could embed a line that starts with `---` and impersonate one of
// our own delimiters (or a fresh "ignore previous instructions"-style
// block framed as if it came from the pipeline itself), rather than being
// read as inert page content.
//
// Pure — no I/O. Applied at each point untrusted text is about to be
// embedded in a prompt: pdfText.ts's pageTextBlock (PDF-extracted page
// text), pageClassifier.ts's classifyPages (the uploaded filename), and
// agent3CrossCheck.ts's buildPrebidCrossCheck (workbook category/
// description text parsed from an uploaded pre-bid takeoff).
export function sanitizeForPrompt(text: string): string {
  if (typeof text !== 'string' || !text) return text;

  // Strip control characters (keep \n and \t — normal text formatting).
  let out = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Neutralize our own delimiter grammar: a line starting with 3+ dashes
  // can never survive as such — the leading run becomes a single em dash,
  // so it can no longer open a fake "--- ... ---" system header.
  out = out.replace(/^-{3,}/gm, '—');

  // Collapse 3+ consecutive newlines down to a max of 2 (one blank line) —
  // bounds how much vertical whitespace embedded content can inject to
  // visually separate itself from surrounding context.
  out = out.replace(/\n{3,}/g, '\n\n');

  return out;
}
