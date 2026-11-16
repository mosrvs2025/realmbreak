import { Color, Group, Vector3 } from 'three';
import { Pool } from '../core/pool';
import { Billboards, type ParticleSystem } from './fx';
import { PAL } from './palette';

interface Orb {
  pos: Vector3;
  vel: Vector3;
  /** distance left before it detonates */
  remaining: number;
  /** pass-by point, used for near-miss feedback */
  passed: boolean;
  target: Vector3;
}

export interface OrbEvents {
  onDetonate?: (pos: Vector3) => void;
  onNearPass?: (pos: Vector3) => void;
}

/**
 * Pooled villain projectiles. They are aimed to *miss* the player by a comfortable margin
 * (the experience never "hits" you) and burst harmlessly behind you.
 */
export class OrbPool extends Group {
  private readonly pool: Pool<Orb>;
  private readonly glow: Billboards;
  private readonly core: Billboards;
  private readonly tmp = new Vector3();

  constructor(capacity = 12) {
    super();
    this.pool = new Pool<Orb>(capacity, () => ({
      pos: new Vector3(),
      vel: new Vector3(),
      remaining: 0,
      passed: false,
      target: new Vector3(),
    }));
    this.glow = new Billboards(capacity, 'soft', 11);
    this.core = new Billboards(capacity, 'spark', 13);
    this.add(this.glow.mesh, this.core.mesh);
  }

  /** Fire from `from`, passing through `pass`, detonating `extra` metres beyond it. */
  fire(from: Vector3, pass: Vector3, speed = 3.4, extra = 2.5): boolean {
    const i = this.pool.acquire();
    if (i < 0) return false;
    const o = this.pool.items[i];
    o.pos.copy(from);
    o.target.copy(pass);
    o.vel.subVectors(pass, from).normalize().multiplyScalar(speed);
    o.remaining = from.distanceTo(pass) + extra;
    o.passed = false;
    return true;
  }

  update(dt: number, ps: ParticleSystem, ev: OrbEvents, time: number): void {
    this.pool.forEachLive((o, i) => {
      const step = o.vel.length() * dt;
      this.tmp.copy(o.vel).multiplyScalar(dt);
      o.pos.add(this.tmp);
      o.remaining -= step;
      if (!o.passed && o.pos.distanceTo(o.target) < 0.25) {
        o.passed = true;
        ev.onNearPass?.(o.pos);
      }
      // ember trail
      ps.emit({ pos: o.pos, spread: 0.12, life: 0.45, size: 0.09, sizeEnd: 0, color: PAL.ember, drag: 2 });
      const pulse = 1 + 0.12 * Math.sin(time * 18 + i);
      this.glow.set(i, o.pos.x, o.pos.y, o.pos.z, 0.5 * pulse, PAL.villain, 1);
      this.core.set(i, o.pos.x, o.pos.y, o.pos.z, 0.2 * pulse, PAL.villainCore, 1);
      if (o.remaining <= 0) {
        ev.onDetonate?.(o.pos);
        ps.explode(26, o.pos, 2.8, { life: 0.8, size: 0.12, sizeEnd: 0, color: PAL.villain, drag: 1.5, gravity: 1 });
        this.pool.release(i);
        this.glow.hide(i);
        this.core.hide(i);
      }
    });
    this.glow.flush();
    this.core.flush();
  }

  reset(): void {
    this.pool.forEachLive((_, i) => {
      this.glow.hide(i);
      this.core.hide(i);
    });
    this.pool.releaseAll();
    this.glow.flush();
    this.core.flush();
  }

  get active(): number {
    return this.pool.liveCount;
  }
}

// scratch vectors: nothing is allocated per frame in the hot path
const MOTE_DIR = new Vector3();
const MOTE_POS = new Vector3();

/** The player's charging energy orb between the hands. */
export class ChargeOrb extends Group {
  private readonly halo = new Billboards(3, 'soft', 14);
  private readonly color = new Color();
  private time = 0;

  constructor() {
    super();
    this.add(this.halo.mesh);
  }

  /** @param level 0..1 charge, @param intensity multiplies brightness (flash) */
  update(dt: number, pos: Vector3, level: number, ps: ParticleSystem, reduced: boolean, villainSide = false): void {
    this.time += dt;
    const on = level > 0.01;
    const base = villainSide ? PAL.villain : PAL.player;
    const hot = villainSide ? PAL.villainCore : PAL.playerCore;
    if (!on) {
      for (let i = 0; i < 3; i++) this.halo.hide(i);
      this.halo.flush();
      return;
    }
    const r = 0.035 + level * 0.17;
    const pulse = reduced ? 1 : 1 + 0.08 * Math.sin(this.time * 14);
    this.halo.set(0, pos.x, pos.y, pos.z, r * 5.2 * pulse, base, 0.55 + level * 0.45);
    this.halo.set(1, pos.x, pos.y, pos.z, r * 2.6 * pulse, this.color.copy(base).lerp(hot, 0.4), 1);
    this.halo.set(2, pos.x, pos.y, pos.z, r * 1.4, hot, 1);
    this.halo.flush();

    // swirling motes drawn into the orb
    const rate = Math.round((6 + level * 26) * ps.density * dt * 60 * 0.5);
    for (let k = 0; k < rate; k++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      const d = 0.25 + level * 0.35 + Math.random() * 0.2;
      MOTE_DIR.set(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b));
      MOTE_POS.copy(pos).addScaledVector(MOTE_DIR, d);
      MOTE_DIR.multiplyScalar(-d * 2.4);
      ps.emit({
        pos: MOTE_POS,
        vel: MOTE_DIR,
        life: 0.42,
        size: 0.022 + level * 0.016,
        sizeEnd: 0.005,
        color: base,
      });
    }
  }

  hideAll(): void {
    for (let i = 0; i < 3; i++) this.halo.hide(i);
    this.halo.flush();
  }
}
