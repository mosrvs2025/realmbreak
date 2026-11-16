/**
 * Unifies every input method into one per-frame snapshot:
 *   hands (cup / push / pump gestures)  >  controllers (trigger, squeeze, thrust)  >  pointer (mouse / touch / keyboard)
 */
import { Vector3 } from 'three';
import {
  type HandPose,
  GestureLatch,
  PumpDetector,
  cupScore,
  horizontalAim,
  pushScore,
} from '../core/gestures';
import { type V3, mean } from '../core/math';
import { type Slot, type XRHelper } from '../xr/xr';

export interface InputSnapshot {
  source: 'hands' | 'controller' | 'pointer';
  /** charge gesture / button / pointer held */
  held: boolean;
  /** edge: the "fire" action this frame */
  firePressed: boolean;
  /** palms-forward held (adds a small baseline push in the clash) */
  holding: boolean;
  pumps: number;
  /** where energy gathers (between the hands), world space */
  origin: Vector3;
  /** both hands tracked and visible */
  handsTracked: boolean;
  cupScore: number;
  pushScore: number;
}

export class PointerInput {
  private down = false;
  private presses = 0;
  private keyDown = false;

  constructor(target: HTMLElement) {
    target.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      this.down = true;
      this.presses++;
    });
    const up = () => (this.down = false);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) {
        this.keyDown = true;
        this.presses++;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.keyDown = false;
    });
  }

  /** Programmatic press (used by tests / debug hooks). */
  press(): void {
    this.presses++;
  }

  read(origin: Vector3): InputSnapshot {
    const n = this.presses;
    this.presses = 0;
    return {
      source: 'pointer',
      held: this.down || this.keyDown,
      firePressed: n > 0,
      holding: false,
      pumps: n,
      origin,
      handsTracked: false,
      cupScore: 0,
      pushScore: 0,
    };
  }
}

export class XRInput {
  private readonly cup = new GestureLatch(0.6, 0.3, 0.1);
  private readonly push = new GestureLatch(0.6, 0.3, 0.08);
  private readonly pump = new PumpDetector(0.95, 0.3, 0.14);
  private pushWas = false;
  private readonly origin = new Vector3();
  private readonly aim = new Vector3(0, 0, -1);

  constructor(private readonly xr: XRHelper) {}

  /** Pose of each tracked hand, indexed by slot. */
  hands(): (HandPose | null)[] {
    return this.xr.slots.map((s) => this.xr.handPose(s));
  }

  read(head: Vector3, target: Vector3, time: number, dt: number, fallbackOrigin: Vector3): InputSnapshot {
    const aim = horizontalAim(head, target);
    this.aim.set(aim.x, 0, aim.z);
    const ctx = { head, aim };
    const poses = this.hands();
    const L = poses.find((p) => p?.handedness === 'left') ?? null;
    const R = poses.find((p) => p?.handedness === 'right') ?? null;
    const both = !!(L && R);

    let cupS = 0;
    let pushS = 0;
    let mid: V3 | null = null;
    if (L && R) {
      cupS = cupScore(L, R, ctx);
      pushS = pushScore(L, R, ctx);
      mid = mean([L.palm, R.palm]);
    }
    const cupOn = this.cup.update(cupS, dt);
    const pushOn = this.push.update(pushS, dt);
    const pushEdge = pushOn && !this.pushWas;
    this.pushWas = pushOn;

    // controller fallback
    const ctrls = this.xr.slots.filter((s) => !s.isHand && s.source);
    const edges = this.xr.takeEdges();
    let ctrlMid: V3 | null = null;
    if (ctrls.length > 0) ctrlMid = mean(ctrls.map((s) => ({ x: s.grip.position.x, y: s.grip.position.y, z: s.grip.position.z })));
    const buttonHeld = this.xr.buttonHeld;

    const trackPoint = mid ?? ctrlMid;
    const thrust = this.pump.update(trackPoint, this.aim, time);

    const pumps = (thrust ? 1 : 0) + edges.triggers + edges.squeezes;
    const origin = mid ?? ctrlMid ?? fallbackOrigin;
    this.origin.set(origin.x, origin.y, origin.z);

    return {
      source: both ? 'hands' : ctrls.length ? 'controller' : 'hands',
      held: cupOn || buttonHeld,
      firePressed: pushEdge || edges.triggers > 0 || edges.squeezes > 0,
      holding: pushOn,
      pumps,
      origin: this.origin,
      handsTracked: both,
      cupScore: cupS,
      pushScore: pushS,
    };
  }

  /** The slot whose controller targets UI (first with a source). */
  uiSlots(): Slot[] {
    return this.xr.slots.filter((s) => s.source);
  }
}
