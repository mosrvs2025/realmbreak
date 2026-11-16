/**
 * GPU-friendly effect primitives.
 *  - Billboards: one InstancedMesh of camera-facing quads (one draw call for hundreds of glows).
 *  - ParticleSystem: pooled, fixed-capacity particles rendered through Billboards. Zero allocations per frame.
 *  - ContactShadow: soft blob shadow for objects standing on the (real or virtual) floor.
 */
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  type Texture,
  Vector3,
} from 'three';
import { Pool } from '../core/pool';
import { radialTexture } from './tex';

export type BillboardShape = 'soft' | 'ring' | 'spark';

const SHAPE_ID: Record<BillboardShape, number> = { soft: 0, ring: 1, spark: 2 };

export class Billboards {
  readonly mesh: InstancedMesh;
  private readonly m: Float32Array;
  private readonly c: Float32Array;
  private readonly cAttr: InstancedBufferAttribute;

  constructor(readonly capacity: number, shape: BillboardShape = 'soft', renderOrder = 10) {
    const geo = new PlaneGeometry(1, 1);
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uShape: { value: SHAPE_ID[shape] } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vUv = uv;
          vColor = instanceColor;
          vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float s = length(instanceMatrix[0].xyz);
          centre.xy += position.xy * s;
          gl_Position = projectionMatrix * centre;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uShape;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          if (d > 1.0) discard;
          float a;
          if (uShape < 0.5) {            // soft glow with hot core
            a = exp(-d * d * 4.0) * 0.9 + exp(-d * d * 28.0) * 0.6;
          } else if (uShape < 1.5) {     // shock ring
            float r = abs(d - 0.82);
            a = exp(-r * r * 220.0) * 1.1 + exp(-d * d * 3.0) * 0.08;
          } else {                       // tight spark
            a = exp(-d * d * 14.0);
          }
          gl_FragColor = vec4(vColor, clamp(a, 0.0, 1.0));
        }`,
    });
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.m = this.mesh.instanceMatrix.array as Float32Array;
    this.c = new Float32Array(capacity * 3);
    this.cAttr = new InstancedBufferAttribute(this.c, 3);
    this.cAttr.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = this.cAttr;
    for (let i = 0; i < capacity; i++) this.hide(i);
    this.flush();
  }

  set(i: number, x: number, y: number, z: number, size: number, color: Color, intensity = 1): void {
    const o = i * 16;
    const m = this.m;
    m[o] = size;
    m[o + 1] = 0;
    m[o + 2] = 0;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = size;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = 0;
    m[o + 9] = 0;
    m[o + 10] = size;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
    this.c[i * 3] = color.r * intensity;
    this.c[i * 3 + 1] = color.g * intensity;
    this.c[i * 3 + 2] = color.b * intensity;
  }

  hide(i: number): void {
    this.set(i, 0, -100, 0, 0, TMP_BLACK, 0);
  }

  flush(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.cAttr.needsUpdate = true;
  }
}
const TMP_BLACK = new Color(0, 0, 0);

interface Particle {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  gravity: number;
  drag: number;
  r: number;
  g: number;
  b: number;
  /** fade-in fraction of life (0 = none) */
  fade: number;
}

export interface EmitOptions {
  pos: Vector3;
  vel?: Vector3;
  /** random velocity spread (m/s) added on each axis */
  spread?: number;
  life?: number;
  size?: number;
  sizeEnd?: number;
  color?: Color;
  gravity?: number;
  drag?: number;
}

export class ParticleSystem {
  readonly billboards: Billboards;
  private readonly pool: Pool<Particle>;
  /** global multiplier (reduced motion / adaptive quality) applied to emit counts */
  density = 1;

  constructor(capacity = 720) {
    this.billboards = new Billboards(capacity, 'soft', 12);
    this.pool = new Pool<Particle>(capacity, () => ({
      px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size0: 0.05, size1: 0,
      gravity: 0, drag: 0, r: 1, g: 1, b: 1, fade: 0,
    }));
  }

  get mesh(): InstancedMesh {
    return this.billboards.mesh;
  }

  emit(o: EmitOptions): void {
    const i = this.pool.acquire();
    if (i < 0) return;
    const p = this.pool.items[i];
    const s = o.spread ?? 0;
    p.px = o.pos.x;
    p.py = o.pos.y;
    p.pz = o.pos.z;
    p.vx = (o.vel?.x ?? 0) + (Math.random() - 0.5) * 2 * s;
    p.vy = (o.vel?.y ?? 0) + (Math.random() - 0.5) * 2 * s;
    p.vz = (o.vel?.z ?? 0) + (Math.random() - 0.5) * 2 * s;
    p.maxLife = p.life = (o.life ?? 1) * (0.75 + Math.random() * 0.5);
    p.size0 = o.size ?? 0.05;
    p.size1 = o.sizeEnd ?? 0;
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    const c = o.color ?? WHITE;
    p.r = c.r;
    p.g = c.g;
    p.b = c.b;
    p.fade = 0.12;
  }

  burst(count: number, o: EmitOptions): void {
    const n = Math.max(1, Math.round(count * this.density));
    for (let k = 0; k < n; k++) this.emit(o);
  }

  /** Spherical burst: velocity of `speed` in a random direction. */
  explode(count: number, pos: Vector3, speed: number, o: Omit<EmitOptions, 'pos' | 'vel'> = {}): void {
    const n = Math.max(1, Math.round(count * this.density));
    const v = new Vector3();
    for (let k = 0; k < n; k++) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.65));
      this.emit({ ...o, pos, vel: v });
    }
  }

  update(dt: number): void {
    const bb = this.billboards;
    this.pool.forEachLive((p, i) => {
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.release(i);
        bb.hide(i);
        return;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k - p.gravity * dt;
      p.vz *= k;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      const t = 1 - p.life / p.maxLife;
      const size = p.size0 + (p.size1 - p.size0) * t;
      const a = Math.min(1, t / p.fade) * (1 - t);
      bb.set(i, p.px, p.py, p.pz, size, SET_TMP.setRGB(p.r, p.g, p.b), a);
    });
    bb.flush();
  }

  clear(): void {
    this.pool.forEachLive((_, i) => this.billboards.hide(i));
    this.pool.releaseAll();
    this.billboards.flush();
  }

  get alive(): number {
    return this.pool.liveCount;
  }
}
const WHITE = new Color(1, 1, 1);

const SET_TMP = new Color();

/** Soft elliptical blob drawn flat on the floor. In AR it darkens the real floor under the villain. */
export class ContactShadow extends Mesh {
  private static tex: Texture | null = null;

  constructor(radius = 0.6, opacity = 0.55) {
    ContactShadow.tex ??= radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.55, 'rgba(255,255,255,0.55)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    super(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        map: ContactShadow.tex,
        color: 0x000000,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
    this.scale.setScalar(radius * 2);
    this.renderOrder = 2;
    this.position.y = 0.004;
  }
  setOpacity(o: number): void {
    (this.material as MeshBasicMaterial).opacity = o;
  }
}

