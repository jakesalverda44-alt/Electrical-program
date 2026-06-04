import React, { useState, useEffect, useRef } from 'react';
import api from '../../../api/client';
import Icon from '../../../components/Icon';
import { User } from '../../../types';
import { AppSettings } from '../../../hooks/useAppSettings';
import { Field, SectionTitle, SaveBar, Toggle, RolePill, inputStyle, initials, timeAgo, ROLE_OPTIONS, ROLE_LABELS, ROLE_COLORS } from '../shared';

const INTEGRATIONS = [
  { name: 'Google Calendar',    icon: '📅', desc: 'Sync appointments and job schedules.',           status: 'coming-soon' },
  { name: 'Microsoft Outlook',  icon: '📧', desc: 'Sync emails and calendar events.',              status: 'coming-soon' },
  { name: 'QuickBooks',         icon: '📊', desc: 'Sync invoices and payments.',                   status: 'coming-soon' },
  { name: 'Stripe',             icon: '💳', desc: 'Accept online payments for proposals.',         status: 'coming-soon' },
  { name: 'Twilio',             icon: '💬', desc: 'Send SMS notifications and reminders.',         status: 'coming-soon' },
  { name: 'DocuSign',           icon: '✍️',  desc: 'Legally certified e-signatures.',              status: 'coming-soon' },
  { name: 'CompanyCam',         icon: '📷', desc: 'Sync job site photos automatically.',           status: 'coming-soon' },
  { name: 'Google Drive',       icon: '☁️',  desc: 'Store and share project documents.',           status: 'coming-soon' },
];

export function IntegrationsSection() {
  return (
    <div>
      <SectionTitle title="Integrations" sub="Connect third-party services to extend your workflow."/>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {INTEGRATIONS.map(int => (
          <div key={int.name} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>{int.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{int.name}</span>
                <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5, background: 'var(--surface2)', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  Coming Soon
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>{int.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

