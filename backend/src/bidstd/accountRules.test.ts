// Takeoff accuracy Task 8 — account rules, on the exact Kissimmee scope
// errors: "lighting through Southern Lighting Source" (AutoZone furnishes all
// fixtures via Graybar), "furnish and install service entrance assembly and
// MDP" (no MDP), and "install AutoZone-furnished power poles" (E-2: power poles
// furnished, installed and hard-wired by GC).
import { describe, expect, it } from 'vitest';
import {
  matchAccountRule, resolveAccountTerms, applyScopeAnswers, enforceAccountTerms, renderAccountTermsBlock,
  lightingSectionCBullet, lightingTermsBullet, verifyOptionsFor, normalizeParty, aliasMatches, DEFAULT_LIGHTING_BULLET,
  type AccountRule,
} from './accountRules';
import { verifyBidText } from './verifyBid';
import { standardTerms } from './boilerplate';
import type { Agent4Output } from '../ai/agent4Message';
import { kissimmeeAgent1 } from '../test/fixtures/takeoff/agent1Fixtures';

// The seeded rules (migration 114), as rows.
const DEFAULT: AccountRule = {
  id: 'r-default', name: 'Default', isDefault: true, matchAliases: [], projectTypes: [], priority: 1000,
  terms: { lighting: { mode: 'fixed', furnishBy: 'APT', installBy: 'APT', vendor: 'Southern Lighting Source national account', contact: '770-242-4000' } },
  requiredScopeBullets: [], forbiddenPhrases: [], noMdpUnlessOnDrawings: false, notes: '', active: true,
};
const AUTOZONE: AccountRule = {
  id: 'r-az', name: 'AutoZone', isDefault: false, matchAliases: ['AutoZone', 'Auto Zone', 'AutoZone Stores'], projectTypes: [], priority: 100,
  terms: {
    lighting: { mode: 'fixed', furnishBy: 'Owner', installBy: 'APT', vendor: 'Graybar national account' },
    panels: { mode: 'fixed', furnishBy: 'Owner', installBy: 'APT' },
    disconnects: { mode: 'fixed', furnishBy: 'APT', installBy: 'APT' },
    power_poles: { mode: 'ask' },
  },
  requiredScopeBullets: [], forbiddenPhrases: [], noMdpUnlessOnDrawings: true, notes: '', active: true,
};
const SEVEN: AccountRule = {
  ...DEFAULT, id: 'r-711', name: '7-Eleven', isDefault: false, matchAliases: ['7-Eleven', '7 Eleven', 'Seven Eleven'], priority: 100,
  terms: { lighting: { mode: 'fixed', furnishBy: 'GC', installBy: 'APT', vendor: 'Graybar national account', contact: 'Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com' } },
};
const CARWASH_TYPE: AccountRule = { ...DEFAULT, id: 'r-cw', name: 'Car wash', isDefault: false, projectTypes: ['car_wash'], matchAliases: [], priority: 200, terms: {} };
const RULES = [DEFAULT, AUTOZONE, SEVEN, CARWASH_TYPE];

describe('matchAccountRule', () => {
  it('AutoZone by brand, by the owner the drawings print, or by the bid name; case/punctuation-insensitive', () => {
    expect(matchAccountRule(RULES, { brand: 'AutoZone' }).rule?.name).toBe('AutoZone');
    expect(matchAccountRule(RULES, { gcExtracted: 'AUTOZONE STORES LLC' })).toEqual({ rule: AUTOZONE, matchedBy: '"AutoZone" in the drawings' });
    expect(matchAccountRule(RULES, { bidName: 'Auto-Zone #10077 Kissimmee' }).rule?.name).toBe('AutoZone');
    expect(matchAccountRule(RULES, { bidName: '7 Eleven #41182 Ocala' }).rule?.name).toBe('7-Eleven');
  });
  it('an alias never matches inside another word', () => {
    expect(aliasMatches('AutoZone', 'AutoZoneX Plaza')).toBe(false);
  });
  it('project-type-only rules apply when no brand rule matches; otherwise the Default', () => {
    expect(matchAccountRule(RULES, { brand: 'Big Dan', projectType: 'car_wash' }).rule?.name).toBe('Car wash');
    expect(matchAccountRule(RULES, { brand: 'AutoZone', projectType: 'car_wash' }).rule?.name).toBe('AutoZone');
    expect(matchAccountRule(RULES, { brand: 'Starbucks' })).toEqual({ rule: DEFAULT, matchedBy: 'default (no account rule matched)' });
  });
  it('an inactive rule is skipped', () => {
    expect(matchAccountRule([DEFAULT, { ...AUTOZONE, active: false }], { brand: 'AutoZone' }).rule?.name).toBe('Default');
  });
});

