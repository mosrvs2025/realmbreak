/** Dependency-free WebXR capability detection (kept out of the three.js chunk so the landing page stays tiny). */
export type SessionSupport = { ar: boolean; vr: boolean };

export async function detectXR(): Promise<SessionSupport> {
  const xr = navigator.xr;
  if (!xr) return { ar: false, vr: false };
  try {
    const [ar, vr] = await Promise.all([
      xr.isSessionSupported('immersive-ar').catch(() => false),
      xr.isSessionSupported('immersive-vr').catch(() => false),
    ]);
    return { ar, vr };
  } catch {
    return { ar: false, vr: false };
  }
}
