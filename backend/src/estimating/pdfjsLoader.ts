// Estimating Phase B, Task 2 — loads pdfjs-dist's Node ("legacy") build.
//
// Why pdfjs-dist over pdf-parse (both are available — pdf-parse is already a
// backend dependency and itself wraps pdfjs-dist internally): pdf-parse's
// public API (getText/getInfo) exposes per-page width/height but NOT page
// rotation, and NOT per-text-item positions — both are required here.
// Rotation feeds est_sheets.rotation directly (needed for the frontend
// viewer's rotation-aware transforms, Decision 5). Per-item positions are
// what let this module reuse ai/pageClassifier.ts's own "right 25% strip,
// full height" title-block heuristic (titleBlockCropRect) on TEXT rather
// than on a rasterized image crop — restricting the sheet-no/title search to
// the strip is what keeps it from picking up an unrelated tag or note
// string elsewhere on a busy plan sheet. pdfjs-dist gives page.view (the
// MediaBox, in PDF points), page.rotate, and getTextContent() item
// transforms (position) directly.
//
// pdfjs-dist 5.x ships ESM-only (no CJS build, not even a .cjs variant of
// the legacy Node bundle) — this backend compiles under
// `module: "commonjs"`, and TypeScript downlevels a plain `await
// import(...)` to `Promise.resolve().then(() => require(...))` under that
// target, which throws ERR_REQUIRE_ESM against pdfjs-dist's .mjs file (Node
// require() cannot load an ESM module). Going through an indirect
// `new Function(...)`-constructed import hides the specifier from
// TypeScript's static downleveling, so this stays a REAL dynamic
// `import()` — Node's own ESM loader handles the rest, exactly as it would
// for a hand-written `.mjs` file. Verified against this exact backend
// (tsc-compiled output run directly, and under vitest/esbuild) before this
// was relied on anywhere.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const dynamicImport: (specifier: string) => Promise<unknown> = new Function(
  'specifier',
  'return import(specifier)'
) as (specifier: string) => Promise<unknown>;

// Minimal surface this module actually uses — pdfjs-dist ships its own much
// larger type declarations, but pulling those in for a dynamically-imported
// module buys nothing (TS can't check across the dynamic import boundary
// anyway) and risks a version mismatch with whatever's actually resolved.
export interface PdfJsTextItem {
  str: string;
  /** [a, b, c, d, e, f] — e/f are the item's x/y origin in PDF user-space
   *  points (unaffected by page rotation; pdfjs applies rotation only to
   *  the VIEWPORT it hands a renderer, never to these raw item transforms). */
  transform: number[];
}
export interface PdfJsTextContent {
  items: PdfJsTextItem[];
}
export interface PdfJsPage {
  /** [x0, y0, x1, y1] — the page's MediaBox in PDF points, unrotated. */
  view: number[];
  /** 0 / 90 / 180 / 270. */
  rotate: number;
  getTextContent(): Promise<PdfJsTextContent>;
}
export interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber1Based: number): Promise<PdfJsPage>;
  destroy(): Promise<void>;
}

interface PdfJsModule {
  getDocument(params: { data: Uint8Array; useSystemFonts?: boolean; isEvalSupported?: boolean }): { promise: Promise<PdfJsDocument> };
}

let cachedModule: PdfJsModule | null = null;

async function loadPdfJsModule(): Promise<PdfJsModule> {
  if (cachedModule) return cachedModule;
  const mod = (await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs')) as PdfJsModule;
  cachedModule = mod;
  return mod;
}

/** Parses a PDF buffer and returns the pdfjs document. Caller MUST call
 *  `.destroy()` when done (releases pdfjs's internal worker/canvas
 *  resources) — every caller in this module does so in a finally block.
 *
 *  pdf.js TRANSFERS (detaches) an ArrayBuffer its input fully spans. The
 *  live AutoZone run (2026-09-23) lost every counted sheet to that:
 *  readPageGeometry parsed the pipeline's own upload Buffer through a
 *  zero-copy view, pdf.js detached it, and renderCountTiles then failed on
 *  every page with "Cannot perform Construct on a detached ArrayBuffer".
 *  So by default pdf.js gets a COPY and the caller's Buffer is never
 *  touched. `transfer: true` keeps fix round 1 / B9's zero-copy view for a
 *  caller that owns its Buffer outright and never reads it again (sheet
 *  indexing, where a 100-150MB set would otherwise be held twice). */
export async function openPdfDocument(buf: Buffer, opts: { transfer?: boolean } = {}): Promise<PdfJsDocument> {
  const pdfjs = await loadPdfJsModule();
  // useSystemFonts avoids pdfjs trying to fetch standard-font metrics over
  // HTTP (no network access in this backend context); isEvalSupported:false
  // avoids pdfjs's optional eval-based fast path for embedded PostScript
  // functions — irrelevant to text/geometry extraction and one less thing
  // to sandbox.
  const data = opts.transfer
    ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) // view: pdf.js may detach buf
    : new Uint8Array(buf); // copy: buf stays usable for the caller
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  return loadingTask.promise;
}