describe('normalizeParty', () => {
  it('reads the parties drawings print', () => {
    expect(normalizeParty('GC')).toBe('GC');
    expect(normalizeParty('General Contractor')).toBe('GC');
    expect(normalizeParty('E.C.')).toBe('APT');
    expect(normalizeParty('Electrical Contractor')).toBe('APT');
    expect(normalizeParty('AutoZone')).toBe('Owner');
    expect(normalizeParty('by others')).toBe('Others');
    expect(normalizeParty('')).toBeNull();
  });
});

describe('resolveAccountTerms — power poles (ask) with and without a drawing statement', () => {
  const a1 = kissimmeeAgent1();
  it('E-2 states GC furnishes, installs and hard-wires: taken from the drawings, cited, no question', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', a1.furnishStatements, false);
    const poles = snap.resolved.find(t => t.term === 'power_poles')!;
    expect(poles).toEqual({ term: 'power_poles', furnishBy: 'GC', installBy: 'GC', source: 'drawings', citation: { sheet: 'E-2', quote: 'POWER POLES FURNISHED, INSTALLED AND HARD-WIRED BY GC.' } });
    expect(snap.questions).toEqual([]);
  });
  it('no statement: a scope question with the AI\'s notes; the answer then drives the term', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [], false, () => ['AI count: 8 × Retail power pole (E-2)']);
    expect(snap.questions).toEqual([{
      term: 'power_poles', kind: 'ask', label: 'Power poles',
      question: 'Who furnishes and installs the power poles? (APT / GC / Owner)', options: ['APT', 'GC', 'Owner'],
      notes: ['No furnish/install statement for this was found on the drawings.', 'AI count: 8 × Retail power pole (E-2)'],
    }]);
    const resolved = applyScopeAnswers(snap, { 'scope:power_poles': 'APT' });
    expect(resolved.find(t => t.term === 'power_poles')).toEqual({ term: 'power_poles', furnishBy: 'APT', installBy: 'APT', source: 'estimator' });
  });
  it('a fixed rule value that contradicts the drawings is a conflict question, never silently applied', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [
      { item: 'Disconnects', furnishBy: 'AutoZone', installBy: 'EC', sourceSheet: 'E-4', quote: 'DISCONNECTS FURNISHED BY AUTOZONE, INSTALLED BY EC.' },
    ], false);
    expect(snap.resolved.find(t => t.term === 'disconnects')).toBeUndefined();
    const q = snap.questions.find(x => x.term === 'disconnects')!;
    expect(q.kind).toBe('conflict');
    expect(q.options).toEqual([
      'Drawings — Disconnects / safety switches: furnished by the Owner; installed by APT.',
      'Account rule — Disconnects / safety switches: furnished and installed by APT.',
    ]);
    expect(q.notes[0]).toBe('E-4: "DISCONNECTS FURNISHED BY AUTOZONE, INSTALLED BY EC."');
    expect(applyScopeAnswers(snap, { 'scope:disconnects': q.options[1] }).find(t => t.term === 'disconnects'))
      .toMatchObject({ furnishBy: 'APT', installBy: 'APT', source: 'estimator' });
    expect(applyScopeAnswers(snap, { 'scope:disconnects': q.options[0] }).find(t => t.term === 'disconnects'))
      .toMatchObject({ furnishBy: 'Owner', installBy: 'APT', source: 'estimator' });
  });
  it('a drawing statement that AGREES with a fixed value is kept as its citation', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [
      { item: 'Light fixtures', furnishBy: 'Owner', installBy: 'EC', sourceSheet: 'E-0.1', quote: 'ALL LIGHT FIXTURES FURNISHED BY OWNER, INSTALLED BY EC.' },
    ], false);
    expect(snap.resolved.find(t => t.term === 'lighting')).toMatchObject({ source: 'rule', citation: { sheet: 'E-0.1' } });
  });
});

