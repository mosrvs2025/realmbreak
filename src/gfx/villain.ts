/**
 * The Null Sovereign — an original, procedurally built low-poly villain (~2 m tall).
 * Everything is primitives + flat shading: no external models, no copyrighted design.
 *
 * Animation is fully procedural: each named pose is a table of joint rotations that the rig eases toward,
 * layered with breathing / hover. Teleport in/out uses a sweeping clip plane + light pillar.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Plane,
  ShaderMaterial,
  Vector3,
  ConeGeometry,
  BufferGeometry,
  type Material,
} from 'three';
import { clamp, damp } from '../core/math';
import { ContactShadow } from './fx';
import { PAL } from './palette';

type JointName =
  | 'spine'
  | 'head'
  | 'uArmL'
  | 'uArmR'
  | 'fArmL'
  | 'fArmR'
  | 'thighL'
  | 'thighR'
  | 'shinL'
  | 'shinR';
type Rot = [number, number, number];
export interface Pose {
  /** hips height offset (m) */
  hips: number;
  /** body yaw lean (rad) applied to the whole hips */
  lean: number;
  j: Record<JointName, Rot>;
}

const J = (o: Partial<Record<JointName, Rot>>): Record<JointName, Rot> => ({
  spine: [0, 0, 0],
  head: [0, 0, 0],
  uArmL: [0.08, 0, 0.22],
  uArmR: [0.08, 0, -0.22],
  fArmL: [-0.45, 0, 0],
  fArmR: [-0.45, 0, 0],
  thighL: [0, 0, 0.07],
  thighR: [0, 0, -0.07],
  shinL: [0.04, 0, 0],
  shinR: [0.04, 0, 0],
  ...o,
});

export const POSES = {
  idle: { hips: 0, lean: 0, j: J({ spine: [0.05, 0, 0] }) },
  taunt: {
    hips: 0,
    lean: 0,
    j: J({
      spine: [-0.14, 0, 0],
      head: [-0.35, 0.1, 0.08],
      uArmL: [0, 0, 1.2],
      uArmR: [0, 0, -1.2],
      fArmL: [-0.25, 0, 0],
      fArmR: [-0.25, 0, 0],
    }),
  },
  windup: {
    hips: -0.04,
    lean: 0,
    j: J({
      spine: [0.02, 0.55, 0],
      head: [0.05, -0.3, 0],
      uArmR: [1.1, 0, -0.55],
      fArmR: [-1.3, 0, 0],
      uArmL: [-0.8, 0, 0.35],
      fArmL: [-0.4, 0, 0],
    }),
  },
  throw: {
    hips: -0.04,
    lean: 0,
    j: J({
      spine: [0.18, -0.5, 0],
      head: [0.05, 0.35, 0],
      uArmR: [-1.65, 0, -0.1],
      fArmR: [-0.08, 0, 0],
      uArmL: [0.4, 0, 0.5],
    }),
  },
  beam: {
    hips: -0.1,
    lean: 0,
    j: J({
      spine: [0.14, 0, 0],
      head: [-0.05, 0, 0],
      uArmL: [-1.5, 0, 0.1],
      uArmR: [-1.5, 0, -0.1],
      fArmL: [-0.04, 0, 0],
      fArmR: [-0.04, 0, 0],
      thighL: [-0.35, 0, 0.18],
      thighR: [0.4, 0, -0.18],
      shinL: [0.5, 0, 0],
      shinR: [0.1, 0, 0],
    }),
  },
  defeat: {
    hips: -0.6,
    lean: 0,
    j: J({
      spine: [0.55, 0, 0.1],
      head: [0.6, 0, 0.2],
      uArmL: [0.3, 0, 0.35],
      uArmR: [0.5, 0, -0.35],
      fArmL: [-0.2, 0, 0],
      fArmR: [-0.2, 0, 0],
      thighL: [-1.45, 0, 0.2],
      thighR: [-1.3, 0, -0.2],
      shinL: [2.5, 0, 0],
      shinR: [2.3, 0, 0],
    }),
  },
  victory: {
    hips: 0,
    lean: 0,
    j: J({
      spine: [-0.2, 0, 0],
      head: [-0.5, 0, 0],
      uArmL: [0, 0, 2.7],
      uArmR: [0, 0, -2.7],
      fArmL: [-0.15, 0, 0],
      fArmR: [-0.15, 0, 0],
    }),
  },
} satisfies Record<string, Pose>;
export type PoseName = keyof typeof POSES;

