import * as THREE from 'three';
import type { Game } from './game';
import { Human, LOOKS, defaultState, randomLook, type HumanState } from './humanoid';
import { buildCar, type CarKind, type CarModel } from './carmodels';
import { buildWeaponModel, WEAPON_ORDER } from './weapons';
import { mkCanvas, signTex, toTex } from './textures';
import { mulberry32 } from './util';
import { hud, emitHud } from './store';

/**
 * Walkable interiors. Each shop / garage / apartment is a real room parked far from the city.
 * Walk in through the door, look around, talk to the owner at the counter, walk back out.
 */

interface Aabb { x0: number; x1: number; z0: number; z1: number }
interface Keeper { human: Human; hs: HumanState; x: number; z: number; face: number; name: string }
export interface Room {
  id: string; title: string; W: number; D: number; H: number;
  ox: number; oz: number;
  group: THREE.Group;
  solids: Aabb[];
  keeper: Keeper | null;
  extras: Keeper[];
  terminal: { x: number; z: number; label: string };
  spinners: THREE.Object3D[];
  cars: { model: CarModel; platform?: THREE.Object3D }[];
  screens: THREE.MeshBasicMaterial[];
  lightPts: [number, number, number][];
  tint: number;
}

const M = {
  std: (color: number, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }),
  glow: (color: number, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }),
};

let floorCache: Record<string, THREE.Texture> = {};
function floorTex(kind: 'tile' | 'concrete' | 'wood' | 'checker' | 'carpet') {
  if (floorCache[kind]) return floorCache[kind];
  const { c, g } = mkCanvas(256);
  const rnd = mulberry32(kind.length * 977);
  if (kind === 'tile') {
    g.fillStyle = '#d9dcdd'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = 205 + Math.floor(rnd() * 25); g.fillStyle = `rgb(${v},${v + 2},${v + 3})`; g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60); }
  } else if (kind === 'checker') {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#c9302a' : '#f2ede2'; g.fillRect(i * 64, j * 64, 64, 64); }
  } else if (kind === 'concrete') {
    g.fillStyle = '#5d5f62'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { const v = 70 + Math.floor(rnd() * 50); g.fillStyle = `rgba(${v},${v},${v + 2},0.35)`; g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 4, 2 + rnd() * 4); }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.strokeRect(1, 1, 254, 254);
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(20,16,10,0.18)'; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 256, 10 + rnd() * 25, 6 + rnd() * 14, rnd() * 3, 0, 7); g.fill(); }
  } else if (kind === 'wood') {
    for (let i = 0; i < 8; i++) { const v = 120 + Math.floor(rnd() * 40); g.fillStyle = `rgb(${v},${Math.floor(v * 0.68)},${Math.floor(v * 0.42)})`; g.fillRect(0, i * 32, 256, 31); for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(60,30,10,0.12)'; g.fillRect(rnd() * 256, i * 32 + rnd() * 30, 20 + rnd() * 60, 1); } g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(((i * 97) % 256), i * 32, 2, 31); }
  } else {
    g.fillStyle = '#4a4f66'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) { const v = 60 + Math.floor(rnd() * 40); g.fillStyle = `rgba(${v},${v + 4},${v + 24},0.5)`; g.fillRect(rnd() * 256, rnd() * 256, 2, 2); }
  }
  const t = toTex(c);
  floorCache[kind] = t;
  return t;
}

const blobTex = (() => {
  let t: THREE.Texture | null = null;
  return () => {
    if (t) return t;
    const { c, g } = mkCanvas(64);
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.65)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    t = toTex(c, { repeat: false });
    return t;
  };
})();

class Builder {
  constructor(public r: Room) {}
  box(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, solid = false) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    this.r.group.add(m);
    if (solid) this.r.solids.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
    return m;
  }
  cyl(x: number, y: number, z: number, rad: number, h: number, mat: THREE.Material, solid = false, seg = 20) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, h, seg), mat);
    m.position.set(x, y + h / 2, z);
    this.r.group.add(m);
    if (solid) this.r.solids.push({ x0: x - rad, x1: x + rad, z0: z - rad, z1: z + rad });
    return m;
  }
  blob(x: number, z: number, w: number, d: number, k = 1) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, opacity: k, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z);
    this.r.group.add(m);
  }
  sign(text: string, bg: string, fg: string, x: number, y: number, z: number, w: number, h: number, ry = 0, glow = 0.9) {
    const ph = Math.round(512 * h / w);
    const px = Math.floor(Math.min(ph * 0.7, 440 / (text.length * 0.66)));
    const t = signTex(text, bg, fg, 512, ph, `bold ${px}px Arial Black, Impact, sans-serif`);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: glow, roughness: 0.5 }));
    m.position.set(x, y, z); m.rotation.y = ry;
    this.r.group.add(m);
    return m;
  }
  /** a fluorescent ceiling strip + remembers a light position */
  strip(x: number, z: number, len: number, alongX = true) {
    const m = this.box(x, this.r.H - 0.14, z, alongX ? len : 0.3, 0.1, alongX ? 0.3 : len, M.glow(0xfff4e0, 1.1));
    m.position.y = this.r.H - 0.1;
  }
}

interface Def {
  W: number; D: number; H: number;
  floor: 'tile' | 'concrete' | 'wood' | 'checker' | 'carpet';
  wall: number; trim: number; light: number; lightK: number;
  terminal: string; keeper: string | null;
  build: (b: Builder, g: Game) => void;
}

