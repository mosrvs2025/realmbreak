/**
 * Hand-gesture detection, written against plain {x,y,z} points so it is fully unit-testable.
 * The XR layer converts WebXR joint poses into `HandPose` objects (see buildHandPose) and
 * feeds them to these detectors every frame.
 *
 * Gestures
 *  - CUP    : both hands cupped together low at your side  -> charge the energy orb
 *  - PUSH   : both palms facing forward, hands in front    -> fire the beam
 *  - PUMP   : a fast forward thrust of the hands           -> win the beam struggle
 */
import {
  type V3,
  add,
  clamp,
  cross,
  dist,
  dot,
  mean,
  normalize,
  scale,
  smoothstep,
  sub,
  v3,
} from './math';

export type Handedness = 'left' | 'right';

export interface HandPose {
  handedness: Handedness;
  wrist: V3;
  /** Centre of the palm. */
  palm: V3;
  /** Unit vector pointing out of the palm. */
  palmNormal: V3;
  /** Thumb, index, middle, ring, pinky tips. */
  tips: [V3, V3, V3, V3, V3];
}

export interface JointSet {
  wrist: V3;
  indexMeta: V3;
  middleMeta: V3;
  ringMeta: V3;
  pinkyMeta: V3;
  thumbTip: V3;
  indexTip: V3;
  middleTip: V3;
  ringTip: V3;
  pinkyTip: V3;
}

/**
 * Build a HandPose from raw joint positions.
 * Palm normal: u = wrist -> middle knuckle, w = index knuckle -> pinky knuckle.
 * For a right hand with the palm facing down and fingers forward, u x w points down (out of the palm);
 * the left hand mirrors this.
 */
export function buildHandPose(handedness: Handedness, j: JointSet): HandPose {
  const palm = mean([j.wrist, j.indexMeta, j.middleMeta, j.ringMeta, j.pinkyMeta]);
  const u = sub(j.middleMeta, j.wrist);
  const w = sub(j.pinkyMeta, j.indexMeta);
  let n = normalize(cross(u, w));
  if (handedness === 'left') n = scale(n, -1);
  return {
    handedness,
    wrist: j.wrist,
    palm,
    palmNormal: n,
    tips: [j.thumbTip, j.indexTip, j.middleTip, j.ringTip, j.pinkyTip],
  };
}

/** Mean distance of the four fingertips to the palm centre: ~0.06 fist, ~0.10 cupped, ~0.17 flat. */
export function fingerCurl(h: HandPose): number {
  let s = 0;
  for (let i = 1; i < 5; i++) s += dist(h.tips[i], h.palm);
  return s / 4;
}

const bump = (x: number, lo: number, hi: number, soft: number): number =>
  smoothstep(lo - soft, lo, x) * (1 - smoothstep(hi, hi + soft, x));

export interface GestureContext {
  /** Head position (world). */
  head: V3;
  /** Horizontal unit vector from the head toward the target (villain). */
  aim: V3;
}

/** 0..1 confidence that both hands are cupped together low at the side. */
export function cupScore(left: HandPose, right: HandPose, ctx: GestureContext): number {
  const palmDist = dist(left.palm, right.palm);
  const near = 1 - smoothstep(0.13, 0.24, palmDist);

  const curlL = fingerCurl(left);
  const curlR = fingerCurl(right);
  // cupped = noticeably curled, but not a clenched fist and not a flat hand
  const curled = Math.min(bump(curlL, 0.055, 0.135, 0.02), bump(curlR, 0.055, 0.135, 0.02));

  const mid = mean([left.palm, right.palm]);
  const below = smoothstep(0.12, 0.3, ctx.head.y - mid.y);
  // hands close to the torso or to a side, not stretched out in front
  const fwd = dot(sub(mid, ctx.head), ctx.aim);
  const notReaching = 1 - smoothstep(0.35, 0.6, fwd);

  // reject the "both palms pushing forward" pose
  const pushing = Math.min(
    smoothstep(0.5, 0.8, dot(left.palmNormal, ctx.aim)),
    smoothstep(0.5, 0.8, dot(right.palmNormal, ctx.aim)),
  );
  return clamp(near * curled * below * notReaching * (1 - pushing));
}

