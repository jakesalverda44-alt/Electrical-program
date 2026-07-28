// @vitest-environment jsdom
// DOMPurify needs a real TreeWalker/DOM implementation to sanitize correctly;
// happy-dom (used elsewhere in this repo) has known gaps there, jsdom is
// DOMPurify's own documented Node test environment.
import { describe, it, expect } from 'vitest';
import { previewKind, sanitizeDocHtml } from './filePreview';

describe('previewKind', () => {
  it('pdf and images are inline', () => {
    expect(previewKind('plans.pdf', 'application/pdf')).toBe('inline');
    expect(previewKind('photo.jpg', 'image/jpeg')).toBe('inline');
    expect(previewKind('scan.PDF', null)).toBe('inline');
  });
  it('legacy docs with null file_type fall back to the image extension', () => {
    expect(previewKind('photo.jpg', null)).toBe('inline');
    expect(previewKind('photo.jpeg', null)).toBe('inline');
    expect(previewKind('logo.png', null)).toBe('inline');
    expect(previewKind('animation.gif', null)).toBe('inline');
    expect(previewKind('banner.webp', null)).toBe('inline');
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

describe('sanitizeDocHtml', () => {
  it('neutralizes a javascript: hyperlink', () => {
    const out = sanitizeDocHtml('<a href="javascript:alert(1)">click me</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('click me');
  });

  it('strips onclick and other event-handler attributes', () => {
    const out = sanitizeDocHtml('<p onclick="alert(1)">hi</p>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('hi');
  });

  it('preserves a plain https link', () => {
    const out = sanitizeDocHtml('<a href="https://example.com">site</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('site');
  });

  it('strips a protocol-relative href (schemeless off-site redirect)', () => {
    const out = sanitizeDocHtml('<a href="//evil.com">click me</a>');
    expect(out).not.toContain('href=');
    expect(out).toContain('click me');
  });

  it('preserves a root-relative href', () => {
    const out = sanitizeDocHtml('<a href="/files/report.pdf">report</a>');
    expect(out).toContain('href="/files/report.pdf"');
    expect(out).toContain('report');
  });

  it('removes script tags entirely, including their contents', () => {
    const out = sanitizeDocHtml('<p>before</p><script>alert(1)</script><p>after</p>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('drops disallowed elements like iframe while keeping safe content', () => {
    const out = sanitizeDocHtml('<p>text</p><iframe src="javascript:alert(1)"></iframe>');
    expect(out).not.toContain('<iframe');
    expect(out).toContain('text');
  });
});
