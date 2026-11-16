/**
 * RoomShell — the "realm break" surface effect.
 *
 *  1. Crack ribbons are laid on the six faces of a room-sized box (or on detected planes) and
 *     revealed by a shader as the crack front spreads out from the energy orb.
 *  2. The same box is tessellated into shards. A vertex shader animates their fall entirely on the GPU
 *     (one draw call, zero per-frame CPU work).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector3,
} from 'three';
import {
  type Box,
  type Surface,
  boxSurfaces,
  generateCracks,
  generateShards,
  ribbonArrays,
} from '../core/cracks';
import { type Rng } from '../core/math';
import { PAL } from './palette';

export class RoomShell extends Group {
  private crackMesh: Mesh | null = null;
  private shardMesh: Mesh | null = null;
  private readonly crackMat: ShaderMaterial;
  private readonly shardMat: ShaderMaterial;
  private maxDist = 6;
  box: Box = { center: { x: 0, y: 1.35, z: 0 }, half: { x: 3, y: 1.35, z: 3 } };

  constructor() {
    super();
    this.crackMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: {
        uProgress: { value: 0 },
        uOrigin: { value: new Vector3() },
        uMaxDist: { value: 6 },
        uTime: { value: 0 },
        uColor: { value: new Color().copy(PAL.crack) },
        uFlash: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aSide;
        attribute float aGlow;
        uniform vec3 uOrigin;
        varying float vDist; varying float vSide; varying float vGlow;
        void main() {
          vSide = aSide; vGlow = aGlow;
          vDist = distance(position, uOrigin);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uProgress, uMaxDist, uTime, uFlash;
        uniform vec3 uColor;
        varying float vDist; varying float vSide; varying float vGlow;
        void main() {
          float front = uProgress * (uMaxDist + 0.8);
          float vis = 1.0 - smoothstep(front - 0.45, front, vDist);
          if (vis <= 0.001) discard;
          float core = 1.0 - abs(vSide);
          float fl = exp(-abs(vDist - front + 0.2) * 3.5) * uFlash;
          float pulse = 0.82 + 0.18 * sin(uTime * 9.0 + vDist * 3.0);
          vec3 col = mix(uColor, vec3(0.92, 0.98, 1.0), pow(core, 3.0) * 0.7 + fl * 0.6);
          float a = pow(core, 0.6) * vis * vGlow * pulse * (1.0 + fl * 1.5);
          gl_FragColor = vec4(col * 1.4, clamp(a, 0.0, 1.0));
        }`,
    });

    this.shardMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending,
      uniforms: {
        uShowT: { value: -1 },
        uFall: { value: 0 },
        uTime: { value: 0 },
        uEdge: { value: new Color().copy(PAL.crack) },
        uMaxDist: { value: 6 },
        uOrigin: { value: new Vector3() },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aCenter;
        attribute vec3 aAxis;
        attribute vec4 aRnd;   // x: fall delay, y: spin speed, z: outward speed, w: appear delay
        attribute vec3 aBary;
        uniform float uFall;
        varying vec3 vBary; varying float vT; varying float vApp; varying float vRnd;
        uniform float uShowT;
        vec3 rotate(vec3 v, vec3 k, float a) {
          float c = cos(a), s = sin(a);
          return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
        }
        void main() {
          float t = max(0.0, uFall - aRnd.x);
          vec3 rel = rotate(position - aCenter, normalize(aAxis), t * aRnd.y);
          vec3 inward = normalize(vec3(-aCenter.x, 0.0, -aCenter.z) + 1e-4);
          vec3 vel = inward * aRnd.z + vec3(0.0, 0.4 * aRnd.z, 0.0);
          vec3 p = aCenter + rel + vel * t + vec3(0.0, -5.4, 0.0) * t * t;
          vBary = aBary; vT = t; vApp = smoothstep(aRnd.w, aRnd.w + 0.18, uShowT); vRnd = aRnd.x;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uEdge; uniform float uTime;
        varying vec3 vBary; varying float vT; varying float vApp; varying float vRnd;
        void main() {
          if (vApp <= 0.001) discard;
          float e = 1.0 - smoothstep(0.0, 0.05, min(vBary.x, min(vBary.y, vBary.z)));
          float sheen = 0.5 + 0.5 * sin(vBary.x * 9.0 + vBary.y * 5.0 + uTime * 1.5);
          vec3 base = mix(vec3(0.012, 0.016, 0.04), vec3(0.05, 0.08, 0.17), sheen * 0.6);
          vec3 col = base + uEdge * e * (0.9 - clamp(vT * 0.5, 0.0, 0.7));
          float fade = 1.0 - smoothstep(1.4, 2.4, vT);
          float a = (0.9 * vApp) * fade;
          gl_FragColor = vec4(col, max(a, e * 0.9 * vApp * fade));
        }`,
    });
  }

  /** Rebuild cracks + shards for the given room box (and optional extra detected-plane surfaces). */
  build(box: Box, rng: Rng, extraSurfaces: Surface[] = [], reduced = false): void {
    this.box = box;
    this.disposeMeshes();
    const surfaces = boxSurfaces(box);
    const segs: Parameters<typeof ribbonArrays>[0] = [];
    for (const s of [...surfaces, ...extraSurfaces]) {
      for (const seg of generateCracks(s, rng, { density: reduced ? 0.4 : 0.6, maxSegments: reduced ? 140 : 240 }))
        segs.push({ seg, normal: s.normal });
    }
    const r = ribbonArrays(segs);
    const cg = new BufferGeometry();
    cg.setAttribute('position', new BufferAttribute(r.position, 3));
    cg.setAttribute('aSide', new BufferAttribute(r.side, 1));
    cg.setAttribute('aGlow', new BufferAttribute(r.glow, 1));
    cg.setIndex(new BufferAttribute(r.index, 1));
    this.crackMesh = new Mesh(cg, this.crackMat);
    this.crackMesh.frustumCulled = false;
    this.crackMesh.renderOrder = 4;
    this.add(this.crackMesh);

    // shards
    const tris = generateShards(surfaces, rng, reduced ? 0.8 : 0.6);
    const n = tris.length * 3;
    const pos = new Float32Array(n * 3);
    const center = new Float32Array(n * 3);
    const axis = new Float32Array(n * 3);
    const rnd = new Float32Array(n * 4);
    const bary = new Float32Array(n * 3);
    const origin = new Vector3(box.center.x, 0, box.center.z);
    let maxD = 0.001;
    for (const t of tris) maxD = Math.max(maxD, Math.hypot(t.a.x - origin.x, t.a.y, t.a.z - origin.z));
    tris.forEach((t, i) => {
      const cx = (t.a.x + t.b.x + t.c.x) / 3;
      const cy = (t.a.y + t.b.y + t.c.y) / 3;
      const cz = (t.a.z + t.b.z + t.c.z) / 3;
      // distance from the crack origin is applied later via setOrigin(); store neutral random now
      const ax = rng() - 0.5;
      const ay = rng() - 0.5;
      const az = rng() - 0.5;
      const spin = (rng() - 0.5) * 7;
      const out = 0.2 + rng() * 1.1;
      const delayRand = rng();
      const appearRand = rng();
      [t.a, t.b, t.c].forEach((v, k) => {
        const o = i * 3 + k;
        pos.set([v.x, v.y, v.z], o * 3);
        center.set([cx, cy, cz], o * 3);
        axis.set([ax, ay, az], o * 3);
        rnd.set([delayRand, spin, out, appearRand], o * 4);
        bary.set([k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0], o * 3);
      });
    });
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(pos, 3));
    sg.setAttribute('aCenter', new BufferAttribute(center, 3));
    sg.setAttribute('aAxis', new BufferAttribute(axis, 3));
    sg.setAttribute('aRnd', new BufferAttribute(rnd, 4));
    sg.setAttribute('aBary', new BufferAttribute(bary, 3));
    this.shardMesh = new Mesh(sg, this.shardMat);
    this.shardMesh.frustumCulled = false;
    this.shardMesh.renderOrder = 5;
    this.shardMesh.visible = false;
    this.add(this.shardMesh);
    this.maxDist = maxD * 1.6;
    this.crackMat.uniforms.uMaxDist.value = this.maxDist;
    this.reset();
  }

  /** Where the crack front starts (world). */
  setOrigin(p: Vector3): void {
    this.crackMat.uniforms.uOrigin.value.copy(p);
    this.shardMat.uniforms.uOrigin.value.copy(p);
  }

  setCrack(progress: number, time: number, flash = 1): void {
    this.crackMat.uniforms.uProgress.value = progress;
    this.crackMat.uniforms.uTime.value = time;
    this.crackMat.uniforms.uFlash.value = flash;
    if (this.crackMesh) this.crackMesh.visible = progress > 0.001;
  }

  /** @param showT seconds since the shards materialised (-1 hides them) @param fall seconds of falling */
  setShards(showT: number, fall: number, time: number): void {
    if (!this.shardMesh) return;
    this.shardMesh.visible = showT >= 0 && fall < 3.6;
    this.shardMat.uniforms.uShowT.value = showT;
    this.shardMat.uniforms.uFall.value = fall;
    this.shardMat.uniforms.uTime.value = time;
  }

  hideCracks(): void {
    if (this.crackMesh) this.crackMesh.visible = false;
  }

  reset(): void {
    this.setCrack(0, 0);
    this.setShards(-1, 0, 0);
  }

  private disposeMeshes(): void {
    for (const m of [this.crackMesh, this.shardMesh]) {
      if (m) {
        m.geometry.dispose();
        this.remove(m);
      }
    }
    this.crackMesh = this.shardMesh = null;
  }
}
