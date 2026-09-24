// Fix round 1 / B6 + S17 — the Kissimmee reference proposal composed the way
// the app composes it: the Cowork proposal's sections and takeoff as Agent 4
// output -> the seeded AutoZone account rule (power poles answered "GC
// furnishes, APT installs") -> bidstd/composeProposal (enforcement, scope
// list, composeBidData, CKT rows, counted quantities, blocking checks). The
// structure test, the verify test and scripts/renderProposalSample.ts all use
// this, so the committed renders are what the app actually produces.
import fs from 'fs';
import path from 'path';
import type { Agent4Output } from '../../../ai/agent4Message';
import type { BidData } from '../../../bidstd/bidData';
import { resolveAccountTerms, applyScopeAnswers, verifyOptionsFor, type AccountRule } from '../../../bidstd/accountRules';
import { composeProposal, type ComposeProposalOutput } from '../../../bidstd/composeProposal';

/** The AutoZone rule exactly as migration 114 seeds it. */
export const AUTOZONE_SEED: AccountRule = {
  id: 'seed-autozone', name: 'AutoZone', isDefault: false, matchAliases: ['AutoZone', 'Auto Zone', 'AutoZone Stores'], projectTypes: [], priority: 100,
  terms: {
    lighting: { mode: 'fixed', furnishBy: 'Owner', installBy: 'APT', vendor: 'Graybar national account' },
    panels: { mode: 'fixed', furnishBy: 'Owner', installBy: 'APT' },
    disconnects: { mode: 'fixed', furnishBy: 'APT', installBy: 'APT' },
    power_poles: { mode: 'ask' },
  },
  requiredScopeBullets: [], forbiddenPhrases: [], noMdpUnlessOnDrawings: true, notes: '', active: true,
};

export function coworkKissimmeeAgent4(): Agent4Output {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'kissimmee.bid_data.json'), 'utf8')) as BidData;
  return {
    plan_date: d.plan_date,
    sheets: ['E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7', 'PH0.1', 'A-101', 'S-1'],
    sections: d.sections.map(s => ({ title: s.title, bullets: [...s.bullets] })),
    exclusions: [...d.exclusions],
    fixture_types: ['A', 'B', 'C', 'M', 'G', 'D', 'S1', 'S2'],
    allowances_bullets: [],
    takeoff: d.takeoff.map(c => ({ name: c.name, items: c.items.map(i => ({ ...i })) })),
    alternates: [...(d.alternates ?? [])],
    takeoff_notes: [],
  };
}

export function kissimmeeThroughCompose(agent4: Agent4Output = coworkKissimmeeAgent4()): ComposeProposalOutput & { verifyOptions: ReturnType<typeof verifyOptionsFor> } {
  const snap = resolveAccountTerms(AUTOZONE_SEED, '"AutoZone" in the brand', [], false);
  const resolved = applyScopeAnswers(snap, { 'scope:power_poles:furnish': 'GC', 'scope:power_poles:install': 'APT' });
  const out = composeProposal({
    agent4,
    bidRow: {
      name: 'AutoZone Store #10077', loc: '2860 N Old Lake Wilson Rd, Kissimmee, FL 34747', gc: 'Summit General Contractors',
      contact: 'Estimating Department <estimating@summitgc.net>', sq_ft: null, job_number: 'JS.06182026', brand: 'AutoZone',
    },
    price: '$81,485.60',
    accountSnap: snap, accountResolved: resolved,
    scopeItems: [], overrides: [], countResult: null, reviewItems: [],
  });
  return { ...out, verifyOptions: { ...verifyOptionsFor(snap, resolved), projectAddress: '2860 N Old Lake Wilson Rd, Kissimmee, FL 34747' } as ReturnType<typeof verifyOptionsFor> };
}
