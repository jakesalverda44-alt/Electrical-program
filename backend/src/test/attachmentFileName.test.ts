import { describe, it, expect } from 'vitest';
import { attachmentFileName } from '../email/bidAttachments';

describe('attachmentFileName', () => {
  it('appends the original filename extension when display name has none', () => {
    expect(attachmentFileName('Sizer Report', 'walter-sizer.pdf', 'application/pdf')).toBe('Sizer Report.pdf');
    expect(attachmentFileName('Signed Proposal', 'upload.PDF', null)).toBe('Signed Proposal.PDF');
  });
  it('keeps an existing extension untouched', () => {
    expect(attachmentFileName('Site Checklist.pdf', 'x.pdf', 'application/pdf')).toBe('Site Checklist.pdf');
  });
  it('falls back to the mime type when neither name has an extension', () => {
    expect(attachmentFileName('Labeled Survey', 'survey-final', 'application/pdf')).toBe('Labeled Survey.pdf');
    expect(attachmentFileName('Photo', 'img', 'image/jpeg')).toBe('Photo.jpg');
  });
  it('returns the base unchanged for unknown mimes and empty inputs', () => {
    expect(attachmentFileName('Mystery', 'blob', 'application/x-thing')).toBe('Mystery');
    expect(attachmentFileName(null, null, null)).toBe('file');
    expect(attachmentFileName('  ', 'doc.pdf', null)).toBe('doc.pdf');
  });
});
