import { describe, expect, it } from 'vitest';
import { createClash, stepClash } from '../src/core/clash';
import { mulberry32 } from '../src/core/math';

function simulate(pumpsPerSecond: number, holding: boolean, seed = 1, maxT = 90) {
  const rng = mulberry32(seed);
  const s = createClash(rng);
  const dt = 1 / 72;
  let accum = 0;
  while (s.result === 'running' && s.time < maxT) {
    accum += pumpsPerSecond * dt;
    const pumps = Math.floor(accum);
    accum -= pumps;
    stepClash(s, { pumps, holding }, dt, rng);
  }
  return s;
}

describe('beam clash', () => {
  it('starts in the middle', () => {
    expect(createClash(mulberry32(1)).point).toBe(0.5);
  });
  it('an idle player loses within ~25s', () => {
    const s = simulate(0, false);
    expect(s.result).toBe('lose');
    expect(s.time).toBeLessThan(25);
  });
  it('mashing ~5 pumps/s wins within a reasonable time for many seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = simulate(5, true, seed);
      expect(s.result).toBe('win');
      expect(s.time).toBeLessThan(45);
    }
  });
  it('mashing at 2 pumps/s without holding is not enough', () => {
    expect(simulate(2, false).result).toBe('lose');
  });
  it('the point stays within [0,1]', () => {
    const rng = mulberry32(7);
    const s = createClash(rng);
    for (let i = 0; i < 5000; i++) {
      stepClash(s, { pumps: i % 3 === 0 ? 2 : 0, holding: true }, 1 / 72, rng);
      expect(s.point).toBeGreaterThanOrEqual(0);
      expect(s.point).toBeLessThanOrEqual(1);
    }
  });
  it('is frozen once finished', () => {
    const s = simulate(0, false);
    const p = s.point;
    stepClash(s, { pumps: 5, holding: true }, 1, mulberry32(3));
    expect(s.point).toBe(p);
  });
  it('is deterministic for a given seed', () => {
    expect(simulate(4, true, 42).time).toBe(simulate(4, true, 42).time);
  });
});
