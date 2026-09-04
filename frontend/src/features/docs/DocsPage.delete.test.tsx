// @vitest-environment happy-dom
// Audit ux #2 (High) — "Failed deletes are reported to the user as successful".
// On main `deleteDoc` was `await api.delete(...).catch(() => {})` followed
// unconditionally by the row removal and a "Document removed" toast, so a failed
// DELETE left the file on the server while telling the user it was gone.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DocsPage from './DocsPage';
import { AppProviders } from '../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { Toast, User } from '../../types';

afterEach(cleanup);

const get = vi.fn();
const del = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: (...a: unknown[]) => del(...a),
  },
}));

const shown: Toast[] = [];
const user: User = { id: 'u1', name: 'Test User', email: 't@example.com', role: 'owner' };

const doc = {
  id: 'doc-1',
  display_name: 'Panel Schedule.pdf',
  name: 'Panel Schedule.pdf',
  category: 'other',
  div: 'general',
  created_at: '2026-09-01T12:00:00Z',
  file_size: 2048,
  linked_name: null,
};

beforeEach(() => {
  shown.length = 0;
  get.mockReset();
  del.mockReset();
  get.mockResolvedValue({ data: [doc] });
});

function renderPage() {
  render(
    <AppProviders
      user={user}
      showToast={t => { shown.push(t); }}
      settings={DEFAULT_APP_SETTINGS}
      reloadSettings={() => {}}
    >
      <DocsPage bids={[]} gens={[]}/>
    </AppProviders>,
  );
}

describe('DocsPage delete', () => {
  it('keeps the row and says the delete failed when the DELETE rejects', async () => {
    del.mockRejectedValue(Object.assign(new Error('nope'), {
      isAxiosError: true,
      response: { status: 500, data: {} },
    }));
    renderPage();

    await screen.findByText('Panel Schedule.pdf');
    fireEvent.click(screen.getByTitle('Remove'));

    await waitFor(() => expect(shown.length).toBe(1));
    expect(shown[0]).toEqual({ variant: 'error', title: 'Delete failed', sub: 'Server error' });
    // The row is still there: the file still exists server-side.
    expect(screen.getByText('Panel Schedule.pdf')).toBeTruthy();
  });

  it('removes the row and confirms only after the DELETE resolves', async () => {
    del.mockResolvedValue({ data: {} });
    renderPage();

    await screen.findByText('Panel Schedule.pdf');
    fireEvent.click(screen.getByTitle('Remove'));

    await waitFor(() => expect(screen.queryByText('Panel Schedule.pdf')).toBeNull());
    expect(shown).toEqual([{ title: 'Document removed' }]);
    expect(del).toHaveBeenCalledWith('/documents/doc-1');
  });
});
