// Takeoff accuracy Task 8 — account rules, on the exact Kissimmee scope
// errors: "lighting through Southern Lighting Source" (AutoZone furnishes all
// fixtures via Graybar), "furnish and install service entrance assembly and
// MDP" (no MDP), and "install AutoZone-furnished power poles" (E-2: power poles
// furnished, installed and hard-wired by GC).
import { describe, expect, it } from 'vitest';
import {
  matchAccountRule, resolveAccountTerms, applyScopeAnswers, enforceAccountTerms, renderAccountTermsBlock,
  lightingSectionCBullet, lightingTermsBullet, verifyOptionsFor, normalizeParty, aliasMatches, DEFAULT_LIGHTING_BULLET,
  parseStatementParties, stripTermFromBullet, mentionsTerm,
  type AccountRule,
} from './accountRules';
import { composeBidData } from './composeBidData';
import { validateBidData, type BidData } from './bidData';
import fs from 'fs';
import path from 'path';
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
    expect(matchAccountRule(RULES, { gcExtracted: 'AUTOZONE STORES LLC' })).toMatchObject({ rule: AUTOZONE, matchedBy: '"AutoZone" in the drawings' });
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
  it('E-2 says "BY GC": Decision 4 — by G.C. is APT scope; the pole term is still asked (AutoZone asks), with APT pre-filled', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', a1.furnishStatements, false);
    expect(snap.resolved.find(t => t.term === 'power_poles')).toBeUndefined();
    expect(snap.questions.map(q => [q.half, q.suggested])).toEqual([['furnish', 'APT'], ['install', 'APT']]);
    expect(snap.questions[0].notes).toEqual([
      'E-2: "POWER POLES FURNISHED, INSTALLED AND HARD-WIRED BY GC."',
      'The drawings say "by G.C." — on electrical drawings that is APT scope (the GC subcontracts the electrical to APT), so APT is pre-filled.',
    ]);
    // Accepting the pre-fill: APT furnishes and installs.
    expect(applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'APT', 'scope:power_poles:install': 'APT' }).find(t => t.term === 'power_poles'))
      .toMatchObject({ furnishBy: 'APT', installBy: 'APT', source: 'estimator' });
  });
  it('no statement: a scope question with the AI\'s notes; the answer then drives the term', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [], false, () => ['AI count: 8 × Retail power pole (E-2)']);
    // Fix round 1 / B7 — furnish-by and install-by are asked SEPARATELY.
    const notes = ['No furnish/install statement for this was found on the drawings.', 'AI count: 8 × Retail power pole (E-2)'];
    expect(snap.questions).toEqual([
      { term: 'power_poles', kind: 'ask', half: 'furnish', label: 'Power poles — furnished by',
        question: 'Who FURNISHES the power poles? (APT / GC / Owner / Vendor)', options: ['APT', 'GC', 'Owner', 'Vendor'], notes, known: {} },
      { term: 'power_poles', kind: 'ask', half: 'install', label: 'Power poles — installed by',
        question: 'Who INSTALLS the power poles? (APT / GC / Owner / Vendor)', options: ['APT', 'GC', 'Owner', 'Vendor'], notes, known: {} },
    ]);
    // Half answered: still open.
    expect(applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'GC' }).find(t => t.term === 'power_poles')).toBeUndefined();
    // The realistic AutoZone answer: GC furnishes, APT installs and wires.
    const resolved = applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'GC', 'scope:power_poles:install': 'APT' });
    expect(resolved.find(t => t.term === 'power_poles')).toEqual({ term: 'power_poles', furnishBy: 'GC', installBy: 'APT', source: 'estimator' });
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
  it('power poles "BY GC" per E-2 (Decision 4): APT scope — the poles are kept and priced, never excluded', () => {
    const answered = enforceAccountTerms(kissimmeeAgent4(), snap, applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'APT', 'scope:power_poles:install': 'APT' }));
    expect(answered.output.takeoff!.find(c => c.name === 'Branch Power')!.items!.map(i => i.item)).toEqual(['Power pole']);
    expect((answered.output.exclusions ?? []).join(' ')).not.toMatch(/power poles.*by the GC/i);
    // Until answered, the poles are left exactly as Agent 4 wrote them.
    expect(r.output.takeoff!.find(c => c.name === 'Branch Power')!.items!.map(i => i.item)).toEqual(['Power pole']);
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
    // Decision 4 — nothing about the "by GC" poles is removed.
    expect(r.corrections.some(c => c.startsWith('Removed takeoff line "Power pole"'))).toBe(false);
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
      '- Section C bullet 1 must read exactly: "Lighting fixtures furnished by the Owner through the Graybar national account. EC to receive, inventory, and install all fixtures per schedule."',
      '- Power poles: NOT YET DECIDED — do not state who furnishes or installs them.',
      '- There is NO MDP on the drawings: never write "MDP" or "main distribution panel".',
      '- Never write: "Southern Lighting Source", "Complete lighting package (ECFECI)", "Distribution gear (ECFECI)", " MDP", "main distribution panel".',
      `- ${GC_MEANS_APT_RULE}`,
    ]);
  });
});

