// Test files 40-41, for Greyscale / invert colours.
// Kept apart from make-test-pdfs.mjs, which lists them with the others.
// Like the rest, every file is built from scratch: nothing real, nothing downloaded.

import * as mupdf from 'mupdf';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const FIXED_DATE = new Date('2026-01-01T12:00:00Z');
const RED = rgb(0.85, 0.15, 0.15);
const GREEN = rgb(0.1, 0.65, 0.25);
const BLUE = rgb(0.15, 0.35, 0.9);

async function newDoc(title) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(title);
  doc.setProducer('ILMPDF test-file generator');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return doc;
}

// A colourful made-up "photo" (a rainbow gradient), as a JPEG.
function rainbowJpeg(width, height) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  const data = pix.getPixels();
  for (let y = 0, o = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = x / width;
      data[o++] = Math.round(255 * Math.max(0, 1 - 2 * t));
      data[o++] = Math.round(255 * (1 - Math.abs(2 * t - 1)));
      data[o++] = Math.round(255 * Math.max(0, 2 * t - 1) * (0.5 + y / height / 2));
    }
  }
  const bytes = new Uint8Array(pix.asJPEG(85));
  pix.destroy();
  return bytes;
}

// Coloured bands, coloured text and a colour picture on one page.
function colourPage(page, font, photo, label) {
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: BLUE });
  page.drawText(label, { x: 30, y: height - 58, size: 22, font, color: rgb(1, 1, 1) });
  page.drawText('Red text you can select', { x: 40, y: height - 140, size: 18, font, color: RED });
  page.drawText('Green text you can select', { x: 40, y: height - 170, size: 18, font, color: GREEN });
  page.drawText('Black text you can select', { x: 40, y: height - 200, size: 18, font, color: rgb(0, 0, 0) });
  page.drawImage(photo, { x: 40, y: height - 420, width: 240, height: 180 });
  page.drawCircle({ x: width - 120, y: height - 330, size: 70, color: rgb(0.95, 0.7, 0.1) });
  page.drawRectangle({ x: 40, y: 40, width: width - 80, height: 40, color: GREEN });
}

// 40: three pages: an upright A4 page, a landscape page turned 90 degrees,
// and a page whose crop box hides its outer edge.
async function colourfulPdf() {
  const doc = await newDoc('Colourful mixed');
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const photo = await doc.embedJpg(rainbowJpeg(240, 180));
  colourPage(doc.addPage(A4), font, photo, 'Page 1: upright');
  const turned = doc.addPage([A4[1], A4[0]]);
  colourPage(turned, font, photo, 'Page 2: turned 90 degrees');
  turned.setRotation(degrees(90));
  const cropped = doc.addPage(A4);
  colourPage(cropped, font, photo, 'Page 3: cropped');
  cropped.setCropBox(20, 20, A4[0] - 40, A4[1] - 40);
  return doc.save();
}

// 41: one colourful page with a filled-in form field, a yellow highlight and a
// red rectangle comment: "keep text" leaves those three in colour,
// "image-based" converts them too.
async function colourWithCommentsPdf() {
  const doc = await newDoc('Colour with comments');
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const photo = await doc.embedJpg(rainbowJpeg(240, 180));
  const page = doc.addPage(A4);
  colourPage(page, font, photo, 'Comments and a form field');
  const field = doc.getForm().createTextField('colour_name');
  field.setText('Blue field');
  field.addToPage(page, { x: 320, y: 300, width: 220, height: 30, backgroundColor: rgb(0.7, 0.85, 1), borderColor: BLUE, textColor: RED, font });

  const pdf = mupdf.Document.openDocument(await doc.save(), 'application/pdf').asPDF();
  try {
    const first = pdf.loadPage(0);
    // MuPDF coordinates: points from the top-left corner of the page.
    const highlight = first.createAnnotation('Highlight');
    highlight.setColor([1, 0.9, 0]);
    highlight.setQuadPoints([[38, 120, 300, 120, 38, 146, 300, 146]]);
    highlight.update();
    const square = first.createAnnotation('Square');
    square.setRect([310, 560, 550, 620]);
    square.setColor([0.9, 0, 0]);
    square.setBorderWidth(3);
    square.update();
    first.destroy();
    return new Uint8Array(pdf.saveToBuffer({ garbage: 'compact' }).asUint8Array());
  } finally {
    pdf.destroy();
  }
}

export async function recolorTestFiles() {
  return [
    {
      name: '40-colourful-mixed.pdf',
      purpose: 'Coloured text, shapes and a colour picture on an upright, a turned (90 degrees) and a cropped page: Greyscale and Invert should change all of each page, and in "Keep text" mode the text stays selectable.',
      bytes: await colourfulPdf(),
    },
    {
      name: '41-colour-with-comments.pdf',
      purpose: 'A colourful page with a filled-in form field, a yellow highlight and a red rectangle comment: "Keep text" leaves those three in colour, "Image-based" converts them too.',
      bytes: await colourWithCommentsPdf(),
    },
  ];
}
