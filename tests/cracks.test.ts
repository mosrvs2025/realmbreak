import { describe, expect, it } from 'vitest';
import {
  boxSurfaces,
  fitRoomBox,
  generateCracks,
  generateShards,
  pointInPolygon,
  polygonArea,
  ribbonArrays,
} from '../src/core/cracks';
import { dot, mulberry32, sub, v3 } from '../src/core/math';

const box = { center: v3(0, 1.35, 0), half: v3(2.5, 1.35, 2.5) };

describe('boxSurfaces', () => {
  it('produces 6 faces with inward-pointing normals', () => {
    const faces = boxSurfaces(box);
    expect(faces).toHaveLength(6);
    for (const f of faces) {
      const toCentre = sub(box.center, f.origin);
      expect(dot(f.normal, toCentre)).toBeGreaterThan(0);
      expect(dot(f.u, f.v)).toBeCloseTo(0);
    }
  });
});

describe('geometry helpers', () => {
  const sq: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  it('pointInPolygon / polygonArea', () => {
    expect(pointInPolygon(sq, 0, 0)).toBe(true);
    expect(pointInPolygon(sq, 2, 0)).toBe(false);
    expect(polygonArea(sq)).toBeCloseTo(4);
  });
});

describe('generateCracks', () => {
  it('is deterministic for a seed and produces bounded segment counts', () => {
    const f = boxSurfaces(box)[2];
    const a = generateCracks(f, mulberry32(9));
    const b = generateCracks(f, mulberry32(9));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(20);
    expect(a.length).toBeLessThanOrEqual(260);
  });
  it('keeps every crack inside the surface outline', () => {
    const f = boxSurfaces(box)[0]; // floor: y ≈ 0
    for (const seg of generateCracks(f, mulberry32(3))) {
      for (const p of [seg.a, seg.b]) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(2.5 + 1e-6);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(2.5 + 1e-6);
        // lifted slightly off the surface along its normal
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(0.05);
      }
    }
  });
});

describe('ribbonArrays', () => {
  it('emits 4 verts and 6 indices per segment', () => {
    const f = boxSurfaces(box)[0];
    const segs = generateCracks(f, mulberry32(4)).map((seg) => ({ seg, normal: f.normal }));
    const r = ribbonArrays(segs);
    expect(r.position.length).toBe(segs.length * 12);
    expect(r.index.length).toBe(segs.length * 6);
    expect(Math.max(...r.index)).toBe(segs.length * 4 - 1);
  });
});

describe('generateShards', () => {
  it('tiles each face with triangles whose total area equals the room surface', () => {
    const surfaces = boxSurfaces(box);
    const tris = generateShards(surfaces, mulberry32(11));
    let area = 0;
    for (const t of tris) {
      const ab = sub(t.b, t.a);
      const ac = sub(t.c, t.a);
      const cx = ab.y * ac.z - ab.z * ac.y;
      const cy = ab.z * ac.x - ab.x * ac.z;
      const cz = ab.x * ac.y - ab.y * ac.x;
      area += 0.5 * Math.hypot(cx, cy, cz);
    }
    const expected = 2 * (5 * 5) + 4 * (5 * 2.7);
    expect(area).toBeCloseTo(expected, 1);
    expect(tris.length).toBeGreaterThan(150);
    expect(tris.length).toBeLessThan(900);
  });
});

describe('fitRoomBox', () => {
  it('falls back to a default room when no planes are detected', () => {
    const b = fitRoomBox([], v3(1, 0, 2));
    expect(b.center.x).toBe(1);
    expect(b.half.x).toBeGreaterThan(2);
  });
  it('clamps absurd extents', () => {
    const b = fitRoomBox([v3(-30, 0, -30), v3(30, 9, 30), v3(0, 0, 0), v3(1, 1, 1)], v3(0, 0, 0));
    expect(b.half.x).toBeLessThanOrEqual(5);
    expect(b.half.y).toBeLessThanOrEqual(2);
  });
});
