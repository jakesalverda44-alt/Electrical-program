import { useState } from 'react';
import api from '../api/client';
import { previewKind, PreviewKind } from './filePreview';

/** Minimal shape needed to route a document through the preview logic below.
 *  Callers may pass a richer doc type (e.g. RecordFiles' `Doc`) — it flows
 *  through untouched via the generic and is handed back on the preview state
 *  and to `download`. */
export interface PreviewableDoc {
  id: string;
  name: string;
  display_name?: string;
  file_type?: string | null;
}

export interface DocPreviewState<D> {
  title: string;
  kind: Exclude<PreviewKind, 'inline' | 'none'>;
  buf: ArrayBuffer;
  doc: D;
}

/** Shared "view a document" behavior used by both RecordFiles (Documents tab)
 *  and the PcWorkspace "From Project Files" panel, so the two don't drift:
 *  - pdf/image ('inline'): fetched as a blob and opened in a new tab (opened
 *    synchronously on the click to dodge popup blockers, pointed at the blob
 *    once fetched).
 *  - xlsx/xls/csv/docx ('sheet'/'doc'): fetched as an arraybuffer and handed
 *    back via `preview` for the caller to render in a FilePreviewModal.
 *  - anything else ('none'), or a failed fetch: falls through to `download`.
 */
export function useDocPreview<D extends PreviewableDoc>(
  download: (doc: D) => void | Promise<void>,
  onError?: (message: string) => void,
) {
  const [preview, setPreview] = useState<DocPreviewState<D> | null>(null);

  const view = async (doc: D) => {
    const kind = previewKind(doc.name, doc.file_type);

    if (kind === 'inline') {
      const w = window.open('', '_blank');
      try {
        const res = await api.get(`/documents/${doc.id}/view`, { responseType: 'blob' });
        const url = URL.createObjectURL(res.data);
        if (w) w.location.href = url; else window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        if (w) w.close();
        onError?.('Preview failed — try downloading instead.');
      }
      return;
    }

    if (kind === 'none') {
      return download(doc);
    }

    try {
      const res = await api.get(`/documents/${doc.id}/view`, { responseType: 'arraybuffer' });
      setPreview({ title: doc.display_name || doc.name, kind, buf: res.data, doc });
    } catch {
      onError?.('Preview failed — downloading instead.');
      download(doc);
    }
  };

  return { preview, view, closePreview: () => setPreview(null) };
}
