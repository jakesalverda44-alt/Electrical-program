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
