import React, { memo } from 'react';
import { moneyFull } from '../../../lib/money';
import { confidenceToPlaybook } from '../confidence';
import { pill } from './ui';

export interface PricingRowProps {
  /** `${category}||${item}` — the override map's key. */
  itemKey: string;
  item: string;
  qty: number;
  unit: string;
  unitCost: number;
  total: number;
  overridden: boolean;
  confidence?: string;
  onUnitCostChange: (key: string, value: number) => void;
}

const confChipColor = (c: 'FIRM' | 'APPROX' | 'VERIFY') =>
  c === 'FIRM' ? 'var(--green)' : 'var(--amber)';

// One estimate line. Every prop is a primitive and `onUnitCostChange` is stable,
// so React.memo bails out on the rows the estimator did not just type in: a
// keystroke in one unit-cost box re-renders that row, not the other N-1
// (audit code #10).
function PricingRow({ itemKey, item, qty, unit, unitCost, total, overridden, confidence, onUnitCostChange }: PricingRowProps) {
  return (
    <tr>
      <td className="nm">{item}</td>
      <td className="sub" style={{ fontSize: 11 }}>—</td>
      <td className="num" style={{ textAlign: 'right' }}>{qty}</td>
      <td className="sub">{unit}</td>
      <td style={{ textAlign: 'right', padding: '4px 8px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
          {unitCost === 0 && !overridden && (
            <span title="No unit cost found in the cost library — priced at $0, understating the total"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
                background: 'var(--amber)', color: '#fff', fontSize: 10, fontWeight: 900, lineHeight: 1,
              }}>
              !
            </span>
          )}
          <input
            type="number"
            min={0}
            value={unitCost}
            onChange={e => onUnitCostChange(itemKey, Number(e.target.value))}
            style={{ width: 90, textAlign: 'right', font: 'inherit', fontSize: 13, fontWeight: 700, color: overridden ? 'var(--blue)' : unitCost === 0 ? 'var(--amber)' : 'var(--text)', background: 'var(--surface2)', border: unitCost === 0 && !overridden ? '1px solid rgba(224,165,59,.5)' : '1px solid var(--border2)', borderRadius: 6, padding: '4px 8px', outline: 'none' }}
          />
        </div>
      </td>
      <td className="num" style={{ textAlign: 'right', fontWeight: 800 }}>{moneyFull(total)}</td>
      <td>
        {(() => {
          const c = confidenceToPlaybook(confidence);
          return c ? pill(c, confChipColor(c)) : null;
        })()}
      </td>
    </tr>
  );
}

export default memo(PricingRow);
