import { describe, expect, it } from 'vitest';
import { checkFileMeta, formatBytes, hasPdfHeader, safeFileName } from '../../src/core/validate';
import { makePdf } from '../fixtures/make-pdf';

describe('hasPdfHeader', () => {
  it('accepts a generated PDF', () => {
    expect(hasPdfHeader(makePdf(2))).toBe(true);
  });
  it('accepts a header after leading junk within 1024 bytes', () => {
    const junk = new Uint8Array(100).fill(0x20);
    const pdf = makePdf();
    const joined = new Uint8Array(junk.length + pdf.length);
    joined.set(junk);
    joined.set(pdf, junk.length);
    expect(hasPdfHeader(joined)).toBe(true);
  });
  it('rejects non-PDF bytes and empty input', () => {
    expect(hasPdfHeader(new TextEncoder().encode('<html>not a pdf</html>'))).toBe(false);
    expect(hasPdfHeader(new Uint8Array())).toBe(false);
  });
});

describe('checkFileMeta', () => {
  it('rejects wrong extension, empty and oversized files', () => {
    expect(checkFileMeta('a.exe', 10).ok).toBe(false);
    expect(checkFileMeta('a.pdf', 0).ok).toBe(false);
    expect(checkFileMeta('a.pdf', 600 * 1024 * 1024).ok).toBe(false);
    expect(checkFileMeta('A.PDF', 10).ok).toBe(true);
  });
});

describe('safeFileName', () => {
  it('strips path separators, control characters and leading dots', () => {
    expect(safeFileName('../../etc/passwd.pdf')).toBe('_.._etc_passwd.pdf');
    expect(safeFileName('a\u0000b<c>.pdf', '-x')).toBe('a_b_c_-x.pdf');
    expect(safeFileName('.pdf')).toBe('document.pdf');
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
  });
});

describe('security headers', () => {
  it('production CSP blocks all network connections', async () => {
    const { PROD_CSP, prodHeaders } = await import('../../security-headers');
    expect(PROD_CSP).toContain("connect-src 'none'");
    expect(PROD_CSP).not.toContain('unsafe-inline');
    expect(PROD_CSP).not.toMatch(/'unsafe-eval'/);
    expect(PROD_CSP).not.toMatch(/https?:/);
    const h = prodHeaders();
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['Cross-Origin-Embedder-Policy']).toBe('require-corp');
  });
});
