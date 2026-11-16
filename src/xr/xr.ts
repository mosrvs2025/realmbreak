/**
 * WebXR plumbing: session start, floor hit-testing, plane detection, hand/controller access.
 * three.js owns the render loop and the controller/hand scene objects; this class layers the
 * game-specific bits on top (and degrades gracefully when optional features are missing).
 */
import { Group, type Object3D, type Scene, Vector3, type WebGLRenderer } from 'three';
import { type Surface, planeSurface } from '../core/cracks';
import { type HandPose, type Handedness, type JointSet, buildHandPose } from '../core/gestures';
import { type V3, v3 } from '../core/math';


export interface Slot {
  /** target-ray space */
  ray: Group;
  grip: Group;
  hand: Group;
  source: XRInputSource | null;
  handedness: Handedness | 'none';
  isHand: boolean;
  trigger: boolean;
  squeeze: boolean;
  /** presses since last consume */
  triggerEdges: number;
  squeezeEdges: number;
}

export interface FloorState {
  y: number | null;
  point: Vector3 | null;
  /** hit-test has produced a consistent floor reading */
  stable: boolean;
  supported: boolean;
}

export interface DetectedPlanes {
  surfaces: Surface[];
  points: V3[];
}

type Listener = (e: { data: XRInputSource }) => void;
const on = (o: Object3D, type: string, fn: Listener): void =>
  (o as unknown as { addEventListener(t: string, f: Listener): void }).addEventListener(type, fn);

const FEATURES = {
  required: ['local-floor'],
  optional: ['hit-test', 'plane-detection', 'hand-tracking', 'anchors', 'bounded-floor'],
};

