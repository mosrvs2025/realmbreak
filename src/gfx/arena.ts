/**
 * The sunlit tiled arena revealed after the realm breaks. Fully opaque (a sky dome + ground),
 * so in an AR session it completely replaces passthrough. Built from a handful of instanced meshes.
 */
import {
  BackSide,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  AdditiveBlending,
  type Scene,
} from 'three';
import { mulberry32, range } from '../core/math';
import { tileTexture } from './tex';
import { PAL } from './palette';

export class Arena extends Group {
  readonly sun = new DirectionalLight(0xfff0d6, 3.0);
  readonly hemi = new HemisphereLight(0xbfe0ff, 0xcdb89a, 1.1);
  private readonly sky: Mesh;
  private readonly skyMat: ShaderMaterial;
  private readonly sigil: Mesh;
  private readonly fog = new Fog(0xcfe3f2, 38, 120);
  private readonly sunDir = new Vector3(0.35, 0.55, -0.55).normalize();
  private time = 0;

  constructor() {
    super();
    this.name = 'arena';

    // --- sky dome
    this.skyMat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uSun: { value: this.sunDir.clone() }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform float uTime; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 horizon = vec3(0.85, 0.9, 0.93);
          vec3 zenith  = vec3(0.16, 0.42, 0.82);
          vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.55));
          float s = max(dot(d, normalize(uSun)), 0.0);
          col += vec3(1.0, 0.86, 0.6) * (pow(s, 600.0) * 3.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
          // drifting clouds
          vec2 uv = d.xz / (d.y + 0.35) * 1.6 + vec2(uTime * 0.01, 0.0);
          float c = smoothstep(0.52, 0.78, fbm(uv * 1.3));
          col = mix(col, vec3(1.0, 0.98, 0.95), c * smoothstep(0.02, 0.25, d.y) * 0.85);
          // far mountain haze below the horizon line
          col = mix(col, vec3(0.62, 0.7, 0.78), smoothstep(0.0, -0.18, d.y) * 0.9);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new Mesh(new SphereGeometry(180, 32, 16), this.skyMat);
    this.sky.renderOrder = -20;
    this.sky.frustumCulled = false;
    this.add(this.sky);

    // --- ground: tiled disc + inlay rings + centre sigil
    const tiles = tileTexture();
    tiles.repeat.set(26, 26);
    const ground = new Mesh(
      // subdivided (not a single triangle fan): huge triangles that cross the near plane can rasterise badly
      new RingGeometry(0.01, 30, 96, 14).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ map: tiles, roughness: 0.82, metalness: 0.0 }),
    );
    ground.name = 'arenaGround';
    this.add(ground);
    // edge skirt so the disc doesn't read as a floating plate
    const skirt = new Mesh(
      new CylinderGeometry(30, 30, 40, 72, 1, true).translate(0, -20, 0),
      new MeshStandardMaterial({ color: 0x8c8378, roughness: 1, side: BackSide }),
    );
    this.add(skirt);
    for (const [r0, r1, colr] of [
      [7.9, 8.1, PAL.player],
      [14.9, 15.1, PAL.villainDeep],
    ] as const) {
      const ring = new Mesh(
        new RingGeometry(r0, r1, 96).rotateX(-Math.PI / 2),
        new MeshBasicMaterial({ color: colr, transparent: true, opacity: 0.75, depthWrite: false }),
      );
      ring.position.y = 0.012;
      this.add(ring);
    }
    this.sigil = new Mesh(
      new RingGeometry(0.9, 1.0, 6).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: PAL.player, transparent: true, opacity: 0.8, depthWrite: false, blending: AdditiveBlending }),
    );
    this.sigil.position.y = 0.015;
    this.add(this.sigil);

    // --- pillars (instanced shafts + broken caps)
    const rng = mulberry32(404);
    const n = 16;
    const stone = new MeshStandardMaterial({ color: 0xcfc6b6, roughness: 0.85, flatShading: true });
    const shafts = new InstancedMesh(new CylinderGeometry(0.9, 1.05, 1, 8, 1), stone, n);
    const caps = new InstancedMesh(new CylinderGeometry(1.3, 1.3, 0.5, 8), stone, n);
    const o = new Object3D();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + range(rng, -0.05, 0.05);
      const r = 21 + range(rng, -0.6, 0.6);
      const h = i % 3 === 0 ? range(rng, 3, 5) : range(rng, 8, 11);
      o.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      o.rotation.set(0, rng() * 3, i % 3 === 0 ? range(rng, -0.05, 0.05) : 0);
      o.scale.set(1, h, 1);
      o.updateMatrix();
      shafts.setMatrixAt(i, o.matrix);
      o.position.y = h + 0.2;
      o.scale.set(i % 3 === 0 ? 0.0 : 1, 1, i % 3 === 0 ? 0.0 : 1);
      o.updateMatrix();
      caps.setMatrixAt(i, o.matrix);
    }
    this.add(shafts, caps);

    // arches / low wall segments between some pillars
    const wallMat = new MeshStandardMaterial({ color: 0xbdb3a2, roughness: 0.9, flatShading: true });
    const walls = new InstancedMesh(new CylinderGeometry(1, 1, 1, 6), wallMat, 10);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.2;
      o.position.set(Math.cos(a) * 25, 1.5, Math.sin(a) * 25);
      o.rotation.set(0, -a, 0);
      o.scale.set(0.7, 3 + (i % 3), 4 + (i % 4));
      o.updateMatrix();
      walls.setMatrixAt(i, o.matrix);
    }
    this.add(walls);

    // --- distant mountains + floating islands
    const mtn = new InstancedMesh(
      new ConeGeometry(1, 1, 5),
      new MeshBasicMaterial({ color: 0x8aa0b8, fog: false }),
      22,
    );
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + range(rng, -0.1, 0.1);
      const r = range(rng, 110, 140);
      const h = range(rng, 22, 60);
      o.position.set(Math.cos(a) * r, h / 2 - 8, Math.sin(a) * r);
      o.rotation.set(0, rng() * 3, 0);
      o.scale.set(range(rng, 22, 40), h, range(rng, 22, 40));
      o.updateMatrix();
      mtn.setMatrixAt(i, o.matrix);
    }
    this.add(mtn);
    const isl = new InstancedMesh(
      new IcosahedronGeometry(1, 1),
      new MeshStandardMaterial({ color: 0xa79d8c, roughness: 1, flatShading: true }),
      9,
    );
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      o.position.set(Math.cos(a) * range(rng, 45, 80), range(rng, 14, 38), Math.sin(a) * range(rng, 45, 80));
      o.rotation.set(rng(), rng(), rng());
      const s = range(rng, 2, 6);
      o.scale.set(s * 1.6, s * 0.7, s * 1.6);
      o.updateMatrix();
      isl.setMatrixAt(i, o.matrix);
    }
    this.add(isl);

    this.sun.position.copy(this.sunDir).multiplyScalar(60);
    this.sun.castShadow = false;
    this.visible = false;
  }

  /** Show/hide the arena and (de)activate scene fog. */
  setActive(active: boolean, scene: Scene): void {
    this.visible = active;
    scene.fog = active ? this.fog : null;
  }

  update(dt: number): void {
    this.time += dt;
    this.skyMat.uniforms.uTime.value = this.time;
    this.sigil.rotation.y += dt * 0.15;
    (this.sigil.material as MeshBasicMaterial).opacity = 0.55 + 0.25 * Math.sin(this.time * 2);
  }

  /** Keep the sky centred on the viewer so the horizon never parallaxes. */
  followViewer(p: Vector3): void {
    this.sky.position.set(p.x, 0, p.z);
  }

  static readonly horizon = new Color(0xcfe3f2);
}
