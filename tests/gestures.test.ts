import { describe, expect, it } from 'vitest';
import {
  GestureLatch,
  PumpDetector,
  cupScore,
  fingerCurl,
  horizontalAim,
  pushScore,
} from '../src/core/gestures';
import { v3 } from '../src/core/math';
import { makeHand } from './helpers';

const head = v3(0, 1.65, 0);
const aim = v3(0, 0, -1);
const ctx = { head, aim };

/** palms facing forward, hands in front of the chest, fingers pointing up, open */
function pushPose(offset = 0) {
  const L = makeHand({
    handedness: 'left',
    at: v3(-0.1, 1.4, -0.5 - offset),
    fingers: v3(0, 1, 0),
    across: v3(-1, 0, 0), // left hand: pinky is on the -x side when viewed palm-forward... see assertion below
    curl: 0.16,
  });
  const R = makeHand({
    handedness: 'right',
    at: v3(0.1, 1.4, -0.5 - offset),
    fingers: v3(0, 1, 0),
    across: v3(1, 0, 0),
    curl: 0.16,
  });
  return { L, R };
}

/** cupped hands low at the right hip, palms facing each other */
function cupPose(curl = 0.1) {
  const L = makeHand({
    handedness: 'left',
    at: v3(0.2, 1.0, -0.1),
    fingers: v3(0, 0, -1),
    across: v3(0, 1, 0),
    curl,
  });
  const R = makeHand({
    handedness: 'right',
    at: v3(0.3, 1.0, -0.1),
    fingers: v3(0, 0, -1),
    across: v3(0, -1, 0),
    curl,
  });
  return { L, R };
}

describe('palm normals', () => {
  it('right hand palm-down, fingers forward => normal points down', () => {
    const h = makeHand({ handedness: 'right', at: v3(0, 1, -0.3), fingers: v3(0, 0, -1), across: v3(1, 0, 0), curl: 0.15 });
    expect(h.palmNormal.y).toBeLessThan(-0.9);
  });
  it('left hand mirrors the right hand', () => {
    const h = makeHand({ handedness: 'left', at: v3(0, 1, -0.3), fingers: v3(0, 0, -1), across: v3(-1, 0, 0), curl: 0.15 });
    expect(h.palmNormal.y).toBeLessThan(-0.9);
  });
});

describe('fingerCurl', () => {
  it('is larger for an open hand than a cupped one', () => {
    const open = pushPose().R;
    const cup = cupPose(0.09).R;
    expect(fingerCurl(open)).toBeGreaterThan(fingerCurl(cup));
  });
});

describe('cupScore', () => {
  it('detects cupped hands low at the side', () => {
    const { L, R } = cupPose();
    expect(cupScore(L, R, ctx)).toBeGreaterThan(0.62);
  });
  it('rejects hands that are far apart', () => {
    const { L, R } = cupPose();
    const far = { ...R, palm: v3(R.palm.x + 0.6, R.palm.y, R.palm.z) };
    expect(cupScore(L, far, ctx)).toBeLessThan(0.2);
  });
  it('rejects raised hands (not low at the side)', () => {
    const { L, R } = cupPose();
    const up = (h: typeof L) => ({ ...h, palm: v3(h.palm.x, 1.6, h.palm.z) });
    expect(cupScore(up(L), up(R), ctx)).toBeLessThan(0.2);
  });
  it('rejects flat open hands', () => {
    const { L, R } = cupPose(0.17);
    expect(cupScore(L, R, ctx)).toBeLessThan(0.3);
  });
  it('rejects clenched fists', () => {
    const { L, R } = cupPose(0.03);
    expect(cupScore(L, R, ctx)).toBeLessThan(0.3);
  });
});

