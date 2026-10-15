export type SecurityStatus = {
  isolated: boolean;
  networkBlocked: boolean;
};

// Runs entirely on this machine. The probe targets this page's own origin,
// and the CSP (connect-src 'none') stops it before any request is made.
export async function readSecurityStatus(): Promise<SecurityStatus> {
  let networkBlocked = false;
  try {
    await fetch('/__ilmpdf_network_probe', { cache: 'no-store' });
  } catch {
    networkBlocked = true;
  }
  return { isolated: globalThis.crossOriginIsolated === true, networkBlocked };
}
