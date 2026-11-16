import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { Billboards, type ParticleSystem } from './fx';
import { PAL } from './palette';

const UP = new Vector3(0, 1, 0);

class Beam extends Group {
  private readonly outer: Mesh;
  private readonly core: Mesh;
  private readonly oMat: ShaderMaterial;
  private readonly cMat: ShaderMaterial;

  constructor(color: Color, hot: Color) {
    super();
    const geo = new CylinderGeometry(1, 1, 1, 14, 1, true);
    const mk = (c: Color, soft: number): ShaderMaterial =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        uniforms: {
          uColor: { value: c.clone() },
          uTime: { value: 0 },
          uPow: { value: 1 },
          uLen: { value: 1 },
          uSoft: { value: soft },
        },
        vertexShader: `
          varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){
            vUv = uv;
            vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform vec3 uColor; uniform float uTime, uPow, uLen, uSoft;
          varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){
            float f = pow(abs(dot(normalize(vN), normalize(vV))), uSoft);
            // base term keeps the beam visible when you look straight down its axis (grazing normals)
            float soft = 0.42 + 0.58 * f;
            float band = 0.72 + 0.28 * sin(vUv.y * uLen * 6.0 - uTime * 24.0);
            float fine = 0.9 + 0.1 * sin(vUv.y * uLen * 31.0 - uTime * 41.0);
            float a = soft * band * fine * uPow;
            gl_FragColor = vec4(uColor * (0.8 + f), clamp(a, 0.0, 1.0));
          }`,
      });
    this.oMat = mk(color, 1.6);
    this.cMat = mk(hot, 2.6);
    this.outer = new Mesh(geo, this.oMat);
    this.core = new Mesh(geo, this.cMat);
    this.outer.renderOrder = this.core.renderOrder = 8;
    this.outer.frustumCulled = this.core.frustumCulled = false;
    this.add(this.outer, this.core);
    this.visible = false;
  }

  /** Stretch from `a` to `b` with the given thickness and power. */
  set(a: Vector3, b: Vector3, thickness: number, power: number, time: number): void {
    const len = a.distanceTo(b);
    if (len < 0.02) {
      this.visible = false;
      return;
    }
    this.visible = true;
    this.position.copy(a).add(b).multiplyScalar(0.5);
    const dir = TMP_DIR.subVectors(b, a).divideScalar(len);
    this.quaternion.copy(TMP_Q.setFromUnitVectors(UP, dir));
    this.outer.scale.set(thickness * 0.1, len, thickness * 0.1);
    this.core.scale.set(thickness * 0.035, len, thickness * 0.035);
    for (const m of [this.oMat, this.cMat]) {
      m.uniforms.uTime.value = time;
      m.uniforms.uPow.value = power;
      m.uniforms.uLen.value = len;
    }
  }
}
const TMP_DIR = new Vector3();
const TMP_Q = new Quaternion();

/** Both beams + the clash point's bloom, shockwaves and sparks. */
export class BeamClash extends Group {
  readonly player = new Beam(PAL.player, PAL.playerCore);
  readonly villain = new Beam(PAL.villain, PAL.villainCore);
  private readonly blooms = new Billboards(10, 'soft', 15);
  private readonly rings = new Billboards(6, 'ring', 14);
  private ringT: number[] = [0, 0, 0, 0, 0, 0];
  private ringPos: Vector3[] = Array.from({ length: 6 }, () => new Vector3());
  private nextRing = 0;
  private ringClock = 0;
  readonly clashPoint = new Vector3();
  private readonly tmp = new Vector3();
  private active = false;
  /** 0..1 flash multiplier cap (reduced motion lowers it). */
  flashCap = 1;

  constructor() {
    super();
    this.add(this.player, this.villain, this.blooms.mesh, this.rings.mesh);
  }

  setActive(on: boolean): void {
    this.active = on;
    if (!on) this.hideAll();
  }

  hideAll(): void {
    this.player.visible = false;
    this.villain.visible = false;
    for (let i = 0; i < 10; i++) this.blooms.hide(i);
    for (let i = 0; i < 6; i++) {
      this.rings.hide(i);
      this.ringT[i] = 0;
    }
    this.blooms.flush();
    this.rings.flush();
  }

  /**
   * @param p player hands, @param v villain hands, @param point 0..1 along p→v
   * @param pp,vp 0..1.4 player / villain power
   */
  update(dt: number, time: number, p: Vector3, v: Vector3, point: number, pp: number, vp: number, ps: ParticleSystem, reduced: boolean): void {
    if (!this.active) return;
    this.clashPoint.lerpVectors(p, v, point);
    const c = this.clashPoint;
    this.player.set(p, c, 0.8 + pp * 0.9, 0.9, time);
    this.villain.set(v, c, 0.8 + vp * 0.9, 0.9, time);

    // bloom stack at the clash point (fake bloom: additive soft sprites)
    const energy = 0.6 + 0.4 * Math.min(1, (pp + vp) / 1.4);
    const pulse = reduced ? 1 : 1 + 0.1 * Math.sin(time * 22);
    const k = this.flashCap;
    this.blooms.set(0, c.x, c.y, c.z, 1.9 * energy * pulse, PAL.villainDeep, 0.55 * k);
    this.blooms.set(1, c.x, c.y, c.z, 1.25 * energy * pulse, TMP_MIX.copy(PAL.player).lerp(PAL.villain, 0.5), 0.9 * k);
    this.blooms.set(2, c.x, c.y, c.z, 0.7 * energy, PAL.playerCore, 1 * k);
    this.blooms.set(3, c.x, c.y, c.z, 0.32 * energy, WHITE, 1);
    // emitter glows at both hands
    this.blooms.set(4, p.x, p.y, p.z, 0.45 + pp * 0.3, PAL.player, 0.9);
    this.blooms.set(5, v.x, v.y, v.z, 0.55 + vp * 0.3, PAL.villain, 0.9);
    this.blooms.flush();

    // shockwave rings
    this.ringClock += dt * (1 + (pp + vp) * 0.8);
    if (this.ringClock > 0.42) {
      this.ringClock = 0;
      const i = this.nextRing;
      this.nextRing = (this.nextRing + 1) % 6;
      this.ringT[i] = 0.0001;
      this.ringPos[i].copy(c);
    }
    for (let i = 0; i < 6; i++) {
      if (this.ringT[i] <= 0) continue;
      this.ringT[i] += dt;
      const t = this.ringT[i] / 0.9;
      if (t >= 1) {
        this.ringT[i] = 0;
        this.rings.hide(i);
        continue;
      }
      const rp = this.ringPos[i];
      this.rings.set(i, rp.x, rp.y, rp.z, 0.4 + t * 2.4, TMP_MIX.copy(PAL.playerCore).lerp(PAL.villainCore, 0.5), (1 - t) * 0.8 * k);
    }
    this.rings.flush();

    // sparks flung out of the clash point
    const n = Math.round((3 + (pp + vp) * 4) * ps.density);
    for (let i = 0; i < n; i++) {
      this.tmp.set(Math.random() - 0.5, Math.random() - 0.1, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 3);
      ps.emit({
        pos: c,
        vel: this.tmp,
        life: 0.7,
        size: 0.07,
        sizeEnd: 0,
        color: Math.random() < 0.5 ? PAL.playerCore : PAL.villainCore,
        gravity: 3,
        drag: 0.8,
      });
    }
  }
}
const TMP_MIX = new Color();
const WHITE = new Color(1, 1, 1);
