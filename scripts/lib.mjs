import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

/** Start `vite preview` (needs a prior `npm run build`) unless BASE_URL is provided. */
export async function startPreview(port = 4179) {
  if (process.env.BASE_URL) return { base: process.env.BASE_URL, stop() {} };
  const base = `http://localhost:${port}`;
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { base, stop: () => server.kill() };
}

/** Headless Chromium with software WebGL so the 3D scenes render on CI / containers. */
export function launchBrowser() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-webgl'],
  });
}
