// All customer-facing wording for the "Install Only" (customer-furnished generator) proposal,
// kept in ONE module so Jake / his attorney can edit it without touching layout code.
// Source: docs/superpowers/plans/2026-10-01-generator-install-only.md section 4.
// Warranty and Clause 28 wording approved by Jake (2026-10-01); Clause 28: attorney review still recommended.
import type { InstallOnlyScope } from './genData';

export const IO_TYPE_LABEL = 'Install Only';
export const IO_SUBTITLE = 'Generator Installation Agreement — Customer-Furnished Equipment';
export const IO_CUSTOMER_FURNISHED_LABEL = 'Customer-Furnished';

/** True when the customer also supplies the transfer switch (so wording mentions it). */
export const ioCustomerAts = (io: Pick<InstallOnlyScope, 'ats'>) => io.ats === 'customer-install';

// ---- Intro -------------------------------------------------------------------------------
export const ioIntroLead = (company: string, io: Pick<InstallOnlyScope, 'ats'>) =>
  `${company} proposes to furnish the labor and installation materials necessary to install the customer-furnished generator${ioCustomerAts(io) ? ' and transfer switch' : ''} described below, in accordance with the `;
export const IO_INTRO_NEC_SUFFIX = ' National Electrical Code';
export const IO_INTRO_MID = ', the Bid Documents, and the following qualifications: ';
export const ioIntroValidity = (days: number) => `THIS PROPOSAL IS VALID FOR ${days} DAYS.`;

// ---- Scope rows (title + body) -----------------------------------------------------------
export const ioCustomerGenTitle = (brand: string, size: string, unitDesc: string) =>
  `Customer-Furnished Generator — ${brand} ${size}${unitDesc.trim() ? ` (${unitDesc.trim()})` : ''}`;
export const ioCustomerGenBody = (io: Pick<InstallOnlyScope, 'ats'>) =>
  `The generator${ioCustomerAts(io) ? ' and automatic transfer switch' : ''} ${ioCustomerAts(io) ? 'are' : 'is'} furnished by the Buyer. APT provides installation labor and installation materials only, as listed below. Buyer is responsible for delivery to the site, condition, completeness (all parts, manuals, accessories) and compatibility with the home's electrical service.`;

export const IO_SET_TITLE = 'Set & Place Generator';
export const ioSetBody = (where: 'new-pad' | 'stand' | 'existing') =>
  `Set and level the customer-furnished generator in its final location ${
    where === 'new-pad' ? 'on a new APT-furnished pad'
    : where === 'stand' ? 'on an APT-furnished adjustable gen stand'
    : 'on the existing code-compliant pad/base'}, maintaining manufacturer-required clearances.`;

export const ioAtsCustomerTitle = 'Install Customer-Furnished Transfer Switch';
export const ioAtsAptTitle = (atsSize: string) => `Furnish & Install ${atsSize} Transfer Switch`;
export const ioAtsExistingTitle = 'Existing Transfer Switch';
export const ioAtsInstallBody = (kind: 'customer' | 'apt', atsSize: string, qty: number) =>
  `Mount and wire the ${kind === 'customer' ? 'customer-furnished' : 'APT-furnished'} ${atsSize} transfer switch${qty > 1 ? ` (qty ${qty})` : ''}, including utility disconnect coordination, service and load-side connections, grounding and bonding.`;
export const IO_ATS_EXISTING_BODY = "Connect to the transfer switch already installed. APT is not responsible for the existing switch's condition, rating or prior installation; defects found will be quoted separately.";

export const ioConduitRunTitle = (ft: number) => `Conduit & Wire, Generator to Transfer Switch (~${ft} ft)`;
export const IO_CONDUIT_RUN_BODY = 'Furnish and install conduit, fittings, power conductors and control wiring.';
export const ioConduitWireTitle = (ft: number) => `Wire Pull, Existing Conduit (~${ft} ft)`;
export const IO_CONDUIT_WIRE_BODY = 'Conduit installed by others. Pull new power conductors and control wiring through it. If the existing conduit is obstructed, damaged or undersized, replacement will be quoted separately.';
export const IO_CONDUIT_EXISTING_TITLE = 'Existing Conduit & Wiring';
export const IO_CONDUIT_EXISTING_BODY = 'Conduit and conductors are existing (by others); APT terminates at both ends only.';

export const IO_CONNECT_TITLE = 'Generator-to-Transfer-Switch Connection';
export const IO_CONNECT_BODY = 'Terminate power, neutral, ground and control/communication wiring at the generator and transfer switch; verify voltage and transfer operation.';

export const IO_BATTERY_TITLE = 'Battery (APT-furnished)';
export const IO_BATTERY_BODY = 'Furnish and install a new generator starting battery to manufacturer spec.';

