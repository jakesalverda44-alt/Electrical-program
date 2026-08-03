// frontend/src/lib/divisionStats.ts
import { Bid, Gen, WonJob } from '../types';

export interface StageSlice { key: string; label: string; count: number; value: number }
export interface DivisionStats {
  ytdSales: number;
  openCount: number;
  openValue: number;
  wonCount: number;
  winRate: number | null;
  stages: StageSlice[];
  monthly: number[];
}

const GEN_STAGES: { key: Gen['stage']; label: string }[] = [
  { key: 'building', label: 'Building' },
  { key: 'sent',     label: 'Proposal Sent' },
  { key: 'signed',   label: 'Signed' },
  { key: 'awarded',  label: 'Awarded' },
  { key: 'declined', label: 'Declined' },
];

const ELEC_STAGES: { key: Bid['stage']; label: string }[] = [
  { key: 'due',       label: 'Due' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'awarded',   label: 'Awarded' },
  { key: 'lost',      label: 'Lost' },
];

const sum = (a: { amount?: number | null }[]) => a.reduce((s, x) => s + Number(x.amount ?? 0), 0);

// `new Date('YYYY-MM-DD')` parses as UTC midnight, which shifts to the previous
// calendar day (and can flip the month) in any negative-UTC-offset timezone.
// Parse the date parts directly so month bucketing is timezone-independent.
function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s);
}

function wonSlices(wonJobs: WonJob[], type: 'Generator' | 'Electrical', now: Date) {
  const year = now.getFullYear();
  const mine = wonJobs.filter(j => j.proposal_type === type);
  const thisYear = mine.filter(j => parseLocalDate(j.date_won).getFullYear() === year);
  const monthly: number[] = Array.from({ length: now.getMonth() + 1 }, () => 0);
  for (const j of thisYear) {
    const m = parseLocalDate(j.date_won).getMonth();
    if (m <= now.getMonth()) monthly[m] += Number(j.value ?? 0);
  }
  return { ytdSales: thisYear.reduce((s, j) => s + Number(j.value ?? 0), 0), monthly };
}

export function genDivisionStats(gens: Gen[], wonJobs: WonJob[], now: Date = new Date()): DivisionStats {
  const open = gens.filter(g => g.stage === 'building' || g.stage === 'sent' || g.stage === 'signed');
  const awarded = gens.filter(g => g.stage === 'awarded').length;
  const declined = gens.filter(g => g.stage === 'declined').length; // superseded excluded by construction
  const decided = awarded + declined;
  const { ytdSales, monthly } = wonSlices(wonJobs, 'Generator', now);
  return {
    ytdSales,
    openCount: open.length,
    openValue: sum(open),
    wonCount: awarded,
    winRate: decided > 0 ? Math.round((awarded / decided) * 100) : null,
    stages: GEN_STAGES.map(st => {
      const group = gens.filter(g => g.stage === st.key);
      return { key: st.key, label: st.label, count: group.length, value: sum(group) };
    }),
    monthly,
  };
}

export function elecDivisionStats(bids: Bid[], wonJobs: WonJob[], now: Date = new Date()): DivisionStats {
  const open = bids.filter(b => b.stage === 'due' || b.stage === 'submitted');
  const awarded = bids.filter(b => b.stage === 'awarded').length;
  const lost = bids.filter(b => b.stage === 'lost').length;
  const decided = awarded + lost;
  const { ytdSales, monthly } = wonSlices(wonJobs, 'Electrical', now);
  return {
    ytdSales,
    openCount: open.length,
    openValue: sum(open),
    wonCount: awarded,
    winRate: decided > 0 ? Math.round((awarded / decided) * 100) : null,
    stages: ELEC_STAGES.map(st => {
      const group = bids.filter(b => b.stage === st.key);
      return { key: st.key, label: st.label, count: group.length, value: sum(group) };
    }),
    monthly,
  };
}

/** Proposal telemetry funnel: every gen that went out and is not yet decided/declined. */
export function genFunnel(gens: Gen[]): { sent: number; viewed: number; signed: number } {
  const out = gens.filter(g => g.sent_at && g.stage !== 'awarded' && g.stage !== 'declined' && g.stage !== 'superseded');
  return {
    sent: out.length,
    viewed: out.filter(g => g.viewed_at).length,
    signed: out.filter(g => g.signed_at).length,
  };
}