const JOINTS: JointName[] = ['spine', 'head', 'uArmL', 'uArmR', 'fArmL', 'fArmR', 'thighL', 'thighR', 'shinL', 'shinR'];

export class Villain extends Group {
  /** floor-level group the whole body hangs from */
  readonly rig = new Group();
  readonly shadow = new ContactShadow(0.7, 0.6);
  private readonly joints = {} as Record<JointName, Object3D>;
  private readonly hips = new Group();
  private readonly cur = {} as Record<JointName, Rot>;
  private curHips = 0;
  private pose: PoseName = 'idle';
  private readonly clip = new Plane(new Vector3(0, -1, 0), 0);
  private readonly bodyMats: Material[] = [];
  private readonly glowMats: MeshBasicMaterial[] = [];
  private readonly pillar: Mesh;
  private pillarMat: ShaderMaterial;
  private readonly handL = new Object3D();
  private readonly handR = new Object3D();
  private readonly eyes: Mesh[] = [];
  private readonly core: Mesh;
  private readonly cape: Group;
  private time = 0;
  /** 0..1 how much of the body is revealed (feet → head). */
  reveal = 0;
  /** seconds until a timed action ends */
  private timeline: { name: PoseName; t: number }[] = [];
  private timelineT = 0;
  private onThrow: (() => void) | null = null;
  private thrown = false;
  /** world-space y of the floor under the villain */
  floorY = 0;

  readonly height = 2.12;

