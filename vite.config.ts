import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * The canonical site URL is injected at build time (SITE_URL, or Vercel's production domain)
 * into index.html, robots.txt and sitemap.xml so previews/forks never point at the wrong domain.
 */
const siteUrl = (
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://realmbreak.vercel.app')
).replace(/\/$/, '');

function siteUrlPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'realmbreak-site-url',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', siteUrl),
    closeBundle() {
      for (const f of ['robots.txt', 'sitemap.xml', 'site.webmanifest']) {
        const p = resolve(outDir, f);
        if (existsSync(p)) writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__SITE_URL__', siteUrl));
      }
    },
  };
}

export default defineConfig({
  plugins: [siteUrlPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
