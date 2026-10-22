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
import { PDFArray, PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib';

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

// Harmless stand-ins for what a hostile PDF can carry, for the Remove
// scripts tool. The scripts only show an alert, and the launch action names
// a program that does not exist. ILMPDF never runs any of it.
const jsAction = (ctx, code) => ctx.obj({ S: 'JavaScript', JS: PDFString.of(code) });

function addLink(doc, page, rect, action) {
  const ref = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: action }));
  page.node.addAnnot(ref);
}

async function scriptedPdf() {
  const doc = await newDoc('With scripts');
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 3; n++) drawPage(doc.addPage(A4), font, { n, total: 3, label: 'With scripts' });
  const page = doc.getPage(0);
  const lines = [
    'This file carries: a document script, a script that runs on opening,',
    'a "launch a program" action on this page, a javascript: link,',
    'and an attached file (notes.txt). Below are two links that must stay:',
  ];
  lines.forEach((text, i) => page.drawText(text, { x: 40, y: 300 - i * 18, size: 12, font }));
  page.drawText('example.com (web link)', { x: 40, y: 220, size: 12, font, color: rgb(0.1, 0.3, 0.8) });
  page.drawText('Go to page 3 (link within the document)', { x: 40, y: 195, size: 12, font, color: rgb(0.1, 0.3, 0.8) });
  page.drawText('Click me (javascript: link, removed)', { x: 40, y: 170, size: 12, font, color: rgb(0.8, 0.2, 0.2) });
  addLink(doc, page, [38, 215, 200, 232], ctx.obj({ S: 'URI', URI: PDFString.of('https://example.com/') }));
  addLink(doc, page, [38, 190, 290, 207], ctx.obj({ S: 'GoTo', D: [doc.getPage(2).ref, 'Fit'] }));
  addLink(doc, page, [38, 165, 260, 182], ctx.obj({ S: 'URI', URI: PDFString.of('javascript:app.alert("ILMPDF test link")') }));
  doc.addJavaScript('ilmpdf-test', 'app.alert("ILMPDF test: document script");');
  doc.catalog.set(PDFName.of('OpenAction'), jsAction(ctx, 'app.alert("ILMPDF test: runs on opening");'));
  page.node.set(PDFName.of('AA'), ctx.obj({ O: { S: 'Launch', F: PDFString.of('no-such-program') } }));
  await doc.attach(new TextEncoder().encode('A made-up attached file.\n'), 'notes.txt', {
    mimeType: 'text/plain',
    description: 'Test attachment',
    creationDate: FIXED_DATE,
    modificationDate: FIXED_DATE,
  });
  return doc.save();
}

// A form like real-world ones: a field with format and keystroke scripts,
// a "Send" button that submits the form, and an XFA form layer.
async function scriptedFormPdf() {
  const doc = await PDFDocument.load(await formPdf(), { updateMetadata: false });
  const ctx = doc.context;
  const form = doc.getForm();
  const email = form.getTextField('email').acroField.dict;
  email.set(PDFName.of('AA'), ctx.obj({ K: jsAction(ctx, 'event.change = event.change.toLowerCase();'), F: jsAction(ctx, 'app.alert("ILMPDF test: format script");') }));
  const send = form.createButton('send');
  send.addToPage('Send', doc.getPage(0), { x: 160, y: 500, width: 80, height: 24 });
  send.acroField.getWidgets()[0].dict.set(PDFName.of('A'), ctx.obj({ S: 'SubmitForm', F: PDFString.of('https://example.com/form') }));
  // pdf-lib deletes XFA whenever it touches the form, including while
  // saving, so draw the field appearances first and add XFA last.
  form.updateFieldAppearances();
  const xfa = ctx.register(ctx.flateStream('<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"></xdp:xdp>'));
  form.acroForm.dict.set(PDFName.of('XFA'), xfa);
  return doc.save({ updateFieldAppearances: false });
}

