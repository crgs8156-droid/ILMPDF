// Synthetic attack-style PDFs for fuzzing. Every file is built here from
// scratch, in memory: no real documents, nothing downloaded, nothing written
// to disk. Each one copies a trick that malicious or broken PDFs use against
// PDF readers (endless loops, huge sizes, decompression bombs, scripts), so
// the tests can check that ILMPDF's engines refuse them safely and quickly.
//
// The "scripts" and launch actions are harmless stand-ins: they only call
// app.alert or name a program that does not exist.
import { createDeflate } from 'node:zlib';

export type HostileFile = { name: string; why: string; bytes: Uint8Array };

type Obj = string | { dict: string; data: Uint8Array };

const enc = new TextEncoder();

/** Writes objects 1..n (object 1 = catalog) as a PDF with a correct xref. */
function build(objects: Obj[], opts: { trailer?: string; xref?: 'ok' | 'garbage' | 'none' } = {}): Uint8Array {
  const parts: Uint8Array[] = [enc.encode('%PDF-1.7\n')];
  let length = parts[0]!.length;
  const push = (p: Uint8Array) => {
    parts.push(p);
    length += p.length;
  };
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(length);
    if (typeof obj === 'string') {
      push(enc.encode(`${i + 1} 0 obj\n${obj}\nendobj\n`));
    } else {
      push(enc.encode(`${i + 1} 0 obj\n<< ${obj.dict} >>\nstream\n`));
      push(obj.data);
      push(enc.encode('\nendstream\nendobj\n'));
    }
  });
  const xrefAt = length;
  const mode = opts.xref ?? 'ok';
  if (mode !== 'none') {
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) {
      const at = mode === 'garbage' ? (off * 7919 + 13) % 999_999 : off;
      xref += `${String(at).padStart(10, '0')} 00000 n \n`;
    }
    push(enc.encode(xref));
  }
  push(enc.encode(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${opts.trailer ?? ''} >>\nstartxref\n${xrefAt}\n%%EOF\n`));
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const PAGES_ONE = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
const PAGE = (extra = '') => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300]${extra} >>`;
const text = (s: string) => ({ dict: `/Length ${s.length}`, data: enc.encode(s) });

// A Flate stream that inflates to `inflatedMb` megabytes of zeros. Zeros
// compress about 1000:1, so 256 MB becomes ~250 KB. It is compressed in
// 1 MB pieces so building it never needs 256 MB of memory.
async function zeroBomb(inflatedMb: number): Promise<Uint8Array> {
  const z = createDeflate({ level: 9 });
  const chunks: Buffer[] = [];
  z.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise((resolve) => z.on('end', resolve));
  const mb = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < inflatedMb; i++) {
    if (!z.write(mb)) await new Promise((resolve) => z.once('drain', resolve));
  }
  z.end();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}

export async function hostilePdfs(): Promise<HostileFile[]> {
  const files: HostileFile[] = [];
  const add = (name: string, why: string, bytes: Uint8Array) => files.push({ name, why, bytes });

  const bomb = await zeroBomb(256); // ~250 KB on disk, 256 MB when inflated
  add('flate-bomb-content', 'page content that inflates to 256 MB', build([
    '<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE, PAGE(' /Contents 4 0 R'),
    { dict: `/Filter /FlateDecode /Length ${bomb.length}`, data: bomb },
  ]));
  add('flate-bomb-image', 'an image that inflates to 256 MB (16384 x 16384 grey)', build([
    '<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE,
    PAGE(' /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R'),
    { dict: `/Type /XObject /Subtype /Image /Width 16384 /Height 16384 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${bomb.length}`, data: bomb },
    text('q 300 0 0 300 0 0 cm /Im0 Do Q'),
  ]));
  add('deep-nesting', 'arrays nested 100,000 levels deep', build([
    `<< /Type /Catalog /Pages 2 0 R /Deep ${'['.repeat(100_000)}${']'.repeat(100_000)} >>`, PAGES_ONE, PAGE(),
  ]));
  add('deep-dict-nesting', 'dictionaries nested 50,000 levels deep', build([
    `<< /Type /Catalog /Pages 2 0 R /Deep ${'<< /A '.repeat(50_000)}1${' >>'.repeat(50_000)} >>`, PAGES_ONE, PAGE(),
  ]));
  add('page-tree-loop', 'the page tree lists itself as its own child', build([
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >>', PAGE(),
  ]));
  add('page-tree-cycle', 'two page-tree nodes that point to each other', build([
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>', PAGE(),
    '<< /Type /Pages /Parent 2 0 R /Kids [2 0 R] /Count 1 >>',
  ]));
  add('outline-loop', 'bookmarks whose Next chain loops forever', build([
    '<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R >>', PAGES_ONE, PAGE(),
    '<< /Type /Outlines /First 5 0 R /Last 6 0 R /Count 2 >>',
    '<< /Title (A) /Parent 4 0 R /Next 6 0 R /Dest [3 0 R /Fit] >>',
    '<< /Title (B) /Parent 4 0 R /Next 5 0 R /Prev 5 0 R /First 5 0 R /Dest [3 0 R /Fit] >>',
  ]));
  add('name-tree-loop', 'an embedded-files name tree that contains itself', build([
    '<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 4 0 R /Dests 4 0 R >> >>', PAGES_ONE, PAGE(),
    '<< /Kids [4 0 R] >>',
  ]));
  add('xref-prev-loop', 'the cross-reference table points back to itself', (() => {
    const base = build(['<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE, PAGE()]);
    const s = new TextDecoder('latin1').decode(base);
    const xrefAt = s.lastIndexOf('xref\n');
    return enc.encode(s.replace('/Root 1 0 R', `/Root 1 0 R /Prev ${xrefAt}`));
  })());
  add('huge-page-count', 'claims 10 million pages but has one', build([
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 10000000 >>', PAGE(),
  ]));
  add('many-real-pages', '6,000 real (empty) pages, above the 5,000-page limit', (() => {
    const n = 6000;
    const kids = Array.from({ length: n }, (_, i) => `${i + 3} 0 R`).join(' ');
    return build(['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`,
      ...Array.from({ length: n }, () => PAGE())]);
  })());
  add('huge-image-claim', 'a 100,000 x 100,000 image with almost no data', build([
    '<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE,
    PAGE(' /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R'),
    { dict: '/Type /XObject /Subtype /Image /Width 100000 /Height 100000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 3', data: enc.encode('abc') },
    text('q 300 0 0 300 0 0 cm /Im0 Do Q'),
  ]));
  add('huge-length', 'a stream claiming to be 4 GB long', build([
    '<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE, PAGE(' /Contents 4 0 R'),
    { dict: '/Length 4294967295', data: enc.encode('BT /F1 12 Tf (x) Tj ET') },
  ]));
  add('self-length', 'a stream whose length points to itself', build([
    '<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE, PAGE(' /Contents 4 0 R'),
    { dict: '/Length 4 0 R', data: enc.encode('0 0 m 10 10 l S') },
  ]));
  add('bad-numbers', 'negative, huge and invalid numbers in page boxes and rotation', build([
    '<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 -1e308 99999999999999999999] /CropBox [NaN 1 2] /Rotate 450000000 /UserUnit -5 >>',
  ]));
  add('garbage-xref', 'every cross-reference offset is wrong', build(
    ['<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE, PAGE()], { xref: 'garbage' },
  ));
  add('no-xref', 'no cross-reference table at all', build(['<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE, PAGE()], { xref: 'none' }));
  add('truncated', 'cut off half-way', build(['<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE, PAGE()]).slice(0, 120));
  add('header-only', 'just a PDF header', enc.encode('%PDF-1.7\n'));
  add('html-polyglot', 'an HTML page with a PDF header hidden inside', enc.encode(
    `<html><body><script>alert(1)</script><!--\n%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n--></body></html>`,
  ));
  add('active-content', 'scripts, launch, submit, remote links, attachments, XFA and RichMedia', build([
    `<< /Type /Catalog /Pages 2 0 R
       /OpenAction << /S /JavaScript /JS (app.alert\\('open'\\)) /Next << /S /Launch /F (no-such-program.exe) >> >>
       /AA << /WC << /S /JavaScript /JS (app.alert\\('close'\\)) >> >>
       /Names << /JavaScript << /Names [(a) << /S /JavaScript /JS (app.alert\\(1\\)) >>] >>
                 /EmbeddedFiles << /Names [(x.exe) 5 0 R] >> >>
       /AcroForm << /Fields [] /XFA 7 0 R >> >>`,
    PAGES_ONE,
    PAGE(' /Annots [4 0 R 8 0 R] /AA << /O << /S /SubmitForm /F (http://example.invalid/collect) >> >>'),
    '<< /Type /Annot /Subtype /Link /Rect [0 0 100 100] /A << /S /URI /URI (http://example.invalid/track) >> >>',
    '<< /Type /Filespec /F (x.exe) /EF << /F 6 0 R >> >>',
    { dict: '/Type /EmbeddedFile /Length 4', data: enc.encode('MZ\x90\x00') },
    { dict: '/Length 26', data: enc.encode('<xdp:xdp>script</xdp:xdp>') },
    '<< /Type /Annot /Subtype /RichMedia /Rect [100 100 200 200] /A << /S /GoToR /F (other.pdf) /D [0 /Fit] >> >>',
  ]));
  add('broken-font', 'an embedded font that is random bytes', build([
    '<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE,
    PAGE(' /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R'),
    '<< /Type /Font /Subtype /TrueType /BaseFont /Evil /FirstChar 32 /LastChar 126 /Widths [] /FontDescriptor 5 0 R >>',
    '<< /Type /FontDescriptor /FontName /Evil /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 900 /Descent -100 /CapHeight 700 /StemV 80 /FontFile2 6 0 R >>',
    { dict: '/Length 64', data: Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff) },
    text('BT /F1 24 Tf 20 150 Td (Hello) Tj ET'),
  ]));
  for (const [filter, label] of [['DCTDecode', 'JPEG'], ['JBIG2Decode', 'JBIG2'], ['CCITTFaxDecode', 'fax'], ['JPXDecode', 'JPEG 2000']] as const) {
    add(`broken-${label.toLowerCase().replace(/ /g, '')}`, `a ${label} image that is random bytes`, build([
      '<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE,
      PAGE(' /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R'),
      { dict: `/Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceGray /BitsPerComponent ${filter === 'CCITTFaxDecode' || filter === 'JBIG2Decode' ? 1 : 8} /Filter /${filter} /Length 128`,
        data: Uint8Array.from({ length: 128 }, (_, i) => (i * 73 + 5) & 0xff) },
      text('q 300 0 0 300 0 0 cm /Im0 Do Q'),
    ]));
  }
  add('object-stream-loop', 'an object stream that extends itself', build([
    '<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE, PAGE(),
    { dict: '/Type /ObjStm /N 1 /First 4 /Extends 4 0 R /Length 7', data: enc.encode('5 0 1 ') },
  ]));
  add('form-xobject-loop', 'a drawing that draws itself forever', build([
    '<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE,
    PAGE(' /Resources << /XObject << /X 4 0 R >> >> /Contents 5 0 R'),
    { dict: '/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /XObject << /X 4 0 R >> >> /Length 6', data: enc.encode('/X Do\n') },
    text('/X Do'),
  ]));
  add('hostile-text', 'text with script tags, right-to-left tricks and control characters', build([
    `<< /Type /Catalog /Pages 2 0 R >>`, PAGES_ONE,
    PAGE(' /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R'),
    text('BT /F1 12 Tf 10 150 Td (<script>alert\\(1\\)</script> \\342\\200\\256gpj.exe \\000\\001) Tj ET'),
  ], { trailer: ' /Info << /Title (<img src=x onerror=alert\\(1\\)>) /Author (\\342\\200\\256evil) >>' }));
  add('many-objects', '100,000 tiny objects', build([
    '<< /Type /Catalog /Pages 2 0 R >>', PAGES_ONE, PAGE(), ...Array.from({ length: 100_000 }, (_, i) => `${i}`),
  ]));
  return files;
}

/** Deterministic random numbers (mulberry32), so a failing case can be replayed. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A corrupted copy of `bytes`: a few random bytes flipped, a range
 * duplicated, a chunk cut out, or a number made huge, chosen by `rand`.
 */
export function mutate(bytes: Uint8Array, rand: () => number): Uint8Array {
  const out = bytes.slice();
  const pick = (n: number) => Math.floor(rand() * n);
  switch (pick(4)) {
    case 0: {
      for (let i = 0, n = 1 + pick(20); i < n; i++) out[pick(out.length)] = pick(256);
      return out;
    }
    case 1: {
      const from = pick(out.length);
      const len = Math.min(1 + pick(400), out.length - from);
      const at = pick(out.length);
      return Uint8Array.from([...out.subarray(0, at), ...out.subarray(from, from + len), ...out.subarray(at)]);
    }
    case 2: {
      const from = pick(out.length);
      const len = 1 + pick(200);
      return Uint8Array.from([...out.subarray(0, from), ...out.subarray(from + len)]);
    }
    default: {
      // Replace a run of digits with a huge or negative number.
      const s = new TextDecoder('latin1').decode(out);
      const digits = [...s.matchAll(/\d+/g)];
      if (!digits.length) return out;
      const m = digits[pick(digits.length)]!;
      const big = ['99999999999', '-1', '2147483648', '0', '1e309'][pick(5)]!;
      const edited = s.slice(0, m.index) + big + s.slice(m.index! + m[0].length);
      return Uint8Array.from(edited, (c) => c.charCodeAt(0));
    }
  }
}
