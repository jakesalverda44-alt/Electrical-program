// Estimating Phase B, Task 4 — lazy-loads pdf.js in the browser. Mirrors
// gen-pipeline/SurveyMarkupEditor.tsx's own dynamic-import + worker setup
// (the one proven pattern for pdfjs-dist already in this codebase), cached
// module-level so PlanViewer only pays the import cost once per session,
// not once per sheet. A dynamic `import()` here also keeps pdfjs-dist out
// of the main bundle regardless of how this module itself is imported —
// combined with PlansWorkspace.tsx's own React.lazy() boundary (Task 9),
// neither the viewer's own code nor pdf.js loads until Plans view opens.
import type * as PdfJsNs from 'pdfjs-dist';

let cached: typeof PdfJsNs | null = null;
let loading: Promise<typeof PdfJsNs> | null = null;

export async function loadPdfJs(): Promise<typeof PdfJsNs> {
  if (cached) return cached;
  if (!loading) {
    loading = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      cached = pdfjsLib;
      return pdfjsLib;
    })();
  }
  return loading;
}

export type PdfJsDocument = PdfJsNs.PDFDocumentProxy;
export type PdfJsPage = PdfJsNs.PDFPageProxy;
export type PdfJsRenderTask = ReturnType<PdfJsPage['render']>;

/** Opens a PDF from an in-memory buffer (the caller already fetched it
 *  through the authenticated streaming route — see useSheetFile.ts). */
export async function openPdfDocument(data: ArrayBuffer): Promise<PdfJsDocument> {
  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
  return loadingTask.promise;
}