  constructor() {
    super();
    this.add(this.shadow);
    this.add(this.rig);
    this.rig.add(this.hips);

    const armor = new MeshStandardMaterial({ color: PAL.armor, roughness: 0.55, metalness: 0.5, flatShading: true });
    const armorLight = new MeshStandardMaterial({ color: PAL.armorLight, roughness: 0.5, metalness: 0.6, flatShading: true });
    const skin = new MeshStandardMaterial({ color: PAL.skin, roughness: 0.7, metalness: 0.1, flatShading: true });
    const capeMat = new MeshStandardMaterial({ color: 0x1a0f2c, roughness: 0.9, flatShading: true, side: DoubleSide });
    const glow = new MeshBasicMaterial({ color: PAL.villain });
    const glow2 = new MeshBasicMaterial({ color: PAL.ember });
    this.bodyMats.push(armor, armorLight, skin, capeMat);
    this.glowMats.push(glow, glow2);
    for (const m of [...this.bodyMats, ...this.glowMats]) m.clippingPlanes = [this.clip];

    const mk = (g: BufferGeometry, m: Material, parent: Object3D, p: [number, number, number] = [0, 0, 0], r: Rot = [0, 0, 0], s: [number, number, number] = [1, 1, 1]): Mesh => {
      const mesh = new Mesh(g, m);
      mesh.position.set(...p);
      mesh.rotation.set(...r);
      mesh.scale.set(...s);
      parent.add(mesh);
      return mesh;
    };
    const grp = (parent: Object3D, p: [number, number, number]): Group => {
      const g = new Group();
      g.position.set(...p);
      parent.add(g);
      return g;
    };
    /** limb whose pivot is at its top */
    const limb = (len: number, r0: number, r1: number, m: Material, parent: Object3D): Mesh =>
      mk(new CylinderGeometry(r0, r1, len, 6, 1).translate(0, -len / 2, 0), m, parent);

    // --- hips / pelvis
    this.hips.position.y = 0.95;
    mk(new BoxGeometry(0.36, 0.2, 0.24), armor, this.hips, [0, 0, 0]);
    mk(new BoxGeometry(0.42, 0.06, 0.28), armorLight, this.hips, [0, 0.1, 0]);
    mk(new ConeGeometry(0.1, 0.34, 4), glow, this.hips, [0, -0.16, 0.12], [Math.PI, 0.8, 0], [1, 1, 0.4]); // belt sigil

    // --- spine / torso
    const spine = grp(this.hips, [0, 0.08, 0]);
    this.joints.spine = spine;
    mk(new CylinderGeometry(0.3, 0.2, 0.52, 6, 1), armor, spine, [0, 0.3, 0], [0, Math.PI / 6, 0], [1, 1, 0.66]);
    mk(new IcosahedronGeometry(0.075, 0), glow2, spine, [0, 0.36, 0.2]);
    this.core = mk(new IcosahedronGeometry(0.13, 1), glow, spine, [0, 0.36, 0.17], [0, 0, 0], [0.5, 0.5, 0.35]);
    for (let i = -1; i <= 1; i += 2) mk(new BoxGeometry(0.02, 0.4, 0.04), armorLight, spine, [i * 0.12, 0.3, 0.2], [0, 0, i * 0.18]);

    const chest = grp(spine, [0, 0.55, 0]);
    mk(new BoxGeometry(0.6, 0.12, 0.3), armorLight, chest, [0, 0.0, 0]);

    // --- head
    const neck = grp(chest, [0, 0.12, 0]);
    mk(new CylinderGeometry(0.06, 0.07, 0.1, 6), skin, neck, [0, 0.03, 0]);
    const head = grp(neck, [0, 0.12, 0.01]);
    this.joints.head = head;
    mk(new IcosahedronGeometry(0.16, 0), armor, head, [0, 0.1, 0], [0, 0, 0], [0.88, 1.12, 1]);
    mk(new BoxGeometry(0.2, 0.06, 0.1), armorLight, head, [0, 0.02, 0.12]); // jaw plate
    for (const s of [-1, 1]) {
      this.eyes.push(mk(new BoxGeometry(0.075, 0.022, 0.03), glow, head, [s * 0.062, 0.115, 0.14], [0, 0, s * -0.32]));
      // horns
      mk(new ConeGeometry(0.045, 0.34, 5), armorLight, head, [s * 0.12, 0.3, -0.02], [-0.35, 0, s * -0.55]);
    }
    mk(new ConeGeometry(0.05, 0.4, 4), armor, head, [0, 0.3, -0.06], [-0.2, 0.4, 0]); // crest

    // --- arms
    for (const s of [1, -1] as const) {
      const side = s === 1 ? 'L' : 'R';
      const shoulder = grp(chest, [s * 0.36, 0.02, 0]);
      mk(new IcosahedronGeometry(0.14, 0), armorLight, shoulder, [s * 0.03, 0.03, 0]);
      mk(new ConeGeometry(0.075, 0.32, 5), armor, shoulder, [s * 0.1, 0.17, -0.02], [0, 0, -s * 0.9]);
      const u = grp(shoulder, [0, 0, 0]);
      this.joints[`uArm${side}` as JointName] = u;
      limb(0.32, 0.065, 0.052, skin, u);
      const elbow = grp(u, [0, -0.32, 0]);
      mk(new IcosahedronGeometry(0.06, 0), armorLight, elbow);
      const f = grp(elbow, [0, 0, 0]);
      this.joints[`fArm${side}` as JointName] = f;
      limb(0.3, 0.075, 0.06, armor, f);
      mk(new CylinderGeometry(0.085, 0.07, 0.12, 6), armorLight, f, [0, -0.16, 0]);
      const hand = s === 1 ? this.handL : this.handR;
      hand.position.set(0, -0.36, 0);
      f.add(hand);
      mk(new BoxGeometry(0.09, 0.12, 0.05), skin, hand, [0, -0.02, 0]);
      mk(new IcosahedronGeometry(0.03, 0), glow, hand, [0, -0.03, 0.04]);
    }

    // --- legs
    for (const s of [1, -1] as const) {
      const side = s === 1 ? 'L' : 'R';
      const hip = grp(this.hips, [s * 0.14, -0.06, 0]);
      const th = grp(hip, [0, 0, 0]);
      this.joints[`thigh${side}` as JointName] = th;
      limb(0.46, 0.1, 0.075, armor, th);
      const knee = grp(th, [0, -0.46, 0]);
      mk(new IcosahedronGeometry(0.07, 0), armorLight, knee, [0, 0, 0.04]);
      const sh = grp(knee, [0, 0, 0]);
      this.joints[`shin${side}` as JointName] = sh;
      limb(0.44, 0.075, 0.06, armorLight, sh);
      mk(new BoxGeometry(0.12, 0.07, 0.26), armor, sh, [0, -0.44, 0.06]);
    }

    // --- cape: five spiky strips
    this.cape = grp(chest, [0, 0.0, -0.17]);
    for (let i = -2; i <= 2; i++) {
      const strip = mk(
        new ConeGeometry(0.1, 1.15 - Math.abs(i) * 0.12, 3).translate(0, -(1.15 - Math.abs(i) * 0.12) / 2, 0).rotateX(Math.PI),
        capeMat,
        this.cape,
        [i * 0.14, 0.05, 0],
        [0.12 + Math.abs(i) * 0.03, 0, i * 0.08],
      );
      strip.rotation.x = Math.PI + 0.12; // tip down
    }

    // --- teleport pillar
    this.pillarMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: { uA: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);}`,
      fragmentShader: `uniform float uA; varying vec2 vUv; void main(){
        float edge = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 1.5);
        float fadeTop = (1.0 - smoothstep(0.5, 1.0, vUv.y)) * smoothstep(0.0, 0.08, vUv.y);
        float bands = 0.75 + 0.25 * sin(vUv.y * 60.0 - uA * 20.0);
        gl_FragColor = vec4(vec3(1.0, 0.45, 0.65) * (0.6 + edge), edge * fadeTop * bands * uA);
      }`,
    });
    this.pillar = new Mesh(new CylinderGeometry(0.45, 0.45, 2.55, 20, 1, true).translate(0, 1.275, 0), this.pillarMat);
    this.pillar.renderOrder = 6;
    this.pillar.visible = false;
    this.add(this.pillar);

    for (const k of JOINTS) this.cur[k] = [...POSES.idle.j[k]] as Rot;
    this.setReveal(0);
  }

  /** Called whenever the world floor under the villain is known. */
  setFloor(y: number): void {
    this.floorY = y;
    this.position.y = y;
  }

  /** 0 = nothing visible, 1 = fully visible. */
  setReveal(r: number): void {
    this.reveal = clamp(r);
    const visible = this.reveal > 0.001;
    this.rig.visible = visible;
    this.shadow.visible = visible;
    this.clip.constant = this.floorY + (this.height + 0.5) * this.reveal;
    this.clip.normal.set(0, -1, 0);
    // The clip plane lives in world space; keep it on the villain's floor even when the group moves.
    this.clip.constant = this.position.y + (this.height + 0.5) * this.reveal;
    this.shadow.setOpacity(0.6 * clamp(this.reveal * 2));
  }

  get clipPlane(): Plane {
    return this.clip;
  }

  setPose(p: PoseName): void {
    this.pose = p;
  }

  get currentPose(): PoseName {
    return this.pose;
  }

  /** Play a throw: windup -> throw (callback fires at release) -> back to idle. */
  playThrow(onThrow: () => void): void {
    this.timeline = [
      { name: 'windup', t: 0.45 },
      { name: 'throw', t: 0.35 },
      { name: 'idle', t: 0 },
    ];
    this.timelineT = 0;
    this.onThrow = onThrow;
    this.thrown = false;
  }

  get busy(): boolean {
    return this.timeline.length > 0;
  }

  /** World position of a hand. */
  handWorld(side: 'L' | 'R', out = new Vector3()): Vector3 {
    this.updateMatrixWorld(true);
    return (side === 'L' ? this.handL : this.handR).getWorldPosition(out);
  }

  /** World position of the core (chest). */
  coreWorld(out = new Vector3()): Vector3 {
    this.updateMatrixWorld(true);
    return this.core.getWorldPosition(out);
  }

  /** Yaw the whole villain so +Z faces `target` (horizontal). */
  faceTowards(target: Vector3): void {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    this.rotation.y = Math.atan2(dx, dz);
  }

  /** 0..1 for the light pillar (teleport effect). */
  setPillar(a: number, radius = 1): void {
    this.pillar.visible = a > 0.01;
    this.pillarMat.uniforms.uA.value = a;
    this.pillar.scale.set(radius, 1, radius);
  }

  /** Brightness pulse for glowing parts, 1 = normal. */
  update(dt: number, reducedMotion: boolean): void {
    this.time += dt;
    const t = this.time;

    // timeline
    if (this.timeline.length) {
      const step = this.timeline[0];
      this.pose = step.name;
      this.timelineT += dt;
      if (step.name === 'throw' && !this.thrown && this.timelineT > 0.12) {
        this.thrown = true;
        this.onThrow?.();
      }
      if (step.t > 0 && this.timelineT >= step.t) {
        this.timeline.shift();
        this.timelineT = 0;
        if (this.timeline.length === 1 && this.timeline[0].t === 0) {
          this.pose = this.timeline[0].name;
          this.timeline = [];
        }
      }
    }

    const target = POSES[this.pose];
    const lam = this.pose === 'throw' ? 26 : this.pose === 'windup' ? 14 : 8;
    for (const k of JOINTS) {
      const c = this.cur[k];
      const tg = target.j[k];
      c[0] = damp(c[0], tg[0], lam, dt);
      c[1] = damp(c[1], tg[1], lam, dt);
      c[2] = damp(c[2], tg[2], lam, dt);
    }
    this.curHips = damp(this.curHips, target.hips, 7, dt);

    const breathe = reducedMotion ? 0 : Math.sin(t * 1.9);
    const sway = reducedMotion ? 0 : Math.sin(t * 0.8);
    for (const k of JOINTS) {
      const c = this.cur[k];
      let [x, y, z] = c;
      if (k === 'spine') x += breathe * 0.012;
      if (k === 'uArmL') z += breathe * 0.03;
      if (k === 'uArmR') z -= breathe * 0.03;
      if (k === 'head') y += sway * 0.05;
      this.joints[k].rotation.set(x, y, z);
    }
    this.hips.position.y = 0.95 + this.curHips + breathe * 0.006;
    this.hips.rotation.z = sway * 0.012;

    this.cape.rotation.x = 0.08 + (reducedMotion ? 0 : Math.sin(t * 1.3) * 0.05);
    const pulse = 0.85 + 0.15 * Math.sin(t * 5);
    this.core.scale.setScalar(0.55 * (0.9 + 0.15 * Math.sin(t * 3.1)));
    for (const m of this.glowMats) m.color.copy(m === this.glowMats[0] ? PAL.villain : PAL.ember).multiplyScalar(pulse + 0.3);
    for (const e of this.eyes) e.scale.y = 1 + 0.2 * Math.sin(t * 2);

    // keep the clip plane glued to the villain's feet
    this.clip.constant = this.position.y + (this.height + 0.5) * this.reveal;
  }
}
