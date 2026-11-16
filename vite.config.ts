import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { experiences } from './src/hub/experiences';
import { itemListJsonLd, renderCards, sitemapPaths } from './src/hub/render';

/**
 * Canonical origin. Override with SITE_URL for previews/forks; defaults to the production domain.
 * It is injected into every page's canonical/Open Graph/JSON-LD, robots.txt, sitemap.xml and the manifest.
 */
const siteUrl = (process.env.SITE_URL ?? 'https://mr.mauricegarcia.com').replace(/\/$/, '');

function hubPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'mr-hub',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    transformIndexHtml: (html) => {
      const jsonLd = {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebSite',
            name: 'MR — Mixed Reality by Maurice Garcia',
            url: `${siteUrl}/`,
            description: 'Mixed-reality experiments by Maurice Garcia that run in your browser.',
            inLanguage: 'en',
            publisher: { '@type': 'Person', name: 'Maurice Garcia', url: 'https://mauricegarcia.com' },
          },
          itemListJsonLd(experiences, siteUrl),
        ],
      };
      return html
        .replaceAll('<!--EXPERIENCE_CARDS-->', renderCards(experiences))
        .replaceAll('__HUB_JSONLD__', JSON.stringify(jsonLd, null, 2).replaceAll('<', '\\u003c'))
        .replaceAll('__SITE_URL__', siteUrl);
    },
    generateBundle() {
      const urls = ['/', ...sitemapPaths(experiences)];
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u, i) => `  <url><loc>${siteUrl}${u === '/' ? '/' : u}</loc><changefreq>${i === 0 ? 'weekly' : 'monthly'}</changefreq><priority>${i === 0 ? '1.0' : '0.8'}</priority></url>`).join('\n')}
</urlset>
`;
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: xml });
    },
    closeBundle() {
      for (const f of ['robots.txt', 'site.webmanifest']) {
        const p = resolve(outDir, f);
        if (existsSync(p)) writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__SITE_URL__', siteUrl));
      }
    },
  };
}

export default defineConfig({
  plugins: [hubPlugin()],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      // multi-page: the hub at /, the REALMBREAK experience at /realmbreak
      input: {
        hub: resolve(__dirname, 'index.html'),
        realmbreak: resolve(__dirname, 'realmbreak/index.html'),
      },
    },
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