describe('enforcement keeps {b, t} bold-lead bullets (Task 13)', () => {
  it('MDP removed and the lead stays bold', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [], false);
    const out = enforceAccountTerms({
      sections: [{ title: 'A. Service & Distribution', bullets: [{ b: 'Furnish and install', t: ' the service entrance assembly and MDP (ECFECI).' }] }],
      takeoff: [],
    }, snap, snap.resolved);
    expect(out.output.sections![0].bullets![0]).toEqual({ b: 'Furnish and install', t: ' the service entrance assembly (ECFECI).' });
  });
});

// ── Fix round 1 ─────────────────────────────────────────────────────────────

/** The Cowork Kissimmee proposal's own sections, as Agent 4 output. */
function coworkAgent4(): Agent4Output {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/bidstd/kissimmee.bid_data.json'), 'utf8')) as BidData;
  return {
    plan_date: d.plan_date, sheets: ['E-1', 'E-2', 'E-3'],
    sections: d.sections.map(x => ({ title: x.title, bullets: [...x.bullets] })),
    exclusions: [...d.exclusions], fixture_types: ['A', 'B', 'C', 'M', 'G', 'D', 'S1', 'S2'], allowances_bullets: [],
    takeoff: d.takeoff.map(c => ({ name: c.name, items: c.items.map(i => ({ ...i })) })),
    alternates: [], takeoff_notes: [],
  };
}
const bt = (b: unknown) => (typeof b === 'string' ? b : `${(b as { b: string }).b}${(b as { t: string }).t}`);

describe('B6 — enforcement edits Section C in place, never past its limit (review repro B)', () => {
  it('a Cowork-style C bullet ("Install all interior and site fixtures ... (Owner-furnished)") is REPLACED; C = 3 after compose; validateBidData passes', () => {
    const a4 = coworkAgent4();
    a4.sections![2].bullets = ['Install all interior and site fixtures per the luminaire schedule (Owner-furnished).', a4.sections![2].bullets![1]];
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [], false);
    const r = enforceAccountTerms(a4, snap, applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'GC', 'scope:power_poles:install': 'APT' }));
    const c = r.output.sections!.find(x => x.title.startsWith('C.'))!;
    expect(c.bullets!.map(bt)).toEqual([
      'Lighting fixtures furnished by the Owner through the Graybar national account. EC to receive, inventory, and install all fixtures per schedule.',
      bt(coworkAgent4().sections![2].bullets![1]),
    ]);
    const { data } = composeBidData({ name: 'AutoZone Store #10077', loc: '2860 N Old Lake Wilson Rd, Kissimmee, FL 34747', gc: 'Summit General Contractors', brand: 'AutoZone' }, r.output, '$81,485.60');
    expect(data.sections.find(x => x.title.startsWith('C.'))!.bullets).toHaveLength(3);
    expect(validateBidData(data)).toEqual([]);
  });
  it('a full Section C with no lighting-ish bullet: bullet 1 is replaced, not a 4th added', () => {
    const a4 = coworkAgent4();
    a4.fixture_types = [];
    a4.sections![2].bullets = ['Controls per E-5.', 'Photocell on the roof.', 'Occupancy sensors per plan.'];
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [], false);
    const r = enforceAccountTerms(a4, snap, snap.resolved);
    expect(r.output.sections!.find(x => x.title.startsWith('C.'))!.bullets).toHaveLength(3);
  });
});