/** Agent 4 output carrying the three Kissimmee scope errors. */
function kissimmeeAgent4(): Agent4Output {
  return {
    plan_date: 'February 7, 2025',
    sheets: ['E-1', 'E-2', 'E-3'],
    sections: [
      { title: 'A. Service & Distribution', bullets: [
        'Furnish and install service entrance assembly and MDP (ECFECI), fed by the utility pad-mount transformer.',
        'Distribution gear (ECFECI): panels LP and HP, with feeders and disconnects throughout.',
      ] },
      { title: 'C. Lighting & Controls', bullets: [
        'Complete lighting package (ECFECI) — procured through the Southern Lighting Source national account (770-242-4000). EC to receive, inventory, and install all fixtures per schedule.',
        'Lighting controls and testing prior to final inspection.',
      ] },
      { title: 'D. Site Lighting, Underground Work & Allowances', bullets: [
        'Install AutoZone-furnished power poles and hard-wire per E-2.',
        'Site pole bases and underground conduit per E-1.',
      ] },
    ],
    exclusions: ['Utility company fees.'],
    takeoff: [
      { name: 'Service & Distribution', items: [
        { item: 'Panel LP', description: '225A panelboard (ECFECI)', unit: 'EA', qty: 1, source: 'E-4' },
        { item: '200A fused disconnect', description: 'Service disconnect', unit: 'EA', qty: 1, source: 'E-4' },
      ] },
      { name: 'Interior Lighting', items: [
        { item: 'A', description: '4 ft LED linear wraparound', unit: 'EA', qty: 73, source: 'E-3', furnish_by: 'APT (ECFECI)' },
      ] },
      { name: 'Branch Power', items: [
        { item: 'Power pole', description: 'Retail power pole', unit: 'EA', qty: 8, source: 'E-2' },
      ] },
    ],
  };
}

describe('enforceAccountTerms — the Kissimmee scope errors are corrected, every change logged', () => {
  const snap = resolveAccountTerms(AUTOZONE, 'brand', kissimmeeAgent1().furnishStatements, false);
  const r = enforceAccountTerms(kissimmeeAgent4(), snap, snap.resolved);
  const bullets = (letter: string) => (r.output.sections!.find(s => s.title.startsWith(letter))!.bullets as string[]);

  it('lighting: Southern Lighting Source / ECFECI -> owner-furnished via Graybar, EC installs', () => {
    expect(bullets('C.')[0]).toBe('Lighting fixtures furnished by the Owner through the Graybar national account. EC to receive, inventory, and install all fixtures per schedule.');
    expect(JSON.stringify(r.output)).not.toContain('Southern Lighting Source');
  });
  it('no MDP on the drawings: the MDP phrase is removed from the service entrance bullet', () => {
    expect(bullets('A.')[0]).toBe('Furnish and install service entrance assembly (ECFECI), fed by the utility pad-mount transformer.');
  });
  it('power poles (GC furnishes, installs, hard-wires per E-2): the APT install bullet and takeoff line are removed, an exclusion added', () => {
    expect(bullets('D.')).toEqual(['Site pole bases and underground conduit per E-1.']);
    expect(r.output.takeoff!.find(c => c.name === 'Branch Power')!.items).toEqual([]);
    expect(r.output.exclusions).toContain('Power poles furnished and installed by the GC.');
  });
  it('takeoff furnish_by per term; (ECFECI) stripped from owner-furnished panels; disconnects stay APT', () => {
    const sd = r.output.takeoff!.find(c => c.name === 'Service & Distribution')!.items!;
    expect(sd[0]).toMatchObject({ description: '225A panelboard', furnish_by: 'Owner (EC installs)' });
    expect(sd[1]).toMatchObject({ furnish_by: 'APT (ECFECI)' });
    expect(r.output.takeoff!.find(c => c.name === 'Interior Lighting')!.items![0].furnish_by).toBe('Owner / Graybar national account (EC installs)');
  });
  it('the mixed gear bullet ("panels ... and disconnects (ECFECI)") is not rewritten — verifyBid blocks it instead', () => {
    expect(bullets('A.')[1]).toBe('Distribution gear (ECFECI): panels LP and HP, with feeders and disconnects throughout.');
    const v = verifyBidText(bullets('A.').join('\n'), 'gc', verifyOptionsFor(snap, snap.resolved));
    expect(v.failures.find(f => f.check === 'account_terms')!.matches).toEqual(['Distribution gear (ECFECI)']);
  });
  it('logs every correction', () => {
    expect(r.corrections.some(c => c.startsWith('Section C lighting bullet replaced'))).toBe(true);
    expect(r.corrections.some(c => c.startsWith('MDP language removed'))).toBe(true);
    expect(r.corrections.some(c => c.startsWith('Removed from D. Site Lighting'))).toBe(true);
    expect(r.corrections.some(c => c.startsWith('Removed takeoff line "Power pole"'))).toBe(true);
  });
  it('the input object is never mutated', () => {
    const input = kissimmeeAgent4();
    enforceAccountTerms(input, snap, snap.resolved);
    expect(input).toEqual(kissimmeeAgent4());
  });
});

