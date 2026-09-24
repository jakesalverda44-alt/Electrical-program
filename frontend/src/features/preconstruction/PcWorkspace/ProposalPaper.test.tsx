// @vitest-environment happy-dom
// Fix round 1 / N13 — the preview prints every band the .docx prints (even
// an empty list), centered, with black section-row text, like the .docx.
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import ProposalPaper from './ProposalPaper';

afterEach(cleanup);

describe('ProposalPaper matches the .docx (N13)', () => {
  it('empty Exclusions / Takeoff / Terms still get their bands', () => {
    const { container } = render(<ProposalPaper fallbackName="X" fallbackPrice="$1" data={{
      project_name: 'X', project_address: '', client: 'GC', job_number: 'J', total_price: '$1', scope: ['s'], sections: [],
      exclusions: [], takeoff: [], terms: [],
    }} />);
    expect(Array.from(container.querySelectorAll('.pp-band')).map(b => b.textContent)).toEqual([
      'SCOPE OF WORK', 'EXCLUSIONS & CLARIFICATIONS', 'ELECTRICAL QUANTITY TAKEOFF', 'TERMS, CONDITIONS & SPECIAL REQUIREMENTS',
    ]);
  });
  it('bands are centered and section-row text is black, as in the .docx', () => {
    const css = fs.readFileSync(path.join(__dirname, 'proposalPaper.css'), 'utf8');
    expect(/\.pp-band\s*\{[^}]*text-align:\s*center/.test(css)).toBe(true);
    expect(/\.pp-table \.pp-sec td\s*\{[^}]*color:\s*#000000/.test(css)).toBe(true);
  });
});
