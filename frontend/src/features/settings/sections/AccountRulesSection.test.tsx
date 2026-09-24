// @vitest-environment happy-dom
// Takeoff accuracy Task 8 — Settings → Account Rules.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const get = vi.fn();
const put = vi.fn();
const post = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a), post: (...a: unknown[]) => post(...a), delete: vi.fn() } };
});

import { AccountRulesSection, type AccountRule } from './AccountRulesSection';

const RULES: AccountRule[] = [
  { id: 'd', name: 'Default', isDefault: true, matchAliases: [], projectTypes: [], priority: 1000, terms: { lighting: { mode: 'fixed', furnishBy: 'APT', installBy: 'APT', vendor: 'Southern Lighting Source national account', contact: '770-242-4000' } }, requiredScopeBullets: [], forbiddenPhrases: [], noMdpUnlessOnDrawings: false, notes: '', active: true },
  { id: 'az', name: 'AutoZone', isDefault: false, matchAliases: ['AutoZone', 'Auto Zone'], projectTypes: [], priority: 100, terms: { lighting: { mode: 'fixed', furnishBy: 'Owner', installBy: 'APT', vendor: 'Graybar national account' }, power_poles: { mode: 'ask' } }, requiredScopeBullets: [], forbiddenPhrases: [], noMdpUnlessOnDrawings: true, notes: '', active: true },
];

afterEach(cleanup);
beforeEach(() => {
  get.mockReset(); put.mockReset(); post.mockReset();
  get.mockResolvedValue({ data: { rules: RULES } });
  put.mockImplementation((_url: string, body: Record<string, unknown>) => Promise.resolve({ data: { ...RULES[1], ...body } }));
});

describe('AccountRulesSection', () => {
  it('lists the rules; the Default rule has no alias fields', async () => {
    render(<AccountRulesSection/>);
    expect(await screen.findByText('Default (default)')).toBeTruthy();
    expect(screen.queryByLabelText('Aliases')).toBeNull();
  });

  it('editing AutoZone: disconnects fixed APT/APT, required bullet parsed, PUT body', async () => {
    render(<AccountRulesSection/>);
    fireEvent.click(await screen.findByText('AutoZone'));
    expect((screen.getByLabelText('Aliases') as HTMLInputElement).value).toBe('AutoZone, Auto Zone');
    expect((screen.getByLabelText('Power poles mode') as HTMLSelectElement).value).toBe('ask');
    fireEvent.change(screen.getByLabelText('Disconnects / safety switches mode'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('Required scope bullets'), { target: { value: 'F: Coordinate owner-furnished deliveries with the GC.' } });
    fireEvent.click(screen.getByText('Save rule'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [url, body] = put.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/account-rules/az');
    expect((body.terms as Record<string, unknown>).disconnects).toEqual({ mode: 'fixed', furnishBy: 'APT', installBy: 'APT' });
    expect((body.terms as Record<string, unknown>).power_poles).toEqual({ mode: 'ask' });
    expect(body.requiredScopeBullets).toEqual([{ section: 'F', text: 'Coordinate owner-furnished deliveries with the GC.' }]);
    expect(body.matchAliases).toEqual(['AutoZone', 'Auto Zone']);
  });

  it('shows the server\'s validation error', async () => {
    put.mockRejectedValueOnce({ response: { data: { error: 'Give the rule at least one alias (brand / owner name) or project type to match on.' } } });
    render(<AccountRulesSection/>);
    fireEvent.click(await screen.findByText('AutoZone'));
    fireEvent.change(screen.getByLabelText('Aliases'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save rule'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least one alias/);
  });
});
