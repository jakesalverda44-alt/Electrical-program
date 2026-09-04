// @vitest-environment happy-dom
// Two review non-blockers on this page:
//
//  - `downloadDoc` read `localStorage.getItem('token')`. Everything else in the
//    tree stores the JWT under `crm_token`, so this has been sending
//    `Bearer null` and 401ing since it was written — and once task 2 made a 401
//    eject the user, the download button started logging people out.
//  - The per-file "exceeds 50 MB — skipped" toast was raised inside the upload
//    loop and then immediately overwritten by the success toast (there is one
//    toast slot). With every file oversized the user got a green
//    "0 files uploaded".
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DocsPage from './DocsPage';
import { AppProviders } from '../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { Toast, User } from '../../types';

afterEach(cleanup);

const get = vi.fn();
const post = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const shown: Toast[] = [];
const user: User = { id: 'u1', name: 'Jane', email: 'jane@x.com', role: 'owner' };

const doc = {
  id: 'doc-1', display_name: 'Panel Schedule.pdf', name: 'Panel Schedule.pdf',
  category: 'other', div: 'general', created_at: '2026-09-01T12:00:00Z',
  file_size: 2048, linked_name: null,
};

/** A File of a given size without allocating the bytes. */
function fakeFile(name: string, size: number): File {
  const f = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

beforeEach(() => {
  shown.length = 0;
  get.mockReset();
  post.mockReset();
  localStorage.clear();
  get.mockResolvedValue({ data: [doc] });
  post.mockResolvedValue({ data: { ...doc, id: 'doc-new' } });
});

function renderPage() {
  render(
    <AppProviders user={user} showToast={t => { shown.push(t); }} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <DocsPage bids={[]} gens={[]}/>
    </AppProviders>,
  );
}

/** The hidden multi-file input the upload area drives. */
function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

async function pickAndUpload(files: File[]) {
  await screen.findByText('Panel Schedule.pdf');
  fireEvent.change(fileInput(), { target: { files } });
  const upload = await screen.findByText('Upload');
  fireEvent.click(upload.closest('button')!);
}

describe('DocsPage download auth', () => {
  it('sends the crm_token bearer, not Bearer null', async () => {
    localStorage.setItem('crm_token', 'jwt.token.value');
    const fetchMock = vi.fn(() => Promise.resolve({ blob: () => Promise.resolve(new Blob(['x'])) }));
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    try {
      renderPage();
      const row = await screen.findByText('Panel Schedule.pdf');
      fireEvent.click(row);

      const download = await screen.findByText(/Download/i);
      fireEvent.click(download.closest('button')!);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('/api/documents/doc-1/download');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt.token.value');
      // The bug this replaces.
      expect((init.headers as Record<string, string>).Authorization).not.toBe('Bearer null');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('DocsPage oversized files', () => {
  it('reports the skipped count in the final toast instead of losing it', async () => {
    renderPage();
    await pickAndUpload([
      fakeFile('small.pdf', 1024),
      fakeFile('huge.pdf', 60 * 1024 * 1024),
    ]);

    await waitFor(() => expect(shown.length).toBeGreaterThan(0));
    const last = shown[shown.length - 1];
    expect(last.variant).toBe('info');
    expect(last.title).toBe('1 uploaded, 1 skipped');
    expect(last.sub).toMatch(/50 MB/);
    // Only the one under the limit was actually posted.
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not claim a green success when every file was skipped', async () => {
    renderPage();
    await pickAndUpload([
      fakeFile('huge-a.pdf', 60 * 1024 * 1024),
      fakeFile('huge-b.pdf', 80 * 1024 * 1024),
    ]);

    await waitFor(() => expect(shown.length).toBeGreaterThan(0));
    const last = shown[shown.length - 1];
    expect(last.title).toBe('0 uploaded, 2 skipped');
    expect(last.variant).toBe('info');
    expect(post).not.toHaveBeenCalled();
  });

  it('still shows a plain success when nothing was skipped', async () => {
    renderPage();
    await pickAndUpload([fakeFile('small.pdf', 1024)]);

    await waitFor(() => expect(shown.length).toBeGreaterThan(0));
    expect(shown[shown.length - 1]).toEqual({ title: '1 file uploaded' });
  });
});
