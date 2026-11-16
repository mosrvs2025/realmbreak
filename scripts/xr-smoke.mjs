#!/usr/bin/env node
/**
 * XR smoke test using Meta's Immersive Web Emulation Runtime (IWER) in headless Chromium.
 * Emulates a Quest 3 `immersive-ar` session with controllers and plays the whole fight with
 * trigger input: scan -> intro -> charge -> crack -> shatter -> arena -> clash -> result -> replay.
 * Fails on any page error. Not part of CI (software GL is slow); run it before releases:
 *
 *   npm run build && npm run test:xr
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launchBrowser, startPreview } from './lib.mjs';

const require = createRequire(import.meta.url);
const iwer = readFileSync(require.resolve('iwer/build/iwer.js'), 'utf8');
const { base, stop } = await startPreview(4181);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/404|Vercel/.test(m.text()) && errors.push(m.text()));
await page.addInitScript(
  iwer +
    `;(() => { const d = new IWER.XRDevice(IWER.metaQuest3); d.position.set(0, 1.6, 0); d.installRuntime({ forceInstall: true }); window.__dev = d; })();`,
);
await page.goto(`${base}/realmbreak`, { waitUntil: 'networkidle' });
await page.locator('#enter-ar').click();
await page.waitForFunction(() => window.__realmbreak?.renderer.xr.isPresenting, null, { timeout: 20000 });

const phase = () => page.evaluate(() => window.__realmbreak.phase);
const trigger = (v) => page.evaluate((v) => window.__dev.controllers.right.updateButtonValue('trigger', v), v);
const waitPhase = async (name, ms = 150000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && (await phase()) !== name) await page.waitForTimeout(250);
  if ((await phase()) !== name) throw new Error(`timed out waiting for phase "${name}" (stuck in "${await phase()}")`);
  console.log('✓ reached', name);
};
await waitPhase('charge');
await trigger(1);
await waitPhase('crack');
await trigger(0);
await waitPhase('shatter');
await waitPhase('arena');
await page.waitForTimeout(6000);
await trigger(1);
await page.waitForTimeout(150);
await trigger(0);
await waitPhase('clash');
for (let i = 0; i < 600 && (await phase()) === 'clash'; i++) {
  await trigger(1);
  await page.waitForTimeout(80);
  await trigger(0);
  await page.waitForTimeout(120);
}
const end = await phase();
if (end !== 'win') throw new Error(`expected a win from trigger mashing, got "${end}"`);
console.log('✓ reached win');
await page.waitForTimeout(5000);
await trigger(1);
await page.waitForTimeout(150);
await trigger(0);
await waitPhase('intro', 20000);
await browser.close();
stop();
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('XR smoke test passed');
