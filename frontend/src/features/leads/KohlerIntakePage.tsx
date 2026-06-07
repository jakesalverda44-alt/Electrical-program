import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { Lead } from '../../types';

interface ExtractedFields {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
}

interface UploadResult {
  lead: Lead;
  extracted: ExtractedFields;
}

type State = 'ready' | 'loading' | 'success' | 'error';

export default function KohlerIntakePage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>('ready');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleFile = async (file: File) => {
    setState('loading');
    setErrorMsg('');
    try {
      const form = new FormData();
      form.append('screenshot', file);
      const { data } = await api.post<UploadResult>('/leads/from-screenshot', form);
      setResult(data);
      setState('success');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || 'Could not process screenshot. Please try again.';
      setErrorMsg(msg);
      setState('error');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so same file can be re-selected if needed
    e.target.value = '';
  };

  const reset = () => {
    setState('ready');
    setResult(null);
    setErrorMsg('');
  };

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px 20px',
      background: 'var(--bg, #F0F2F5)',
      fontFamily: 'inherit',
    }}>
      {/* Kohler Badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: 'var(--blue-soft, rgba(59,130,246,.12))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22,
        }}>
          ⚡
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
            Generator Leads
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>
            Kohler Intake
          </div>
        </div>
      </div>

      {/* Card */}
      <div style={{
        background: 'var(--surface, #fff)',
        borderRadius: 20, border: '1px solid var(--border)',
        boxShadow: '0 8px 32px rgba(0,0,0,.10)',
        width: '100%', maxWidth: 420,
        overflow: 'hidden',
      }}>
        {state === 'ready' && (
          <div style={{ padding: '32px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 28, lineHeight: 1.6 }}>
              Screenshot the lead in the Kohler portal and upload it here
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleInputChange}
            />
            <button
              onClick={() => inputRef.current?.click()}
              style={{
                width: '100%', minHeight: 64, fontSize: 17, fontWeight: 800,
                borderRadius: 14, cursor: 'pointer',
                background: 'var(--blue-soft, rgba(59,130,246,.12))',
                border: '2px dashed rgba(59,130,246,.4)',
                color: 'var(--blue, #3B82F6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              }}
            >
              <span style={{ fontSize: 24 }}>📷</span>
              Upload Kohler Lead Screenshot
            </button>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 14 }}>
              JPEG, PNG, or WebP · Max 10MB
            </p>
          </div>
        )}

        {state === 'loading' && (
          <div style={{ padding: '48px 28px', textAlign: 'center' }}>
            <Spinner/>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text2)', marginTop: 18 }}>
              Reading lead information…
            </div>
          </div>
        )}

        {state === 'success' && result && (
          <div style={{ padding: '28px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(52,197,136,.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, color: 'var(--green, #34C588)',
              }}>✓</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>Lead created</div>
                <div style={{ fontSize: 12.5, color: 'var(--green, #34C588)', fontWeight: 600 }}>Automation started</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 24 }}>
              <FieldRow icon="👤" label="Name" value={result.lead.name}/>
              <FieldRow icon="📞" label="Phone" value={result.lead.phone}/>
              <FieldRow icon="✉️" label="Email" value={result.lead.email}/>
              <FieldRow icon="📍" label="Address" value={result.lead.address}/>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => navigate('/gen-leads')}
                style={{
                  width: '100%', minHeight: 52, fontSize: 15, fontWeight: 800,
                  borderRadius: 12, cursor: 'pointer',
                  background: 'var(--navy, #1B3A6B)', border: 'none',
                  color: '#fff',
                }}
              >
                View Lead
              </button>
              <button
                onClick={reset}
                style={{
                  width: '100%', minHeight: 52, fontSize: 15, fontWeight: 700,
                  borderRadius: 12, cursor: 'pointer',
                  background: 'none',
                  border: '2px solid var(--border2)',
                  color: 'var(--text2)',
                }}
              >
                Add Another
              </button>
            </div>
          </div>
        )}

        {state === 'error' && (
          <div style={{ padding: '32px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
              Upload Failed
            </div>
            <div style={{ fontSize: 13.5, color: '#E06A6A', fontWeight: 600, marginBottom: 28, lineHeight: 1.5 }}>
              {errorMsg}
            </div>
            <button
              onClick={reset}
              style={{
                width: '100%', minHeight: 52, fontSize: 15, fontWeight: 800,
                borderRadius: 12, cursor: 'pointer',
                background: 'var(--navy, #1B3A6B)', border: 'none',
                color: '#fff',
              }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Back link */}
      <button
        onClick={() => navigate('/gen-leads')}
        style={{
          marginTop: 24, background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 13, color: 'var(--text3)', padding: '8px 16px',
        }}
      >
        ← Back to Generator Leads
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <div className="spin" style={{
      width: 44, height: 44, margin: '0 auto',
      border: '4px solid var(--border)',
      borderTopColor: 'var(--blue, #3B82F6)',
      borderRadius: '50%',
    }}/>
  );
}

function FieldRow({ icon, label, value }: { icon: string; label: string; value?: string | null }) {
  return (
    <div style={{
      display: 'flex', gap: 10, padding: '10px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 16, minWidth: 22 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: value ? 'var(--text)' : 'var(--text3)', marginTop: 1 }}>
          {value || '—'}
        </div>
      </div>
    </div>
  );
}
