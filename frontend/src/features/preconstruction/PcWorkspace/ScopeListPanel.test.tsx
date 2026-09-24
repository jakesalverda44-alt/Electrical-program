// @vitest-environment happy-dom
// Takeoff accuracy Task 11 — the estimator scope list panel.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), delete: (...a: unknown[]) => del(...a) } };
});

import ScopeListPanel from './ScopeListPanel';

afterEach(cleanup);
beforeEach(() => {
  get.mockReset(); post.mockReset(); del.mockReset();
  get.mockResolvedValue({ data: { items: [{ id: 'i1', kind: 'exclude', text: '600A MCC' }], overrides: [] } });
});

describe('ScopeListPanel', () => {
  it('lists items and adds a Not-included item', async () => {
    post.mockResolvedValue({ data: { items: [{ id: 'i1', kind: 'exclude', text: '600A MCC' }, { id: 'i2', kind: 'exclude', text: 'VFDs for vacuums' }], overrides: [] } });
    render(<ScopeListPanel bidId="b1" showToast={vi.fn()} />);
    expect((await screen.findByTestId('scope-item-i1')).textContent).toContain('Not included600A MCC');
    fireEvent.change(screen.getByLabelText('Scope item'), { target: { value: 'VFDs for vacuums' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/scope-items', { kind: 'exclude', text: 'VFDs for vacuums' }));
    expect(await screen.findByTestId('scope-item-i2')).toBeTruthy();
  });
  it('adds an Included (as limited) item and removes one', async () => {
    post.mockResolvedValue({ data: { items: [], overrides: [] } });
    del.mockResolvedValue({ data: { items: [], overrides: [] } });
    render(<ScopeListPanel bidId="b1" showToast={vi.fn()} />);
    await screen.findByTestId('scope-item-i1');
    fireEvent.click(screen.getByLabelText('Remove 600A MCC'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/preconstruction/b1/scope-items/i1'));
    fireEvent.change(screen.getByLabelText('Included or not included'), { target: { value: 'include' } });
    fireEvent.change(screen.getByLabelText('Scope item'), { target: { value: 'F/A: conduit + pull strings only' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/scope-items', { kind: 'include', text: 'F/A: conduit + pull strings only' }));
  });
});
