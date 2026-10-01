// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ProposalPreview from './ProposalPreview';
import { calcGenTotals } from './genCalc';
import { LEGACY_FORMS } from './__fixtures__/legacyGenForms';

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-01T12:00:00Z')); });

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

describe('new-install / swap-out proposal renders are unchanged by Install Only', () => {
  for (const [name, form] of Object.entries(LEGACY_FORMS)) {
    it(name, async () => {
      const { container } = render(<ProposalPreview embed={false} form={form} totals={calcGenTotals(form)} proposalNo="P-1" onBack={() => {}}/>);
      await expect(container.innerHTML).toMatchFileSnapshot(`./__fixtures__/legacy-render/${name}.html`);
    });
  }
});
