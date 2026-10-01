import { describe, it, expect } from 'vitest';
import { isInstallOnlyGen } from './genJobType';
import type { Gen } from '../../types';

const g = (form_data: unknown) => ({ form_data } as unknown as Gen);

describe('isInstallOnlyGen', () => {
  it('reads an object or a JSON string', () => {
    expect(isInstallOnlyGen(g({ jobType: 'install-only' }))).toBe(true);
    expect(isInstallOnlyGen(g(JSON.stringify({ jobType: 'install-only' })))).toBe(true);
  });
  it('is false for other types and for anything malformed', () => {
    expect(isInstallOnlyGen(g({ jobType: 'new-install' }))).toBe(false);
    expect(isInstallOnlyGen(g({ jobType: 'swap-out' }))).toBe(false);
    for (const bad of [null, undefined, '', '{not json', 5, [], 'null']) expect(isInstallOnlyGen(g(bad))).toBe(false);
  });
});

import { installOnlySendBlock } from './genJobType';
import { IO_ISSUE_INCOMPLETE, IO_ISSUE_RUNFT } from '../builder/installOnlyText';

describe('installOnlySendBlock', () => {
  const full = { jobType: 'install-only', labor: 0, permit: 475, startup: 695, atsQty: 1, pad: true, battery: true,
    installOnly: { setGenerator: true, ats: 'customer-install', conduit: 'run', runFt: 40, gas: false, permit: true, unitDesc: '' } };
  it('is null for other types and for a complete install-only proposal', () => {
    expect(installOnlySendBlock(g({ jobType: 'new-install' }))).toBeNull();
    expect(installOnlySendBlock(g(full))).toBeNull();
  });
  it('blocks a 0 ft run and a never-set-up lead-converted form', () => {
    expect(installOnlySendBlock(g({ ...full, installOnly: { ...full.installOnly, runFt: 0 } }))).toBe(IO_ISSUE_RUNFT);
    expect(installOnlySendBlock(g({ jobType: 'install-only' }))).toBe(IO_ISSUE_INCOMPLETE);
  });
});

describe('installOnlySendBlock — same merged shape as the backend validator', () => {
  it('a sparse stored form (no startup/pad keys) is judged on blank defaults', () => {
    const sparse = { jobType: 'install-only', labor: 0, permit: 475,
      installOnly: { setGenerator: true, ats: 'customer-install', conduit: 'run', runFt: 10, gas: false, permit: true, unitDesc: '' } };
    expect(installOnlySendBlock(g(sparse))).toBeNull();
  });
});
