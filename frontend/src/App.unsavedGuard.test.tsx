// @vitest-environment happy-dom
// The end-to-end half of the unsaved-changes guard: the hook's own tests use a
// stand-in screen, this one proves the real wiring — a dirty BuilderPage plus a
// real sidebar click, through App's `setView`, which is the app's single
// navigation primitive (`useNavigate` is used nowhere else in the tree).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { UnsavedGuardProvider } from './contexts/UnsavedGuardContext';

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

vi.mock('./features/command-center/CommandCenterPage', () => ({
  default: () => <div data-testid="dashboard-page">Command Center</div>,
}));

beforeEach(() => {
  get.mockReset();
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

function renderAtBuilder() {
  render(
    <MemoryRouter initialEntries={['/builder']}>
      <UnsavedGuardProvider>
        <App/>
      </UnsavedGuardProvider>
    </MemoryRouter>,
  );
}

const sidebar = () => document.querySelector('.sidebar') as HTMLElement;
const clickHome = () => fireEvent.click(within(sidebar()).getByRole('button', { name: 'Home' }));

describe('unsaved-changes guard, wired through the real sidebar', () => {
  it('a dirty builder blocks a sidebar nav until the user confirms', async () => {
    renderAtBuilder();

    const customer = await screen.findByPlaceholderText('Full name or company');
    fireEvent.change(customer, { target: { value: 'Circle K #4521' } });

    clickHome();

    expect(await screen.findByText('You have unsaved changes')).toBeTruthy();
    // Still on the builder — the navigation did not happen.
    expect(screen.queryByTestId('dashboard-page')).toBeNull();
    expect(screen.getByPlaceholderText('Full name or company')).toBeTruthy();

    fireEvent.click(screen.getByText('Leave without saving'));

    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
  });

  it('a clean builder navigates straight through', async () => {
    renderAtBuilder();

    await screen.findByPlaceholderText('Full name or company');
    clickHome();

    expect(await screen.findByTestId('dashboard-page')).toBeTruthy();
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
  });

  it('"Keep editing" leaves the builder and its text exactly where they were', async () => {
    renderAtBuilder();

    const customer = await screen.findByPlaceholderText('Full name or company');
    fireEvent.change(customer, { target: { value: 'Circle K #4521' } });

    clickHome();
    fireEvent.click(await screen.findByText('Keep editing'));

    await waitFor(() => expect(screen.queryByText('You have unsaved changes')).toBeNull());
    expect((screen.getByPlaceholderText('Full name or company') as HTMLInputElement).value)
      .toBe('Circle K #4521');
    expect(screen.queryByTestId('dashboard-page')).toBeNull();
  });
});
