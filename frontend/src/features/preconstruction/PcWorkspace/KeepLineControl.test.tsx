// @vitest-environment happy-dom
// Fix round 2 / S-R2-5 + R2-B2 — "Keep this line" and "This is the counted
// line" post an override bound to the exact line AND its flag.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const post = vi.fn();
vi.mock('../../../api/client', () => ({ default: { post: (...a: unknown[]) => post(...a) } }));
import KeepLineControl from './KeepLineControl';

afterEach(() => { cleanup(); post.mockReset(); });

describe('KeepLineControl', () => {
  it('count_line: picks THE counted line with its flag', async () => {
    post.mockResolvedValue({ data: {} });
    render(<KeepLineControl bidId="b1" category="Interior Lighting" line="Type A 4 ft LED linear, sales" flag="count_line:A" showToast={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'This is the counted line' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/is the counted line/), { target: { value: 'Sales-floor A count on E-3' } });
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/preconstruction/b1/non-electrical-overrides',
      { category: 'Interior Lighting', line: 'Type A 4 ft LED linear, sales', reason: 'Sales-floor A count on E-3', flag: 'count_line:A' }));
  });
  it('defaults to the non-electrical flag', async () => {
    post.mockResolvedValue({ data: {} });
    render(<KeepLineControl bidId="b1" category="Site" line="Concrete patch 100 SF" showToast={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/belongs on this job/), { target: { value: 'Trench patch is ours per GC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep this line' }));
    await waitFor(() => expect(post.mock.calls[0][1]).toMatchObject({ flag: 'non_electrical' }));
  });
});
