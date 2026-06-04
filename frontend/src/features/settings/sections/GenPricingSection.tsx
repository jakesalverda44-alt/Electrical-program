import React, { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import { User } from '../../../types';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, Toggle, RolePill, inputStyle, initials, timeAgo, ROLE_OPTIONS, ROLE_LABELS, ROLE_COLORS } from '../shared';

interface PricingTable {
  'air-cooled': Record<string, Record<string, number>>;
  'liquid-cooled': Record<string, Record<string, number>>;
}

const DEFAULT_PRICING: PricingTable = {
  'air-cooled': {
    Kohler:  { '14KW': 5800, '20KW': 6700, '26KW': 8200 },
    Generac: { '14KW': 5600, '18KW': 6450, '22KW': 7150, '24KW': 7575, '26KW': 8000, '28KW': 9300 },
  },
  'liquid-cooled': {
    Kohler:  { '24KW': 17549, '30KW': 19999, '38KW': 22449, '48KW': 25209, '60KW': 27759, '80KW': 34089, '100KW': 41129 },
    Generac: { '32KW': 19203, '40KW': 21734, '48KW': 22914, '60KW': 25212 },
  },
};

export function GenPricingSection({ settings, onSaved }: { settings: AppSettings; onSaved: () => void }) {
  const [table, setTable] = useState<PricingTable>(() => {
    try { return settings.gen_pricing_table ? JSON.parse(settings.gen_pricing_table) : DEFAULT_PRICING; }
    catch { return DEFAULT_PRICING; }
  });
  const [orig, setOrig] = useState(JSON.stringify(table));
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);

  useEffect(() => {
    try {
      const parsed = settings.gen_pricing_table ? JSON.parse(settings.gen_pricing_table) : DEFAULT_PRICING;
      setTable(parsed); setOrig(JSON.stringify(parsed));
    } catch { /* keep current */ }
  }, [settings]);

  const hasChanges = JSON.stringify(table) !== orig;

  const setPrice = (cooling: keyof PricingTable, brand: string, size: string, val: string) => {
    setTable(prev => ({
      ...prev,
      [cooling]: { ...prev[cooling], [brand]: { ...prev[cooling][brand], [size]: Number(val) || 0 } },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/settings', { gen_pricing_table: JSON.stringify(table) });
      setOrig(JSON.stringify(table)); onSaved();
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };

  return (
    <div>
      <SectionTitle title="Generator Pricing" sub="Unit prices for each generator model. These drive proposal totals in the builder."/>
      {(['air-cooled', 'liquid-cooled'] as const).map(cooling => (
        <div key={cooling} style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 12, textTransform: 'capitalize' }}>
            {cooling === 'air-cooled' ? '🌬️' : '💧'} {cooling.replace('-', ' ')}
          </div>
          {Object.entries(table[cooling]).map(([brand, sizes]) => (
            <div key={brand} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>{brand}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                {Object.entries(sizes).map(([size, price]) => (
                  <div key={size}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', marginBottom: 4 }}>{size}</div>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, fontWeight: 700, color: 'var(--text3)' }}>$</span>
                      <input type="number" value={price}
                        onChange={e => setPrice(cooling, brand, size, e.target.value)}
                        style={{ ...inputStyle, paddingLeft: 22, width: '100%' }}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      <SaveBar onSave={save} saving={saving} saved={saved} hasChanges={hasChanges}/>
    </div>
  );
}

// ── EMAIL ─────────────────────────────────────────────────────────────────────