/** 0..1 confidence that both palms face forward (toward the villain), hands in front of the chest. */
export function pushScore(left: HandPose, right: HandPose, ctx: GestureContext): number {
  const nl = smoothstep(0.35, 0.75, dot(left.palmNormal, ctx.aim));
  const nr = smoothstep(0.35, 0.75, dot(right.palmNormal, ctx.aim));
  const mid = mean([left.palm, right.palm]);
  const reach = smoothstep(0.2, 0.38, dot(sub(mid, ctx.head), ctx.aim));
  const together = 1 - smoothstep(0.26, 0.45, dist(left.palm, right.palm));
  const open = Math.min(smoothstep(0.08, 0.12, fingerCurl(left)), smoothstep(0.08, 0.12, fingerCurl(right)));
  const height = 1 - smoothstep(0.3, 0.55, Math.abs(mid.y - (ctx.head.y - 0.25)));
  return clamp(nl * nr * reach * together * open * (0.5 + 0.5 * height));
}

/** Schmitt trigger with a minimum hold time so single-frame tracking glitches don't flip state. */
export class GestureLatch {
  active = false;
  private since = 0;
  private candidate: boolean | null = null;

  constructor(
    private readonly on = 0.62,
    private readonly off = 0.35,
    private readonly holdSec = 0.08,
  ) {}

  /** @returns true while the gesture is considered active */
  update(score: number, dt: number): boolean {
    const want = this.active ? score > this.off : score >= this.on;
    if (want === this.active) {
      this.candidate = null;
      this.since = 0;
      return this.active;
    }
    if (this.candidate !== want) {
      this.candidate = want;
      this.since = 0;
    }
    this.since += dt;
    if (this.since >= this.holdSec) {
      this.active = want;
      this.candidate = null;
      this.since = 0;
    }
    return this.active;
  }

  reset(): void {
    this.active = false;
    this.candidate = null;
    this.since = 0;
  }
}

/**
 * Detects forward "pump" thrusts of a tracked point (palm midpoint or controller midpoint).
 * A pump fires once per forward stroke: speed along the aim axis must exceed `threshold`
 * and the hand must have eased back (speed < rearm) before the next pump can fire.
 */
export class PumpDetector {
  private last: V3 | null = null;
  private lastT = 0;
  private armed = true;
  private cooldown = 0;
  /** smoothed forward speed (m/s) – exposed for debugging / UI */
  speed = 0;

  constructor(
    private readonly threshold = 0.9,
    private readonly rearm = 0.25,
    private readonly refractory = 0.14,
  ) {}

  update(point: V3 | null, aim: V3, t: number): boolean {
    if (!point) {
      this.last = null;
      this.speed = 0;
      return false;
    }
    let fired = false;
    if (this.last) {
      const dt = t - this.lastT;
      if (dt > 1e-4 && dt < 0.25) {
        const raw = dot(sub(point, this.last), aim) / dt;
        this.speed = this.speed * 0.5 + raw * 0.5;
        this.cooldown = Math.max(0, this.cooldown - dt);
        if (this.armed && this.speed > this.threshold && this.cooldown === 0) {
          fired = true;
          this.armed = false;
          this.cooldown = this.refractory;
        } else if (!this.armed && this.speed < this.rearm) {
          this.armed = true;
        }
      }
    }
    this.last = point;
    this.lastT = t;
    return fired;
  }

  reset(): void {
    this.last = null;
    this.armed = true;
    this.cooldown = 0;
    this.speed = 0;
  }
}

/** Convenience used by tests & the XR layer: the horizontal direction from head to target. */
export function horizontalAim(head: V3, target: V3): V3 {
  const d = sub(target, head);
  const h = normalize(v3(d.x, 0, d.z));
  return h.x === 0 && h.z === 0 ? v3(0, 0, -1) : h;
}

export const _internal = { add };
