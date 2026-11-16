import { type Experience, STATUS_LABEL } from './experiences';

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const isExternal = (href: string): boolean => /^https?:\/\//.test(href);

/** Static HTML for one card — rendered at build time so the hub works (and is indexable) without JS. */
export function renderCard(e: Experience, index = 0): string {
  const external = isExternal(e.href);
  const visual = e.image
    ? `<img class="card-img" src="${esc(e.image.src)}" alt="${esc(e.image.alt)}" width="${e.image.width}" height="${e.image.height}" loading="${index === 0 ? 'eager' : 'lazy'}" decoding="async" />`
    : `<div class="card-gen" aria-hidden="true"><span>${esc(e.title.slice(0, 1))}</span></div>`;
  const interactive = e.status !== 'soon';
  const tag = interactive ? 'a' : 'div';
  const attrs = interactive
    ? ` href="${esc(e.href)}"${external ? ' rel="noopener" target="_blank"' : ''} data-exp="${esc(e.id)}"`
    : ' aria-disabled="true"';
  return `<li class="card-item">
        <${tag} class="card status-${e.status}" style="--accent:${esc(e.accent)}"${attrs}>
          <div class="card-visual">${visual}<span class="pill pill-${e.status}">${STATUS_LABEL[e.status]}</span></div>
          <div class="card-body">
            <h3>${esc(e.title)}</h3>
            <p class="tagline">${esc(e.tagline)}</p>
            <p class="desc">${esc(e.description)}</p>
            <ul class="tags" aria-label="Tags">${e.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
            <p class="meta"><span>${e.platforms.map(esc).join(' · ')}</span>${interactive ? '<span class="open">Open <i aria-hidden="true">&rarr;</i></span>' : ''}</p>
          </div>
        </${tag}>
      </li>`;
}

export const renderCards = (list: Experience[]): string => list.map((e, i) => renderCard(e, i)).join('\n      ');

/** schema.org ItemList describing the hub's experiences. */
export function itemListJsonLd(list: Experience[], siteUrl: string): object {
  const items = list.filter((e) => e.status !== 'soon' && e.indexable !== false);
  return {
    '@type': 'ItemList',
    itemListElement: items.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: isExternal(e.href) ? e.href : siteUrl + e.href,
      name: e.title,
    })),
  };
}

export const sitemapPaths = (list: Experience[]): string[] =>
  list.filter((e) => e.status !== 'soon' && e.indexable !== false && !isExternal(e.href)).map((e) => e.href);
