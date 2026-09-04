// @vitest-environment happy-dom
// Regression test for review finding B1. Task 5 added four hooks BELOW App's
// `if (!user)` early return, so the hook count changed whenever `user` flipped
// in place: signing in threw "Rendered more hooks than during the previous
// render", and the 401 eject (which calls `logout()` before navigating) threw
// "Rendered fewer hooks than expected" — taking out the very story the api
// client's crm:unauthorized event exists to deliver.
//
// Both other App test files mock a CONSTANT signed-in user, which is exactly
// why it slipped. This one owns the transition: it mounts App once and flips
// the user underneath it, in both directions.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';
import { UNAUTHORIZED_EVENT } from './api/session';
import { User } from './types';

afterEach(cleanup);

const USER: User = { id: 'u1', name: 'Jane Estimator', email: 'jane@x.com', role: 'owner' };

const get = vi.fn();
const post = vi.fn();
vi.mock('./api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

// A user that the test controls, standing in for the real hook's storage +
// login + logout. `logout` flips it back to null in place, which is what the
// 401 listener does.
let currentUser: User | null = null;
const setUser = (u: User | null) => { currentUser = u; };
const login = vi.fn(async () => { setUser(USER); return USER; });
const logout = vi.fn(() => setUser(null));

vi.mock('./hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('./hooks/useAuth')>('./hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({ user: currentUser, login, logout }),
  };
});

vi.mock('./features/command-center/CommandCenterPage', () => ({
  default: () => <div data-testid="dashboard-page">Command Center</div>,
}));

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  login.mockClear();
  logout.mockClear();
  currentUser = null;
  get.mockImplementation((url: string) => {
    if (url === '/dashboard') return Promise.resolve({ data: { bids: [], gens: [], wonJobs: [], activity: [] } });
    if (url === '/users') return Promise.resolve({ data: [] });
    if (url === '/preconstruction/workspaces') return Promise.resolve({ data: [] });
    if (url === '/settings') return Promise.resolve({ data: [] });
    if (url === '/intake/unread-count') return Promise.resolve({ data: { unread: 0 } });
    if (url === '/notifications') return Promise.resolve({ data: { notifications: [], unread: 0 } });
    return Promise.resolve({ data: [] });
  });
});

/** Reports the router's current location so navigations are observable. */
let location = '';
function LocationSpy() {
  const l = useLocation();
  location = l.pathname + l.search;
  return null;
}

/**
 * A host that re-renders App whenever the test asks it to, without remounting
 * it. A remount would reset the hook list and hide the whole class of bug.
 */
function Host({ path = '/dashboard' }: { path?: string }) {
  const [, bump] = React.useState(0);
  rerenderApp = () => bump(n => n + 1);
  return (
    <MemoryRouter initialEntries={[path]}>
      <LocationSpy/>
      <App/>
    </MemoryRouter>
  );
}
let rerenderApp: () => void = () => {};

describe('App survives the user flipping in place', () => {
  it('signing in re-renders into the shell instead of throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<Host path="/login"/>);
      // Logged out: the login form, no shell.
      expect(await screen.findByText('Sign in to your account')).toBeTruthy();
      expect(document.querySelector('.sidebar')).toBeNull();

      await act(async () => { setUser(USER); rerenderApp(); });

      expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
      expect(document.querySelector('.sidebar')).toBeTruthy();
      // The hook-count error React raises is logged through console.error.
      expect(errorSpy.mock.calls.flat().join(' ')).not.toMatch(/Rendered (more|fewer) hooks/);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('signing out re-renders into the login form instead of throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      currentUser = USER;
      render(<Host/>);
      expect(await screen.findByTestId('dashboard-page')).toBeTruthy();

      await act(async () => { setUser(null); rerenderApp(); });

      expect(await screen.findByText('Sign in to your account')).toBeTruthy();
      expect(document.querySelector('.sidebar')).toBeNull();
      expect(errorSpy.mock.calls.flat().join(' ')).not.toMatch(/Rendered (more|fewer) hooks/);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a crm:unauthorized event ejects to /login with ?next= and does not crash', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      currentUser = USER;
      // /docs renders DocsPage, not the dashboard stub, so wait for the shell.
      render(<Host path="/docs"/>);
      await waitFor(() => expect(document.querySelector('.sidebar')).toBeTruthy());

      // This is what api/client.ts does on a 401.
      await act(async () => {
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: {} }));
      });

      expect(logout).toHaveBeenCalled();
      expect(await screen.findByText('Sign in to your account')).toBeTruthy();
      expect(errorSpy.mock.calls.flat().join(' ')).not.toMatch(/Rendered (more|fewer) hooks/);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('keeps ?next= when several requests 401 at once', async () => {
    // The bootstrap fires several gets in parallel, so an expired session
    // produces a burst. Only the first event still knows where the user was;
    // the second used to read the already-rewritten /login path, compute an
    // empty next, and `replace` the good one away.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      currentUser = USER;
      render(<Host path="/docs"/>);
      await waitFor(() => expect(document.querySelector('.sidebar')).toBeTruthy());

      // Each in its own act(), so React commits the eject before the next 401
      // lands — that is what a real burst of parallel responses looks like, and
      // what made the later events read the already-rewritten /login path.
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: {} }));
        });
      }

      expect(await screen.findByText('Sign in to your account')).toBeTruthy();
      expect(location).toBe('/login?next=%2Fdocs');
      expect(errorSpy.mock.calls.flat().join(' ')).not.toMatch(/Rendered (more|fewer) hooks/);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('a later expiry still ejects after signing back in', async () => {
    // The latch that fixes the burst must not make the SECOND expiry a no-op.
    currentUser = USER;
    render(<Host path="/docs"/>);
    await waitFor(() => expect(document.querySelector('.sidebar')).toBeTruthy());

    await act(async () => { window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: {} })); });
    expect(await screen.findByText('Sign in to your account')).toBeTruthy();

    // Sign back in, land somewhere, then expire again.
    await act(async () => { setUser(USER); rerenderApp(); });
    await waitFor(() => expect(document.querySelector('.sidebar')).toBeTruthy());
    logout.mockClear();

    await act(async () => { window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: {} })); });

    expect(logout).toHaveBeenCalled();
    expect(await screen.findByText('Sign in to your account')).toBeTruthy();
  });
});
