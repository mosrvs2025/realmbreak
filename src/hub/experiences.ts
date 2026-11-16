/**
 * The hub's catalogue. Add an experience by appending an entry here — the hub page, its JSON-LD
 * and the sitemap are all generated from this file at build time (see vite.config.ts).
 */
export type ExperienceStatus = 'live' | 'beta' | 'soon';

export interface Experience {
  /** URL-safe unique id (also used for analytics). */
  id: string;
  title: string;
  /** One-line hook shown under the title. */
  tagline: string;
  /** 1–2 sentences. */
  description: string;
  tags: string[];
  /** Internal path ("/realmbreak") or absolute URL. */
  href: string;
  status: ExperienceStatus;
  /** Card artwork. Omit to get a generated visual using `accent`. */
  image?: { src: string; alt: string; width: number; height: number };
  /** CSS colour used for the card glow / generated visual. */
  accent: string;
  /** Where it runs. */
  platforms: string[];
  /** Set false to keep a live entry out of the JSON-LD / sitemap. */
  indexable?: boolean;
}

export const experiences: Experience[] = [
  {
    id: 'realmbreak',
    title: 'REALMBREAK',
    tagline: 'Shatter your room. Win the beam clash.',
    description:
      'A villain teleports onto your real floor. Cup your hands to charge a blast, crack your room open and shatter it into a sunlit arena for a one-on-one beam clash.',
    tags: ['Hand tracking', 'Passthrough', 'Action', 'WebXR'],
    href: '/realmbreak',
    status: 'live',
    image: {
      src: '/cards/realmbreak.jpg',
      alt: 'A magenta energy beam clashing with a blue one in a sunlit stone arena, a dark armoured villain on the right',
      width: 800,
      height: 450,
    },
    accent: '#ff6535',
    platforms: ['Meta Quest', 'Desktop', 'Phone'],
  },
];

export const STATUS_LABEL: Record<ExperienceStatus, string> = {
  live: 'Live',
  beta: 'Beta',
  soon: 'Coming soon',
};
