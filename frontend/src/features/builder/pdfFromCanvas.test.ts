// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { pdfFromCanvas } from './pdfFromCanvas';

// Letter at 612 x 792 pt. A 1170 px wide render => 1514 px per page.
class FakePdf {
  static last: FakePdf;
  images: { fmt: string; y: number; h: number }[] = [];
  pages = 1;
  internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } };
  constructor() { FakePdf.last = this; }
  addPage() { this.pages++; }
  addImage(_d: string, fmt: string, _x: number, y: number, _w: number, h: number) { this.images.push({ fmt, y, h }); }
}

function fakeCanvas(width: number, height: number) {
  return { width, height } as unknown as HTMLCanvasElement;
}

describe('pdfFromCanvas', () => {
  it('puts one JPEG slice on each page instead of the whole render on every page', () => {
    const toDataURL = vi.fn(() => 'data:image/jpeg;base64,xx');
    const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? ({ width: 0, height: 0, getContext: () => ctx, toDataURL } as unknown as HTMLElement) : realCreate(tag)) as typeof document.createElement);

    pdfFromCanvas(fakeCanvas(1170, 7326), FakePdf as never);
    const pdf = FakePdf.last;

    expect(pdf.pages).toBe(5);                       // ceil(7326 / 1514)
    expect(pdf.images).toHaveLength(5);              // one image per page, not the full render repeated
    expect(pdf.images.every(i => i.fmt === 'JPEG' && i.y === 0)).toBe(true);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.85);
    // Last page is a partial slice: 7326 - 4 * 1514 = 1270 px tall.
    expect(ctx.drawImage).toHaveBeenLastCalledWith(expect.anything(), 0, 6056, 1170, 1270, 0, 0, 1170, 1270);
    vi.restoreAllMocks();
  });
});
