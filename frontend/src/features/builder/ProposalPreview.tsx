import React from 'react';
import { GenForm } from './genData';
import { GenTotals } from './genCalc';
import { genPriceRows, genModelNo, genProposalNo } from './genCalc';

function fmt(n: number) { return '$' + Math.round(n).toLocaleString('en-US'); }

interface Props {
  form: GenForm;
  totals: GenTotals;
  proposalNo: string;
  onBack: () => void;
}

export default function ProposalPreview({ form, totals, proposalNo, onBack }: Props) {
  const rows = genPriceRows(form, totals, fmt);
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="scroll view-enter">
      {/* Toolbar */}
      <div className="pipe-toolbar no-print">
        <button className="btn ghost" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          ← Back to Builder
        </button>
        <span className="spacer"/>
        <button className="btn" onClick={() => window.print()} style={{ fontSize: 13 }}>
          Print / Save PDF
        </button>
      </div>

      {/* Proposal document */}
      <div className="preview-doc" style={{
        maxWidth: 780, margin: '24px auto', background: 'var(--panel)',
        border: '1px solid var(--border)', borderRadius: 14,
        padding: '48px 56px', fontFamily: 'inherit',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 36 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)', letterSpacing: '-0.5px' }}>
              Accurate Power &amp; Technology
            </div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>Licensed Electrical &amp; Generator Specialist · FL</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>accuratepowerfl.com · (352) 555-0100</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)' }}>Proposal</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>{proposalNo}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{today}</div>
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--border)', marginBottom: 28 }}/>

        {/* Prepared for */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', marginBottom: 8 }}>Prepared For</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{form.customer || '—'}</div>
          {form.address && <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 3 }}>{form.address}</div>}
          {(form.city || form.state) && (
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              {[form.city, form.state, form.zip].filter(Boolean).join(', ')}
            </div>
          )}
          {form.phone && <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 3 }}>{form.phone}</div>}
          {form.email && <div style={{ fontSize: 13, color: 'var(--text2)' }}>{form.email}</div>}
        </div>

        {/* Generator specs */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', marginBottom: 10 }}>Generator Specifications</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {[
                ['Brand', form.brand],
                ['Model', genModelNo(form)],
                ['Size', form.size],
                ['Cooling', form.coolingType === 'air-cooled' ? 'Air-Cooled' : 'Liquid-Cooled'],
                ['Fuel Type', form.fuel],
                ['ATS', form.ats],
              ].map(([k, v]) => (
                <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 0', fontWeight: 700, color: 'var(--text2)', width: 160 }}>{k}</td>
                  <td style={{ padding: '7px 0', color: 'var(--text)' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pricing */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', marginBottom: 10 }}>Scope &amp; Pricing</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 0', color: 'var(--text2)' }}>{r.label}</td>
                  <td style={{ padding: '7px 0', textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{r.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: '16px 20px', marginBottom: 28 }}>
          {[
            { label: 'Subtotal', val: fmt(totals.subtotal) },
            ...(totals.discountAmt ? [{ label: 'Discount', val: `−${fmt(totals.discountAmt)}` }] : []),
            { label: `Tax (${form.taxRate}%)`, val: fmt(totals.tax) },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, color: 'var(--text2)' }}>
              <span>{r.label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.val}</span>
            </div>
          ))}
          <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 900, color: 'var(--text)' }}>
            <span>Total</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.total)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text3)', marginTop: 6 }}>
            <span>50% Deposit Due at Signing</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(totals.deposit)}</span>
          </div>
        </div>

        {/* Notes */}
        {form.notes && (
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text3)', marginBottom: 8 }}>Notes</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', whiteSpace: 'pre-wrap' }}>{form.notes}</div>
          </div>
        )}

        {/* Signature */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginTop: 40 }}>
          {['Customer Signature', 'Date'].map(label => (
            <div key={label}>
              <div style={{ height: 1, background: 'var(--border)', marginBottom: 6 }}/>
              <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 36, fontSize: 11, color: 'var(--text3)', textAlign: 'center', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          This proposal is valid for 30 days. Accurate Power &amp; Technology · Licensed &amp; Insured · FL
        </div>
      </div>

      <style>{`@media print { .no-print { display: none !important; } .preview-doc { border: none !important; box-shadow: none !important; } }`}</style>
    </div>
  );
}
