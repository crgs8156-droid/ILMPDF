// A small, dependency-free ZIP writer for saving many results as one download.
//
// Files are "stored" (method 0, no compression): PDFs already compress their
// contents, so deflate would gain little and need far more code. The layout is
// the classic one from the ZIP spec (PKWARE APPNOTE 4.3):
//   [local header + name + data] for each file, then the central directory
//   (one entry per file), then the end-of-central-directory record.
// All numbers are little-endian. Everything happens in memory; nothing is
// written to disk or browser storage.

export type ZipEntry = { name: string; bytes: Uint8Array };

/** Stays well under the 4 GB limit of plain (non-ZIP64) archives, and kind to Safari's memory. */
export const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 1000;

const UTF8_NAMES = 0x0800; // general purpose flag bit 11: file names are UTF-8
const VERSION = 20; // "2.0", the version every unzip tool understands

// CRC-32 (the same checksum gzip and PNG use), one table lookup per byte.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP stores local time in MS-DOS format: 2-second steps, years 1980-2107. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Names go into the archive flat (no folders). Anything that could make an
 * unzip tool write outside its target folder is refused rather than fixed,
 * because callers are expected to pass names from safeFileName().
 */
function checkName(name: string): void {
  if (!name || name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(name) || name === '.' || name === '..') {
    throw new Error(`Unsafe file name for the ZIP: ${JSON.stringify(name)}`);
  }
}

/**
 * Makes names unique, ignoring case (the Mac's disk ignores case too):
 * "a.pdf", "a.pdf", "A.pdf" become "a.pdf", "a (2).pdf", "A (3).pdf".
 */
export function uniqueNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Builds a .zip as a Blob. The entries' bytes are referenced, not copied. */
export function makeZip(entries: ZipEntry[], modified = new Date()): Blob {
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error(`A ZIP can hold at most ${MAX_ZIP_ENTRIES} files here.`);
  const { time, date } = dosDateTime(modified);
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    checkName(entry.name);
    const name = encoder.encode(entry.name);
    const size = entry.bytes.length;
    const crc = crc32(entry.bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header signature
    local.setUint16(4, VERSION, true); // version needed to extract
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size
    local.setUint32(22, size, true); // uncompressed size
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // extra field length

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); // central directory header signature
    dir.setUint16(4, VERSION, true); // version made by
    dir.setUint16(6, VERSION, true); // version needed to extract
    dir.setUint16(8, UTF8_NAMES, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, size, true);
    dir.setUint32(24, size, true);
    dir.setUint16(28, name.length, true);
    // 30-41: extra length, comment length, disk number, internal and external attributes: all 0
    dir.setUint32(42, offset, true); // where this file's local header starts

    parts.push(new Uint8Array(local.buffer), name, entry.bytes);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + size;
    if (offset > MAX_ZIP_BYTES) throw new Error('The results are too large for one ZIP (over 2 GB). Try fewer files.');
  }

  const dirSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory signature
  // 4-7: this disk and the disk where the directory starts: 0
  end.setUint16(8, entries.length, true); // entries on this disk
  end.setUint16(10, entries.length, true); // entries in total
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true); // where the central directory starts
  // 20-21: comment length: 0

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as Uint8Array<ArrayBuffer>[], {
    type: 'application/zip',
  });
}
