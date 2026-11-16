/**
 * Procedural crack networks + shard tessellation for the "realm break".
 * Everything here is pure geometry (no three.js) so it can be tested and reused for any surface:
 * the room-sized shell, detected planes, or (future) meshes.
 */
import { type Rng, type V3, add, clamp, cross, normalize, range, scale, sub, v3 } from './math';

export interface Surface {
  /** A point on the surface (2D origin). */
  origin: V3;
  /** Orthonormal in-plane axes. */
  u: V3;
  v: V3;
  /** Unit normal (pointing into the room for the shell). */
  normal: V3;
  /** Outline in (u,v) coordinates, counter-clockwise. */
  polygon: [number, number][];
}

export interface Box {
  center: V3;
  half: V3;
}

export interface Segment {
  a: V3;
  b: V3;
  /** half-width in metres */
  w: number;
}

export const toWorld = (s: Surface, x: number, y: number): V3 =>
  add(s.origin, add(scale(s.u, x), scale(s.v, y)));

export function pointInPolygon(poly: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(a) / 2;
}

const rect = (hu: number, hv: number): [number, number][] => [
  [-hu, -hv],
  [hu, -hv],
  [hu, hv],
  [-hu, hv],
];

/** The six inner faces of an axis-aligned room box. Normals point into the room. */
export function boxSurfaces(box: Box): Surface[] {
  const { center: c, half: h } = box;
  const X = v3(1, 0, 0);
  const Y = v3(0, 1, 0);
  const Z = v3(0, 0, 1);
  const face = (origin: V3, u: V3, v: V3, n: V3, hu: number, hv: number): Surface => ({
    origin,
    u,
    v,
    normal: n,
    polygon: rect(hu, hv),
  });
  return [
    face(v3(c.x, c.y - h.y, c.z), X, Z, Y, h.x, h.z), // floor
    face(v3(c.x, c.y + h.y, c.z), X, Z, scale(Y, -1), h.x, h.z), // ceiling
    face(v3(c.x - h.x, c.y, c.z), Z, Y, X, h.z, h.y), // -x wall
    face(v3(c.x + h.x, c.y, c.z), Z, Y, scale(X, -1), h.z, h.y), // +x wall
    face(v3(c.x, c.y, c.z - h.z), X, Y, Z, h.x, h.y), // -z wall
    face(v3(c.x, c.y, c.z + h.z), X, Y, scale(Z, -1), h.x, h.y), // +z wall
  ];
}

/** A surface from a detected plane: polygon given in plane-local (x, z) like WebXR XRPlane.polygon. */
export function planeSurface(origin: V3, u: V3, v: V3, polygonXZ: [number, number][]): Surface {
  return { origin, u, v, normal: normalize(cross(u, v)), polygon: polygonXZ };
}

export interface CrackOptions {
  /** seeds per square metre */
  density: number;
  maxSegments: number;
  stepMin: number;
  stepMax: number;
  maxSteps: number;
  branchChance: number;
  /** half-width of the root of a crack, metres */
  width: number;
  /** push ribbons slightly off the surface to avoid z-fighting */
  lift: number;
}

export const DEFAULT_CRACKS: CrackOptions = {
  density: 0.55,
  maxSegments: 260,
  stepMin: 0.12,
  stepMax: 0.34,
  maxSteps: 16,
  branchChance: 0.2,
  width: 0.022,
  lift: 0.012,
};

export function generateCracks(
  s: Surface,
  rng: Rng,
  opts: Partial<CrackOptions> = {},
): Segment[] {
  const o = { ...DEFAULT_CRACKS, ...opts };
  const out: Segment[] = [];
  const xs = s.polygon.map((p) => p[0]);
  const ys = s.polygon.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const area = polygonArea(s.polygon);
  const seeds = Math.max(2, Math.round(area * o.density));
  const lift = scale(s.normal, o.lift);

  const walk = (x: number, y: number, ang: number, steps: number, width: number, depth: number): void => {
    for (let i = 0; i < steps && out.length < o.maxSegments; i++) {
      const len = range(rng, o.stepMin, o.stepMax);
      ang += range(rng, -0.55, 0.55);
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      if (!pointInPolygon(s.polygon, nx, ny)) {
        // clamp the last piece to the boundary so cracks "hit" the edges of the surface
        break;
      }
      out.push({ a: add(toWorld(s, x, y), lift), b: add(toWorld(s, nx, ny), lift), w: width });
      x = nx;
      y = ny;
      width *= 0.93;
      if (depth < 2 && rng() < o.branchChance) {
        walk(x, y, ang + (rng() < 0.5 ? -1 : 1) * range(rng, 0.5, 1.2), Math.floor(steps * 0.55) - i, width * 0.75, depth + 1);
      }
    }
  };

  for (let k = 0; k < seeds && out.length < o.maxSegments; k++) {
    let x = 0;
    let y = 0;
    let ok = false;
    for (let tries = 0; tries < 12 && !ok; tries++) {
      x = range(rng, minX, maxX);
      y = range(rng, minY, maxY);
      ok = pointInPolygon(s.polygon, x, y);
    }
    if (!ok) continue;
    const ang = range(rng, 0, Math.PI * 2);
    walk(x, y, ang, o.maxSteps, o.width, 0);
    walk(x, y, ang + Math.PI, Math.floor(o.maxSteps * 0.7), o.width * 0.9, 0);
  }
  return out;
}

