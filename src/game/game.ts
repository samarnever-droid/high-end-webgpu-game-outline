import * as THREE from 'three/webgpu';
import { pass, screenUV, vec4, float, uniform } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { AudioEngine } from './audio';
import { buildCity, c, type City, type Hit } from './city';
import { Humanoid, VEER, DEV, JIMMY, MEERA, type HumanoidOptions } from './character';
import { CarEntity } from './vehicle';
import { Traffic, Peds } from './traffic';
import { Sparks, Marker } from './fx';
import { makeSky, SUN_DIR } from './sky';
import { MISSIONS, SPAWN, type Line, type Respawn } from './missions';
import { Merger, M4, angDiff, clamp, makeCanvas, mulberry32 } from './geo';

export interface HudState {
  phase: 'loading' | 'menu' | 'playing';
  speed: number;
  inCar: boolean;
  nitro: number;
  mission: { n: number; total: number; title: string; tag: string } | null;
  objective: string | null;
  distance: number | null;
  timer: number | null;
  timerLabel: string;
  cash: number;
  subtitle: { who: string; text: string } | null;
  prompt: string | null;
  toast: { title: string; sub: string; kind: 'pass' | 'fail' | 'info' | 'flash' } | null;
  lost: number | null;
  cp: { i: number; n: number } | null;
  muted: boolean;
  musicOn: boolean;
  fade: boolean;
  ended: boolean;
  fps: number;
  res: number;
  locked: boolean;
}

export interface GameCallbacks {
  onHud: (h: HudState) => void;
  onProgress?: (t: string) => void;
}

interface MarkerSpec { x: number; z: number; r?: number; color?: string }
interface Npc { h: Humanoid; x: number; z: number; on: boolean }

const NPC_DEFS: Record<string, HumanoidOptions> = { dev: DEV, jimmy: JIMMY, meera: MEERA };

export class Game {
  state: 'loading' | 'menu' | 'playing' = 'loading';
  audio = new AudioEngine();

  // exposed to missions
  inCar = false;
  px = SPAWN.x; py = 0; pz = SPAWN.z;
  car!: CarEntity;
  target: CarEntity | null = null;
  targetGo = false;
  targetArrived = false;

