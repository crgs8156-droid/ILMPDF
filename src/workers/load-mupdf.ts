// Loads MuPDF (WebAssembly) inside a worker without any network request.
//
// MuPDF normally downloads its .wasm file at startup, which our CSP blocks
// (connect-src 'none'). Instead the .wasm is bundled into the worker as
// base64 and handed to MuPDF through Emscripten's documented `wasmBinary`
// option, so nothing is ever fetched.
import wasmBase64 from '../../node_modules/mupdf/dist/mupdf-wasm.wasm?b64';

export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function loadMupdf() {
  (globalThis as Record<string, unknown>)['$libmupdf_wasm_Module'] = {
    wasmBinary: base64ToBytes(wasmBase64),
    // If MuPDF ever asks for a file URL anyway, give it nothing useful.
    locateFile: () => 'data:,',
  };
  return import('mupdf');
}
