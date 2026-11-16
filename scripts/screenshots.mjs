#!/usr/bin/env node
/**
 * Captures README screenshots of the desktop fallback with Playwright.
 *
 *   npm run build && npm run screenshots
 *
 * The game exposes a scripted fast-forward (`/?scene=<phase>&t=<seconds>`) that plays the simulation with
 * scripted input until the requested scene, then freezes the frame so every capture is deterministic.
 * Env: BASE_URL (skip starting `vite preview`), CHROMIUM_PATH (use a specific browser binary).
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser, startPreview } from './lib.mjs';

const out = resolve(process.argv[2] ?? 'docs/screenshots');
mkdirSync(out, { recursive: true });

const scenes = [
  { file: '01-landing', url: '/', landing: true },
  { file: '02-teleport-in', url: '/?scene=intro&t=1.3' },
  { file: '03-taunt-and-orbs', url: '/?scene=intro&t=5.0' },
  { file: '04-charge', url: '/?scene=charge' },
  { file: '05-cracks', url: '/?scene=crack&t=2.1' },
  { file: '06-shatter', url: '/?scene=shatter&t=1.9' },
  { file: '07-arena', url: '/?scene=arena&t=3.6' },
  { file: '08-beam-clash', url: '/?scene=clash&t=3.0' },
  { file: '09-victory', url: '/?scene=win&t=4.0' },
];

const { base, stop } = await startPreview();
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
let failures = 0;
for (const s of scenes) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // /_vercel/* scripts only exist on Vercel, so 404s for them locally are expected
  page.on('response', (r) => r.status() >= 400 && !r.url().includes('/_vercel/') && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(base + s.url, { waitUntil: 'networkidle' });
  if (s.landing) await page.waitForTimeout(3600);
  else {
    await page.waitForFunction(() => window.__realmbreak, null, { timeout: 30000 });
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: `${out}/${s.file}.jpg`, type: 'jpeg', quality: 86 });
  console.log(`${errors.length ? '✗' : '✓'} ${s.file}${errors.length ? '  ' + errors.join(' | ') : ''}`);
  if (errors.length) failures++;
  await page.close();
}
await browser.close();
stop();
process.exit(failures ? 1 : 0);