describe('B7 — power poles: answered in two halves; applying the answer rewrites only text about the poles', () => {
  const a4 = coworkAgent4();
  a4.sections![1].bullets!.push('Branch circuits and conduit to the power poles per E-2.');
  a4.takeoff!.find(c => c.name === 'Branch Power')!.items!.push({ item: 'Power pole feed', description: '20A circuit to each retail power pole', unit: 'EA', qty: 8, source: 'E-2' });
  a4.takeoff!.find(c => c.name === 'Branch Power')!.items!.push({ item: 'Retail power poles', description: '', unit: 'EA', qty: 8, source: 'E-2' });
  const snap = resolveAccountTerms(AUTOZONE, 'brand', [], false);

  it('the review repro: GC furnishes AND installs -> receptacles, the pole feed and the circuits to the poles all stay; only the poles go', () => {
    const r = enforceAccountTerms(a4, snap, applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'GC', 'scope:power_poles:install': 'GC' }));
    const b = r.output.sections!.find(x => x.title.startsWith('B.'))!.bullets!.map(bt);
    expect(b).toEqual([
      bt(coworkAgent4().sections![1].bullets![0]),
      'Provide all receptacles and display baseflex floor connections per the power plans.',
      'Branch circuits and conduit to the power poles per E-2.',
    ]);
    const bp = r.output.takeoff!.find(c => c.name === 'Branch Power')!.items!.map(i => i.item);
    expect(bp).toContain('Power pole feed');
    expect(bp).not.toContain('Retail power poles');
    expect(bp).not.toContain('Power pole');
    expect(bp).toContain('Receptacles');
    expect(bp).toContain('Baseflex');
    expect(r.output.exclusions!.map(bt)).toContain('Power poles furnished and installed by the GC.');
  });
  it('GC furnishes / APT installs (the realistic answer): nothing is lost; "Provide ... retail power poles" is split so it no longer says APT furnishes them (fix round 2 / S-R2-3); the poles are "GC (EC installs)"', () => {
    const r = enforceAccountTerms(a4, snap, applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'GC', 'scope:power_poles:install': 'APT' }));
    expect(r.output.sections!.find(x => x.title.startsWith('B.'))!.bullets!.map(bt)).toEqual([
      bt(coworkAgent4().sections![1].bullets![0]),
      'Provide all receptacles and display baseflex floor connections per the power plans.',
      'Install the power poles furnished by the GC.',
      'Branch circuits and conduit to the power poles per E-2.',
    ]);
    const poles = r.output.takeoff!.find(c => c.name === 'Branch Power')!.items!.find(i => i.item === 'Retail power poles')!;
    expect(poles.furnish_by).toBe('GC (EC installs)');
    expect(r.output.takeoff!.find(c => c.name === 'Branch Power')!.items!.find(i => i.item === 'Power pole feed')!.furnish_by).toBeUndefined();
  });
  it('stripTermFromBullet cases', () => {
    expect(stripTermFromBullet('power_poles', 'Provide retail power poles, receptacles and baseflex connections.')).toEqual({ action: 'strip', text: 'Provide receptacles and baseflex connections.' });
    expect(stripTermFromBullet('power_poles', 'Provide receptacles, baseflex connections, and retail power poles.')).toEqual({ action: 'strip', text: 'Provide receptacles and baseflex connections.' });
    expect(stripTermFromBullet('power_poles', 'Power pole feeds and final connections by EC.')).toEqual({ action: 'keep' });
    expect(stripTermFromBullet('power_poles', 'Furnish and install eight (8) retail power poles.')).toEqual({ action: 'remove' });
    expect(stripTermFromBullet('power_poles', 'Retail power poles as shown on E-2, coordinated with the store fixture vendor and set before the ceiling grid is complete.').action).toBe('flag');
  });
});

