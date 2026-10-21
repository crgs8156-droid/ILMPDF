// A tiny ZIP reader for tests: walks the central directory the way unzip
// tools do and checks each local header, so a broken archive fails loudly.
export type ZipFile = { name: string; flags: number; method: number; crc: number; data: Uint8Array };

export function readZip(zip: Uint8Array): ZipFile[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  const need = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`Bad ZIP: ${what}`);
  };
  need(end >= 0 && view.getUint32(end, true) === 0x06054b50, 'end record');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: ZipFile[] = [];
  for (let i = 0; i < count; i++) {
    need(view.getUint32(at, true) === 0x02014b50, 'central directory entry');
    const nameLen = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    need(view.getUint32(local, true) === 0x04034b50, 'local header');
    const size = view.getUint32(at + 24, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out.push({
      name: new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen)),
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      data: zip.subarray(start, start + size),
    });
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return out;
}
