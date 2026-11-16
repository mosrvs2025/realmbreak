import {
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Group,
  Vector3,
  MeshBasicMaterial,
  Quaternion,
} from 'three';
import { mulberry32, range, smoothstep } from '../core/math';
import { radialTexture } from './tex';

interface Rock {
  x: number;
  z: number;
  size: number;
  threshold: number;
  height: number;
  phase: number;
  spin: Vector3;
  rot: Quaternion;
  lifted: boolean;
}

/**
 * Procedural rocks that tear loose from the floor as the orb charges.
 * One InstancedMesh for all rocks + one for their soft contact shadows.
 */
export class RockField extends Group {
  private readonly rocks: Rock[] = [];
  private readonly mesh: InstancedMesh;
  private readonly shadows: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly dq = new Quaternion();
  private readonly dummyAxis = new Vector3();
  private time = 0;
  /** world floor height */
  floorY = 0;

  constructor(readonly total = 36) {
    super();
    const geo = new IcosahedronGeometry(0.5, 1);
    // rough up the geometry once so every instance looks like a chunk of broken stone
    const rng = mulberry32(12);
    const pos = geo.attributes.position;
    const seen = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      let k = seen.get(key);
      if (k === undefined) {
        k = 0.78 + rng() * 0.42;
        seen.set(key, k);
      }
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.82, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    this.mesh = new InstancedMesh(
      geo,
      new MeshStandardMaterial({ color: 0x8a8378, roughness: 0.95, metalness: 0.02, flatShading: true }),
      total,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new Color());
    const tint = new Color();
    for (let i = 0; i < total; i++) {
      tint.setHSL(0.08 + rng() * 0.04, 0.12 + rng() * 0.1, 0.38 + rng() * 0.2);
      this.mesh.setColorAt(i, tint);
    }

    this.shadows = new InstancedMesh(
      new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        map: radialTexture(),
        color: 0x000000,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
      total,
    );
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 2;
    this.add(this.shadows, this.mesh);

    for (let i = 0; i < total; i++) {
      this.rocks.push({
        x: 0,
        z: 0,
        size: 0.1,
        threshold: 0,
        height: 0,
        phase: 0,
        spin: new Vector3(),
        rot: new Quaternion(),
        lifted: false,
      });
    }
  }

  /**
   * (Re)scatter the rocks around `center` (floor point), keeping `keepClear` free (the villain).
   * `facing` is the polar angle (atan2(z, x)) of the direction the player is looking.
   */
  scatter(center: Vector3, keepClear: Vector3 | null, seed = 21, facing = 0): void {
    const rng = mulberry32(seed);
    this.floorY = center.y;
    this.rocks.forEach((r, i) => {
      let tries = 0;
      do {
        // 70% of the rocks fan out in front of the player (where they are looking), the rest surround them
        const a = rng() < 0.7 ? facing + range(rng, -1.7, 1.7) : rng() * Math.PI * 2;
        const d = range(rng, 0.7, 3.3);
        r.x = center.x + Math.cos(a) * d;
        r.z = center.z + Math.sin(a) * d;
        tries++;
      } while (keepClear && Math.hypot(r.x - keepClear.x, r.z - keepClear.z) < 1.0 && tries < 20);
      r.size = range(rng, 0.07, 0.3);
      r.threshold = 0.05 + (i / this.total) * 0.85 + rng() * 0.05;
      r.height = range(rng, 0.35, 1.9);
      r.phase = rng() * Math.PI * 2;
      r.spin.set(range(rng, -1, 1), range(rng, -1, 1), range(rng, -1, 1)).multiplyScalar(range(rng, 0.4, 1.4));
      r.rot.setFromAxisAngle(this.dummyAxis.set(rng(), rng(), rng()).normalize(), rng() * 6.28);
      r.lifted = false;
    });
  }

  /**
   * @param charge 0..1
   * @param fade 0..1 multiplier applied to size (used to dissolve rocks after the realm breaks)
   * @param onLift called once per rock when it tears off the floor
   */
  update(dt: number, charge: number, fade: number, onLift?: (p: Vector3) => void): void {
    this.time += dt;
    const p = new Vector3();
    let any = false;
    for (let i = 0; i < this.total; i++) {
      const r = this.rocks[i];
      const emerge = smoothstep(r.threshold - 0.04, r.threshold + 0.06, charge);
      const lift = smoothstep(r.threshold, r.threshold + 0.3, charge);
      const s = r.size * emerge * fade;
      if (s < 0.002) {
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0);
        this.dummy.quaternion.identity();
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        this.shadows.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      any = true;
      if (!r.lifted && lift > 0.05) {
        r.lifted = true;
        onLift?.(p.set(r.x, this.floorY + 0.05, r.z));
      }
      if (lift < 0.01) r.lifted = false;
      const bob = Math.sin(this.time * 1.3 + r.phase) * 0.06 * lift;
      const y = this.floorY + s * 0.35 + lift * r.height + bob;
      const spinAmt = lift * dt;
      this.dq.setFromAxisAngle(this.dummyAxis.copy(r.spin).normalize(), r.spin.length() * spinAmt);
      r.rot.premultiply(this.dq);
      this.dummy.position.set(r.x + Math.sin(this.time * 0.4 + r.phase) * 0.05 * lift, y, r.z);
      this.dummy.quaternion.copy(r.rot);
      this.dummy.scale.setScalar(s * 2);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      const sh = s * 2.2 * (1 + lift * 0.7);
      this.dummy.position.set(r.x, this.floorY + 0.006, r.z);
      this.dummy.quaternion.identity();
      this.dummy.scale.set(sh, 1, sh);
      this.dummy.updateMatrix();
      this.shadows.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.mesh.visible = this.shadows.visible = any || charge > 0;
  }

  /** Highest lifted rock (for tests/debug). */
  get lifted(): number {
    return this.rocks.filter((r) => r.lifted).length;
  }
}

