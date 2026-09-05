// @vitest-environment happy-dom
// Task 7 (audit code #8): SettingsPage, BidHubPage, BuilderPage, EvBuilderPage,
// ElecProjectsPage, and DocsPage are now `React.lazy`-loaded, all covered by
// the one `<Suspense>` in App.tsx (wrapping `renderView()`). These tests prove
// each one still actually renders its real content once its chunk "loads"
// (in Vitest, the dynamic import just resolves on a later microtask — there is
// no real network chunk — but that's exactly the mechanism a slow real chunk
// fetch exercises: a page that never finishes suspending would hang here on
// the fallback and these `findBy` queries would time out and fail).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const get = vi.fn();
vi.mock('./api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: { id: 'u1', name: 'Jane Estimator', email: 'jane@x.com', role: 'owner' },
      login: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

const bid = {
  id: 'b1', name: 'Circle K #4521', gc: 'ABC Construction', loc: 'Ocala, FL',
  due: '', due_days: 5, amount: 250000, sheets: 0, contact: '', stage: 'due',
  salesperson_name: '', elec_project_phase: null,
};

const dashboard = { bids: [bid], gens: [], wonJobs: [], activity: [] };

function mockApi() {
  get.mockImplementation((url: string) => {
    if (url === '/dashboard') return Promise.resolve({ data: dashboard });
    if (url === '/users') return Promise.resolve({ data: [{ name: 'Jane Estimator' }] });
    if (url === '/preconstruction/workspaces') return Promise.resolve({ data: [] });
    if (url === '/settings') return Promise.resolve({ data: [] });
    if (url === '/intake/unread-count') return Promise.resolve({ data: { unread: 0 } });
    if (url === '/notifications') return Promise.resolve({ data: { notifications: [], unread: 0 } });
    return Promise.resolve({ data: [] });
  });
}

async function renderApp(path = '/dashboard') {
  const { default: App } = await import('./App');
  render(<MemoryRouter initialEntries={[path]}><App/></MemoryRouter>);
}

beforeEach(() => {
  get.mockReset();
  document.title = 'Accurate Power CRM';
});

describe('Code-split pages render after their chunk resolves (Task 7)', () => {
  it('DocsPage renders its real content behind the lazy boundary', async () => {
    mockApi();
    await renderApp('/docs');
    expect(await screen.findByText('No documents yet — upload files above.')).toBeTruthy();
  });

  it('BuilderPage renders its real content behind the lazy boundary', async () => {
    mockApi();
    await renderApp('/builder');
    expect(await screen.findByText('Customer & Site')).toBeTruthy();
  });

  it('SettingsPage renders its real content behind the lazy boundary', async () => {
    mockApi();
    await renderApp('/admin');
    // "Company Profile" appears twice once the page has mounted (the settings
    // nav item and the section heading) — findAllByText also correctly waits
    // for the async chunk the way findByText does.
    expect((await screen.findAllByText('Company Profile')).length).toBeGreaterThan(0);
  });

  it('BidHubPage renders its real content (the bid name) behind the lazy boundary', async () => {
    mockApi();
    await renderApp('/bid/b1');
    expect(await screen.findByText('Circle K #4521')).toBeTruthy();
  });

  it('EvBuilderPage (lazy-loaded inside BuilderPage) renders after switching to EV Charger', async () => {
    mockApi();
    await renderApp('/builder');
    // The generator flow is the default — its "Cooling Type" field proves the
    // page loaded before we switch.
    expect(await screen.findByText('Cooling Type')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'EV Charger' }));
    // EvBuilderPage is a second, nested lazy import (BuilderPage.tsx's own
    // `lazy(() => import('./EvBuilderPage'))`) — the same outer <Suspense> in
    // App.tsx has to cover it too, even though it suspends two lazy-loads deep.
    expect(await screen.findByText('Installation')).toBeTruthy();
  });

  it('ElecProjectsPage (lazy-loaded inside ElectricalHubPage) renders on the Projects tab', async () => {
    mockApi();
    await renderApp('/electrical/projects');
    expect(await screen.findByText('No awarded jobs yet. Mark bids as Awarded in the Electrical Proposals board.')).toBeTruthy();
  });

  it('NotFound still renders for an unknown route with the lazy boundary in place', async () => {
    mockApi();
    await renderApp('/some-typo-nobody-typed-on-purpose');
    expect(await screen.findByText('Page not found')).toBeTruthy();
  });

  it('a per-view document.title is still set for a lazy page (usePageTitle)', async () => {
    mockApi();
    await renderApp('/docs');
    expect(await screen.findByText('No documents yet — upload files above.')).toBeTruthy();
    expect(document.title).toBe('Documents · APT CRM');
  });
});
