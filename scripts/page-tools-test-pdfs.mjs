// Test files 33-35, for the Page tools (resize, insert, remove blank pages).
// Kept apart from make-test-pdfs.mjs, which lists them with the others.
// Like the rest, every file is built from scratch: nothing real, nothing downloaded.

import { PDFDocument, PDFName, StandardFonts, degrees, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const A5 = [419.53, 595.28];
const LETTER = [612, 792];
const FIXED_DATE = new Date('2026-01-01T12:00:00Z');

async function newDoc(title) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(title);
  doc.setProducer('ILMPDF test-file generator');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return doc;
}

// A frame around the page edge and a centred label, so you can see at a
// glance whether content was scaled, centred and kept whole.
function framed(page, font, lines, color = rgb(0.27, 0.55, 0.85)) {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 6, y: 6, width: width - 12, height: height - 12, borderColor: color, borderWidth: 6 });
  lines.forEach((text, i) => {
    const size = i === 0 ? 28 : 14;
    const y = height / 2 + 20 - i * 30;
    page.drawText(text, { x: (width - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color: i === 0 ? color : rgb(0.2, 0.2, 0.2) });
  });
}

// 33: one page of each kind the resizer must handle.
async function resizeSample() {
  const doc = await newDoc('Resize sample');
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const a5 = doc.addPage(A5);
  framed(a5, font, ['A5 portrait', 'Has a web link box below']);
  // A link annotation (not followed by ILMPDF): it should move and scale with the page.
  const link = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [110, 120, 310, 160],
    Border: [0, 0, 2],
    C: [1, 0, 0],
    A: { S: 'URI', URI: 'https://example.com/' },
  });
  a5.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(link)]));
  a5.drawText('example.com link', { x: 130, y: 135, size: 14, font, color: rgb(0.8, 0, 0) });

  framed(doc.addPage([LETTER[1], LETTER[0]]), font, ['Letter landscape', 'Should stay landscape on "Same as each page"']);

  const turned = doc.addPage(A4);
  framed(turned, font, ['A4 turned 90°', 'Shown sideways; reads correctly after resize']);
  turned.setRotation(degrees(90));

  const cropped = doc.addPage(A4);
  framed(cropped, font, ['A4 cropped', 'Only the middle is visible'], rgb(0.33, 0.7, 0.42));
  cropped.drawText('HIDDEN BY CROP', { x: 40, y: 60, size: 20, font, color: rgb(0.8, 0, 0) });
  cropped.setCropBox(100, 300, 395.28, 260);

  return doc.save();
}

// 34: a small file to insert into another.
async function insertSource() {
  const doc = await newDoc('Insert me');
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const n of [1, 2]) framed(doc.addPage(A5), font, [`INSERTED ${n} of 2`, 'From 34-insert-me.pdf'], rgb(0.6, 0.4, 0.8));
  return doc.save();
}

// A small fixed pseudo-random sequence, so the file is the same every run.
function seeded(seed) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

// 35: content pages mixed with empty, nearly empty and scan-like pages.
async function blankPages() {
  const doc = await newDoc('Blank pages');
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const content = (n) => framed(doc.addPage(A4), font, [`Content page ${n}`, 'Keep this page']);

  content(1);
  doc.addPage(A4); // 2: completely empty
  content(3);
  // 4: one small stray dot, as if a pen touched the paper.
  doc.addPage(A4).drawCircle({ x: 300, y: 400, size: 2, color: rgb(0, 0, 0) });
  // 5: a blank page that went through a scanner: grey specks and a dark left edge.
  const scan = doc.addPage(A4);
  scan.drawRectangle({ x: 0, y: 0, width: 14, height: A4[1], color: rgb(0.25, 0.25, 0.25) });
  const rand = seeded(35);
  for (let i = 0; i < 40; i++) {
    scan.drawRectangle({ x: 40 + rand() * 515, y: 40 + rand() * 760, width: 3, height: 3, color: rgb(0.35, 0.35, 0.35) });
  }
  content(6);
  doc.addPage(A4); // 7: completely empty
  content(8);
  return doc.save();
}

export async function pageToolsTestFiles() {
  return [
    {
      name: '33-resize-sample.pdf',
      purpose: 'A5 page with a link box, Letter landscape, an A4 page turned 90° and a cropped A4 page: resize to A4 or Letter and check each fits, stays the right way up, and the link box moves with its text.',
      bytes: await resizeSample(),
    },
    { name: '34-insert-me.pdf', purpose: 'Two purple "INSERTED" pages: insert them into another PDF.', bytes: await insertSource() },
    {
      name: '35-blank-pages.pdf',
      purpose: 'Eight pages. Blank: 2 and 7 (empty), 4 (one stray dot), 5 (scanner specks and a dark edge). "Only completely empty" finds 2, 7; "a few stray marks" finds 2, 4, 7; "near-blank scans" finds 2, 4, 5, 7.',
      bytes: await blankPages(),
    },
  ];
}
