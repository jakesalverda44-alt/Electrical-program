// @vitest-environment happy-dom
// Install Only pricing group: every price shows its stored default (placeholder when blank)
// and a save PUTs the edited key.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AppProviders } from '../../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../../hooks/useAppSettings';
import { IO_PRICE_FIELDS } from '../../builder/genData';

const put = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { get: vi.fn(), put: (...a: unknown[]) => put(...a), post: vi.fn() } };
});

import { ProposalDefaultsSection } from './ProposalDefaultsSection';

afterEach(cleanup);
beforeEach(() => { put.mockReset(); put.mockResolvedValue({ data: {} }); });

function setup(over: Record<string, string> = {}) {
  const settings = { ...DEFAULT_APP_SETTINGS, ...over };
  render(
    <AppProviders user={{ id: 'u1', name: 'T', email: 't@test.local', role: 'owner' }} showToast={() => {}} settings={settings} reloadSettings={() => {}}>
      <ProposalDefaultsSection settings={settings} onSaved={vi.fn()} />
    </AppProviders>,
  );
}

describe('ProposalDefaultsSection — Install Only pricing', () => {
  it('has an input for every install-only price plus the permit', () => {
    setup({ gen_io_connect: '500' });
    for (const f of IO_PRICE_FIELDS) expect(screen.getByTestId(`gen-io-${f.setting}`)).toBeTruthy();
    expect(screen.getByTestId('gen-io-gen_io_permit')).toBeTruthy();
    expect((screen.getByTestId('gen-io-gen_io_connect') as HTMLInputElement).value).toBe('500');
    expect((screen.getByTestId('gen-io-gen_io_gas') as HTMLInputElement).value).toBe('');
  });

  it('saves an edited price', async () => {
    setup();
    fireEvent.change(screen.getByTestId('gen-io-gen_io_conduit_per_ft'), { target: { value: '28' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [url, body] = put.mock.calls[0];
    expect(url).toBe('/settings');
    expect(body.gen_io_conduit_per_ft).toBe('28');
  });
});
