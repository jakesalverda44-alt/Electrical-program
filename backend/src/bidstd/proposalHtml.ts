// Phase 4 Task 2.1 — the public proposal page's HTML. Renders the SAME
// composed BidData the docx does (backend/src/utils/proposalDocx.ts's
// renderBidDocx), as a clean single-page, print-friendly HTML document —
// no LibreOffice/PDF step in production; this is the browser-facing answer.
//
// Every content string comes from `data` (BidData) or boilerplate.ts's
// constants (SECTION_HEADERS/CLOSING) — see proposalHtml.test.ts's lock
// test. The handful of fixed UI-chrome strings that are neither (table
// column labels, "Proposal Price Summary", "Attn:"/"Re:"/"Job No.", the
// bold opening statement, the accept/sign mount point) mirror the SAME
// fixed strings renderBidDocx already hardcodes — this file introduces no
// new content literals beyond what the docx renderer already has.
import * as path from 'path';
import { BidData, TakeoffCategory, Bullet } from './bidData';
import { SECTION_HEADERS, CLOSING } from './boilerplate';
import { loadRequiredAsset } from '../utils/proposalDocx';

const NAVY = '#1F3864';
const ACCENT = '#D9E1F2';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bulletHtml(b: Bullet): string {
  if (typeof b === 'string') return `<li>${escapeHtml(b)}</li>`;
  return `<li><strong>${escapeHtml(b.b)}</strong>${escapeHtml(b.t)}</li>`;
}

function bulletListHtml(bullets: Bullet[]): string {
  if (!bullets.length) return '';
  return `<ul class="bullets">${bullets.map(bulletHtml).join('')}</ul>`;
}

/** Navy band header, centered white bold — same visual rule as the docx's sectionHeader(). */
function bandHtml(text: string): string {
  return `<div class="band">${escapeHtml(text)}</div>`;
}

function assetsDir(): string {
  return path.resolve(__dirname, '../../assets');
}

