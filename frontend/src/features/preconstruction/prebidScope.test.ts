import { describe, it, expect } from 'vitest';
import { buildScopeFromPrebid } from './prebidScope';

const S = (id: string, title: string, items = ['x']) => ({ id, title, items });

describe('buildScopeFromPrebid', () => {
  it('maps by title, not by letter', () => {
    const out = buildScopeFromPrebid([
      S('D', 'Site Lighting, Underground Work & Allowances', ['pole bases']),
      S('E', 'Low Voltage Infrastructure (Conduit & Boxes Only)', ['empty conduit']),
    ]);
    // Cowork D is Site -> CRM F. Cowork E is Low Voltage -> CRM D. Never letter-aligned.
    expect(out.F).toContain('pole bases');
    expect(out.D).toContain('empty conduit');
    expect(out.E).toBeUndefined();
  });

  it('maps the straightforward sections', () => {
    const out = buildScopeFromPrebid([
      S('A', 'Service & Distribution', ['gear']),
      S('B', 'Branch Power', ['receptacles']),
      S('C', 'Lighting & Controls', ['fixtures']),
      S('F', 'Project Coordination & Closeout', ['commissioning']),
    ]);
    expect(out.A).toContain('gear');
    expect(out.B).toContain('receptacles');
    expect(out.C).toContain('fixtures');
    expect(out.G).toContain('commissioning');
  });

  it('resolves a job-type qualified heading to its base section', () => {
    const out = buildScopeFromPrebid([S('B', 'Branch Power — Car Wash Equipment', ['turbines'])]);
    expect(out.B).toContain('turbines');
  });

  it('appends an unrecognized section to G with its heading retained', () => {
    const out = buildScopeFromPrebid([S('H', 'Tunnel Conveyor Controls', ['vfd'])]);
    expect(out.G).toContain('Tunnel Conveyor Controls');
    expect(out.G).toContain('vfd');
  });

  it('leaves Fire Alarm untouched', () => {
    expect(buildScopeFromPrebid([S('A', 'Service & Distribution')]).E).toBeUndefined();
  });

  it('renders items as bullet lines and skips empty sections', () => {
    const out = buildScopeFromPrebid([S('A', 'Service & Distribution', ['one', 'two']), S('B', 'Branch Power', [])]);
    expect(out.A).toBe('• one\n• two');
    expect(out.B).toBeUndefined();
  });

  it('returns an empty object for no sections', () => {
    expect(buildScopeFromPrebid([])).toEqual({});
  });
});
