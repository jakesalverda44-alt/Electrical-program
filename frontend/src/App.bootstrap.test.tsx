// @vitest-environment happy-dom
// Audit ux #1 / code #2 (High) — the bootstrap was
// `Promise.all([...]).then(...).finally(() => setLoading(false))` with no
// `.catch()`. Any one of the three failing rejected the chain, `loading` flipped
// false, and the app rendered its normal shell with empty bids/gens/wonJobs, so
// every board read as a legitimate "no records" state.
// Also covers code #19 (one boundary, at the root only) and code #17 (unknown
// URLs rendering a fake "coming soon" page).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
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

// A signed-in user without touching storage or the login flow.
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

// The dashboard page itself is not under test and pulls in a lot of chrome.
vi.mock('./features/command-center/CommandCenterPage', () => ({
  default: () => <div data-testid="dashboard-page">Command Center</div>,
}));

const httpError = (status: number) => Object.assign(new Error('boom'), {
  isAxiosError: true,
  response: { status, data: {} },
});

const dashboard = { bids: [], gens: [], wonJobs: [], activity: [] };

/** Route every bootstrap URL; `failing` decides which ones reject. */
function mockApi(failing: string[] = []) {
  get.mockImplementation((url: string) => {
    if (failing.includes(url)) return Promise.reject(httpError(500));
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

describe('App bootstrap failure', () => {
  it('renders BootError instead of an empty shell when /dashboard fails', async () => {
    mockApi(['/dashboard']);
    await renderApp();

    expect(await screen.findByText("Couldn't load your data")).toBeTruthy();
    expect(screen.getByText(/Nothing has been lost/)).toBeTruthy();
    // Not the normal shell showing zero records.
    expect(screen.queryByTestId('dashboard-page')).toBeNull();
  });

  it('Retry re-fetches, and the app comes up when the retry succeeds', async () => {
    mockApi(['/dashboard']);
    await renderApp();

    await screen.findByText("Couldn't load your data");
    const callsBefore = get.mock.calls.filter(c => c[0] === '/dashboard').length;

    mockApi();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(
      get.mock.calls.filter(c => c[0] === '/dashboard').length,
    ).toBeGreaterThan(callsBefore));
    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
  });

  it('shows a dismissible warning bar (and still the dashboard) when only /users fails', async () => {
    mockApi(['/users']);
    await renderApp();

    // The page itself renders — one failed list is not a reason to blank it.
    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
    const bar = await screen.findByText(/Some of this page didn't load/);
    expect(bar.textContent).toContain('the salesperson list');
    expect(screen.queryByText("Couldn't load your data")).toBeNull();

    fireEvent.click(screen.getByLabelText('Dismiss'));
    await waitFor(() => expect(screen.queryByText(/Some of this page didn't load/)).toBeNull());
  });

  it('names both failed lists when /users and /preconstruction/workspaces both fail', async () => {
    mockApi(['/users', '/preconstruction/workspaces']);
    await renderApp();

    const bar = await screen.findByText(/Some of this page didn't load/);
    expect(bar.textContent).toContain('the salesperson list');
    expect(bar.textContent).toContain('saved estimating workspaces');
  });
});

describe('App routing and titles', () => {
  it('renders a real 404 for an unknown view, not "coming soon"', async () => {
    mockApi();
    await renderApp('/askdjfh');

    expect(await screen.findByText('Page not found')).toBeTruthy();
    expect(screen.getByText('404')).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    // The shell survives, so the nav is still there to get out with.
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    expect(sidebar).toBeTruthy();
    expect(within(sidebar).getByRole('button', { name: 'Home' })).toBeTruthy();
  });

  it('sets a per-view document.title', async () => {
    mockApi();
    await renderApp('/docs');

    await waitFor(() => expect(document.title).toBe('Documents · APT CRM'));
  });
});

describe('App page-level error boundary', () => {
  it('keeps the shell and nav when the routed page throws', async () => {
    vi.resetModules();
    // Re-declare the mocks that resetModules just dropped.
    vi.doMock('./api/client', () => ({
      default: {
        get: (...a: unknown[]) => get(...a),
        post: vi.fn().mockResolvedValue({ data: {} }),
        put: vi.fn().mockResolvedValue({ data: {} }),
        patch: vi.fn().mockResolvedValue({ data: {} }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
      },
    }));
    vi.doMock('./hooks/useAuth', async () => {
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
    vi.doMock('./features/command-center/CommandCenterPage', () => ({
      default: () => { throw new Error('ProposalPreview exploded'); },
    }));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockApi();
      const { default: App } = await import('./App');
      render(<MemoryRouter initialEntries={['/dashboard']}><App/></MemoryRouter>);

      expect(await screen.findByText('This page hit an error')).toBeTruthy();
      // The whole app did not go down with it: the sidebar is still rendered.
      const sidebar = document.querySelector('.sidebar') as HTMLElement;
      expect(sidebar).toBeTruthy();
      expect(within(sidebar).getByRole('button', { name: 'Home' })).toBeTruthy();
      expect(within(sidebar).getByRole('button', { name: 'Documents' })).toBeTruthy();
      // And it is the page fallback, not the root one.
      expect(screen.queryByText('Something went wrong')).toBeNull();
    } finally {
      errorSpy.mockRestore();
      vi.doUnmock('./features/command-center/CommandCenterPage');
      vi.resetModules();
    }
  });
});
