/**
 * Player gloves. Two visual styles that swap when the realm breaks:
 *  - 'room'  : translucent cyan "spirit" gloves (you are still in your room)
 *  - 'arena' : armoured gauntlets with glowing seams (you are in the arena)
 *
 * Three rigs share the styles: tracked hands (instanced joint spheres), controllers / desktop (fist mesh).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { PAL } from './palette';

export type GloveStyle = 'room' | 'arena';

const STYLE = {
  room: {
    body: new MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x2a9bff, emissiveIntensity: 0.9, transparent: true, opacity: 0.55, roughness: 0.3, metalness: 0 }),
    seam: new MeshBasicMaterial({ color: PAL.playerCore, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }),
    scale: 1.0,
  },
  arena: {
    body: new MeshStandardMaterial({ color: 0x1d2236, emissive: 0x0b1a44, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.85, flatShading: true }),
    seam: new MeshBasicMaterial({ color: PAL.player }),
    scale: 1.28,
  },
};

const FINGERS = [
  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
] as const;

/** Joint names in a flat, stable order (plus the segment pairs we draw between). */
export const HAND_JOINTS: string[] = ['wrist', ...FINGERS.flat()];
const SEGMENTS: [number, number][] = [];
FINGERS.forEach((chain) => {
  let prev = 0; // wrist
  chain.forEach((name) => {
    const idx = HAND_JOINTS.indexOf(name);
    SEGMENTS.push([prev, idx]);
    prev = idx;
  });
});

export interface JointSource {
  /** world position + radius of each joint in HAND_JOINTS order; false when tracking is lost */
  read(i: number, pos: Vector3, quat: Quaternion): number | null;
}

/** A hand drawn as spheres on every joint plus spheres at segment midpoints. */
export class HandGlove extends Group {
  private readonly mesh: InstancedMesh;
  private readonly seams: InstancedMesh;
  private readonly bracer: Mesh;
  private readonly pos: Vector3[] = HAND_JOINTS.map(() => new Vector3());
  private readonly rad: number[] = HAND_JOINTS.map(() => 0.008);
  private readonly dummy = new Object3D();
  private style: GloveStyle = 'room';
  valid = false;

  constructor() {
    super();
    const n = HAND_JOINTS.length + SEGMENTS.length;
    this.mesh = new InstancedMesh(new SphereGeometry(1, 8, 6), STYLE.room.body, n);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.seams = new InstancedMesh(new SphereGeometry(1, 6, 4), STYLE.room.seam, 5);
    this.seams.instanceMatrix.setUsage(DynamicDrawUsage);
    this.seams.frustumCulled = false;
    this.bracer = new Mesh(new CylinderGeometry(0.036, 0.04, 0.09, 8, 1, true), STYLE.arena.body);
    this.bracer.visible = false;
    this.bracer.frustumCulled = false;
    this.add(this.mesh, this.seams, this.bracer);
    this.visible = false;
  }

  setStyle(s: GloveStyle): void {
    this.style = s;
    this.mesh.material = STYLE[s].body;
    this.seams.material = STYLE[s].seam;
    this.bracer.visible = s === 'arena';
  }

  /** @param read fills `pos` for joint i and returns its radius, or null if unavailable */
  update(read: (i: number, out: Vector3) => number | null): void {
    let ok = 0;
    for (let i = 0; i < HAND_JOINTS.length; i++) {
      const r = read(i, this.pos[i]);
      if (r === null) continue;
      this.rad[i] = r;
      ok++;
    }
    this.valid = ok > 20;
    this.visible = this.valid;
    if (!this.valid) return;
    const k = STYLE[this.style].scale;
    const d = this.dummy;
    d.quaternion.identity();
    let n = 0;
    for (let i = 0; i < HAND_JOINTS.length; i++) {
      d.position.copy(this.pos[i]);
      d.scale.setScalar(Math.max(0.006, this.rad[i]) * 1.15 * k);
      d.updateMatrix();
      this.mesh.setMatrixAt(n++, d.matrix);
    }
    for (const [a, b] of SEGMENTS) {
      d.position.lerpVectors(this.pos[a], this.pos[b], 0.5);
      d.scale.setScalar(Math.max(0.006, (this.rad[a] + this.rad[b]) / 2) * 1.1 * k);
      d.updateMatrix();
      this.mesh.setMatrixAt(n++, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    // glowing fingertips / knuckle seams
    const tips = [4, 9, 14, 19, 24];
    tips.forEach((ji, si) => {
      d.position.copy(this.pos[ji]);
      d.scale.setScalar((this.style === 'arena' ? 0.011 : 0.007) * 1.0);
      d.updateMatrix();
      this.seams.setMatrixAt(si, d.matrix);
    });
    this.seams.instanceMatrix.needsUpdate = true;
    if (this.style === 'arena') {
      const wrist = this.pos[0];
      const mid = this.pos[HAND_JOINTS.indexOf('middle-finger-metacarpal')];
      this.bracer.position.copy(wrist).lerp(mid, -0.45);
      TMP_DIR.subVectors(mid, wrist).normalize();
      this.bracer.quaternion.setFromUnitVectors(UP, TMP_DIR);
    }
  }
}
const UP = new Vector3(0, 1, 0);
const TMP_DIR = new Vector3();

/** A simple faceted fist/glove used for controllers and the desktop view. */
export class FistGlove extends Group {
  private readonly body = new Group();
  private readonly parts: Mesh[] = [];
  private readonly glow: Mesh;
  private readonly cuff: Mesh;

  constructor(readonly side: 'L' | 'R') {
    super();
    const s = side === 'L' ? 1 : -1;
    const mk = (g: BoxGeometry | CylinderGeometry | SphereGeometry, x: number, y: number, z: number, rx = 0, rz = 0): Mesh => {
      const m = new Mesh(g, STYLE.room.body);
      m.position.set(x, y, z);
      m.rotation.set(rx, 0, rz);
      this.body.add(m);
      this.parts.push(m);
      return m;
    };
    mk(new BoxGeometry(0.085, 0.07, 0.1), 0, 0, 0); // palm block
    for (let i = 0; i < 4; i++) mk(new BoxGeometry(0.018, 0.02, 0.05), -0.03 + i * 0.02, 0.012, -0.07, -0.7); // curled fingers
    mk(new BoxGeometry(0.02, 0.022, 0.05), s * 0.052, 0.0, -0.03, 0, s * 0.5); // thumb
    this.cuff = mk(new CylinderGeometry(0.05, 0.056, 0.07, 8), 0, 0, 0.09, Math.PI / 2);
    this.glow = new Mesh(new SphereGeometry(0.012, 6, 4), STYLE.room.seam);
    this.glow.position.set(0, 0.02, -0.095);
    this.body.add(this.glow);
    this.add(this.body);
  }

  setStyle(s: GloveStyle): void {
    for (const m of this.parts) m.material = STYLE[s].body;
    this.glow.material = STYLE[s].seam;
    const k = s === 'arena' ? 1.25 : 1;
    this.body.scale.setScalar(k);
    this.cuff.scale.set(1, s === 'arena' ? 1.5 : 1, 1);
  }
}