describe('S6 — an answered question is rendered as decided, never also "NOT YET DECIDED"', () => {
  it('the block after the estimator answers', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [], false);
    expect(renderAccountTermsBlock(snap, snap.resolved)).toContain('- Power poles: NOT YET DECIDED');
    const block = renderAccountTermsBlock(snap, applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'GC', 'scope:power_poles:install': 'APT' }))!;
    expect(block).toContain('- Power poles: furnished by the GC; installed by APT.');
    expect(block).not.toContain('NOT YET DECIDED');
  });
});

describe('S7 — drawing statements: furnish and install parsed separately, multi-word parties', () => {
  it.each([
    ['FURNISHED AND INSTALLED BY OWNER', 'Owner', 'Owner'],
    ['BY EQUIPMENT VENDOR', 'Vendor', 'Vendor'],
    ['BY OTHERS', 'Others', 'Others'],
    ['FURNISHED BY THE EQUIPMENT VENDOR, INSTALLED BY EC', 'Vendor', 'APT'],
    ['PROVIDED BY OWNER', 'Owner', null],
  ])('%s', (quote, f, i) => {
    expect(parseStatementParties('', '', quote)).toEqual({ furnish: f, install: i });
  });
  it('Decision 4 — the drawings reader takes "by GC" as APT and remembers which half said GC', () => {
    expect(parseStatementParties('', '', 'POWER POLES FURNISHED BY GC, INSTALLED AND WIRED BY EC.'))
      .toEqual({ furnish: 'APT', install: 'APT', viaGc: { furnish: true, install: false } });
    expect(parseStatementParties('', '', 'F&I BY GC')).toEqual({ furnish: 'APT', install: 'APT', viaGc: { furnish: true, install: true } });
    expect(parseStatementParties('', '', 'SIMPLEX RECEPTACLE, G.C. FURNISHED/INSTALLED')).toEqual({ furnish: 'APT', install: 'APT', viaGc: { furnish: true, install: true } });
    // Our own scope text keeps GC as GC (an estimator's GC answer is real).
    expect(parseStatementPartiesRaw('', '', 'F&I BY GC')).toEqual({ furnish: 'GC', install: 'GC' });
  });
  it('the review repro: "FURNISHED BY GC, INSTALLED AND WIRED BY EC" — install APT from the drawings; furnish asked with APT pre-filled', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [
      { item: 'Power poles', furnishBy: '', installBy: '', sourceSheet: 'E-2', quote: 'POWER POLES FURNISHED BY GC, INSTALLED AND WIRED BY EC.' },
    ], false);
    expect(snap.questions.map(q => [q.half, q.suggested, q.known?.installBy])).toEqual([['furnish', 'APT', 'APT']]);
  });
  it('a drawing that gives only one half asks only the other', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [
      { item: 'Power poles', furnishBy: '', installBy: '', sourceSheet: 'E-2', quote: 'POWER POLES PROVIDED BY OWNER.' },
    ], false);
    expect(snap.questions.map(q => q.half)).toEqual(['install']);
    expect(applyScopeAnswers(snap, { 'scope:power_poles:install': 'APT' }).find(t => t.term === 'power_poles')).toMatchObject({ furnishBy: 'Owner', installBy: 'APT' });
  });
  it('a conflict answer carries its structured parties (the equipment-vendor case no longer vanishes)', () => {
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [
      { item: 'Disconnects', furnishBy: '', installBy: '', sourceSheet: 'E-4', quote: 'DISCONNECTS FURNISHED BY THE EQUIPMENT VENDOR, INSTALLED BY EC.' },
    ], false);
    const q = snap.questions.find(x => x.term === 'disconnects')!;
    expect(q.optionParties![0]).toEqual({ furnishBy: 'Vendor', installBy: 'APT' });
    expect(applyScopeAnswers(snap, { 'scope:disconnects': { answer: q.options[0], furnishBy: 'Vendor', installBy: 'APT' } }).find(t => t.term === 'disconnects'))
      .toMatchObject({ furnishBy: 'Vendor', installBy: 'APT', source: 'estimator' });
  });
});

