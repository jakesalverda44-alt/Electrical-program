// @vitest-environment happy-dom
// Regression test for review-round-1 B3: LeadSiteSurvey is rendered as a
// JSX/DOM sibling AFTER LeadDetailDrawer's own <Modal>, not nested inside it.
// Both are `variant="drawer"` (same default `.drawer-overlay` z-index), so it
// previously only stacked on top because it happens to render later in the
// DOM — fragile, not guaranteed. It now gets an explicit higher z-index.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import LeadDetailDrawer from './LeadDetailDrawer';
import { AppProviders } from '../../contexts/AppContext';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { Lead, User } from '../../types';
import api from '../../api/client';

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

// Review round 2 N1: round 1's fix picked a fixed 170, which clears the
// desktop `.drawer-overlay` (160) but loses to the mobile
// `@media (max-width: 768px)` bump that raises `.drawer-overlay` to 240 — on
// phones the site survey rendered UNDER the drawer backdrop again.
describe('LeadDetailDrawer — LeadSiteSurvey stacking (review round 1 B3, round 2 N1)', () => {
  it("the site survey's overlay clears the mobile drawer overlay z-index (240), not just the desktop one (160)", async () => {
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
    // Whichever overlay is the survey's must clear the MOBILE drawer overlay
    // z-index (240), not just the desktop one (160).
    expect(Math.max(zIndexOf(first), zIndexOf(second))).toBeGreaterThan(240);
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

// Review round 2 N2: `useConfirm()` is called from inside this drawer's own
// Modal (a `variant="drawer"` dialog). Before this fix, `ConfirmDialog`'s
// overlay sat at the plain default z-index (150), below `.drawer-overlay`
// (160) — so in a real browser, a click on the confirm's destructive button
// would actually land on the drawer overlay's backdrop underneath it,
// closing the drawer instead of running the delete. This exercises the
// actual click path end to end: opening the confirm from inside the drawer
// and clicking its destructive button must run the delete, not close the
// drawer.
describe('LeadDetailDrawer — delete confirm opened from inside the drawer (review round 2 N2)', () => {
  it("clicking the confirm dialog's destructive button runs the delete, not the drawer close", async () => {
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(
      <AppProviders user={owner} showToast={() => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
        <ConfirmProvider>
          <LeadDetailDrawer
            lead={lead}
            onClose={onClose}
            onUpdated={() => {}}
            onDeleted={onDeleted}
            onNav={() => {}}
          />
        </ConfirmProvider>
      </AppProviders>,
    );
    fireEvent.click(await screen.findByText('Actions'));
    // ActionItem wires its action to onMouseDown (with preventDefault), not
    // onClick, so a plain click doesn't fire it.
    fireEvent.mouseDown(await screen.findByText('Delete Lead'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByText('Delete'));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`/leads/${lead.id}`));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(lead));
    expect(onClose).not.toHaveBeenCalled();
  });
});
