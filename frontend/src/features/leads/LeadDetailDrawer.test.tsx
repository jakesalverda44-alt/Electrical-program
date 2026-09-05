// @vitest-environment happy-dom
// Regression test for review-round-1 B3: LeadSiteSurvey is rendered as a
// JSX/DOM sibling AFTER LeadDetailDrawer's own <Modal>, not nested inside it.
// Both are `variant="drawer"` (same default `.drawer-overlay` z-index), so it
// previously only stacked on top because it happens to render later in the
// DOM — fragile, not guaranteed. It now gets an explicit higher z-index.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import LeadDetailDrawer from './LeadDetailDrawer';
import { AppProviders } from '../../contexts/AppContext';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { Lead, User } from '../../types';

afterEach(cleanup);

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

const owner: User = { id: 'u1', name: 'Jane Owner', email: 'jane@x.com', role: 'owner' };

const lead: Lead = {
  id: 'lead-1', name: 'Jane Doe', source: 'kohler', contact_method: 'phone',
  interest_level: 'warm', stage: 'site-scheduled',
};

describe('LeadDetailDrawer — LeadSiteSurvey stacking (review round 1 B3)', () => {
  it("the site survey's overlay has a z-index at least as high as the drawer overlay", async () => {
    render(
      <AppProviders user={owner} showToast={() => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
        <ConfirmProvider>
          <LeadDetailDrawer
            lead={lead}
            onClose={() => {}}
            onUpdated={() => {}}
            onDeleted={() => {}}
            onNav={() => {}}
          />
        </ConfirmProvider>
      </AppProviders>,
    );
    fireEvent.click(await screen.findByText('Start Site Survey'));
    await screen.findByText(/Site Survey — Jane Doe/);
    const overlays = Array.from(document.querySelectorAll('.drawer-overlay')) as HTMLElement[];
    expect(overlays.length).toBe(2);
    const zIndexOf = (el: HTMLElement) => el.style.zIndex ? Number(el.style.zIndex) : 160; // CSS default
    const [first, second] = overlays;
    // Whichever overlay is the survey's must be >= the drawer's own 160.
    expect(Math.max(zIndexOf(first), zIndexOf(second))).toBeGreaterThanOrEqual(170);
  });
});

// Regression test for review-round-1 B4: Modal used to call
// `e.stopPropagation()` on Escape inside a document CAPTURE listener, which
// killed the event before it ever reached the note textarea's own bubble
// handler — so Escape closed the whole drawer instead of just cancelling the
// in-progress note.
describe('LeadDetailDrawer — cancel-note Escape does not close the drawer (review round 1 B4)', () => {
  it('Escape in the note textarea cancels the note only; a second Escape then closes the drawer', async () => {
    const onClose = vi.fn();
    render(
      <AppProviders user={owner} showToast={() => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
        <ConfirmProvider>
          <LeadDetailDrawer
            lead={lead}
            onClose={onClose}
            onUpdated={() => {}}
            onDeleted={() => {}}
            onNav={() => {}}
          />
        </ConfirmProvider>
      </AppProviders>,
    );
    fireEvent.click(await screen.findByText('Note'));
    const textarea = screen.getByPlaceholderText('Add a note…');
    fireEvent.change(textarea, { target: { value: 'Called back, left voicemail' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    // The note input closed (cancelled)...
    expect(screen.queryByPlaceholderText('Add a note…')).toBeNull();
    // ...but the drawer itself did NOT close.
    expect(onClose).not.toHaveBeenCalled();
    // A subsequent Escape (nothing left to consume it) closes the drawer as normal.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