describe('S8 — matching never uses the bid\'s GC; 7-11 aliases', () => {
  const SEVEN: AccountRule = { ...AUTOZONE, id: 'r-7', name: '7-Eleven', matchAliases: ['7-Eleven', '7 Eleven', 'Seven Eleven', '7Eleven', '7-11', '711'], terms: {} };
  it('a GC named "Auto Zone Construction Group" on a Dunkin\' job gets the Default', () => {
    // The bid's GC is not a match input at all (MatchInput has no bid-GC field).
    const r = matchAccountRule([DEFAULT, AUTOZONE], { brand: "Dunkin'", bidName: "Dunkin' #350", owner: 'Dunkin Brands' });
    expect(r.rule!.name).toBe('Default');
  });
  it('"7-11 #41234" matches 7-Eleven', () => {
    expect(matchAccountRule([DEFAULT, SEVEN], { bidName: '7-11 #41234' }).rule!.name).toBe('7-Eleven');
  });
  // Fix round 2 / R2-B3 — the bare "711" alias is gone (migration 120) and a
  // brand-field match outranks a name / drawings match.
  it('R2-B3 — "AutoZone Store #711", "711 Main St" and "Suite 711" are never 7-Eleven (review repro)', () => {
    const SEVEN2: AccountRule = { ...SEVEN, matchAliases: ['7-Eleven', '7 Eleven', 'Seven Eleven', '7Eleven', '7-11'] };
    expect(matchAccountRule([DEFAULT, AUTOZONE, SEVEN2], { brand: 'AutoZone', bidName: 'AutoZone Store #711 Orlando' }).rule!.name).toBe('AutoZone');
    expect(matchAccountRule([DEFAULT, AUTOZONE, SEVEN2], { bidName: "Dunkin' - 711 Main St" }).rule!.name).toBe('Default');
    expect(matchAccountRule([DEFAULT, AUTOZONE, SEVEN2], { drawingsProject: 'RETAIL SHELL SUITE 711' }).rule!.name).toBe('Default');
    // Even with the old bare alias, the brand field wins.
    expect(matchAccountRule([DEFAULT, AUTOZONE, SEVEN], { brand: 'AutoZone', bidName: 'AutoZone Store #711' }).rule!.name).toBe('AutoZone');
  });
  it('a name-only match warns; two matching rules warn', () => {
    expect(matchAccountRule([DEFAULT, SEVEN], { bidName: '7-11 #41234' }).warning).toMatch(/matched only from the bid name/);
    expect(matchAccountRule([DEFAULT, AUTOZONE, SEVEN], { brand: 'AutoZone', bidName: 'AutoZone next to 7-Eleven' }).warning).toMatch(/More than one account rule matched/);
  });
  it('drawing text (owner / project name the drawings print) still matches', () => {
    expect(matchAccountRule([DEFAULT, AUTOZONE], { drawingsProject: 'AUTOZONE STORE #10077' }).matchedBy).toBe('"AutoZone" in the drawings');
  });
});

