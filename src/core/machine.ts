/**
 * Pure game-flow state machine. The renderer reads `phase`, `t` and the progress values;
 * it never mutates them. Everything time-based lives here so it can be unit-tested.
 */
import { type Rng, clamp } from './math';
import { type ClashState, createClash, stepClash } from './clash';

export type Phase =
  | 'scan'
  | 'intro'
  | 'charge'
  | 'crack'
  | 'shatter'
  | 'arena'
  | 'clash'
  | 'win'
  | 'lose';

export interface MachineConfig {
  scanMin: number;
  scanTimeout: number;
  introDuration: number;
  chargeRate: number;
  chargeDecay: number;
  crackDuration: number;
  shatterDuration: number;
  arenaMinWait: number;
  arenaAutoFire: number;
  /** Seconds the villain waits after the player fires before the clash starts. */
  fireToClash: number;
  /** Shorter timings for users who prefer reduced motion. */
  reducedMotion: boolean;
}

export const DEFAULT_MACHINE: MachineConfig = {
  scanMin: 1.0,
  scanTimeout: 6.0,
  introDuration: 9.0,
  chargeRate: 0.24,
  chargeDecay: 0.3,
  crackDuration: 3.4,
  shatterDuration: 3.2,
  arenaMinWait: 4.0,
  arenaAutoFire: 16.0,
  fireToClash: 0.9,
  reducedMotion: false,
};

export interface FrameInput {
  /** Floor located (hit-test stable, or always true on desktop). */
  floorReady: boolean;
  /** Charge gesture / trigger / pointer held. */
  charging: boolean;
  /** Edge: player fired the beam this frame. */
  firePressed: boolean;
  /** Pump events this frame. */
  pumps: number;
  /** Palms-forward (or equivalent) held. */
  holding: boolean;
}

export type MachineEvent =
  | { type: 'phase'; from: Phase; to: Phase }
  | { type: 'fired' }
  | { type: 'surge' };

export class GameMachine {
  phase: Phase = 'scan';
  /** seconds spent in the current phase */
  t = 0;
  /** total seconds since start */
  total = 0;
  charge = 0;
  /** 0..1 crack spread */
  crack = 0;
  /** seconds since the shards started to fall */
  fall = 0;
  /** true after the player fired in the arena (before clash begins) */
  fired = false;
  clash: ClashState;
  private surgeWas = false;

  constructor(
    private readonly rng: Rng,
    readonly cfg: MachineConfig = DEFAULT_MACHINE,
  ) {
    this.clash = createClash(rng);
  }

  private go(to: Phase, ev: MachineEvent[]): void {
    const from = this.phase;
    this.phase = to;
    this.t = 0;
    ev.push({ type: 'phase', from, to });
  }

  /** Return to the very start (before floor scan). */
  reset(): void {
    this.phase = 'scan';
    this.t = 0;
    this.total = 0;
    this.charge = 0;
    this.crack = 0;
    this.fall = 0;
    this.fired = false;
    this.clash = createClash(this.rng);
    this.surgeWas = false;
  }

  /** Restart the fight (floor stays known) – used by Replay. */
  replay(): MachineEvent[] {
    const ev: MachineEvent[] = [];
    this.charge = 0;
    this.crack = 0;
    this.fall = 0;
    this.fired = false;
    this.clash = createClash(this.rng);
    this.surgeWas = false;
    this.go('intro', ev);
    return ev;
  }

  update(dt: number, input: FrameInput): MachineEvent[] {
    const ev: MachineEvent[] = [];
    const c = this.cfg;
    this.t += dt;
    this.total += dt;
    const speed = c.reducedMotion ? 0.8 : 1;

    switch (this.phase) {
      case 'scan':
        if ((input.floorReady && this.t >= c.scanMin) || this.t >= c.scanTimeout) this.go('intro', ev);
        break;
      case 'intro':
        if (this.t >= c.introDuration) this.go('charge', ev);
        break;
      case 'charge': {
        const rate = input.charging ? c.chargeRate : -c.chargeDecay;
        this.charge = clamp(this.charge + rate * dt);
        if (this.charge >= 1) this.go('crack', ev);
        break;
      }
      case 'crack':
        this.charge = 1;
        this.crack = clamp(this.t / (c.crackDuration * speed));
        if (this.crack >= 1) this.go('shatter', ev);
        break;
      case 'shatter':
        this.fall = this.t;
        if (this.t >= c.shatterDuration * speed) this.go('arena', ev);
        break;
      case 'arena':
        this.fall += dt;
        if (!this.fired) {
          const ready = this.t >= c.arenaMinWait;
          if ((ready && input.firePressed) || this.t >= c.arenaAutoFire) {
            this.fired = true;
            this.t = 0; // restart the clock for the fire→clash delay
            ev.push({ type: 'fired' });
          }
        } else if (this.t >= c.fireToClash) {
          this.go('clash', ev);
        }
        break;
      case 'clash': {
        const prevResult = this.clash.result;
        stepClash(this.clash, { pumps: input.pumps, holding: input.holding }, dt, this.rng);
        const surging = this.clash.surgeLeft > 0;
        if (surging && !this.surgeWas) ev.push({ type: 'surge' });
        this.surgeWas = surging;
        if (prevResult === 'running' && this.clash.result !== 'running') this.go(this.clash.result, ev);
        break;
      }
      case 'win':
      case 'lose':
        break;
    }
    return ev;
  }

  /** Test/debug helper: force a phase with consistent derived values. */
  jump(to: Phase): void {
    this.phase = to;
    this.t = 0;
    if (to === 'crack' || to === 'shatter' || to === 'arena' || to === 'clash' || to === 'win' || to === 'lose')
      this.charge = 1;
    if (to === 'shatter' || to === 'arena' || to === 'clash' || to === 'win' || to === 'lose') this.crack = 1;
    if (to === 'arena' || to === 'clash' || to === 'win' || to === 'lose') this.fall = 10;
    if (to === 'clash' || to === 'win' || to === 'lose') this.fired = true;
    if (to === 'win') this.clash.point = 1;
    if (to === 'lose') this.clash.point = 0;
  }
}
