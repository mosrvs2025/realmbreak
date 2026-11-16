import { describe, expect, it } from 'vitest';
import { DEFAULT_MACHINE, GameMachine, type FrameInput, type Phase } from '../src/core/machine';
import { mulberry32 } from '../src/core/math';

const idle: FrameInput = { floorReady: true, charging: false, firePressed: false, pumps: 0, holding: false };
const dt = 1 / 60;

function run(m: GameMachine, seconds: number, input: Partial<FrameInput> = {}) {
  const phases: Phase[] = [];
  for (let t = 0; t < seconds; t += dt) {
    for (const e of m.update(dt, { ...idle, ...input })) if (e.type === 'phase') phases.push(e.to);
  }
  return phases;
}

describe('GameMachine flow', () => {
  it('waits for the floor, then moves scan -> intro', () => {
    const m = new GameMachine(mulberry32(1));
    run(m, 0.5, { floorReady: false });
    expect(m.phase).toBe('scan');
    run(m, 1, { floorReady: true });
    expect(m.phase).toBe('intro');
  });
  it('falls back to intro after the scan timeout even without a floor hit', () => {
    const m = new GameMachine(mulberry32(1));
    run(m, DEFAULT_MACHINE.scanTimeout + 0.1, { floorReady: false });
    expect(m.phase).toBe('intro');
  });
  it('intro -> charge after the intro duration', () => {
    const m = new GameMachine(mulberry32(1));
    m.jump('intro');
    run(m, DEFAULT_MACHINE.introDuration + 0.1);
    expect(m.phase).toBe('charge');
  });
  it('charge only grows while charging and decays otherwise', () => {
    const m = new GameMachine(mulberry32(1));
    m.jump('charge');
    run(m, 2, { charging: true });
    const c = m.charge;
    expect(c).toBeGreaterThan(0.3);
    run(m, 1, { charging: false });
    expect(m.charge).toBeLessThan(c);
    run(m, 10, { charging: false });
    expect(m.charge).toBe(0);
  });
  it('fully charging triggers crack -> shatter -> arena', () => {
    const m = new GameMachine(mulberry32(1));
    m.jump('charge');
    const phases = run(m, 4 + DEFAULT_MACHINE.crackDuration + DEFAULT_MACHINE.shatterDuration + 0.5, { charging: true });
    expect(phases).toEqual(['crack', 'shatter', 'arena']);
    expect(m.crack).toBe(1);
  });
  it('arena: fire is ignored before arenaMinWait, then starts the clash after a delay', () => {
    const m = new GameMachine(mulberry32(1));
    m.jump('arena');
    run(m, 1, { firePressed: true });
    expect(m.fired).toBe(false);
    run(m, DEFAULT_MACHINE.arenaMinWait);
    const phases = run(m, 0.1, { firePressed: true });
    expect(m.fired).toBe(true);
    expect(phases).toEqual([]);
    const later = run(m, DEFAULT_MACHINE.fireToClash + 0.2);
    expect(later).toEqual(['clash']);
  });
  it('arena auto-fires so players who cannot make the gesture are never stuck', () => {
    const m = new GameMachine(mulberry32(1));
    m.jump('arena');
    const phases = run(m, DEFAULT_MACHINE.arenaAutoFire + 3);
    expect(phases).toContain('clash');
  });
  it('clash ends in win when the player mashes and lose when idle', () => {
    const win = new GameMachine(mulberry32(5));
    win.jump('clash');
    let acc = 0;
    const winPhases: Phase[] = [];
    for (let t = 0; t < 60 && win.phase === 'clash'; t += dt) {
      acc += 5 * dt;
      const pumps = Math.floor(acc);
      acc -= pumps;
      for (const e of win.update(dt, { ...idle, pumps, holding: true })) if (e.type === 'phase') winPhases.push(e.to);
    }
    expect(winPhases).toEqual(['win']);

    const lose = new GameMachine(mulberry32(5));
    lose.jump('clash');
    expect(run(lose, 40)).toEqual(['lose']);
  });
  it('emits surge events during a clash', () => {
    const m = new GameMachine(mulberry32(2));
    m.jump('clash');
    let surges = 0;
    for (let t = 0; t < 12; t += dt) {
      for (const e of m.update(dt, { ...idle, pumps: Math.random() < 0.08 ? 1 : 0, holding: true }))
        if (e.type === 'surge') surges++;
      if (m.phase !== 'clash') break;
    }
    expect(surges).toBeGreaterThan(0);
  });
  it('replay returns to intro with a clean state', () => {
    const m = new GameMachine(mulberry32(1));
    m.jump('lose');
    const ev = m.replay();
    expect(ev).toEqual([{ type: 'phase', from: 'lose', to: 'intro' }]);
    expect(m.charge).toBe(0);
    expect(m.crack).toBe(0);
    expect(m.fired).toBe(false);
    expect(m.clash.point).toBe(0.5);
    expect(m.clash.result).toBe('running');
  });
  it('reduced motion shortens the crack phase', () => {
    const m = new GameMachine(mulberry32(1), { ...DEFAULT_MACHINE, reducedMotion: true });
    m.jump('crack');
    run(m, DEFAULT_MACHINE.crackDuration * 0.8 + 0.1);
    expect(m.phase).toBe('shatter');
  });
});
