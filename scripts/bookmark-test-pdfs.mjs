// Test files 38 and 39 for the Bookmarks tool, used by make-test-pdfs.mjs.
// Bookmarks are written by hand (pdf-lib has no bookmark API), so the
// tricky file can contain things a normal app would never write.
import { PDFDict, PDFHexString, PDFName, PDFNumber, PDFString, StandardFonts, rgb } from 'pdf-lib';

const LETTER = [612, 792];

/**
 * Links a list of bookmark objects (and their children) into the PDF:
 * items are { title, page (0-based) or dest or action, kids }.
 */
function writeOutline(doc, items) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const root = ctx.nextRef();
  const build = (list, parent) => {
    const refs = list.map(() => ctx.nextRef());
    let shown = 0;
    list.forEach((item, i) => {
      const dict = { Title: /[^\x20-\x7e]/.test(item.title) ? PDFHexString.fromText(item.title) : PDFString.of(item.title), Parent: parent };
      if (i > 0) dict.Prev = refs[i - 1];
      if (i < list.length - 1) dict.Next = refs[i + 1];
      if (item.page !== undefined) dict.Dest = item.dest ?? ctx.obj([pages[item.page].ref, PDFName.of('Fit')]);
      else if (item.dest) dict.Dest = item.dest;
      if (item.action) dict.A = item.action;
      const kids = item.kids ?? [];
      if (kids.length > 0) {
        const below = build(kids, refs[i]);
        dict.First = below.first;
        dict.Last = below.last;
        dict.Count = item.closed ? -below.shown : below.shown;
        if (!item.closed) shown += below.shown;
      }
      shown += 1;
      ctx.assign(refs[i], ctx.obj(dict));
    });
    return { first: refs[0], last: refs[refs.length - 1], shown, refs };
  };
  const top = build(items, root);
  ctx.assign(root, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.shown }));
  doc.catalog.set(PDFName.of('Outlines'), root);
  return top.refs;
}

async function labelledPages(doc, labels) {
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  labels.forEach((label, i) => {
    const page = doc.addPage(LETTER);
    page.drawRectangle({ x: 0, y: 702, width: 612, height: 90, color: rgb(0.27, 0.55, 0.85) });
    page.drawText(label, { x: 30, y: 734, size: 22, font, color: rgb(1, 1, 1) });
    page.drawText(`Page ${i + 1} of ${labels.length}`, { x: 30, y: 30, size: 12, font, color: rgb(0.3, 0.3, 0.3) });
  });
}

// 38: a cover page, then three chapters with sections, then an appendix.
export async function chaptersPdf(newDoc) {
  const doc = await newDoc('Bookmarks: chapters');
  await labelledPages(doc, [
    'Cover (no bookmark)',
    'Chapter 1: Introduction',
    '1.1 Background',
    '1.2 Goals',
    'Chapter 2: Method',
    '2.1 Data',
    '2.1.1 Sources',
    '2.2 Analysis',
    'Chapter 3: Results',
    '3.1 Tables',
    '3.2 Charts',
    'Appendix',
  ]);
  const p = doc.getPages();
  // One bookmark jumps to a spot part way down its page (/XYZ left top zoom),
  // so saving can be checked to keep the exact spot.
  const spot = doc.context.obj([p[3].ref, PDFName.of('XYZ'), PDFNumber.of(0), PDFNumber.of(400), PDFNumber.of(0)]);
  writeOutline(doc, [
    { title: 'Chapter 1: Introduction', page: 1, kids: [{ title: '1.1 Background', page: 2 }, { title: '1.2 Goals', page: 3, dest: spot }] },
    {
      title: 'Chapter 2: Method',
      page: 4,
      kids: [{ title: '2.1 Data', page: 5, kids: [{ title: '2.1.1 Sources', page: 6 }] }, { title: '2.2 Analysis', page: 7 }],
    },
    { title: 'Chapter 3: Results', page: 8, closed: true, kids: [{ title: '3.1 Tables', page: 9 }, { title: '3.2 Charts', page: 10 }] },
    { title: 'Appendix', page: 11 },
  ]);
  return doc.save();
}

// 39: bookmarks out of page order, ones that go nowhere (web link, script,
// broken target), a named destination, odd titles, and a list that loops
// back on itself. ILMPDF should show them safely and never run anything.
export async function trickyPdf(newDoc) {
  const doc = await newDoc('Bookmarks: tricky');
  await labelledPages(doc, ['Page one', 'Page two', 'Page three', 'Page four', 'Page five', 'Page six']);
  const ctx = doc.context;
  const p = doc.getPages();
  const names = ctx.obj({ Names: [PDFString.of('chapter-four'), ctx.obj([p[3].ref, PDFName.of('Fit')])] });
  doc.catalog.set(PDFName.of('Names'), ctx.obj({ Dests: names }));
  const refs = writeOutline(doc, [
    { title: 'Out of order: page 5', page: 4 },
    { title: 'Back to page 2', page: 1 },
    { title: 'Web link (goes nowhere in this file)', action: ctx.obj({ S: 'URI', URI: PDFString.of('https://example.com/') }) },
    { title: 'Runs a script (should never run)', action: ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("bookmark script ran")') }) },
    { title: '<img src=x onerror=alert(1)> on page 3', page: 2 },
    { title: `Very long title ${'and longer '.repeat(60)}end`, page: 3 },
    { title: 'Named destination (page 4)', dest: PDFString.of('chapter-four') },
    { title: 'Broken target: page 1000', dest: ctx.obj([PDFNumber.of(999), PDFName.of('Fit')]) },
    { title: 'Broken target: not a page', dest: ctx.obj([ctx.register(ctx.obj({ Type: 'NotAPage' })), PDFName.of('Fit')]) },
    { title: 'Broken target: unknown name', dest: PDFString.of('no-such-place') },
    { title: 'Hidden ‮reversed‬ text and a\ttab', page: 5 },
  ]);
  // The last bookmark's "next" points back to the first: a loop.
  ctx.lookup(refs[refs.length - 1], PDFDict).set(PDFName.of('Next'), refs[0]);
  return doc.save();
}
