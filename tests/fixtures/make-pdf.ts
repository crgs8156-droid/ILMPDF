// Generates tiny PDFs for tests so no real documents enter the repo.
// Page i is (200 + i) points wide, so tests can tell pages apart after
// reordering by reading the page widths back.

type Options = { encrypted?: boolean; truncate?: boolean };

export function makePdf(pageCount = 1, opts: Options = {}): Uint8Array {
  const objects: string[] = [];
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let i = 0; i < pageCount; i++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${200 + i} 300] >>`);
  }
  if (opts.encrypted) {
    objects.push('<< /Filter /Standard /V 2 /R 3 /Length 128 /P -4 /O (0123456789abcdef0123456789abcdef) /U (0123456789abcdef0123456789abcdef) >>');
  }

  const encrypt = opts.encrypted ? ` /Encrypt ${objects.length} 0 R /ID [(abcdefghijklmnop) (abcdefghijklmnop)]` : '';
  const bytes = serialize(objects, encrypt);
  return opts.truncate ? bytes.slice(0, Math.floor(bytes.length / 3)) : bytes;
}

/** Writes numbered objects (object 1 is the catalog) as a complete PDF file. */
function serialize(objects: string[], trailerExtra = ''): Uint8Array {
  let body = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailerExtra} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

function stream(dict: string, data: string): string {
  return `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
}

/**
 * Harmless stand-ins for the risky parts a hostile PDF can carry, so the
 * Remove scripts tool can be tested without real malware. The "scripts"
 * only call app.alert or print, and the launch actions name a program that
 * does not exist. One page, with the text "Hello sanitize".
 *
 * Expected counts: scripts 6, autoActions 1, openers 2, dataActions 1,
 * attachments 2, xfa 1. A web link and a link within the document are
 * also present and must be kept.
 */
export function makeScriptedPdf(): Uint8Array {
  const js = (code: string) => `<< /S /JavaScript /JS (${code}) >>`;
  const goPage = '<< /S /GoTo /D [3 0 R /Fit] >>';
  const link = (y: number, action: string) =>
    `<< /Type /Annot /Subtype /Link /Rect [20 ${y} 120 ${y + 20}] /Border [0 0 0] /A ${action} >>`;
  return serialize([
    // 1: catalog. Document scripts, an attached file, an open action that
    // chains into a script, a script on closing, and an XFA form.
    '<< /Type /Catalog /Pages 2 0 R /Names << /JavaScript 4 0 R /EmbeddedFiles 6 0 R >> /OpenAction 8 0 R' +
      ` /AA << /WC ${js('app.alert\\(1\\)')} >> /AcroForm << /Fields [12 0 R] /XFA 13 0 R >> >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    // 3: the page. On open it "launches a program"; on close it goes to page 1 (harmless, but automatic).
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Contents 16 0 R' +
      ' /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>' +
      ` /Annots [9 0 R 10 0 R 11 0 R 12 0 R 14 0 R 15 0 R] /AA << /O << /S /Launch /F (no-such-program) >> /C ${goPage} >> >>`,
    '<< /Names [(doc-script) 5 0 R] >>',
    js('this.print\\(\\)'),
    '<< /Names [(attached.txt) 7 0 R] >>',
    '<< /Type /Filespec /F (attached.txt) /UF (attached.txt) /EF << /F 17 0 R >> >>',
    `<< /S /GoTo /D [3 0 R /Fit] /Next ${js('app.alert\\(2\\)')} >>`,
    link(200, '<< /S /URI /URI (https://example.com/) >>'),
    link(170, '<< /S /URI /URI (javascript:app.alert\\(3\\)) >>'),
    link(140, goPage),
    // 12: a text field with keystroke and format scripts that submits its data.
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /Rect [20 100 120 120] /P 3 0 R' +
      ` /AA << /K ${js('1')} /F ${js('2')} >> /A << /S /SubmitForm /F (https://example.com/form) >> >>`,
    stream('', '<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"/>'),
    '<< /Type /Annot /Subtype /FileAttachment /Rect [20 70 40 90] /FS 18 0 R >>',
    link(40, '<< /S /Launch /F (no-such-program) >>'),
    stream('', 'BT /F1 12 Tf 20 260 Td (Hello sanitize) Tj ET'),
    stream('/Type /EmbeddedFile', 'attached file body'),
    // 18: a second attached file, shown as a paperclip on the page.
    '<< /Type /Filespec /F (paperclip.txt) /EF << /F 19 0 R >> >>',
    stream('/Type /EmbeddedFile', 'paperclip file body'),
  ]);
}

// A 2x2 red PNG, built by hand (valid zlib + CRCs) for image tests.
export const TINY_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP4z8DwnwGMgRQAH+4D/dJQfRoAAAAASUVORK5CYII=',
  ),
  (c) => c.charCodeAt(0),
);
