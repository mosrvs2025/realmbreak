/**
 * Original synthesised sound effects — everything is generated at runtime with WebAudio
 * (oscillators + filtered noise). No samples, no copyrighted audio.
 */
export type SfxName =
  | 'teleport'
  | 'orb'
  | 'whoosh'
  | 'burst'
  | 'crack'
  | 'shatter'
  | 'reveal'
  | 'fire'
  | 'pump'
  | 'surge'
  | 'win'
  | 'lose'
  | 'click'
  | 'blip';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private chargeNodes: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private beamNodes: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode; noise: AudioBufferSourceNode } | null = null;
  private ambient: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  enabled = true;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    // resume() may never settle without a user gesture (autoplay policy) — never await it
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  /** Update the 3D listener (head) pose. */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
  }

  private get t(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private out(pos?: { x: number; y: number; z: number }): AudioNode | null {
    if (!this.ctx || !this.master) return null;
    if (!pos || !this.ctx.createPanner) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1.5;
    p.rolloffFactor = 0.8;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.master);
    return p;
  }

  private tone(o: { type?: OscillatorType; f0: number; f1?: number; dur: number; vol?: number; attack?: number; delay?: number; out: AudioNode }): void {
    const c = this.ctx!;
    const t0 = this.t + (o.delay ?? 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur);
    const v = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(o.out);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  private noise(o: { dur: number; vol?: number; f0: number; f1?: number; q?: number; type?: BiquadFilterType; delay?: number; out: AudioNode; attack?: number }): void {
    const c = this.ctx!;
    const t0 = this.t + (o.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t0 + (o.attack ?? 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f).connect(g).connect(o.out);
    src.start(t0);
    src.stop(t0 + o.dur + 0.05);
  }

  play(name: SfxName, pos?: { x: number; y: number; z: number }, intensity = 1): void {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return;
    const out = this.out(pos);
    if (!out) return;
    const k = intensity;
    switch (name) {
      case 'teleport':
        this.tone({ type: 'sawtooth', f0: 90, f1: 1400, dur: 0.7, vol: 0.12 * k, attack: 0.3, out });
        this.tone({ type: 'sine', f0: 180, f1: 2600, dur: 0.7, vol: 0.12 * k, attack: 0.3, out });
        this.noise({ dur: 0.9, f0: 300, f1: 6000, q: 2, vol: 0.18 * k, attack: 0.4, out });
        this.tone({ type: 'sine', f0: 1320, dur: 0.6, vol: 0.1 * k, delay: 0.62, out });
        this.tone({ type: 'sine', f0: 1980, dur: 0.6, vol: 0.07 * k, delay: 0.66, out });
        this.tone({ type: 'sine', f0: 60, f1: 30, dur: 0.9, vol: 0.35 * k, delay: 0.55, out });
        break;
      case 'orb':
        this.tone({ type: 'sawtooth', f0: 520, f1: 140, dur: 0.35, vol: 0.12 * k, out });
        this.noise({ dur: 0.3, f0: 2400, f1: 600, q: 3, vol: 0.2 * k, out });
        break;
      case 'whoosh':
        this.noise({ dur: 0.55, f0: 400, f1: 2600, q: 1.5, vol: 0.28 * k, attack: 0.2, out });
        break;
      case 'burst':
        this.noise({ dur: 0.45, f0: 3000, f1: 200, q: 0.8, vol: 0.35 * k, out });
        this.tone({ type: 'sine', f0: 130, f1: 40, dur: 0.4, vol: 0.4 * k, out });
        break;
      case 'crack':
        for (let i = 0; i < 7; i++) {
          this.noise({ dur: 0.07, f0: 1500 + Math.random() * 3500, q: 6, vol: 0.28 * k, delay: i * 0.06 + Math.random() * 0.04, out, attack: 0.002 });
          this.tone({ type: 'square', f0: 90 + Math.random() * 60, f1: 40, dur: 0.1, vol: 0.12 * k, delay: i * 0.06, out });
        }
        break;
      case 'shatter':
        this.noise({ dur: 1.4, f0: 5000, f1: 900, q: 0.7, vol: 0.5 * k, out, attack: 0.005 });
        this.tone({ type: 'sine', f0: 90, f1: 28, dur: 1.4, vol: 0.55 * k, out });
        for (let i = 0; i < 28; i++)
          this.tone({ type: 'triangle', f0: 2200 + Math.random() * 5200, dur: 0.12 + Math.random() * 0.25, vol: 0.05 * k, delay: Math.random() * 1.2, out, attack: 0.002 });
        break;
      case 'reveal':
        [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          this.tone({ type: 'triangle', f0: f, dur: 2.6, vol: 0.09 * k, delay: i * 0.09, attack: 0.5, out });
          this.tone({ type: 'sine', f0: f * 2, dur: 2.2, vol: 0.04 * k, delay: i * 0.09, attack: 0.5, out });
        });
        break;
      case 'fire':
        this.noise({ dur: 0.7, f0: 200, f1: 3500, q: 1, vol: 0.4 * k, out, attack: 0.05 });
        this.tone({ type: 'sawtooth', f0: 70, f1: 220, dur: 0.6, vol: 0.28 * k, out });
        break;
      case 'pump':
        this.tone({ type: 'triangle', f0: 240, f1: 480, dur: 0.12, vol: 0.12 * k, out });
        this.noise({ dur: 0.1, f0: 1800, q: 2, vol: 0.12 * k, out });
        break;
      case 'surge':
        this.tone({ type: 'sawtooth', f0: 55, f1: 110, dur: 0.9, vol: 0.3 * k, attack: 0.15, out });
        this.noise({ dur: 0.9, f0: 300, f1: 1200, q: 1, vol: 0.2 * k, attack: 0.2, out });
        break;
      case 'win':
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
          this.tone({ type: 'triangle', f0: f, dur: 1.6, vol: 0.14 * k, delay: i * 0.12, attack: 0.02, out });
          this.tone({ type: 'sine', f0: f / 2, dur: 1.6, vol: 0.1 * k, delay: i * 0.12, out });
        });
        this.noise({ dur: 1.2, f0: 4000, f1: 500, q: 0.6, vol: 0.25 * k, out });
        break;
      case 'lose':
        [392, 349.23, 311.13, 261.63].forEach((f, i) => {
          this.tone({ type: 'sawtooth', f0: f, f1: f * 0.97, dur: 1.2, vol: 0.1 * k, delay: i * 0.3, attack: 0.05, out });
        });
        this.tone({ type: 'sine', f0: 55, f1: 38, dur: 2.2, vol: 0.4 * k, out });
        break;
      case 'click':
        this.tone({ type: 'triangle', f0: 880, f1: 1320, dur: 0.09, vol: 0.14 * k, out });
        break;
      case 'blip': {
        // tiny "voice" syllable for the villain's taunts: formant-ish growl
        const f = 70 + Math.random() * 60;
        this.tone({ type: 'sawtooth', f0: f, f1: f * (0.8 + Math.random() * 0.5), dur: 0.09, vol: 0.09 * k, out });
        this.noise({ dur: 0.08, f0: 500 + Math.random() * 900, q: 5, vol: 0.12 * k, out });
        break;
      }
    }
  }

  /** Continuous rising hum while charging. level 0..1; call every frame. */
  setCharge(level: number): void {
    if (!this.ctx || !this.master || !this.enabled || this.ctx.state !== 'running') return;
    const c = this.ctx;
    if (!this.chargeNodes) {
      const gain = c.createGain();
      gain.gain.value = 0;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 500;
      const osc = [c.createOscillator(), c.createOscillator(), c.createOscillator()];
      osc[0].type = 'sawtooth';
      osc[1].type = 'sawtooth';
      osc[2].type = 'sine';
      osc.forEach((o) => {
        o.connect(filter);
        o.start();
      });
      filter.connect(gain).connect(this.master);
      this.chargeNodes = { osc, gain, filter };
    }
    const n = this.chargeNodes;
    const t = c.currentTime;
    const base = 70 + level * 190;
    n.osc[0].frequency.setTargetAtTime(base, t, 0.08);
    n.osc[1].frequency.setTargetAtTime(base * 1.007, t, 0.08);
    n.osc[2].frequency.setTargetAtTime(base * 2, t, 0.08);
    n.filter.frequency.setTargetAtTime(300 + level * 2800, t, 0.1);
    n.gain.gain.setTargetAtTime(level > 0.01 ? 0.05 + level * 0.14 : 0, t, 0.08);
  }

  /** Continuous beam roar while firing. power 0..1.4; active toggles it. */
  setBeam(active: boolean, power = 0.5): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    const c = this.ctx;
    if (!this.beamNodes) {
      const gain = c.createGain();
      gain.gain.value = 0;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      filter.Q.value = 4;
      const osc = [c.createOscillator(), c.createOscillator()];
      osc[0].type = 'sawtooth';
      osc[1].type = 'square';
      osc[0].frequency.value = 62;
      osc[1].frequency.value = 93;
      const noise = c.createBufferSource();
      noise.buffer = this.noiseBuf;
      noise.loop = true;
      const ng = c.createGain();
      ng.gain.value = 0.35;
      noise.connect(ng).connect(filter);
      osc.forEach((o) => {
        o.connect(filter);
        o.start();
      });
      noise.start();
      filter.connect(gain).connect(this.master);
      this.beamNodes = { osc, gain, filter, noise };
    }
    const n = this.beamNodes;
    const t = c.currentTime;
    n.osc[0].frequency.setTargetAtTime(62 + power * 30, t, 0.1);
    n.osc[1].frequency.setTargetAtTime(93 + power * 40, t, 0.1);
    n.filter.frequency.setTargetAtTime(500 + power * 1800, t, 0.1);
    n.gain.gain.setTargetAtTime(active && this.enabled ? 0.1 + power * 0.14 : 0, t, 0.12);
  }

  /** Soft room tone / arena wind bed. */
  setAmbient(kind: 'none' | 'room' | 'arena'): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    const c = this.ctx;
    if (!this.ambient) {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 400;
      const gain = c.createGain();
      gain.gain.value = 0;
      src.connect(f).connect(gain).connect(this.master);
      src.start();
      this.ambient = { gain, src };
      (this.ambient as unknown as { f: BiquadFilterNode }).f = f;
    }
    const f = (this.ambient as unknown as { f: BiquadFilterNode }).f;
    const t = c.currentTime;
    f.frequency.setTargetAtTime(kind === 'arena' ? 900 : 260, t, 0.5);
    this.ambient.gain.gain.setTargetAtTime(kind === 'none' ? 0 : kind === 'arena' ? 0.05 : 0.025, t, 0.6);
  }

  stopLoops(): void {
    this.setCharge(0);
    this.setBeam(false);
  }
}