function dataUri(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function takeoffTableHtml(categories: TakeoffCategory[]): string {
  const headerRow = `<tr class="hdr"><th>ITEM</th><th>DESCRIPTION</th><th>UNIT</th><th>QTY</th><th>SOURCE / NOTES</th></tr>`;
  const bodyRows = categories.map(cat => {
    const catRow = `<tr class="cat"><td colspan="5">${escapeHtml((cat.name || '').toUpperCase())}</td></tr>`;
    const itemRows = cat.items.map(it => `<tr>
      <td class="ctr">${escapeHtml(it.item || '')}</td>
      <td>${escapeHtml(it.description || '')}</td>
      <td class="ctr">${escapeHtml(it.unit || '')}</td>
      <td class="ctr">${escapeHtml(String(it.qty ?? ''))}</td>
      <td>${escapeHtml(it.source || '')}</td>
    </tr>`).join('');
    return catRow + itemRows;
  }).join('');
  return `<table class="takeoff"><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>`;
}

/**
 * Render a composed BidData into the public-facing proposal HTML — the
 * browser equivalent of renderBidDocx, sourced from the exact same object.
 * Pure (no DB/network) except reading the two checked-in brand asset files,
 * embedded as data URIs so the page is self-contained (no external image
 * requests from an unauthenticated public page).
 */
export function renderBidHtml(data: BidData): string {
  const logo = loadRequiredAsset(assetsDir(), 'APT_Logo_2026.jpg', 'company logo');
  const sig = loadRequiredAsset(assetsDir(), 'Jake_2026_Signature.png', 'signature');
  const logoUri = dataUri(logo.buf, 'image/jpeg');
  const sigUri = dataUri(sig.buf, 'image/png');

  const sectionsHtml = data.sections.map(s => bandHtml(s.title) + bulletListHtml(s.bullets)).join('');
  const alternatesHtml = (data.alternates && data.alternates.length)
    ? bulletListHtml(data.alternates)
    : '';

  return `<div class="apt-proposal">
  <style>
    .apt-proposal { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 14px; line-height: 1.5; max-width: 820px; margin: 0 auto; padding: 24px 28px 48px; background: #fff; }
    .apt-proposal .logo { display: block; margin: 0 0 16px; max-width: 200px; height: auto; }
    .apt-proposal .band { background: ${NAVY}; color: #fff; font-weight: 700; text-align: center; padding: 8px 12px; margin: 20px 0 8px; border-radius: 2px; }
    .apt-proposal .bullets { margin: 0 0 12px; padding-left: 22px; }
    .apt-proposal .bullets li { margin: 4px 0; }
    .apt-proposal .hdr-block p { margin: 2px 0; }
    .apt-proposal .opening { font-weight: 700; margin: 16px 0; }
    .apt-proposal table.takeoff { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0 16px; }
    .apt-proposal table.takeoff th, .apt-proposal table.takeoff td { border: 1px solid #9AA5B1; padding: 4px 8px; text-align: left; }
    .apt-proposal table.takeoff tr.hdr th { background: ${NAVY}; color: #fff; text-align: center; }
    .apt-proposal table.takeoff tr.cat td { background: ${ACCENT}; color: ${NAVY}; font-weight: 700; }
    .apt-proposal td.ctr, .apt-proposal th.ctr { text-align: center; }
    .apt-proposal .price-summary-label { font-weight: 700; margin: 24px 0 4px; }
    .apt-proposal .price-total { font-weight: 700; color: ${NAVY}; font-size: 18px; margin: 0 0 12px; }
    .apt-proposal .sig-img { display: block; max-width: 220px; height: auto; margin: 8px 0; }
    .apt-proposal .cost-basis { text-align: center; margin: 4px 0 16px; }
    .apt-proposal .accept-sign { margin-top: 16px; }
    .apt-proposal .accept-sign .line { margin: 10px 0; font-family: 'Courier New', monospace; }
    .apt-proposal .thank-you { text-align: center; font-weight: 700; color: ${NAVY}; margin-top: 24px; }
    @media print {
      .apt-proposal { max-width: none; padding: 0; }
      .apt-proposal .band { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .apt-proposal table.takeoff tr.hdr th, .apt-proposal table.takeoff tr.cat td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>

  <img class="logo" src="${logoUri}" alt="Accurate Power &amp; Technology"/>

  <div class="hdr-block">
    <p>${escapeHtml(data.date)}</p>
    <p><strong>${escapeHtml(data.client)}</strong></p>
    ${data.contact ? `<p>Attn: ${escapeHtml(data.contact)}</p>` : ''}
    ${data.email ? `<p>${escapeHtml(data.email)}</p>` : ''}
    <p>Re: ${escapeHtml(data.project_name)}</p>
    <p>${escapeHtml(data.project_address)}</p>
    <p>Job No. ${escapeHtml(data.job_number)}</p>
  </div>

  <p class="opening">Please accept this proposal to complete the electrical work for ${escapeHtml(data.project_name)} you have out for bid.</p>

  ${bandHtml(SECTION_HEADERS.scope)}
  ${bulletListHtml(data.scope)}

  ${sectionsHtml}

  ${bandHtml(SECTION_HEADERS.exclusions)}
  ${bulletListHtml(data.exclusions)}

  ${bandHtml(SECTION_HEADERS.takeoff)}
  ${takeoffTableHtml(data.takeoff)}

  ${bandHtml(SECTION_HEADERS.terms)}
  ${bulletListHtml(data.terms)}

  <p class="price-summary-label">Proposal Price Summary</p>
  <p class="price-total">Total for ${escapeHtml(data.project_name)}:  ${escapeHtml(data.total_price)}</p>
  ${alternatesHtml}

  <p>${escapeHtml(CLOSING.respectfully)}</p>
  <img class="sig-img" src="${sigUri}" alt="Jake Salverda signature"/>
  <p class="cost-basis">${escapeHtml(CLOSING.costBasis)}</p>
  <p>${escapeHtml(CLOSING.acceptance)}</p>

  <div id="apt-accept-sign-mount" class="accept-sign">
    <p class="line">${escapeHtml(CLOSING.print)}</p>
    <p class="line">${escapeHtml(CLOSING.sign)}</p>
    <p class="line">${escapeHtml(CLOSING.date)}</p>
  </div>

  <p class="thank-you">${escapeHtml(CLOSING.thankYou)}</p>
</div>`;
}