export interface RibbonArrays {
  position: Float32Array;
  /** -1..1 across the ribbon */
  side: Float32Array;
  /** crack half-width factor used by the shader for glow strength */
  glow: Float32Array;
  index: Uint32Array;
}

/** Turn crack segments into camera-independent quad ribbons lying on their surface. */
export function ribbonArrays(segs: { seg: Segment; normal: V3 }[]): RibbonArrays {
  const n = segs.length;
  const position = new Float32Array(n * 4 * 3);
  const side = new Float32Array(n * 4);
  const glow = new Float32Array(n * 4);
  const index = new Uint32Array(n * 6);
  segs.forEach(({ seg, normal }, i) => {
    const dir = normalize(sub(seg.b, seg.a));
    const across = scale(normalize(cross(dir, normal)), seg.w);
    const corners = [add(seg.a, across), sub(seg.a, across), add(seg.b, across), sub(seg.b, across)];
    const sides = [1, -1, 1, -1];
    corners.forEach((c, k) => {
      position.set([c.x, c.y, c.z], (i * 4 + k) * 3);
      side[i * 4 + k] = sides[k];
      glow[i * 4 + k] = clamp(seg.w / DEFAULT_CRACKS.width, 0.2, 1.2);
    });
    const b = i * 4;
    index.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], i * 6);
  });
  return { position, side, glow, index };
}

export interface Triangle {
  a: V3;
  b: V3;
  c: V3;
  surface: number;
}

/** Jittered-grid triangulation of each surface -> shard triangles for the shatter effect. */
export function generateShards(surfaces: Surface[], rng: Rng, cell = 0.55): Triangle[] {
  const tris: Triangle[] = [];
  surfaces.forEach((s, si) => {
    const xs = s.polygon.map((p) => p[0]);
    const ys = s.polygon.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const nx = Math.max(2, Math.round((maxX - minX) / cell));
    const ny = Math.max(2, Math.round((maxY - minY) / cell));
    const grid: V3[][] = [];
    for (let j = 0; j <= ny; j++) {
      const row: V3[] = [];
      for (let i = 0; i <= nx; i++) {
        const border = i === 0 || j === 0 || i === nx || j === ny;
        const jx = border ? 0 : range(rng, -0.32, 0.32) * (maxX - minX) / nx;
        const jy = border ? 0 : range(rng, -0.32, 0.32) * (maxY - minY) / ny;
        // keep the outer ring on the boundary so shards seal against neighbouring faces
        const x = minX + ((maxX - minX) * i) / nx + (i === 0 || i === nx ? 0 : jx);
        const y = minY + ((maxY - minY) * j) / ny + (j === 0 || j === ny ? 0 : jy);
        row.push(toWorld(s, x, y));
      }
      grid.push(row);
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const p00 = grid[j][i];
        const p10 = grid[j][i + 1];
        const p01 = grid[j + 1][i];
        const p11 = grid[j + 1][i + 1];
        if (rng() < 0.5) {
          tris.push({ a: p00, b: p10, c: p11, surface: si }, { a: p00, b: p11, c: p01, surface: si });
        } else {
          tris.push({ a: p00, b: p10, c: p01, surface: si }, { a: p10, b: p11, c: p01, surface: si });
        }
      }
    }
  });
  return tris;
}

/** Fit a room box around detected planes' world-space points; clamp to sane room sizes. */
export function fitRoomBox(points: V3[], fallbackCenter: V3): Box {
  const minHalf = v3(1.6, 1.3, 1.6);
  const maxHalf = v3(5, 2, 5);
  if (points.length < 4) return { center: v3(fallbackCenter.x, 1.35, fallbackCenter.z), half: v3(3, 1.35, 3) };
  let min = v3(Infinity, Infinity, Infinity);
  let max = v3(-Infinity, -Infinity, -Infinity);
  for (const p of points) {
    min = v3(Math.min(min.x, p.x), Math.min(min.y, p.y), Math.min(min.z, p.z));
    max = v3(Math.max(max.x, p.x), Math.max(max.y, p.y), Math.max(max.z, p.z));
  }
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  const hx = clamp((max.x - min.x) / 2, minHalf.x, maxHalf.x);
  const hz = clamp((max.z - min.z) / 2, minHalf.z, maxHalf.z);
  const top = clamp(max.y, 2 * minHalf.y, 2 * maxHalf.y);
  return { center: v3(cx, top / 2, cz), half: v3(hx, top / 2, hz) };
}
