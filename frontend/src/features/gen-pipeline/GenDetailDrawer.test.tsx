// @vitest-environment happy-dom
// Regression test for audit ux #22: GenDetailDrawer's inline "Edit Details" form
// (opened via the "Edit Details" button) used to render with no field focused,
// so a keyboard-first user had to click before typing. The Customer field —
// the first field in that form — now gets autoFocus when the form appears.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import GenDetailDrawer from './GenDetailDrawer';
import { AppProviders } from '../../contexts/AppContext';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { Gen, User } from '../../types';

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

const gen: Gen = {
  id: 'g1', customer: 'Debra Gierach', loc: 'Ocala, FL', mfr: 'Kohler', model: '20RCAL',
  kw: 20, amount: 15000, tax: 0, stage: 'sent', built_on: 'builder', addons: 0,
  salesperson_name: 'Jane Owner',
};

function renderDrawer() {
  return render(
    <AppProviders user={owner} showToast={() => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <ConfirmProvider>
        <GenDetailDrawer
          gen={gen}
          pendingDeclined={false}
          onStage={() => {}}
          onCancelDeclined={() => {}}
          onClose={() => {}}
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

describe('GenDetailDrawer — Edit Details autoFocus (audit ux #22)', () => {
  it('focuses the Customer field (the form\'s first field) when Edit Details is opened', async () => {
    renderDrawer();
    // The "Details" section is a folded DrawerSection (defaultOpen not passed) —
    // expand it before its "Edit Details" button is reachable.
    fireEvent.click(await screen.findByRole('button', { name: /Details/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Edit Details/ }));
    await waitFor(() => {
      expect(document.activeElement).toBeInstanceOf(HTMLInputElement);
      expect((document.activeElement as HTMLInputElement).value).toBe('Debra Gierach');
    });
  });
});

// Review round 1 B3: AwardKickoffModal is rendered as a JSX/DOM sibling
// AFTER the drawer's own <Modal> (not nested inside it), so its default
// `.overlay` z-index (150) used to sit UNDER the drawer's `.drawer-overlay`
// (160) and the drawer's backdrop ate every click on it.
describe('GenDetailDrawer — AwardKickoffModal stacking (review round 1 B3)', () => {
  it("the kickoff modal's overlay has a higher z-index than the drawer overlay", async () => {
    render(
      <AppProviders user={owner} showToast={() => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
        <ConfirmProvider>
          <GenDetailDrawer
            gen={gen}
            pendingDeclined={false}
            onStage={() => {}}
            onCancelDeclined={() => {}}
            onClose={() => {}}
            onEditGen={() => {}}
            onDuplicate={() => {}}
            onDelete={() => {}}
            onClosed={() => {}}
            onUpdated={() => {}}
            autoKickoff
          />
        </ConfirmProvider>
      </AppProviders>,
    );
    const drawerOverlay = await screen.findByText('🎉 Job Awarded — Kickoff').then(() =>
      document.querySelector('.drawer-overlay') as HTMLElement,
    );
    const kickoffOverlay = document.querySelector('.overlay') as HTMLElement;
    expect(drawerOverlay).toBeTruthy();
    expect(kickoffOverlay).toBeTruthy();
    expect(Number(kickoffOverlay.style.zIndex)).toBeGreaterThan(160); // .drawer-overlay's CSS z-index
  });
});