// A short document with metadata, so a batch has something to remove.
async function batchLetterPdf() {
  const doc = await pagesPdf('Batch letter', [LETTER, LETTER]);
  const pdf = await PDFDocument.load(doc, { updateMetadata: false });
  pdf.setAuthor('Batch Example');
  pdf.setTitle('Batch letter');
  return pdf.save();
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

// Lines of made-up text for the OCR test file. Tests search for these words.
export const SCAN_LINES = [
  ['Quarterly garden report', 'The tomatoes grew quickly this summer.', 'Invoice number 4821 is due on 12 March.'],
  ['This page has real text already.', 'OCR should leave it alone.'],
  ['Sideways scan of a delivery note', 'Parcel 7395 left the depot on Friday.'],
];

// Draws text with pdf-lib, then turns the page into a picture with MuPDF, so
// the result looks like a scan: an image with no text anyone can select.
async function textAsPicture(lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(A4);
  lines.forEach((line, i) => page.drawText(line, { x: 60, y: 760 - i * 34, size: i === 0 ? 22 : 15, font }));
  const pdf = mupdf.Document.openDocument(await doc.save(), 'application/pdf');
  const pix = pdf.loadPage(0).toPixmap(mupdf.Matrix.scale(200 / 72, 200 / 72), mupdf.ColorSpace.DeviceGray, false, true);
  return pix.asPNG();
}

// Two scanned pages (one stored sideways and turned upright by the page's
// rotation) around a page that already has real text.
async function scannedTextPdf() {
  const doc = await newDoc('Scanned text');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = await doc.embedPng(await textAsPicture(SCAN_LINES[0]));
  doc.addPage(A4).drawImage(first, { x: 0, y: 0, width: A4[0], height: A4[1] });
  const typed = doc.addPage(A4);
  SCAN_LINES[1].forEach((line, i) => typed.drawText(line, { x: 60, y: 760 - i * 30, size: 15, font }));
  // Stored landscape and drawn turned a quarter left; /Rotate 90 turns it back.
  const third = await doc.embedPng(await textAsPicture(SCAN_LINES[2]));
  const sideways = doc.addPage([A4[1], A4[0]]);
  sideways.drawImage(third, { x: A4[1], y: 0, width: A4[0], height: A4[1], rotate: degrees(90) });
  sideways.setRotation(degrees(90));
  return doc.save();
}

// A made-up letter full of "private" details to practise redaction on: the
// same account number on both pages (the second page is rotated), a photo,
// a drawn shape, a link, a filled-in form field, bookmarks and attached files.
async function redactionPdf() {
  const doc = await newDoc('Redaction sample');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const photo = await doc.embedPng(png(240, 300, (x, y) => [80 + (x % 60), 120, 200 - (y % 80)]));
  const form = doc.getForm();

  const first = doc.addPage(A4);
  const line = (page, text, y, f = font) => page.drawText(text, { x: 60, y, size: 14, font: f });
  line(first, 'Redaction sample (made up)', 780, bold);
  line(first, 'Name: Jane Example', 730);
  line(first, 'Account number: 0000 1111 2222 3333', 700);
  line(first, 'Phone: 555-0100', 670);
  line(first, 'This sentence is public and should stay readable.', 640);
  first.drawImage(photo, { x: 380, y: 560, width: 120, height: 150 });
  first.drawRectangle({ x: 60, y: 480, width: 120, height: 60, color: rgb(0.85, 0.33, 0.31) });
  line(first, 'Secret notes field:', 430);
  const notes = form.createTextField('secret_notes');
  notes.setText('Account 0000 1111 2222 3333');
  notes.addToPage(first, { x: 60, y: 395, width: 300, height: 24 });
  // A web link over the phone number (it points nowhere real).
  const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [60, 665, 200, 685], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of('https://example.invalid/jane') } });
  first.node.lookup(PDFName.of('Annots'), PDFArray).push(doc.context.register(link));

  const second = doc.addPage(A4);
  line(second, 'Page two (rotated)', 780, bold);
  line(second, 'Account number again: 0000 1111 2222 3333', 730);
  line(second, 'Public text on page two.', 700);
  second.setRotation(degrees(90));

  // Bookmarks: "Letter" > "About Jane Example" > "Contact details", and
  // "Page two". Redacting "Jane Example" should remove only the middle one.
  const ctx = doc.context;
  const ref = () => ctx.nextRef();
  const [outlines, letter, about, contact, two] = [ref(), ref(), ref(), ref(), ref()];
  const dest = (page) => ctx.obj([page.ref, PDFName.of('Fit')]);
  ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: letter, Last: two, Count: 4 }));
  ctx.assign(letter, ctx.obj({ Title: PDFString.of('Letter'), Parent: outlines, Next: two, First: about, Last: about, Count: 2, Dest: dest(first) }));
  ctx.assign(about, ctx.obj({ Title: PDFString.of('About Jane Example'), Parent: letter, First: contact, Last: contact, Count: 1, Dest: dest(first) }));
  ctx.assign(contact, ctx.obj({ Title: PDFString.of('Contact details'), Parent: about, Dest: dest(first) }));
  ctx.assign(two, ctx.obj({ Title: PDFString.of('Page two'), Parent: outlines, Prev: letter, Dest: dest(second) }));
  doc.catalog.set(PDFName.of('Outlines'), outlines);

  // Attached files: one mentions the account number, one is harmless, and
  // one is a picture whose contents can't be searched.
  const attach = (bytes, name, mimeType, description) =>
    doc.attach(bytes, name, { mimeType, description, creationDate: FIXED_DATE, modificationDate: FIXED_DATE });
  await attach(new TextEncoder().encode('Account 0000 1111 2222 3333 belongs to the sample letter.\n'), 'account-details.txt', 'text/plain', 'Made-up account details');
  await attach(new TextEncoder().encode('Nothing private here.\n'), 'public-notes.txt', 'text/plain', 'Made-up public notes');
  await attach(png(8, 8, () => [200, 200, 200]), 'scan.png', 'image/png', 'Made-up picture');
  return doc.save();
}

