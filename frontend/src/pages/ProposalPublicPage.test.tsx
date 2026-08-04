// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProposalPublicPage from './ProposalPublicPage';
import { blankGenForm, calcGenTotals } from '../features/builder/genCalc';

// react-signature-canvas draws to a real <canvas>, which happy-dom does not implement.
// Stand in a fake whose emptiness is driven per-test, so the Accept & Sign gate can be
// exercised without a drawing surface.
const canvasState = { sig: true, init: true }; // isEmpty() values
vi.mock('react-signature-canvas', async () => {
  const React = await import('react');
  // The signature box is full-width/160px tall; the initials box is the short one.
  const whichOf = (props: Record<string, unknown>): 'sig' | 'init' =>
    (props.canvasProps as { style?: { height?: number } } | undefined)?.style?.height === 90 ? 'init' : 'sig';

  class FakeSignatureCanvas extends React.Component<Record<string, unknown>> {
    isEmpty() { return canvasState[whichOf(this.props)]; }
    clear() { canvasState[whichOf(this.props)] = true; }
    toDataURL() { return `data:image/png;base64,${whichOf(this.props)}`; }
    // A real button stands in for the drawing surface so a test can fire the
    // component's own onEnd, which is what flips the Accept & Sign gate.
    render() {
      const w = whichOf(this.props);
      return React.createElement('button', {
        type: 'button',
        'data-testid': `draw-${w}`,
        onClick: () => {
          canvasState[w] = false;
          (this.props.onEnd as (() => void) | undefined)?.();
        },
      }, `draw ${w}`);
    }
  }
  return { default: FakeSignatureCanvas };
});

// ProposalPreview renders the whole nine-page document; irrelevant here and slow.
vi.mock('../features/builder/ProposalPreview', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="doc"
      data-signature={String(props.signatureImage ?? '')}
      data-initials={String(props.initialsImage ?? '')}
      data-signed-date={String(props.signedDate ?? '')}
      data-countersign={String(props.countersignImage ?? '')}
      data-countersign-date={String(props.countersignDate ?? '')}/>
  ),
}));

// The rasterizer pulls in html2canvas/jspdf on demand — never wanted in a unit test.
vi.mock('../lib/signedContractPdf', () => ({
  buildContractPdf: vi.fn().mockResolvedValue(new Blob(['pdf'])),
  signedContractFilename: (c: string) => `Signed Proposal - ${c}.pdf`,
}));

const GEN = {
  id: 'gen-1',
  customer: 'Jane Homeowner',
  mfr: 'Kohler', model: '26RCA', kw: 26, amount: 15412, tax: 0, addons: 0,
  stage: 'sent',
  proposal_no: 'P-1',
  form_data: blankGenForm(),
  totals_data: calcGenTotals(blankGenForm()),
};

function mockFetch(genPayload: Record<string, unknown>) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes('/sign')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response);
    }
    if (String(url).includes('/proposal-pdf') || String(url).includes('/archive-failed')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response);
    }
    void init;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(genPayload) } as Response);
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/p/tok-1']}>
      <Routes><Route path="/p/:token" element={<ProposalPublicPage/>}/></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  canvasState.sig = true;
  canvasState.init = true;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Accept & Sign gate', () => {
  it('stays disabled until BOTH the signature and the initials have been drawn', async () => {
    vi.stubGlobal('fetch', mockFetch(GEN));
    renderPage();
    const btn = await screen.findByRole('button', { name: /Accept & Sign/i });

    // Nothing drawn.
    expect((btn as HTMLButtonElement).disabled).toBe(true);

    // Signature only — still blocked, because signing here would leave every
    // CUST INT rule on the agreement blank.
    fireEvent.click(screen.getByTestId('draw-sig'));
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));

    // Initials too — now it opens up.
    fireEvent.click(screen.getByTestId('draw-init'));
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  });
});

describe('revisiting an already-signed proposal', () => {
  it('renders the stored signature, initials and date instead of a blank contract', async () => {
    vi.stubGlobal('fetch', mockFetch({
      ...GEN,
      stage: 'signed',
      signed_at: '2026-08-03T12:00:00.000Z',
      signature_data: 'data:image/png;base64,storedsig',
      initials_data: 'data:image/png;base64,storedinit',
    }));
    renderPage();

    const doc = await screen.findByTestId('doc');
    await waitFor(() => {
      expect(doc.getAttribute('data-signature')).toBe('data:image/png;base64,storedsig');
    });
    expect(doc.getAttribute('data-initials')).toBe('data:image/png;base64,storedinit');
    expect(doc.getAttribute('data-signed-date')).toBe('August 3, 2026');
    expect(screen.getByText('Proposal Accepted')).toBeTruthy();
  });

  it('still renders an older signed proposal that has a signature but no initials', async () => {
    vi.stubGlobal('fetch', mockFetch({
      ...GEN,
      stage: 'signed',
      signed_at: '2026-08-03T12:00:00.000Z',
      signature_data: 'data:image/png;base64,storedsig',
      initials_data: null,
    }));
    renderPage();

    const doc = await screen.findByTestId('doc');
    await waitFor(() => {
      expect(doc.getAttribute('data-signature')).toBe('data:image/png;base64,storedsig');
    });
    expect(doc.getAttribute('data-initials')).toBe('');
  });
});

describe('signing', () => {
  it('posts both marks together', async () => {
    const fetchMock = mockFetch(GEN);
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    const btn = await screen.findByRole('button', { name: /Accept & Sign/i });

    fireEvent.click(screen.getByTestId('draw-sig'));
    fireEvent.click(screen.getByTestId('draw-init'));
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);

    await waitFor(() => {
      const signCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/sign'));
      expect(signCall).toBeTruthy();
      const body = JSON.parse((signCall![1] as RequestInit).body as string);
      expect(body.signatureData).toBeTruthy();
      expect(body.initialsData).toBeTruthy();
    });
  });
});

// Once APT countersigns, the customer's own link has to show the executed document.
// It previously rendered only the buyer's marks, so a contract signed by both parties
// still looked signed on one side to the person who signed it.
describe('a countersigned proposal', () => {
  it('renders APT\'s signature and date alongside the buyer\'s', async () => {
    vi.stubGlobal('fetch', mockFetch({
      ...GEN,
      stage: 'awarded',
      signed_at: '2026-08-04T12:00:00.000Z',
      signature_data: 'data:image/png;base64,buyer',
      initials_data: 'data:image/png;base64,init',
      countersigned_at: '2026-08-05T12:00:00.000Z',
      countersignature_data: 'data:image/png;base64,apt',
    }));
    renderPage();

    const doc = await screen.findByTestId('doc');
    await waitFor(() => {
      expect(doc.getAttribute('data-countersign')).toBe('data:image/png;base64,apt');
    });
    expect(doc.getAttribute('data-countersign-date')).toBe('August 5, 2026');
    expect(doc.getAttribute('data-signature')).toBe('data:image/png;base64,buyer');
  });

  it('passes nothing for the APT side while it is still only buyer-signed', async () => {
    vi.stubGlobal('fetch', mockFetch({
      ...GEN,
      stage: 'signed',
      signed_at: '2026-08-04T12:00:00.000Z',
      signature_data: 'data:image/png;base64,buyer',
      countersigned_at: null,
      countersignature_data: null,
    }));
    renderPage();

    const doc = await screen.findByTestId('doc');
    await waitFor(() => expect(doc.getAttribute('data-signature')).toBe('data:image/png;base64,buyer'));
    expect(doc.getAttribute('data-countersign')).toBe('');
  });
});
