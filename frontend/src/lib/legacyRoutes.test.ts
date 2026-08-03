// frontend/src/lib/legacyRoutes.test.ts
import { describe, it, expect } from 'vitest';
import { resolveLegacyPath } from './legacyRoutes';

describe('resolveLegacyPath', () => {
  it.each([
    ['/gen-leads',                '/generators/leads'],
    ['/gen-leads/abc-123',        '/generators/leads/abc-123'],
    ['/pipeline',                 '/generators/pipeline'],
    ['/gen-proposals',            '/generators/pipeline'],
    ['/gen-proposals/id-1',       '/generators/pipeline/id-1'],
    ['/elec-proposals',           '/electrical/bids'],
    ['/elec-proposals/id-2',      '/electrical/bids/id-2'],
    ['/intake',                   '/electrical/intake'],
    ['/gen-projects/id-3',        '/generators/jobs/id-3'],
    ['/elec-projects',            '/electrical/projects'],
    ['/sales-dashboard',          '/dashboard'],
    ['/reporting',                '/dashboard'],
    ['/preconstruction',          '/electrical/bids'],
  ])('%s → %s', (from, to) => {
    expect(resolveLegacyPath(from)).toBe(to);
  });

  it('returns null for non-legacy paths', () => {
    expect(resolveLegacyPath('/dashboard')).toBeNull();
    expect(resolveLegacyPath('/generators/pipeline')).toBeNull();
    expect(resolveLegacyPath('/bid/some-id')).toBeNull();
    expect(resolveLegacyPath('/builder')).toBeNull();
    expect(resolveLegacyPath('/')).toBeNull();
  });

  it('keeps URI-encoded record ids intact', () => {
    expect(resolveLegacyPath('/gen-leads/a%20b')).toBe('/generators/leads/a%20b');
  });
});