describe('N9 — look-alikes are not the term', () => {
  it('plumbing fixtures are not lighting; a fire alarm panel is not a panelboard', () => {
    expect(mentionsTerm('lighting', 'Plumbing fixtures by owner')).toBe(false);
    expect(mentionsTerm('panels', 'Fire alarm panel by GC vendor')).toBe(false);
    expect(mentionsTerm('lighting', 'Light fixtures furnished by owner')).toBe(true);
    const snap = resolveAccountTerms(AUTOZONE, 'brand', [
      { item: 'Plumbing fixtures', furnishBy: 'Owner', installBy: 'Owner', sourceSheet: 'P-1', quote: 'PLUMBING FIXTURES BY OWNER.' },
      { item: 'Fire alarm panel', furnishBy: 'GC', installBy: 'GC', sourceSheet: 'FA-1', quote: 'FIRE ALARM PANEL BY GC VENDOR.' },
    ], false);
    expect(snap.questions.filter(q => q.kind === 'conflict')).toEqual([]);
  });
});

// ── Fix round 2 ─────────────────────────────────────────────────────────────
import { statedParties, scopeStatementFor, parseStatementPartiesRaw } from './accountRules';
import { GC_MEANS_APT_RULE } from './tradeAssignment';

describe('S-R2-2 / S-R2-3 / N-R2-4 — pole statements after the answers', () => {
  const snap = resolveAccountTerms(AUTOZONE, 'brand', [], false);
  const withB = (bullets: string[], exclusions: string[] = []) => ({ ...coworkAgent4(), sections: [
    ...coworkAgent4().sections!.filter(s => !s.title.startsWith('B.')),
    { title: 'B. Branch Power', bullets },
  ], exclusions });
  const bB = (o: Agent4Output) => o.sections!.find(s => s.title.startsWith('B.'))!.bullets!.map(bt);

  it('S-R2-2 (review repro): GC/GC — "Furnish and install power poles and receptacles per E-2." keeps its verb: "Furnish and install receptacles per E-2."', () => {
    const r = enforceAccountTerms(withB(['Furnish and install power poles and receptacles per E-2.']), snap,
      applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'GC', 'scope:power_poles:install': 'GC' }));
    expect(bB(r.output)).toEqual(['Furnish and install receptacles per E-2.']);
    expect(r.output.exclusions!.map(bt)).toContain('Power poles furnished and installed by the GC.');
  });
  it('S-R2-3 (review repro): GC furnishes / APT installs — an APT-furnish statement is split, never left standing', () => {
    const r = enforceAccountTerms(withB([
      'Furnish and install power poles and receptacles per E-2.',
      'Power poles furnished and installed by APT.',
      'Branch circuits and conduit to the power poles per E-2.',
    ]), snap, applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'GC', 'scope:power_poles:install': 'APT' }));
    expect(bB(r.output)).toEqual([
      'Furnish and install receptacles per E-2.',
      'Install the power poles furnished by the GC.',
      'Branch circuits and conduit to the power poles per E-2.',
    ]);
  });
  it('N-R2-4 (review repro): APT/APT — "Power poles by others." is removed from the exclusions', () => {
    const r = enforceAccountTerms(withB(['Furnish and install power poles per E-2.'], ['Power poles by others.', 'Utility fees excluded.']), snap,
      applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'APT', 'scope:power_poles:install': 'APT' }));
    expect(r.output.exclusions!.map(bt)).toEqual(['Utility fees excluded.']);
    expect(bB(r.output)).toEqual(['Furnish and install power poles per E-2.']);
  });
  it('statedParties / scopeStatementFor', () => {
    expect(statedParties('power_poles', 'Install AutoZone-furnished power poles and hard-wire per E-2.')).toEqual({ furnish: 'Owner', install: 'APT' });
    expect(statedParties('power_poles', 'Power poles by others.')).toEqual({ furnish: 'Others', install: 'Others' });
    expect(statedParties('power_poles', 'Branch circuits and conduit to the power poles per E-2.')).toBeNull();
    expect(scopeStatementFor({ term: 'power_poles', furnishBy: 'GC', installBy: 'GC', source: 'estimator' })).toBeNull();
  });
});
