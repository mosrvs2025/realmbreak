import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { mulberry32 } from '../core/math';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Soft radial gradient (alpha falloff) used for contact shadows and glows. */
export function radialTexture(stops: [number, string][] = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']], size = 128): CanvasTexture {
  const [c, g] = canvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** Sun-bleached stone tiles with grout lines and subtle wear. */
export function tileTexture(): CanvasTexture {
  const size = 512;
  const [c, g] = canvas(size, size);
  const rng = mulberry32(77);
  g.fillStyle = '#6f6a63';
  g.fillRect(0, 0, size, size);
  const n = 4;
  const cell = size / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = 178 + Math.floor(rng() * 30);
      g.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
      g.fillRect(i * cell + 3, j * cell + 3, cell - 6, cell - 6);
      // wear speckles
      for (let k = 0; k < 90; k++) {
        const a = rng() * 0.12;
        g.fillStyle = rng() < 0.5 ? `rgba(60,48,40,${a})` : `rgba(255,248,230,${a})`;
        g.fillRect(i * cell + rng() * cell, j * cell + rng() * cell, 2 + rng() * 6, 2 + rng() * 6);
      }
      // bevel highlight
      g.strokeStyle = 'rgba(255,250,235,0.35)';
      g.lineWidth = 2;
      g.strokeRect(i * cell + 4, j * cell + 4, cell - 8, cell - 8);
    }
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = LinearMipmapLinearFilter;
  return t;
}

/** Warm wooden planks for the simulated living-room floor. */
export function woodTexture(): CanvasTexture {
  const size = 512;
  const [c, g] = canvas(size, size);
  const rng = mulberry32(5);
  const planks = 8;
  const w = size / planks;
  for (let i = 0; i < planks; i++) {
    const base = 110 + Math.floor(rng() * 40);
    g.fillStyle = `rgb(${base},${Math.floor(base * 0.68)},${Math.floor(base * 0.42)})`;
    g.fillRect(i * w, 0, w, size);
    for (let k = 0; k < 40; k++) {
      g.strokeStyle = `rgba(40,20,8,${0.04 + rng() * 0.08})`;
      g.beginPath();
      const x = i * w + rng() * w;
      g.moveTo(x, 0);
      g.bezierCurveTo(x + 4, size * 0.3, x - 4, size * 0.6, x + 2, size);
      g.stroke();
    }
    g.fillStyle = 'rgba(20,10,4,0.55)';
    g.fillRect(i * w, 0, 2, size);
    g.fillRect(i * w, rng() * size, w, 2);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