export class XRHelper {
  readonly slots: Slot[] = [];
  readonly floor: FloorState = { y: null, point: null, stable: false, supported: false };
  readonly planes: DetectedPlanes = { surfaces: [], points: [] };
  session: XRSession | null = null;
  private hitSource: XRHitTestSource | null = null;
  private samples: number[] = [];
  private lastPoint = new Vector3();
  private planeClock = 0;
  onEnd: (() => void) | null = null;
  onSelect: ((slot: Slot) => void) | null = null;

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
  ) {
    for (let i = 0; i < 2; i++) {
      const slot: Slot = {
        ray: renderer.xr.getController(i),
        grip: renderer.xr.getControllerGrip(i),
        hand: renderer.xr.getHand(i),
        source: null,
        handedness: 'none',
        isHand: false,
        trigger: false,
        squeeze: false,
        triggerEdges: 0,
        squeezeEdges: 0,
      };
      scene.add(slot.ray, slot.grip, slot.hand);
      on(slot.ray, 'connected', (e) => {
        const src = e.data;
        slot.source = src;
        slot.handedness = src.handedness === 'none' ? 'none' : (src.handedness as Handedness);
        slot.isHand = !!src.hand;
      });
      on(slot.ray, 'disconnected', () => {
        slot.source = null;
        slot.handedness = 'none';
        slot.isHand = false;
        slot.trigger = slot.squeeze = false;
      });
      on(slot.ray, 'selectstart', () => {
        slot.trigger = true;
        // for tracked hands "select" is a pinch — keep it for UI only, not for gameplay
        if (!slot.isHand) slot.triggerEdges++;
        this.onSelect?.(slot);
      });
      on(slot.ray, 'selectend', () => (slot.trigger = false));
      on(slot.ray, 'squeezestart', () => {
        slot.squeeze = true;
        if (!slot.isHand) slot.squeezeEdges++;
      });
      on(slot.ray, 'squeezeend', () => (slot.squeeze = false));
      this.slots.push(slot);
    }
  }

  get presenting(): boolean {
    return this.renderer.xr.isPresenting;
  }

  async start(mode: 'immersive-ar' | 'immersive-vr' = 'immersive-ar'): Promise<void> {
    const xr = navigator.xr;
    if (!xr) throw new Error('WebXR is not available');
    const init: XRSessionInit =
      mode === 'immersive-ar'
        ? { requiredFeatures: FEATURES.required, optionalFeatures: FEATURES.optional }
        : { requiredFeatures: FEATURES.required, optionalFeatures: ['hand-tracking', 'bounded-floor'] };
    const session = await xr.requestSession(mode, init);
    this.renderer.xr.setReferenceSpaceType('local-floor');
    this.renderer.xr.setFoveation(1);
    await this.renderer.xr.setSession(session);
    this.session = session;
    session.addEventListener('end', () => {
      this.session = null;
      this.hitSource = null;
      this.onEnd?.();
    });
    // hit-test: a ray from the head, angled down toward the floor ~2.3 m ahead
    if (mode === 'immersive-ar' && typeof session.requestHitTestSource === 'function') {
      try {
        const viewer = await session.requestReferenceSpace('viewer');
        const ray = new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: -0.7, z: -1, w: 0 });
        this.hitSource = (await session.requestHitTestSource({ space: viewer, offsetRay: ray })) ?? null;
        this.floor.supported = !!this.hitSource;
      } catch {
        this.floor.supported = false;
      }
    }
  }

  async end(): Promise<void> {
    await this.session?.end().catch(() => undefined);
  }

  /** Call once per XR frame. */
  update(frame: XRFrame | undefined, dt: number): void {
    if (!frame) return;
    const ref = this.renderer.xr.getReferenceSpace();
    if (!ref) return;

    if (this.hitSource && !this.floor.stable) {
      const results = frame.getHitTestResults(this.hitSource);
      const pose = results[0]?.getPose(ref);
      if (pose) {
        const p = pose.transform.position;
        // accept only horizontal-ish hits near the expected floor height
        if (Math.abs(p.y) < 0.4) {
          this.samples.push(p.y);
          if (this.samples.length > 40) this.samples.shift();
          this.lastPoint.set(p.x, p.y, p.z);
          this.floor.point = this.lastPoint;
          if (this.samples.length >= 24) {
            const sorted = [...this.samples].sort((a, b) => a - b);
            const med = sorted[sorted.length >> 1];
            const spread = sorted[sorted.length - 6] - sorted[5];
            if (spread < 0.05) {
              this.floor.y = med;
              this.floor.stable = true;
            }
          }
        }
      } else {
        // lost the floor: slowly forget
        this.samples.shift();
      }
    }

    // plane detection (cheap: refresh a few times per second)
    this.planeClock += dt;
    if (this.planeClock > 0.5 && frame.detectedPlanes && frame.detectedPlanes.size > 0) {
      this.planeClock = 0;
      this.readPlanes(frame, ref);
    }
  }

  private readPlanes(frame: XRFrame, ref: XRReferenceSpace): void {
    const surfaces: Surface[] = [];
    const points: V3[] = [];
    for (const plane of frame.detectedPlanes ?? []) {
      const pose = frame.getPose(plane.planeSpace, ref);
      if (!pose || plane.polygon.length < 3) continue;
      const m = pose.transform.matrix;
      // columns of the column-major matrix: x axis, y axis (normal), z axis, translation
      const X = v3(m[0], m[1], m[2]);
      const Z = v3(m[8], m[9], m[10]);
      const origin = v3(m[12], m[13], m[14]);
      const step = Math.max(1, Math.ceil(plane.polygon.length / 48));
      const poly: [number, number][] = [];
      for (let i = 0; i < plane.polygon.length; i += step) {
        const p = plane.polygon[i];
        poly.push([p.x, -p.z]);
        points.push(v3(origin.x + X.x * p.x + Z.x * p.z, origin.y + X.y * p.x + Z.y * p.z, origin.z + X.z * p.x + Z.z * p.z));
      }
      if (poly.length >= 3) surfaces.push(planeSurface(origin, X, v3(-Z.x, -Z.y, -Z.z), poly));
    }
    this.planes.surfaces = surfaces.slice(0, 8);
    this.planes.points = points;
  }

  /** Consume queued press edges for gameplay. */
  takeEdges(): { triggers: number; squeezes: number } {
    let triggers = 0;
    let squeezes = 0;
    for (const s of this.slots) {
      triggers += s.triggerEdges;
      squeezes += s.squeezeEdges;
      s.triggerEdges = 0;
      s.squeezeEdges = 0;
    }
    return { triggers, squeezes };
  }

  /** Any non-hand controller button held. */
  get buttonHeld(): boolean {
    return this.slots.some((s) => !s.isHand && s.source && (s.trigger || s.squeeze));
  }

  haptic(intensity = 0.5, ms = 40, which: 'both' | Handedness = 'both'): void {
    for (const s of this.slots) {
      if (s.isHand || !s.source) continue;
      if (which !== 'both' && s.handedness !== which) continue;
      const gp = s.source.gamepad;
      const act = (gp?.hapticActuators?.[0] as unknown as { pulse?: (i: number, d: number) => void }) ?? null;
      try {
        if (act?.pulse) act.pulse(intensity, ms);
        else (gp as unknown as { vibrationActuator?: { playEffect: (t: string, o: object) => void } })?.vibrationActuator?.playEffect('dual-rumble', {
          duration: ms,
          strongMagnitude: intensity,
          weakMagnitude: intensity,
        });
      } catch {
        /* haptics are best-effort */
      }
    }
  }

  /** Read a tracked hand as a HandPose (null when not tracked or not a hand). */
  handPose(slot: Slot): HandPose | null {
    if (!slot.isHand || slot.handedness === 'none') return null;
    const j = (slot.hand as unknown as { joints: Record<string, Object3D | undefined> }).joints;
    const get = (n: string): V3 | null => {
      const o = j[n];
      return o && o.visible ? { x: o.position.x, y: o.position.y, z: o.position.z } : null;
    };
    const wrist = get('wrist');
    const im = get('index-finger-metacarpal');
    const mm = get('middle-finger-metacarpal');
    const rm = get('ring-finger-metacarpal');
    const pm = get('pinky-finger-metacarpal');
    const tt = get('thumb-tip');
    const it = get('index-finger-tip');
    const mt = get('middle-finger-tip');
    const rt = get('ring-finger-tip');
    const pt = get('pinky-finger-tip');
    if (!wrist || !im || !mm || !rm || !pm || !tt || !it || !mt || !rt || !pt) return null;
    const joints: JointSet = {
      wrist,
      indexMeta: im,
      middleMeta: mm,
      ringMeta: rm,
      pinkyMeta: pm,
      thumbTip: tt,
      indexTip: it,
      middleTip: mt,
      ringTip: rt,
      pinkyTip: pt,
    };
    return buildHandPose(slot.handedness, joints);
  }
}