// Two versions of a made-up report for Compare PDFs. The newer one changes
// two numbers and adds a sentence on page 2, moves a square on page 3
// (a change you can only see, not read) and adds a fourth page.
async function comparePdf(newer) {
  const doc = await newDoc(newer ? 'Compare sample, version 2' : 'Compare sample, version 1');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const line = (page, text, y, f = font) => page.drawText(text, { x: 60, y, size: 14, font: f });

  const first = doc.addPage(A4);
  line(first, 'Quarterly report (made up)', 780, bold);
  line(first, 'This first page is the same in both versions.', 740);
  line(first, 'Nothing here should show up as a change.', 715);

  const second = doc.addPage(A4);
  line(second, 'Costs', 780, bold);
  line(second, `The total cost was ${newer ? 1500 : 1200} pounds.`, 740);
  line(second, `Payment is due in ${newer ? 14 : 30} days.`, 715);
  if (newer) line(second, 'A late fee of 20 pounds applies.', 690);
  line(second, 'Thank you for your business.', newer ? 665 : 690);

  const third = doc.addPage(A4);
  line(third, 'Appendix', 780, bold);
  line(third, 'The text on this page does not change, but the square moves.', 740);
  third.drawRectangle({ x: newer ? 360 : 60, y: 500, width: 150, height: 150, color: COLORS[1] });

  if (newer) {
    const fourth = doc.addPage(A4);
    line(fourth, 'New page', 780, bold);
    line(fourth, 'This page only exists in version two.', 740);
  }
  return doc.save();
}

// ---- Edit metadata (files 36-37) ----

// Accented and non-Latin details, stored as UTF-16 like real apps do.
async function unicodeMetadataPdf() {
  const doc = await PDFDocument.load(await pagesPdf('Unicode metadata', [A4]), { updateMetadata: false });
  doc.setTitle('Café menu: 東京 / Ελληνικά');
  doc.setAuthor('Zoë Exämple');
  doc.setSubject('Made-up details with accents and non-Latin text');
  doc.setKeywords(['naïve', 'résumé', '日本語']);
  return doc.save();
}

