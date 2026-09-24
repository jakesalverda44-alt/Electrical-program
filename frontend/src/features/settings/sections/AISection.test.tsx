// @vitest-environment happy-dom
// Takeoff accuracy Task 1 — the counter (Agent 1C) model + max tokens are
// editable in Settings → AI like the other agents, and a save PUTs both keys.
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AppProviders } from '../../../contexts/AppContext';
import { DEFAULT_APP_SETTINGS } from '../../../hooks/useAppSettings';

const get = vi.fn();
const put = vi.fn();
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client');
  return { ...actual, default: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a), post: vi.fn() } };
});

import { AISection } from './AISection';

afterEach(cleanup);
beforeEach(() => {
  get.mockReset(); put.mockReset();
  get.mockResolvedValue({ data: { agent1: 'p1', agent2: 'p2', agent3: 'p3', agent4: 'p4' } });
  put.mockResolvedValue({ data: { ok: true } });
});

function setup() {
  render(
    <AppProviders user={{ id: 'u1', name: 'T', email: 't@test.local', role: 'owner' }} showToast={() => {}}
      settings={DEFAULT_APP_SETTINGS} reloadSettings={() => {}}>
      <AISection settings={DEFAULT_APP_SETTINGS} onSaved={vi.fn()} />
    </AppProviders>,
  );
}

describe('AISection — Agent 1C counter settings', () => {
  it('shows the counter defaults (Opus 5.5, 32000)', () => {
    setup();
    expect((screen.getByLabelText('Counter model') as HTMLSelectElement).value).toBe('claude-opus-5-5');
    expect((screen.getByLabelText('Counter max tokens') as HTMLInputElement).value).toBe('32000');
  });

  it('saving PUTs the counter keys', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Counter max tokens'), { target: { value: '48000' } });
    fireEvent.change(screen.getByLabelText('Counter model'), { target: { value: 'claude-opus-5' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0][1] as Record<string, string>;
    expect(body.ai_max_tokens_counter).toBe('48000');
    expect(body.ai_takeoff_counter_model).toBe('claude-opus-5');
  });
});

describe('AISection — evidence readers (evidence round)', () => {
  it('shows the defaults (Opus 5.5, 16000) and saving PUTs both keys', async () => {
    setup();
    expect((screen.getByLabelText('Evidence model') as HTMLSelectElement).value).toBe('claude-opus-5-5');
    expect((screen.getByLabelText('Evidence max tokens') as HTMLInputElement).value).toBe('16000');
    fireEvent.change(screen.getByLabelText('Evidence model'), { target: { value: 'claude-sonnet-4-6' } });
    fireEvent.click(await screen.findByRole('button', { name: /save/i }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0][1] as Record<string, string>;
    expect(body.ai_takeoff_evidence_model).toBe('claude-sonnet-4-6');
  });
});
