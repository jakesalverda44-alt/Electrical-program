// @vitest-environment happy-dom
// Regression test for audit ux #15: the sidebar's "Settings" nav button opened
// a page whose topbar heading read "Admin" — a different word from the label
// the user just clicked. The nav label itself is correct and must not change;
// only the topbar title for that view was wrong.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AppShell from './AppShell';
import { AppProviders } from '../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { User } from '../../types';

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

function renderShell(view: string) {
  return render(
    <AppProviders user={owner} showToast={() => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <AppShell view={view} onNav={() => {}} onLogout={() => {}}>
        <div>page content</div>
      </AppShell>
    </AppProviders>,
  );
}

describe('AppShell — Settings topbar title (audit ux #15)', () => {
  it('titles the admin view "Settings" in the topbar, matching the nav label that opens it', () => {
    renderShell('admin');
    expect(screen.getByText('Settings', { selector: '.page-title' })).toBeTruthy();
  });

  it('keeps the sidebar nav button labeled "Settings" (this task changes the topbar title, not the nav label)', () => {
    renderShell('dashboard');
    expect(screen.getByRole('button', { name: /Settings/ })).toBeTruthy();
  });
});
