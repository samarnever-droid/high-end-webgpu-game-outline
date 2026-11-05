import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UberPass } from './post';
import { wetUniform } from './wet';
import { AudioEngine, STATIONS } from './audio';
import { Crowd, Npc, Police, Traffic } from './ai';
import { FX } from './fx';
import { Human, LOOKS, defaultState, type HumanState, type Look } from './humanoid';
import { MISSIONS, MissionFail, setupStory } from './story';
import { hud, emitHud } from './store';
import { Sky } from './sky';
import { Interiors } from './interiors';
import { Hustle } from './hustle';
import { Vehicle, noControl } from './vehicle';
import { WEAPONS, WEAPON_ORDER, buildWeaponModel, type WeaponDef, type WeaponId, type WeaponModel } from './weapons';
import { HALF, World, nodePos, type Hit } from './world';
import { angDiff, clamp, damp, dampAngle, fmtMoney } from './util';
import type { CarKind } from './carmodels';

export interface Marker { x: number; z: number; color?: string; r?: number; label?: string; blip?: boolean; gps?: boolean }
interface Cash { mesh: THREE.Mesh; x: number; z: number; amt: number; t: number }
interface Proj { mesh: THREE.Mesh; p: THREE.Vector3; v: THREE.Vector3; life: number; from: 'player' | 'npc' }
interface Waiter { cond: () => boolean; resolve: () => void; reject: (e: unknown) => void }
export interface RayHit { t: number; kind: 'none' | 'world' | 'ground' | 'npc' | 'vehicle'; npc?: Npc; veh?: Vehicle; head?: boolean; nx: number; ny: number; nz: number }

