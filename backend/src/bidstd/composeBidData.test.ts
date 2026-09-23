import { describe, expect, it } from 'vitest';
import { composeBidData, legacyProposalToBidData, ComposeBidRow } from './composeBidData';
import { Agent4Output } from '../ai/agent4Message';
import { SECTION_HEADERS } from './boilerplate';
import { validateBidData } from './bidData';

const bidRow: ComposeBidRow = {
  name: 'Circle K #4521',
  loc: '1234 Main St, Eustis, FL 32726',
  gc: 'ABC Construction',
  contact: 'John Smith',
  sq_ft: 3569,
  job_number: null,
};

const agent4Base: Agent4Output = {
  plan_date: '07.15.2026',
  sheets: ['E0.1', 'E1.0', 'E1.1'],
  sections: [
    { title: 'A. Service & Distribution', bullets: [
      'Accurate Power & Technology will furnish and install the complete service entrance assembly and MDP (ECFECI).',
      { b: 'Distribution gear (ECFECI): ', t: 'panels A, B, with feeders and disconnects throughout.' },
    ] },
    { title: 'B. Branch Power', bullets: ['Branch circuit wiring per plan and device schedule.'] },
    { title: 'C. Lighting & Controls', bullets: [
      'Complete lighting package (ECFECI) — procured through the Southern Lighting Source national account (770-242-4000).',
      'Controls & testing: occupancy sensors and photocells; functional testing prior to final inspection.',
    ] },
    { title: 'D. Site Lighting, Underground Work & Allowances', bullets: [
      'Site and pole lighting per the photometric plan.',
    ] },
    { title: 'E. Low Voltage Infrastructure (Conduit & Boxes Only)', bullets: ['Conduit and boxes only for security and data.'] },
    { title: 'F. Project Coordination & Closeout', bullets: ['Coordination with GC and other trades; as-built drawings and O&M manuals.'] },
  ],
  exclusions: ['Painting, patching and finish restoration are excluded.'],
  allowances_bullets: [
    "160' allowance - service feeder from the utility transformer secondary to the main distribution panel.",
  ],
  fixture_types: ['A', 'AE', 'B1'],
  takeoff: [
    {
      name: 'Service & Distribution',
      items: [
        { item: '1.1', description: '800A service entrance assembly (ECFECI)', unit: 'EA', qty: 1, source: 'E1.6 Riser Diagram', conf: 'VERIFIED', furnish_by: 'APT (ECFECI)' },
      ],
    },
    {
      name: 'Interior Lighting',
      items: [
        { item: '2.1', description: 'Type A troffer', unit: 'EA', qty: 13, source: 'E2.0 Luminaire Schedule', conf: 'ASSUMED' },
      ],
    },
  ],
  alternates: ['VE Option 1 - Aluminum feeders: DEDUCT $6,400.00.'],
  takeoff_notes: ['Confidence key: FIRM/APPROX/VERIFY.'],
};

