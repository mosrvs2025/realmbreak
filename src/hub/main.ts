import './hub.css';
import { inject, track } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';

// Privacy-friendly analytics + Core Web Vitals (no-ops in dev and until enabled in Vercel).
inject();
injectSpeedInsights();

const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());

// Which experience did people open? (aggregate only, no personal data)
document.addEventListener('click', (e) => {
  const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[data-exp]');
  if (a) track('hub_open', { experience: a.dataset.exp ?? 'unknown' });
});

// Gentle staggered entrance for the hero and cards. Content is visible without JS (static HTML),
// and prefers-reduced-motion users skip the animation entirely.
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduce && 'IntersectionObserver' in window) {
  const items = document.querySelectorAll<HTMLElement>('.hero > *, .section-head, .card-item, .about');
  items.forEach((el, i) => {
    el.classList.add('reveal');
    el.style.transitionDelay = `${Math.min(i, 8) * 60}ms`;
  });
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  items.forEach((el) => io.observe(el));
}