describe('verifyBid with the account terms', () => {
  it('AutoZone: Southern Lighting Source is blocked; Section C need not say ECFECI', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [], false);
    const opts = verifyOptionsFor(snap, snap.resolved);
    expect(opts.ecfeci).toEqual({ requireInSectionA: false, requireInSectionC: false, minCount: 1 });
    expect(opts.forbiddenPhrases).toEqual(['Southern Lighting Source', 'Complete lighting package (ECFECI)', 'Distribution gear (ECFECI)', ' MDP', 'main distribution panel']);
    const text = 'C. Lighting & Controls\nComplete lighting package (ECFECI) — procured through the Southern Lighting Source national account.\nDisconnects (ECFECI).';
    const v = verifyBidText(text, 'gc', opts);
    expect(v.failures.find(f => f.check === 'account_terms')!.matches).toEqual(['Southern Lighting Source', 'Complete lighting package (ECFECI)']);
  });
  it('Default rule: unchanged standard checks (3 ECFECI, A and C placement)', () => {
    const snap = resolveAccountTerms(DEFAULT, 'default', [], false);
    expect(verifyOptionsFor(snap, snap.resolved)).toEqual({ forbiddenPhrases: [], ecfeci: { requireInSectionA: true, requireInSectionC: true, minCount: 3 } });
  });
});

describe('rendering', () => {
  it('the Default rule renders the exact standard Section C sentence and TERMS bullet 4', () => {
    const snap = resolveAccountTerms(DEFAULT, 'default', [], false);
    const lighting = snap.resolved.find(t => t.term === 'lighting');
    expect(lightingSectionCBullet(lighting)).toBe(DEFAULT_LIGHTING_BULLET);
    expect(lightingTermsBullet(lighting)).toBe(standardTerms('x')[3]);
  });
  it('7-Eleven: GC furnishes through Graybar (contact named), EC installs', () => {
    const snap = resolveAccountTerms(SEVEN, 'brand', [], false);
    expect(lightingSectionCBullet(snap.resolved[0])).toBe('Lighting fixtures furnished by the GC through the Graybar national account (Anson Sauce, 817-475-0178, 7-eleven.national@graybar.com). EC to receive, inventory, and install all fixtures per schedule.');
  });
  it('the ACCOUNT TERMS block for Kissimmee states every term, the E-2 citation, the MDP rule and the forbidden phrases', () => {
    const snap = resolveAccountTerms(AUTOZONE, '"AutoZone" in the brand', kissimmeeAgent1().furnishStatements, false);
    const block = renderAccountTermsBlock(snap, snap.resolved)!;
    expect(block.split('\n')).toEqual([
      '--- ACCOUNT TERMS (AUTHORITATIVE — overrides any furnish/install or supplier language elsewhere, including your instructions) ---',
      'Account rule: AutoZone (matched by "AutoZone" in the brand).',
      '- Lighting fixtures: furnished by the Owner through the Graybar national account; installed by APT. Never tag these (ECFECI).',
      '- Panelboards: furnished by the Owner; installed by APT. Never tag these (ECFECI).',
      '- Disconnects / safety switches: furnished and installed by APT. Tag these (ECFECI).',
      '- Power poles: furnished and installed by the GC. [per E-2: "POWER POLES FURNISHED, INSTALLED AND HARD-WIRED BY GC."] Never tag these (ECFECI).',
      '- Section C bullet 1 must read exactly: "Lighting fixtures furnished by the Owner through the Graybar national account. EC to receive, inventory, and install all fixtures per schedule."',
      '- There is NO MDP on the drawings: never write "MDP" or "main distribution panel".',
      '- Never write: "Southern Lighting Source", "Complete lighting package (ECFECI)", "Distribution gear (ECFECI)", " MDP", "main distribution panel".',
    ]);
  });
});