describe('pushScore', () => {
  it('detects both palms facing forward in front of the chest', () => {
    const { L, R } = pushPose();
    expect(L.palmNormal.z).toBeLessThan(-0.7);
    expect(R.palmNormal.z).toBeLessThan(-0.7);
    expect(pushScore(L, R, ctx)).toBeGreaterThan(0.62);
  });
  it('rejects palms facing the user', () => {
    const { L, R } = pushPose();
    const flip = (h: typeof L) => ({ ...h, palmNormal: v3(0, 0, 1) });
    expect(pushScore(flip(L), flip(R), ctx)).toBeLessThan(0.1);
  });
  it('rejects hands held close to the body', () => {
    const { L, R } = pushPose(-0.35);
    expect(pushScore(L, R, ctx)).toBeLessThan(0.3);
  });
  it('cup and push are mutually exclusive on their reference poses', () => {
    const c = cupPose();
    const p = pushPose();
    expect(pushScore(c.L, c.R, ctx)).toBeLessThan(0.3);
    expect(cupScore(p.L, p.R, ctx)).toBeLessThan(0.3);
  });
});

describe('GestureLatch', () => {
  it('turns on above the on-threshold after the hold time and off below the off-threshold', () => {
    const l = new GestureLatch(0.6, 0.3, 0.1);
    expect(l.update(0.9, 0.05)).toBe(false); // not held long enough
    expect(l.update(0.9, 0.06)).toBe(true);
    expect(l.update(0.5, 0.5)).toBe(true); // hysteresis: still above "off"
    expect(l.update(0.1, 0.05)).toBe(true);
    expect(l.update(0.1, 0.06)).toBe(false);
  });
  it('ignores single-frame glitches', () => {
    const l = new GestureLatch(0.6, 0.3, 0.1);
    l.update(0.9, 0.2);
    expect(l.active).toBe(true);
    l.update(0, 0.016); // one bad frame
    l.update(0.9, 0.016);
    expect(l.active).toBe(true);
  });
});

describe('PumpDetector', () => {
  const run = (speeds: number[], dt = 1 / 72) => {
    const d = new PumpDetector();
    let z = 0;
    let t = 0;
    let pumps = 0;
    for (const s of speeds) {
      z += -s * dt; // forward = -z
      t += dt;
      if (d.update(v3(0, 1.3, z), aim, t)) pumps++;
    }
    return pumps;
  };
  const stroke = (peak: number, frames = 10) =>
    Array.from({ length: frames }, (_, i) => peak * Math.sin(((i + 0.5) / frames) * Math.PI));
  const rest = (n: number) => new Array<number>(n).fill(0);

  it('fires once per fast forward stroke', () => {
    expect(run([...rest(5), ...stroke(2.5), ...rest(10)])).toBe(1);
  });
  it('does not fire on slow movement', () => {
    expect(run([...rest(5), ...stroke(0.4, 30), ...rest(10)])).toBe(0);
  });
  it('does not fire when pulling back', () => {
    expect(run([...rest(5), ...stroke(-2.5), ...rest(10)])).toBe(0);
  });
  it('counts a rapid push-pull-push sequence as two pumps', () => {
    const seq = [...rest(3), ...stroke(2.5), ...stroke(-1.5), ...rest(3), ...stroke(2.5), ...rest(5)];
    expect(run(seq)).toBe(2);
  });
  it('resets when tracking is lost', () => {
    const d = new PumpDetector();
    d.update(v3(0, 0, 0), aim, 0);
    expect(d.update(null, aim, 0.01)).toBe(false);
    expect(d.speed).toBe(0);
  });
});

describe('horizontalAim', () => {
  it('ignores height and normalises', () => {
    const a = horizontalAim(v3(0, 1.6, 0), v3(3, 0, -4));
    expect(a.y).toBe(0);
    expect(Math.hypot(a.x, a.z)).toBeCloseTo(1);
  });
  it('falls back to -z when target is directly above', () => {
    expect(horizontalAim(v3(0, 1, 0), v3(0, 5, 0))).toEqual(v3(0, 0, -1));
  });
});