export const IO_STARTUP_TITLE = 'Startup & Commissioning';
export const IO_STARTUP_BODY = 'Startup per manufacturer procedure: check oil, battery and fuel pressure at the unit (gas by others unless listed), configure the controller and exercise schedule, test transfer and retransfer, and review operation with the Buyer. APT will register the manufacturer warranty on the Buyer\'s behalf where the manufacturer allows.';

export const IO_PERMIT_TITLE = 'Permit';
export const IO_PERMIT_INCLUDED_BODY = 'APT will secure the permit and schedule inspections; permit fee included.';
export const IO_PERMIT_EXCLUDED_BODY = 'Permits are not included. If the authority having jurisdiction requires a permit or inspection, it will be added by written change order.';

export const IO_GAS_TITLE_BY_OTHERS = 'Gas — By Others';
export const IO_GAS_BY_OTHERS_BODY = 'Fuel supply, piping, regulator and gas connection are NOT included.';
export const IO_GAS_TITLE_INCLUDED = 'Gas Connection';
export const IO_GAS_INCLUDED_BODY = 'Gas connection to existing stub-out at the generator.';

export const IO_WARRANTY_TITLE = 'Warranty — Workmanship Only';
export const IO_WARRANTY_BODY = "APT warrants its installation workmanship and APT-furnished materials for twelve (12) months from startup. Customer-furnished equipment is covered only by its manufacturer's warranty, if any; APT makes no warranty on it and is not responsible for manufacturer warranty claims, parts or labor. Manufacturer coverage may depend on registration and/or installation by an authorized dealer; Buyer is responsible for confirming eligibility.";

export const IO_NOT_INCLUDED_TITLE = 'Not Included';
export const ioNotIncludedBody = (io: Pick<InstallOnlyScope, 'ats'>) =>
  `Generator${ioCustomerAts(io) ? ' and transfer switch' : ''} equipment; gas work (unless listed); removal or disposal of packaging or old equipment; repairs to existing non-compliant wiring; anything not listed above.`;

// ---- Price breakdown row labels ----------------------------------------------------------
export const IO_ROW_SET = 'Set & Place Generator';
export const ioRowAtsInstall = (qty: number, atsSize: string) => `ATS Installation (${qty} × ${atsSize})`;
export const ioRowAtsEquip = (qty: number, atsSize: string) => `ATS — APT-furnished (${qty} × ${atsSize})`;
export const ioRowConduitRun = (ft: number) => `Conduit & Wire Run (${ft} ft)`;
export const ioRowWirePull = (ft: number) => `Wire Pull in Existing Conduit (${ft} ft)`;
export const IO_ROW_CONNECT = 'Generator-to-ATS Connection';
export const IO_ROW_GAS = 'Gas Connection at Unit';
export const IO_ROW_LABOR = 'Additional Labor';
export const IO_TAX_NOTE = 'Sales tax applies to APT-furnished materials only; installation labor and permit are not taxed.';

// ---- Disclosures -------------------------------------------------------------------------
export const ioDisclosurePermit = (included: boolean) =>
  `Permits are ${included ? 'included' : 'not included'}; sales tax is included on taxable items.`;

// ---- Sales Agreement clause 28 -----------------------------------------------------------
export const IO_CLAUSE28_TITLE = 'Customer-Furnished Equipment';
export const IO_CLAUSE28_INTRO = 'Where the Generator Proposal identifies equipment as furnished by Buyer:';
export const IO_CLAUSE28_ITEMS: string[] = [
  '(a) APT is not selling that equipment. Paragraphs 1, 3, 11, 12, 13(c), 14 and 15 apply only to goods and materials actually furnished by APT.',
  '(b) The deposit under Paragraph 2 becomes nonrefundable once APT has applied for a permit, purchased job-specific materials, or scheduled the installation, whichever is first.',
  '(c) The limited warranty in Paragraph 13(a) covers APT workmanship and APT-furnished materials only.',
  "(d) Buyer represents the equipment is new or in good working order, complete and suitable for the site. APT is not liable for its defects, missing parts, shipping damage or performance. Extra trips or labor caused by defective or incomplete customer-furnished equipment are billed at APT's shop rate ($160/hr).",
  '(e) Risk of loss of customer-furnished equipment remains with Buyer at all times.',
  '(f) If the Proposal states permits are not included, Paragraph 17 applies only to permits later added by written change order.',
];

// ---- Builder-side validation messages ----------------------------------------------------
export const IO_ISSUE_RUNFT = 'Enter the conduit / wire run length (ft) — it is required unless conduit & wiring already exist.';
export const IO_ISSUE_PAD_WITHOUT_SET = 'Pad, gen stand, lift and battery apply only when "Set generator" is checked.';
export const IO_ISSUE_ATS_QTY = 'ATS quantity must be at least 1 unless the transfer switch is already installed.';
export const IO_ISSUE_LC_ATS = 'The 12KW load-center unit has its own integrated transfer switch — APT cannot supply an ATS for it.';
