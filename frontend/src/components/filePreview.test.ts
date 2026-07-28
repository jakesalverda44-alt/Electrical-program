import { describe, it, expect } from 'vitest';
import { previewKind } from './filePreview';

describe('previewKind', () => {
  it('pdf and images are inline', () => {
    expect(previewKind('plans.pdf', 'application/pdf')).toBe('inline');
    expect(previewKind('photo.jpg', 'image/jpeg')).toBe('inline');
    expect(previewKind('scan.PDF', null)).toBe('inline');
  });
  it('spreadsheets are sheet', () => {
    expect(previewKind('takeoff.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('sheet');
    expect(previewKind('old.xls', null)).toBe('sheet');
    expect(previewKind('export.csv', 'text/csv')).toBe('sheet');
  });
  it('docx is doc', () => {
    expect(previewKind('proposal.docx', null)).toBe('doc');
  });
  it('unknown is none', () => {
    expect(previewKind('archive.zip', 'application/zip')).toBe('none');
  });
});
