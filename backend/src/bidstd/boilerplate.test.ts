// Locks every boilerplate string against drift. Each expected string is
// copied verbatim from ~/.claude/skills/apt-electrical-bid/PROJECT_INSTRUCTIONS.md
// (§5, §8, §9, §10, §11) — if this test ever needs editing to pass, the skill
// file changed and boilerplate.ts must be re-synced to it, not the other way
// around (see the plan's "skill files win" rule).
import { describe, expect, it } from 'vitest';
import {
  standardScope6, standardTerms, jobNumber,
  SECTION_HEADERS, CLOSING, PREBID_BANNER,
  TAKEOFF_CATEGORIES,
} from './boilerplate';

describe('standardScope6', () => {
  it('returns exactly 6 bullets in the standard order, with substitutions applied', () => {
    const bullets = standardScope6('07.15.2026', 'E0.1, E1.0, E1.1', 'Sample General Contractor');
    expect(bullets).toHaveLength(6);
    expect(bullets).toEqual([
      'The project is understood to be electrical work and has been reviewed and quoted as such.',
      'All work to be completed during normal business hours, 8:00 AM – 4:00 PM, Monday through Friday.',
      'Installation per plan. All changes will require a written Change Order approved by the Owner before work proceeds.',
      'Based on the electrical specifications, schedules, and drawing set dated 07.15.2026. Sheets: E0.1, E1.0, E1.1.',
      'Coordinate with Sample General Contractor for scheduling, tie-ins, and required access.',
      'Submit for and obtain all required electrical permits prior to commencement of work.',
    ]);
  });
});

describe('standardTerms', () => {
  it('returns exactly 10 bullets in the standard order, with the code-years sentence substituted', () => {
    const terms = standardTerms('07.15.2026');
    expect(terms).toHaveLength(10);
    expect(terms).toEqual([
      'Based on electrical drawings and SOW dated 07.15.2026. All work per NEC 2020, FBC 2023, and FFPC 2021.',
      'Price valid for 30 days from date of proposal. Material costs subject to market fluctuation at time of order.',
      'A deposit of 25% of the contract value is required upon execution of this agreement to initiate material procurement.',
      'Lighting package to be procured through the Southern Lighting Source national account. EC to receive, inventory, and install.',
      'Equipment lead times subject to market and manufacturer availability. APT not responsible for vendor delays.',
      'All changes to the approved scope require a written Change Order signed by the Owner prior to proceeding.',
      'Painting, patching, concrete cutting, and finish restoration are excluded from this scope.',
      "Low-voltage cabling, devices, and programming (security, tele/data, sound/intercom) by Owner's vendor. EC provides conduit and boxes only.",
      "Utility company transformer, primary-side work, and utility fees excluded. EC provides 8' conductor slack at transformer secondary.",
      'All work performed under valid permits in compliance with local, state, and AHJ requirements.',
    ]);
  });

  it('locks the 25%-deposit sentence specifically (Task 5.5 drift guard)', () => {
    expect(standardTerms('x')).toContain(
      'A deposit of 25% of the contract value is required upon execution of this agreement to initiate material procurement.'
    );
  });
});

describe('SECTION_HEADERS', () => {
  it('matches the exact section header names table', () => {
    expect(SECTION_HEADERS).toEqual({
      scope: 'SCOPE OF WORK',
      A: 'A. Service & Distribution',
      B: 'B. Branch Power',
      C: 'C. Lighting & Controls',
      D: 'D. Site Lighting, Underground Work & Allowances',
      E: 'E. Low Voltage Infrastructure (Conduit & Boxes Only)',
      F: 'F. Project Coordination & Closeout',
      exclusions: 'EXCLUSIONS & CLARIFICATIONS',
      takeoff: 'ELECTRICAL QUANTITY TAKEOFF',
      terms: 'TERMS, CONDITIONS & SPECIAL REQUIREMENTS',
    });
  });
});

describe('CLOSING block', () => {
  it('matches the standard closing block strings verbatim', () => {
    expect(CLOSING.respectfully).toBe('Respectfully,');
    expect(CLOSING.costBasis).toBe('(Cost based on Terms Above — Due Upon Acceptance to Secure Order)');
    expect(CLOSING.acceptance).toBe(
      'Please review, execute, and return this proposal along with the applicable purchase order and payment method to confirm acceptance.'
    );
    expect(CLOSING.print).toBe('Print      ___________________________________');
    expect(CLOSING.sign).toBe('Sign       ___________________________________');
    expect(CLOSING.date).toBe('Date      ___________________________________');
    expect(CLOSING.thankYou).toBe('Thank you for the opportunity to meet your electrical and power generation needs!');
  });
});

describe('PREBID_BANNER', () => {
  it('matches build_prebid.js verbatim', () => {
    expect(PREBID_BANNER).toBe('PRE-BID PACKAGE  —  INTERNAL USE');
  });
});

describe('TAKEOFF_CATEGORIES', () => {
  it('matches the 8 standard categories in order', () => {
    expect(TAKEOFF_CATEGORIES).toEqual([
      'Service & Distribution',
      'Interior Lighting',
      'Exterior / Site Lighting',
      'Lighting Controls',
      'Branch Power',
      'Site / Underground / Allowances',
      'Low Voltage Infrastructure (Conduit & Boxes Only)',
      'Grounding',
    ]);
  });
});

describe('jobNumber', () => {
  it('formats JS.MMDDYYYY from local date fields', () => {
    // Construct from local components (not an ISO string) so this test is
    // immune to the runner's timezone.
    expect(jobNumber(new Date(2026, 8, 2))).toBe('JS.09022026'); // Sept 2, 2026
  });

  it('zero-pads single-digit month and day', () => {
    expect(jobNumber(new Date(2026, 0, 5))).toBe('JS.01052026'); // Jan 5, 2026
  });

  it('handles a double-digit month and day with no padding needed', () => {
    expect(jobNumber(new Date(2026, 11, 25))).toBe('JS.12252026'); // Dec 25, 2026
  });
});