const lastCarColor = (g: Game, fallback: number) => (g.lastCar ? g.lastCar.color : fallback);

const DEFS: Record<string, Def> = {
  // ------------------------------------------------------------------ garage
  garage: {
    W: 28, D: 24, H: 6, floor: 'concrete', wall: 0x6b7480, trim: 0xffc21a, light: 0xfff0d8, lightK: 1,
    terminal: 'Talk to Jimmy — repairs, paint, nitro', keeper: 'jimmy',
    build(b, g) {
      const { W, D } = b.r;
      b.sign("JIMMY'S AUTO", '#0e1a2c', '#ffd23a', 0, 3.6, D / 2 - 0.12, 9, 1.9, Math.PI);
      // safety stripes
      for (const sx of [-9.5, 9.5]) b.box(sx, 0.015, 0, 0.18, 0.01, D - 4, M.std(0xffc21a, 0.7));
      // two lifts, each carrying a car
      const cols = [lastCarColor(g, 0x1368ff), 0xc41820];
      const kinds: CarKind[] = [g.lastCar ? (g.lastCar.kind === 'police' || g.lastCar.kind === 'swat' ? 'sedan' : g.lastCar.kind) : 'sports', 'muscle'];
      [-5.5, 5.5].forEach((lx, i) => {
        const steel = M.std(0x2c3138, 0.4, 0.8);
        const lift = new THREE.Group(); lift.position.set(lx, 0, -1.5); b.r.group.add(lift);
        for (const px of [-1.35, 1.35]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.4, 0.3), steel); p.position.set(px, 1.7, -1.3); lift.add(p); }
        const plat = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.18, 5.6), M.std(0x3a4048, 0.5, 0.7)); plat.position.y = i === 0 ? 1.15 : 0.16; lift.add(plat);
        const car = buildCar(kinds[i], cols[i]);
        car.group.position.set(lx, plat.position.y + 0.1, -1.5); car.group.rotation.y = Math.PI / 2 * (i === 0 ? 0 : 0);
        b.r.group.add(car.group);
        b.r.cars.push({ model: car });
        b.r.solids.push({ x0: lx - 1.6, x1: lx + 1.6, z0: -4.5, z1: 1.5 });
        b.blob(lx, -1.5, 5, 7, 0.9);
      });
      // tool wall (pegboard + tools)
      b.box(-W / 2 + 0.2, 1.2, 4, 0.2, 2.4, 9, M.std(0x8b6a44, 0.9));
      for (let i = 0; i < 18; i++) b.box(-W / 2 + 0.4, 1.5 + (i % 3) * 0.55, 0.3 + i * 0.45, 0.12, 0.35 + (i % 4) * 0.08, 0.06, M.std(i % 2 ? 0xc8ccd2 : 0xd83a2a, 0.35, 0.8));
      // roll cabinets
      for (let i = 0; i < 3; i++) {
        b.box(-W / 2 + 1.3, 0, 7.5 + i * 1.3 - 4, 0.9, 1.1, 1.0, M.std(0xb81e1e, 0.45, 0.4), true);
        for (let d = 0; d < 4; d++) b.box(-W / 2 + 1.77, 0.15 + d * 0.26, 3.5 + i * 1.3, 0.04, 0.2, 0.86, M.std(0x9a9a9a, 0.3, 0.9));
      }
      // tyre stacks + oil drums
      const tyre = M.std(0x151515, 0.9);
      for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.14, 10, 20), tyre); t.rotation.x = Math.PI / 2; t.position.set(W / 2 - 1.3 - (i % 2) * 0.1, 0.15 + k * 0.28, -D / 2 + 3 + i * 0.9); b.r.group.add(t); }
      b.r.solids.push({ x0: W / 2 - 1.8, x1: W / 2 - 0.8, z0: -D / 2 + 2.4, z1: -D / 2 + 6 });
      [0x2a5aa0, 0xb03030, 0x2a7a4a].forEach((c, i) => b.cyl(W / 2 - 1.2, 0, 2.5 + i * 0.9, 0.3, 0.9, M.std(c, 0.5, 0.5), true));
      // front desk / workbench
      b.box(0, 0, D / 2 - 3.9, 6, 1.05, 1.1, M.std(0x2c3138, 0.5, 0.6), true);
      b.box(0, 1.05, D / 2 - 3.9, 6.1, 0.08, 1.2, M.std(0xb8bcc4, 0.25, 0.9));
      b.box(-1.5, 1.13, D / 2 - 3.9, 0.5, 0.35, 0.45, M.std(0xb81e1e, 0.5, 0.3));
      // hanging work lights
      for (const lx of [-8, 0, 8]) b.strip(lx, 0, 7, false);
      // back-wall shelves
      for (let i = 0; i < 3; i++) b.box(0, 1.1 + i * 0.9, D / 2 - 0.45, W - 10, 0.08, 0.5, M.std(0x555a62, 0.6, 0.5));
      for (let i = 0; i < 20; i++) b.box(-9 + i * 0.95, 1.2 + (i % 3) * 0.9, D / 2 - 0.45, 0.4, 0.4, 0.4, M.std([0xd8c41a, 0x2a5aa0, 0xcc3030][i % 3], 0.6));
    },
  },
  // ------------------------------------------------------------------ pay n spray
  spray: {
    W: 24, D: 20, H: 6, floor: 'concrete', wall: 0xe8c64a, trim: 0x15161a, light: 0xffffff, lightK: 1.1,
    terminal: 'Talk to the painter — respray & lose the heat', keeper: 'painter',
    build(b, g) {
      const { W, D } = b.r;
      b.sign("PAY'N'SPRAY", '#f0c010', '#101010', 0, 3.7, D / 2 - 0.12, 8, 1.8, Math.PI);
      // spray booth centre
      const car = buildCar('sedan', lastCarColor(g, 0xeeeeee));
      car.group.position.set(0, 0.02, -1); b.r.group.add(car.group); b.r.cars.push({ model: car });
      b.r.solids.push({ x0: -1.2, x1: 1.2, z0: -3.6, z1: 1.6 });
      b.blob(0, -1, 3.6, 6.4, 0.9);
      for (const sx of [-4.2, 4.2]) { b.box(sx, 0, -1, 0.2, 1.0, 8, M.std(0xcfd3d8, 0.7, 0.2), true); }
      b.box(0, 4.6, -1, 8.6, 0.2, 8.2, M.std(0xcfd3d8, 0.7, 0.2));
      for (let i = 0; i < 4; i++) b.box(-3 + i * 2, 4.45, -1, 1.4, 0.06, 6, M.glow(0xffffff, 1.2));
      // colour swatch wall
      [0x0b0b0e, 0xc41820, 0x1368ff, 0xeeeeee, 0xff6a10, 0x30d050, 0xff2fa0, 0x44484e].forEach((c, i) => {
        b.box(-W / 2 + 0.2, 1.0 + (i % 4) * 0.9, -4 + Math.floor(i / 4) * 2.6 + 1, 0.1, 0.8, 2.3, new THREE.MeshPhysicalMaterial({ color: c, metalness: 0.6, roughness: 0.25, clearcoat: 1 }));
      });
      // paint shelves
      for (let s = 0; s < 3; s++) for (let i = 0; i < 12; i++) b.box(W / 2 - 0.5, 0.9 + s * 0.8, -6 + i * 0.7 + 1, 0.4, 0.4, 0.3, M.std([0xc41820, 0x1368ff, 0x30d050, 0xffd23a, 0xff2fa0, 0xeeeeee][(i + s) % 6], 0.4, 0.6));
      b.box(W / 2 - 0.4, 0, -1.5, 0.6, 3, 9, M.std(0x555a62, 0.6, 0.4), true);
      // counter
      b.box(0, 0, D / 2 - 3.9, 5, 1.05, 1.1, M.std(0x15161a, 0.5, 0.3), true);
      b.box(0, 1.05, D / 2 - 3.9, 5.1, 0.07, 1.2, M.std(0xf0c010, 0.4, 0.3));
      for (const lx of [-6, 6]) b.strip(lx, 3, 6, false);
    },
  },
  // ------------------------------------------------------------------ gun club
  ammu: {
    W: 24, D: 20, H: 4.6, floor: 'wood', wall: 0x4a3524, trim: 0xff6a2a, light: 0xffe2b8, lightK: 0.95,
    terminal: 'Talk to the dealer — weapons, ammo & armor', keeper: 'gunsmith',
    build(b) {
      const { W, D } = b.r;
      b.sign('GUN CLUB', '#1a1208', '#ff6a2a', 0, 3.4, D / 2 - 0.12, 7, 1.4, Math.PI);
      // wall racks with every weapon on display
      const board = M.std(0x7a6248, 0.9);
      b.box(0, 1.0, D / 2 - 0.3, W - 6, 2.4, 0.2, board);
      const guns = WEAPON_ORDER.filter((w) => w !== 'fists');
      guns.forEach((id, i) => {
        const wm = buildWeaponModel(id); if (!wm) return;
        wm.group.scale.setScalar(id === 'bat' ? 1.3 : 1.6);
        wm.group.rotation.y = Math.PI / 2;
        wm.group.position.set(-6.5 + i * 2.15, 1.5 + (id === 'bat' ? 0.4 : (i % 2) * 0.55), D / 2 - 0.55);
        b.r.group.add(wm.group);
        b.box(wm.group.position.x, wm.group.position.y - 0.18, D / 2 - 0.5, 1.4, 0.04, 0.12, M.std(0x15110c, 0.6));
      });
      // glass display counters
      const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fc4d8, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.28 });
      for (const sx of [-1, 1]) {
        b.box(sx * 7.3, 0, -1, 1.4, 1.0, 7, M.std(0x15110c, 0.5), true);
        b.box(sx * 7.3, 1.0, -1, 1.5, 0.5, 7.1, glass);
        for (let i = 0; i < 4; i++) { const wm = buildWeaponModel(i % 2 ? 'pistol' : 'smg'); if (wm) { wm.group.scale.setScalar(1.2); wm.group.rotation.y = Math.PI / 2; wm.group.position.set(sx * 7.3, 1.08, -3.5 + i * 1.6); b.r.group.add(wm.group); } }
        b.sign(sx < 0 ? 'NO REFUNDS' : 'LICENSED', '#1a1208', '#ff6a2a', sx * (W / 2 - 0.12), 2.6, -1, 4.5, 0.9, sx < 0 ? Math.PI / 2 : -Math.PI / 2);
      }
      // counter
      b.box(0, 0, D / 2 - 3.9, 7, 1.05, 1.1, M.std(0x3a2818, 0.5), true);
      b.box(0, 1.05, D / 2 - 3.9, 7.1, 0.07, 1.2, M.std(0x15110c, 0.3, 0.2));
      // crates
      for (let i = 0; i < 5; i++) b.box(-W / 2 + 1.3, (i % 2) * 0.7, -6 + i * 1.5, 1.1, 0.7, 1.1, M.std(0x5a4a2a, 0.9), true);
      for (const lx of [-6, 0, 6]) b.strip(lx, 1, 4);
      // target poster
      b.sign('RANGE OPEN 24/7', '#101010', '#ffffff', -W / 2 + 0.12, 2.8, 5, 3.6, 0.9, Math.PI / 2);
    },
  },
  // ------------------------------------------------------------------ burger shot
  burger: {
    W: 24, D: 19, H: 4.2, floor: 'checker', wall: 0xf1e3bd, trim: 0xc9302a, light: 0xfff6e8, lightK: 1.15,
    terminal: 'Order at the counter — burgers heal you', keeper: 'cashier',
    build(b) {
      const { W, D } = b.r;
      b.sign('BURGER SHOT', '#a01810', '#ffe040', 0, 3.1, D / 2 - 0.12, 6, 1.3, Math.PI);
      b.box(0, 1.1, D / 2 - 0.2, W, 0.3, 0.2, M.std(0xc9302a, 0.5));
      // menu boards
      [-6, 6].forEach((x, i) => b.sign(i ? 'COMBO 18  DOUBLE 45' : 'BURGERS • FRIES • SHAKES', '#14100c', '#ffd23a', x, 2.7, D / 2 - 0.12, 5, 1.1, Math.PI));
      // counter with registers
      b.box(0, 0, D / 2 - 3.9, 9, 1.05, 1.2, M.std(0xc9302a, 0.4), true);
      b.box(0, 1.05, D / 2 - 3.9, 9.1, 0.07, 1.3, M.std(0xf2f2f2, 0.2, 0.1));
      for (const rx of [-2.5, 2.5]) { b.box(rx, 1.12, D / 2 - 3.9, 0.55, 0.3, 0.45, M.std(0x1c1c1e, 0.4, 0.3)); b.box(rx, 1.28, D / 2 - 4.02, 0.4, 0.2, 0.04, M.glow(0x40ff80, 0.9)); }
      // kitchen back: fryers, grill
      b.box(-5, 0, D / 2 - 1.2, 3, 1.0, 1, M.std(0xaaaeb4, 0.3, 0.9), true);
      b.box(0, 0, D / 2 - 1.2, 3, 1.0, 1, M.std(0xaaaeb4, 0.3, 0.9), true);
      b.box(5, 0, D / 2 - 1.2, 3, 1.0, 1, M.std(0xaaaeb4, 0.3, 0.9), true);
      // tables & stools
      for (const [tx, tz] of [[-7.5, -2], [-7.5, 2], [7.5, -2], [7.5, 2], [-3, -5], [3, -5]]) {
        b.cyl(tx, 0, tz, 0.05, 0.75, M.std(0x888888, 0.3, 0.9));
        b.cyl(tx, 0.75, tz, 0.55, 0.06, M.std(0xf2f2f2, 0.3), true);
        for (const s of [[0.8, 0], [-0.8, 0]]) { b.cyl(tx + s[0], 0, tz + s[1], 0.04, 0.45, M.std(0x888888, 0.3, 0.9)); b.cyl(tx + s[0], 0.45, tz + s[1], 0.24, 0.1, M.std(0xc9302a, 0.5)); }
        b.blob(tx, tz, 2.6, 2.6, 0.5);
      }
      // window glow strips
      b.box(-W / 2 + 0.1, 1.2, -2, 0.06, 1.8, 10, new THREE.MeshBasicMaterial({ color: 0xbfe4ff }));
      for (const lx of [-6, 0, 6]) { b.strip(lx, -3, 4); b.strip(lx, 3, 4); }
    },
  },
  // ------------------------------------------------------------------ premium motors
  dealer: {
    W: 38, D: 26, H: 6, floor: 'tile', wall: 0xdfe3e8, trim: 0x15161a, light: 0xffffff, lightK: 1.25,
    terminal: 'Talk to the salesman — buy a car', keeper: 'salesman',
    build(b) {
      const { W, D } = b.r;
      b.sign('PREMIUM MOTORS', '#0c0c10', '#e8e8f0', 0, 4.2, D / 2 - 0.12, 10, 1.9, Math.PI);
      const showroom: [CarKind, number, number, number][] = [['sports', 0x1368ff, -12, 2], ['muscle', 0xc41820, -6, -5], ['suv', 0x2a2d30, 12, 2], ['sedan', 0xeeeeee, 6, -5], ['pickup', 0xff6a10, 0, -8.5]];
      for (const [kind, col, x, z] of showroom) {
        const plat = b.cyl(x, 0, z, 2.8, 0.22, M.std(0x15161a, 0.2, 0.6), false, 40);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.04, 8, 48), M.glow(0x4ad0ff, 1.4)); ring.rotation.x = Math.PI / 2; ring.position.set(x, 0.24, z); b.r.group.add(ring);
        const spin = new THREE.Group(); spin.position.set(x, 0.22, z); b.r.group.add(spin);
        const car = buildCar(kind, col); spin.add(car.group);
        b.r.spinners.push(spin); b.r.cars.push({ model: car, platform: plat });
        b.r.solids.push({ x0: x - 2.3, x1: x + 2.3, z0: z - 2.3, z1: z + 2.3 });
        b.blob(x, z, 8, 8, 0.4);
      }
      // glass front + reception
      b.box(0, 0, D / 2 - 3.9, 6, 1.05, 1.2, M.std(0x15161a, 0.2, 0.5), true);
      b.box(0, 1.05, D / 2 - 3.9, 6.1, 0.06, 1.3, M.std(0xe8e8f0, 0.1, 0.3));
      for (const lx of [-12, -4, 4, 12]) { b.strip(lx, -3, 14, false); }
      b.sign('DRIVE THE DREAM', '#0c0c10', '#4ad0ff', -W / 2 + 0.12, 3, 0, 8, 1.4, Math.PI / 2);
      b.sign('FINANCING AVAILABLE*', '#0c0c10', '#e8e8f0', W / 2 - 0.12, 3, 0, 8, 1.2, -Math.PI / 2);
    },
  },
  // ------------------------------------------------------------------ hospital
  hospital: {
    W: 26, D: 20, H: 4.2, floor: 'tile', wall: 0xeef2f4, trim: 0xd01818, light: 0xf4fbff, lightK: 1.25,
    terminal: 'Talk to the nurse — emergency treatment', keeper: 'nurse',
    build(b) {
      const { W, D } = b.r;
      b.box(0, 2.0, D / 2 - 0.16, 1.4, 0.4, 0.06, M.glow(0xd01818, 1)); b.box(0, 1.5, D / 2 - 0.16, 0.4, 1.4, 0.06, M.glow(0xd01818, 1));
      b.sign('ST. MARY HOSPITAL', '#f4f4f4', '#d01818', 0, 3.35, D / 2 - 0.12, 7, 0.9, Math.PI);
      b.box(0, 0, D / 2 - 3.9, 7, 1.05, 1.2, M.std(0xf2f4f6, 0.3), true);
      b.box(0, 1.05, D / 2 - 3.9, 7.1, 0.06, 1.3, M.std(0x3a8ad0, 0.3));
      // beds with curtains
      for (const [bx, bz] of [[-8, -1], [-8, 4], [8, -1], [8, 4]]) {
        b.box(bx, 0.25, bz, 1.1, 0.14, 2.3, M.std(0xaab0b6, 0.3, 0.8), true);
        b.box(bx, 0.42, bz, 1.0, 0.18, 2.1, M.std(0x7ab4e6, 0.9));
        b.box(bx, 0.6, bz - 0.8, 0.8, 0.16, 0.4, M.std(0xffffff, 0.9));
        b.box(bx + (bx < 0 ? -1.4 : 1.4), 1.0, bz, 0.05, 2.0, 2.6, M.std(0x9fd0c8, 0.95));
        b.blob(bx, bz, 2.4, 3.2, 0.5);
      }
      for (const lx of [-8, 0, 8]) { b.strip(lx, -2, 5); b.strip(lx, 4, 5); }
      // plants + chairs in the waiting area
      for (let i = 0; i < 5; i++) { b.box(-3 + i * 1.5, 0, -6, 0.9, 0.5, 0.8, M.std(0x3a6a9a, 0.7), true); b.box(-3 + i * 1.5, 0.5, -6.35, 0.9, 0.55, 0.15, M.std(0x3a6a9a, 0.7)); }
      b.cyl(W / 2 - 1.3, 0, -D / 2 + 1.5, 0.35, 0.5, M.std(0x8a5a3a, 0.8), true);
      b.cyl(W / 2 - 1.3, 0.5, -D / 2 + 1.5, 0.3, 0.9, M.std(0x2f7a3a, 0.9));
    },
  },
  // ------------------------------------------------------------------ safehouse
  home: {
    W: 22, D: 17, H: 3.4, floor: 'wood', wall: 0x8e8a96, trim: 0x4ad0ff, light: 0xffd9a8, lightK: 0.8,
    terminal: 'Rest on the bed — save game or sleep till morning', keeper: null,
    build(b, g) {
      const { W, D } = b.r;
      // bed
      b.box(0, 0.25, D / 2 - 2.6, 2.4, 0.3, 3.2, M.std(0x2c2a32, 0.7), true);
      b.box(0, 0.55, D / 2 - 2.5, 2.3, 0.25, 3.0, M.std(0xe6e2dc, 0.95));
      b.box(0, 0.7, D / 2 - 2.0, 2.3, 0.1, 2.0, M.std(0x2a4a6a, 0.95));
      b.box(-0.55, 0.8, D / 2 - 3.8, 0.8, 0.18, 0.45, M.std(0xffffff, 0.95)); b.box(0.55, 0.8, D / 2 - 3.8, 0.8, 0.18, 0.45, M.std(0xffffff, 0.95));
      b.box(0, 0.9, D / 2 - 0.35, 2.7, 1.3, 0.12, M.std(0x15161a, 0.5));
      for (const sx of [-1.8, 1.8]) { b.box(sx, 0, D / 2 - 3.6, 0.6, 0.5, 0.5, M.std(0x15161a, 0.5), true); b.box(sx, 0.55, D / 2 - 3.6, 0.2, 0.2, 0.2, M.glow(0xffc880, 1.1)); }
      // sofa + coffee table + TV
      b.box(-5, 0, -1.5, 3.4, 0.5, 1.1, M.std(0x3a3f4c, 0.9), true);
      b.box(-5, 0.5, -1.95, 3.4, 0.55, 0.25, M.std(0x3a3f4c, 0.9));
      b.box(-5, 0, -4.3, 2.0, 0.4, 1.0, M.std(0x5a3a22, 0.5), true);
      const tv = M.glow(0x2a6aff, 0.9); b.r.screens.push(tv);
      b.box(-5, 0, 5.6, 2.4, 0.5, 0.6, M.std(0x15161a, 0.5), true);
      b.box(-5, 1.0, 5.75, 2.3, 1.3, 0.08, M.std(0x050506, 0.3));
      b.box(-5, 1.07, 5.7, 2.15, 1.16, 0.03, tv);
      // kitchenette
      b.box(W / 2 - 1.0, 0, 1, 1.4, 1.0, 7, M.std(0xcfd0d2, 0.4, 0.4), true);
      b.box(W / 2 - 1.0, 1.0, 1, 1.5, 0.06, 7.1, M.std(0x2a2c30, 0.3));
      b.box(W / 2 - 1.0, 1.9, 1, 1.4, 0.8, 7, M.std(0x7a6a58, 0.7));
      // window with skyline
      const sk = mkCanvas(512, 256);
      const gr = sk.g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#0a0f2a'); gr.addColorStop(1, '#e0603a'); sk.g.fillStyle = gr; sk.g.fillRect(0, 0, 512, 256);
      const rnd = mulberry32(17);
      for (let i = 0; i < 26; i++) { const w = 20 + rnd() * 30, h = 50 + rnd() * 140; sk.g.fillStyle = '#12162a'; sk.g.fillRect(i * 20, 256 - h, w, h); for (let k = 0; k < 18; k++) { sk.g.fillStyle = rnd() < 0.5 ? '#ffd890' : '#2a3050'; sk.g.fillRect(i * 20 + 3 + (k % 4) * 6, 256 - h + 6 + Math.floor(k / 4) * 10, 3, 4); } }
      const wt = toTex(sk.c, { repeat: false });
      const win = new THREE.Mesh(new THREE.PlaneGeometry(9, 2), new THREE.MeshBasicMaterial({ map: wt }));
      win.position.set(0, 1.9, -D / 2 + 0.06); win.rotation.y = 0; b.r.group.add(win);
      b.box(0, 0.8, -D / 2 + 0.05, 9.4, 0.08, 0.1, M.std(0x15161a));
      // rug + plant + poster
      b.box(0, 0.01, 0, 5, 0.02, 3.5, M.std(0x7a2a3a, 1));
      b.cyl(W / 2 - 1.5, 0, -D / 2 + 1.4, 0.35, 0.5, M.std(0x8a5a3a), true); b.cyl(W / 2 - 1.5, 0.5, -D / 2 + 1.4, 0.3, 1.1, M.std(0x2f7a3a, 0.9));
      b.sign('NEON NAGRI', '#101820', '#4ad0ff', -W / 2 + 0.12, 2.1, -3, 3, 1, Math.PI / 2);
      b.strip(0, 0, 4); b.strip(-6, 0, 3); b.strip(6, 0, 3);
      void g;
    },
  },
};

