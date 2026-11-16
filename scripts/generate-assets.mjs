#!/usr/bin/env node
/**
 * Generates every raster brand asset from source art — nothing is hand-exported:
 *   public/favicon-mr.svg (hand-written SVG) -> favicon-32.png, favicon.ico, apple-touch-icon.png,
 *                                            icon-192.png, icon-512.png, icon-maskable-512.png
 *   public/og-image.png (1200x630)        -> a real render of the game's beam clash + title overlay
 *
 *   npm run build && npm run assets
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser, startPreview } from './lib.mjs';

const pub = resolve('public');
// site-level icons (favicon.ico, apple-touch, manifest icons) use the hub's MR mark
const svg = readFileSync(resolve(pub, 'favicon-mr.svg'), 'utf8');
const { base, stop } = await startPreview();
const browser = await launchBrowser();

/** Render the logo on a square canvas. `pad` shrinks the mark (maskable safe zone), `round` rounds the tile. */
async function icon(file, size, { pad = 0, round = false } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const inner = svg.replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">`);
  await page.setContent(
    `<body style="margin:0;background:#05070d"><div style="width:${size}px;height:${size}px;display:grid;place-items:center;${round ? `border-radius:${size * 0.22}px;overflow:hidden;` : ''}"><div style="width:${size * (1 - pad * 2)}px;height:${size * (1 - pad * 2)}px">${inner.replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"')}</div></div></body>`,
  );
  const buf = await page.screenshot({ type: 'png', omitBackground: round });
  writeFileSync(resolve(pub, file), buf);
  await page.close();
  return buf;
}

const ico = await icon('favicon-32.png', 32);
await icon('apple-touch-icon.png', 180);
await icon('icon-192.png', 192, { round: true });
await icon('icon-512.png', 512, { round: true });
await icon('icon-maskable-512.png', 512, { pad: 0.14 });

// favicon.ico = ICONDIR + one PNG-compressed 32x32 image
const hdr = Buffer.alloc(22);
hdr.writeUInt16LE(0, 0);
hdr.writeUInt16LE(1, 2);
hdr.writeUInt16LE(1, 4);
hdr.writeUInt8(32, 6);
hdr.writeUInt8(32, 7);
hdr.writeUInt16LE(1, 10);
hdr.writeUInt16LE(32, 12);
hdr.writeUInt32LE(ico.length, 14);
hdr.writeUInt32LE(22, 18);
writeFileSync(resolve(pub, 'favicon.ico'), Buffer.concat([hdr, ico]));

// --- Open Graph image: capture the real beam clash, then lay the brand over it
const shot = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await shot.goto(`${base}/realmbreak/?scene=clash&t=3`, { waitUntil: 'networkidle' });
await shot.waitForFunction(() => window.__realmbreak, null, { timeout: 30000 });
await shot.evaluate(() => {
  const g = window.__realmbreak;
  g.hint.visible = g.speech.visible = false; // clean frame: no UI text
  g.renderer.render(g.scene, g.camera);
});
const bg = (await shot.screenshot({ type: 'jpeg', quality: 90 })).toString('base64');
await shot.close();

const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await og.setContent(`<!doctype html><body style="margin:0;width:1200px;height:630px;position:relative;overflow:hidden;font-family:Inter,'Segoe UI',system-ui,sans-serif;background:#05070d">
  <img src="data:image/jpeg;base64,${bg}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:saturate(1.25) contrast(1.05)">
  <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,7,13,.94) 0%,rgba(5,7,13,.78) 38%,rgba(5,7,13,.1) 72%),linear-gradient(0deg,rgba(5,7,13,.7),transparent 40%)"></div>
  <div style="position:absolute;left:72px;top:150px;color:#fff">
    <div style="letter-spacing:.34em;font-size:20px;font-weight:700;color:#9db0c9;margin-bottom:14px">MIXED REALITY &middot; WEBXR</div>
    <div style="font-size:132px;font-weight:900;line-height:.92;letter-spacing:.01em;text-shadow:0 0 40px rgba(56,182,255,.55)">
      <span style="background:linear-gradient(180deg,#fff 10%,#9fdcff 60%,#3a7bff);-webkit-background-clip:text;color:transparent">REALM</span><br>
      <span style="background:linear-gradient(180deg,#fff 0%,#ffb3c6 50%,#ff3d6e);-webkit-background-clip:text;color:transparent">BREAK</span>
    </div>
    <div style="margin-top:26px;font-size:34px;font-weight:600;color:#dbe8fa;max-width:560px;line-height:1.25">Shatter your room.<br>Win the beam clash.</div>
    <div style="margin-top:28px;display:inline-block;padding:10px 20px;border-radius:999px;border:2px solid rgba(56,182,255,.7);color:#bfe6ff;font-size:22px;font-weight:700;background:rgba(10,20,40,.6)">Meta Quest &middot; hand tracking &middot; free in your browser</div>
  </div></body>`);
await og.waitForTimeout(300);
writeFileSync(resolve(pub, 'og-image.png'), await og.screenshot({ type: 'png' }));

// hub card thumbnail (800x450 JPEG) from the same clash capture
const card = await browser.newPage({ viewport: { width: 800, height: 450 } });
await card.setContent(`<body style="margin:0"><img src="data:image/jpeg;base64,${bg}" style="width:800px;height:450px;object-fit:cover;display:block"></body>`);
writeFileSync(resolve(pub, 'cards/realmbreak.jpg'), await card.screenshot({ type: 'jpeg', quality: 82 }));

// --- Open Graph image for the hub (rust on black, perspective grid)
const hub = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await hub.setContent(`<!doctype html><body style="margin:0;width:1200px;height:630px;position:relative;overflow:hidden;background:#0c0a09;color:#f3ece6;font-family:'Instrument Sans',Inter,system-ui,sans-serif">
  <div style="position:absolute;inset:0;background:radial-gradient(60% 70% at 75% 15%,rgba(255,101,53,.38),transparent 70%)"></div>
  <div style="position:absolute;left:-40%;right:-40%;bottom:-8%;height:62%;background-image:linear-gradient(rgba(255,101,53,.5) 2px,transparent 2px),linear-gradient(90deg,rgba(255,101,53,.5) 2px,transparent 2px);background-size:80px 80px;transform:perspective(520px) rotateX(62deg);transform-origin:50% 100%;-webkit-mask-image:linear-gradient(to top,#000,transparent 85%)"></div>
  <div style="position:absolute;left:80px;top:96px">
    <div style="letter-spacing:.2em;font-size:22px;color:#ff8a5c;font-weight:600">MIXED REALITY &middot; WEBXR</div>
    <div style="font-family:Fraunces,'Iowan Old Style',Georgia,serif;font-size:210px;font-weight:600;letter-spacing:-.04em;line-height:1;margin-top:8px">MR<span style="color:#ff6535">.</span></div>
    <div style="font-family:Fraunces,Georgia,serif;font-size:50px;margin-top:6px">by Maurice Garcia</div>
    <div style="margin-top:28px;font-size:28px;color:#cfc6be">Play in your living room &middot; Quest, desktop &amp; phone</div>
  </div></body>`);
await hub.waitForTimeout(300);
writeFileSync(resolve(pub, 'og-hub.png'), await hub.screenshot({ type: 'png' }));
await browser.close();
stop();
console.log('assets written to public/');
