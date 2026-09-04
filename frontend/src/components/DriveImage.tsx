import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import api from '../api/client';

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
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isImage) return;
    let revoked = false;
    let objectUrl: string | null = null;
    api.get(src || `/documents/drive-file/${fileId}`, { responseType: 'blob' })
      .then(res => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => { if (!revoked) setFailed(true); });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, isImage, src]);

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
