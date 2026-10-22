// The network watcher. Every browser test imports `test` from here instead
// of '@playwright/test', so every test (and so every tool) runs watched:
// - every request the page or its workers make is recorded, and the test
//   fails if any goes anywhere but the local app (blob: and data: are
//   in-memory, so they are fine);
// - every Content-Security-Policy violation is recorded, and the test fails
//   on any, because a violation means some code TRIED to reach out or run
//   something the CSP forbids, even though the CSP stopped it. (Violations
//   inside workers can't be listened to from the page; the CSP still blocks
//   them, and any request that does go out is caught by the first check.)
// tests/unit/e2e-watch.test.ts makes sure no spec file skips this.
import { test as base, expect } from '@playwright/test';
import { ORIGIN } from './helpers';

// The app's own offline self-check (src/core/security-status.ts) is meant
// to be blocked by the CSP; that violation is expected on every page load.
const SELF_CHECK = '/__ilmpdf_network_probe';

type Violation = { blockedURI: string; directive: string; source: string };

type WatchOptions = {
  /** Blocked URLs (substrings) a test provokes on purpose, e.g. to prove the CSP works. */
  expectedCspBlocks: string[];
};

export const test = base.extend<WatchOptions & { networkWatch: void }>({
  expectedCspBlocks: [[], { option: true }],
  networkWatch: [
    async ({ context, expectedCspBlocks }, use) => {
      const outside: string[] = [];
      const record = (url: string) => {
        if (!url.startsWith(`${ORIGIN}/`) && !url.startsWith('blob:') && !url.startsWith('data:')) outside.push(url);
      };
      // context-level events include requests from workers and every tab.
      context.on('request', (r) => record(r.url()));

      // Collected in each page (and each tab it opens); read back at the end.
      await context.addInitScript(() => {
        const list: Violation[] = [];
        (globalThis as unknown as { __ilmpdfCsp: Violation[] }).__ilmpdfCsp = list;
        document.addEventListener('securitypolicyviolation', (e) => {
          list.push({ blockedURI: e.blockedURI, directive: e.effectiveDirective, source: e.sourceFile });
        });
      });

      await use();

      const violations: Violation[] = [];
      for (const page of context.pages()) {
        if (page.isClosed()) continue;
        const found = await page
          .evaluate(() => (globalThis as unknown as { __ilmpdfCsp?: Violation[] }).__ilmpdfCsp ?? [])
          .catch(() => [] as Violation[]);
        violations.push(...found);
      }
      const unexpected = violations.filter(
        (v) => !v.blockedURI.includes(SELF_CHECK) && !expectedCspBlocks.some((b) => v.blockedURI.includes(b)),
      );
      expect(outside, 'requests that left the local app').toEqual([]);
      expect(unexpected, 'Content-Security-Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
