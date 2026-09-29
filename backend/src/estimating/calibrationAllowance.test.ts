// Fix round SF-5 — the calibration report prices a bid's lines WITHOUT the
// footage allowance (ratio + feeder measure lines) and Agent 2's allowance
// rows, so no "Branch Wiring (allowance)" bucket drifts the per-category
// deviations.
import { describe, it, expect } from 'vitest';
import { withoutAllowanceLines } from './calibration';

describe('SF-5 — calibration excludes allowance lines', () => {
  it('drops ratio, feeder-measure and Agent 2 allowance rows; keeps the takeoff and manual lines', () => {
    const lines = [
      { category: 'Branch Power', takeoff_key: 'Branch Power||Duplex receptacle' },
      { category: 'Branch Wiring (allowance)', takeoff_key: 'Branch Wiring (allowance)||Branch conduit allowance — EMT' },
      { category: 'Feeders (allowance)', takeoff_key: 'Feeders (allowance)||MEASURE FEEDER — 2" conduit' },
      { category: 'Site / Underground / Allowances', takeoff_key: 'Site / Underground / Allowances||Allowance — HVAC feeders 3/4" 3#6 1#10G' },
      { category: 'Site / Underground / Allowances', takeoff_key: null },
    ];
    expect(withoutAllowanceLines(lines).map(l => l.category)).toEqual(['Branch Power', 'Site / Underground / Allowances']);
  });
});
