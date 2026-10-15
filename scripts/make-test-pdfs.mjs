// Writes a set of generated test files into ./test-pdfs so you can try every
// ILMPDF tool by hand. Nothing here is a real document, and nothing is
// downloaded: every file is built from scratch on your Mac.
//
// Run with: npm run make-test-pdfs

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { crc32, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as mupdf from 'mupdf';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const LETTER = [612, 792];
const A5 = [419.53, 595.28];
const COLORS = [rgb(0.85, 0.33, 0.31), rgb(0.27, 0.55, 0.85), rgb(0.33, 0.7, 0.42), rgb(0.95, 0.68, 0.2), rgb(0.6, 0.4, 0.8)];
// Fixed dates so the files are identical every time the script runs.
const FIXED_DATE = new Date('2026-01-01T12:00:00Z');

async function newDoc(title) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(title);
  doc.setProducer('ILMPDF test-file generator');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return doc;
}

// A page you can recognise at a glance: a coloured band, a big page number
// and a label, so reordering, rotating and splitting are easy to check.
function drawPage(page, font, { n, total, label }) {
  const { width, height } = page.getSize();
  const color = COLORS[(n - 1) % COLORS.length];
  page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color });
  page.drawText(label, { x: 30, y: height - 58, size: 22, font, color: rgb(1, 1, 1) });
  const big = String(n);
  const size = Math.min(width, height) / 2.5;
  page.drawText(big, {
    x: (width - font.widthOfTextAtSize(big, size)) / 2,
    y: height / 2 - size / 3,
    size,
    font,
    color,
  });
  const footer = `Page ${n} of ${total}  ·  ${Math.round(width)} x ${Math.round(height)} pt`;
  page.drawText(footer, { x: 30, y: 30, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
}

async function pagesPdf(title, sizes, { rotations = [] } = {}) {
  const doc = await newDoc(title);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  sizes.forEach((size, i) => {
    const page = doc.addPage(size);
    drawPage(page, font, { n: i + 1, total: sizes.length, label: title });
    if (rotations[i]) page.setRotation(degrees(rotations[i]));
  });
  return doc.save();
}

// ---- PNG images, encoded by hand (zlib + CRC from Node itself) ----

function png(width, height, pixel, { alpha = false } = {}) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc((width * channels + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // no row filter
    for (let x = 0; x < width; x++) {
      const px = pixel(x, y);
      for (let c = 0; c < channels; c++) raw[o++] = px[c] ?? 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // RGBA or RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

const gradient = (w, h) => (x, y) => [Math.round((255 * x) / w), Math.round((255 * y) / h), 160];
const stripes = (x, y) => (Math.floor((x + y) / 40) % 2 ? [40, 90, 200] : [250, 250, 250]);
const transparentCircle = (size) => (x, y) => {
  const d = Math.hypot(x - size / 2, y - size / 2);
  return d < size / 2.5 ? [220, 60, 60, 255] : [0, 0, 0, 0];
};

async function largeImagesPdf() {
  const doc = await newDoc('Large images');
  for (const [w, h] of [
    [2400, 1600],
    [1600, 2400],
  ]) {
    const image = await doc.embedPng(png(w, h, gradient(w, h)));
    const page = doc.addPage([w / 4, h / 4]);
    page.drawImage(image, { x: 0, y: 0, width: w / 4, height: h / 4 });
  }
  return doc.save();
}

// ---- A real password-protected PDF (RC4 128-bit, the classic standard) ----
// pdf-lib cannot encrypt, so this one is written by hand. Password: test

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
const padPassword = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);

function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

// Applies RC4 20 times with the key XOR-ed by 0..19 (PDF spec, revision 3).
function rc4Rounds(key, data) {
  let out = data;
  for (let i = 0; i < 20; i++) out = rc4(Buffer.from(key.map((b) => b ^ i)), out);
  return out;
}

function encryptedPdf(userPassword, ownerPassword) {
  const id = md5(Buffer.from('ILMPDF password test file'));
  const P = -4; // all permissions allowed
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(P);

  let ownerKey = md5(padPassword(ownerPassword));
  for (let i = 0; i < 50; i++) ownerKey = md5(ownerKey);
  const O = rc4Rounds(ownerKey, padPassword(userPassword));

  let key = md5(padPassword(userPassword), O, pBytes, id);
  for (let i = 0; i < 50; i++) key = md5(key);
  const U = Buffer.concat([rc4Rounds(key, md5(PAD, id)), Buffer.alloc(16)]);

  const objectKey = (num) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 16);
  const content = Buffer.from(
    'BT /F1 28 Tf 60 720 Td (Unlocked!) Tj /F1 16 Tf 0 -40 Td (This file was protected with the password: test) Tj ET',
    'latin1',
  );
  const stream = rc4(objectKey(4), content);

  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.from(`<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${P} /O <${O.toString('hex')}> /U <${U.toString('hex')}> >>`),
  ];
  const parts = [Buffer.from('%PDF-1.7\n')];
  let size = parts[0].length;
  const offsets = objects.map((obj, i) => {
    const offset = size;
    const piece = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), obj, Buffer.from('\nendobj\n')]);
    parts.push(piece);
    size += piece.length;
    return offset;
  });
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) tail += `${String(off).padStart(10, '0')} 00000 n \n`;
  const idHex = id.toString('hex');
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [<${idHex}> <${idHex}>] >>\nstartxref\n${size}\n%%EOF\n`;
  parts.push(Buffer.from(tail));
  return new Uint8Array(Buffer.concat(parts));
}

// ---- Phase 2 files (made with MuPDF, which can write AES-256) ----

function aes256Pdf(source, userPassword, ownerPassword, permissions = -4) {
  const doc = mupdf.Document.openDocument(source, 'application/pdf').asPDF();
  try {
    const out = doc.saveToBuffer(
      `encrypt=aes-256,user-password=${userPassword},owner-password=${ownerPassword},permissions=${permissions}`,
    );
    return new Uint8Array(out.asUint8Array());
  } finally {
    doc.destroy();
  }
}

async function formPdf() {
  const doc = await newDoc('Form');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(A4);
  const form = doc.getForm();
  const label = (text, y) => page.drawText(text, { x: 50, y, size: 12, font });
  page.drawText('Test form', { x: 50, y: 780, size: 22, font });
  label('Full name', 720);
  form.createTextField('full_name').addToPage(page, { x: 160, y: 712, width: 300, height: 22 });
  label('Email', 680);
  form.createTextField('email').addToPage(page, { x: 160, y: 672, width: 300, height: 22 });
  label('Subscribe', 640);
  form.createCheckBox('subscribe').addToPage(page, { x: 160, y: 634, width: 18, height: 18 });
  label('Plan', 600);
  const plan = form.createDropdown('plan');
  plan.addOptions(['Free', 'Pro', 'Team']);
  plan.addToPage(page, { x: 160, y: 592, width: 150, height: 22 });
  label('Size', 560);
  const size = form.createRadioGroup('size');
  size.addOptionToPage('Small', page, { x: 160, y: 554, width: 16, height: 16 });
  size.addOptionToPage('Large', page, { x: 220, y: 554, width: 16, height: 16 });
  return doc.save();
}

// Points the cross-reference table at the wrong place, so a normal reader
// fails but a repair tool can rebuild it.
async function repairablePdf() {
  const bytes = await pagesPdf('Repairable', Array(3).fill(A4));
  const text = Buffer.from(bytes).toString('latin1');
  const broken = text.replace(/startxref\s+\d+/, 'startxref\n999999');
  return new Uint8Array(Buffer.from(broken, 'latin1'));
}

// Large, hard-to-compress page images, like a scanner makes.
async function scannedPdf() {
  const doc = await newDoc('Scanned');
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 255;
  for (let i = 0; i < 3; i++) {
    const [w, h] = [1240, 1754]; // A4 at 150 dpi
    const image = await doc.embedPng(png(w, h, (x, y) => {
      const v = 225 + (noise() % 30) - (Math.floor(y / 40) % 2 && x > 120 && x < 1100 ? 120 : 0);
      return [v, v, v];
    }));
    doc.addPage(A4).drawImage(image, { x: 0, y: 0, width: A4[0], height: A4[1] });
  }
  return doc.save();
}

// ---- The full set ----

export async function buildTestFiles() {
  const five = Array(5).fill(A4);
  const metadata = await (async () => {
    const doc = await PDFDocument.load(await pagesPdf('With metadata', [A4, A4]), { updateMetadata: false });
    doc.setTitle('Quarterly report (test)');
    doc.setAuthor('Jane Example');
    doc.setSubject('A made-up document for metadata tests');
    doc.setKeywords(['ilmpdf', 'test', 'metadata']);
    doc.setCreator('Example Writer 1.0');
    return doc.save();
  })();
  const damaged = (await pagesPdf('Damaged', five)).slice(0, 1500);

  return [
    { name: '01-one-page.pdf', purpose: 'A single A4 page.', bytes: await pagesPdf('One page', [A4]) },
    { name: '02-five-pages.pdf', purpose: 'Five A4 pages numbered 1 to 5: merge, split, organize, page numbers, watermark.', bytes: await pagesPdf('Five pages', five) },
    { name: '03-twelve-pages.pdf', purpose: 'Twelve Letter pages: split every N pages, extract ranges.', bytes: await pagesPdf('Twelve pages', Array(12).fill(LETTER)) },
    { name: '04-fifty-pages.pdf', purpose: 'Fifty pages: thumbnail grid scrolling and speed.', bytes: await pagesPdf('Fifty pages', Array(50).fill(A4)) },
    { name: '05-three-hundred-pages.pdf', purpose: 'Three hundred pages: a stress test for organize and merge.', bytes: await pagesPdf('300 pages', Array(300).fill(A5)) },
    {
      name: '06-mixed-sizes.pdf',
      purpose: 'A4, Letter, A5, landscape A4 and a square page in one file.',
      bytes: await pagesPdf('Mixed sizes', [A4, LETTER, A5, [A4[1], A4[0]], [500, 500]]),
    },
    {
      name: '07-rotated-pages.pdf',
      purpose: 'Pages already rotated 0, 90, 180 and 270 degrees.',
      bytes: await pagesPdf('Rotated', [A4, A4, A4, A4], { rotations: [0, 90, 180, 270] }),
    },
    { name: '08-with-metadata.pdf', purpose: 'Has author "Jane Example", title, subject and keywords: remove metadata.', bytes: metadata },
    { name: '09-large-images.pdf', purpose: 'Two pages that are big images: PDF to images, file size.', bytes: await largeImagesPdf() },
    { name: '10-password-is-test.pdf', purpose: 'Really encrypted (RC4 128-bit). Password: test. ILMPDF should refuse it politely until Phase 2.', bytes: encryptedPdf('test', 'owner-test') },
    { name: '11-damaged.pdf', purpose: 'Cut off part way: should fail with a clear message, never a crash.', bytes: damaged },
    { name: '12-not-really-a-pdf.pdf', purpose: 'A text file with a .pdf name: should be rejected before any engine sees it.', bytes: new TextEncoder().encode('This is plain text pretending to be a PDF.\n') },
    {
      name: '13-<img src=x onerror=alert(1)>.pdf',
      purpose: 'A file name that looks like HTML: ILMPDF must show it as plain text, with no pop-up.',
      bytes: await pagesPdf('Odd file name', [A4]),
    },
    {
      name: '14-password-aes256-is-test.pdf',
      purpose: 'AES-256 encrypted, the modern standard. Password: test (owner password: owner-test).',
      bytes: aes256Pdf(await pagesPdf('AES-256 locked', five), 'test', 'owner-test'),
    },
    {
      name: '18-restricted-owner-password-is-owner-test.pdf',
      purpose: 'Opens without a password but blocks printing and copying. Owner password: owner-test.',
      bytes: aes256Pdf(await pagesPdf('Restricted', [A4, A4]), '', 'owner-test', -3904),
    },
    { name: '15-form.pdf', purpose: 'Fillable form: text boxes, a checkbox, a dropdown and radio buttons.', bytes: await formPdf() },
    { name: '16-repairable.pdf', purpose: 'Broken cross-reference table: normal readers fail, Repair should fix it.', bytes: await repairablePdf() },
    { name: '17-scanned-heavy.pdf', purpose: 'Three big scanned-style pages: Compress should make it much smaller.', bytes: await scannedPdf() },
    { name: 'image-01-landscape.png', purpose: 'Landscape PNG for images to PDF.', bytes: png(1200, 800, gradient(1200, 800)) },
    { name: 'image-02-portrait.png', purpose: 'Portrait PNG for images to PDF.', bytes: png(800, 1200, stripes) },
    { name: 'image-03-transparent.png', purpose: 'PNG with a transparent background.', bytes: png(600, 600, transparentCircle(600), { alpha: true }) },
  ];
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.join(root, 'test-pdfs');
  await mkdir(outDir, { recursive: true });
  const files = await buildTestFiles();
  let readme = '# ILMPDF test files\n\nGenerated by `npm run make-test-pdfs`. None of these are real documents.\n';
  readme += 'To make JPG test images, open 02-five-pages.pdf in ILMPDF\'s "PDF to images" tool and choose JPG.\n\n';
  for (const f of files) {
    await writeFile(path.join(outDir, f.name), f.bytes);
    readme += `- **${f.name}**: ${f.purpose}\n`;
  }
  await writeFile(path.join(outDir, 'README.md'), readme);
  console.log(`Wrote ${files.length} test files to ${outDir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