// Has an XMP copy whose values disagree with the /Info dictionary, the way a
// file looks after an app updated one copy but not the other. Edit metadata
// should leave no trace of the stale XMP values.
async function xmpMetadataPdf() {
  const doc = await PDFDocument.load(await pagesPdf('Old title in Info', [A4, A4]), { updateMetadata: false });
  doc.setAuthor('Info Author');
  const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Stale XMP title</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>Stale XMP Author</rdf:li></rdf:Seq></dc:creator>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
  const stream = doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  return doc.save({ useObjectStreams: false });
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
    { name: '10-password-is-test.pdf', purpose: 'Really encrypted (RC4 128-bit). Password: test. Unlock should open it with this password.', bytes: encryptedPdf('test', 'owner-test') },
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
    {
      name: '19-redaction-sample.pdf',
      purpose: 'Made-up name, account number (on both pages), photo, shape, link, form field, bookmarks and three attached files: practise redaction.',
      bytes: await redactionPdf(),
    },
    { name: '20-with-scripts.pdf', purpose: 'Three pages with a document script, an on-open script, a launch action, a javascript: link and an attached file: Remove scripts should report and remove them, keeping the web link and the page link.', bytes: await scriptedPdf() },
    { name: '21-form-with-scripts.pdf', purpose: 'The test form plus field scripts, a Send (submit) button and an XFA layer: after Remove scripts the fields should still fill in.', bytes: await scriptedFormPdf() },
    { name: '22-scanned-text.pdf', purpose: 'Scanned pages with no selectable text (page 2 has real text, page 3 is rotated): OCR should make pages 1 and 3 searchable and skip page 2.', bytes: await scannedTextPdf() },
    { name: '25-batch-letter.pdf', purpose: 'Two Letter pages with author "Batch Example": use with 02, 08 and 17 in Batch process (for example Remove metadata or Compress).', bytes: await batchLetterPdf() },
    { name: '26-batch-broken-inside.pdf', purpose: 'Starts like a PDF but the rest is junk: in Batch process it should be listed as failed while the other files are still saved.', bytes: new TextEncoder().encode('%PDF-1.7\n%\xe2\xe3\xcf\xd3\nThis is not a PDF body, just junk text.\n'.repeat(4)) },
    { name: '31-flatten-form-and-comments.pdf', purpose: 'The test form, filled in, plus a highlight, a note, a text box, a rectangle and an ink "signature": Flatten should report 5 form fields and 5 annotations.', bytes: await flattenFormPdf() },
    { name: '32-flatten-with-links.pdf', purpose: 'Two pages with 5 annotations each, a web link and a link to page 2: after Flatten both links must still work.', bytes: await flattenLinksPdf() },
    {
      name: '27-headers-mixed-pages.pdf',
      purpose: 'Letter, landscape A4, A5 turned 90 degrees and Letter turned 270 degrees: Headers & footers should sit at the top and bottom of every page as shown, reading upright.',
      bytes: await pagesPdf('Headers', [LETTER, [A4[1], A4[0]], A5, LETTER], { rotations: [0, 0, 90, 270] }),
    },
    {
      name: '28-bates-sample.pdf',
      purpose: 'Twelve Letter pages with a cover: try Bates numbers such as ABC000001 on pages "2-" so the cover gets none.',
      bytes: await pagesPdf('Bates sample', Array(12).fill(LETTER)),
    },
    { name: '23-compare-original.pdf', purpose: 'Compare PDFs, older version: three pages of a made-up report. Compare it with 24-compare-changed.pdf.', bytes: await comparePdf(false) },
    { name: '24-compare-changed.pdf', purpose: 'Compare PDFs, newer version: page 2 has new numbers and an added sentence, the square on page 3 moved (visual only), and page 4 is new.', bytes: await comparePdf(true) },
    { name: '36-metadata-unicode.pdf', purpose: 'Title, author and keywords with accents, Greek and Japanese: Edit metadata should show and keep them correctly.', bytes: await unicodeMetadataPdf() },
    { name: '37-metadata-with-xmp.pdf', purpose: 'Has a hidden XMP copy saying "Stale XMP title" and "Stale XMP Author": after Edit metadata saves, neither should remain.', bytes: await xmpMetadataPdf() },
    { name: 'image-01-landscape.png', purpose: 'Landscape PNG for images to PDF.', bytes: png(1200, 800, gradient(1200, 800)) },
    { name: 'image-02-portrait.png', purpose: 'Portrait PNG for images to PDF.', bytes: png(800, 1200, stripes) },
    { name: 'image-03-transparent.png', purpose: 'PNG with a transparent background.', bytes: png(600, 600, transparentCircle(600), { alpha: true }) },
  ];
}

