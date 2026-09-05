import React, { memo, useMemo } from 'react';
import Icon from '../../../components/Icon';
import { BidEstimate, EstimateLineItem } from '../../../types';
import { ConfirmedService } from '../constants';
import { moneyFull } from '../../../lib/money';
import { confidenceToPlaybook } from '../confidence';
import PricingRow from './PricingRow';

interface PricingTabProps {
  /** Derived once in the parent (useMemo) and shared with "Save Estimate". */
  pricingLineItems: EstimateLineItem[];
  overheadPct: number;
  profitPct: number;
  confirmedService?: ConfirmedService;
  /** `aiResults?.agent1_output` — only its presence matters to this tab. */
  hasAgent1Output: boolean;
  savedEstimate: BidEstimate | null;
  estimateSaved: boolean;
  savingEstimate: boolean;
  saveEstimate: () => void;
  onUnitCostChange: (key: string, value: number) => void;
  onOverheadChange: (value: number) => void;
  onProfitChange: (value: number) => void;
  onGoTakeoff: () => void;
}

function PricingTab({ pricingLineItems, overheadPct, profitPct, confirmedService, hasAgent1Output,
  savedEstimate, estimateSaved, savingEstimate, saveEstimate,
  onUnitCostChange, onOverheadChange, onProfitChange, onGoTakeoff }: PricingTabProps) {
  // Grouping and the two counts only change when the line items do — not when
  // overhead/profit move, and not when the parent re-renders for another reason.
  const { grouped, totalDirect, zeroCostCount, confCounts } = useMemo(() => {
    const grouped: Record<string, EstimateLineItem[]> = {};
    for (const li of pricingLineItems) {
      if (!grouped[li.category]) grouped[li.category] = [];
      grouped[li.category].push(li);
    }
    const totalDirect = pricingLineItems.reduce((s, li) => s + li.total, 0);
    // A category missing from the unit-cost library resolves to unit_cost 0
    // (lookupUnitCost's ?? 0 fallback) and silently prices that line at $0 —
    // the grand total then understates the bid with no visible signal. A
    // user-overridden $0 is a deliberate choice, not a missing-cost gap, so
    // it's excluded here.
    const zeroCostCount = pricingLineItems.filter(li => li.unit_cost === 0 && !li.overridden).length;
    // Task 5 — confidence survives to the estimator's screen: a per-row
    // FIRM/APPROX/VERIFY chip plus a header count, mapped from the raw
    // Agent 1/2 vocabulary via confidenceToPlaybook (code-level only — the
    // agent prompts' own VERIFIED/ASSUMED vocabulary is unchanged).
    const confCounts = pricingLineItems.reduce((acc, li) => {
      const c = confidenceToPlaybook(li.confidence);
      if (c) acc[c] = (acc[c] ?? 0) + 1;
      return acc;
    }, {} as Record<'FIRM' | 'APPROX' | 'VERIFY', number>);
    return { grouped, totalDirect, zeroCostCount, confCounts };
  }, [pricingLineItems]);
  const totalOverhead = totalDirect * (overheadPct / 100);
  const totalProfit   = (totalDirect + totalOverhead) * (profitPct / 100);
  const grandTotal    = totalDirect + totalOverhead + totalProfit;
  const hasConfCounts = Object.keys(confCounts).length > 0;
  const compCount = savedEstimate?.comp_count ?? 0;
  const confidence = savedEstimate?.confidence ?? (compCount >= 3 ? 'HIGH' : compCount >= 1 ? 'MEDIUM' : 'LOW');
  const confColor = confidence === 'HIGH' ? 'var(--green)' : confidence === 'MEDIUM' ? 'var(--amber)' : 'var(--text3)';
  const svc = confirmedService;
  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Service data reference / confirmation gate */}
      {svc?.confirmed ? (
        <div style={{ display: 'flex', gap: 20, padding: '10px 16px', background: 'rgba(16,185,129,.08)',
          border: '1px solid rgba(16,185,129,.25)', borderRadius: 10, fontSize: 13, marginBottom: 16,
          flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontWeight: 800, color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icon name="check" size={13} stroke={2.2}/>Service Data Confirmed
          </span>
          {svc.voltage && <span style={{ color: 'var(--text2)' }}><strong>Voltage:</strong> {svc.voltage}</span>}
          {svc.ampacity && <span style={{ color: 'var(--text2)' }}><strong>Service:</strong> {svc.ampacity}A</span>}
          {svc.panel && <span style={{ color: 'var(--text2)' }}><strong>Main Panel:</strong> {svc.panel}</span>}
          <button className="btn ghost" style={{ marginLeft: 'auto', height: 26, fontSize: 11, padding: '0 10px' }}
            onClick={onGoTakeoff}>
            Edit →
          </button>
        </div>
      ) : hasAgent1Output ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', background: 'var(--amber-soft)',
          border: '1px solid rgba(224,165,59,.35)', borderRadius: 10, fontSize: 13, color: 'var(--amber)', marginBottom: 16 }}>
          <Icon name="shield" size={16} stroke={1.8}/>
          <span style={{ flex: 1, fontWeight: 600 }}>Confirm key project data on the Plan Review tab before pricing to ensure accuracy.</span>
          <button className="btn ghost" style={{ height: 28, fontSize: 12, padding: '0 12px', color: 'var(--amber)', borderColor: 'rgba(224,165,59,.45)', flexShrink: 0 }}
            onClick={onGoTakeoff}>
            Plan Review →
          </button>
        </div>
      ) : null}

      {!pricingLineItems.length ? (
        <div className="panel" style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          No takeoff data yet. Complete the AI analysis (Plan Review tab) to populate pricing.
        </div>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title">Line-Item Estimate</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {hasConfCounts && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>
                    {confCounts.FIRM ?? 0} FIRM · {confCounts.APPROX ?? 0} APPROX · {confCounts.VERIFY ?? 0} VERIFY
                  </span>
                )}
                {savedEstimate && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: confColor }}>
                    {confidence} confidence · {savedEstimate.comp_count} comp{savedEstimate.comp_count !== 1 ? 's' : ''}
                  </span>
                )}
                <button className="btn" style={{ height: 30, fontSize: 12, padding: '0 14px' }}
                  onClick={saveEstimate} disabled={savingEstimate}>
                  {savingEstimate ? 'Saving…' : 'Save Estimate'}
                </button>
                {estimateSaved && <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }}>✓ Saved</span>}
              </div>
            </div>
            <div className="table-scroll" style={{ overflowX: 'auto' }}>
              <table className="ctable" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Spec</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th>Unit</th>
                    <th style={{ textAlign: 'right' }}>Unit Cost</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(grouped).map(([cat, items]) => {
                    const catTotal = items.reduce((s, li) => s + li.total, 0);
                    return (
                      <React.Fragment key={cat}>
                        <tr style={{ background: 'var(--surface2)' }}>
                          <td colSpan={7} style={{ fontWeight: 800, fontSize: 12, color: 'var(--text2)', padding: '8px 16px', textTransform: 'uppercase', letterSpacing: '.04em' }}>{cat}</td>
                        </tr>
                        {items.map((li, idx) => (
                          <PricingRow
                            key={idx}
                            itemKey={`${li.category}||${li.item}`}
                            item={li.item}
                            qty={li.qty}
                            unit={li.unit}
                            unitCost={li.unit_cost}
                            total={li.total}
                            overridden={!!li.overridden}
                            confidence={li.confidence}
                            onUnitCostChange={onUnitCostChange}
                          />
                        ))}
                        <tr style={{ borderTop: '2px solid var(--border)' }}>
                          <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, fontSize: 12, color: 'var(--text2)', padding: '6px 16px' }}>{cat} Subtotal</td>
                          <td className="num" style={{ textAlign: 'right', fontWeight: 900 }}>{moneyFull(catTotal)}</td>
                          <td/>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {zeroCostCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'var(--amber-soft)',
              border: '1px solid rgba(224,165,59,.4)', borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: 'var(--amber)', marginBottom: 16 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                background: 'var(--amber)', color: '#fff', fontSize: 12, fontWeight: 900, lineHeight: 1,
              }}>!</span>
              {zeroCostCount} line item{zeroCostCount === 1 ? '' : 's'} {zeroCostCount === 1 ? 'has' : 'have'} no unit cost and {zeroCostCount === 1 ? 'is' : 'are'} priced at $0 — the grand total is understated.
            </div>
          )}

          <div className="panel" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>Summary</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Total Direct Cost</div>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{moneyFull(totalDirect)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>Grand Total</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--blue)' }}>{moneyFull(grandTotal)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Overhead %</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="number" min={0} max={100} value={overheadPct}
                    onChange={e => onOverheadChange(Number(e.target.value))}
                    style={{ width: 70, font: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 7, padding: '6px 10px', outline: 'none' }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text3)' }}>{moneyFull(totalOverhead)}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Profit %</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="number" min={0} max={100} value={profitPct}
                    onChange={e => onProfitChange(Number(e.target.value))}
                    style={{ width: 70, font: 'inherit', fontSize: 14, fontWeight: 700, background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 7, padding: '6px 10px', outline: 'none' }}
                  />
                  <span style={{ fontSize: 13, color: 'var(--text3)' }}>{moneyFull(totalProfit)}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default memo(PricingTab);
