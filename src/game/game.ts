/**
 * Game — orchestrates scene, state machine, input and effects for both desktop and WebXR.
 *
 * The *rules* live in src/core (pure + tested). This file only maps machine state to visuals.
 */
import {
  AdditiveBlending,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  CylinderGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Sfx } from '../audio/sfx';
import { type Box, fitRoomBox } from '../core/cracks';
import { GameMachine, type FrameInput, type MachineEvent, type Phase, DEFAULT_MACHINE } from '../core/machine';
import { clamp, damp, easeOutCubic, mulberry32, smoothstep, v3 } from '../core/math';
import { Arena } from '../gfx/arena';
import { BeamClash } from '../gfx/beams';
import { ParticleSystem } from '../gfx/fx';
import { FistGlove, HAND_JOINTS, HandGlove, type GloveStyle } from '../gfx/gloves';
import { ChargeOrb, OrbPool } from '../gfx/orbs';
import { PAL } from '../gfx/palette';
import { RockField } from '../gfx/rocks';
import { SimulatedRoom } from '../gfx/room';
import { RoomShell } from '../gfx/shell';
import { TextPanel } from '../gfx/text';
import { Villain } from '../gfx/villain';
import { AuraVignette } from '../gfx/vignette';
import { XRHelper } from '../xr/xr';
import { type InputSnapshot, PointerInput, XRInput } from './input';
import { LINES, PROMPTS, type InputKind, pick } from './script';

export interface GameOptions {
  parent: HTMLElement;
  reducedMotion: boolean;
  onExit?: () => void;
  onEvent?: (name: string, data?: Record<string, string | number>) => void;
}

interface Teleport {
  dir: 1 | -1;
  t: number;
  dur: number;
}

interface Step {
  at: number;
  fn: () => void;
  done: boolean;
}

const HEAD_DESKTOP = new Vector3(0, 1.6, 0);
const ARENA_DISTANCE = 5.2;

