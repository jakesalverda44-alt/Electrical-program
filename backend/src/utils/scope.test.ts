import { describe, it, expect } from 'vitest';
import { ownScopeId } from './scope';

describe('ownScopeId (managers see all, reps see own)', () => {
  it('restricts a salesperson to their own id', () => {
    expect(ownScopeId({ id: 'rep-1', role: 'salesperson' })).toBe('rep-1');
    expect(ownScopeId({ id: 'rep-2', role: 'salesperson_legacy' })).toBe('rep-2');
  });

  it('grants full visibility (null scope) to managers and operational roles', () => {
    for (const role of ['owner', 'administrator', 'sales_manager', 'estimator', 'project_manager', 'accounting']) {
      expect(ownScopeId({ id: 'u', role })).toBeNull();
    }
  });

  it('treats unknown roles as full visibility (fail-open for non-reps)', () => {
    expect(ownScopeId({ id: 'u', role: 'read_only' })).toBeNull();
    expect(ownScopeId({ id: 'u', role: 'technician' })).toBeNull();
  });
});