const GRADE = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uTime: { value: 0 }, uVig: { value: 1.0 }, uDamage: { value: 0 }, uSpeed: { value: 0 }, uSat: { value: 1.0 }, uAim: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
  uniform sampler2D tDiffuse; uniform float uTime, uVig, uDamage, uSpeed, uSat, uAim; varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
  void main(){
    vec2 c = vUv - 0.5; float r = dot(c,c);
    float ca = 0.0003 + r * 0.0018 + uSpeed * 0.003;
    vec3 col = vec3(texture2D(tDiffuse, vUv + c*ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c*ca).b);
    if (uSpeed > 0.02) { vec3 acc = col; for (int i=1;i<6;i++){ acc += texture2D(tDiffuse, vUv - c * float(i) * 0.012 * uSpeed).rgb; } col = mix(col, acc/6.0, clamp(r*3.0,0.0,1.0)*uSpeed); }
    col *= 1.0 - r * uVig * (1.0 + uAim*0.5);
    col = mix(col, col * vec3(1.5,0.25,0.25), uDamage * smoothstep(0.05, 0.5, r*2.0));
    float l = dot(col, vec3(0.299,0.587,0.114));
    col = mix(vec3(l), col, uSat);
    vec3 shadowT = vec3(0.92,1.0,1.1), highT = vec3(1.06,1.0,0.92);
    col *= mix(shadowT, highT, smoothstep(0.1, 0.9, l));
    col += (h(vUv*vec2(1920.0,1080.0) + uTime) - 0.5) * 0.009;
    gl_FragColor = vec4(col, 1.0);
  }`,
};

const MAPW = 1240;

export class Game {
  // core
  canvas: HTMLCanvasElement;
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.12, 2500);
  composer!: EffectComposer;
  bloom!: UnrealBloomPass;
  grade!: ShaderPass;
  smaa?: SMAAPass;
  uber!: UberPass;
  wetness = 0;
  resScale = 1;
  perfT = 0; perfAcc = 0; perfN = 0;
  weatherT = 90;
  flash = 0;
  sky!: Sky;
  fx!: FX;
  world!: World;
  interiors!: Interiors;
  hustle!: Hustle;
  audio = new AudioEngine();
  crowd!: Crowd;
  traffic!: Traffic;
  police!: Police;
  hud = hud;
  tmpHit: Hit = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
  time = 0;
  paused = false;
  disposed = false;
  vehicles: Vehicle[] = [];
  npcs: Npc[] = [];
  flags: Record<string, unknown> = {};

  // player
  playerHuman!: Human;
  playerHs: HumanState = defaultState();
  player = { x: 0, y: 0, z: 0, vy: 0, heading: 0, vx: 0, vz: 0, hp: 100, armor: 0, cash: 800, vehicle: null as Vehicle | null, crouch: false, onGround: true, aim: false, block: false };
  inv: Record<string, { have: boolean; mag: number; reserve: number }> = {};
  weapon: WeaponId = 'pistol';
  wm: WeaponModel | null = null;
  reloadT = 0; fireT = 0; meleeT = 0; meleeHit = false; lastShot = -9; lastDamage = -9;
  wanted = 0;
  lastCar: Vehicle | null = null;
  ownedCars: string[] = [];

  // input
  keys = new Set<string>();
  keyPressed = new Set<string>();
  mouseDx = 0; mouseDy = 0; mouseDown = false; rmb = false; wheel = 0;
  camYaw = 0; camPitch = 0.25; camDist = 4.4; camLookT = 0;
  camPos = new THREE.Vector3(); camShake = 0;
  fov = 62;

  // misc systems
  pickups: Cash[] = [];
  projs: Proj[] = [];
  markers: Marker[] = [];
  beacons: THREE.Mesh[] = [];
  waiters: Waiter[] = [];
  mapCanvas!: HTMLCanvasElement;
  miniCanvas: HTMLCanvasElement | null = null;
  bigCanvas: HTMLCanvasElement | null = null;
  routePts: { x: number; z: number }[] = [];
  routeT = 0;
  state: 'menu' | 'play' | 'dead' | 'busted' | 'cinematic' = 'menu';
  menuT = 0;
  slowmo = 1;
  dialogueAdvance: (() => void) | null = null;
  dialogueChoose: ((i: number) => void) | null = null;
  dialogNpc: Npc | null = null;
  talkCam = 0;
  missionIndex = 0;
  missionRunning = false;
  missionAbort: { reason: string } | null = null;
  missionTimer: { t: number; label: string; onEnd?: () => void } | null = null;
  completed = new Set<number>();
  story: ReturnType<typeof setupStory> | null = null;
  subtitleT = 0;
  hudT = 0; mapT = 0; fpsAcc = 0; fpsN = 0;
  toastId = 1;
  interact: { kind: 'npc' | 'poi' | 'veh' | 'none'; npc?: Npc; poi?: string; veh?: Vehicle } = { kind: 'none' };
  respawnT = 0;
  combo = 0; comboT = 9; swingStage = 0; meleeFace: number | null = null; lungeT = 0; lungeV = { x: 0, z: 0 };
  blockT = 0; dodgeT = 0; dodgeCd = 0; dodgeV = { x: 0, z: 0 }; perfectT = -9;
  hitStop = 0; bulletT = 0; floaterId = 1;
  killCtx = { head: false, melee: false };
  stepAcc = 0;
  distAcc = 0;
  carryOver = 0;
  rainOn = false;
  cinematicCam: { from: THREE.Vector3; to: THREE.Vector3; look: THREE.Vector3; t: number; dur: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  // =================================================================== boot
  async init(progress: (msg: string, pct: number) => void) {
    const tick = () => new Promise<void>((r) => setTimeout(r, 16));
    progress('Starting renderer…', 0.02);
    await tick();
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.autoUpdate = true;
    this.renderer = renderer;
    this.sky = new Sky(renderer, this.scene);
    this.fx = new FX();
    this.scene.add(this.fx.group);
    progress('Rendering the sky…', 0.08);
    await tick();

    progress('Pouring asphalt & raising skyscrapers…', 0.12);
    await tick();
    this.world = new World();
    this.scene.add(this.world.group);
    this.interiors = new Interiors(this);
    this.buildMap();
    progress('Painting facades & windows…', 0.4);
    await tick();

    progress('Casting actors…', 0.5);
    await tick();
    this.playerHuman = new Human(LOOKS.veer);
    this.playerHuman.root.rotation.order = 'YXZ';
    this.playerHuman.onStep = (s) => { if (!this.player.vehicle && this.state === 'play') this.audio.step(this.world.onRoad(this.player.x, this.player.z) ? 'asphalt' : 'pave', Math.hypot(this.player.vx, this.player.vz)); void s; };
    this.scene.add(this.playerHuman.root);

    this.crowd = new Crowd(this);
    this.traffic = new Traffic(this);
    this.police = new Police(this);
    this.hustle = new Hustle(this);
    progress('Building story & characters…', 0.6);
    await tick();
    this.story = setupStory(this);

    // beacons for mission markers
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 60, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
      );
      m.geometry.translate(0, 30, 0);
      m.visible = false;
      this.scene.add(m);
      this.beacons.push(m);
    }

    progress('Compiling shaders…', 0.75);
    await tick();
    this.setupComposer();
    this.resize();

    // inventory
    for (const id of WEAPON_ORDER) this.inv[id] = { have: id === 'fists', mag: 0, reserve: 0 };
    this.giveWeapon('pistol', 48);
    this.loadGame();
    this.selectWeapon(this.weapon);

    // spawn
    const home = this.world.pois.find((p) => p.id === 'home')!;
    this.player.x = home.x + 4; this.player.z = home.z - 3; this.player.heading = 0;
    this.player.y = this.world.groundY(this.player.x, this.player.z);
    this.camYaw = 0;
    const starter = this.spawnCar('sports', 0x1368ff, home.x - 4, home.z - 3.5, Math.PI / 2, 'player');
    starter.tag = 'starter';
    this.lastCar = starter;

    progress('Traffic & citizens…', 0.88);
    await tick();
    for (let i = 0; i < 10; i++) this.traffic.make(this.world.randomRoadSpawn());
    for (let i = 0; i < 22; i++) this.crowd.spawnOne();
    // prime a frame (compiles shaders for the first view)
    this.positionPlayerHuman(0);
    this.updateCamera(0.016, true);
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch { /* older GPUs */ }
    this.composer.render(0.016);
    progress('Ready', 1);

    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('contextmenu', this.onCtx);
    document.addEventListener('pointerlockchange', this.onLockChange);
    hud.phase = 'menu';
    this.state = 'menu';
    this.refreshMissionList();
    this.hustle.sync(false);
    emitHud();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private raf = 0;
  private last = 0;

  private setupComposer() {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.uber = new UberPass(this.camera, size.x, size.y);
    this.composer.addPass(this.uber);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.6, 1.15);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  /** Dynamic resolution: keeps the frame-rate smooth by trading pixel density for speed. */
  private adaptResolution(rawDt: number) {
    this.perfAcc += rawDt; this.perfN++;
    if (this.perfAcc < 1.2) return;
    const fps = this.perfN / this.perfAcc;
    this.perfAcc = 0; this.perfN = 0;
    if (hud.phase === 'loading') return;
    const maxScale = 1;
    let next = this.resScale;
    if (fps < 40) next = Math.max(0.55, this.resScale - 0.1);
    else if (fps > 57) next = Math.min(maxScale, this.resScale + 0.05);
    if (Math.abs(next - this.resScale) > 0.001) {
      this.resScale = next;
      const pr = Math.min(window.devicePixelRatio, 2) * next;
      this.renderer.setPixelRatio(pr);
      this.composer.setPixelRatio(pr);
      this.resize();
    }
  }

  resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onCtx);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.audio.dispose();
    this.renderer?.dispose();
  }

  // =================================================================== input
  private onCtx = (e: Event) => e.preventDefault();
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const k = e.code;
    this.keys.add(k);
    this.keyPressed.add(k);
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(k)) e.preventDefault();
    if (hud.phase === 'menu') return;
    if (k === 'Escape' || k === 'KeyP') this.togglePause();
    if (k === 'KeyM' && hud.phase === 'playing') { hud.fullMap = !hud.fullMap; if (hud.fullMap && document.pointerLockElement) document.exitPointerLock(); emitHud(); }
    if (k === 'KeyT' && hud.phase === 'playing') { hud.phone = !hud.phone; if (hud.phone && document.pointerLockElement) document.exitPointerLock(); emitHud(); }
    if (k === 'Space' || k === 'KeyE' || k === 'Enter') this.dialogueAdvance?.();
    if (hud.dialogue?.choices) {
      const n = parseInt(e.key);
      if (n >= 1 && n <= hud.dialogue.choices.length) this.dialogueChoose?.(n - 1);
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => { this.keys.clear(); this.mouseDown = false; this.rmb = false; };
  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === this.canvas) { this.mouseDx += e.movementX; this.mouseDy += e.movementY; }
  };
  private onMouseDown = (e: MouseEvent) => {
    this.audio.init();
    if (hud.phase !== 'playing') return;
    if (document.pointerLockElement !== this.canvas && !hud.fullMap && !hud.phone && !hud.shop) { this.canvas.requestPointerLock(); return; }
    if (e.button === 0) { this.mouseDown = true; this.dialogueAdvance?.(); }
    if (e.button === 2) this.rmb = true;
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2) this.rmb = false;
  };
  private onWheel = (e: WheelEvent) => { this.wheel += Math.sign(e.deltaY); };
  private onLockChange = () => {
    hud.locked = document.pointerLockElement === this.canvas;
    if (!hud.locked) { this.mouseDown = false; this.rmb = false; }
    emitHud();
  };
  down(k: string) { return this.keys.has(k); }
  pressed(k: string) { return this.keyPressed.has(k); }

  startGame() {
    this.audio.init();
    this.audio.setVolume(hud.settings.volume, hud.settings.music);
    hud.phase = 'playing';
    this.state = 'play';
    this.canvas.requestPointerLock();
    this.positionPlayerHuman(0);
    this.toast('NEON NAGRI', 'Welcome back, Veer. Dev is waiting at the Neon Lotus.', 'mission');
    if (!this.missionRunning && !this.completed.has(this.missionIndex)) this.setHint('Open the phone [T] to start your next job');
    this.refreshMissionList();
    this.startMission(this.missionIndex);
    emitHud();
  }

  togglePause() {
    if (hud.phase === 'playing') {
      hud.phase = 'paused';
      this.paused = true;
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (hud.phase === 'paused') {
      hud.phase = 'playing';
      this.paused = false;
      this.canvas.requestPointerLock();
    }
    emitHud();
  }

  setHint(t: string | null) { hud.hint = t; }

  toast(title: string, text: string, kind: 'info' | 'good' | 'bad' | 'mission' | 'cash' = 'info') {
    const id = this.toastId++;
    hud.toasts = [...hud.toasts.slice(-3), { id, title, text, kind, t: this.time }];
    emitHud();
    setTimeout(() => { hud.toasts = hud.toasts.filter((t) => t.id !== id); emitHud(); }, 4200);
  }

  // =================================================================== weapons / inventory
  giveWeapon(id: WeaponId, ammo = 0) {
    const w = this.inv[id];
    const def = WEAPONS[id];
    if (!w.have) { w.have = true; w.mag = def.mag; }
    w.reserve += ammo;
  }
  selectWeapon(id: WeaponId) {
    if (!this.inv[id]?.have) return;
    this.weapon = id;
    this.reloadT = 0;
    const def = WEAPONS[id];
    this.wm = buildWeaponModel(id);
    this.playerHuman.setWeapon(this.wm ? this.wm.group : null);
    void def;
    this.updateWeaponHud();
  }
  cycleWeapon(dir: number) {
    const have = WEAPON_ORDER.filter((id) => this.inv[id].have);
    const i = have.indexOf(this.weapon);
    this.selectWeapon(have[(i + dir + have.length) % have.length]);
  }
  updateWeaponHud() {
    const def = WEAPONS[this.weapon], inv = this.inv[this.weapon];
    hud.weapon = { id: def.id, name: def.name, icon: def.icon, mag: inv.mag, reserve: inv.reserve, cls: def.cls, reloading: this.reloadT > 0, infinite: def.mag === 0 };
  }

  // =================================================================== factory helpers
  spawnCar(kind: CarKind, color: number, x: number, z: number, h: number, role: Vehicle['role'] = 'parked') {
    const v = new Vehicle(kind, color);
    v.role = role;
    v.place(x, z, h, this.world);
    v.onCrash = (veh, imp, cx, cz) => this.onVehicleCrash(veh, imp, cx, cz);
    v.onExplode = (veh) => this.onVehicleExplode(veh);
    this.scene.add(v.group);
    this.vehicles.push(v);
    return v;
  }
  removeVehicle(v: Vehicle) {
    this.scene.remove(v.group);
    const i = this.vehicles.indexOf(v); if (i >= 0) this.vehicles.splice(i, 1);
    this.traffic.list = this.traffic.list.filter((q) => q !== v);
  }
  spawnNpc(look: Look, role: Npc['role'], x: number, z: number, h = 0) {
    const n = new Npc(look, role);
    n.place(x, z, h);
    n.y = this.world.groundY(x, z);
    this.scene.add(n.human.root);
    this.crowd.list.push(n);
    this.npcs.push(n);
    return n;
  }
  removeNpc(n: Npc) {
    n.removed = true;
  }

  // =================================================================== frame loop
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = Math.min(0.05, (now - this.last) / 1000);
    const rawDt = dt;
    this.last = now;
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) { hud.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    if (!this.paused) {
      if (this.hitStop > 0) { this.hitStop -= rawDt; dt *= 0.1; }
      if (this.bulletT > 0) { this.bulletT -= rawDt; this.slowmo = 0.4; if (this.bulletT <= 0 && this.state === 'play') this.slowmo = 1; }
      dt *= this.slowmo;
      this.update(dt);
    }
    this.render(dt);
    this.adaptResolution(rawDt);
    this.keyPressed.clear();
    this.mouseDx = 0; this.mouseDy = 0; this.wheel = 0;
  };

  private render(dt: number) {
    this.grade.uniforms.uTime.value = this.time;
    const sp = this.player.vehicle ? clamp((Math.abs(this.player.vehicle.speed) - 30) / 40, 0, 1) + (this.player.vehicle.boosting ? 0.5 : 0) : 0;
    this.grade.uniforms.uSpeed.value = damp(this.grade.uniforms.uSpeed.value, sp, 4, dt);
    this.grade.uniforms.uDamage.value = clamp(hud.damage, 0, 1) + (this.player.hp < 30 ? (30 - this.player.hp) / 60 : 0);
    this.grade.uniforms.uAim.value = hud.aiming ? 1 : 0;
    this.bloom.enabled = hud.settings.bloom;
    this.bloom.strength = 0.14 + this.sky.night * 0.26 + this.sky.lightning * 0.5;
    this.bloom.threshold = 1.0 - this.sky.night * 0.15;

    // ---- atmosphere / post feed
    const sk = this.sky, u = this.uber, st = hud.settings;
    const q = st.quality === 'high';
    u.settings.ao = st.ao && q;
    u.settings.ssr = st.reflections && q;
    u.settings.rays = st.rays;
    u.settings.flare = st.rays;
    u.settings.fog = st.volumetrics;
    u.sunDir.copy(sk.sunDir);
    u.sunCol.copy(sk.sun.color);
    u.fogCol.copy(sk.fog.color);
    const dayK = sk.day;
    u.fogDensity = (0.0007 + (1 - dayK) * 0.0012 + sk.rain * 0.0034) * (st.volumetrics ? 1 : 0);
    u.fogHeight = 0.022 + sk.rain * 0.01;
    const sunUp = Math.max(0, sk.sunDir.y);
    u.raysAmount = clamp(sunUp * 2.2, 0, 1) * (1 - sk.rain * 0.85) * dayK * (sk.sunDir.y < 0.25 ? 1.35 : 1);
    u.flareAmount = clamp(sunUp * 3, 0, 1) * (1 - sk.rain) * dayK;
    this.wetness += (Math.min(1, sk.rain * 1.6) - this.wetness) * (1 - Math.exp(-dt * (sk.rain > this.wetness ? 0.5 : 0.03)));
    wetUniform.value = this.wetness;
    u.wet = this.wetness;
    u.indoor = sk.indoor;
    u.time = this.time;
    sk.autoWeather = st.autoWeather && this.state === 'play';
    this.composer.render(dt);
  }

  update(dt: number) {
    this.time += dt;
    this.menuT += dt;
    const night = this.sky.night;
    if (this.state === 'menu') this.updateMenu(dt);
    else this.updatePlayer(dt);
    this.updateWorld(dt, night);
    this.hustle.update(dt);
    this.updateCamera(dt);
    this.sky.update(dt, hud.phase === 'playing' ? hud.settings.timeScale * 6 : 2, this.focus(), this.camera);
    this.world.update(dt, this.time, this.focus(), this.sky.night);
    this.world.updateSea(this.sky, this.time);
    this.interiors.update(dt);
    this.fx.update(dt, this.renderer.domElement.height * 0.5);
    this.updateAudio(dt);
    this.updateWaiters();
    this.updateHud(dt);
    this.keyPressedAfter();
  }
  private keyPressedAfter() { /* reserved */ }

  focus() {
    return this.player.vehicle ? new THREE.Vector3(this.player.vehicle.x, 0, this.player.vehicle.z) : new THREE.Vector3(this.player.x, 0, this.player.z);
  }

  private updateMenu(dt: number) {
    // showcase camera orbit around Veer + his car
    this.positionPlayerHuman(dt);
    this.playerHuman.update(dt, this.playerHs);
  }

  // =================================================================== player
  private positionPlayerHuman(dt: number) {
    const p = this.player;
    if (p.vehicle) return;
    const r = this.playerHuman.root;
    r.position.set(p.x, p.y, p.z);
    r.rotation.y = p.heading;
    void dt;
  }

  private moveInput() {
    let ix = 0, iz = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) iz += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) iz -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) ix += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) ix -= 1;
    return { ix, iz };
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    const sens = 0.0022 * hud.settings.sens;
    const locked = document.pointerLockElement === this.canvas;
    const inDialogue = !!hud.dialogue;
    if (locked && !inDialogue) {
      this.camYaw -= this.mouseDx * sens;
      this.camPitch = clamp(this.camPitch + this.mouseDy * sens, -0.55, 1.1);
      if (Math.abs(this.mouseDx) + Math.abs(this.mouseDy) > 0) this.camLookT = 2.2;
    }
    this.camLookT -= dt;
    const wcls = WEAPONS[this.weapon].cls;
    const meleeW = wcls === 'none' || wcls === 'melee';
    p.aim = this.rmb && !p.vehicle && this.state === 'play' && !inDialogue && !meleeW && !this.interiors.current;
    p.block = this.rmb && !p.vehicle && this.state === 'play' && !inDialogue && meleeW && !this.interiors.current && this.dodgeT <= 0;
    this.blockT = p.block ? this.blockT + dt : 0;
    hud.aiming = p.aim; hud.blocking = p.block;
    hud.dodgeCd = this.dodgeCd; hud.combo = this.comboT < 1.1 ? this.combo : 0;

    if (this.state === 'dead' || this.state === 'busted') {
      this.respawnT -= dt;
      this.playerHuman.update(dt, this.playerHs);
      if (this.respawnT <= 0) this.respawn();
      return;
    }
    if (p.hp > 0 && p.hp < 100 && this.time - this.lastDamage > 7) p.hp = Math.min(100, p.hp + dt * 1.8);
    // interaction target
    this.updateInteract();
    if ((this.pressed('KeyE') || this.pressed('KeyF')) && !inDialogue && this.state === 'play') this.doInteract();
    // weapons select
    if (!p.vehicle) {
      for (let i = 0; i < WEAPON_ORDER.length; i++) if (this.pressed('Digit' + (i + 1))) this.selectWeapon(WEAPON_ORDER[i]);
      if (this.wheel !== 0) this.cycleWeapon(this.wheel);
      if (this.pressed('Tab')) this.cycleWeapon(1);
    }
    if (p.vehicle) this.updateDriving(dt);
    else this.updateOnFoot(dt);
    this.updateWeapons(dt);
    this.updateTargeting();
    // pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const c = this.pickups[i];
      c.mesh.rotation.y += dt * 3;
      c.mesh.position.y = 0.6 + Math.sin(this.time * 3 + i) * 0.1;
      c.t -= dt;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d < (p.vehicle ? 3.2 : 1.6)) { this.addCash(c.amt); this.audio.cash(); this.scene.remove(c.mesh); this.pickups.splice(i, 1); }
      else if (c.t < 0) { this.scene.remove(c.mesh); this.pickups.splice(i, 1); }
    }
  }

  private updateOnFoot(dt: number) {
    const p = this.player;
    const h = this.playerHuman;
    const hs = this.playerHs;
    const inDialogue = !!hud.dialogue || this.state === 'cinematic';
    const { ix, iz } = inDialogue ? { ix: 0, iz: 0 } : this.moveInput();
    const sprint = this.down('ShiftLeft') && !p.aim && !p.crouch;
    if (this.pressed('KeyC') && !inDialogue) p.crouch = !p.crouch;
    const cf = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
    const cr = { x: -Math.cos(this.camYaw), z: Math.sin(this.camYaw) };
    let dx = cf.x * iz + cr.x * ix, dz = cf.z * iz + cr.z * ix;
    const l = Math.hypot(dx, dz);
    if (l > 0) { dx /= l; dz /= l; }
    const base = p.crouch ? 1.6 : p.aim ? 2.4 : p.block ? 1.9 : sprint ? 6.4 : 3.4;
    const spd = l > 0 ? base : 0;
    const k = p.onGround ? 11 : 2.5;
    // dodge roll [Q]
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    if (this.pressed('KeyQ') && !inDialogue && this.dodgeCd <= 0 && p.onGround && !this.interiors.current && this.dodgeT <= 0) {
      const ex = l > 0 ? dx : -cf.x, ez = l > 0 ? dz : -cf.z;
      this.dodgeT = 0.5; this.dodgeCd = 0.9;
      this.dodgeV = { x: ex * 9.5, z: ez * 9.5 };
      p.heading = Math.atan2(ex, ez);
      this.audio.swing();
      this.fx.dust(p.x, p.y + 0.1, p.z, 0, 0, 3);
    }
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const kk = 0.35 + 0.65 * Math.max(0, this.dodgeT / 0.5);
      p.vx = this.dodgeV.x * kk; p.vz = this.dodgeV.z * kk;
    } else if (this.lungeT > 0) {
      this.lungeT -= dt;
      p.vx = this.lungeV.x; p.vz = this.lungeV.z;
    } else {
      p.vx = damp(p.vx, dx * spd, k, dt);
      p.vz = damp(p.vz, dz * spd, k, dt);
    }
    // facing
    const shooting = this.mouseDown && WEAPONS[this.weapon].cls !== 'none' && WEAPONS[this.weapon].cls !== 'melee';
    if (this.dodgeT > 0) { /* keep roll direction */ }
    else if (this.meleeT > 0 && this.meleeFace !== null) p.heading = dampAngle(p.heading, this.meleeFace, 22, dt);
    else if (p.aim || shooting || this.meleeT > 0 || p.block) p.heading = dampAngle(p.heading, this.camYaw, 16, dt);
    else if (l > 0.1) p.heading = dampAngle(p.heading, Math.atan2(dx, dz), 12, dt);
    // jump
    if (this.pressed('Space') && p.onGround && !inDialogue && !p.crouch && this.dodgeT <= 0) { p.vy = 5.6; p.onGround = false; }
    p.x += p.vx * dt; p.z += p.vz * dt;
    const inside = !!this.interiors.current;
    const gy = inside ? 0 : this.world.groundY(p.x, p.z);
    if (!p.onGround || p.y > gy + 0.05) {
      p.vy -= 17 * dt;
      p.y += p.vy * dt;
      if (p.y <= gy) { p.y = gy; p.vy = 0; p.onGround = true; }
      else p.onGround = false;
    } else {
      p.y = damp(p.y, gy, 18, dt);
    }
    const hit = this.tmpHit;
    if (inside) { const q = this.interiors.resolve(p.x, p.z, 0.34); p.x = q.x; p.z = q.z; }
    else if (this.world.resolve(p.x, p.z, 0.34, hit, p.y) && hit.hit) { p.x = hit.x; p.z = hit.z; }
    // push by vehicles (stand clear!)
    for (const v of this.vehicles) {
      if (Math.abs(v.speed) < 2 || Math.abs(v.x - p.x) > 6 || Math.abs(v.z - p.z) > 6) continue;
      const rel = this.toLocal(v, p.x, p.z);
      const hw = v.spec.W / 2 + 0.3, hl = v.spec.L / 2 + 0.2;
      if (Math.abs(rel.x) < hw && Math.abs(rel.z) < hl && p.y < v.y + 1.4) {
        this.damagePlayer(Math.abs(v.speed) * 3.5, v.x, v.z);
        const d = Math.hypot(p.x - v.x, p.z - v.z) || 1;
        p.vx += ((p.x - v.x) / d) * Math.abs(v.speed) * 0.8; p.vz += ((p.z - v.z) / d) * Math.abs(v.speed) * 0.8;
        this.audio.hit();
      }
    }
    // animate
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    hs.vf = p.vx * fx + p.vz * fz;
    hs.vs = p.vx * Math.cos(p.heading) - p.vz * Math.sin(p.heading);
    hs.aim = p.aim || (shooting && this.time - this.lastShot < 0.4);
    hs.aimPitch = this.camPitch * 0.9 - 0.15;
    hs.stance = p.crouch ? 'crouch' : 'stand';
    hs.air = !p.onGround;
    hs.weapon = WEAPONS[this.weapon].cls;
    hs.talk = !!hud.dialogue && !!this.dialogNpc && false;
    hs.panic = false;
    hs.lookX = 0;
    h.root.position.set(p.x, p.y, p.z);
    h.root.rotation.y = p.heading;
    h.update(dt, hs);
    if (this.dodgeT > 0) {
      const th = (1 - this.dodgeT / 0.5) * Math.PI * 2;
      h.root.rotation.x = th;
      const off = -0.85 * Math.sin(th), dy = 0.85 - 0.85 * Math.cos(th);
      h.root.position.x += Math.sin(p.heading) * off; h.root.position.z += Math.cos(p.heading) * off; h.root.position.y += dy;
    } else if (h.root.rotation.x !== 0 && !h.dead) h.root.rotation.x = 0;
    this.distAcc += Math.hypot(p.vx, p.vz) * dt;
  }

  private toLocal(v: Vehicle, x: number, z: number) {
    const dx = x - v.x, dz = z - v.z;
    const c = Math.cos(v.heading), s = Math.sin(v.heading);
    // right axis = (-cos, sin) ... local x = left (+x), local z = forward
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }

  private updateDriving(dt: number) {
    const p = this.player;
    const v = p.vehicle!;
    const c = v.ctl;
    const inDialogue = !!hud.dialogue || this.state === 'cinematic';
    let th = 0, st = 0;
    if (!inDialogue) {
      if (this.down('KeyW') || this.down('ArrowUp')) th += 1;
      if (this.down('KeyS') || this.down('ArrowDown')) th -= 1;
      if (this.down('KeyD') || this.down('ArrowRight')) st += 1;
      if (this.down('KeyA') || this.down('ArrowLeft')) st -= 1;
    }
    c.throttle = th; c.steer = st; c.hand = this.down('Space') && !inDialogue; c.boost = this.down('ShiftLeft') && !inDialogue;
    v.horn = this.down('KeyH');
    if (this.pressed('KeyR')) this.nextStation();
    if (this.pressed('KeyG')) v.sirenOn = v.kind === 'police' ? !v.sirenOn : false;
    // sync player
    p.x = v.x; p.y = v.y; p.z = v.z; p.vx = v.vx; p.vz = v.vz; p.heading = v.heading;
    // human in seat
    const hs = this.playerHs;
    hs.stance = 'drive'; hs.steer = v.steerAngle / 0.6; hs.weapon = 'none'; hs.aim = false; hs.vf = 0; hs.vs = 0; hs.air = false;
    hs.lookX = 0;
    this.playerHuman.update(dt, hs);
    this.distAcc += Math.abs(v.speed) * dt;
    // tyre smoke / skid marks
    if (v.skid) {
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      for (const w of v.model.wheels) {
        if (w.front) continue;
        const wx = v.x + fx * v.spec.zr + (-fz) * (w.sign > 0 ? 1 : -1) * (v.spec.W / 2 - 0.15), wz = v.z + fz * v.spec.zr + fx * (w.sign > 0 ? 1 : -1) * (v.spec.W / 2 - 0.15);
        void wx; void wz;
      }
    }
  }

  nextStation() {
    this.audio.setStation(this.audio.station + 1);
    hud.radio = STATIONS[this.audio.station];
    emitHud();
  }

  // =================================================================== interaction
  private updateInteract() {
    const p = this.player;
    this.interact = { kind: 'none' };
    let prompt: string | null = null;
    if (hud.dialogue || this.state !== 'play' || hud.shop) { hud.prompt = null; return; }
    if (this.interiors.current) {
      const ia = this.interiors.interactAt(p.x, p.z);
      hud.prompt = ia ? ia.prompt : null;
      this.interact = ia ? { kind: 'poi', poi: ia.kind === 'exit' ? '__exit' : this.interiors.current.id } : { kind: 'none' };
      return;
    }
    if (!p.vehicle) {
      let best = 3.2;
      for (const n of this.npcs) {
        if (!n.alive || !n.key || n.removed) continue;
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d < best && this.story?.canTalk(n.key)) { best = d; this.interact = { kind: 'npc', npc: n }; prompt = `Talk to ${n.name}`; }
      }
      if (this.interact.kind === 'none') {
        for (const poi of this.world.pois) {
          if (!['shop', 'service', 'home'].includes(poi.kind) || poi.r < 2 || !this.interiors.supports(poi.id)) continue;
          if (Math.hypot(poi.x - p.x, poi.z - p.z) < poi.r) {
            this.interact = { kind: 'poi', poi: poi.id };
            prompt = poi.kind === 'home' ? 'Enter Safehouse' : `Walk into ${poi.name}`;
            break;
          }
        }
      }
      if (this.interact.kind === 'none') {
        let bd = 3.6, bv: Vehicle | null = null;
        for (const v of this.vehicles) {
          if (v.wrecked || v.role === 'swat') continue;
          const d = Math.hypot(v.x - p.x, v.z - p.z);
          if (d < bd + v.spec.L * 0.1) { bd = d; bv = v; }
        }
        if (bv) { this.interact = { kind: 'veh', veh: bv }; prompt = bv.role === 'traffic' || bv.role === 'police' ? `Carjack ${bv.spec.name}` : `Enter ${bv.spec.name}`; }
      }
    } else {
      const v = p.vehicle;
      prompt = 'Exit vehicle';
      // service POIs while driving
      for (const poi of this.world.pois) {
        if (poi.r < 2 || !['service'].includes(poi.kind)) continue;
        if ((poi.id === 'garage' || poi.id === 'spray') && Math.hypot(poi.x - p.x, poi.z - p.z) < poi.r + 3 && Math.abs(v.speed) < 6) {
          this.interact = { kind: 'poi', poi: poi.id };
          prompt = `${poi.name} — [E] Service`;
        }
      }
      if (this.interact.kind === 'none') this.interact = { kind: 'veh', veh: v };
    }
    hud.prompt = prompt;
  }

  private doInteract() {
    const it = this.interact;
    if (it.kind === 'npc' && it.npc) this.story?.talk(it.npc.key);
    else if (it.kind === 'poi' && it.poi) {
      if (it.poi === '__exit') this.interiors.exit();
      else if (this.interiors.current) this.openPoi(it.poi);
      else if (this.player.vehicle || !this.interiors.supports(it.poi)) this.openPoi(it.poi);
      else this.interiors.enter(it.poi);
    }
    else if (it.kind === 'veh' && it.veh) {
      if (this.player.vehicle) this.exitVehicle();
      else this.enterVehicle(it.veh);
    }
  }

  enterVehicle(v: Vehicle) {
    const p = this.player;
    if (v.role === 'traffic' || v.role === 'police') {
      // pull the driver out
      const look = this.crowd.looks[Math.floor(Math.random() * this.crowd.looks.length)];
      const side = Math.sign(this.toLocal(v, p.x, p.z).x) || 1;
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const n = this.spawnNpc(look, 'ped', v.x + Math.cos(v.heading) * side * 2.2, v.z - Math.sin(v.heading) * side * 2.2 + fz * 0, 0);
      n.state = 'flee'; n.stateT = 8; n.fleeFrom = { x: p.x, z: p.z };
      void fx;
      this.crime(v.role === 'police' ? 3 : 2, v.x, v.z);
      this.crowd.scareAround(v.x, v.z, 30);
      const ai = v.ai as { pursuit?: boolean } | null;
      if (ai) ai.pursuit = false;
      v.sirenOn = false;
      v.role = 'player';
      this.traffic.list = this.traffic.list.filter((q) => q !== v);
    }
    v.role = 'player';
    v.isPlayer = true;
    v.driver = this.playerHuman;
    p.vehicle = v;
    this.lastCar = v;
    v.group.add(this.playerHuman.root);
    this.playerHuman.root.position.set(v.model.driver.x, v.model.driver.y, v.model.driver.z);
    this.playerHuman.root.rotation.set(0, 0, 0);
    this.playerHuman.setWeapon(null);
    this.playerHuman.sitDrop = 0.43;
    this.audio.door();
    hud.inCar = true; hud.carName = v.spec.name;
    hud.radio = STATIONS[this.audio.station];
    this.camLookT = 0;
    this.camYaw = v.heading;
    emitHud();
  }

  exitVehicle() {
    const p = this.player;
    const v = p.vehicle;
    if (!v) return;
    // find a free spot next to the car
    const left = { x: Math.cos(v.heading), z: -Math.sin(v.heading) };
    let placed = false;
    for (const s of [1, -1]) {
      const x = v.x + left.x * s * (v.spec.W / 2 + 0.9), z = v.z + left.z * s * (v.spec.W / 2 + 0.9);
      if (!this.world.resolve(x, z, 0.4, this.tmpHit, 0.3) || !this.tmpHit.hit) { p.x = x; p.z = z; placed = true; break; }
    }
    if (!placed) { p.x = v.x + left.x * 2.5; p.z = v.z + left.z * 2.5; }
    p.y = this.world.groundY(p.x, p.z);
    p.vx = v.vx * 0.5; p.vz = v.vz * 0.5;
    p.heading = v.heading;
    v.group.remove(this.playerHuman.root);
    this.scene.add(this.playerHuman.root);
    this.playerHuman.root.position.set(p.x, p.y, p.z);
    this.playerHuman.root.rotation.set(0, p.heading, 0);
    v.driver = null; v.isPlayer = false;
    v.ctl = noControl();
    v.sirenOn = false; v.horn = false;
    p.vehicle = null;
    this.playerHs.stance = 'stand';
    this.selectWeapon(this.weapon);
    this.audio.door();
    this.audio.noEngine();
    this.audio.skid(0);
    hud.inCar = false;
    this.camYaw = p.heading;
    emitHud();
  }

  // ---------------------------------------------------------------- POIs & shops
  openPoi(id: string) {
    const p = this.player;
    const items = [];
    if (document.pointerLockElement) document.exitPointerLock();
    if (id === 'ammu') {
      for (const w of WEAPON_ORDER) {
        if (w === 'fists') continue;
        const d = WEAPONS[w];
        const owned = this.inv[w].have;
        items.push({ id: 'w:' + w, label: owned ? `${d.name} — ammo` : d.name, desc: owned ? `Buy a magazine (${d.mag} rounds)` : `Dmg ${d.dmg}${d.pellets > 1 ? '×' + d.pellets : ''} · ${d.rate}/s · mag ${d.mag}`, price: owned ? d.ammoPrice : d.price, tag: owned ? 'AMMO' : 'NEW' });
      }
      items.push({ id: 'armor', label: 'Body Armor', desc: 'Kevlar vest (+100 armor)', price: 500, tag: 'ARMOR' });
    } else if (id === 'burger') {
      items.push({ id: 'burger', label: 'Burger Shot Combo', desc: '+40 health', price: 18 }, { id: 'burger2', label: 'Double Meat Combo', desc: 'Full health', price: 45 });
    } else if (id === 'hospital') {
      items.push({ id: 'heal', label: 'Emergency Treatment', desc: 'Restore full health', price: 150 });
    } else if (id === 'garage') {
      items.push({ id: 'repair', label: 'Full Repair', desc: 'Repair body & engine of nearby car', price: 250 });
      for (const [n, c] of [['Midnight Black', 0x0b0b0e], ['Racing Red', 0xc41820], ['Electric Blue', 0x1368ff], ['Pearl White', 0xeeeeee], ['Sunset Orange', 0xff6a10], ['Toxic Green', 0x30d050], ['Hot Pink', 0xff2fa0], ['Gunmetal', 0x44484e]] as [string, number][]) items.push({ id: 'paint:' + c, label: `Respray — ${n}`, desc: 'Clearcoat respray', price: 120, tag: '#' + c.toString(16).padStart(6, '0') });
      items.push({ id: 'nitro', label: 'Nitro Refill', desc: 'Fill the nitrous tank', price: 80 });
    } else if (id === 'spray') {
      items.push({ id: 'spraywash', label: 'Respray & Clear Wanted Level', desc: 'Only works if police are not watching', price: 600 });
    } else if (id === 'dealer') {
      for (const [k, n, price] of [['sports', 'Vortex GT', 62000], ['muscle', 'Brawler SS', 41000], ['suv', 'Titan XL', 38000], ['sedan', 'Marquis LX', 24000], ['pickup', 'Hauler 250', 32000]] as [string, string, number][]) items.push({ id: 'car:' + k, label: n, desc: 'Delivered to the lot outside', price });
    } else if (id === 'home') {
      items.push({ id: 'save', label: 'Save Game', desc: 'Progress is stored in your browser', price: 0 }, { id: 'sleep', label: 'Sleep until morning', desc: 'Skip to 07:00 and recover health', price: 0 });
    }
    void p;
    const poi = this.world.pois.find((q) => q.id === id)!;
    hud.shop = { id, title: poi.name, sub: id === 'garage' ? 'Your last car must be nearby' : `Cash ${fmtMoney(this.player.cash)}`, items };
    emitHud();
  }

  closeShop() {
    hud.shop = null;
    emitHud();
    if (hud.phase === 'playing') this.canvas.requestPointerLock();
  }

  buy(itemId: string) {
    const shop = hud.shop;
    if (!shop) return;
    const item = shop.items.find((i) => i.id === itemId);
    if (!item) return;
    if (this.player.cash < item.price) { this.toast('Not enough cash', `You need ${fmtMoney(item.price)}`, 'bad'); this.audio.fail(); return; }
    const pay = () => { this.player.cash -= item.price; this.audio.cash(); };
    const car = this.player.vehicle ?? this.lastCar;
    if (itemId.startsWith('w:')) {
      const id = itemId.slice(2) as WeaponId; const d = WEAPONS[id];
      const had = this.inv[id].have;
      pay(); this.giveWeapon(id, had ? d.mag : d.mag * 2);
      if (!had) this.selectWeapon(id);
      this.toast(d.name, had ? 'Ammo purchased' : 'Purchased', 'good');
    } else if (itemId === 'armor') { pay(); this.player.armor = 100; this.toast('Body Armor', 'Equipped', 'good'); }
    else if (itemId === 'burger') { pay(); this.player.hp = Math.min(100, this.player.hp + 40); }
    else if (itemId === 'burger2' || itemId === 'heal') { pay(); this.player.hp = 100; this.toast('Health', 'Fully restored', 'good'); }
    else if (itemId === 'repair') { if (!car) return; pay(); car.repair(); this.toast('Garage', 'Car fully repaired', 'good'); }
    else if (itemId.startsWith('paint:')) { if (!car) return; pay(); car.setColor(parseInt(itemId.slice(6))); this.interiors.recolor(parseInt(itemId.slice(6))); this.toast('Garage', 'Fresh paint job', 'good'); }
    else if (itemId === 'nitro') { if (!car) return; pay(); car.nitro = 1; }
    else if (itemId === 'spraywash') {
      if (!car) { this.toast('Pay\'n\'Spray', 'Drive in with a car first', 'bad'); return; }
      if (this.police.unseenFor < 3 && this.wanted > 0) { this.toast('Pay\'n\'Spray', 'The cops are watching — lose them first!', 'bad'); return; }
      pay(); car.repair(); car.setColor([0x1368ff, 0x30d050, 0xeeeeee, 0x111111, 0xc41820][Math.floor(Math.random() * 5)]);
      this.setWanted(0, true); this.toast('Pay\'n\'Spray', 'Fresh paint. Heat is off.', 'good');
    } else if (itemId.startsWith('car:')) {
      pay();
      const dealer = this.world.pois.find((q) => q.id === 'dealer')!;
      const v = this.spawnCar(itemId.slice(4) as CarKind, 0x1c1d20 + Math.floor(Math.random() * 0xffffff) % 0x606060, dealer.x + 24, dealer.z + 2, Math.PI / 2, 'player');
      this.ownedCars.push(itemId.slice(4));
      v.role = 'parked';
      this.toast('Premium Motors', `${v.spec.name} delivered outside`, 'good');
    } else if (itemId === 'save') { this.saveGame(); this.toast('Saved', 'Progress saved', 'good'); }
    else if (itemId === 'sleep') { this.sky.hour = 7; this.player.hp = 100; this.saveGame(); this.toast('Good morning', 'You slept well. Game saved.', 'good'); this.closeShop(); }
    hud.cash = this.player.cash;
    shop.sub = `Cash ${fmtMoney(this.player.cash)}`;
    this.updateWeaponHud();
    emitHud();
  }

  addCashQuiet(n: number) {
    this.player.cash += n;
    hud.cash = this.player.cash;
    if (n > 0) this.hustle.progress('cash', n);
    emitHud();
  }
  addCash(n: number) {
    this.player.cash += n;
    hud.cash = this.player.cash;
    if (n > 0) this.hustle.progress('cash', n);
    if (n >= 50) this.toast(n > 0 ? `+${fmtMoney(n)}` : fmtMoney(n), '', 'cash');
  }

  // =================================================================== combat
  private updateWeapons(dt: number) {
    const p = this.player;
    const def = WEAPONS[this.weapon], inv = this.inv[this.weapon];
    this.fireT -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const take = Math.min(def.mag - inv.mag, inv.reserve);
        inv.mag += take; inv.reserve -= take;
        this.updateWeaponHud();
      }
    }
    if (this.wm) {
      const m = this.wm.flash.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, m.opacity - dt * 22);
    }
    if (p.vehicle || this.state !== 'play' || hud.dialogue || hud.shop || this.interiors.current) return;
    if (this.pressed('KeyR') && def.mag > 0 && inv.mag < def.mag && inv.reserve > 0 && this.reloadT <= 0) {
      this.reloadT = def.reload * this.hustle.reloadMul;
      this.audio.reload();
      this.updateWeaponHud();
    }
    // melee
    if (def.cls === 'none' || def.cls === 'melee') {
      this.comboT += dt;
      if (this.meleeT > 0) {
        this.meleeT -= dt;
        if (!this.meleeHit && this.meleeT < (this.swingStage === 2 ? 0.24 : 0.2)) { this.meleeHit = true; this.doMelee(def, this.swingStage); }
        if (this.meleeT <= 0) this.meleeFace = null;
      }
      if (this.mouseDown && this.fireT <= 0 && !p.block && this.dodgeT <= 0 && document.pointerLockElement === this.canvas) {
        if (this.comboT > 1.1) this.combo = 0;
        this.swingStage = this.combo % 3;
        this.combo++;
        this.comboT = 0;
        const slow = def.id === 'bat' ? 1.3 : 1;
        this.fireT = (this.swingStage === 2 ? 0.7 : 0.27) * slow;
        this.meleeT = this.swingStage === 2 ? 0.44 : 0.34; this.meleeHit = false;
        this.lunge();
        this.playerHuman.punch();
        this.audio.swing();
      }
      return;
    }
    if (!this.mouseDown || document.pointerLockElement !== this.canvas) return;
    if (this.fireT > 0 || this.reloadT > 0) return;
    if (!def.auto && this.heldLast) return;
    if (inv.mag <= 0) {
      this.audio.empty();
      this.fireT = 0.3;
      if (inv.reserve > 0) { this.reloadT = def.reload * this.hustle.reloadMul; this.audio.reload(); this.updateWeaponHud(); }
      return;
    }
    this.fireT = 1 / def.rate;
    inv.mag--;
    this.fireWeapon(def);
    this.updateWeaponHud();
  }
  private get heldLast() { return this.mouseDownPrev; }
  private mouseDownPrev = false;

  private fireWeapon(def: WeaponDef) {
    const p = this.player;
    this.lastShot = this.time;
    this.playerHuman.shoot();
    this.audio.gunshot(def.id, 1);
    this.crowd.scareAround(p.x, p.z, 45 * def.loud);
    this.crime(2, p.x, p.z);
    // aim point from camera ray
    const camDir = new THREE.Vector3(); this.camera.getWorldDirection(camDir);
    const camPos = this.camera.position.clone();
    const first = this.castRay(camPos.x, camPos.y, camPos.z, camDir.x, camDir.y, camDir.z, def.range + 20, { skipPlayer: true });
    const aimPt = first.kind === 'none' ? camPos.clone().addScaledVector(camDir, 80) : camPos.clone().addScaledVector(camDir, first.t);
    const assist = this.assistTarget(camPos, camDir, def, p.aim ? 0.075 : 0.035);
    if (assist) aimPt.copy(assist);
    const muz = new THREE.Vector3();
    if (this.wm) { this.wm.muzzle.updateWorldMatrix(true, false); this.wm.muzzle.getWorldPosition(muz); this.wm.flash.material instanceof THREE.MeshBasicMaterial && (this.wm.flash.material.opacity = 1); this.wm.flash.rotation.z = Math.random() * 6; }
    else muz.set(p.x, p.y + 1.4, p.z);
    if (def.explosive) { this.launchRocket(muz, aimPt, 'player'); this.camShake += 0.6; this.camPitch -= 0.04; return; }
    const moving = Math.hypot(p.vx, p.vz) > 1;
    const spread = def.spread * (p.aim ? 0.6 : 1.5) * (moving ? 1.4 : 1) * (p.crouch ? 0.7 : 1);
    for (let i = 0; i < def.pellets; i++) {
      const dir = aimPt.clone().sub(muz).normalize();
      dir.x += (Math.random() - 0.5) * spread * 2; dir.y += (Math.random() - 0.5) * spread * 2; dir.z += (Math.random() - 0.5) * spread * 2;
      dir.normalize();
      this.bullet(muz, dir, def, 'player');
    }
    this.fx.muzzle(muz, camDir);
    this.camPitch -= 0.006 * def.kick;
    this.camYaw += (Math.random() - 0.5) * 0.004 * def.kick;
    this.camShake += 0.04 * def.kick;
  }

  /** shared hitscan for player & npcs */
  bullet(origin: THREE.Vector3, dir: THREE.Vector3, def: WeaponDef, from: 'player' | 'npc', shooter?: Npc) {
    const r = this.castRay(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, def.range, { skipNpc: shooter, skipPlayer: from === 'player' });
    const end = origin.clone().addScaledVector(dir, r.kind === 'none' ? Math.min(def.range, 120) : r.t);
    if (def.pellets === 1 || Math.random() < 0.3) this.fx.tracer(origin.clone().addScaledVector(dir, 1.5), end);
    const n = new THREE.Vector3(r.nx, r.ny, r.nz);
    if (r.kind === 'npc' && r.npc) {
      const dmg = from === 'player' ? def.dmg * this.hustle.gunMul : def.dmg;
      if (from === 'player') this.killCtx = { head: !!r.head, melee: false };
      const killed = r.npc.hurt(dmg, this, origin.x, origin.z, !!r.head, from === 'player', 0);
      this.killCtx = { head: false, melee: false };
      this.fx.spark(end, n, 3, [0.8, 0.1, 0.1]);
      if (from === 'player') {
        hud.hitMarker = killed ? 2 : 1; this.audio.hit();
        this.floaterAt(end.x, end.y + 0.25, end.z, r.head ? `${Math.round(dmg * 2.6)} HEAD` : `${Math.round(dmg)}`, r.head ? 'crit' : 'dmg');
        if (!killed) this.hustle.addStyle(r.head ? 12 : 4, r.head ? 'HEADSHOT' : 'HIT');
        if (r.head && !killed) this.camShake += 0.05;
      }
    } else if (r.kind === 'vehicle' && r.veh) {
      r.veh.damage(def.dmg * 2.2);
      this.fx.spark(end, n, 4);
      if (from === 'player') { hud.hitMarker = 1; this.audio.hit(); const ai = r.veh.ai as { panic?: number } | null; if (ai) ai.panic = 8; if (r.veh.role === 'police') this.crime(3, r.veh.x, r.veh.z); }
      if (r.veh === this.player.vehicle) this.damagePlayer(def.dmg * 0.4, origin.x, origin.z);
    } else if (r.kind === 'world' || r.kind === 'ground') {
      this.fx.spark(end, n, 4);
      this.fx.hole(end, n);
      if (r.kind === 'ground') this.fx.dust(end.x, end.y, end.z, 0, 0, 2);
    } else if (r.kind === 'none') { /* miss */ }
    // player hit?
    if (from === 'npc') {
      const p = this.player;
      const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
      const py = p.vehicle ? p.vehicle.y + 1 : p.y + 0.9;
      const t = r.kind === 'none' ? def.range : r.t;
      // closest approach of ray to player
      const rx = px - origin.x, ry = py - origin.y, rz = pz - origin.z;
      const proj = rx * dir.x + ry * dir.y + rz * dir.z;
      if (proj > 0 && proj < t) {
        const cx = rx - dir.x * proj, cy = ry - dir.y * proj, cz = rz - dir.z * proj;
        if (Math.hypot(cx, cy, cz) < (p.vehicle ? 1.1 : 0.5)) {
          this.damagePlayer(def.dmg * 0.4 * (p.vehicle ? 0.5 : 1), origin.x, origin.z);
          this.fx.spark(new THREE.Vector3(px, py, pz), new THREE.Vector3(0, 1, 0), 2, [0.8, 0.1, 0.1]);
        }
      }
      if (this.audio) this.audio.gunshot(def.id, clamp(1 - Math.hypot(origin.x - px, origin.z - pz) / 90, 0.1, 0.8));
    }
  }

  npcShoot(n: Npc, def: WeaponDef) {
    const p = this.player;
    const origin = new THREE.Vector3();
    if (n.wm) { n.wm.muzzle.updateWorldMatrix(true, false); n.wm.muzzle.getWorldPosition(origin); (n.wm.flash.material as THREE.MeshBasicMaterial).opacity = 1; }
    else origin.set(n.x, n.y + 1.4, n.z);
    n.human.shoot();
    const tx = p.vehicle ? p.vehicle.x : p.x, tz = p.vehicle ? p.vehicle.z : p.z, ty = (p.vehicle ? p.vehicle.y + 1 : p.y + 1.1);
    const dist = Math.hypot(tx - origin.x, tz - origin.z);
    const sp = 0.02 + dist * 0.0018 + (n.role === 'gang' ? 0.03 : 0.01) + (p.vehicle ? Math.min(0.1, Math.abs(p.vehicle.speed) * 0.004) : Math.hypot(p.vx, p.vz) * 0.006);
    const pellets = Math.min(def.pellets, 5);
    for (let i = 0; i < pellets; i++) {
      const d = new THREE.Vector3(tx - origin.x + (Math.random() - 0.5) * sp * dist * 2, ty - origin.y + (Math.random() - 0.5) * sp * dist * 1.2, tz - origin.z + (Math.random() - 0.5) * sp * dist * 2).normalize();
      this.bullet(origin, d, { ...def, dmg: def.dmg * 0.8 }, 'npc', n);
    }
    this.fx.muzzle(origin, new THREE.Vector3(Math.sin(n.heading), 0, Math.cos(n.heading)));
    this.crowd.scareAround(n.x, n.z, 40);
  }

  castRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, o: { skipNpc?: Npc; skipPlayer?: boolean } = {}): RayHit {
    let best: RayHit = { t: max, kind: 'none', nx: 0, ny: 1, nz: 0 };
    const tw = this.world.rayBoxes(ox, oy, oz, dx, dy, dz, max);
    if (tw < best.t) {
      // estimate normal from the dominant axis of the hit point relative to nearest box
      const hx = ox + dx * tw, hz = oz + dz * tw;
      let nx = -Math.sign(dx), nz = 0;
      const e = 0.05;
      const test = (x: number, z: number) => this.world.rayBoxes(x, oy + dy * tw, z, 0, 1, 0, 0.01) < 0.02 || this.world.rayBoxes(x, oy + dy * tw, z, 1, 0, 0, 0.001) < 0.0005;
      void test; void e;
      if (Math.abs(dz) > Math.abs(dx)) { nx = 0; nz = -Math.sign(dz); }
      best = { t: tw, kind: 'world', nx, ny: 0, nz };
      void hx; void hz;
    }
    if (dy < -1e-4) {
      const tg = -oy / dy;
      if (tg > 0 && tg < best.t) best = { t: tg, kind: 'ground', nx: 0, ny: 1, nz: 0 };
    }
    for (const n of this.crowd.list) {
      if (!n.alive || n === o.skipNpc || Math.abs(n.x - ox) > max + 2 || Math.abs(n.z - oz) > max + 2) continue;
      const fx = ox - n.x, fz = oz - n.z;
      const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), Cq = fx * fx + fz * fz - 0.34 * 0.34;
      const disc = B * B - 4 * A * Cq;
      if (disc < 0 || A < 1e-8) continue;
      const t = (-B - Math.sqrt(disc)) / (2 * A);
      if (t < 0 || t > best.t) continue;
      const y = oy + dy * t;
      const sc = n.human.height;
      if (y < n.y - 0.05 || y > n.y + 1.85 * sc) continue;
      best = { t, kind: 'npc', npc: n, head: y > n.y + 1.52 * sc, nx: -dx, ny: 0, nz: -dz };
    }
    for (const v of this.vehicles) {
      if (v.wrecked && v.exploded && false) continue;
      if (Math.abs(v.x - ox) > max + 6 || Math.abs(v.z - oz) > max + 6) continue;
      if (v === this.player.vehicle && o.skipPlayer) continue;
      const c = Math.cos(v.heading), s = Math.sin(v.heading);
      const lox = (ox - v.x) * c - (oz - v.z) * s, loz = (ox - v.x) * s + (oz - v.z) * c;
      const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
      let t0 = 0, t1 = best.t;
      const hw = v.spec.W / 2, hl = v.spec.L / 2;
      const slab = (o2: number, d: number, mn: number, mx: number) => {
        if (Math.abs(d) < 1e-8) return o2 >= mn && o2 <= mx;
        let a = (mn - o2) / d, b = (mx - o2) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        return t0 <= t1;
      };
      if (slab(lox, ldx, -hw, hw) && slab(oy - v.y, dy, 0.2, v.spec.H) && slab(loz, ldz, -hl, hl) && t0 < best.t) best = { t: t0, kind: 'vehicle', veh: v, nx: -dx, ny: 0.3, nz: -dz };
    }
    return best;
  }

  private lunge() {
    const p = this.player;
    const cf = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
    const { ix, iz } = this.moveInput();
    const cr = { x: -Math.cos(this.camYaw), z: Math.sin(this.camYaw) };
    let dx = cf.x * iz + cr.x * ix, dz = cf.z * iz + cr.z * ix;
    const l = Math.hypot(dx, dz);
    if (l > 0) { dx /= l; dz /= l; } else { dx = Math.sin(p.heading); dz = Math.cos(p.heading); }
    // soft lock-on: the nearest enemy in front of you
    let best: Npc | null = null, bs = 1e9;
    for (const n of this.crowd.list) {
      if (!n.alive || n.removed) continue;
      const tx = n.x - p.x, tz = n.z - p.z, d = Math.hypot(tx, tz);
      if (d > 4.6 || d < 0.01) continue;
      const dot = (tx * dx + tz * dz) / d;
      if (dot < 0.3) continue;
      const score = d - dot * 1.2 - (n.hostile ? 1.2 : 0);
      if (score < bs) { bs = score; best = n; }
    }
    if (best) {
      const tx = best.x - p.x, tz = best.z - p.z, d = Math.hypot(tx, tz);
      this.meleeFace = Math.atan2(tx, tz);
      p.heading = this.meleeFace;
      if (d > 1.15) { const sp = Math.min(10, (d - 0.95) * 9); this.lungeV = { x: (tx / d) * sp, z: (tz / d) * sp }; this.lungeT = 0.14; }
    } else {
      this.meleeFace = Math.atan2(dx, dz);
      this.lungeV = { x: dx * 3.2, z: dz * 3.2 }; this.lungeT = 0.1;
    }
  }

  private doMelee(def: WeaponDef, stage = 0) {
    const p = this.player;
    let hitAny = false;
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
    this.crime(1, p.x, p.z);
    const fin = stage === 2;
    const mult = [1, 1.15, 1.9][stage] * this.hustle.meleeMul;
    const reach = def.range + (fin ? 1.0 : 0.55);
    for (const n of this.crowd.list) {
      if (!n.alive) continue;
      const dx = n.x - p.x, dz = n.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > reach || (dx * fx + dz * fz) / (d || 1) < (fin ? -0.15 : 0.2)) continue;
      const dmg = def.dmg * mult;
      this.killCtx = { head: false, melee: true };
      const killed = n.hurt(dmg, this, p.x, p.z, false, true, fin ? 11 : stage === 1 ? 4.5 : 3.2);
      this.killCtx = { head: false, melee: false };
      if (killed && fin) { n.vx *= 1.7; n.vz *= 1.7; }
      if (!killed) { n.stagger(fin ? 1.5 : 0.45); n.human.flinch(); }
      hitAny = true;
      this.fx.spark(new THREE.Vector3(n.x, n.y + 1.3, n.z), new THREE.Vector3(-fx, 0.2, -fz), fin ? 6 : 3, [0.9, 0.3, 0.2]);
      this.floaterAt(n.x, n.y + 2.0 * n.human.height, n.z, fin ? `${Math.round(dmg)} FINISHER` : `${Math.round(dmg)}`, fin ? 'crit' : 'dmg');
      if (n.role === 'gang' || n.role === 'cop' || n.role === 'swat') this.hustle.addStyle(fin ? 28 : 7 + stage * 2, fin ? 'FINISHER' : `COMBO x${this.combo}`);
      if (fin && (n.role === 'gang')) this.hustle.progress('finishers');
      if (n.role === 'cop' || n.role === 'swat') this.crime(4, n.x, n.z);
    }
    if (hitAny) {
      this.audio.punch(); hud.hitMarker = fin ? 2 : 1;
      this.camShake += fin ? 0.4 : 0.12;
      this.hitStop = Math.max(this.hitStop, fin ? 0.13 : 0.05);
      if (fin) this.camPitch -= 0.03;
    } else if (this.comboT < 5) { this.comboT = 9; }
  }

  /** gentle bullet magnetism so gunfights feel fair: picks the hostile closest to your crosshair */
  private assistTarget(camPos: THREE.Vector3, camDir: THREE.Vector3, def: WeaponDef, maxAng: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null, ba = maxAng;
    for (const n of this.crowd.list) {
      if (!n.alive || n.removed || (n.role === 'ped' && !n.hostile) || n.role === 'story') continue;
      const s = n.human.height;
      const chest = new THREE.Vector3(n.x, n.y + 1.15 * s, n.z);
      const to = chest.clone().sub(camPos);
      const dist = to.length();
      if (dist > def.range * 0.9 || dist < 2) continue;
      to.divideScalar(dist);
      const ang = Math.acos(clamp(to.dot(camDir), -1, 1));
      if (ang > ba) continue;
      const wr = this.world.rayBoxes(camPos.x, camPos.y, camPos.z, to.x, to.y, to.z, dist);
      if (wr < dist - 0.8) continue;
      ba = ang;
      best = this.player.aim && ang < maxAng * 0.55 ? new THREE.Vector3(n.x, n.y + 1.62 * s, n.z) : chest;
    }
    return best;
  }

  private updateTargeting() {
    const p = this.player;
    const cls = WEAPONS[this.weapon].cls;
    if (p.vehicle || this.interiors.current || (cls !== 'pistol' && cls !== 'twohand')) { hud.onTarget = false; return; }
    const d = new THREE.Vector3(); this.camera.getWorldDirection(d);
    const c = this.camera.position;
    const r = this.castRay(c.x, c.y, c.z, d.x, d.y, d.z, 90, { skipPlayer: true });
    hud.onTarget = r.kind === 'npc' && !!r.npc && (r.npc.role !== 'ped' || r.npc.hostile);
  }

  npcMeleeHit(n: Npc, dmg: number) {
    const p = this.player;
    if (this.state !== 'play') return;
    const dx = n.x - p.x, dz = n.z - p.z;
    if (this.dodgeT > 0.08) { this.damagePlayer(dmg, n.x, n.z); return; }
    if (p.block && (dx * Math.sin(p.heading) + dz * Math.cos(p.heading)) > -0.3) {
      if (this.blockT < 0.3) {
        n.stagger(1.7); n.human.flinch();
        this.hustle.parry();
        this.hitStop = Math.max(this.hitStop, 0.14);
        this.fx.spark(new THREE.Vector3(p.x + dx * 0.4, p.y + 1.3, p.z + dz * 0.4), new THREE.Vector3(0, 0.5, 0), 8, [1, 0.9, 0.5]);
        this.floaterAt(p.x, p.y + 2, p.z, 'PARRY!', 'good');
        this.audio.punch(); this.camShake += 0.25;
        n.vx -= dx * 0.8; n.vz -= dz * 0.8;
        return;
      }
      this.floaterAt(p.x, p.y + 2, p.z, 'BLOCKED', 'info');
      this.audio.hit();
      this.damagePlayer(dmg * 0.2, n.x, n.z);
      return;
    }
    this.damagePlayer(dmg, n.x, n.z);
    const d = Math.hypot(dx, dz) || 1;
    p.vx -= (dx / d) * 4; p.vz -= (dz / d) * 4;
    this.camShake += 0.3;
    this.audio.punch();
  }

  floaterAt(x: number, y: number, z: number, text: string, kind: 'dmg' | 'crit' | 'info' | 'warn' | 'good' = 'info') {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return;
    const id = this.floaterId++;
    hud.floaters = [...hud.floaters.slice(-9), { id, x: (v.x * 0.5 + 0.5) * 100, y: (-v.y * 0.5 + 0.5) * 100, text, kind }];
    emitHud();
    setTimeout(() => { hud.floaters = hud.floaters.filter((f) => f.id !== id); emitHud(); }, kind === 'warn' ? 520 : 950);
  }

  private launchRocket(from: THREE.Vector3, to: THREE.Vector3, owner: 'player' | 'npc') {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0x555a50, metalness: 0.7, roughness: 0.4 }));
    mesh.geometry.rotateX(Math.PI / 2);
    this.scene.add(mesh);
    const v = to.clone().sub(from).normalize().multiplyScalar(70);
    this.projs.push({ mesh, p: from.clone(), v, life: 4, from: owner });
    this.audio.gunshot('rpg');
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const q = this.projs[i];
      q.life -= dt;
      const step = q.v.clone().multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().normalize();
      const r = this.castRay(q.p.x, q.p.y, q.p.z, dir.x, dir.y, dir.z, len + 0.3, { skipPlayer: q.life > 3.6 });
      q.p.add(step);
      q.mesh.position.copy(q.p);
      q.mesh.lookAt(q.p.clone().add(q.v));
      this.fx.smoke.emit(q.p.x, q.p.y, q.p.z, 0, 0.3, 0, 1.2, 0.3, 1.6, 0.8, 0.8, 0.8, 0.5, 0, 0.98);
      this.fx.glow.emit(q.p.x, q.p.y, q.p.z, 0, 0, 0, 0.12, 0.5, 0.1, 1, 0.6, 0.2, 1);
      if (r.kind !== 'none' || q.life <= 0 || q.p.y < 0.05) {
        this.explodeAt(q.p.x, Math.max(q.p.y, 0.3), q.p.z, 11, 260, q.from);
        this.scene.remove(q.mesh);
        this.projs.splice(i, 1);
      }
    }
  }

  explodeAt(x: number, y: number, z: number, radius: number, dmg: number, src: 'player' | 'npc' | 'veh') {
    this.fx.explosion(x, y, z, radius > 8 ? 1.2 : 0.9);
    const pd = Math.hypot(x - this.player.x, z - this.player.z);
    this.audio.explosion(pd);
    this.camShake += clamp(1 - pd / 80, 0, 1) * 1.2;
    this.crowd.scareAround(x, z, 70);
    for (const n of this.crowd.list) {
      if (!n.alive) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < radius * 1.3) n.hurt(dmg * (1 - d / (radius * 1.3)) * 1.5, this, x, z, false, src === 'player', 14 * (1 - d / radius));
    }
    for (const v of this.vehicles) {
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < radius * 1.6) {
        const k = 1 - d / (radius * 1.6);
        v.damage(dmg * k * 3);
        const l = d || 1;
        v.vx += ((v.x - x) / l) * 16 * k; v.vz += ((v.z - z) / l) * 16 * k;
        if (v.vy < 1 && k > 0.3) v.vy = 6 * k;
        if (src === 'player' && v.role === 'police') this.crime(3, x, z);
      }
    }
    const pdist = this.player.vehicle ? Math.hypot(this.player.vehicle.x - x, this.player.vehicle.z - z) : pd;
    if (pdist < radius * 1.3) this.damagePlayer(dmg * 0.5 * (1 - pdist / (radius * 1.3)), x, z);
    if (src === 'player') this.crime(3, x, z);
  }

  onVehicleExplode(v: Vehicle) {
    this.explodeAt(v.x, v.y + 0.6, v.z, 9, 150, v.role === 'player' || this.lastCar === v ? 'player' : 'veh');
    this.fx.debrisBurst(v.x, v.y, v.z, v.color, 12);
    if (v === this.player.vehicle) {
      this.exitVehicle();
      this.damagePlayer(70, v.x, v.z);
      this.player.vy = 7;
      this.player.onGround = false;
    }
  }

  onVehicleCrash(v: Vehicle, impact: number, x: number, z: number) {
    const d = Math.hypot(x - this.player.x, z - this.player.z);
    if (d < 120) this.audio.crash(impact * clamp(1 - d / 120, 0.2, 1));
    this.fx.spark(new THREE.Vector3(x, 0.6, z), new THREE.Vector3(0, 1, 0), Math.min(12, Math.floor(impact)), [1, 0.8, 0.4]);
    if (impact > 7) this.fx.debrisBurst(x, 0.5, z, v.color, Math.floor(impact / 4));
    if (v === this.player.vehicle) {
      this.camShake += clamp(impact / 20, 0, 0.8);
      if (impact > 11) this.damagePlayer((impact - 11) * 2.2, x, z);
    }
    if (impact > 5) this.crowd.scareAround(x, z, 22);
    void v;
  }

  onNpcHurtByPlayer(n: Npc) {
    if (n.role === 'cop' || n.role === 'swat') this.crime(4, n.x, n.z);
    else if (n.role === 'ped') this.crime(1, n.x, n.z);
  }

  onNpcKilled(n: Npc, byPlayer: boolean) {
    if (n.cash > 0 || n.role === 'gang') this.dropCash(n.x, n.z, n.cash || 40 + Math.floor(Math.random() * 120));
    if (byPlayer) {
      hud.stats.kills++;
      if (n.role === 'cop') { this.crime(5, n.x, n.z); }
      else if (n.role === 'swat') this.crime(5, n.x, n.z);
      else if (n.role === 'ped') this.crime(3, n.x, n.z);
      hud.hitMarker = 2;
    }
    if (byPlayer) this.hustle.onKill(n, this.killCtx.head, this.killCtx.melee);
    this.killCtx = { head: false, melee: false };
    this.crowd.scareAround(n.x, n.z, 30);
  }

  dropCash(x: number, z: number, amt: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.18), new THREE.MeshStandardMaterial({ color: 0x4acb6a, emissive: 0x1a6a2a, emissiveIntensity: 0.6, roughness: 0.5 }));
    mesh.position.set(x, 0.6, z);
    this.scene.add(mesh);
    this.pickups.push({ mesh, x, z, amt, t: 60 });
  }

  // ---------------------------------------------------------------- crime & wanted
  private witnessed(x: number, z: number) {
    for (const n of this.crowd.list) {
      if (!n.alive) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if ((n.role === 'cop' || n.role === 'swat') && d < 70) return 2;
      if (n.role === 'ped' && d < 22 && Math.random() < 0.02) return 1;
    }
    for (const v of this.police.cars) if (Math.hypot(v.x - x, v.z - z) < 70) return 2;
    for (const v of this.vehicles) if (v.role === 'police' && Math.hypot(v.x - x, v.z - z) < 60) return 2;
    return 0;
  }
  crime(sev: number, x: number, z: number) {
    if (this.state !== 'play') return;
    if (this.flags.noWanted) return;
    const w = this.witnessed(x, z);
    if (!w && sev < 3) return;
    if (!w && Math.random() > 0.35) return;
    const map = [0, 1, 1, 2, 3, 4];
    const target = map[Math.min(5, sev)];
    if (target > this.wanted) this.setWanted(target);
    else if (sev >= 4 && this.wanted < 5 && Math.random() < 0.4) this.setWanted(this.wanted + 1);
  }
  setWanted(n: number, silent = false) {
    n = clamp(n, 0, 5);
    if (n > this.wanted && !silent) { this.audio.wanted(); this.toast('WANTED', '★'.repeat(n), 'bad'); }
    if (n < this.wanted && n === 0) this.toast('Wanted level cleared', 'You lost the cops', 'good');
    this.wanted = n;
    hud.wanted = n;
    if (n === 0) hud.evading = false;
    emitHud();
  }
  busted() {
    if (this.state !== 'play') return;
    this.state = 'busted';
    hud.overlay = 'busted'; hud.overlayText = 'BUSTED';
    this.respawnT = 4;
    this.audio.fail();
    if (this.missionRunning) this.abortMission('You were arrested');
    emitHud();
  }
  damagePlayer(n: number, sx: number, sz: number) {
    if (this.state !== 'play' || this.flags.god) return;
    const p = this.player;
    if (this.dodgeT > 0.08) {
      if (n >= 2 && this.time - this.perfectT > 0.7) {
        this.perfectT = this.time;
        this.hustle.perfectDodge();
        this.bulletT = 0.85; this.slowmo = 0.4;
        this.floaterAt(p.x, p.y + 1.9, p.z, 'PERFECT DODGE', 'good');
      }
      return;
    }
    n *= this.hustle.dmgTaken;
    this.hustle.onDamaged(n);
    if (p.armor > 0) { const a = Math.min(p.armor, n * 0.65); p.armor -= a; n -= a; }
    p.hp -= n;
    this.lastDamage = this.time;
    hud.damage = Math.min(1, hud.damage + n / 40);
    if (n > 3) this.audio.hurt();
    void sx; void sz;
    if (p.hp <= 0) { p.hp = 0; this.wasted(); }
  }
  wasted() {
    if (this.state !== 'play') return;
    this.state = 'dead';
    if (this.player.vehicle) this.exitVehicle();
    this.playerHuman.die();
    hud.overlay = 'wasted'; hud.overlayText = 'WASTED';
    this.respawnT = 4.2;
    this.slowmo = 0.35;
    this.audio.fail();
    if (this.missionRunning) this.abortMission('You died');
    emitHud();
  }
  respawn() {
    const arrested = this.state === 'busted';
    const poi = this.world.pois.find((q) => q.id === (arrested ? 'police' : 'hospital'))!;
    const p = this.player;
    const fine = Math.min(p.cash, Math.floor(200 + p.cash * 0.08));
    p.cash -= fine;
    hud.cash = p.cash;
    if (arrested) {
      for (const id of WEAPON_ORDER) if (id !== 'fists' && id !== 'bat') { this.inv[id].mag = 0; this.inv[id].reserve = Math.floor(this.inv[id].reserve * 0.3); }
      this.toast('Released', `Fine paid ${fmtMoney(fine)}. Ammo confiscated.`, 'bad');
    } else this.toast('Discharged', `Hospital bill ${fmtMoney(fine)}`, 'bad');
    p.x = poi.x + 2; p.z = poi.z - 2; p.y = this.world.groundY(p.x, p.z); p.hp = 100; p.vx = p.vz = 0;
    this.playerHuman.revive();
    this.playerHuman.root.rotation.set(0, 0, 0);
    this.setWanted(0, true);
    this.slowmo = 1;
    this.state = 'play';
    hud.overlay = null;
    this.police.cleanup(0);
    this.selectWeapon('fists');
    this.selectWeapon(this.inv.pistol.have ? 'pistol' : 'fists');
    this.camYaw = Math.PI;
    emitHud();
  }

  // =================================================================== world update
  private updateWorld(dt: number, night: number) {
    if (this.state !== 'menu' || true) {
      this.crowd.update(dt);
      this.traffic.update(dt);
      this.police.update(dt);
    }
    this.updateProjectiles(dt);
    // player vehicle physics
    const pv = this.player.vehicle;
    for (const v of this.vehicles) {
      if (v === pv || v.role === 'traffic' || v.role === 'police' && this.traffic.list.includes(v) || v.role === 'swat' && this.traffic.list.includes(v)) continue;
      v.update(dt, this.world, night);
    }
    if (pv) pv.update(dt, this.world, night);
    if (pv && pv.skid && Math.abs(pv.speed) > 10 && this.state === 'play') this.hustle.drift(Math.abs(pv.speed) * dt);
    // vehicle-vehicle collisions
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (Math.abs(a.x - b.x) > 6 || Math.abs(a.z - b.z) > 6) continue;
        this.collideCars(a, b);
      }
    }
    // vehicles hitting NPCs
    for (const v of vs) {
      if (Math.abs(v.speed) < 2.8 || v.wrecked) continue;
      for (const n of this.crowd.list) {
        if (!n.alive || Math.abs(n.x - v.x) > 4 || Math.abs(n.z - v.z) > 4) continue;
        const rel = this.toLocal(v, n.x, n.z);
        if (Math.abs(rel.x) < v.spec.W / 2 + 0.35 && Math.abs(rel.z) < v.spec.L / 2 + 0.3) {
          const byPlayer = v === pv;
          n.hurt(Math.abs(v.speed) * 6, this, v.x, v.z, false, byPlayer, Math.abs(v.speed) * 0.7);
          if (byPlayer) { this.audio.hit(); this.crime(1, n.x, n.z); }
          this.camShake += byPlayer ? 0.12 : 0;
        }
      }
    }
    // effects tied to vehicles
    for (const v of vs) {
      const dd = Math.hypot(v.x - this.player.x, v.z - this.player.z);
      if (dd > 140) continue;
      if (v.health < 450 && !v.exploded || v.wrecked) {
        const heat = v.wrecked ? 0.8 : v.burning;
        if (Math.random() < dt * 22) {
          const f = v.fwd();
          this.fx.carSmoke(v.x + f.x * (v.spec.zf - 0.2), v.y + 0.95, v.z + f.z * (v.spec.zf - 0.2), v.wrecked ? 0.9 : heat);
        }
      }
      if (v.skid && dd < 90) {
        const f = v.fwd();
        for (const w of v.model.wheels) {
          if (w.front && Math.abs(v.slip) < 4) continue;
          const wz = w.pivot.position.z, wx = w.pivot.position.x;
          const px = v.x + f.x * wz + -f.z * wx, pz = v.z + f.z * wz + f.x * wx;
          if (Math.random() < dt * 40) this.fx.tyreSmoke(px, v.y, pz, v.vx, v.vz);
          if (Math.random() < dt * 60) this.fx.skid(px, v.y, pz, v.heading + Math.atan2(v.slip, Math.abs(v.speed)) * 0);
        }
      }
      if (v.boosting) {
        const f = v.fwd();
        for (const e of v.model.exhaust) {
          const ex = v.x + f.x * e.z - f.z * e.x, ez = v.z + f.z * e.z + f.x * e.x;
          this.fx.glow.emit(ex, v.y + 0.35, ez, -f.x * 4, 0.2, -f.z * 4, 0.18, 0.7, 0.1, 0.4, 0.6, 1, 1);
        }
      }
    }
    // wanted: decay timers are in police
    // mission timer
    if (this.missionTimer && !this.paused) {
      this.missionTimer.t -= dt;
      if (this.missionTimer.t <= 0) { const cb = this.missionTimer.onEnd; this.missionTimer = null; cb?.(); }
    }
  }

  private collideCars(a: Vehicle, b: Vehicle) {
    const ca = this.carCircles(a), cb = this.carCircles(b);
    let hit = false, imp = 0;
    for (const p of ca) for (const q of cb) {
      const dx = q.x - p.x, dz = q.z - p.z;
      const rr = p.r + q.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      const depth = rr - d;
      const ma = a.mass, mb = b.mass;
      const ra = mb / (ma + mb), rb = ma / (ma + mb);
      const i1 = a.bump(-nx, -nz, depth * 0.55, b.vx, b.vz, ra);
      const i2 = b.bump(nx, nz, depth * 0.55, a.vx, a.vz, rb);
      imp = Math.max(imp, i1, i2);
      hit = true;
    }
    if (hit && imp > 2.5) {
      const now = performance.now();
      const last = (a as unknown as { _cc?: number })._cc ?? 0;
      if (now - last < 250) return;
      (a as unknown as { _cc: number })._cc = now;
      a.damage(imp * 7 * (b.mass / (a.mass + b.mass)) * 2);
      b.damage(imp * 7 * (a.mass / (a.mass + b.mass)) * 2);
      this.onVehicleCrash(a, imp, (a.x + b.x) / 2, (a.z + b.z) / 2);
      const ai = (v: Vehicle) => v.ai as { panic?: number } | null;
      if (a === this.player.vehicle || b === this.player.vehicle) {
        const other = a === this.player.vehicle ? b : a;
        const o = ai(other); if (o) o.panic = 6;
        if (other.role === 'police' || other.role === 'swat') { if (this.wanted === 0) this.crime(3, other.x, other.z); }
        this.crime(1, other.x, other.z);
      }
    }
  }
  private carCircles(v: Vehicle) {
    const f = v.fwd();
    const o = v.spec.L / 2 - v.spec.W / 2 - 0.1;
    const r = v.spec.W / 2 + 0.08;
    return [{ x: v.x + f.x * o, z: v.z + f.z * o, r }, { x: v.x, z: v.z, r }, { x: v.x - f.x * o, z: v.z - f.z * o, r }];
  }

  playerNear(v: Vehicle, d: number) {
    return Math.hypot(v.x - this.player.x, v.z - this.player.z) < d;
  }

  // =================================================================== camera
  private updateCamera(dt: number, snap = false) {
    const cam = this.camera;
    const p = this.player;
    const veh = p.vehicle;
    let tx = p.x, ty = p.y + 1.45, tz = p.z;
    let wantFov = 62;
    if (this.state === 'menu') {
      // slow orbit around Veer and his car
      const a = this.menuT * 0.22 + 0.6;
      const c = this.lastCar!;
      const cx = (p.x + c.x) / 2, cz = (p.z + c.z) / 2;
      cam.position.set(cx + Math.cos(a) * 6.4, 1.5 + Math.sin(this.menuT * 0.3) * 0.2, cz + Math.sin(a) * 6.4);
      cam.lookAt(p.x * 0.6 + c.x * 0.4, 1.15, p.z * 0.6 + c.z * 0.4);
      cam.fov = 38; cam.updateProjectionMatrix();
      return;
    }
    if (this.cinematicCam) {
      const c = this.cinematicCam;
      c.t += dt;
      const k = clamp(c.t / c.dur, 0, 1);
      cam.position.lerpVectors(c.from, c.to, k * k * (3 - 2 * k));
      cam.lookAt(c.look);
      if (c.t > c.dur + 0.5) this.cinematicCam = null;
      return;
    }
    if (this.dialogNpc && hud.dialogue) {
      const n = this.dialogNpc;
      const dx = n.x - p.x, dz = n.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d;
      const desired = new THREE.Vector3(p.x - ux * 1.0 - uz * 0.9, p.y + 1.55, p.z - uz * 1.0 + ux * 0.9);
      cam.position.lerp(desired, snap ? 1 : 1 - Math.exp(-dt * 3));
      cam.lookAt(n.x - ux * 0.0, n.y + 1.6, n.z);
      cam.fov = damp(cam.fov, 42, 4, dt); cam.updateProjectionMatrix();
      return;
    }
    if (veh) {
      const sp = Math.abs(veh.speed);
      // auto-recenter behind car unless the user recently moved the mouse
      const lookBack = this.down('KeyC');
      if (this.camLookT <= 0) this.camYaw = dampAngle(this.camYaw, veh.heading + (lookBack ? Math.PI : 0), 3.4, dt);
      this.camPitch = damp(this.camPitch, 0.16 + clamp(sp / 120, 0, 0.1), 2, dt);
      tx = veh.x; ty = veh.y + 1.3; tz = veh.z;
      this.camDist = damp(this.camDist, veh.spec.L * 1.35 + 2.2 + sp * 0.06, 3, dt);
      wantFov = 62 + clamp(sp * 0.55, 0, 24) + (veh.boosting ? 12 : 0);
    } else {
      const aim = p.aim;
      this.camDist = damp(this.camDist, aim ? 2.2 : this.playerHs.stance === 'crouch' ? 3.4 : 4.3, 8, dt);
      wantFov = aim ? 48 : 62 + clamp(Math.hypot(p.vx, p.vz) * 0.9, 0, 6);
      if (aim) {
        const r = { x: -Math.cos(this.camYaw), z: Math.sin(this.camYaw) };
        tx += r.x * 0.75; tz += r.z * 0.75; ty -= 0.05;
      }
    }
    const cp = Math.cos(this.camPitch), sp2 = Math.sin(this.camPitch);
    const dirx = -Math.sin(this.camYaw) * cp, diry = sp2, dirz = -Math.cos(this.camYaw) * cp;
    // camera collision
    let dist = this.camDist;
    const indoors = !!this.interiors.current;
    const hitT = indoors ? Infinity : this.world.rayBoxes(tx, ty, tz, dirx, diry, dirz, dist + 0.3);
    if (hitT < dist + 0.3) dist = Math.max(0.6, hitT - 0.3);
    let cx = tx + dirx * dist, cy = ty + diry * dist, cz = tz + dirz * dist;
    const gy = indoors ? 0 : this.world.groundY(cx, cz);
    cy = Math.max(cy, gy + 0.3);
    if (indoors) { const cv = new THREE.Vector3(cx, cy, cz); this.interiors.clampCam(cv); cx = cv.x; cy = cv.y; cz = cv.z; }
    const shake = (this.camShake + this.fx.shake * 0.5);
    this.camShake = Math.max(0, this.camShake - dt * 2.2);
    cx += (Math.random() - 0.5) * shake * 0.12; cy += (Math.random() - 0.5) * shake * 0.12;
    if (snap) cam.position.set(cx, cy, cz);
    else {
      const k = veh ? 1 - Math.exp(-dt * 14) : 1 - Math.exp(-dt * 22);
      cam.position.x += (cx - cam.position.x) * k; cam.position.y += (cy - cam.position.y) * k; cam.position.z += (cz - cam.position.z) * k;
    }
    cam.lookAt(tx, ty + (veh ? 0.0 : 0), tz);
    cam.fov = damp(cam.fov, wantFov, 5, dt);
    cam.updateProjectionMatrix();
  }

  updateCameraSnap() { this.updateCamera(0.016, true); }

  cinematic(from: THREE.Vector3, to: THREE.Vector3, look: THREE.Vector3, dur: number) {
    this.cinematicCam = { from, to, look, t: 0, dur };
  }

  // =================================================================== audio sync
  private updateAudio(dt: number) {
    const a = this.audio;
    if (!a.ctx) return;
    const v = this.player.vehicle;
    if (v) {
      a.engine(!v.wrecked, v.speed, v.spec.top, v.ctl.throttle, v.boosting, v.kind);
      a.skid(v.skid ? clamp(v.slip / 8 + (v.ctl.hand ? 0.4 : 0), 0.2, 1) : 0);
      a.hornOn(v.horn);
      a.musicGain.gain.setTargetAtTime(this.audio.musicVol * 0.5, a.ctx.currentTime, 0.3);
    } else {
      a.noEngine(); a.skid(0); a.hornOn(false);
      a.musicGain.gain.setTargetAtTime(this.audio.musicVol * 0.08, a.ctx.currentTime, 0.3);
    }
    // siren: nearest police with siren
    let near = 1e9;
    for (const c of this.vehicles) if (c.sirenOn && !c.wrecked) near = Math.min(near, Math.hypot(c.x - this.player.x, c.z - this.player.z));
    a.sirenOn(near < 200, clamp(1 - near / 200, 0, 1));
    if (this.police.heli.active && Math.random() < dt * 8) a.heli();
    a.ambience(this.sky.rain, this.sky.night, this.world.onRoad(this.player.x, this.player.z) ? 1 : 0.4);
    if (this.mapT === 0) void 0;
  }

  // =================================================================== waiters (story)
  private updateWaiters() {
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      if (this.missionAbort) { this.waiters.splice(i, 1); w.reject(new MissionFail(this.missionAbort.reason)); continue; }
      let ok = false;
      try { ok = w.cond(); } catch (e) { this.waiters.splice(i, 1); w.reject(e); continue; }
      if (ok) { this.waiters.splice(i, 1); w.resolve(); }
    }
  }
  waitFor(cond: () => boolean) {
    return new Promise<void>((resolve, reject) => {
      if (this.missionAbort) return reject(new MissionFail(this.missionAbort.reason));
      this.waiters.push({ cond, resolve, reject });
    });
  }
  sleep(sec: number) {
    const end = this.time + sec;
    return this.waitFor(() => this.time >= end);
  }

  // =================================================================== dialogue
  private dlgId = 1;
  say(who: string, text: string, opts: { auto?: boolean; role?: string } = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = this.dlgId++;
      const role = opts.role ?? 'talk';
      const auto = opts.auto ?? false;
      if (auto) {
        hud.subtitle = { who, text };
        emitHud();
        const dur = 1.8 + text.length * 0.05;
        const end = this.time + dur;
        this.audio.dialogue();
        this.waitFor(() => this.time >= end).then(() => { if (hud.subtitle?.text === text) hud.subtitle = null; emitHud(); resolve(); }, reject);
        return;
      }
      hud.dialogue = { who, text, choices: null, role, id };
      emitHud();
      this.audio.dialogue();
      let done = false;
      let t0 = this.time;
      const finish = () => { if (done) return; if (this.time - t0 < 0.25) return; done = true; this.dialogueAdvance = null; hud.dialogue = null; emitHud(); resolve(); };
      this.dialogueAdvance = finish;
      this.waitFor(() => done).catch((e) => { hud.dialogue = null; this.dialogueAdvance = null; emitHud(); reject(e); });
      t0 = this.time;
    });
  }
  ask(who: string, text: string, choices: string[]): Promise<number> {
    return new Promise((resolve, reject) => {
      const id = this.dlgId++;
      hud.dialogue = { who, text, choices: choices.map((c, i) => ({ id: i, label: c })), role: 'ask', id };
      emitHud();
      let picked = -1;
      this.dialogueChoose = (i) => { if (picked >= 0) return; picked = i; this.dialogueChoose = null; hud.dialogue = null; emitHud(); this.audio.click(); resolve(i); };
      this.waitFor(() => picked >= 0).catch((e) => { hud.dialogue = null; this.dialogueChoose = null; emitHud(); reject(e); });
    });
  }
  chooseDialogue(i: number) { this.dialogueChoose?.(i); }

  // =================================================================== missions API
  refreshMissionList() {
    hud.missions = MISSIONS.map((m, i) => ({ id: i, title: m.title, done: this.completed.has(i), active: this.missionRunning && this.missionIndex === i }));
  }
  startMission(i: number) {
    if (i >= MISSIONS.length || this.missionRunning) return;
    this.missionIndex = i;
    const m = MISSIONS[i];
    this.missionRunning = true;
    this.missionAbort = null;
    hud.missionTitle = m.title;
    this.refreshMissionList();
    emitHud();
    void (async () => {
      try {
        await m.run(this);
        this.completed.add(i);
        this.missionIndex = i + 1;
        hud.stats.missions++;
        this.addCash(m.reward);
        this.audio.complete();
        hud.overlay = i === MISSIONS.length - 1 ? 'ending' : 'passed';
        hud.overlayText = m.title;
        emitHud();
        this.saveGame();
        await new Promise((r) => setTimeout(r, i === MISSIONS.length - 1 ? 7000 : 3600));
        if (hud.overlay === 'passed' || hud.overlay === 'ending') hud.overlay = null;
      } catch (e) {
        if (!(e instanceof MissionFail)) console.error(e);
        else {
          this.audio.fail();
          if (e.message && this.state === 'play') { hud.overlay = 'failed'; hud.overlayText = e.message; emitHud(); await new Promise((r) => setTimeout(r, 3000)); if (hud.overlay === 'failed') hud.overlay = null; }
        }
      }
      this.cleanupMission();
      this.missionRunning = false;
      this.refreshMissionList();
      // next mission auto-starts once the previous is completed and player continues
      emitHud();
      if (this.completed.has(i) && i + 1 < MISSIONS.length) setTimeout(() => this.startMission(i + 1), 800);
      else if (!this.completed.has(i) && this.state === 'play') setTimeout(() => { if (!this.missionRunning) this.startMission(this.missionIndex); }, 600);
    })();
  }
  abortMission(reason: string) { this.missionAbort = { reason }; }
  cleanupMission() {
    this.missionAbort = null;
    this.markers = [];
    hud.objective = null; hud.objDist = null; hud.missionTitle = null; hud.timer = null; hud.lost = null; hud.dialogue = null; hud.subtitle = null; hud.cinematic = false;
    this.missionTimer = null;
    this.dialogNpc = null;
    this.story?.cleanup();
    if (this.state === 'cinematic') this.state = 'play';
  }
  setObjective(text: string | null, markers: Marker[] = []) {
    hud.objective = text;
    this.markers = markers;
    emitHud();
  }
  startTimer(sec: number, label: string, onEnd?: () => void) { this.missionTimer = { t: sec, label, onEnd }; }
  stopTimer() { this.missionTimer = null; hud.timer = null; }
  teleportPlayer(x: number, z: number, h = 0) {
    if (this.player.vehicle) this.exitVehicle();
    this.player.x = x; this.player.z = z; this.player.heading = h; this.player.y = this.world.groundY(x, z);
    this.camYaw = h;
  }
  setCinematic(on: boolean) { hud.cinematic = on; emitHud(); }
  fadeTo(on: boolean) { hud.fade = on; emitHud(); }
  distTo(x: number, z: number) {
    const p = this.player;
    return Math.hypot(x - (p.vehicle ? p.vehicle.x : p.x), z - (p.vehicle ? p.vehicle.z : p.z));
  }

  // =================================================================== persistence
  saveGame() {
    try {
      const inv: Record<string, { have: boolean; mag: number; reserve: number }> = this.inv;
      localStorage.setItem('neon-nagri-v2', JSON.stringify({ cash: this.player.cash, inv, mission: this.missionIndex, done: [...this.completed], hour: this.sky.hour, owned: this.ownedCars, kills: hud.stats.kills, hustle: this.hustle?.serialize() }));
    } catch { /* ignore */ }
  }
  loadGame() {
    try {
      const raw = localStorage.getItem('neon-nagri-v2');
      if (!raw) return;
      const s = JSON.parse(raw);
      this.player.cash = s.cash ?? this.player.cash;
      for (const k of Object.keys(s.inv ?? {})) if (this.inv[k]) this.inv[k] = s.inv[k];
      this.missionIndex = Math.min(s.mission ?? 0, MISSIONS.length);
      this.completed = new Set(s.done ?? []);
      this.sky.hour = s.hour ?? this.sky.hour;
      this.ownedCars = s.owned ?? [];
      if (s.hustle) this.hustle.restore(s.hustle);
    } catch { /* ignore */ }
  }
  resetSave() {
    try { localStorage.removeItem('neon-nagri-v2'); } catch { /* ignore */ }
    location.reload();
  }

  // =================================================================== HUD + map
  private updateHud(dt: number) {
    this.hudT -= dt;
    this.mapT -= dt;
    hud.hitMarker = Math.max(0, hud.hitMarker - dt * 4);
    hud.damage = Math.max(0, hud.damage - dt * 1.4);
    if (this.hudT > 0 && this.state !== 'menu') {
      // still draw the minimap smoothly
    }
    if (this.mapT <= 0) { this.mapT = 1 / 24; this.drawMiniMap(); if (hud.fullMap) this.drawBigMap(); }
    if (this.hudT > 0) return;
    this.hudT = 0.08;
    const p = this.player, v = p.vehicle;
    hud.hp = Math.round(p.hp); hud.armor = Math.round(p.armor); hud.cash = p.cash; hud.wanted = this.wanted;
    hud.inCar = !!v;
    if (v) { hud.speed = Math.round(Math.abs(v.speed) * 3.6); hud.gear = this.audio.gear; hud.carHealth = v.health / v.maxHealth; hud.nitro = v.nitro; hud.boosting = v.boosting; hud.carName = v.spec.name; }
    hud.clock = this.sky.clock;
    hud.weather = this.sky.rainTarget > 0.2 ? 'rain' : 'clear';
    hud.arrest = this.police.arrestProgress / 1.6;
    hud.timer = this.missionTimer ? { t: this.missionTimer.t, label: this.missionTimer.label } : null;
    if (this.markers.length && hud.objective) hud.objDist = Math.round(this.distTo(this.markers[0].x, this.markers[0].z));
    else hud.objDist = null;
    this.updateWeaponHud();
    emitHud();
  }

  private buildMap() {
    const c = document.createElement('canvas');
    c.width = c.height = 1240;
    const g = c.getContext('2d')!;
    const s = c.width / MAPW;
    const X = (x: number) => (x + MAPW / 2) * s;
    g.fillStyle = '#1f2e22';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#17405a';
    g.fillRect(X(HALF + 62), 0, c.width, c.height);
    g.fillStyle = '#c9b88a';
    g.fillRect(X(HALF + 8), 0, (54) * s, c.height);
    const N = this.world.zones.length;
    void N;
    // roads
    g.fillStyle = '#383c44';
    for (let k = 0; k <= 8; k++) {
      const pos = (k - 4) * 120;
      g.fillRect(X(pos - 8), X(-HALF - 8), 16 * s, (HALF * 2 + 16) * s);
      g.fillRect(X(-HALF - 8), X(pos - 8), (HALF * 2 + 16) * s, 16 * s);
    }
    g.strokeStyle = '#d8b24a'; g.lineWidth = 1;
    for (let k = 0; k <= 8; k++) {
      const pos = (k - 4) * 120;
      g.beginPath(); g.moveTo(X(pos), X(-HALF)); g.lineTo(X(pos), X(HALF)); g.stroke();
      g.beginPath(); g.moveTo(X(-HALF), X(pos)); g.lineTo(X(HALF), X(pos)); g.stroke();
    }
    // blocks
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const cx = (i - 3.5) * 120, cz = (j - 3.5) * 120;
      const zone = this.world.zones[i][j];
      g.fillStyle = zone === 'park' ? '#2d5a34' : zone === 'beach' ? '#bba878' : '#565b63';
      g.fillRect(X(cx - 52), X(cz - 52), 104 * s, 104 * s);
    }
    for (const b of this.world.boxes) {
      g.fillStyle = b.h > 50 ? '#8a909c' : b.h > 14 ? '#737a86' : '#656b76';
      g.fillRect(X(b.x0), X(b.z0), (b.x1 - b.x0) * s, (b.z1 - b.z0) * s);
    }
    this.mapCanvas = c;
  }

  private drawMapInto(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cz: number, zoom: number, rot: number | null, big: boolean) {
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    if (rot !== null) ctx.rotate(rot - Math.PI);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cz);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapCanvas, -MAPW / 2, -MAPW / 2, MAPW, MAPW);
    const inv = 1 / zoom;
    // GPS
    if (this.routePts.length > 1) {
      ctx.strokeStyle = '#38d6ff'; ctx.lineWidth = 4 * inv * (big ? 1.4 : 1); ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(this.routePts[0].x, this.routePts[0].z);
      for (const q of this.routePts) ctx.lineTo(q.x, q.z);
      ctx.stroke();
    }
    const dot = (x: number, z: number, r: number, col: string, ring = false) => {
      ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * inv;
      ctx.beginPath(); ctx.arc(x, z, r * inv, 0, 7); ctx.fill();
      if (ring) ctx.stroke();
    };
    for (const poi of this.world.pois) {
      if (poi.r < 2) continue;
      dot(poi.x, poi.z, big ? 7 : 5, poi.kind === 'shop' ? '#ffb02a' : poi.kind === 'story' ? '#ff4fd8' : poi.kind === 'home' ? '#4ad0ff' : poi.kind === 'mission' ? '#6aff9a' : '#c8d0e0', true);
    }
    for (const m of this.markers) dot(m.x, m.z, big ? 9 : 7, m.color ?? '#ffd23a', true);
    for (const m of this.hustle.markers) dot(m.x, m.z, big ? 10 : 8, m.color ?? '#ff3a5a', true);
    for (const v of this.vehicles) {
      if (v.sirenOn && !v.wrecked) { const f = Math.floor(this.time * 4) % 2; dot(v.x, v.z, 5, f ? '#ff3030' : '#3060ff', true); }
    }
    for (const n of this.crowd.list) {
      if (!n.alive) continue;
      if (n.role === 'gang' && n.hostile) dot(n.x, n.z, 4, '#ff3030');
      else if ((n.role === 'cop' || n.role === 'swat') && this.wanted > 0) dot(n.x, n.z, 4, '#4a7aff');
    }
    if (this.police.heli.active) dot(this.police.heli.x, this.police.heli.z, 6, '#ffffff', true);
    ctx.restore();
    // player arrow
    ctx.save();
    ctx.translate(w / 2, h / 2);
    if (rot === null) { const ppx = (this.player.x - cx) * zoom, ppz = (this.player.z - cz) * zoom; ctx.translate(ppx, ppz); ctx.rotate(Math.PI - this.player.heading + Math.PI); }
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  private drawMiniMap() {
    const c = this.miniCanvas;
    if (!c || hud.phase === 'menu' || hud.phase === 'loading') return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const p = this.player;
    const x = p.vehicle ? p.vehicle.x : p.x, z = p.vehicle ? p.vehicle.z : p.z;
    this.routeT -= 1 / 24;
    if (this.routeT <= 0) {
      this.routeT = 1;
      const m = this.markers.find((q) => q.gps !== false);
      if (m && hud.objective) {
        const r = this.world.route(x, z, m.x, m.z).map((n) => nodePos(n.i, n.j));
        this.routePts = [{ x, z }, ...r, { x: m.x, z: m.z }];
        // trim detour to first node when player is on the same road segment
      } else this.routePts = [];
    }
    if (this.routePts.length) this.routePts[0] = { x, z };
    const zoom = this.player.vehicle ? 0.9 + clamp(Math.abs(this.player.vehicle.speed) / 90, 0, 0.6) * -0.4 : 1.25;
    this.drawMapInto(ctx, c.width, c.height, x, z, zoom, this.camYaw, false);
  }
  private drawBigMap() {
    const c = this.bigCanvas;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const zoom = Math.min(c.width, c.height) / 1100;
    this.drawMapInto(ctx, c.width, c.height, 20, 0, zoom, null, true);
  }

  // ---------------------------------------------------------------- debug hooks (used by automated checks)
  debug = {
    teleport: (x: number, z: number) => this.teleportPlayer(x, z, 0),
    wanted: (n: number) => this.setWanted(n),
    car: () => { const v = this.lastCar!; this.enterVehicle(v); },
    time: (h: number) => { this.sky.hour = h; },
    rain: (v: number) => { this.sky.setRain(v); },
    god: () => { this.flags.god = true; },
    start: () => this.startGame(),
    cam: (yaw: number, pitch: number) => { this.camYaw = yaw; this.camPitch = pitch; },
    giveAll: () => { for (const w of WEAPON_ORDER) this.giveWeapon(w, 200); },
    mission: (i: number) => { this.missionIndex = i; },
    spawnCops: () => { this.setWanted(3); },
    npc: (look: string, x: number, z: number) => this.spawnNpc(LOOKS[look], 'story', x, z, Math.PI),
    carAt: (k: CarKind, x: number, z: number, h: number, c = 0xcc2222) => this.spawnCar(k, c, x, z, h, 'parked'),
    ang: (a: number) => angDiff(0, a),
  };
}
