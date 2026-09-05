// @vitest-environment happy-dom
// Regression test for review-round-1 B4: Modal used to call
// `e.stopPropagation()` on Escape inside a document CAPTURE listener, which
// killed the event before it ever reached this editor's own exit-fullscreen
// handler — so Escape closed the whole drawer instead of just exiting full
// screen.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import GenDetailDrawer from './GenDetailDrawer';
import { AppProviders } from '../../contexts/AppContext';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { Gen, User } from '../../types';

afterEach(cleanup);

const get = vi.fn();
vi.mock('../../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const owner: User = { id: 'u1', name: 'Jane Owner', email: 'jane@x.com', role: 'owner' };

const gen: Gen = {
  id: 'g1', customer: 'Debra Gierach', loc: 'Ocala, FL', mfr: 'Kohler', model: '20RCAL',
  kw: 20, amount: 15000, tax: 0, stage: 'sent', built_on: 'builder', addons: 0,
  salesperson_name: 'Jane Owner',
};

function renderDrawer(onClose: () => void) {
  get.mockImplementation((url: string) => {
    if (url === '/documents' || url.startsWith('/documents?')) {
      return Promise.resolve({ data: [{ id: 'd1', category: 'survey', file_type: 'image/png' }] });
    }
    if (url.includes('/documents/d1/view')) {
      return Promise.resolve({ data: new Blob(['x'], { type: 'image/png' }) });
    }
    return Promise.resolve({ data: [] });
  });
  return render(
    <AppProviders user={owner} showToast={() => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <ConfirmProvider>
        <GenDetailDrawer
          gen={gen}
          pendingDeclined={false}
          onStage={() => {}}
          onCancelDeclined={() => {}}
          onClose={onClose}
          onEditGen={() => {}}
          onDuplicate={() => {}}
          onDelete={() => {}}
          onClosed={() => {}}
          onUpdated={() => {}}
        />
      </ConfirmProvider>
    </AppProviders>,
  );
}

describe('SurveyMarkupEditor — exit-fullscreen Escape does not close the drawer (review round 1 B4)', () => {
  it('Escape exits full screen only; a second Escape then closes the drawer', async () => {
    const onClose = vi.fn();
    renderDrawer(onClose);
    fireEvent.click(await screen.findByRole('button', { name: 'Survey' }));
    const fullscreenBtn = await screen.findByRole('button', { name: /Full screen/i });
    fireEvent.click(fullscreenBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: /Exit full screen/i })).toBeTruthy());

    fireEvent.keyDown(document, { key: 'Escape' });
    // Full screen exited...
    await waitFor(() => expect(screen.getByRole('button', { name: /^Full screen$/i })).toBeTruthy());
    // ...but the drawer itself did NOT close.
    expect(onClose).not.toHaveBeenCalled();

    // A subsequent Escape (nothing left to consume it) closes the drawer as normal.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
