import { describe, it, expect } from 'vitest';
import { classifySheet, buildAgent1Content, isPdftoppmAvailable, type PrepFile } from './documentPrep';

describe('classifySheet', () => {
  it('flags dense schedule sheets', () => {
    expect(classifySheet('E-601 Panel Schedule.pdf')).toBe('schedule');
    expect(classifySheet('one-line-diagram.pdf')).toBe('schedule');
    expect(classifySheet('MCC Motor Control.pdf')).toBe('schedule');
    expect(classifySheet('Luminaire Fixture Schedule.pdf')).toBe('schedule');
  });

  it('flags plan sheets', () => {
    expect(classifySheet('E-201 Lighting-Plan.pdf')).toBe('plan');
    expect(classifySheet('Photometric.pdf')).toBe('plan');
  });

  it('flags detail/legend sheets', () => {
    expect(classifySheet('E-001 Legend and Notes.pdf')).toBe('detail');
    expect(classifySheet('Electrical Details.pdf')).toBe('detail');
  });

  it('defaults unknown electrical sheets to schedule (safer = more detail)', () => {
    expect(classifySheet('E-501.pdf')).toBe('schedule');
  });
});

describe('buildAgent1Content', () => {
  it('passes standard images through with a valid Claude media type', async () => {
    const files: PrepFile[] = [{ filename: 'site.png', buffer: Buffer.from('x'), ext: 'png' }];
    const blocks = await buildAgent1Content(files);
    const img = blocks.find(b => b.type === 'image');
    expect(img).toBeDefined();
    expect(img?.type === 'image' && img.source.type === 'base64' && img.source.media_type).toBe('image/png');
  });

  it('orders schedule sheets before plans, each labeled', async () => {
    const files: PrepFile[] = [
      { filename: 'E-201 Lighting-Plan.png', buffer: Buffer.from('a'), ext: 'png' },
      { filename: 'E-601 Panel Schedule.png', buffer: Buffer.from('b'), ext: 'png' },
    ];
    const blocks = await buildAgent1Content(files);
    const labels = blocks.filter(b => b.type === 'text').map(b => (b.type === 'text' ? b.text : ''));
    expect(labels[0]).toContain('Panel Schedule');
    expect(labels[0]).toContain('(schedule)');
    expect(labels[1]).toContain('Lighting-Plan');
    expect(labels[1]).toContain('(plan)');
  });

  it('falls back to a document block for PDFs when pdftoppm is unavailable', async () => {
    // In CI/dev without poppler-utils this exercises the graceful fallback path.
    if (await isPdftoppmAvailable()) return; // skip where poppler is actually installed
    const files: PrepFile[] = [{ filename: 'E-601 Panel Schedule.pdf', buffer: Buffer.from('%PDF-1.4'), ext: 'pdf' }];
    const blocks = await buildAgent1Content(files);
    expect(blocks.some(b => b.type === 'document')).toBe(true);
    expect(blocks.some(b => b.type === 'image')).toBe(false);
  });
});
