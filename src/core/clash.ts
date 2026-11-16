/**
 * Beam-clash model. `point` is the clash position along the line player -> villain:
 *   0 = at the player's hands (lose), 0.5 = middle, 1 = at the villain (win).
 *
 * The player supplies power through discrete pumps (hand thrusts / trigger mashing / clicks) plus a small
 * baseline while holding the palms-forward pose. The villain pushes back with a steady force and
 * periodic "surges" that force the player to mash faster.
 */
import { type Rng, clamp, lerp } from './math';

export interface ClashConfig {
  /** Power added by one pump. */
  pumpImpulse: number;
  /** Exponential decay (1/s) of pump energy. */
  pumpDecay: number;
  /** Baseline power while holding the palms-forward pose. */
  holdPower: number;
  /** Villain's steady force. */
  villainBase: number;
  /** Extra force during a surge. */
  surgeBoost: number;
  surgeDuration: number;
  surgeIntervalMin: number;
  surgeIntervalMax: number;
  /** How quickly net force moves the clash point. */
  speed: number;
  /** Clash point at which the match ends. */
  winAt: number;
  loseAt: number;
}

export const DEFAULT_CLASH: ClashConfig = {
  pumpImpulse: 0.2,
  pumpDecay: 2.0,
  holdPower: 0.18,
  villainBase: 0.5,
  surgeBoost: 0.45,
  surgeDuration: 1.1,
  surgeIntervalMin: 3.5,
  surgeIntervalMax: 6.0,
  speed: 0.3,
  winAt: 0.97,
  loseAt: 0.03,
};

export interface ClashState {
  point: number;
  playerPower: number;
  villainPower: number;
  pumpEnergy: number;
  surgeLeft: number;
  nextSurgeIn: number;
  time: number;
  result: 'running' | 'win' | 'lose';
}

export function createClash(rng: Rng, cfg: ClashConfig = DEFAULT_CLASH): ClashState {
  return {
    point: 0.5,
    playerPower: 0,
    villainPower: cfg.villainBase,
    pumpEnergy: 0,
    surgeLeft: 0,
    nextSurgeIn: lerp(cfg.surgeIntervalMin, cfg.surgeIntervalMax, rng()) * 0.6,
    time: 0,
    result: 'running',
  };
}

export interface ClashInput {
  pumps: number;
  holding: boolean;
}

export function stepClash(
  s: ClashState,
  input: ClashInput,
  dt: number,
  rng: Rng,
  cfg: ClashConfig = DEFAULT_CLASH,
): ClashState {
  if (s.result !== 'running') return s;
  s.time += dt;

  s.pumpEnergy = s.pumpEnergy * Math.exp(-cfg.pumpDecay * dt) + input.pumps * cfg.pumpImpulse;
  s.pumpEnergy = Math.min(s.pumpEnergy, 1.2);
  s.playerPower = clamp(s.pumpEnergy + (input.holding ? cfg.holdPower : 0), 0, 1.4);

  s.nextSurgeIn -= dt;
  if (s.nextSurgeIn <= 0 && s.surgeLeft <= 0) {
    s.surgeLeft = cfg.surgeDuration;
    s.nextSurgeIn = lerp(cfg.surgeIntervalMin, cfg.surgeIntervalMax, rng());
  }
  const surging = s.surgeLeft > 0;
  if (surging) s.surgeLeft = Math.max(0, s.surgeLeft - dt);
  // slow wobble so the struggle never feels mechanical
  const wobble = 0.05 * Math.sin(s.time * 1.7);
  s.villainPower = cfg.villainBase + wobble + (surging ? cfg.surgeBoost : 0);

  s.point = clamp(s.point + (s.playerPower - s.villainPower) * cfg.speed * dt, 0, 1);
  if (s.point >= cfg.winAt) s.result = 'win';
  else if (s.point <= cfg.loseAt) s.result = 'lose';
  return s;
}
