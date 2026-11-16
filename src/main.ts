import './style.css';
import { inject, track } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';
import { detectXR } from './xr/support';
import type { Game } from './game/game';
import type { Phase } from './core/machine';

// Production polish: privacy-friendly analytics + Core Web Vitals. Both no-op in dev.
inject();
injectSpeedInsights();

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const landing = $('landing');
const stage = $('stage');
const playBtn = $<HTMLButtonElement>('play');
const arBtn = $<HTMLButtonElement>('enter-ar');
const status = $('status');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let game: Game | null = null;
let loading = false;

const loadGame = () => import('./game/game');
// warm the heavy chunk while the visitor reads the page, so the click handler stays inside the user-activation window
const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1200));
idle(() => void loadGame());
for (const b of [playBtn, arBtn]) b.addEventListener('pointerenter', () => void loadGame(), { once: true });

function show(playing: boolean): void {
  document.body.classList.toggle('playing', playing);
  landing.toggleAttribute('hidden', playing);
  stage.toggleAttribute('hidden', !playing);
}

function setStatus(msg: string): void {
  status.textContent = msg;
}

async function launch(mode: 'xr' | 'desktop'): Promise<void> {
  if (loading) return;
  loading = true;
  playBtn.disabled = arBtn.disabled = true;
  setStatus(mode === 'xr' ? 'Starting AR session…' : 'Loading…');
  try {
    const { Game } = await loadGame();
    game?.dispose();
    game = new Game({
      parent: stage,
      reducedMotion,
      onExit: () => {
        game?.dispose();
        game = null;
        show(false);
        setStatus('');
      },
      onEvent: (name, data) => {
        // anonymous, aggregate-only product analytics (no personal data)
        if (name === 'run_start' || name === 'result' || name === 'replay') track(name, data ?? {});
      },
    });
    show(true);
    if (mode === 'xr') await game.startXR();
    else await game.startDesktop();
    setStatus('');
    const dbg = new URLSearchParams(location.search);
    if (dbg.has('scene') && mode === 'desktop') {
      game.seek(dbg.get('scene') as Phase, Number(dbg.get('t') ?? 0.5), dbg.get('result') === 'lose' ? 'lose' : 'win', dbg.get('freeze') !== '0');
    }
    (window as unknown as { __realmbreak?: Game }).__realmbreak = game;
  } catch (err) {
    console.error(err);
    game?.dispose();
    game = null;
    show(false);
    setStatus(mode === 'xr' ? 'Could not start an AR session on this device. Try “Play on this screen”.' : 'Could not start the game on this browser.');
  } finally {
    loading = false;
    playBtn.disabled = arBtn.disabled = false;
  }
}

playBtn.addEventListener('click', () => void launch('desktop'));
arBtn.addEventListener('click', () => void launch('xr'));

void detectXR().then((s) => {
  if (s.ar) {
    arBtn.hidden = false;
    playBtn.classList.remove('primary');
    arBtn.classList.add('primary');
    arBtn.focus({ preventScroll: true });
  }
});

// debug/screenshot entry: /?scene=clash auto-starts the desktop fallback fast-forwarded to that scene
if (new URLSearchParams(location.search).has('scene')) void launch('desktop');
