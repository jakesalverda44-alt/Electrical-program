// @vitest-environment happy-dom
// Post-review hardening (5c, audit batch 3) — SearchBox's /leads lookup now
// debounces like DocsPage's search box (300ms), instead of firing one
// request per keystroke.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import SearchBox from './SearchBox';

afterEach(cleanup);

const get = vi.fn();
vi.mock('../api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

describe('SearchBox — debounced /leads lookup (post-review hardening 5c)', () => {
  it('typing a name over several keystrokes issues one /leads request, not one per keystroke', async () => {
    get.mockResolvedValue({ data: [] });
    render(<SearchBox/>);

    fireEvent.click(screen.getByRole('button')); // opens the search field
    const input = screen.getByPlaceholderText('Search bids, customers, leads…');

    for (const partial of ['A', 'Ac', 'Acm', 'Acme']) {
      fireEvent.change(input, { target: { value: partial } });
    }

    // No request yet — still inside the 300ms debounce window.
    expect(get.mock.calls.filter(c => c[0] === '/leads')).toHaveLength(0);

    await waitFor(() => expect(get.mock.calls.filter(c => c[0] === '/leads').length).toBe(1), { timeout: 1000 });

    // And it's the final, settled value that went out — not an earlier keystroke.
    const [, config] = get.mock.calls.find(c => c[0] === '/leads')!;
    expect((config as { params: { q: string } }).params.q).toBe('Acme');
  });
});
