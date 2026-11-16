import { describe, expect, it } from 'vitest';
import { experiences } from '../src/hub/experiences';
import { esc, itemListJsonLd, renderCard, renderCards, sitemapPaths } from '../src/hub/render';

describe('experiences data', () => {
  it('has unique ids and required fields', () => {
    const ids = new Set(experiences.map((e) => e.id));
    expect(ids.size).toBe(experiences.length);
    for (const e of experiences) {
      expect(e.id).toMatch(/^[a-z0-9-]+$/);
      for (const k of ['title', 'tagline', 'description', 'href', 'accent'] as const) expect(e[k].length).toBeGreaterThan(0);
      expect(e.tags.length).toBeGreaterThan(0);
      expect(e.platforms.length).toBeGreaterThan(0);
      expect(['live', 'beta', 'soon']).toContain(e.status);
      expect(e.href.startsWith('/') || /^https?:\/\//.test(e.href)).toBe(true);
    }
  });
  it('includes REALMBREAK at /realmbreak', () => {
    expect(experiences.find((e) => e.id === 'realmbreak')?.href).toBe('/realmbreak');
  });
});

describe('render', () => {
  it('escapes HTML', () => {
    expect(esc(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
  it('renders a live card as a link and a soon card as a disabled block', () => {
    const base = { ...experiences[0] };
    expect(renderCard(base)).toContain('<a class="card status-live"');
    expect(renderCard(base)).toContain('href="/realmbreak"');
    const soon = renderCard({ ...base, status: 'soon', image: undefined });
    expect(soon).toContain('<div class="card status-soon"');
    expect(soon).toContain('aria-disabled="true"');
    expect(soon).not.toContain('href=');
  });
  it('does not let titles inject markup', () => {
    expect(renderCards([{ ...experiences[0], title: '<script>x</script>' }])).not.toContain('<script>');
  });
  it('builds JSON-LD and sitemap paths from live entries only', () => {
    const list = [experiences[0], { ...experiences[0], id: 'later', status: 'soon' as const, href: '/later' }];
    const ld = itemListJsonLd(list, 'https://mr.mauricegarcia.com') as { itemListElement: { url: string }[] };
    expect(ld.itemListElement).toHaveLength(1);
    expect(ld.itemListElement[0].url).toBe('https://mr.mauricegarcia.com/realmbreak');
    expect(sitemapPaths(list)).toEqual(['/realmbreak']);
  });
});
