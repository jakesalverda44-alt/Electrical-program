import { memo } from 'react';
import Icon from '../../../components/Icon';
import { moneyFull } from '../../../lib/money';

interface IntelTabProps {
  bidIntel: Record<string, unknown> | null;
}

function IntelTab({ bidIntel }: IntelTabProps) {
  return (
    <div style={{ padding: '20px 24px' }}>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">
            <span className="pt-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
              <Icon name="sparkle" size={15} stroke={1.8}/>
            </span>
            Win-Rate Insights
          </span>
        </div>
        <div style={{ padding: '16px 20px' }}>
          {bidIntel ? (
            <>
              {[
                {
                  label: `Win Rate with ${String(bidIntel.gc)}`,
                  val: bidIntel.gcWinRate != null ? `${bidIntel.gcWinRate}%` : 'No history',
                  sub: `${bidIntel.gcWins ?? 0} won · ${bidIntel.gcLosses ?? 0} lost with this GC`,
                },
                {
                  label: 'Overall Company Win Rate',
                  val: bidIntel.overallWinRate != null ? `${bidIntel.overallWinRate}%` : 'No data',
                  sub: 'Across all electrical bids submitted',
                },
                ...(bidIntel.gcAvgWonAmount ? [{
                  label: 'Avg Won Contract (this GC)',
                  val: moneyFull(Number(bidIntel.gcAvgWonAmount)),
                  sub: 'Average value of won bids with this GC',
                }] : []),
              ].map(item => (
                <div key={item.label} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)' }}>{item.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 900, color: 'var(--text)' }}>{item.val}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{item.sub}</div>
                </div>
              ))}
              <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginTop: 8 }}>
                These win-rate stats improve as more bids are entered and outcomes recorded.
              </div>
            </>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading win-rate insights…</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(IntelTab);
