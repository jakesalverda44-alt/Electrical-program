// @vitest-environment happy-dom
// Collapsible main navigation: icon rail, persisted in localStorage.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import AppShell from './AppShell';
import { AppProviders } from '../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import { User } from '../../types';

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

function renderShell() {
  return render(
    <AppProviders user={owner} showToast={() => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <AppShell view="dashboard" onNav={() => {}} onLogout={() => {}} genProposalCount={3} elecProposalCount={2} followupCount={5}>
        <div>page content</div>
      </AppShell>
    </AppProviders>,
  );
}

beforeEach(() => { window.localStorage.clear(); });
const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => { cleanup(); spies.splice(0).forEach(s => s.mockRestore()); });

describe('AppShell — collapsible main nav', () => {
  it('starts expanded and toggles to an icon rail and back', () => {
    renderShell();
    const side = document.querySelector('.sidebar') as HTMLElement;
    const toggle = screen.getByRole('button', { name: 'Collapse menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('app-sidebar-nav');
    expect(document.getElementById('app-sidebar-nav')).toBeTruthy();
    expect(side.classList.contains('sidebar-collapsed')).toBe(false);
    expect(screen.getByText('Workspace')).toBeTruthy();

    fireEvent.click(toggle);
    const expand = screen.getByRole('button', { name: 'Expand menu' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(side.classList.contains('sidebar-collapsed')).toBe(true);
    expect(screen.queryByText('Workspace')).toBeNull();
    expect(screen.queryByText('Jane Owner')).toBeNull();

    fireEvent.click(expand);
    expect(side.classList.contains('sidebar-collapsed')).toBe(false);
    expect(screen.getByText('Workspace')).toBeTruthy();
  });

  it('persists the choice in localStorage and restores it', () => {
    const { unmount } = renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse menu' }));
    expect(window.localStorage.getItem('app-nav-collapsed')).toBe('1');
    unmount();
    renderShell();
    expect(screen.getByRole('button', { name: 'Expand menu' })).toBeTruthy();
  });

  it('keeps nav labels as accessible names and the badge counts when collapsed', () => {
    window.localStorage.setItem('app-nav-collapsed', '1');
    renderShell();
    for (const label of ['Home', 'Generators', 'Electrical', 'Contacts', 'Calendar', 'Follow-ups', 'Documents', 'Settings']) {
      const b = within(document.querySelector('.sidebar') as HTMLElement).getByRole('button', { name: label });
      expect(b.getAttribute('title')).toBe(label);
    }
    const counts = Array.from(document.querySelectorAll('.sidebar .nav-count')).map(e => e.textContent);
    expect(counts).toEqual(['3', '2', '5']);
  });

  it('falls back to expanded when storage throws', () => {
    spies.push(vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); }));
    spies.push(vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); }));
    renderShell();
    expect(screen.getByRole('button', { name: 'Collapse menu' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse menu' }));
    expect(screen.getByRole('button', { name: 'Expand menu' })).toBeTruthy();
  });
});