describe('composeBidData', () => {
  it('produces a BidData that round-trips clean through validateBidData', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$248,750.00');
    expect(validateBidData(data)).toEqual([]);
  });

  it('bid row wins over Agent 4 for client/project identity', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$248,750.00');
    expect(data.client).toBe('ABC Construction');
    expect(data.project_name).toBe('Circle K #4521');
    expect(data.project_address).toBe('1234 Main St, Eustis, FL 32726');
    expect(data.contact).toBe('John Smith');
  });

  it('total_price comes from the validated price argument, not from Agent 4', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$999,999.99');
    expect(data.total_price).toBe('$999,999.99');
  });

  it('generates a job number when the bid row has none, and reports that it did', () => {
    const { data, jobNumberGenerated } = composeBidData(bidRow, agent4Base, '$1', { now: new Date(2026, 8, 2) });
    expect(jobNumberGenerated).toBe(true);
    expect(data.job_number).toBe('JS.09022026');
  });

  it('keeps the existing job number and reports it did NOT generate one', () => {
    const { data, jobNumberGenerated } = composeBidData({ ...bidRow, job_number: 'JS.01012020' }, agent4Base, '$1');
    expect(jobNumberGenerated).toBe(false);
    expect(data.job_number).toBe('JS.01012020');
  });

  it('scope is exactly the standard 6 bullets, terms exactly the standard 10', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$1');
    expect(data.scope).toHaveLength(6);
    expect(data.terms).toHaveLength(10);
  });

  it('folds fixture_types into a deterministic Section C 3rd bullet', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$1');
    const c = data.sections.find(s => s.title === SECTION_HEADERS.C)!;
    expect(c.bullets).toHaveLength(3);
    expect(c.bullets[2]).toBe('Fixture types per schedule: A, AE, B1.');
  });

  it('appends allowances_bullets onto Section D after Agent 4\'s own bullets', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$1');
    const d = data.sections.find(s => s.title === SECTION_HEADERS.D)!;
    expect(d.bullets).toHaveLength(2);
    expect(d.bullets[0]).toBe('Site and pole lighting per the photometric plan.');
    expect(d.bullets[1]).toMatch(/160' allowance/);
  });

  it('building_area comes from bids.sq_ft, labeled "(bid record)"', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$1');
    expect(data.building_area).toBe('3,569 SF (bid record)');
  });

  it('building_area is absent when sq_ft is not set', () => {
    const { data } = composeBidData({ ...bidRow, sq_ft: null }, agent4Base, '$1');
    expect(data.building_area).toBeUndefined();
  });

  it('normalizes Agent 4\'s own VERIFIED/ASSUMED confidence to FIRM/APPROX', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$1');
    const svc = data.takeoff.find(c => c.name === 'Service & Distribution')!;
    expect(svc.items[0].conf).toBe('FIRM');
    const lighting = data.takeoff.find(c => c.name === 'Interior Lighting')!;
    expect(lighting.items[0].conf).toBe('APPROX');
  });

  it('prefers the saved estimate\'s confidence over Agent 4\'s own echo', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$1', {
      savedLineItems: [{ category: 'Service & Distribution', item: '1.1', confidence: 'VERIFY' }],
    });
    const svc = data.takeoff.find(c => c.name === 'Service & Distribution')!;
    expect(svc.items[0].conf).toBe('VERIFY'); // overrides Agent 4's 'VERIFIED' -> would've been FIRM
  });

  // Phase B, Task 3 — a Plan-Viewer-confirmed quantity (qty_source='markup')
  // must reach the takeoff outputs (this data feeds the GC takeoff xlsx,
  // the pre-bid package xlsx, and the proposal's own embedded takeoff
  // table — all read data.takeoff, composed here).
  it('prefers a markup-confirmed qty/unit over Agent 4\'s own echoed qty', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$1', {
      savedLineItems: [{ category: 'Service & Distribution', item: '1.1', qty: 2, unit: 'EA', qty_source: 'markup' }],
    });
    const svc = data.takeoff.find(c => c.name === 'Service & Distribution')!;
    expect(svc.items[0].qty).toBe(2); // NOT Agent 4's echoed qty of 1
    expect(svc.items[0].unit).toBe('EA');
  });

  it('does NOT override qty for a takeoff- or manual-sourced saved line — only "markup" is authoritative enough', () => {
    const takeoffSourced = composeBidData(bidRow, agent4Base, '$1', {
      savedLineItems: [{ category: 'Service & Distribution', item: '1.1', qty: 999, unit: 'EA', qty_source: 'takeoff' }],
    });
    const manualSourced = composeBidData(bidRow, agent4Base, '$1', {
      savedLineItems: [{ category: 'Service & Distribution', item: '1.1', qty: 999, unit: 'EA', qty_source: 'manual' }],
    });
    expect(takeoffSourced.data.takeoff.find(c => c.name === 'Service & Distribution')!.items[0].qty).toBe(1); // Agent 4's own qty
    expect(manualSourced.data.takeoff.find(c => c.name === 'Service & Distribution')!.items[0].qty).toBe(1);
  });

  it('a markup-confirmed qty and a saved confidence combine independently (both override, from the same saved line)', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$1', {
      savedLineItems: [{ category: 'Service & Distribution', item: '1.1', qty: 3, unit: 'EA', qty_source: 'markup', confidence: 'FIRM' }],
    });
    const item = data.takeoff.find(c => c.name === 'Service & Distribution')!.items[0];
    expect(item.qty).toBe(3);
    expect(item.conf).toBe('FIRM');
  });

  it('carries furnish_by through onto the composed takeoff item', () => {
    const { data } = composeBidData(bidRow, agent4Base, '$1');
    const svc = data.takeoff.find(c => c.name === 'Service & Distribution')!;
    expect(svc.items[0].furnish_by).toBe('APT (ECFECI)');
  });

  it('canonicalizes a section title even if Agent 4 slightly misformats it', () => {
    const doctored: Agent4Output = {
      ...agent4Base,
      sections: agent4Base.sections!.map(s =>
        s.title.startsWith('A.') ? { ...s, title: 'A.  Service and Distribution' } : s
      ),
    };
    const { data } = composeBidData(bidRow, doctored, '$1');
    expect(data.sections.some(s => s.title === SECTION_HEADERS.A)).toBe(true);
  });
});