export class Interiors {
  rooms = new Map<string, Room>();
  current: Room | null = null;
  lights: THREE.PointLight[] = [];
  busy = false;
  private ret = { x: 0, z: 0, heading: 0 };
  private t = 0;

  constructor(private g: Game) {
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xfff0d8, 0, 20, 2);
      l.castShadow = false;
      g.scene.add(l);
      this.lights.push(l);
    }
  }

  supports(id: string) { return !!DEFS[id]; }

  private build(id: string, idx: number): Room {
    const d = DEFS[id];
    const g = this.g;
    const group = new THREE.Group();
    const r: Room = {
      id, title: g.world.pois.find((p) => p.id === id)?.name ?? id, W: d.W, D: d.D, H: d.H, ox: 7000 + idx * 90, oz: 7000, group, solids: [],
      keeper: null, extras: [], terminal: { x: 0, z: d.D / 2 - 5.6, label: d.terminal }, spinners: [], cars: [], screens: [], lightPts: [], tint: d.light,
    };
    group.position.set(r.ox, 0, r.oz);
    const b = new Builder(r);
    // shell
    const tex = floorTex(d.floor).clone(); tex.needsUpdate = true;
    tex.repeat.set(d.floor === 'checker' ? d.W / 3 : d.W / 4, d.floor === 'checker' ? d.D / 3 : d.D / 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(d.W, d.D), new THREE.MeshStandardMaterial({ map: tex, roughness: d.floor === 'tile' || d.floor === 'checker' ? 0.28 : 0.82, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.005; group.add(floor);
    const wallM = M.std(d.wall, 0.9), trimM = M.std(d.trim, 0.6), ceilM = M.std(0xdcdcdc, 0.95);
    const t = 0.5;
    const mk = (x: number, z: number, w: number, dd: number, m: THREE.Material, y0 = 0, h = d.H) => { b.box(x, y0, z, w, h, dd, m); };
    mk(0, d.D / 2 + t / 2, d.W + 2 * t, t, wallM); mk(0, -d.D / 2 - t / 2, d.W + 2 * t, t, wallM);
    mk(-d.W / 2 - t / 2, 0, t, d.D, wallM); mk(d.W / 2 + t / 2, 0, t, d.D, wallM);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(d.W, d.D), ceilM); ceil.rotation.x = Math.PI / 2; ceil.position.y = d.H; group.add(ceil);
    // baseboards + crown trim
    for (const [x, z, w, dd] of [[0, d.D / 2 - 0.06, d.W, 0.12], [0, -d.D / 2 + 0.06, d.W, 0.12], [-d.W / 2 + 0.06, 0, 0.12, d.D], [d.W / 2 - 0.06, 0, 0.12, d.D]] as number[][]) { b.box(x, 0, z, w, 0.18, dd, trimM); b.box(x, d.H - 0.12, z, w, 0.12, dd, trimM); }
    // door (south wall) — frame, glass, EXIT sign
    const doorFrame = M.std(0x15161a, 0.5, 0.5);
    b.box(0, 0, -d.D / 2 + 0.1, 2.4, 0.08, 0.3, M.std(0x7a7a7a, 0.4));
    b.box(-1.25, 0, -d.D / 2 + 0.1, 0.16, 2.8, 0.2, doorFrame); b.box(1.25, 0, -d.D / 2 + 0.1, 0.16, 2.8, 0.2, doorFrame); b.box(0, 2.8, -d.D / 2 + 0.1, 2.66, 0.16, 0.2, doorFrame);
    const dg = new THREE.Mesh(new THREE.PlaneGeometry(2.34, 2.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfe0ff).multiplyScalar(1.15), transparent: true, opacity: 0.85 }));
    dg.position.set(0, 1.4, -d.D / 2 + 0.03); dg.rotation.y = Math.PI; group.add(dg);
    b.sign('EXIT', '#06240f', '#46ff8a', 0, 3.25, -d.D / 2 + 0.2, 1.4, 0.45, 0, 1.4);
    // content
    d.build(b, g);
    // fluorescent light positions
    r.lightPts = [[-d.W / 4, d.H - 0.8, -d.D / 4], [d.W / 4, d.H - 0.8, -d.D / 4], [-d.W / 4, d.H - 0.8, d.D / 4], [d.W / 4, d.H - 0.8, d.D / 4]];
    // keeper(s)
    const looks: Record<string, () => ReturnType<typeof randomLook>> = {
      jimmy: () => LOOKS.jimmy,
      painter: () => ({ ...randomLook(mulberry32(41), false), name: 'Painter', top: { type: 'tee', color: 0xf0c010, kind: 'cotton' }, hairStyle: 'cap', capColor: 0xf0c010 }),
      gunsmith: () => ({ ...randomLook(mulberry32(77), false), name: 'Gunsmith', top: { type: 'vest', color: 0x3e4636, kind: 'cargo' }, beard: true, hairStyle: 'buzz' }),
      cashier: () => ({ ...randomLook(mulberry32(5), true), name: 'Cashier', top: { type: 'tee', color: 0xc9302a, kind: 'cotton' }, hairStyle: 'ponytail', capColor: 0xc9302a }),
      salesman: () => ({ ...randomLook(mulberry32(12), false), name: 'Salesman', top: { type: 'suit', color: 0x15161a, kind: 'suit' }, bottom: { type: 'suit', color: 0x15161a, kind: 'suit' }, hairStyle: 'slick' }),
      nurse: () => ({ ...randomLook(mulberry32(31), true), name: 'Nurse', top: { type: 'tee', color: 0x4aa8c8, kind: 'cotton' }, hairStyle: 'bob' }),
    };
    if (d.keeper && looks[d.keeper]) {
      const human = new Human(looks[d.keeper]());
      human.root.rotation.order = 'YXZ';
      const kx = id === 'garage' ? 1.5 : 0, kz = d.D / 2 - 2.5;
      human.root.position.set(kx, 0, kz); human.root.rotation.y = Math.PI;
      group.add(human.root);
      r.keeper = { human, hs: defaultState(), x: kx, z: kz, face: Math.PI, name: human.look.name };
      if (id === 'burger') {
        for (const [cx, cz, nm] of [[-2, 1.2, 1], [1.5, 2.2, 2]] as [number, number, number][]) {
          const h = new Human(randomLook(mulberry32(90 + nm)));
          h.root.position.set(cx, 0, cz); h.root.rotation.y = Math.PI * 0.95; group.add(h.root);
          r.extras.push({ human: h, hs: defaultState(), x: cx, z: cz, face: Math.PI * 0.95, name: 'Customer' });
        }
      }
      if (id === 'garage') {
        const h = new Human(randomLook(mulberry32(8), false));
        h.root.position.set(5.5, 0, -6.4); h.root.rotation.y = -1; group.add(h.root);
        r.extras.push({ human: h, hs: defaultState(), x: 5.5, z: -6.4, face: -1, name: 'Mechanic' });
      }
    }
    group.visible = false;
    g.scene.add(group);
    this.rooms.set(id, r);
    return r;
  }

  enter(id: string) {
    const g = this.g;
    if (this.busy || this.current || !DEFS[id]) return;
    if (g.wanted > 0 && id !== 'spray') { g.toast('Too hot', 'Shake the cops before ducking inside.', 'bad'); return; }
    this.busy = true;
    g.fadeTo(true);
    g.audio.door();
    setTimeout(() => {
      const idx = Object.keys(DEFS).indexOf(id);
      let r = this.rooms.get(id);
      if (r) { r.group.visible = false; g.scene.remove(r.group); g.scene.remove(r.group); this.disposeRoom(r); this.rooms.delete(id); }
      r = this.build(id, idx);
      const p = g.player;
      this.ret = { x: p.x, z: p.z, heading: p.heading };
      r.group.visible = true;
      this.current = r;
      p.x = r.ox; p.z = r.oz - r.D / 2 + 2.2; p.y = 0; p.vx = p.vz = 0; p.vy = 0; p.heading = 0; p.onGround = true;
      g.camYaw = 0; g.camPitch = 0.22;
      g.sky.indoor = 1;
      this.lights.forEach((l, i) => {
        const pt = r!.lightPts[i];
        l.position.set(r!.ox + pt[0], pt[1], r!.oz + pt[2]);
        l.color.set(r!.tint);
        l.distance = Math.max(r!.W, r!.D) * 0.95;
        l.intensity = 38 * DEFS[id].lightK * (r!.H / 4.5);
      });
      hud.fade = false; hud.shop = null;
      g.toast(r.title, r.terminal.label, 'info');
      emitHud();
      g.updateCameraSnap();
      this.busy = false;
    }, 420);
  }

  exit() {
    const g = this.g;
    const r = this.current;
    if (!r || this.busy) return;
    this.busy = true;
    g.fadeTo(true);
    g.audio.door();
    setTimeout(() => {
      const p = g.player;
      const poi = g.world.pois.find((q) => q.id === r.id);
      if (poi) { p.x = poi.x; p.z = poi.z - 1.2; } else { p.x = this.ret.x; p.z = this.ret.z; }
      p.y = g.world.groundY(p.x, p.z); p.heading = Math.PI; p.vx = p.vz = 0;
      g.camYaw = Math.PI; g.camPitch = 0.25;
      r.group.visible = false;
      this.current = null;
      g.sky.indoor = 0;
      this.lights.forEach((l) => (l.intensity = 0));
      g.playerHuman.root.position.set(p.x, p.y, p.z);
      hud.fade = false; hud.shop = null; emitHud();
      g.updateCameraSnap();
      this.busy = false;
    }, 420);
  }

  private disposeRoom(r: Room) {
    r.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !(m instanceof THREE.SkinnedMesh)) m.geometry.dispose();
    });
  }

  /** what can the player do at (x,z)? */
  interactAt(x: number, z: number): { kind: 'exit' | 'shop'; prompt: string } | null {
    const r = this.current;
    if (!r || this.busy) return null;
    const lx = x - r.ox, lz = z - r.oz;
    if (Math.hypot(lx, lz + r.D / 2) < 2.4) return { kind: 'exit', prompt: `Leave ${r.title}` };
    if (Math.hypot(lx - r.terminal.x, lz - r.terminal.z) < 2.6) return { kind: 'shop', prompt: r.terminal.label };
    return null;
  }

  /** circle vs room walls + furniture */
  resolve(x: number, z: number, rad: number): { x: number; z: number } {
    const r = this.current!;
    let lx = x - r.ox, lz = z - r.oz;
    const hw = r.W / 2 - rad - 0.12, hd = r.D / 2 - rad - 0.12;
    lx = Math.max(-hw, Math.min(hw, lx)); lz = Math.max(-hd, Math.min(hd, lz));
    for (let pass = 0; pass < 2; pass++) for (const s of r.solids) {
      const qx = Math.max(s.x0, Math.min(lx, s.x1)), qz = Math.max(s.z0, Math.min(lz, s.z1));
      let dx = lx - qx, dz = lz - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rad * rad) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); lx += (dx / d) * (rad - d); lz += (dz / d) * (rad - d); }
      else {
        const l = lx - s.x0, rr = s.x1 - lx, t = lz - s.z0, bt = s.z1 - lz, m = Math.min(l, rr, t, bt);
        if (m === l) lx = s.x0 - rad; else if (m === rr) lx = s.x1 + rad; else if (m === t) lz = s.z0 - rad; else lz = s.z1 + rad;
      }
      void dx; void dz;
    }
    return { x: lx + r.ox, z: lz + r.oz };
  }

  clampCam(c: THREE.Vector3) {
    const r = this.current;
    if (!r) return;
    c.x = Math.max(r.ox - r.W / 2 + 0.4, Math.min(r.ox + r.W / 2 - 0.4, c.x));
    c.z = Math.max(r.oz - r.D / 2 + 0.4, Math.min(r.oz + r.D / 2 - 0.4, c.z));
    c.y = Math.max(0.35, Math.min(r.H - 0.4, c.y));
  }

  recolor(color: number) {
    const r = this.current;
    if (!r) return;
    if (r.id === 'garage' || r.id === 'spray') r.cars[0]?.model.setColor(color);
  }

  update(dt: number) {
    this.t += dt;
    const r = this.current;
    if (!r) return;
    const p = this.g.player;
    for (const s of r.spinners) s.rotation.y += dt * 0.35;
    r.screens.forEach((m) => m.color.setRGB(0.1 + 0.15 * Math.abs(Math.sin(this.t * 1.7)), 0.3 + 0.2 * Math.abs(Math.sin(this.t * 0.9)), 0.9 + 0.2 * Math.sin(this.t * 2.3)));
    const all = r.keeper ? [r.keeper, ...r.extras] : r.extras;
    for (const k of all) {
      const dx = p.x - (r.ox + k.x), dz = p.z - (r.oz + k.z);
      const d = Math.hypot(dx, dz);
      let face = k.face;
      if (d < 6) face = Math.atan2(dx, dz);
      let da = face - k.human.root.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da));
      k.human.root.rotation.y += da * Math.min(1, dt * 4);
      k.hs.talk = k === r.keeper && d < 4;
      k.human.update(dt, k.hs);
    }
  }
}
