// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppProviders } from '../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../hooks/useAppSettings';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import SendProposalModal from './SendProposalModal';

afterEach(cleanup);

function subjectFor(installOnly?: boolean): string {
  render(
    <AppProviders user={{ id: 'u1', name: 'T', email: 't@test.local', role: 'owner' }} showToast={() => {}} settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <SendProposalModal genId="g1" defaultEmail="a@b.com" proposalNo="JSKOHL-1" spec="22kW Generac" installOnly={installOnly}
        total="$1" deposit="$1" onSent={() => {}} onClose={() => {}}/>
    </AppProviders>,
  );
  return (screen.getByDisplayValue(/Proposal — JSKOHL-1/) as HTMLInputElement).value;
}

describe('SendProposalModal default subject', () => {
  it('names the machine for a normal proposal', () => {
    expect(subjectFor()).toBe('Your 22kW Generac Generator Proposal — JSKOHL-1');
  });
  it('does not name a machine for install-only', () => {
    expect(subjectFor(true)).toBe('Your Generator Installation Proposal — JSKOHL-1');
  });
});
