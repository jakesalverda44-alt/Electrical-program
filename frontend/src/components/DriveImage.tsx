import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import { useApi } from '../hooks/useApi';

interface Props {
  fileId: string;
  alt?: string;
  height?: number;
  isImage?: boolean;
  /**
   * Override the default `/documents/drive-file/:fileId` proxy with an
   * owned-record route (e.g. `/gens/:id/photos/:fileId`,
   * `/bids/:id/photos/:fileId`). Job-site photos are listed straight out of
   * Drive and never get a `documents` row, so the generic proxy correctly
   * fails closed on them (post-review fix for B2) — callers rendering those
   * must pass the matching owned route here instead.
   */
  src?: string;
}

/**
 * Renders a Google Drive image by proxying its bytes through the authenticated
 * backend (the browser has no Drive session, so a plain <img src> can't load it).
 * Fetches as a blob, shows a placeholder for non-images or while loading.
 */
export default function DriveImage({ fileId, alt, height = 120, isImage = true, src }: Props) {
  const { data: blob, error } = useApi<Blob>(
    isImage ? (src || `/documents/drive-file/${fileId}`) : null,
    { responseType: 'blob' },
  );
  const failed = !!error;

  // The object URL is a resource, not state: mint one per blob and revoke it
  // when the blob is replaced or the component goes away.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => { URL.revokeObjectURL(objectUrl); setUrl(null); };
  }, [blob]);

  const placeholder = (
    <div style={{ height, background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="clip" size={26} stroke={1.4} style={{ color: 'var(--text3)', opacity: .7 }}/>
    </div>
  );

  if (!isImage || failed) return placeholder;
  if (!url) {
    return (
      <div style={{ height, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>Loading…</div>
      </div>
    );
  }
  return (
    <img src={url} alt={alt || ''} loading="lazy"
      style={{ width: '100%', height, objectFit: 'cover', display: 'block' }}/>
  );
}