export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.05, 400);
  readonly sfx = new Sfx();
  readonly machine: GameMachine;
  readonly xr: XRHelper;

  // world objects
  private readonly world = new Group();
  private readonly villain = new Villain();
  private readonly orbs = new OrbPool(12);
  private readonly charge = new ChargeOrb();
  private readonly rocks = new RockField(34);
  private readonly shell = new RoomShell();
  private readonly arena = new Arena();
  private readonly beams = new BeamClash();
  private readonly particles: ParticleSystem;
  private readonly vignette = new AuraVignette();
  private room: SimulatedRoom | null = null;
  private readonly reticle: Mesh;

  // text
  private readonly speech = new TextPanel(1.25, 0.46, 640);
  private readonly hint = new TextPanel(0.8, 0.26, 640);
  private readonly title = new TextPanel(1.5, 0.5, 768);
  private readonly button = new TextPanel(0.5, 0.17, 400);
  private readonly lights: { hemi: HemisphereLight; dir: DirectionalLight };

  // input
  private readonly pointer: PointerInput;
  private readonly xrInput: XRInput;
  private input: InputSnapshot | null = null;
  private inputKind: InputKind = 'pointer';

  // gloves
  private readonly handGloves = [new HandGlove(), new HandGlove()];
  private readonly fists: FistGlove[] = [];
  private readonly deskGloves = [new FistGlove('L'), new FistGlove('R')];
  /** world-space stand-in hands used by the desktop side-on camera during the beam clash */
  private readonly avatarGloves = [new FistGlove('L'), new FistGlove('R')];
  private readonly tmpCam = new PerspectiveCamera();
  private cine = 0;
  // scratch vectors (no per-frame allocation in the hot path)
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpC = new Vector3();
  private readonly tmpD = new Vector3();
  private readonly tmpOrigin = new Vector3();
  private gloveStyle: GloveStyle = 'room';

  // state
  private readonly rng = mulberry32(Math.floor(Math.random() * 1e9));
  private readonly head = new Vector3(0, 1.6, 0);
  private readonly fwd = new Vector3(0, 0, -1);
  private floorY = 0;
  private playerPos = new Vector3();
  private villainSpawn = new Vector3(0, 0, -2.6);
  private arenaSpot = new Vector3();
  private dirToVillain = new Vector3(0, 0, -1);
  private tele: Teleport | null = null;
  private steps: Step[] = [];
  private time = 0;
  private running = false;
  private isXR = false;
  private reduced: boolean;
  private flash = 0;
  private pointerNdc = new Vector2();
  private pointerParallax = new Vector2();
  private tapQueued: Vector2 | null = null;
  private readonly ray = new Raycaster();
  private dwell = 0;
  private buttonCooldown = 0;
  private shown = { speech: 0 };
  private typing: { text: string; t: number; hold: number; lastBlip: number } | null = null;
  private orbTimer = 3;
  private throwIndex = 0;
  private chargeLineIndex = 0;
  private lastCharge = 0;
  private pumpKick = 0;
  private lastPumpSfx = 0;
  private fireT = 0;
  private endT = 0;
  private villainDeadT = -1;
  private frameTimes: number[] = [];
  private quality = 1;
  private lastFrameT = 0;
  private spawned = false;
  private shardsShownAt = -1;
  private arenaOn = false;
  /** scripted input used by debug seeking / tests */
  private scripted: Partial<InputSnapshot> | null = null;
  private frozen = false;

  constructor(private readonly opts: GameOptions) {
    this.reduced = opts.reducedMotion;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x05070d, 1);
    renderer.localClippingEnabled = true;
    renderer.xr.enabled = true;
    renderer.domElement.className = 'rb-canvas';
    renderer.domElement.setAttribute('aria-label', 'REALMBREAK game view');
    renderer.domElement.style.touchAction = 'none';
    opts.parent.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.machine = new GameMachine(this.rng, { ...DEFAULT_MACHINE, reducedMotion: this.reduced });
    this.xr = new XRHelper(renderer, this.scene);
    this.xrInput = new XRInput(this.xr);
    this.pointer = new PointerInput(renderer.domElement);
    this.particles = new ParticleSystem(this.reduced ? 420 : 720);
    this.particles.density = this.reduced ? 0.5 : 1;
    this.beams.flashCap = this.reduced ? 0.45 : 1;

    // lights
    this.lights = {
      hemi: new HemisphereLight(0xcfd8ff, 0x403a35, 1.3),
      dir: new DirectionalLight(0xffffff, 2.2),
    };
    this.lights.dir.position.set(1.5, 4, 2.5);
    this.scene.add(this.lights.hemi, this.lights.dir, this.arena.sun, this.arena.hemi);

    // scene graph
    this.scene.add(this.camera, this.world);
    this.camera.add(this.vignette);
    this.world.add(
      this.arena,
      this.shell,
      this.rocks,
      this.villain,
      this.orbs,
      this.charge,
      this.beams,
      this.particles.mesh,
      ...this.handGloves,
      ...this.avatarGloves,
    );

    this.reticle = new Mesh(
      new RingGeometry(0.16, 0.2, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: PAL.player, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
    );
    this.reticle.visible = false;
    this.world.add(this.reticle);

    // controllers: fist gloves on the grips + a short pointer line for UI
    for (const slot of this.xr.slots) {
      const f = new FistGlove(slot === this.xr.slots[0] ? 'L' : 'R');
      f.visible = false;
      slot.grip.add(f);
      this.fists.push(f);
      const laser = new Mesh(
        new CylinderGeometry(0.0025, 0.0025, 1.2, 6).rotateX(Math.PI / 2).translate(0, 0, -0.6),
        new MeshBasicMaterial({ color: PAL.player, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }),
      );
      laser.name = 'laser';
      laser.visible = false;
      slot.ray.add(laser);
    }
    for (const g of this.deskGloves) this.camera.add(g);

    this.xr.onSelect = (slot) => {
      if (this.uiActive) this.tryButtonRay(slot.ray.matrixWorld.elements);
    };
    this.xr.onEnd = () => {
      this.isXR = false;
      this.stopLoops();
      this.opts.onExit?.();
    };

    this.hint.setText('', {});
    this.button.setText('REPLAY', { border: true, bg: 'rgba(8,14,34,0.85)', fontPx: 70 });
    this.shown.speech = 0;

    this.resize();
    window.addEventListener('resize', this.resize);
    renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.buildWorld();
  }

  // ------------------------------------------------------------------ lifecycle

  /** Begin on the desktop (non-XR) path. */
  async startDesktop(): Promise<void> {
    this.isXR = false;
    this.sfx.unlock();
    this.beginRun();
  }

  /** Begin an immersive AR session on Quest (or any WebXR AR device). */
  async startXR(): Promise<void> {
    const pending = this.xr.start('immersive-ar');
    this.sfx.unlock();
    await pending;
    this.isXR = true;
    this.beginRun();
  }

  private beginRun(): void {
    this.running = true;
    this.resetRun(false);
    this.renderer.setAnimationLoop((t, f) => this.frame(t, f));
    this.opts.onEvent?.('run_start', { mode: this.isXR ? 'xr' : 'desktop' });
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.stopLoops();
    this.sfx.setAmbient('none');
    if (this.xr.presenting) void this.xr.end();
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private stopLoops(): void {
    this.sfx.stopLoops();
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) this.stopLoops();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !this.isXR) {
      this.stop();
      this.opts.onExit?.();
    }
  };

  private readonly resize = (): void => {
    const p = this.renderer.domElement.parentElement;
    const w = p?.clientWidth || window.innerWidth;
    const h = p?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // narrow portrait screens need a wider vertical FOV to keep the villain in frame
    this.camera.fov = w / h < 0.8 ? 85 : 68;
    this.camera.updateProjectionMatrix();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.onPointerMove(e);
    this.tapQueued = this.pointerNdc.clone();
  };

  // ------------------------------------------------------------------ world construction

  private buildWorld(): void {
    this.arena.setActive(false, this.scene);
    this.beams.setActive(false);
    // panels are positioned in world space, so they live directly under the scene
    for (const t of [this.speech, this.hint, this.title, this.button]) this.scene.add(t);
  }

  private get uiActive(): boolean {
    return this.machine.phase === 'win' || this.machine.phase === 'lose';
  }

  private get reducedFactor(): number {
    return this.reduced ? 0.5 : 1;
  }

  /** Reset everything for a fresh run (first start or replay). */
  private resetRun(replay: boolean): void {
    this.steps = [];
    this.tele = null;
    this.typing = null;
    this.flash = 0;
    this.orbTimer = 3.5;
    this.throwIndex = 0;
    this.chargeLineIndex = 0;
    this.lastCharge = 0;
    this.fireT = 0;
    this.endT = 0;
    this.villainDeadT = -1;
    this.shardsShownAt = -1;
    this.orbs.reset();
    this.particles.clear();
    this.beams.setActive(false);
    this.charge.hideAll();
    this.shell.reset();
    this.arena.setActive(false, this.scene);
    this.arenaOn = false;
    this.setGloveStyle('room');
    this.setLightMode('room');
    this.villain.setReveal(0);
    this.villain.setPose('idle');
    this.villain.setPillar(0);
    this.title.show(false);
    this.button.show(false);
    this.speech.show(false);
    this.hint.show(false);
    this.reticle.visible = false;
    this.sfx.setAmbient('room');
    if (this.room) this.room.visible = true;
    this.renderer.setClearColor(0x05070d, this.isXR ? 0 : 1);

    if (replay) {
      this.machine.replay();
      this.placeVillain(this.villainSpawn, this.playerPos);
      this.rocks.scatter(this.playerPos.clone().setY(this.floorY), this.villainSpawn, Math.floor(this.rng() * 1000), Math.atan2(this.dirToVillain.z, this.dirToVillain.x));
      this.rocks.update(0, 0, 1);
      this.spawned = true;
      this.scheduleIntro();
    } else {
      this.spawned = false;
      this.machine.reset();
    }
  }

  /** Place the villain on the floor facing the player. */
  private placeVillain(p: Vector3, toward: Vector3): void {
    this.villain.position.set(p.x, p.y, p.z);
    this.villain.setFloor(p.y);
    this.villain.faceTowards(toward);
    this.villain.setReveal(0);
  }

  /** Decide where everything lives, once the floor is known. */
  private spawnWorld(): void {
    const head = this.head;
    this.floorY = this.isXR ? (this.xr.floor.y ?? 0) : 0;
    this.playerPos.set(head.x, this.floorY, head.z);

    const dir = new Vector3();
    let dist = 2.5;
    if (this.isXR) {
      const fp = this.xr.floor.point;
      if (fp) {
        dir.set(fp.x - head.x, 0, fp.z - head.z);
        dist = clamp(dir.length(), 2.0, 3.3);
      }
      if (dir.lengthSq() < 1e-4) dir.set(this.fwd.x, 0, this.fwd.z);
    } else {
      dir.set(0, 0, -1);
      dist = 2.6;
    }
    dir.y = 0;
    dir.normalize();
    this.dirToVillain.copy(dir);
    this.villainSpawn.set(head.x + dir.x * dist, this.floorY, head.z + dir.z * dist);

    // room-sized shell: fit to detected planes when available, otherwise a sensible default around the action
    const mid = new Vector3().addVectors(this.playerPos, this.villainSpawn).multiplyScalar(0.5);
    let box: Box;
    if (this.isXR) {
      box = fitRoomBox(this.xr.planes.points, v3(mid.x, 0, mid.z));
    } else {
      box = { center: v3(0, 1.35, -1.3), half: v3(3, 1.35, 3) };
    }
    box = this.ensureContains(box, [this.playerPos, this.villainSpawn]);
    box.center.y = this.floorY + box.half.y;
    this.shell.build(box, this.rng, this.isXR ? this.xr.planes.surfaces : [], this.reduced);

    if (!this.isXR) {
      this.room?.removeFromParent();
      this.room = new SimulatedRoom(box);
      this.scene.add(this.room);
    }

    this.placeVillain(this.villainSpawn, this.head);
    this.rocks.scatter(this.playerPos.clone(), this.villainSpawn, Math.floor(this.rng() * 1000), Math.atan2(dir.z, dir.x));
    this.rocks.update(0, 0, 1);

    // arena: spot for the villain ~5 m away; sun placed to the player's right so the villain is lit
    this.arenaSpot.set(this.playerPos.x + dir.x * ARENA_DISTANCE, this.floorY, this.playerPos.z + dir.z * ARENA_DISTANCE);
    this.arena.position.set(this.playerPos.x, this.floorY, this.playerPos.z);
    const yawV = Math.atan2(dir.x, dir.z);
    const sunLocalYaw = Math.atan2(0.35, -0.55);
    this.arena.rotation.y = yawV + (100 * Math.PI) / 180 - sunLocalYaw;
    this.spawned = true;
  }

  private ensureContains(box: Box, pts: Vector3[]): Box {
    const b: Box = { center: { ...box.center }, half: { ...box.half } };
    for (const p of pts) {
      const need = (c: number, h: number, v: number) => Math.max(h, Math.abs(v - c) + 0.7);
      b.half.x = need(b.center.x, b.half.x, p.x);
      b.half.z = need(b.center.z, b.half.z, p.z);
    }
    return b;
  }

  // ------------------------------------------------------------------ main loop

  private frame(timeMs: number, xrFrame?: XRFrame): void {
    if (!this.running) return;
    const now = timeMs / 1000;
    const dt = clamp(this.lastFrameT === 0 ? 1 / 72 : now - this.lastFrameT, 0.001, 0.05);
    this.lastFrameT = now;

    // head pose
    if (this.renderer.xr.isPresenting) {
      this.renderer.xr.updateCamera(this.camera);
      this.xr.update(xrFrame, dt);
    } else {
      this.updateDesktopCamera(dt);
    }
    this.camera.updateMatrixWorld(true);
    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.fwd);

    if (!this.frozen) {
      const snap = this.readInput(dt, now);
      this.update(dt, snap);
      this.updateGloves(dt);
      this.adaptQuality(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private updateDesktopCamera(dt: number): void {
    const m = this.machine;
    const target = this.spawned ? this.villainSpawn : new Vector3(0, 0, -2.6);
    const base = new Vector3().copy(HEAD_DESKTOP);
    base.y += this.floorY;
    // slow idle drift + gentle cursor parallax (disabled with reduced motion)
    this.pointerParallax.x = damp(this.pointerParallax.x, this.reduced ? 0 : this.pointerNdc.x, 3, dt);
    this.pointerParallax.y = damp(this.pointerParallax.y, this.reduced ? 0 : this.pointerNdc.y, 3, dt);
    const yaw = Math.atan2(target.x - base.x, target.z - base.z) + Math.PI;
    this.camera.rotation.order = 'YXZ';
    this.camera.position.copy(base);
    this.camera.rotation.set(-0.14 + this.pointerParallax.y * 0.1, yaw - this.pointerParallax.x * 0.14, 0);

    // beam clash: ease into a side-on "fighting game" framing so both beams read clearly
    const want = m.phase === 'clash' || m.phase === 'win' || m.phase === 'lose' || (m.phase === 'arena' && m.fired) ? 1 : 0;
    this.cine = dt >= 1 ? want : damp(this.cine, want, 2.2, dt);
    if (this.cine > 0.001 && this.spawned) {
      const d = this.dirToVillain;
      const right = new Vector3(-d.z, 0, d.x);
      const cam = this.tmpCam;
      cam.position.copy(this.playerPos).add(new Vector3(0, 1.45, 0)).addScaledVector(right, 2.3).addScaledVector(d, -0.2);
      const mid = this.playerPos.clone().addScaledVector(d, ARENA_DISTANCE * 0.5);
      mid.y += 1.25;
      cam.lookAt(mid);
      const q = new Quaternion().copy(this.camera.quaternion).slerp(cam.quaternion, this.cine);
      this.camera.position.lerp(cam.position, this.cine);
      this.camera.quaternion.copy(q);
    }
  }

  private readInput(dt: number, now: number): InputSnapshot {
    const fallback = this.tmpOrigin.set(0, -0.2, -0.68).applyMatrix4(this.camera.matrixWorld);
    let snap: InputSnapshot;
    if (this.scripted) {
      snap = { ...this.pointer.read(fallback), ...this.scripted, origin: this.scripted.origin ?? fallback };
    } else if (this.renderer.xr.isPresenting) {
      const target = this.villain.visible ? this.villain.position : this.villainSpawn;
      snap = this.xrInput.read(this.head, target, now, dt, fallback);
    } else {
      snap = this.pointer.read(fallback);
    }
    this.inputKind = snap.source === 'hands' ? 'hands' : snap.source === 'controller' ? 'controller' : 'pointer';
    if (this.renderer.xr.isPresenting && snap.source === 'hands' && !snap.handsTracked && !this.xr.slots.some((s) => s.source)) this.inputKind = 'hands';
    this.input = snap;
    return snap;
  }

  /** Advance the simulation by dt. Also used by the scripted seek (no rendering). */
  update(dt: number, snap: InputSnapshot): void {
    this.time += dt;
    this.input = snap;
    if (!this.uiActive) this.tapQueued = null;
    const m = this.machine;
    this.buttonCooldown = Math.max(0, this.buttonCooldown - dt);

    const floorReady = !this.isXR || this.xr.floor.stable || (!this.xr.floor.supported && m.t > 1.2);
    const frameInput: FrameInput = {
      floorReady,
      charging: snap.held,
      firePressed: snap.firePressed,
      pumps: snap.pumps,
      holding: snap.holding,
    };
    const events = m.update(dt, frameInput);
    for (const e of events) this.onMachineEvent(e, snap);

    this.updatePhase(dt, snap);
    this.runSteps();
    this.updateTele(dt);
    this.updateTyping(dt);
    this.villain.update(dt, this.reduced);
    this.orbs.update(
      dt,
      this.particles,
      {
        onDetonate: (p) => this.sfx.play('burst', p, 0.8),
        onNearPass: (p) => {
          this.sfx.play('whoosh', p);
          this.xr.haptic(0.35, 60);
        },
      },
      this.time,
    );
    this.particles.update(dt);
    this.arena.update(dt);
    if (this.arenaOn) this.arena.followViewer(this.head);
    this.flash = Math.max(0, this.flash - dt * 2.2);

    // panels face the player
    for (const p of [this.speech, this.hint, this.title, this.button]) p.update(dt, this.head);

    // audio listener
    this.sfx.setListener(this.head.x, this.head.y, this.head.z, this.fwd.x, this.fwd.y, this.fwd.z);
  }

  // ------------------------------------------------------------------ phase logic

  private onMachineEvent(e: MachineEvent, snap: InputSnapshot): void {
    if (e.type === 'phase') this.enterPhase(e.from, e.to, snap);
    else if (e.type === 'fired') this.onFired();
    else if (e.type === 'surge') {
      this.sfx.play('surge', this.villain.position);
      this.say(pick(LINES.surge, Math.floor(this.time)), 0.6);
      this.xr.haptic(0.6, 220);
    }
  }

  private enterPhase(_from: Phase, to: Phase, _snap: InputSnapshot): void {
    this.opts.onEvent?.('phase', { phase: to });
    switch (to) {
      case 'intro':
        if (!this.spawned) this.spawnWorld();
        this.reticle.visible = false;
        this.hint.show(false);
        if (this.steps.length === 0) this.scheduleIntro();
        break;
      case 'charge':
        this.orbTimer = 2.5;
        break;
      case 'crack': {
        this.shell.setOrigin(this.input?.origin ?? this.head);
        this.sfx.play('crack', undefined, 1);
        this.say(pick(LINES.crack, 0), 0.5);
        this.villain.setPose('windup');
        this.xr.haptic(0.8, 300);
        break;
      }
      case 'shatter':
        this.sfx.play('shatter');
        this.sfx.setAmbient('none');
        this.shardsShownAt = this.time;
        this.flash = this.reduced ? 0.2 : 0.8;
        this.xr.haptic(1, 400);
        this.shell.hideCracks();
        this.teleportOut(0.9);
        this.after(2.2, () => this.arenaTeleportIn());
        this.after(1.1, () => this.revealArena());
        break;
      case 'arena':
        this.villain.setPose('taunt');
        this.after(0.4, () => this.say(pick(LINES.arena, 0), 0.8));
        break;
      case 'clash':
        this.beams.setActive(true);
        this.villain.setPose('beam');
        break;
      case 'win':
        this.endT = 0;
        this.sfx.play('win');
        this.sfx.setBeam(false);
        this.villain.setPose('defeat');
        this.villainDeadT = 0;
        this.flash = this.reduced ? 0.25 : 0.9;
        this.particles.explode(70, this.beams.clashPoint, 6, { life: 1.2, size: 0.18, sizeEnd: 0, color: PAL.playerCore, gravity: 1 });
        this.say(pick(LINES.win, 0), 1.6);
        this.after(1.6, () => this.showEnd(true));
        this.xr.haptic(1, 500);
        this.opts.onEvent?.('result', { outcome: 'win', seconds: Math.round(this.machine.clash.time) });
        break;
      case 'lose':
        this.endT = 0;
        this.sfx.play('lose');
        this.sfx.setBeam(false);
        this.villain.setPose('victory');
        this.flash = this.reduced ? 0.15 : 0.5;
        this.say(pick(LINES.lose, 0), 1.6);
        this.after(1.6, () => this.showEnd(false));
        this.opts.onEvent?.('result', { outcome: 'lose', seconds: Math.round(this.machine.clash.time) });
        break;
      default:
        break;
    }
  }

  private scheduleIntro(): void {
    this.steps = [];
    this.after(0.25, () => this.teleportIn(this.villainSpawn, this.playerPos));
    this.after(1.9, () => {
      this.villain.setPose('taunt');
      this.say(LINES.intro[0], 2.3);
    });
    this.after(4.4, () => {
      this.villain.setPose('idle');
      this.throwOrb();
    });
    this.after(5.8, () => this.say(LINES.intro[1], 1.9));
    this.after(7.3, () => this.throwOrb());
  }

  private updatePhase(dt: number, snap: InputSnapshot): void {
    const m = this.machine;
    const phase = m.phase;
    const kind = this.inputKind;
    const origin = snap.origin;

    switch (phase) {
      case 'scan': {
        const fp = this.xr.floor.point;
        this.reticle.visible = this.isXR && !!fp;
        if (fp) {
          this.reticle.position.set(fp.x, (this.xr.floor.y ?? fp.y) + 0.01, fp.z);
          this.reticle.rotation.y += dt * 0.8;
          const s = 1 + 0.08 * Math.sin(this.time * 4);
          this.reticle.scale.setScalar(s);
        }
        this.showHint(this.isXR ? PROMPTS.scan : PROMPTS.scanDesktop, true);
        break;
      }
      case 'intro':
        this.rocks.update(dt, 0, 1);
        this.showHint('', false);
        break;
      case 'charge': {
        const lvl = m.charge;
        this.charge.update(dt, origin, lvl, this.particles, this.reduced);
        this.vignette.update(dt, lvl * (this.isXR ? 0.8 : 1), this.reduced);
        this.sfx.setCharge(lvl);
        this.rocks.update(dt, lvl, 1, (p) => {
          this.particles.explode(8, p, 1.1, { life: 0.9, size: 0.1, sizeEnd: 0.02, color: DUST, gravity: -0.4, drag: 2 });
          this.sfx.play('whoosh', p, 0.25);
        });
        // prompt only while nothing is happening yet
        this.showHint(PROMPTS.charge[kind], lvl < 0.04 && m.t > 0.5);
        // villain harasses the player while they charge
        this.orbTimer -= dt;
        if (this.orbTimer <= 0 && !this.villain.busy && lvl < 0.9) {
          this.orbTimer = 3.4 + this.rng() * 1.6;
          this.throwOrb();
        }
        if (lvl > 0.3 + this.chargeLineIndex * 0.28 && this.chargeLineIndex < LINES.charging.length) {
          this.say(LINES.charging[this.chargeLineIndex], 1.4);
          this.chargeLineIndex++;
          this.villain.setPose(this.chargeLineIndex > 1 ? 'windup' : 'idle');
        }
        if (this.input && snap.held && lvl > this.lastCharge + 0.01) this.xr.haptic(0.12 + lvl * 0.3, 30);
        this.lastCharge = lvl;
        break;
      }
      case 'crack': {
        this.charge.update(dt, origin, 1, this.particles, this.reduced);
        this.vignette.update(dt, 0.9, this.reduced);
        this.sfx.setCharge(1);
        this.rocks.update(dt, 1, 1);
        this.shell.setCrack(m.crack, this.time, this.reduced ? 0.5 : 1);
        this.showHint('', false);
        break;
      }
      case 'shatter': {
        const t = m.t;
        this.charge.update(dt, origin, 1, this.particles, this.reduced);
        this.vignette.update(dt, Math.max(0, 0.9 - t * 0.5), this.reduced);
        this.sfx.setCharge(Math.max(0, 1 - t * 0.5));
        this.rocks.update(dt, 1, 1 - smoothstep(1.2, 3.0, t));
        this.shell.setShards(t, Math.max(0, t - 1.3), this.time);
        break;
      }
      case 'arena': {
        const t = m.t;
        this.shell.setShards(this.time - this.shardsShownAt, Math.max(0, (this.time - this.shardsShownAt) - 1.3), this.time);
        this.rocks.update(dt, 1, 0);
        this.vignette.update(dt, 0, this.reduced);
        this.sfx.setCharge(0);
        if (!m.fired) {
          this.charge.update(dt, origin, 1, this.particles, this.reduced);
          this.showHint(PROMPTS.fire[kind], m.t > 2.0 && this.villain.reveal > 0.9);
        } else {
          // player's beam launches: charge orb collapses into the beam
          this.charge.update(dt, origin, Math.max(0, 1 - t * 4), this.particles, this.reduced);
          this.showHint('', false);
          this.updateBeams(dt, snap, true);
        }
        break;
      }
      case 'clash': {
        this.charge.hideAll();
        this.showHint(PROMPTS.pump[kind], m.t < 4.5);
        this.updateBeams(dt, snap, false);
        for (let i = 0; i < snap.pumps; i++) this.onPump();
        break;
      }
      case 'win': {
        this.endT += dt;
        this.updateBeams(dt, snap, false);
        this.updateVictory(dt);
        break;
      }
      case 'lose': {
        this.endT += dt;
        this.updateBeams(dt, snap, false);
        this.vignette.update(dt, 0, this.reduced);
        break;
      }
    }

    // end-screen button interaction
    if (this.uiActive) this.updateButton(dt);
  }

  // ------------------------------------------------------------------ villain helpers

  private teleportIn(at: Vector3, face: Vector3): void {
    this.placeVillain(at, face);
    this.tele = { dir: 1, t: 0, dur: 1.25 };
    this.sfx.play('teleport', at);
    this.particles.burst(34, { pos: new Vector3(at.x, at.y + 0.1, at.z), spread: 2.2, life: 0.9, size: 0.12, sizeEnd: 0, color: PAL.villain, gravity: -1.5, drag: 2 });
  }

  private teleportOut(dur = 0.6): void {
    this.tele = { dir: -1, t: 0, dur };
    this.sfx.play('teleport', this.villain.position, 0.7);
  }

  private updateTele(dt: number): void {
    const tl = this.tele;
    if (!tl) return;
    tl.t += dt;
    const k = clamp(tl.t / tl.dur);
    const rev = tl.dir === 1 ? k : 1 - k;
    this.villain.setReveal(rev);
    const pillar = Math.sin(Math.PI * k) * 0.9;
    this.villain.setPillar(pillar, 1 - 0.3 * k);
    if (!this.reduced && Math.random() < 0.6) {
      this.particles.emit({
        pos: new Vector3(this.villain.position.x + (Math.random() - 0.5) * 0.8, this.villain.position.y + Math.random() * 2, this.villain.position.z + (Math.random() - 0.5) * 0.8),
        vel: new Vector3(0, 1.5, 0),
        life: 0.7,
        size: 0.08,
        sizeEnd: 0,
        color: PAL.villain,
      });
    }
    if (k >= 1) {
      this.villain.setPillar(0);
      this.villain.setReveal(tl.dir === 1 ? 1 : 0);
      this.tele = null;
    }
  }

  private arenaTeleportIn(): void {
    this.teleportIn(this.arenaSpot, this.playerPos);
  }

  private revealArena(): void {
    this.arenaOn = true;
    this.arena.setActive(true, this.scene);
    this.arena.followViewer(this.head);
    if (this.room) this.room.visible = false;
    this.setGloveStyle('arena');
    this.setLightMode('arena');
    this.sfx.play('reveal');
    this.sfx.setAmbient('arena');
    this.flash = this.reduced ? 0.15 : 0.6;
    this.particles.explode(60, this.head.clone().add(this.fwd.clone().multiplyScalar(1.2)), 3, { life: 1.4, size: 0.1, sizeEnd: 0, color: PAL.playerCore, gravity: 0, drag: 1.2 });
  }

  private throwOrb(): void {
    const idx = this.throwIndex++;
    this.villain.playThrow(() => {
      const from = this.villain.handWorld('R');
      // aim to pass the player's head at a comfortable lateral distance (never a hit)
      const dir = new Vector3(this.head.x - from.x, 0, this.head.z - from.z).normalize();
      const right = new Vector3(-dir.z, 0, dir.x);
      const side = (idx % 2 === 0 ? 1 : -1) * (0.75 + this.rng() * 0.35);
      const pass = this.head.clone().addScaledVector(right, side);
      pass.y += (this.rng() - 0.6) * 0.3;
      this.orbs.fire(from, pass, 3.3, 2.6);
      this.sfx.play('orb', from);
      if (this.machine.phase === 'intro') this.say(pick(LINES.throw, idx), 1.1);
    });
  }

  // ------------------------------------------------------------------ speech + hints

  private say(text: string, hold = 1.6): void {
    this.typing = { text, t: 0, hold, lastBlip: 0 };
    this.speech.setText('', {});
    this.speech.show(true);
  }

  private updateTyping(dt: number): void {
    const ty = this.typing;
    // bubble floats beside the villain's head (viewer's right) so it stays on screen
    const d = this.dirToVillain;
    this.speech.position.set(
      this.villain.position.x + -d.z * 0.95,
      this.villain.position.y + 2.2,
      this.villain.position.z + d.x * 0.95,
    );
    if (!ty) return;
    ty.t += dt;
    const chars = Math.min(ty.text.length, Math.floor(ty.t * 32));
    if (chars !== ty.lastBlip) {
      if (chars % 2 === 0 && chars < ty.text.length) this.sfx.play('blip', this.villain.position, 0.8);
      ty.lastBlip = chars;
      this.speech.setText(ty.text.slice(0, chars), {
        bg: 'rgba(24,6,18,0.72)',
        border: true,
        glow: '#ff3d6e',
        color: '#ffe6ee',
        fontPx: ty.text.includes('\n') ? 40 : 52,
      });
    }
    if (ty.t > ty.text.length / 32 + ty.hold) {
      this.speech.show(false);
      this.typing = null;
    }
  }

  private showHint(text: string, on: boolean): void {
    if (!on || !text) {
      this.hint.show(false);
      return;
    }
    this.hint.setText(text, { bg: 'rgba(6,12,28,0.7)', border: true, glow: '#38b6ff', fontPx: 42 });
    this.hint.show(true);
    // hologram that rides in front of the player at a comfortable reading distance
    const fwd = new Vector3(this.fwd.x, 0, this.fwd.z);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const target = this.head.clone().addScaledVector(fwd, 1.1);
    target.y = this.head.y - 0.5;
    if (this.hint.position.lengthSq() === 0) this.hint.position.copy(target);
    this.hint.position.lerp(target, 0.12);
  }

  // ------------------------------------------------------------------ fight

  private onFired(): void {
    this.sfx.play('fire');
    this.fireT = 0;
    this.villain.setPose('beam');
    this.xr.haptic(0.9, 250);
    this.flash = this.reduced ? 0.12 : 0.4;
    this.beams.setActive(true);
  }

  private onPump(): void {
    this.pumpKick = 1;
    if (this.time - this.lastPumpSfx > 0.07) {
      this.sfx.play('pump', undefined, 0.8);
      this.lastPumpSfx = this.time;
    }
    this.xr.haptic(0.4, 35);
    this.particles.explode(6, this.beams.clashPoint, 3, { life: 0.5, size: 0.08, sizeEnd: 0, color: PAL.playerCore, gravity: 2 });
  }

  /** Beam endpoints + visuals. `launching` = the pre-clash phase where the player's beam crosses the arena. */
  private updateBeams(dt: number, snap: InputSnapshot, launching: boolean): void {
    const m = this.machine;
    const p = this.handsPoint(snap, this.tmpB);
    const v = this.villain.handWorld('L', this.tmpC).add(this.villain.handWorld('R', this.tmpD)).multiplyScalar(0.5);
    v.x -= this.dirToVillain.x * 0.45;
    v.z -= this.dirToVillain.z * 0.45;
    let point = m.clash.point;
    let pp = m.clash.playerPower;
    let vp = m.clash.villainPower;
    if (launching) {
      this.fireT += dt;
      const k = clamp(this.fireT / 0.9);
      point = 1 - easeOutCubic(k) * 0.5; // player's beam reaches the villain, villain answers, point settles at the middle
      pp = 0.7;
      vp = 0.7 * easeOutCubic(clamp((this.fireT - 0.25) / 0.65));
    }
    if (m.phase === 'win') {
      point = 1;
      pp = 1.3;
      vp = Math.max(0, 0.6 - this.endT);
    } else if (m.phase === 'lose') {
      point = Math.max(0, m.clash.point - this.endT * 0.2);
      pp = Math.max(0, 0.3 - this.endT * 0.3);
      vp = 1.2;
    }
    this.beams.update(dt, this.time, p, v, point, pp, vp, this.particles, this.reduced);
    const loud = m.phase === 'clash' || m.phase === 'arena';
    this.sfx.setBeam(loud && (m.phase === 'clash' || m.fired), (pp + vp) / 2);
    if (m.phase === 'clash' || launching) this.vignette.update(dt, 0.25 + 0.2 * pp, this.reduced);

    this.pumpKick = Math.max(0, this.pumpKick - dt * 5);
  }

  private updateVictory(dt: number): void {
    if (this.villainDeadT < 0) return;
    this.villainDeadT += dt;
    // body disintegrates from the head down
    const k = clamp((this.villainDeadT - 0.7) / 2.0);
    this.villain.setReveal(1 - k);
    if (k > 0 && k < 1 && !this.reduced) {
      const y = this.villain.position.y + this.villain.height * (1 - k);
      this.particles.emit({
        pos: new Vector3(this.villain.position.x + (Math.random() - 0.5) * 0.6, y, this.villain.position.z + (Math.random() - 0.5) * 0.6),
        vel: new Vector3(0, 1.2, 0),
        spread: 0.8,
        life: 1.0,
        size: 0.1,
        sizeEnd: 0,
        color: Math.random() < 0.5 ? PAL.villain : PAL.ember,
      });
    }
  }

  private showEnd(win: boolean): void {
    const t = win ? PROMPTS.win : PROMPTS.lose;
    this.title.setText(`${t.title}\n${t.sub}`, {
      border: true,
      bg: 'rgba(5,8,22,0.82)',
      glow: win ? '#38b6ff' : '#ff3d6e',
      color: win ? '#eaf8ff' : '#ffe6ee',
      fontPx: 72,
    });
    const dir = this.dirToVillain;
    const base = new Vector3(this.head.x + dir.x * 1.7, this.head.y + 0.05, this.head.z + dir.z * 1.7);
    this.title.position.copy(base);
    this.button.position.set(base.x, this.head.y - 0.4, base.z);
    this.title.show(true);
    this.button.show(true);
    this.button.scale.setScalar(1);
    this.dwell = 0;
  }

  private updateButton(dt: number): void {
    if (!this.button.visible) return;
    // pointer / tap
    if (this.tapQueued) {
      this.tryButtonNdc(this.tapQueued);
      this.tapQueued = null;
    }
    // gaze dwell (comfortable fallback when hands are busy / controllers are away)
    this.ray.set(this.head, this.fwd);
    const gazing = this.ray.intersectObject(this.button, false).length > 0;
    this.dwell = gazing ? this.dwell + dt : Math.max(0, this.dwell - dt * 2);
    this.button.scale.setScalar(1 + 0.12 * smoothstep(0, 1.8, this.dwell));
    if (this.dwell > 1.8) this.pressReplay();

    // hand poke: an index fingertip close to the button
    for (const s of this.xr.slots) {
      if (!s.isHand) continue;
      const tip = (s.hand as unknown as { joints: Record<string, Mesh | undefined> }).joints['index-finger-tip'];
      if (tip?.visible && tip.position.distanceTo(this.button.position) < 0.09) this.pressReplay();
    }
    // controller laser visibility
    for (const s of this.xr.slots) {
      const laser = s.ray.getObjectByName('laser');
      if (laser) laser.visible = !!s.source && !s.isHand;
    }
  }

  private tryButtonNdc(ndc: Vector2): void {
    this.ray.setFromCamera(ndc, this.camera);
    if (this.ray.intersectObject(this.button, false).length > 0) this.pressReplay();
  }

  /** Controller / hand ray press. Generous aim assist: within ~20° of the button counts. */
  private tryButtonRay(m: ArrayLike<number>): void {
    if (!this.button.visible) return;
    const o = new Vector3(m[12], m[13], m[14]);
    const d = new Vector3(-m[8], -m[9], -m[10]).normalize();
    const toButton = this.button.position.clone().sub(o).normalize();
    if (d.angleTo(toButton) < 0.35) this.pressReplay();
  }

  private pressReplay(): void {
    if (this.buttonCooldown > 0 || !this.uiActive) return;
    this.buttonCooldown = 1;
    this.sfx.play('click');
    this.opts.onEvent?.('replay');
    this.replay();
  }

  replay(): void {
    this.sfx.stopLoops();
    this.resetRun(true);
    for (const s of this.xr.slots) {
      const laser = s.ray.getObjectByName('laser');
      if (laser) laser.visible = false;
    }
  }

  // ------------------------------------------------------------------ presentation helpers

  private handsPoint(snap: InputSnapshot, out: Vector3): Vector3 {
    out.copy(snap.origin);
    if (this.cine > 0.001 && !this.renderer.xr.isPresenting) {
      const d = this.dirToVillain;
      const avatar = this.tmpA.copy(this.playerPos).addScaledVector(d, 0.45);
      avatar.y += 1.3;
      out.lerp(avatar, this.cine);
    }
    return out;
  }

  /** The light count never changes (no shader recompiles mid-fight); only intensities swap. */
  private setLightMode(mode: 'room' | 'arena'): void {
    const { hemi, dir } = this.lights;
    const room = mode === 'room';
    hemi.intensity = room ? 1.25 : 0;
    dir.intensity = room ? 2.2 : 0;
    this.arena.sun.intensity = room ? 0 : 3.0;
    this.arena.hemi.intensity = room ? 0 : 1.15;
    const d = new Vector3(0.35, 0.55, -0.55).normalize().applyAxisAngle(new Vector3(0, 1, 0), this.arena.rotation.y);
    this.arena.sun.position.copy(d).multiplyScalar(60);
  }

  private setGloveStyle(s: GloveStyle): void {
    if (this.gloveStyle === s) return;
    this.gloveStyle = s;
    for (const g of [...this.handGloves]) g.setStyle(s);
    for (const g of [...this.fists, ...this.deskGloves, ...this.avatarGloves]) g.setStyle(s);
  }

  private updateGloves(dt: number): void {
    const xrOn = this.renderer.xr.isPresenting;
    // tracked hands
    this.handGloves.forEach((g, i) => {
      const slot = this.xr.slots[i];
      if (!xrOn || !slot?.isHand) {
        g.visible = false;
        return;
      }
      const joints = (slot.hand as unknown as { joints: Record<string, (Mesh & { jointRadius?: number }) | undefined> }).joints;
      g.update((idx, out) => {
        const j = joints[HAND_JOINTS[idx]];
        if (!j || !j.visible) return null;
        out.copy(j.position);
        return j.jointRadius ?? 0.009;
      });
    });
    // controllers
    this.fists.forEach((f, i) => {
      const slot = this.xr.slots[i];
      f.visible = xrOn && !!slot?.source && !slot.isHand;
    });
    // desktop gloves hug the lower corners of the view (hidden once the side-on camera takes over)
    const show = !xrOn;
    const m = this.machine;
    const charging = (m.phase === 'charge' || m.phase === 'crack') && (this.input?.held ?? false);
    const cinematic = this.cine > 0.5;
    this.deskGloves.forEach((g, i) => {
      g.visible = show && !cinematic;
      if (!g.visible) return;
      const s = i === 0 ? -1 : 1;
      const tx = charging ? s * 0.07 : s * 0.25;
      const ty = charging ? -0.33 : -0.36;
      const tz = charging ? -0.5 : -0.55;
      g.scale.setScalar(0.78);
      g.position.x = damp(g.position.x, tx, 10, dt);
      g.position.y = damp(g.position.y, ty, 10, dt);
      g.position.z = damp(g.position.z, tz, 14, dt);
      g.rotation.set(0, 0, s * (charging ? 0.5 : 0.15));
    });
    const d = this.dirToVillain;
    const base = this.playerPos.clone().addScaledVector(d, 0.45);
    base.y += 1.3;
    const yaw = Math.atan2(-d.x, -d.z);
    this.avatarGloves.forEach((g, i) => {
      g.visible = show && cinematic;
      if (!g.visible) return;
      const s = i === 0 ? -1 : 1;
      g.position.set(base.x + -d.z * s * 0.1, base.y, base.z + d.x * s * 0.1).addScaledVector(d, this.pumpKick * 0.25);
      g.rotation.set(0, yaw, 0);
      g.scale.setScalar(1.1);
    });
  }

  /** Back off particle density if the headset can't hold frame rate. */
  private adaptQuality(dt: number): void {
    if (!this.renderer.xr.isPresenting) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 120) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    // 72 Hz budget = 13.9 ms. Sustained misses -> shed load.
    if (avg > 0.0165 && this.quality > 0.4) {
      this.quality -= 0.2;
      this.particles.density = Math.max(0.3, this.quality) * this.reducedFactor;
    } else if (avg < 0.0145 && this.quality < 1) {
      this.quality = Math.min(1, this.quality + 0.1);
      this.particles.density = this.quality * this.reducedFactor;
    }
  }

  private after(seconds: number, fn: () => void): void {
    this.steps.push({ at: this.machine.total + seconds, fn, done: false });
  }

  private runSteps(): void {
    const t = this.machine.total;
    for (const s of this.steps) {
      if (!s.done && t >= s.at) {
        s.done = true;
        s.fn();
      }
    }
    if (this.steps.length > 40) this.steps = this.steps.filter((s) => !s.done);
  }

  // ------------------------------------------------------------------ debug / scripted playback

  /**
   * Fast-forward the simulation with scripted input until `target` is reached (+ `extra` seconds).
   * Used for README screenshots and tests (`?scene=clash`). Desktop only.
   */
  seek(target: Phase, extra = 0.5, result: 'win' | 'lose' = 'win', freeze = true): void {
    this.frozen = false;
    const dt = 1 / 30;
    const order: Phase[] = ['scan', 'intro', 'charge', 'crack', 'shatter', 'arena', 'clash', 'win', 'lose'];
    const want = order.indexOf(target);
    let guard = 0;
    let acc = 0;
    let reached = -1;
    while (guard++ < 6000) {
      const m = this.machine;
      const idx = order.indexOf(m.phase);
      if (m.phase === target && reached < 0) reached = m.t;
      if (m.phase === target && m.t - 0 >= extra) break;
      // partial progress inside a phase for nicer screenshots
      const needCharge = want > 2 || (target === 'charge' && m.charge < 0.65);
      const snap: Partial<InputSnapshot> = {
        held: idx === 2 && needCharge,
        firePressed: idx === 5 && m.t > 4.2 && !m.fired,
        pumps: 0,
        holding: false,
      };
      if (idx === 6) {
        acc += (result === 'win' ? 6.2 : 0.4) * dt;
        const n = Math.floor(acc);
        acc -= n;
        snap.pumps = n;
        snap.holding = result === 'win';
      }
      this.scripted = snap;
      const base = this.pointer.read(new Vector3(0, 1.3, -0.5));
      this.update(dt, { ...base, ...snap, origin: this.desktopOrigin() });
      this.updateGloves(dt);
      if (target === 'charge' && m.phase === 'charge' && m.charge >= 0.65) break;
    }
    this.scripted = null;
    this.desktopOrigin();
    this.updateGloves(0.2);
    this.frozen = freeze;
    if (this.running) this.renderer.render(this.scene, this.camera);
  }

  private desktopOrigin(): Vector3 {
    this.updateDesktopCamera(1);
    this.camera.updateMatrixWorld(true);
    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.fwd);
    return new Vector3(0, -0.2, -0.68).applyMatrix4(this.camera.matrixWorld);
  }

  /** Test hook: current phase. */
  get phase(): Phase {
    return this.machine.phase;
  }
}

const DUST = new Color(0xd8cdb8);
