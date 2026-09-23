// Takeoff accuracy Task 13 — the preview page is paper: its colors are
// literal, never theme variables, so dark mode can't turn it dark.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.join(__dirname, 'proposalPaper.css'), 'utf8');
const rule = (sel: string) => new RegExp(`${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

describe('proposal paper stays white in dark mode', () => {
  it('the sheet, bands, table header and section rows use literal colors', () => {
    expect(rule('.pp-sheet')).toMatch(/background:\s*#ffffff/);
    expect(rule('.pp-sheet')).toMatch(/color:\s*#000000/);
    expect(rule('.pp-sheet')).toMatch(/color-scheme:\s*light/);
    expect(rule('.pp-band')).toMatch(/background:\s*#1F3864/);
    expect(rule('.pp-table th')).toMatch(/background:\s*#1F3864/);
    for (const sel of ['.pp-sheet', '.pp-band', '.pp-table th', '.pp-table td', '.pp-price']) expect(rule(sel)).not.toContain('var(--');
    expect(css).not.toMatch(/prefers-color-scheme|data-theme/);
  });
});
