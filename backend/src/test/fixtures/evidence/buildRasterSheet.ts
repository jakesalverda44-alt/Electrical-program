// Evidence round — a RASTER plan set for tests: every page is images only
// (no text layer, no fonts), 36x24" displayed, /Rotate 270 like the real
// Kissimmee set (MediaBox 1728 x 2592 pt). Real crops of the Kissimmee E-1 /
// E-2 / E-4 sheets (committed PNGs, pdftoppm crops of the real set — provenance in kissimmeeReplies.ts) are drawn at the exact
// displayed position they occupy on the real sheet, so every viewport box,
// crop and mark position in the tests is the real sheet's.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import sharp from 'sharp';

export interface RasterImage { file: string; dpi: number; leftIn: number; topIn: number }
export interface RasterPage {
  images: RasterImage[];
  /** Default: /Rotate 270 on a 1728 x 2592 pt MediaBox (the Kissimmee
   *  E-sheets). The photometric PH0.1 is unrotated 2592 x 1728; images are
   *  only placed on the default pages. */
  rotation?: 0 | 270;
}

export const SHEET_W_PT = 1728;
export const SHEET_H_PT = 2592;
export const SHEET_ROTATION = 270;

const DIR = __dirname;

/** Displayed rect (inches, top-left origin) -> the `cm` matrix that draws a
 *  unit-square image there on a /Rotate 270 page of W x H points.
 *  Displayed (dx, dy) -> PDF (x = W - dy, y = H - dx); image (u right, v up)
 *  -> displayed (l + u*w, t + (1-v)*h). */
function cm270(leftPt: number, topPt: number, wPt: number, hPt: number): string {
  const e = SHEET_W_PT - topPt - hPt;
  const f = SHEET_H_PT - leftPt;
  return `0 ${-wPt} ${hPt} 0 ${e.toFixed(3)} ${f.toFixed(3)} cm`;
}

export async function buildRasterSet(pages: RasterPage[]): Promise<Buffer> {
  type Obj = { dict: string; stream?: Buffer };
  const objs: Obj[] = [];
  const add = (o: Obj) => { objs.push(o); return objs.length; };
  const catalog = add({ dict: '' });
  const pagesObj = add({ dict: '' });
  const pageNums: number[] = [];
  for (const p of pages) {
    const xobjs: Array<{ name: string; num: number; img: RasterImage; w: number; h: number }> = [];
    for (const [i, img] of p.images.entries()) {
      const { data, info } = await sharp(path.join(DIR, img.file)).grayscale().raw().toBuffer({ resolveWithObject: true });
      const gray = info.channels === 1 ? data : Buffer.from(Array.from({ length: info.width * info.height }, (_, k) => data[k * info.channels]));
      const num = add({
        dict: `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
        stream: zlib.deflateSync(gray),
      });
      xobjs.push({ name: `Im${i + 1}`, num, img, w: info.width, h: info.height });
    }
    const content = xobjs.map(x => {
      const wPt = (x.w / x.img.dpi) * 72, hPt = (x.h / x.img.dpi) * 72;
      return `q ${cm270(x.img.leftIn * 72, x.img.topIn * 72, wPt, hPt)} /${x.name} Do Q`;
    }).join('\n');
    const contentNum = add({ dict: '<<', stream: Buffer.from(content, 'latin1') });
    const res = xobjs.length ? `/Resources << /XObject << ${xobjs.map(x => `/${x.name} ${x.num} 0 R`).join(' ')} >> >>` : '/Resources << >>';
    const rot0 = p.rotation === 0;
    if (rot0 && p.images.length) throw new Error('images are only placed on /Rotate 270 pages');
    const media = rot0 ? `[0 0 ${SHEET_H_PT} ${SHEET_W_PT}]` : `[0 0 ${SHEET_W_PT} ${SHEET_H_PT}]`;
    pageNums.push(add({ dict: `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox ${media} /Rotate ${rot0 ? 0 : SHEET_ROTATION} /Contents ${contentNum} 0 R ${res} >>` }));
  }
  objs[catalog - 1].dict = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1].dict = `<< /Type /Pages /Kids [${pageNums.map(n => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`;
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xff\xff\xff\xff\n', 'latin1')];
  let offset = parts[0].length;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(offset);
    let chunk: Buffer;
    if (o.stream) {
      const dict = o.dict === '<<' ? `<< /Length ${o.stream.length} >>` : `${o.dict} /Length ${o.stream.length} >>`;
      chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${dict}\nstream\n`, 'latin1'), o.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    } else {
      chunk = Buffer.from(`${i + 1} 0 obj\n${o.dict}\nendobj\n`, 'latin1');
    }
    parts.push(chunk);
    offset += chunk.length;
  });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF`;
  parts.push(Buffer.from(xref, 'latin1'));
  // A Buffer that OWNS its ArrayBuffer (the live upload shape — pdf.js
  // detaches a buffer it fully spans; never a pooled slice).
  const all = Buffer.concat(parts);
  const owned = new Uint8Array(new ArrayBuffer(all.length));
  owned.set(all);
  return Buffer.from(owned.buffer);
}

/** The Kissimmee pages, crops at their real displayed positions
 *  (pdftoppm -x/-y origins of each crop, in inches). */
export const KISSIMMEE_E1: RasterPage = { images: [
  { file: 'e1-main-east.png', dpi: 100, leftIn: 13.5, topIn: 2.5 },
  { file: 'e1-restroom3.png', dpi: 100, leftIn: 11.8, topIn: 15.9 },
  { file: 'e1-legend5.png', dpi: 150, leftIn: 3370 / 150, topIn: 1210 / 150 },
] };
export const KISSIMMEE_E2: RasterPage = { images: [
  { file: 'e2-main.png', dpi: 150, leftIn: 380 / 150, topIn: 600 / 150 },
  { file: 'e2-legend9.png', dpi: 150, leftIn: 3390 / 150, topIn: 1200 / 150 },
  { file: 'e2-office11.png', dpi: 150, leftIn: 3390 / 150, topIn: 2400 / 150 },
] };
export const KISSIMMEE_E4: RasterPage = { images: [
  { file: 'e4-panela-odd.png', dpi: 150, leftIn: 1880 / 150, topIn: 75 / 150 },
  { file: 'e4-panela-even.png', dpi: 150, leftIn: 1880 / 150, topIn: 940 / 150 },
  { file: 'e4-panelb-odd.png', dpi: 150, leftIn: 3430 / 150, topIn: 75 / 150 },
  { file: 'e4-panelb-even.png', dpi: 150, leftIn: 3430 / 150, topIn: 940 / 150 },
] };
export const BLANK_PAGE: RasterPage = { images: [] };

export function fixturePng(file: string): Buffer {
  return fs.readFileSync(path.join(DIR, file));
}