// ---- Phase 4 Flatten files: real annotations, added with MuPDF ----

// Adds a highlight, a sticky note, a text box, a rectangle and a hand-drawn
// "signature" (ink) to the given page. Coordinates are MuPDF's: points from
// the top-left corner of the page.
function addMarkups(doc, index, top) {
  const page = doc.loadPage(index);
  const highlight = page.createAnnotation('Highlight');
  highlight.setColor([1, 0.9, 0]);
  highlight.setQuadPoints([[45, top, 200, top, 45, top + 30, 200, top + 30]]);
  highlight.update();
  const note = page.createAnnotation('Text');
  note.setRect([500, top, 520, top + 20]);
  note.setContents('A made-up comment for the Flatten test.');
  note.update();
  const box = page.createAnnotation('FreeText');
  box.setRect([300, 700, 545, 730]);
  box.setContents('APPROVED (test stamp)');
  box.setDefaultAppearance('Helv', 14, [0.8, 0, 0]);
  box.setBorderWidth(0);
  box.update();
  box.getObject().delete('CL');
  box.update();
  const square = page.createAnnotation('Square');
  square.setRect([290, 690, 555, 740]);
  square.setColor([0.8, 0, 0]);
  square.setBorderWidth(2);
  square.update();
  const ink = page.createAnnotation('Ink');
  ink.setColor([0, 0, 0.6]);
  ink.setBorderWidth(2);
  ink.setInkList([[[60, 760], [80, 740], [100, 770], [120, 745], [140, 765], [170, 750]]]);
  ink.update();
  page.destroy();
}

function withMarkups(source, pages) {
  const doc = mupdf.Document.openDocument(source, 'application/pdf').asPDF();
  try {
    for (const [index, top] of pages) addMarkups(doc, index, top);
    return new Uint8Array(doc.saveToBuffer({ garbage: 'compact' }).asUint8Array());
  } finally {
    doc.destroy();
  }
}

// The test form, filled in, with comments on top: 5 fields and 5 annotations.
async function flattenFormPdf() {
  const doc = await PDFDocument.load(await formPdf(), { updateMetadata: false });
  const form = doc.getForm();
  form.getTextField('full_name').setText('Jane Example');
  form.getTextField('email').setText('jane@example.invalid');
  form.getCheckBox('subscribe').check();
  form.getDropdown('plan').select('Pro');
  form.getRadioGroup('size').select('Large');
  return withMarkups(await doc.save(), [[0, 50]]);
}

// Two pages with a web link and a link to page 2 that must survive
// flattening: 10 annotations (5 per page), no form.
async function flattenLinksPdf() {
  const doc = await newDoc('Flatten with links');
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let n = 1; n <= 2; n++) drawPage(doc.addPage(A4), font, { n, total: 2, label: 'Flatten with links' });
  const first = doc.getPage(0);
  first.drawText('Web link (example.com)', { x: 50, y: 150, size: 14, font, color: rgb(0, 0, 0.8) });
  addLink(doc, first, [45, 145, 260, 165], doc.context.obj({ S: 'URI', URI: PDFString.of('https://example.com/') }));
  first.drawText('Go to page 2', { x: 50, y: 120, size: 14, font, color: rgb(0, 0, 0.8) });
  addLink(doc, first, [45, 115, 160, 135], doc.context.obj({ S: 'GoTo', D: [doc.getPage(1).ref, PDFName.of('Fit')] }));
  return withMarkups(await doc.save(), [[0, 10], [1, 10]]);
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
