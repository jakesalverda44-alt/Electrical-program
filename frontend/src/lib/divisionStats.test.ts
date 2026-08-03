// frontend/src/lib/divisionStats.test.ts
import { describe, it, expect } from 'vitest';
import { genDivisionStats, elecDivisionStats, genFunnel } from './divisionStats';
import { Bid, Gen, WonJob } from '../types';

const NOW = new Date('2026-08-15T12:00:00');

const gen = (o: Partial<Gen>): Gen => ({
  id: Math.random().toString(), customer: 'C', loc: 'L', mfr: 'Kohler', model: '20KW',
  kw: 20, amount: 10000, tax: 0, stage: 'building', built_on: '2026-01-01',
  addons: 0, salesperson_name: 'Rep', ...o,
} as Gen);

const bid = (o: Partial<Bid>): Bid => ({
  id: Math.random().toString(), name: 'B', stage: 'due', amount: 50000, ...o,
} as Bid);

const won = (type: 'Generator' | 'Electrical', value: number, dateWon: string): WonJob =>
  ({ id: Math.random().toString(), proposal_type: type, value, date_won: dateWon } as WonJob);

describe('genDivisionStats', () => {
  it('counts open pipeline, excludes terminal stages', () => {
    const s = genDivisionStats([
      gen({ stage: 'building', amount: 100 }),
      gen({ stage: 'sent',     amount: 200 }),
      gen({ stage: 'signed',   amount: 400 }),
      gen({ stage: 'awarded',  amount: 800 }),
      gen({ stage: 'declined', amount: 1600 }),
      gen({ stage: 'superseded', amount: 3200 }),
    ], [], NOW);
    expect(s.openCount).toBe(3);
    expect(s.openValue).toBe(700);
  });

  it('win rate excludes superseded from both sides', () => {
    const s = genDivisionStats([
      gen({ stage: 'awarded' }), gen({ stage: 'awarded' }),
      gen({ stage: 'declined' }),
      gen({ stage: 'superseded' }), gen({ stage: 'superseded' }),
    ], [], NOW);
    expect(s.winRate).toBe(67); // 2 / (2+1)
  });

  it('winRate is null with no decided deals', () => {
    expect(genDivisionStats([gen({ stage: 'sent' })], [], NOW).winRate).toBeNull();
  });

  it('ytdSales and monthly use only Generator wonJobs in the current year', () => {
    const s = genDivisionStats([], [
      won('Generator', 1000, '2026-01-10'),
      won('Generator', 2000, '2026-08-01'),
      won('Electrical', 999,  '2026-08-01'),
      won('Generator', 5000, '2025-12-31'),
    ], NOW);
    expect(s.ytdSales).toBe(3000);
    expect(s.monthly).toHaveLength(8); // Jan..Aug
    expect(s.monthly[0]).toBe(1000);
    expect(s.monthly[7]).toBe(2000);
  });

  it('stage breakdown has one slice per pipeline stage with $ totals', () => {
    const s = genDivisionStats([gen({ stage: 'sent', amount: 10 }), gen({ stage: 'sent', amount: 5 })], [], NOW);
    const sent = s.stages.find(x => x.key === 'sent')!;
    expect(sent.count).toBe(2);
    expect(sent.value).toBe(15);
  });
});

describe('elecDivisionStats', () => {
  it('open = due + submitted; win rate = awarded/(awarded+lost)', () => {
    const s = elecDivisionStats([
      bid({ stage: 'due', amount: 10 }),
      bid({ stage: 'submitted', amount: 20 }),
      bid({ stage: 'awarded' }),
      bid({ stage: 'lost' }), bid({ stage: 'lost' }),
    ], [], NOW);
    expect(s.openCount).toBe(2);
    expect(s.openValue).toBe(30);
    expect(s.winRate).toBe(33);
  });
});

describe('genFunnel', () => {
  it('sent counts open sent proposals; viewed and signed nest inside', () => {
    const f = genFunnel([
      gen({ stage: 'sent', sent_at: '2026-08-01' }),
      gen({ stage: 'sent', sent_at: '2026-08-01', viewed_at: '2026-08-02' }),
      gen({ stage: 'signed', sent_at: '2026-08-01', viewed_at: '2026-08-02', signed_at: '2026-08-03' }),
      gen({ stage: 'awarded', sent_at: '2026-08-01' }), // terminal — out of funnel
    ]);
    expect(f).toEqual({ sent: 3, viewed: 2, signed: 1 });
  });
});