  private renderer!: THREE.WebGPURenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.3, 2600);
  private pipeline: THREE.RenderPipeline | null = null;
  private boostU = uniform(0);
  private sun!: THREE.DirectionalLight;
  private city!: City;
  private veer!: Humanoid;
  private npcs: Record<string, Npc> = {};
  private traffic!: Traffic;
  private peds!: Peds;
  private sparks = new Sparks();
  private markerObjs: Marker[] = [new Marker(), new Marker(), new Marker()];
  private markers: MarkerSpec[] = [];
  private boat = new THREE.Group();
  private mapCanvas!: HTMLCanvasElement;
  private disposed = false;

  // input
  private keys = new Set<string>();
  private jumpPressed = false;
  private hornOn = false;
  private lastMouse = 0;
  private dragging = false;

  // player
  private pvx = 0; private pvz = 0; private pvy = 0;
  private pheading = Math.PI / 2;
  private pgrounded = true;
  private steerSm = 0;
  private carVisible = false;

  // camera
  private camYaw = Math.PI / 2;
  private camPitch = 0.22;
  private camT = new THREE.Vector3();
  private camInit = false;
  private fov = 62;
  private shake = 0;

  // mission state
  private mi = 0;
  private si = 0;
  private missionActive = false;
  private failing = false;
  private failFlag = false;
  private timer: { t: number; label: string } | null = null;
  private lost: number | null = null;
  private cp: { i: number; n: number } | null = null;
  private objective: string | null = null;
  private tpts: { x: number; z: number }[] = [];
  private tidx = 0;
  private cash = 0;

  // dialogue
  private queue: Line[] = [];
  private curLine: Line | null = null;
  private lineT = 0;

  private later: { t: number; fn: () => void }[] = [];
  private hud: HudState;
  private lastEmit = 0;
  private toastT = 0;
  private time = 0;
  private last = performance.now();
  private fpsAcc = 0;
  private fpsN = 0;
  private fps = 60;
  private res = 1;
  private maxRes = 1.5;
  private adaptT = 0;
  private hit: Hit = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
  private menuAngle = 0;
  private resize = () => this.onResize();

  constructor(private container: HTMLElement, private mini: HTMLCanvasElement, private cb: GameCallbacks) {
    this.hud = {
      phase: 'loading', speed: 0, inCar: false, nitro: 1, mission: null, objective: null, distance: null,
      timer: null, timerLabel: '', cash: 0, subtitle: null, prompt: null, toast: null, lost: null, cp: null,
      muted: false, musicOn: true, fade: false, ended: false, fps: 60, res: 1, locked: false,
    };
  }

  // =================================================================== init
  async init() {
    const say = (t: string) => this.cb.onProgress?.(t);
    this.maxRes = Math.min(window.devicePixelRatio || 1, 1.6);
    this.res = this.maxRes;
    const renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer = renderer;
    renderer.setPixelRatio(this.res);
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    const el = renderer.domElement;
    el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none';
    this.container.appendChild(el);
    say('WebGPU device shuru ho raha hai...');
    await renderer.init();
    if (this.disposed) return;
    if (!(renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend.isWebGPUBackend) {
      throw new Error('NO_WEBGPU');
    }

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    // ---- environment
    say('Aasmaan aur roshni...');
    await tick();
    const sky = makeSky();
    this.scene.background = sky;
    this.scene.environment = sky;
    this.scene.environmentIntensity = 0.75;
    this.scene.backgroundIntensity = 1.0;
    this.scene.fog = new THREE.FogExp2(0xc99a88, 0.00115);

    const sun = new THREE.DirectionalLight(0xffb676, 3.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 700;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.05;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0x9db2ff, 0x54423f, 0.45));

    // ---- city
    say('Neon Nagri ban rahi hai...');
    await tick();
    this.city = buildCity();
    this.scene.add(this.city.group);
    const mc = makeCanvas(860, 760);
    mc.g.translate(380, 380);
    this.city.drawMap(mc.g);
    this.mapCanvas = mc.c;

    // ---- characters
    say('Kirdaar aur gaadiyan...');
    await tick();
    this.veer = new Humanoid(VEER);
    this.veer.onStep = (s) => {
      if (!this.inCar && this.state === 'playing') this.audio.footstep(s);
    };
    this.scene.add(this.veer.root);
    for (const k of Object.keys(NPC_DEFS)) {
      const hm = new Humanoid(NPC_DEFS[k]);
      hm.root.visible = false;
      this.scene.add(hm.root);
      this.npcs[k] = { h: hm, x: 0, z: 0, on: false };
    }

    this.car = new CarEntity('sport', 0x1368ff, { glow: 0xff2fd0 });
    this.car.groundFn = this.city.groundY;
    this.car.onCrash = (imp, x, z) => this.onCrash(imp, x, z);
    this.car.group.visible = false;
    this.scene.add(this.car.group);

    const rng = mulberry32(99);
    this.traffic = new Traffic(30, rng);
    this.scene.add(this.traffic.group);
    this.peds = new Peds(46, rng);
    this.scene.add(this.peds.group);
    this.scene.add(this.sparks.mesh);
    for (const m of this.markerObjs) this.scene.add(m.group);
    this.buildBoat();

    // ---- post
    try {
      const scenePass = pass(this.scene, this.camera);
      const col = scenePass.getTextureNode('output');
      const bl = bloom(col, 0.42, 0.55, 1.7);
      const vig = screenUV.sub(0.5).length().mul(1.3).pow(2.2);
      const k = float(1).sub(vig.mul(this.boostU.mul(0.35).add(0.42)));
      const pipe = new THREE.RenderPipeline(renderer);
      pipe.outputNode = vec4(col.add(bl).rgb.mul(k), 1);
      this.pipeline = pipe;
    } catch (e) {
      console.warn('Post-processing disabled', e);
      this.pipeline = null;
    }

    // ---- start state
    this.placeFoot(SPAWN.x, SPAWN.z, Math.PI / 2);
    this.camYaw = Math.PI / 2;
    this.veer.root.position.set(this.px, 0, this.pz);

    say('Shaders compile ho rahe hain...');
    await tick();
    try {
      await renderer.compileAsync(this.scene, this.camera);
    } catch (e) {
      console.warn('compileAsync failed', e);
    }
    if (this.disposed) return;

    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onLockChange);

    this.state = 'menu';
    this.hud.phase = 'menu';
    this.last = performance.now();
    renderer.setAnimationLoop(this.frame);
    this.emit(true);
  }

  private buildBoat() {
    const m = new Merger();
    m.box(3.2, 1.1, 9, 0, 0.55, 0, 0xf4f4f4);
    m.add(new THREE.ConeGeometry(1.6, 4, 4), 0xf4f4f4, M4(0, 0.55, 6.4, Math.PI / 2, Math.PI / 4, 0, 1, 1, 0.7));
    m.box(3.25, 0.25, 9.05, 0, 0.9, 0, 0xc4262e);
    m.box(2.2, 1.0, 2.6, 0, 1.6, -0.5, 0x15181d);
    m.box(1.8, 0.1, 2.2, 0, 2.15, -0.5, 0xeeeeee);
    const g = m.build()!;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    this.boat.add(mesh);
    this.boat.visible = false;
    this.scene.add(this.boat);
  }

  // =================================================================== public API for missions
  say(lines: Line[]) {
    this.queue.push(...lines);
  }
  sayDone() {
    return !this.curLine && this.queue.length === 0;
  }
  setObjective(t: string | null) {
    this.objective = t;
  }
  setMarkers(m: MarkerSpec[]) {
    this.markers = m;
  }
  setIntensity(n: number) {
    this.audio.intensity = n;
  }
  setLost(v: number | null) {
    this.lost = v;
  }
  setCheckpoints(i: number | null, n: number) {
    this.cp = i === null ? null : { i, n };
  }
  timerStart(sec: number, label: string) {
    this.timer = { t: sec, label };
  }
  timerAdd(sec: number) {
    if (this.timer) this.timer.t += sec;
  }
  timerStop() {
    this.timer = null;
  }
  distTo(x: number, z: number) {
    return Math.hypot(x - this.px, z - this.pz);
  }
  flash(text: string) {
    this.toast(text, '', 'flash', 1.2);
  }
  fail(reason: string) {
    if (this.failing || !this.missionActive) return;
    this.failFlag = true;
    this.failing = true;
    this.missionActive = false;
    this.audio.fail();
    this.toast('MISSION FAILED', reason, 'fail', 3);
    this.hud.fade = true;
    this.after(2.8, () => {
      this.hud.fade = false;
      this.removeTarget();
      this.clearDialogue();
      this.respawn(MISSIONS[this.mi].respawn);
      this.failing = false;
      this.failFlag = false;
      this.startMission(this.mi);
    });
  }
  setNPC(key: string, pos: { x: number; z: number } | null) {
    const n = this.npcs[key];
    if (!n) return;
    n.on = !!pos;
    n.h.root.visible = !!pos;
    if (pos) {
      n.x = pos.x;
      n.z = pos.z;
      n.h.root.position.set(pos.x, 0.15, pos.z);
    }
  }
  placeCar(x: number, z: number, h: number) {
    this.car.place(x, z, h);
    this.car.y = this.city.groundY(x, z);
    this.car.group.visible = true;
    this.carVisible = true;
  }
  spawnTarget(path: [number, number][]) {
    this.removeTarget();
    const t = new CarEntity('suv', 0x0b0c0e, {});
    t.groundFn = this.city.groundY;
    this.scene.add(t.group);
    this.target = t;
    const pts: { x: number; z: number }[] = [];
    for (let k = 0; k < path.length - 1; k++) {
      const a = { x: c(path[k][0]), z: c(path[k][1]) };
      const b = { x: c(path[k + 1][0]), z: c(path[k + 1][1]) };
      const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
      const ox = dz * 2, oz = -dx * 2; // left-hand lane
      pts.push({ x: a.x + ox, z: a.z + oz }, { x: b.x + ox, z: b.z + oz });
    }
    this.tpts = pts;
    this.tidx = 1;
    const dx = pts[1].x - pts[0].x, dz = pts[1].z - pts[0].z;
    t.place(pts[0].x, pts[0].z, Math.atan2(dx, dz));
    this.targetGo = false;
    this.targetArrived = false;
  }
  removeTarget() {
    if (this.target) {
      this.scene.remove(this.target.group);
      this.target = null;
    }
    this.targetGo = false;
    this.targetArrived = false;
  }
  finale() {
    // fireworks over the harbour + Raghav's speedboat getting away
    this.boat.visible = true;
    this.boat.position.set(488, -1.0, -8);
    this.boat.rotation.y = Math.PI / 2;
    this.audio.complete();
    const cols = [[3, 0.4, 0.8], [0.4, 2.2, 3.5], [3.5, 2.4, 0.3], [0.6, 3.5, 0.9], [2.6, 0.6, 3.4]];
    for (let k = 0; k < 14; k++) {
      this.after(0.6 + k * 0.7, () => {
        const cc = cols[k % cols.length];
        this.sparks.burst(430 + Math.random() * 60, 55 + Math.random() * 40, -50 + Math.random() * 100, new THREE.Color().setRGB(cc[0], cc[1], cc[2]), 80, 24);
        this.audio.crash(5);
      });
    }
    this.after(6, () => {
      this.hud.ended = true;
      this.hud.locked = false;
      if (document.pointerLockElement) document.exitPointerLock();
    });
  }
  continueFree() {
    this.hud.ended = false;
    this.boat.visible = false;
    this.objective = 'Free roam — Neon Nagri ab tumhari hai';
    this.audio.intensity = 0;
    this.emit(true);
  }

  // =================================================================== lifecycle
  start() {
    if (this.state !== 'menu') return;
    this.state = 'playing';
    this.hud.phase = 'playing';
    this.audio.start();
    this.audio.ui();
    this.camYaw = Math.PI / 2;
    this.camInit = false;
    this.startMission(0);
    this.requestLock();
    this.emit(true);
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    try {
      this.renderer?.setAnimationLoop(null);
      this.renderer?.domElement.removeEventListener('mousedown', this.onMouseDown);
      this.renderer?.domElement.remove();
      this.renderer?.dispose();
    } catch {
      /* ignore */
    }
    this.audio.dispose();
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    this.hud.muted = this.audio.muted;
    this.emit(true);
  }
  toggleMusic() {
    this.hud.musicOn = this.audio.toggleMusic();
    this.emit(true);
  }

  // =================================================================== missions
  private startMission(i: number) {
    this.mi = i;
    this.si = 0;
    const m = MISSIONS[i];
    this.missionActive = true;
    this.timer = null;
    this.lost = null;
    this.cp = null;
    this.audio.intensity = m.intensity;
    this.hud.mission = { n: i + 1, total: MISSIONS.length, title: m.title, tag: m.tag };
    this.toast(m.title.toUpperCase(), `${m.tag} — ${m.blurb}`, 'info', 4.2);
    this.audio.chime();
    m.steps[0].enter?.(this);
  }

  private completeMission() {
    const m = MISSIONS[this.mi];
    this.missionActive = false;
    this.cash += m.reward;
    this.audio.complete();
    this.timer = null;
    this.markers = [];
    this.objective = null;
    this.lost = null;
    this.cp = null;
    this.toast('MISSION PASSED', `${m.title}  +$${m.reward.toLocaleString('en-US')}`, 'pass', 4.5);
    this.audio.intensity = 0;
    if (this.mi + 1 < MISSIONS.length) {
      this.after(5, () => this.startMission(this.mi + 1));
    }
  }

  private updateMission(dt: number) {
    if (!this.missionActive) return;
    const m = MISSIONS[this.mi];
    const st = m.steps[this.si];
    const r = st.update(this, dt);
    if (this.failFlag) return;
    if (r === 'done') {
      st.exit?.(this);
      this.si++;
      if (this.si >= m.steps.length) this.completeMission();
      else m.steps[this.si].enter?.(this);
    }
    if (this.timer && this.missionActive) {
      this.timer.t -= dt;
      if (this.timer.t <= 0) {
        this.timer.t = 0;
        this.fail('Waqt khatam ho gaya!');
      }
    }
  }

  private respawn(r: Respawn) {
    this.setInCar(false);
    if (r.car) this.placeCar(r.car.x, r.car.z, r.car.h);
    if (r.inCar) {
      this.placeCar(r.px, r.pz, r.ph);
      this.setInCar(true);
    } else {
      this.placeFoot(r.px, r.pz, r.ph);
    }
    this.camYaw = r.ph;
    this.camInit = false;
  }

  // =================================================================== helpers
  private after(sec: number, fn: () => void) {
    this.later.push({ t: sec, fn });
  }

  private toast(title: string, sub: string, kind: 'pass' | 'fail' | 'info' | 'flash', dur = 3) {
    this.hud.toast = { title, sub, kind };
    this.toastT = dur;
    this.emit(true);
  }

  private clearDialogue() {
    this.queue = [];
    this.curLine = null;
    this.hud.subtitle = null;
  }

  private placeFoot(x: number, z: number, h: number) {
    this.px = x; this.pz = z; this.pheading = h;
    this.py = this.city.groundY(x, z);
    this.pvx = this.pvz = this.pvy = 0;
  }

  private setInCar(v: boolean) {
    if (v === this.inCar && this.veer.root.parent) return;
    this.inCar = v;
    this.veer.root.removeFromParent();
    if (v) {
      this.car.model.body.add(this.veer.root);
      this.veer.root.position.set(-0.4, 0.0, -0.18);
      this.veer.root.rotation.set(0, 0, 0);
      this.px = this.car.x;
      this.pz = this.car.z;
    } else {
      this.scene.add(this.veer.root);
    }
  }

  private interact() {
    if (this.state !== 'playing') return;
    if (this.inCar) {
      if (Math.abs(this.car.speed) > 9) {
        this.flash('Pehle gaadi roko!');
        return;
      }
      const hd = this.car.heading;
      const rx = -Math.cos(hd), rz = Math.sin(hd);
      let ex = this.car.x + rx * 2.5, ez = this.car.z + rz * 2.5;
      if (this.city.resolve(ex, ez, 0.45, this.hit)) {
        // blocked on the driver side - try the other door
        ex = this.car.x - rx * 2.5;
        ez = this.car.z - rz * 2.5;
        this.city.resolve(ex, ez, 0.45, this.hit);
        ex = this.hit.x;
        ez = this.hit.z;
      } else {
        ex = this.hit.x;
        ez = this.hit.z;
      }
      this.setInCar(false);
      this.placeFoot(ex, ez, hd);
      this.audio.door();
    } else if (this.carVisible && Math.hypot(this.car.x - this.px, this.car.z - this.pz) < 4.8) {
      this.setInCar(true);
      this.audio.door();
    }
  }

  private onCrash(impact: number, x: number, z: number) {
    this.audio.crash(impact);
    this.shake = Math.min(1, impact / 16);
    const col = new THREE.Color().setRGB(3, 1.8, 0.5);
    const n = Math.min(24, 6 + Math.floor(impact));
    for (let i = 0; i < n; i++) {
      this.sparks.emit(x, 0.7, z, (Math.random() - 0.5) * 9, Math.random() * 5, (Math.random() - 0.5) * 9, 0.5 + Math.random() * 0.4, col, 0.25, 12);
    }
  }

  // =================================================================== input
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (this.state !== 'playing') return;
    switch (e.code) {
      case 'Space': this.jumpPressed = true; break;
      case 'KeyF': this.interact(); break;
      case 'KeyR': this.resetCar(); break;
      case 'KeyM': this.toggleMute(); break;
      case 'KeyN': this.toggleMusic(); break;
      case 'Enter': this.skipLine(); break;
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onBlur = () => {
    this.keys.clear();
    this.dragging = false;
  };
  private onMouseDown = () => {
    if (this.state === 'playing') {
      this.dragging = true;
      if (!document.pointerLockElement) this.requestLock();
    }
  };
  private onMouseUp = () => {
    this.dragging = false;
  };
  private onMouseMove = (e: MouseEvent) => {
    if (this.state !== 'playing') return;
    if (!document.pointerLockElement && !this.dragging) return;
    this.camYaw -= e.movementX * 0.0026;
    this.camPitch = clamp(this.camPitch + e.movementY * 0.0022, -0.12, 1.15);
    this.lastMouse = this.time;
  };
  private onLockChange = () => {
    this.hud.locked = !!document.pointerLockElement;
    this.emit(true);
  };
  private requestLock() {
    try {
      const p = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* not available */
    }
  }
  private skipLine() {
    if (this.curLine) this.lineT = 0;
  }
  private resetCar() {
    if (!this.carVisible) return;
    // snap to the nearest road centre line, keeping the facing direction (left-hand traffic)
    const px = this.car.x, pz = this.car.z;
    let bi = 0, bj = 0, dx = 1e9, dz = 1e9;
    for (let i = 0; i <= 8; i++) {
      if (Math.abs(px - c(i)) < dx) { dx = Math.abs(px - c(i)); bi = i; }
      if (Math.abs(pz - c(i)) < dz) { dz = Math.abs(pz - c(i)); bj = i; }
    }
    let x: number, z: number, h: number;
    if (dx <= dz) {
      const north = Math.cos(this.car.heading) >= 0;
      h = north ? 0 : Math.PI;
      x = c(bi) + (north ? 2 : -2);
      z = clamp(pz, -300, 300);
    } else {
      const east = Math.sin(this.car.heading) >= 0;
      h = east ? Math.PI / 2 : -Math.PI / 2;
      z = c(bj) + (east ? -2 : 2);
      x = clamp(px, -300, 300);
    }
    this.car.place(x, z, h);
    this.car.y = 0;
    this.flash('Gaadi sadak par wapas');
  }

  private onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // =================================================================== frame
  private frame = () => {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;

    if (this.state === 'playing') this.updatePlaying(dt);
    else this.updateMenu(dt);

    this.city.update(this.time, dt);
    this.sparks.update(dt);
    this.markerObjs.forEach((m) => m.update(this.time));
    if (this.boat.visible) {
      this.boat.position.x += 17 * dt;
      this.boat.position.y = -1.0 + Math.sin(this.time * 3) * 0.08;
      if (this.boat.position.x > 1100) this.boat.visible = false;
    }
    for (let i = this.later.length - 1; i >= 0; i--) {
      this.later[i].t -= dt;
      if (this.later[i].t <= 0) {
        const f = this.later[i].fn;
        this.later.splice(i, 1);
        f();
      }
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) {
        this.hud.toast = null;
        this.emit(true);
      }
    }
    this.updateSun();
    this.draw();
    this.adapt(dt);
    this.drawMinimap();
    this.emit(false);
  };

  private draw() {
    if (this.pipeline) {
      try {
        this.pipeline.render();
        return;
      } catch (e) {
        console.warn('pipeline failed, falling back', e);
        this.pipeline = null;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  private adapt(dt: number) {
    this.fpsAcc += dt;
    this.fpsN++;
    this.adaptT += dt;
    if (this.fpsAcc >= 1) {
      this.fps = Math.round(this.fpsN / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
    if (this.adaptT > 2.5) {
      this.adaptT = 0;
      let nr = this.res;
      if (this.fps < 40 && this.res > 0.65) nr = Math.max(0.65, this.res - 0.15);
      else if (this.fps > 57 && this.res < this.maxRes) nr = Math.min(this.maxRes, this.res + 0.1);
      if (Math.abs(nr - this.res) > 0.01) {
        this.res = nr;
        this.renderer.setPixelRatio(nr);
      }
    }
  }

  private updateSun() {
    const f = this.state === 'playing' ? { x: this.px, y: this.py, z: this.pz } : { x: this.camera.position.x, y: 0, z: this.camera.position.z };
    const L = SUN_DIR;
    const right = new THREE.Vector3(0, 1, 0).cross(L).normalize();
    const up2 = new THREE.Vector3().crossVectors(L, right);
    const t = new THREE.Vector3(f.x, f.y, f.z);
    const texel = 180 / 2048;
    const a = Math.round(t.dot(right) / texel) * texel;
    const b = Math.round(t.dot(up2) / texel) * texel;
    const d = t.dot(L);
    const s = right.multiplyScalar(a).add(up2.multiplyScalar(b)).add(L.clone().multiplyScalar(d));
    this.sun.target.position.copy(s);
    this.sun.position.copy(s).addScaledVector(L, 300);
    this.sun.target.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ menu
  private updateMenu(dt: number) {
    this.menuAngle += dt * 0.045;
    const tt = this.city.towerTop;
    const r = 210;
    const a = this.menuAngle + 2.2;
    this.camera.position.set(tt.x + Math.cos(a) * r, 62 + Math.sin(this.time * 0.2) * 6, tt.z + Math.sin(a) * r);
    this.camera.lookAt(tt.x, tt.y * 0.55, tt.z);
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
    this.camYaw = Math.atan2(tt.x - this.camera.position.x, tt.z - this.camera.position.z);
    this.px = tt.x;
    this.pz = tt.z;
    this.traffic.update(dt, this.time, [], this.camera.position);
    this.peds.update(dt, tt.x, tt.z);
    this.veer.root.visible = false;
  }

  // ------------------------------------------------------------------ playing
  private updatePlaying(dt: number) {
    this.veer.root.visible = true;
    const k = this.keys;
    const throttle = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    if (k.has('KeyQ')) { this.camYaw += dt * 1.8; this.lastMouse = this.time; }
    if (k.has('KeyE')) { this.camYaw -= dt * 1.8; this.lastMouse = this.time; }
    const horn = k.has('KeyH');
    if (horn !== this.hornOn) {
      this.hornOn = horn;
      this.audio.setHorn(horn);
    }

    if (this.inCar) {
      this.car.update(dt, { throttle, steer, hand: k.has('Space'), boost: shift }, this.city);
      this.px = this.car.x;
      this.pz = this.car.z;
      this.py = this.car.y;
      this.steerSm += (steer - this.steerSm) * (1 - Math.exp(-dt * 8));
      this.veer.update(dt, { speed: 0, air: false, sit: true, steer: this.steerSm, throttle });
    } else {
      if (this.carVisible) this.car.update(dt, { throttle: 0, steer: 0, hand: true, boost: false }, this.city);
      this.updateFoot(dt, throttle, steer, shift);
    }
    this.jumpPressed = false;

    this.updateTarget(dt);

    // traffic
    const obs: { x: number; z: number }[] = [];
    if (this.carVisible) obs.push({ x: this.car.x, z: this.car.z });
    if (!this.inCar) obs.push({ x: this.px, z: this.pz });
    if (this.target) obs.push({ x: this.target.x, z: this.target.z });
    this.traffic.update(dt, this.time, obs, this.camera.position);
    this.peds.update(dt, this.px, this.pz);
    this.trafficCollisions();

    this.updateDialogue(dt);
    this.updateMission(dt);
    this.updateNpcs(dt);

    this.updateCamera(dt, shift);
    this.updateMarkers();

    const sp = this.inCar ? Math.abs(this.car.speed) : 0;
    this.audio.updateDrive(sp, this.inCar ? Math.max(0, throttle) : 0, this.inCar, this.car.boosting && this.inCar, this.car.slip);
  }

  private updateFoot(dt: number, f: number, s: number, sprint: boolean) {
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const rx = -fz, rz = fx;
    const dx = fx * f + rx * s, dz = fz * f + rz * s;
    const len = Math.hypot(dx, dz);
    let tvx = 0, tvz = 0;
    if (len > 0.01) {
      const v = sprint ? 9.4 : 5.4;
      tvx = (dx / len) * v;
      tvz = (dz / len) * v;
    }
    const a = 1 - Math.exp(-dt * (this.pgrounded ? 10 : 2.5));
    this.pvx += (tvx - this.pvx) * a;
    this.pvz += (tvz - this.pvz) * a;
    this.px += this.pvx * dt;
    this.pz += this.pvz * dt;
    if (this.city.resolve(this.px, this.pz, 0.4, this.hit) && this.hit.hit) {
      this.px = this.hit.x;
      this.pz = this.hit.z;
      const vn = this.pvx * this.hit.nx + this.pvz * this.hit.nz;
      if (vn < 0) {
        this.pvx -= vn * this.hit.nx;
        this.pvz -= vn * this.hit.nz;
      }
    }
    const gy = this.city.groundY(this.px, this.pz);
    if (this.jumpPressed && this.pgrounded) {
      this.pvy = 6.2;
      this.pgrounded = false;
    }
    this.pvy -= 20 * dt;
    this.py += this.pvy * dt;
    if (this.py <= gy) {
      this.py = gy;
      this.pvy = 0;
      this.pgrounded = true;
    } else this.pgrounded = this.py - gy < 0.03;

    const spd = Math.hypot(this.pvx, this.pvz);
    if (spd > 0.5) this.pheading += angDiff(this.pheading, Math.atan2(this.pvx, this.pvz)) * (1 - Math.exp(-dt * 12));
    this.veer.update(dt, { speed: spd, air: !this.pgrounded, sit: false, steer: 0 });
    this.veer.root.position.set(this.px, this.py, this.pz);
    this.veer.root.rotation.set(0, this.pheading, 0);
  }

  private trafficCollisions() {
    const offs = [1.3, -1.3];
    // player car
    if (this.carVisible) {
      const car = this.car;
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      for (const t of this.traffic.cars) {
        const ddx = t.x - car.x, ddz = t.z - car.z;
        if (ddx * ddx + ddz * ddz > 36) continue;
        const tx = Math.sin(t.heading), tz = Math.cos(t.heading);
        for (const po of offs) {
          for (const to of offs) {
            const ax = car.x + fx * po, az = car.z + fz * po;
            const bx = t.x + tx * to, bz = t.z + tz * to;
            const dx = ax - bx, dz = az - bz;
            const d = Math.hypot(dx, dz);
            const rr = 2.1;
            if (d < rr && d > 1e-4) {
              const imp = car.bump(dx / d, dz / d, rr - d);
              if (imp > 2.5) this.onCrash(imp, (ax + bx) / 2, (az + bz) / 2);
              t.v = Math.max(0, t.v - 2);
            }
          }
        }
      }
    }
    if (!this.inCar) {
      for (const t of this.traffic.cars) {
        const ddx = t.x - this.px, ddz = t.z - this.pz;
        if (ddx * ddx + ddz * ddz > 25) continue;
        const tx = Math.sin(t.heading), tz = Math.cos(t.heading);
        for (const to of offs) {
          const bx = t.x + tx * to, bz = t.z + tz * to;
          const dx = this.px - bx, dz = this.pz - bz;
          const d = Math.hypot(dx, dz);
          if (d < 1.3 && d > 1e-4) {
            this.px += (dx / d) * (1.3 - d);
            this.pz += (dz / d) * (1.3 - d);
          }
        }
      }
    }
  }

  private updateTarget(dt: number) {
    const t = this.target;
    if (!t) return;
    if (!this.targetGo || this.targetArrived) {
      t.update(dt, { throttle: 0, steer: 0, hand: true, boost: false }, this.city);
      return;
    }
    const p = this.tpts[this.tidx];
    const dx = p.x - t.x, dz = p.z - t.z;
    const dist = Math.hypot(dx, dz);
    const last = this.tidx >= this.tpts.length - 1;
    if (dist < (last ? 5 : 9)) {
      if (last) {
        this.targetArrived = true;
        return;
      }
      this.tidx++;
    }
    const want = Math.atan2(dx, dz);
    const diff = angDiff(t.heading, want);
    const steer = clamp(-diff * 2.4, -1, 1);
    let vt = Math.abs(diff) > 0.45 ? 7 : 13;
    const dp = Math.hypot(t.x - this.px, t.z - this.pz);
    if (dp > 40) vt = Math.min(vt, 8);
    if (dp > 75) vt = Math.min(vt, 4.5);
    if (last) vt = Math.min(vt, dist * 0.6 + 2);
    const throttle = clamp((vt - t.speed) * 0.6, -1, 1);
    t.update(dt, { throttle, steer, hand: false, boost: false }, this.city);
  }

  private updateNpcs(dt: number) {
    for (const k in this.npcs) {
      const n = this.npcs[k];
      if (!n.on) continue;
      const want = Math.atan2(this.px - n.x, this.pz - n.z);
      n.h.root.rotation.y += angDiff(n.h.root.rotation.y, want) * (1 - Math.exp(-dt * 4));
      n.h.update(dt, { speed: 0, air: false, sit: false, steer: 0 });
    }
  }

  private updateDialogue(dt: number) {
    if (this.curLine) {
      this.lineT -= dt;
      if (this.lineT <= 0) {
        this.curLine = null;
        this.hud.subtitle = null;
        this.emit(true);
      }
    }
    if (!this.curLine && this.queue.length) {
      const l = this.queue.shift()!;
      this.curLine = l;
      this.lineT = 1.8 + l.text.length * 0.05;
      this.hud.subtitle = { who: l.who, text: l.text };
      this.audio.talk(l.who);
      this.emit(true);
    }
  }

  // ------------------------------------------------------------------ camera
  private updateCamera(dt: number, sprint: boolean) {
    const cam = this.camera;
    let tx: number, ty: number, tz: number, dist: number;
    if (this.inCar) {
      const sp = this.car.speed;
      tx = this.car.x;
      ty = this.car.y + 1.45;
      tz = this.car.z;
      dist = 7.4 + Math.min(3.4, Math.abs(sp) * 0.07);
      if (sp > 3 && this.time - this.lastMouse > 1.1) {
        this.camYaw += angDiff(this.camYaw, this.car.heading) * (1 - Math.exp(-dt * 2.2));
        this.camPitch += (0.2 - this.camPitch) * (1 - Math.exp(-dt * 1.5));
      }
    } else {
      const rx = -Math.cos(this.camYaw), rz = Math.sin(this.camYaw);
      tx = this.px + rx * 0.5;
      ty = this.py + 1.6;
      tz = this.pz + rz * 0.5;
      dist = 3.6 + (sprint ? 0.5 : 0);
    }
    if (!this.camInit) {
      this.camT.set(tx, ty, tz);
      this.camInit = true;
    } else {
      const k = 1 - Math.exp(-dt * (this.inCar ? 14 : 20));
      this.camT.x += (tx - this.camT.x) * k;
      this.camT.y += (ty - this.camT.y) * k;
      this.camT.z += (tz - this.camT.z) * k;
    }
    const cp = Math.cos(this.camPitch);
    const ox = -Math.sin(this.camYaw) * cp, oy = Math.sin(this.camPitch), oz = -Math.cos(this.camYaw) * cp;
    // camera collision
    let d = dist;
    for (let s = 0.6; s <= dist; s += 0.45) {
      if (this.city.blockedAt(this.camT.x + ox * s, this.camT.y + oy * s, this.camT.z + oz * s)) {
        d = Math.max(1.0, s - 0.55);
        break;
      }
    }
    cam.position.set(this.camT.x + ox * d, this.camT.y + oy * d, this.camT.z + oz * d);
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake *= Math.exp(-dt * 7);
    }
    cam.lookAt(this.camT.x, this.camT.y + (this.inCar ? 0.5 : 0.05), this.camT.z);

    const speedFov = this.inCar ? Math.min(14, Math.abs(this.car.speed) * 0.28) + (this.car.boosting ? 9 : 0) : sprint && Math.hypot(this.pvx, this.pvz) > 6 ? 5 : 0;
    const tf = 62 + speedFov;
    this.fov += (tf - this.fov) * (1 - Math.exp(-dt * 4));
    if (Math.abs(cam.fov - this.fov) > 0.02) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    this.boostU.value += ((this.inCar && this.car.boosting ? 1 : 0) - this.boostU.value) * (1 - Math.exp(-dt * 5));
  }

  private updateMarkers() {
    for (let i = 0; i < this.markerObjs.length; i++) {
      const m = this.markers[i];
      if (m) this.markerObjs[i].set(m.x, m.z, m.r ?? 4, m.color ?? '#ffd23a', i === 0 ? 1 : 0.55);
      else this.markerObjs[i].hide();
    }
  }

  // ------------------------------------------------------------------ minimap
  private drawMinimap() {
    const cv = this.mini;
    const ctx = cv.getContext('2d');
    if (!ctx || !this.mapCanvas) return;
    const S = cv.width, half = S / 2;
    const scale = half / 135;
    const yaw = this.camYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 3, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#0b1016';
    ctx.fillRect(0, 0, S, S);
    ctx.save();
    ctx.translate(half, half);
    ctx.transform(-fz * scale, -fx * scale, fx * scale, -fz * scale, 0, 0);
    ctx.translate(-this.px, -this.pz);
    ctx.drawImage(this.mapCanvas, -380, -380);
    ctx.restore();

    const toScreen = (x: number, z: number) => {
      const dx = x - this.px, dz = z - this.pz;
      let sx = (-fz * dx + fx * dz) * scale, sy = (-fx * dx - fz * dz) * scale;
      const d = Math.hypot(sx, sy);
      const lim = half - 16;
      let edge = false;
      if (d > lim) {
        sx = (sx / d) * lim;
        sy = (sy / d) * lim;
        edge = true;
      }
      return { x: half + sx, y: half + sy, edge };
    };
    if (this.state === 'playing') {
      this.markers.forEach((m, i) => {
        const p = toScreen(m.x, m.z);
        ctx.fillStyle = m.color ?? '#ffd23a';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (i === 0 ? 11 : 7) * (S / 400), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fill();
      });
      if (this.target) {
        const p = toScreen(this.target.x, this.target.z);
        ctx.fillStyle = '#ff3b3b';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8 * (S / 400), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (this.carVisible && !this.inCar) {
        const p = toScreen(this.car.x, this.car.z);
        ctx.fillStyle = '#38d6ff';
        ctx.fillRect(p.x - 6, p.y - 6, 12, 12);
      }
      // player arrow
      const heading = this.inCar ? this.car.heading : this.pheading;
      ctx.save();
      ctx.translate(half, half);
      ctx.rotate(yaw - heading);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      const u = S / 400;
      ctx.beginPath();
      ctx.moveTo(0, -15 * u);
      ctx.lineTo(10 * u, 12 * u);
      ctx.lineTo(0, 6 * u);
      ctx.lineTo(-10 * u, 12 * u);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(half, half, half - 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ------------------------------------------------------------------ hud
  private emit(force: boolean) {
    const now = performance.now();
    if (!force && now - this.lastEmit < 100) return;
    this.lastEmit = now;
    const h = this.hud;
    h.inCar = this.inCar;
    h.speed = this.inCar ? Math.round(Math.abs(this.car.speed) * 3.6) : 0;
    h.nitro = this.car ? this.car.nitro : 1;
    h.objective = this.objective;
    h.cash = this.cash;
    h.timer = this.timer ? Math.max(0, this.timer.t) : null;
    h.timerLabel = this.timer?.label ?? '';
    h.lost = this.lost;
    h.cp = this.cp;
    h.fps = this.fps;
    h.res = Math.round(this.res * 100) / 100;
    const m = this.markers[0];
    h.distance = m && this.state === 'playing' ? Math.round(this.distTo(m.x, m.z)) : null;
    let prompt: string | null = null;
    if (this.state === 'playing') {
      if (this.inCar) prompt = Math.abs(this.car.speed) < 9 ? 'F — Gaadi se utro' : null;
      else if (this.carVisible && Math.hypot(this.car.x - this.px, this.car.z - this.pz) < 4.8) prompt = 'F — Gaadi me baitho';
    }
    h.prompt = prompt;
    this.cb.onHud({ ...h });
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 30));

