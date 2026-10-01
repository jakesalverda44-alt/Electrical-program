// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppProviders } from '../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';
import type { Gen } from '../../types';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import GenPipelinePage from './GenPipelinePage';

afterEach(cleanup);

const gen = (id: string, customer: string, form_data: unknown): Gen => ({
  id, customer, stage: 'building', mfr: 'Kohler', kw: 14, model: '14RCA', amount: 5000, addons: 0, loc: 'Eustis, FL',
  product_type: 'generator', form_data, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
} as unknown as Gen);

describe('GenPipelinePage — Install Only tag', () => {
  it('tags install-only cards only', () => {
    render(
      <AppProviders user={{ id: 'u1', name: 'T', email: 't@test.local', role: 'owner' }} showToast={() => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
        <GenPipelinePage
          gens={[gen('1', 'Io Customer', { jobType: 'install-only' }), gen('2', 'Full Customer', { jobType: 'new-install' }), gen('3', 'Broken Customer', '{bad json')]}
          setGens={() => {}} setWonJobs={() => {}} onOpenBuilder={() => {}} flashId={null} onEditGen={() => {}}/>
      </AppProviders>,
    );
    const tags = screen.getAllByTestId('install-only-tag');
    expect(tags).toHaveLength(1);
    expect(tags[0].closest('.bcard')?.textContent).toContain('Io Customer');
    expect(screen.getByText('Full Customer')).toBeTruthy();
    expect(screen.getByText('Broken Customer')).toBeTruthy();
  });
});