describe('legacyProposalToBidData', () => {
  const oldShape = {
    date: '2026-09-02',
    gcName: 'ABC Construction',
    gcContact: 'Jane Doe',
    projectName: 'Circle K #4521',
    projectAddress: '1234 Main St, Eustis, FL',
    jobNumber: 'JS.09022026',
    scopeOfWork: {
      standard6Bullets: ['All work per plan.'],
      A_ServiceDistribution: ['Service entrance assembly and MDP (ECFECI).'],
      B_BranchPower: ['Branch circuit wiring per plan.'],
      C_LightingControls: ['Complete lighting package (ECFECI).', 'Controls and testing.', 'LED fixtures per schedule.'],
      D_SiteLightingUnderground: ['Site lighting per allowance.'],
      E_LowVoltage: ['Conduit and boxes only.'],
      F_Coordination: ['Coordinate with GC.'],
    },
    exclusions: ['Painting and patching.'],
    takeoff: [
      { category: 'Interior Lighting', item: 'LED Troffer 2x4', description: '40W 4000K fixture', unit: 'EA', qty: 48, sourceNotes: 'Per schedule E-401' },
    ],
    terms: ['Based on drawings dated 2026-09-02.'],
    totalPrice: '$425,000',
  };

  it('maps old A-F keys onto the new canonical section titles', () => {
    const mapped = legacyProposalToBidData(oldShape);
    expect(mapped.sections?.map(s => s.title)).toEqual([
      SECTION_HEADERS.A, SECTION_HEADERS.B, SECTION_HEADERS.C,
      SECTION_HEADERS.D, SECTION_HEADERS.E, SECTION_HEADERS.F,
    ]);
  });

  it('preserves bullet text verbatim', () => {
    const mapped = legacyProposalToBidData(oldShape);
    const a = mapped.sections?.find(s => s.title === SECTION_HEADERS.A);
    expect(a?.bullets).toEqual(['Service entrance assembly and MDP (ECFECI).']);
  });

  it('groups takeoff rows by category', () => {
    const mapped = legacyProposalToBidData(oldShape);
    expect(mapped.takeoff).toHaveLength(1);
    expect(mapped.takeoff![0].name).toBe('Interior Lighting');
    expect(mapped.takeoff![0].items[0].description).toBe('40W 4000K fixture');
  });

  it('omits a section entirely when its bullet array is empty', () => {
    const partial = { ...oldShape, scopeOfWork: { ...oldShape.scopeOfWork, B_BranchPower: [] } };
    const mapped = legacyProposalToBidData(partial);
    expect(mapped.sections?.some(s => s.title === SECTION_HEADERS.B)).toBe(false);
  });

  it('carries the price and job number through unchanged', () => {
    const mapped = legacyProposalToBidData(oldShape);
    expect(mapped.total_price).toBe('$425,000');
    expect(mapped.job_number).toBe('JS.09022026');
  });

  it('handles a captured old-shape sample missing several fields without throwing', () => {
    const sparse = { projectName: 'Sparse Job', totalPrice: '$1' };
    expect(() => legacyProposalToBidData(sparse)).not.toThrow();
    const mapped = legacyProposalToBidData(sparse);
    expect(mapped.project_name).toBe('Sparse Job');
    expect(mapped.sections).toEqual([]);
    expect(mapped.takeoff).toEqual([]);
  });

  // FIX-2 — old-shape allowances[{item,footage,unit,notes}] must survive
  // into a Section D bullet, not be silently dropped.
  describe('allowances -> Section D bullets (FIX-2)', () => {
    it('appends an LF allowance onto an existing Section D, in the standard phrasing', () => {
      const withAllowances = {
        ...oldShape,
        allowances: [{ item: 'Site lighting feeder', footage: 160, unit: 'LF', notes: 'Per site plan' }],
      };
      const mapped = legacyProposalToBidData(withAllowances);
      const d = mapped.sections?.find(s => s.title === SECTION_HEADERS.D);
      expect(d).toBeTruthy();
      expect(d!.bullets).toContain('Site lighting per allowance.');
      expect(d!.bullets.some(b => typeof b === 'string' && /^160' allowance — Site lighting feeder \(Per site plan\)$/.test(b))).toBe(true);
    });

    it('creates Section D when it was otherwise empty, and includes the unit when it is not LF', () => {
      const noD = { ...oldShape, scopeOfWork: { ...oldShape.scopeOfWork, D_SiteLightingUnderground: [] } };
      const withAllowances = {
        ...noD,
        allowances: [{ item: 'Underground conduit', footage: 400, unit: 'EA', notes: '' }],
      };
      const mapped = legacyProposalToBidData(withAllowances);
      const d = mapped.sections?.find(s => s.title === SECTION_HEADERS.D);
      expect(d).toBeTruthy();
      expect(d!.bullets).toEqual(['400 EA allowance — Underground conduit']);
    });

    it('omits a trailing notes parenthetical when notes is blank', () => {
      const withAllowances = {
        ...oldShape,
        allowances: [{ item: 'Parking lot lighting', footage: 250, unit: 'LF' }],
      };
      const mapped = legacyProposalToBidData(withAllowances);
      const d = mapped.sections?.find(s => s.title === SECTION_HEADERS.D);
      expect(d!.bullets).toContain("250' allowance — Parking lot lighting");
    });
  });
});
