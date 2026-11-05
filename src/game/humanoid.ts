import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBuilder, matT, type Ring } from './loft';
import { FACE, faceTex, fabricTex, hairTex, irisTex, skinBump, skinTex, type FabricKind } from './textures';
import { clamp, damp, lerp, pick, type RNG } from './util';

// ---------------------------------------------------------------- skeleton
export const B = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  uArmL: 5, fArmL: 6, handL: 7, uArmR: 8, fArmR: 9, handR: 10,
  thighL: 11, shinL: 12, footL: 13, thighR: 14, shinR: 15, footR: 16,
} as const;
const BONE_NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15];
const REST: [number, number, number][] = [
  [0, 0.97, 0], [0, 1.07, 0], [0, 1.22, 0], [0, 1.5, 0.0], [0, 1.585, 0.01],
  [0.21, 1.44, 0], [0.235, 1.13, 0], [0.252, 0.86, 0],
  [-0.21, 1.44, 0], [-0.235, 1.13, 0], [-0.252, 0.86, 0],
  [0.095, 0.93, 0], [0.088, 0.5, 0.01], [0.09, 0.08, 0],
  [-0.095, 0.93, 0], [-0.088, 0.5, 0.01], [-0.09, 0.08, 0],
];
const MIRROR: Record<number, number> = { 5: 8, 6: 9, 7: 10, 8: 5, 9: 6, 10: 7, 11: 14, 12: 15, 13: 16, 14: 11, 15: 12, 16: 13 };

// ---------------------------------------------------------------- looks
export type HairStyle = 'bald' | 'buzz' | 'short' | 'quiff' | 'long' | 'ponytail' | 'bob' | 'cap' | 'beanie' | 'slick';
export type TopType = 'tee' | 'jacket' | 'hoodie' | 'shirt' | 'suit' | 'uniform' | 'vest' | 'tank';
export type BottomType = 'jeans' | 'cargo' | 'suit' | 'shorts' | 'skirt' | 'track';
export interface Look {
  name: string;
  female?: boolean;
  height?: number; // multiplier
  build?: number; // shoulder multiplier
  fat?: number; // 0..1 belly
  skin: number; eye: number; hair: number; hairStyle: HairStyle;
  lip?: number; brow?: number; beard?: boolean; stubble?: number; age?: number; makeup?: number;
  glasses?: 'none' | 'round' | 'aviator' | 'wayfarer';
  top: { type: TopType; color: number; color2?: number; kind?: FabricKind; long?: boolean };
  under?: number;
  bottom: { type: BottomType; color: number; kind?: FabricKind };
  shoes: { color: number; sole?: number; boot?: boolean };
  extras?: ('watch' | 'chain' | 'badge' | 'helmet' | 'belt' | 'tie' | 'bandana' | 'earpiece' | 'vestarmor' | 'cap' | 'gloves' | 'mask')[];
  capColor?: number;
}

export const LOOKS: Record<string, Look> = {
  veer: {
    name: 'Veer', skin: 0xc89268, eye: 0x3a2314, hair: 0x14100d, hairStyle: 'quiff', brow: 0x16100c, stubble: 0.55, glasses: 'none',
    top: { type: 'jacket', color: 0x1c1d22, color2: 0xe9e4da, kind: 'leather', long: true }, under: 0xe8e4dc,
    bottom: { type: 'jeans', color: 0x2c3a52, kind: 'denim' }, shoes: { color: 0xe9e9e6, sole: 0xf3f3f0 }, extras: ['watch', 'chain', 'belt'], build: 1.02,
  },
  dev: {
    name: 'Dev', skin: 0xa8744d, eye: 0x241408, hair: 0x120e0b, hairStyle: 'slick', brow: 0x120d0a, beard: true, age: 0.6, height: 1.03, build: 1.12, fat: 0.35,
    top: { type: 'suit', color: 0x2a1c18, color2: 0xb88a2a, kind: 'suit', long: true }, under: 0xf3efe6,
    bottom: { type: 'suit', color: 0x2a1c18, kind: 'suit' }, shoes: { color: 0x1a1210, sole: 0x111111 }, extras: ['watch', 'chain', 'tie', 'belt'],
  },
  jimmy: {
    name: 'Jimmy', skin: 0xd09a74, eye: 0x2c1c10, hair: 0x2b1b12, hairStyle: 'cap', brow: 0x2b1b12, stubble: 0.35, capColor: 0x2d5fa8, build: 1.08,
    top: { type: 'tee', color: 0xd7d7d2, kind: 'cotton' }, under: 0xd7d7d2,
    bottom: { type: 'cargo', color: 0x2d5fa8, kind: 'cargo' }, shoes: { color: 0x3a2c1c, sole: 0x222222, boot: true }, extras: ['gloves', 'belt'],
  },
  meera: {
    name: 'Meera', female: true, skin: 0xd29a78, eye: 0x1e120a, hair: 0x120b08, hairStyle: 'long', lip: 0xa2403c, brow: 0x140b08, makeup: 0.7, height: 0.94, build: 0.9,
    top: { type: 'jacket', color: 0x7b4aa6, color2: 0xffffff, kind: 'cotton', long: true }, under: 0xf6f0f8,
    bottom: { type: 'jeans', color: 0x242c3e, kind: 'denim' }, shoes: { color: 0xf2f2f2, sole: 0xffffff }, extras: ['chain'], glasses: 'none',
  },
  raghav: {
    name: 'Raghav', skin: 0xb88259, eye: 0x1a0f08, hair: 0xc9c4bb, hairStyle: 'slick', brow: 0x8e8a82, stubble: 0.5, age: 1, height: 1.05, build: 1.1, glasses: 'aviator',
    top: { type: 'suit', color: 0xdad5c8, color2: 0xbfa253, kind: 'suit', long: true }, under: 0x1a1a1c,
    bottom: { type: 'suit', color: 0xdad5c8, kind: 'suit' }, shoes: { color: 0x7a5a38, sole: 0x2a2a2a }, extras: ['watch', 'chain'],
  },
  kaalu: {
    name: 'Kaalu', skin: 0x7e5036, eye: 0x120a06, hair: 0x0c0907, hairStyle: 'buzz', brow: 0x0c0907, beard: true, build: 1.2, fat: 0.5,
    top: { type: 'hoodie', color: 0x2a2a2e, kind: 'knit', long: true },
    bottom: { type: 'track', color: 0x1c1c1f, kind: 'cotton' }, shoes: { color: 0x151515, sole: 0xdddddd }, extras: ['chain'], glasses: 'wayfarer',
  },
  cop: {
    name: 'Cop', skin: 0xc8956c, eye: 0x3b2a18, hair: 0x1b140f, hairStyle: 'short', brow: 0x1b140f, stubble: 0.3,
    top: { type: 'uniform', color: 0x1b2a4a, color2: 0xd0b24a, kind: 'cotton', long: true }, under: 0x1b2a4a,
    bottom: { type: 'cargo', color: 0x141c30, kind: 'cotton' }, shoes: { color: 0x0e0e0e, sole: 0x111111, boot: true }, extras: ['badge', 'belt', 'vestarmor', 'earpiece', 'cap'], capColor: 0x131c30,
  },
  swat: {
    name: 'SWAT', skin: 0xc8956c, eye: 0x3b2a18, hair: 0x1b140f, hairStyle: 'bald', brow: 0x1b140f, build: 1.18,
    top: { type: 'uniform', color: 0x16181a, color2: 0x30343a, kind: 'cargo', long: true }, under: 0x16181a,
    bottom: { type: 'cargo', color: 0x181a1c, kind: 'cargo' }, shoes: { color: 0x0a0a0a, sole: 0x0a0a0a, boot: true }, extras: ['vestarmor', 'helmet', 'belt', 'gloves', 'mask'],
  },
  gang1: {
    name: 'Gangster', skin: 0xa86f48, eye: 0x1a0f08, hair: 0x0c0907, hairStyle: 'buzz', brow: 0x0c0907, beard: true, build: 1.1,
    top: { type: 'hoodie', color: 0x6c1620, kind: 'knit', long: true },
    bottom: { type: 'jeans', color: 0x1c1f28, kind: 'denim' }, shoes: { color: 0xeeeeee, sole: 0xeeeeee }, extras: ['bandana', 'chain'],
  },
  gang2: {
    name: 'Gangster', skin: 0xd09a74, eye: 0x3a2314, hair: 0x1a1210, hairStyle: 'beanie', brow: 0x1a1210, stubble: 0.6, capColor: 0x1a1a1a,
    top: { type: 'jacket', color: 0x2c4a2c, kind: 'cotton', long: true }, under: 0x222222,
    bottom: { type: 'cargo', color: 0x3a3a30, kind: 'cargo' }, shoes: { color: 0x2a2a2a, sole: 0x777777, boot: true }, extras: ['bandana'],
  },
};

const SKINS = [0xf1c9a5, 0xe0ac86, 0xc89268, 0xb07a52, 0x94613f, 0x7a4d32, 0x5c3924, 0xd8a47c];
const HAIRS = [0x0e0a08, 0x1c140f, 0x2b1b12, 0x3b281a, 0x5a3a22, 0x8a6a3e, 0xb5a58a, 0x9a9a9a];
const EYES = [0x241408, 0x3a2314, 0x4e3a20, 0x2c4a60, 0x3f5a38];
const TOP_COLS = [0x2e3b4e, 0x7a2020, 0x2f5d3a, 0xd8d4c8, 0x15161a, 0xb48a2a, 0x4a4f8a, 0x8a4a2a, 0xd0a0a0, 0x3f7a8a, 0xe0e0e0, 0x55555a];
const BOT_COLS = [0x232b3c, 0x2c3a52, 0x151618, 0x4a4234, 0x5a5a5c, 0x1a2a3a, 0x3a3228];
export function randomLook(rng: RNG, female?: boolean): Look {
  const f = female ?? rng() < 0.46;
  const tops: TopType[] = f ? ['tee', 'tank', 'jacket', 'hoodie', 'shirt'] : ['tee', 'jacket', 'hoodie', 'shirt', 'tee', 'vest'];
  const hs: HairStyle[] = f ? ['long', 'ponytail', 'bob', 'short', 'long'] : ['short', 'buzz', 'quiff', 'bald', 'short', 'slick', 'cap', 'beanie'];
  const bt: BottomType[] = f ? ['jeans', 'skirt', 'track', 'shorts', 'jeans'] : ['jeans', 'cargo', 'shorts', 'track', 'jeans'];
  const tt = pick(tops, rng);
  return {
    name: 'Citizen', female: f, skin: pick(SKINS, rng), eye: pick(EYES, rng), hair: pick(HAIRS, rng), hairStyle: pick(hs, rng),
    brow: 0x1a120c, stubble: !f && rng() < 0.4 ? 0.3 + rng() * 0.4 : 0, beard: !f && rng() < 0.12, lip: f ? 0xb2504c : 0x9a5a4a, makeup: f ? 0.3 + rng() * 0.5 : 0,
    height: (f ? 0.93 : 1.0) + (rng() - 0.5) * 0.1, build: 0.9 + rng() * 0.25, fat: rng() < 0.25 ? 0.4 + rng() * 0.5 : 0, age: rng() < 0.2 ? 1 : 0,
    glasses: rng() < 0.12 ? pick(['round', 'wayfarer', 'aviator'] as const, rng) : 'none',
    top: { type: tt, color: pick(TOP_COLS, rng), color2: pick(TOP_COLS, rng), kind: tt === 'jacket' ? 'leather' : tt === 'hoodie' ? 'knit' : 'cotton', long: tt === 'jacket' || tt === 'hoodie' || (tt === 'shirt' && rng() < 0.5) },
    under: pick(TOP_COLS, rng),
    bottom: { type: pick(bt, rng), color: pick(BOT_COLS, rng), kind: 'denim' },
    shoes: { color: pick([0xeeeeee, 0x151515, 0x6a4a2a, 0x2a3a5a, 0xa02020], rng), sole: 0xdddddd },
    extras: rng() < 0.3 ? ['watch'] : [], capColor: pick(TOP_COLS, rng),
  };
}

// ---------------------------------------------------------------- profile sampling
interface Key { y: number; rx: number; rz: number; cx?: number; cz?: number; w: [number, number][] }
function lerpW(a: [number, number][], b: [number, number][], t: number): [number, number][] {
  const m = new Map<number, number>();
  for (const [i, w] of a) m.set(i, (m.get(i) ?? 0) + w * (1 - t));
  for (const [i, w] of b) m.set(i, (m.get(i) ?? 0) + w * t);
  return [...m.entries()].filter(([, w]) => w > 0.001);
}
function sampleProf(keys: Key[], y: number, infl = 0, flipX = 1, mirror = false): Ring {
  const ys = keys[0].y > keys[keys.length - 1].y ? keys.slice().reverse() : keys;
  y = clamp(y, ys[0].y, ys[ys.length - 1].y);
  let i = 0;
  while (i < ys.length - 2 && y > ys[i + 1].y) i++;
  const a = ys[i], b = ys[i + 1];
  const t = clamp((y - a.y) / (b.y - a.y || 1), 0, 1);
  const s = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
  const w = lerpW(a.w, b.w, t).map(([bi, ww]) => [mirror ? MIRROR[bi] ?? bi : bi, ww] as [number, number]);
  return {
    p: [lerp(a.cx ?? 0, b.cx ?? 0, s) * flipX, y, lerp(a.cz ?? 0, b.cz ?? 0, s)],
    rx: lerp(a.rx, b.rx, s) + infl, rz: lerp(a.rz, b.rz, s) + infl, bones: w,
  };
}
function span(keys: Key[], y0: number, y1: number, step: number, infl: number, flipX = 1, mirror = false) {
  const out: Ring[] = [];
  const dir = y1 >= y0 ? 1 : -1;
  for (let y = y0; dir > 0 ? y < y1 - 1e-6 : y > y1 + 1e-6; y += step * dir) out.push(sampleProf(keys, y, infl, flipX, mirror));
  out.push(sampleProf(keys, y1, infl, flipX, mirror));
  return out;
}

const W = (...a: [number, number][]) => a;
function torsoKeys(look: Look): Key[] {
  const f = !!look.female, sh = look.build ?? 1, fat = look.fat ?? 0;
  return [
    { y: 0.86, rx: 0.158, rz: 0.1, w: W([0, 1]) },
    { y: 0.95, rx: f ? 0.176 : 0.168, rz: f ? 0.108 : 0.104, w: W([0, 1]) },
    { y: 1.02, rx: (f ? 0.142 : 0.158) + fat * 0.03, rz: (f ? 0.098 : 0.098) + fat * 0.045, w: W([0, 0.5], [1, 0.5]) },
    { y: 1.1, rx: (f ? 0.128 : 0.15) + fat * 0.035, rz: (f ? 0.09 : 0.094) + fat * 0.05, w: W([1, 1]) },
    { y: 1.2, rx: (f ? 0.14 : 0.16 * sh) + fat * 0.02, rz: (f ? 0.098 : 0.104) + fat * 0.03, w: W([1, 0.5], [2, 0.5]) },
    { y: 1.3, rx: (f ? 0.15 : 0.178 * sh), rz: f ? 0.106 : 0.113, w: W([2, 1]) },
    { y: 1.4, rx: (f ? 0.162 : 0.196 * sh), rz: 0.098, w: W([2, 1]) },
    { y: 1.46, rx: 0.148, rz: 0.08, w: W([2, 0.85], [3, 0.15]) },
    { y: 1.51, rx: 0.078, rz: 0.064, w: W([3, 1]) },
  ];
}
const NECK: Key[] = [
  { y: 1.47, rx: 0.058, rz: 0.06, w: W([3, 1]) },
  { y: 1.55, rx: 0.05, rz: 0.054, cz: 0.006, w: W([3, 0.5], [4, 0.5]) },
  { y: 1.6, rx: 0.052, rz: 0.058, cz: 0.012, w: W([4, 1]) },
];
const ARM: Key[] = [
  { y: 1.5, rx: 0.036, rz: 0.04, cx: 0.205, w: W([2, 0.5], [5, 0.5]) },
  { y: 1.47, rx: 0.062, rz: 0.062, cx: 0.208, w: W([2, 0.35], [5, 0.65]) },
  { y: 1.42, rx: 0.066, rz: 0.066, cx: 0.214, w: W([5, 1]) },
  { y: 1.3, rx: 0.056, rz: 0.058, cx: 0.222, w: W([5, 1]) },
  { y: 1.17, rx: 0.045, rz: 0.049, cx: 0.231, w: W([5, 1]) },
  { y: 1.13, rx: 0.045, rz: 0.048, cx: 0.235, w: W([5, 0.5], [6, 0.5]) },
  { y: 1.06, rx: 0.047, rz: 0.05, cx: 0.24, w: W([6, 1]) },
  { y: 0.96, rx: 0.039, rz: 0.04, cx: 0.247, w: W([6, 1]) },
  { y: 0.89, rx: 0.029, rz: 0.034, cx: 0.251, w: W([6, 0.5], [7, 0.5]) },
  { y: 0.86, rx: 0.028, rz: 0.034, cx: 0.252, w: W([7, 1]) },
];
const LEG: Key[] = [
  { y: 0.99, rx: 0.088, rz: 0.088, cx: 0.092, cz: -0.004, w: W([0, 0.5], [11, 0.5]) },
  { y: 0.94, rx: 0.092, rz: 0.094, cx: 0.094, cz: -0.004, w: W([0, 0.25], [11, 0.75]) },
  { y: 0.84, rx: 0.088, rz: 0.092, cx: 0.094, cz: 0, w: W([11, 1]) },
  { y: 0.7, rx: 0.075, rz: 0.08, cx: 0.092, cz: 0.004, w: W([11, 1]) },
  { y: 0.56, rx: 0.058, rz: 0.063, cx: 0.09, cz: 0.01, w: W([11, 1]) },
  { y: 0.5, rx: 0.056, rz: 0.06, cx: 0.089, cz: 0.012, w: W([11, 0.5], [12, 0.5]) },
  { y: 0.44, rx: 0.056, rz: 0.062, cx: 0.089, cz: 0.004, w: W([12, 1]) },
  { y: 0.34, rx: 0.052, rz: 0.062, cx: 0.09, cz: -0.012, w: W([12, 1]) },
  { y: 0.22, rx: 0.04, rz: 0.044, cx: 0.09, cz: -0.006, w: W([12, 1]) },
  { y: 0.12, rx: 0.032, rz: 0.034, cx: 0.09, cz: -0.002, w: W([12, 0.7], [13, 0.3]) },
  { y: 0.07, rx: 0.034, rz: 0.038, cx: 0.09, cz: 0.0, w: W([13, 1]) },
];
const HEAD_W: [number, number][] = [[4, 1]];
const EYE_Y = 1.69;
const headRings = (inf = 0): Ring[] => {
  const mk = (y: number, rx: number, rz: number, cz: number): Ring => ({ p: [0, y, cz], rx: rx + inf, rz: rz + inf, bones: HEAD_W });
  return [
    mk(1.582, 0.022, 0.026, 0.078),
    mk(1.592, 0.04, 0.045, 0.07),
    mk(1.607, 0.056, 0.068, 0.045),
    mk(1.625, 0.067, 0.082, 0.026),
    mk(1.65, 0.074, 0.092, 0.016),
    mk(1.68, 0.078, 0.096, 0.012),
    mk(1.71, 0.079, 0.098, 0.01),
    mk(1.745, 0.077, 0.097, 0.008),
    mk(1.775, 0.068, 0.088, 0.005),
    mk(1.797, 0.05, 0.068, 0.002),
    mk(1.81, 0.026, 0.04, 0.0),
    mk(1.815, 0.004, 0.006, 0.0),
  ];
};

function densify(rs: Ring[], n: number): Ring[] {
  const out: Ring[] = [];
  for (let i = 0; i < rs.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const t = k / n, a = rs[i], b = rs[i + 1];
      out.push({ p: [lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t)], rx: lerp(a.rx, b.rx, t), rz: lerp(a.rz, b.rz, t), bones: a.bones });
    }
  }
  out.push(rs[rs.length - 1]);
  return out;
}

const gauss = (x: number, y: number, z: number, cx: number, cy: number, cz: number, r: number) => {
  const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
  return Math.exp(-d2 / (r * r));
};

const faceUV = (x: number, y: number): [number, number] => [0.5 + x / FACE.W, 0.5 + (y - EYE_Y) / FACE.H];

// ---------------------------------------------------------------- materials (cached by key)
const matCache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, f: () => T): T {
  if (!matCache.has(key)) matCache.set(key, f());
  return matCache.get(key) as T;
}

export interface BuiltHuman {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
}

const geoCache = new Map<string, BuiltHuman>();

function buildBody(look: Look): BuiltHuman {
  const mb = new MeshBuilder();
  const f = !!look.female;
  const torso = torsoKeys(look);
  const fat = look.fat ?? 0;

  // ------------- skin: torso, neck, arms, legs, hands
  const bust = (x: number, y: number, z: number): [number, number, number] => {
    if (!f || z < 0.02) return [0, 0, 0];
    const g = gauss(Math.abs(x), y, z, 0.07, 1.285, 0.1, 0.06) * 0.03;
    return [0, 0, g];
  };
  const male = (x: number, y: number, z: number): [number, number, number] => {
    if (f || z < 0.02) return [0, 0, 0];
    const pec = gauss(Math.abs(x), y, z, 0.075, 1.31, 0.105, 0.07) * 0.012;
    const abs = gauss(Math.abs(x), y, z, 0.04, 1.14, 0.1, 0.06) * 0.004;
    const belly = fat * gauss(x, y, z, 0, 1.08, 0.12, 0.13) * 0.06;
    return [0, 0, pec + abs + belly];
  };
  mb.loft('skin', span(torso, 0.86, 1.51, 0.03, 0), { segs: 28, uv: 'cyl', uvScale: [3, 3], displace: (x, y, z) => (f ? bust(x, y, z) : male(x, y, z)) });
  mb.loft('skin', span(NECK, 1.47, 1.6, 0.03, 0), { segs: 24, uv: 'planar', planar: faceUV });
  for (const s of [1, -1]) {
    const mir = s < 0;
    mb.loft('skin', span(ARM, 1.465, 0.86, 0.03, 0, s, mir), { segs: 16, uv: 'cyl', uvScale: [2, 4], capStart: true });
    mb.loft('skin', span(LEG, 0.99, 0.07, 0.03, 0, s, mir), { segs: 18, uv: 'cyl', uvScale: [2, 4], capStart: false });
    // hand: palm + fingers + thumb
    const hb = mir ? B.handR : B.handL;
    const hx = 0.252 * s;
    const palm: Ring[] = [
      { p: [hx, 0.862, 0], rx: 0.026, rz: 0.034, bones: [[hb, 1]] },
      { p: [hx + 0.003 * s, 0.82, 0], rx: 0.022, rz: 0.046, bones: [[hb, 1]] },
      { p: [hx + 0.004 * s, 0.775, 0.002], rx: 0.019, rz: 0.044, bones: [[hb, 1]] },
      { p: [hx + 0.004 * s, 0.76, 0.002], rx: 0.016, rz: 0.04, bones: [[hb, 1]] },
    ];
    mb.loft('skin', palm, { segs: 12, uv: 'cyl', capEnd: true });
    const flen = [0.07, 0.078, 0.074, 0.058];
    for (let k = 0; k < 4; k++) {
      const z = -0.03 + k * 0.02;
      const L = flen[k];
      const fr: Ring[] = [0, 0.4, 0.75, 1].map((t, i) => ({
        p: [hx + 0.005 * s + i * 0.002 * s, 0.762 - L * t, z + (k === 0 ? 0.0 : 0) + i * 0.0025],
        rx: 0.0085 - t * 0.0018, rz: 0.0092 - t * 0.0018, bones: [[hb, 1]] as [number, number][],
      }));
      mb.loft('skin', fr, { segs: 8, uv: 'cyl', capEnd: true });
    }
    // thumb (front, angled)
    const th: Ring[] = [0, 0.5, 1].map((t) => ({
      p: [hx - 0.012 * s * 0 + 0.0 * s, 0.82 - t * 0.055, 0.04 + t * 0.012 + 0.008], rx: 0.011 - t * 0.003, rz: 0.011 - t * 0.003, bones: [[hb, 1]] as [number, number][],
    }));
    mb.loft('skin', th, { segs: 8, uv: 'cyl', capEnd: true });
  }

  // ------------- head
  const hd = (x: number, y: number, z: number): [number, number, number] => {
    if (z < 0.02) {
      // ear indentation / back of head left alone
      return [0, 0, 0];
    }
    let dz = 0, dy = 0, dx = 0;
    for (const s of [-1, 1]) {
      dz -= gauss(x, y, z, s * 0.032, EYE_Y, 0.098, 0.016) * 0.0095; // eye socket
      dz += gauss(x, y, z, s * 0.031, EYE_Y + 0.026, 0.1, 0.022) * (f ? 0.002 : 0.005); // brow ridge
      dz += gauss(x, y, z, s * 0.056, EYE_Y - 0.026, 0.075, 0.026) * 0.006; // cheekbone
      dz -= gauss(x, y, z, s * 0.062, EYE_Y - 0.065, 0.065, 0.03) * 0.004; // cheek hollow under bone (subtle)
      dz += gauss(x, y, z, s * 0.011, EYE_Y - 0.068, 0.106, 0.012) * 0.002;
    }
    dz += gauss(x, y, z, 0, EYE_Y - 0.077, 0.105, 0.017) * 0.0042; // lips
    dz -= gauss(x, y, z, 0, EYE_Y - 0.0795, 0.108, 0.0075) * 0.0023; // mouth line
    dz += gauss(x, y, z, 0, EYE_Y - 0.113, 0.1, 0.02) * (f ? 0.0025 : 0.007); // chin
    dz -= gauss(x, y, z, 0, EYE_Y - 0.098, 0.1, 0.013) * 0.003; // under-lip dent
    dz -= gauss(x, y, z, 0, EYE_Y + 0.005, 0.1, 0.013) * 0.0 + 0;
    dx += 0;
    dy += 0;
    return [dx, dy, dz];
  };
  mb.loft('head', densify(headRings(), 2), { segs: 48, uv: 'planar', planar: faceUV, displace: hd });

  // nose (union of soft ellipsoids)
  const sph = (r = 1, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
  const nz = f ? 0.0 : 0.002;
  mb.rigid('head', sph(), matT(0, EYE_Y - 0.022, 0.1, -0.35, 0, 0, 0.0068, 0.016, 0.0085), B.head);
  mb.rigid('head', sph(), matT(0, EYE_Y - 0.032, 0.107 + nz, 0, 0, 0, 0.0085, 0.014, 0.0105), B.head);
  mb.rigid('head', sph(), matT(0, EYE_Y - 0.0385, 0.111 + nz, 0, 0, 0, 0.0095, 0.0085, 0.0095), B.head);
  for (const s of [-1, 1]) mb.rigid('head', sph(), matT(s * 0.0105, EYE_Y - 0.0405, 0.103 + nz, 0, 0, s * 0.25, 0.0065, 0.0075, 0.0072), B.head);
  // ears
  for (const s of [-1, 1]) {
    mb.rigid('head', sph(), matT(s * 0.0775, EYE_Y - 0.01, -0.004, 0, s * 0.35, 0, 0.0075, 0.03, 0.019), B.head);
    mb.rigid('head', sph(), matT(s * 0.0795, EYE_Y + 0.0, -0.0075, 0, s * 0.35, 0, 0.0045, 0.022, 0.012), B.head);
  }
  // eyes + lids
  for (const s of [-1, 1]) {
    const eg = new THREE.SphereGeometry(0.0108, 20, 14);
    mb.rigid('eye', eg, matT(s * 0.032, EYE_Y, 0.0845, 0, 0, 0), B.head);
    const upper = new THREE.SphereGeometry(0.0118, 20, 8, 0, Math.PI * 2, 0, f ? 1.32 : 1.25);
    mb.rigid('head', upper, matT(s * 0.032, EYE_Y, 0.0845, 0.12, 0, 0), B.head);
    const lower = new THREE.SphereGeometry(0.0116, 20, 6, 0, Math.PI * 2, Math.PI - 0.75, 0.75);
    mb.rigid('head', lower, matT(s * 0.032, EYE_Y, 0.0845, -0.05, 0, 0), B.head);
  }
  // fix planar UVs for rigid pieces on the head (they got sphere UVs) -> overwritten below
  const hg = mb.groups.get('head')!;
  for (let i = 0; i < hg.pos.length / 3; i++) {
    if (hg.uv[i * 2] === 0 && hg.uv[i * 2 + 1] === 0) {
      /* pole vertex */
    }
  }
  // recompute planar uv for every head vertex (loft + rigid pieces)
  for (let i = 0; i < hg.pos.length / 3; i++) {
    const [u, v] = faceUV(hg.pos[i * 3], hg.pos[i * 3 + 1]);
    hg.uv[i * 2] = u;
    hg.uv[i * 2 + 1] = v;
  }

  // ------------- hair
  buildHair(mb, look);

  // ------------- clothing
  buildClothes(mb, look, torso);

  // ------------- shoes
  for (const s of [1, -1]) {
    const mir = s < 0;
    const fb = mir ? B.footR : B.footL;
    const boot = look.shoes.boot;
    const x = 0.09 * s;
    const upper: Ring[] = [
      { p: [x, 0.05, -0.062], rx: 0.026, rz: 0.03, bones: [[fb, 1]] },
      { p: [x, 0.058, -0.04], rx: 0.04, rz: 0.048, bones: [[fb, 1]] },
      { p: [x, 0.062, 0.03], rx: 0.047, rz: 0.044, bones: [[fb, 1]] },
      { p: [x, 0.054, 0.1], rx: 0.045, rz: 0.036, bones: [[fb, 1]] },
      { p: [x, 0.046, 0.15], rx: 0.038, rz: 0.028, bones: [[fb, 1]] },
      { p: [x, 0.04, 0.19], rx: 0.024, rz: 0.019, bones: [[fb, 1]] },
      { p: [x, 0.039, 0.205], rx: 0.006, rz: 0.008, bones: [[fb, 1]] },
    ];
    mb.loft('shoe', upper, { axis: 'z', segs: 20, uv: 'cyl', capStart: true, capEnd: true, uvScale: [2, 5] });
    // ankle collar (boot goes higher)
    const colH = boot ? 0.2 : 0.11;
    const collar: Ring[] = [0, 0.5, 1].map((t) => ({ p: [x, 0.075 + t * (colH - 0.03), -0.012], rx: 0.0455 - t * 0.003, rz: 0.05 - t * 0.003, bones: [[t > 0.6 && boot ? B.shinL + (mir ? 3 : 0) : fb, 1]] as [number, number][] }));
    mb.loft('shoe', collar, { segs: 18, uv: 'cyl', uvScale: [2, 3], capEnd: false });
    // sole
    mb.box('sole', 0.098, 0.02, 0.28, x, 0.01, 0.055, fb);
    mb.rigid('sole', new THREE.CylinderGeometry(0.049, 0.049, 0.02, 14, 1), matT(x, 0.01, 0.195, 0, 0, 0, 1, 1, 0.8), fb);
    mb.rigid('sole', new THREE.CylinderGeometry(0.049, 0.049, 0.02, 14, 1), matT(x, 0.01, -0.082, 0, 0, 0, 1, 1, 0.8), fb);
    // laces / tongue
    if (!boot) mb.box('acc', 0.04, 0.008, 0.07, x, 0.1, 0.07, fb, -0.5);
  }

  // ------------- accessories
  buildAccessories(mb, look);

  // ------------- merge groups into one multi-material geometry
  const order = ['skin', 'head', 'eye', 'hair', 'top', 'top2', 'under', 'bottom', 'shoe', 'sole', 'acc', 'metal', 'glass', 'belt'];
  const geos: THREE.BufferGeometry[] = [];
  const names: string[] = [];
  for (const n of order) {
    const g = mb.build(n, true);
    if (g) {
      geos.push(g);
      names.push(n);
    }
  }
  const merged = mergeGeometries(geos, true)!;
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  geos.forEach((g) => g.dispose());

  const key = (s: string) => `${look.name}-${look.skin}-${s}`;
  const faceKey = `${look.name}-${look.skin}-${look.lip}-${look.stubble}-${look.beard}-${look.hair}`;
  const materials: THREE.Material[] = names.map((n) => {
    switch (n) {
      case 'skin':
        return cached(key('skin'), () => new THREE.MeshPhysicalMaterial({ map: skinTex(look.skin, String(look.skin)), normalMap: skinBump(), normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.58, sheen: 0.4, sheenColor: new THREE.Color(0xff8a70), sheenRoughness: 0.5 }));
      case 'head':
        return cached(key('head' + faceKey), () => new THREE.MeshPhysicalMaterial({
          map: faceTex({ skin: look.skin, lip: look.lip ?? (f ? 0xb2504c : 0x8e5448), brow: look.brow ?? look.hair, stubble: look.stubble ?? 0, beard: look.beard, female: f, age: look.age, makeup: look.makeup, eyeShadow: f ? 0.25 : 0 }, faceKey),
          normalMap: skinBump(), normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.52, sheen: 0.5, sheenColor: new THREE.Color(0xff8a70), sheenRoughness: 0.45,
        }));
      case 'eye':
        return cached(key('eye' + look.eye), () => new THREE.MeshPhysicalMaterial({ map: irisTex(look.eye), roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 }));
      case 'hair':
        return cached(key('hair' + look.hair), () => new THREE.MeshStandardMaterial({ map: hairTex(look.hair, look.hairStyle), roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide }));
      case 'top': {
        const t = fabricTex(look.top.color, look.top.kind ?? 'cotton');
        return cached(key('top' + look.top.color + look.top.kind), () => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: look.top.kind === 'leather' ? 0.4 : 0.85, metalness: look.top.kind === 'leather' ? 0.05 : 0, side: THREE.DoubleSide }));
      }
      case 'top2': {
        const t = fabricTex(look.top.color2 ?? 0xffffff, 'cotton');
        return cached(key('top2' + look.top.color2), () => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.7, side: THREE.DoubleSide }));
      }
      case 'under': {
        const t = fabricTex(look.under ?? 0xeeeeee, 'cotton');
        return cached(key('under' + look.under), () => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.9, side: THREE.DoubleSide }));
      }
      case 'bottom': {
        const t = fabricTex(look.bottom.color, look.bottom.kind ?? 'denim');
        return cached(key('bot' + look.bottom.color + look.bottom.kind), () => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.88, side: THREE.DoubleSide }));
      }
      case 'shoe': {
        const t = fabricTex(look.shoes.color, 'leather');
        return cached(key('shoe' + look.shoes.color), () => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughness: 0.55 }));
      }
      case 'sole':
        return cached(key('sole' + (look.shoes.sole ?? 0xdddddd)), () => new THREE.MeshStandardMaterial({ color: look.shoes.sole ?? 0xdddddd, roughness: 0.8 }));
      case 'metal':
        return cached('human-metal', () => new THREE.MeshStandardMaterial({ color: 0xd0b060, roughness: 0.25, metalness: 1 }));
      case 'glass':
        return cached('human-glass-' + look.glasses, () => new THREE.MeshPhysicalMaterial({ color: look.glasses === 'aviator' ? 0x1a1a14 : look.glasses === 'wayfarer' ? 0x15151a : 0x9ab0c0, roughness: 0.04, metalness: 0.2, transparent: true, opacity: look.glasses === 'round' ? 0.25 : 0.82 }));
      case 'belt':
        return cached('human-belt', () => new THREE.MeshStandardMaterial({ color: 0x1b140f, roughness: 0.5 }));
      default:
        return cached(key('acc' + look.capColor + look.top.color2), () => new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.5, metalness: 0.4 }));
    }
  });
  return { geometry: merged, materials };
}

function buildHair(mb: MeshBuilder, look: Look) {
  const st = look.hairStyle;
  if (st === 'bald') return;
  const f = !!look.female;
  const HB: [number, number][] = [[B.head, 1]];
  const inflate = st === 'buzz' ? 0.003 : st === 'cap' || st === 'beanie' ? 0.01 : 0.011;
  // hairline control (y threshold depends on azimuth)
  const sideLow = st === 'buzz' ? 1.7 : st === 'long' || st === 'bob' || st === 'ponytail' ? 1.66 : 1.7;
  const frontLine = st === 'quiff' ? 1.775 : st === 'slick' ? 1.77 : st === 'buzz' ? 1.766 : 1.76;
  const backLow = st === 'buzz' ? 1.69 : st === 'short' ? 1.67 : st === 'long' ? 1.62 : 1.66;
  const hairline = (x: number, z: number) => {
    const ang = Math.atan2(z - 0.01, x); // pi/2 = front
    const front = Math.max(0, Math.sin(ang));
    const side = 1 - Math.abs(Math.sin(ang));
    const back = Math.max(0, -Math.sin(ang));
    // temple recession for men
    let y = lerp(sideLow, frontLine, front) * (1 - back) + backLow * back;
    if (!f && front > 0.4) y += Math.abs(x) > 0.045 ? 0.0 : 0;
    y -= side * 0.0;
    return y;
  };
  const rings = densify(headRings(inflate).filter((r) => r.p[1] > 1.6), 3);
  // extra volume on top / quiff
  const vol = (st === 'quiff' ? 0.018 : st === 'slick' ? 0.012 : st === 'short' ? 0.012 : st === 'buzz' ? 0 : 0.018) * (f ? 1.1 : 1);
  if (st === 'cap' || st === 'beanie') {
    rings.length = 0;
    rings.push(...headRings(0.014).filter((r) => r.p[1] > 1.715));
  }
  mb.loft('hair', rings, {
    segs: 56, uv: 'cyl', uvScale: [3, 14], bone: B.head,
    displace: (x, y, z) => {
      let dx = 0, dy = 0, dz = 0;
      const ang = Math.atan2(z - 0.01, x);
      const front = Math.max(0, Math.sin(ang));
      const hl = hairline(x, z);
      const cutT = clamp((hl - y) / 0.04, 0, 1);
      // push below-hairline vertices inside the skull so they vanish
      dx -= x * cutT * 0.5;
      dz -= (z - 0.01) * cutT * 0.5;
      if (st !== 'cap' && st !== 'beanie') {
        const top = clamp((y - 1.74) / 0.07, 0, 1);
        dy += vol * top * 0.8;
        if (st === 'quiff') {
          dz += front * top * 0.016;
          dy += front * top * 0.01 * Math.max(0, 1 - Math.abs(x) / 0.06);
        }
        if (st === 'slick') dz -= top * 0.004;
      }
      if (st === 'beanie') {
        const top = clamp((y - 1.74) / 0.07, 0, 1);
        dy += top * 0.02;
      }
      return [dx, dy, dz];
    },
  });
  if (st === 'long' || st === 'bob' || st === 'ponytail') {
    // hair curtain at back/sides
    const len = st === 'long' ? 0.42 : st === 'bob' ? 0.13 : 0.0;
    if (len > 0) {
      const rr: Ring[] = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        const y = 1.7 - t * len;
        rr.push({ p: [0, y, -0.03 - t * 0.012 - Math.sin(t * 2) * 0.01], rx: 0.088 + t * 0.012 + (st === 'long' ? t * 0.035 : 0), rz: 0.082 - t * 0.032, bones: [[B.head, 1 - t * 0.8], [B.chest, t * 0.8]] });
      }
      mb.loft('hair', rr, {
        segs: 30, uv: 'cyl', uvScale: [3, 3], displace: (x, y, z) => {
          // open the front of the curtain so face stays visible
          const ang = Math.atan2(z + 0.03, x);
          const fr = Math.max(0, Math.sin(ang));
          return [x > 0 ? -fr * 0.0 : 0, 0, -fr * 0.12];
        },
      });
    } else {
      // ponytail
      const rr: Ring[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        rr.push({ p: [0, 1.76 - t * 0.28, -0.1 - Math.sin(t * 2.8) * 0.06], rx: 0.026 * (1 - t * 0.5) + 0.01, rz: 0.026 * (1 - t * 0.5) + 0.01, bones: [[B.head, 1 - t * 0.7], [B.chest, t * 0.7]] });
      }
      mb.loft('hair', rr, { segs: 12, uv: 'cyl', uvScale: [2, 6], capEnd: true });
    }
  }
  if (st === 'cap') {
    const cc = look.capColor ?? 0x2255aa;
    void cc;
    // brim
    mb.rigid('acc', new THREE.CylinderGeometry(0.1, 0.1, 0.004, 24, 1, false, -0.2, Math.PI + 0.4), matT(0, 1.738, 0.11, 0, Math.PI / 2 + Math.PI / 2 * 0 + 0, 0, 1, 1, 0.8), B.head);
  }
}

function buildClothes(mb: MeshBuilder, look: Look, torso: Key[]) {
  const t = look.top;
  const f = !!look.female;
  const fat = look.fat ?? 0;
  const long = t.long ?? false;
  // shirt layer: base garment is 'top' or 'under'
  const baseGroup = t.type === 'jacket' || t.type === 'vest' || t.type === 'suit' || t.type === 'uniform' ? 'under' : 'top';
  const hem = t.type === 'tank' ? 1.0 : t.type === 'hoodie' || t.type === 'jacket' ? 0.86 : 0.88;
  const bust = (x: number, y: number, z: number): [number, number, number] => {
    if (!f || z < 0.02) return [0, 0, 0];
    return [0, 0, gauss(Math.abs(x), y, z, 0.07, 1.285, 0.1, 0.06) * 0.03];
  };
  const belly = (x: number, y: number, z: number): [number, number, number] => {
    if (f || z < 0.02) return [0, 0, 0];
    return [0, 0, gauss(x, y, z, 0, 1.08, 0.12, 0.13) * 0.06 * fat + gauss(Math.abs(x), y, z, 0.075, 1.31, 0.105, 0.07) * 0.012];
  };
  const body = (x: number, y: number, z: number) => (f ? bust(x, y, z) : belly(x, y, z));

  // under shirt / tee
  mb.loft(baseGroup, span(torso, t.type === 'tank' ? 1.0 : 0.9, 1.5, 0.03, baseGroup === 'under' ? 0.006 : 0.012), { segs: 28, uv: 'cyl', uvScale: [3, 3], displace: body });
  if (t.type === 'tank') {
    // nothing else
  } else {
    // sleeves
    const sleeveEnd = long || t.type === 'hoodie' || t.type === 'jacket' || t.type === 'uniform' ? 0.9 : 1.27;
    for (const s of [1, -1]) {
      const mir = s < 0;
      mb.loft(baseGroup, span(ARM, 1.505, baseGroup === 'under' && long ? 0.9 : sleeveEnd, 0.03, 0.012, s, mir), { segs: 16, uv: 'cyl', uvScale: [2, 3], capStart: true });
    }
  }
  if (t.type === 'jacket' || t.type === 'hoodie' || t.type === 'suit' || t.type === 'uniform' || t.type === 'vest') {
    const infl = t.type === 'suit' ? 0.014 : t.type === 'jacket' ? 0.018 : t.type === 'hoodie' ? 0.018 : 0.016;
    const top = span(torso, hem, 1.505, 0.03, infl);
    top[top.length - 1].rx += 0.012;
    mb.loft('top', top, { segs: 30, uv: 'cyl', uvScale: [3, 3], displace: body });
    // collar
    mb.loft(t.type === 'jacket' ? 'top' : 'top2', [
      { p: [0, 1.5, 0.002], rx: 0.07, rz: 0.066, bones: [[B.neck, 1]] },
      { p: [0, 1.535, 0.0], rx: 0.062, rz: 0.062, bones: [[B.neck, 1]] },
      { p: [0, 1.555, -0.004], rx: 0.059, rz: 0.058, bones: [[B.neck, 0.6], [B.head, 0.4]] },
    ], { segs: 20, uv: 'cyl' });
    if (t.type === 'hoodie') {
      // hood bunched behind the neck
      mb.loft('top', [
        { p: [0, 1.5, -0.04], rx: 0.1, rz: 0.04, bones: [[B.chest, 1]] },
        { p: [0, 1.56, -0.075], rx: 0.1, rz: 0.055, bones: [[B.neck, 1]] },
        { p: [0, 1.6, -0.065], rx: 0.07, rz: 0.04, bones: [[B.neck, 1]] },
      ], { segs: 16, uv: 'cyl', capEnd: true });
    }
    if (long) {
      for (const s of [1, -1]) {
        const mir = s < 0;
        mb.loft('top', span(ARM, 1.505, 0.9, 0.03, t.type === 'jacket' ? 0.017 : 0.014, s, mir), { segs: 16, uv: 'cyl', uvScale: [2, 3], capStart: true });
        // cuff
        mb.loft('top2', span(ARM, 0.93, 0.9, 0.02, 0.02, s, mir), { segs: 16, uv: 'cyl' });
      }
    } else {
      for (const s of [1, -1]) {
        const mir = s < 0;
        mb.loft('top', span(ARM, 1.505, 1.25, 0.03, 0.016, s, mir), { segs: 16, uv: 'cyl', uvScale: [2, 3], capStart: true });
      }
    }
    // jacket hem rib / trim
    if (t.type === 'jacket') {
      mb.loft('top2', span(torso, 0.86, 0.9, 0.02, infl + 0.003), { segs: 30, uv: 'cyl' });
      // zipper line
      mb.box('metal', 0.006, 0.55, 0.004, 0, 1.18, 0.133 + fat * 0.04, B.chest);
    }
    if (t.type === 'suit') {
      // lapels + shirt V + tie
      for (const s of [1, -1]) mb.box('top2', 0.045, 0.2, 0.006, s * 0.05, 1.37, 0.121, B.chest, 0.08, 0, s * 0.35);
      mb.box('under', 0.06, 0.2, 0.004, 0, 1.38, 0.118, B.chest, 0.08);
    }
  } else if (t.type === 'shirt') {
    // collar
    mb.loft('under', [
      { p: [0, 1.5, 0.002], rx: 0.067, rz: 0.062, bones: [[B.neck, 1]] },
      { p: [0, 1.535, 0.0], rx: 0.062, rz: 0.06, bones: [[B.neck, 1]] },
    ], { segs: 20, uv: 'cyl' });
  }

  // pants
  const b = look.bottom;
  const hipTop = span(torso, 0.86, 1.01, 0.03, 0.018);
  mb.loft('bottom', hipTop, { capStart: true, segs: 28, uv: 'cyl', uvScale: [3, 2], displace: (x, y, z) => (!f && z > 0.02 ? [0, 0, gauss(x, y, z, 0, 1.08, 0.12, 0.13) * 0.06 * fat * Math.max(0, 1 - (y - 0.95) * 5)] : [0, 0, 0]) });
  const legEnd = b.type === 'shorts' ? 0.6 : b.type === 'skirt' ? 0.66 : 0.07;
  const legInfl = b.type === 'jeans' ? 0.01 : b.type === 'cargo' || b.type === 'track' ? 0.018 : 0.012;
  if (b.type === 'skirt') {
    mb.loft('bottom', [
      { p: [0, 1.0, 0], rx: 0.17, rz: 0.108, bones: [[B.hips, 1]] },
      { p: [0, 0.9, 0], rx: 0.2, rz: 0.13, bones: [[B.hips, 0.7], [B.thighL, 0.15], [B.thighR, 0.15]] },
      { p: [0, 0.78, 0], rx: 0.225, rz: 0.15, bones: [[B.hips, 0.5], [B.thighL, 0.25], [B.thighR, 0.25]] },
      { p: [0, 0.66, 0], rx: 0.24, rz: 0.16, bones: [[B.thighL, 0.5], [B.thighR, 0.5]] },
    ], { segs: 30, uv: 'cyl', uvScale: [3, 2] });
  } else {
    for (const s of [1, -1]) {
      const mir = s < 0;
      mb.loft('bottom', span(LEG, 0.99, legEnd, 0.03, legInfl, s, mir), { segs: 18, uv: 'cyl', uvScale: [2, 3] });
      if (b.type !== 'shorts') {
        // cuff / break over shoe
        mb.loft('bottom', span(LEG, 0.12, 0.07, 0.02, legInfl + 0.004, s, mir), { segs: 18, uv: 'cyl' });
      }
    }
  }
  mb.loft('belt', span(torso, 0.985, 1.01, 0.012, 0.022), { segs: 28, uv: 'cyl' });
  if (look.extras?.includes('belt') || b.type === 'jeans' || b.type === 'cargo') {
    mb.box('metal', 0.035, 0.028, 0.008, 0, 0.998, 0.131 + fat * 0.06, B.hips);
  }
  void legEnd;
}

function buildAccessories(mb: MeshBuilder, look: Look) {
  const ex = new Set(look.extras ?? []);
  const fat = look.fat ?? 0;
  if (ex.has('watch')) {
    mb.rigid('metal', new THREE.CylinderGeometry(0.036, 0.036, 0.012, 16, 1, true), matT(0.249, 0.89, 0, 0, 0, 0.0, 1, 1, 1), B.handL);
    mb.rigid('metal', new THREE.CylinderGeometry(0.021, 0.021, 0.008, 18), matT(0.249, 0.89, 0.034, Math.PI / 2, 0, 0), B.handL);
    mb.box('belt', 0.004, 0.01, 0.07, 0.288, 0.89, 0, B.handL);
  }
  if (ex.has('chain')) {
    const rings: Ring[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      rings.push({ p: [Math.cos(a) * 0.078, 1.43 - Math.max(0, Math.sin(a + 0.0)) * 0.0, Math.sin(a) * 0.078 + 0.01], rx: 0.0035, rz: 0.0035, bones: [[B.chest, 1]] });
    }
    // loop around the neck, hanging to the chest in front
    const pts: Ring[] = [];
    const N = 28;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const front = Math.max(0, Math.sin(a));
      pts.push({ p: [Math.cos(a) * (0.07 + front * 0.015), 1.49 - front * 0.1 * (1 - Math.abs(Math.cos(a))), 0.0 + Math.sin(a) * (0.072 + front * 0.045)], rx: 0.0032, rz: 0.0032, bones: [[B.chest, 1]] });
    }
    void pts;
    mb.rigid('metal', new THREE.TorusGeometry(0.075, 0.0032, 6, 32), matT(0, 1.47, 0.02, Math.PI / 2 - 0.35, 0, 0), B.chest);
    mb.rigid('metal', new THREE.SphereGeometry(0.011, 10, 8), matT(0, 1.375, 0.103 + fat * 0.01, 0, 0, 0, 1, 1.2, 0.6), B.chest);
  }
  if (ex.has('badge')) {
    mb.rigid('metal', new THREE.CylinderGeometry(0.014, 0.014, 0.004, 5), matT(0.07, 1.31, 0.118, Math.PI / 2, 0, 0), B.chest);
  }
  if (ex.has('vestarmor')) {
    const vk: Key[] = [
      { y: 1.0, rx: 0.17, rz: 0.11, w: W([1, 1]) },
      { y: 1.15, rx: 0.166, rz: 0.114, w: W([1, 0.5], [2, 0.5]) },
      { y: 1.3, rx: 0.186, rz: 0.12, w: W([2, 1]) },
      { y: 1.43, rx: 0.2, rz: 0.108, w: W([2, 1]) },
    ];
    mb.loft('acc', span(vk, 1.0, 1.43, 0.04, 0.0), { segs: 28, uv: 'cyl', uvScale: [3, 3], capStart: false });
    // pouches
    for (let k = -1; k <= 1; k += 2) mb.box('belt', 0.07, 0.09, 0.03, k * 0.06, 1.1, 0.14, B.chest);
    mb.box('belt', 0.12, 0.04, 0.02, 0, 1.26, 0.135, B.chest);
  }
  if (ex.has('tie')) {
    mb.box('top2', 0.024, 0.2, 0.008, 0, 1.33, 0.127 + fat * 0.03, B.chest, 0.05);
    mb.rigid('top2', new THREE.SphereGeometry(0.014, 10, 8), matT(0, 1.445, 0.119, 0, 0, 0, 1, 0.9, 0.8), B.chest);
  }
  if (ex.has('bandana')) {
    mb.loft('top2', [
      { p: [0, 1.716, 0.01], rx: 0.084, rz: 0.102, bones: [[B.head, 1]] },
      { p: [0, 1.73, 0.01], rx: 0.085, rz: 0.103, bones: [[B.head, 1]] },
    ], { segs: 28, uv: 'cyl' });
  }
  if (ex.has('helmet')) {
    mb.rigid('acc', new THREE.SphereGeometry(0.108, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), matT(0, 1.7, 0.008, 0, 0, 0, 1.0, 1.05, 1.15), B.head);
    mb.box('acc', 0.02, 0.025, 0.07, 0, 1.79, 0.0, B.head);
  }
  if (ex.has('mask')) {
    mb.rigid('acc', new THREE.SphereGeometry(0.095, 18, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.4), matT(0, 1.64, 0.02, 0, 0, 0, 0.98, 0.6, 1.1), B.head);
  }
  if (ex.has('earpiece')) {
    mb.rigid('acc', new THREE.SphereGeometry(0.008, 8, 6), matT(0.08, 1.68, 0.0), B.head);
  }
  if (ex.has('gloves')) {
    for (const [s, hb] of [[1, B.handL], [-1, B.handR]] as const) {
      mb.rigid('belt', new THREE.BoxGeometry(0.05, 0.1, 0.1), matT(0.252 * s + 0.002 * s, 0.8, 0.0), hb);
    }
  }
  if (look.hairStyle === 'cap' || ex.has('cap')) {
    const cc = look.capColor ?? 0x2255aa;
    void cc;
    const dome = new THREE.SphereGeometry(0.105, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.52);
    mb.rigid(look.hairStyle === 'cap' ? 'top2' : 'acc', dome, matT(0, 1.69, 0.008, 0, 0, 0, 0.99, 1.0, 1.1), B.head);
    mb.rigid(look.hairStyle === 'cap' ? 'top2' : 'acc', new THREE.CylinderGeometry(0.098, 0.098, 0.004, 22, 1, false, -Math.PI * 0.45, Math.PI * 0.9), matT(0, 1.738, 0.095, 0.05, 0, 0, 1.0, 1, 0.95), B.head);
  }
  if (look.hairStyle === 'beanie') {
    mb.rigid('belt', new THREE.SphereGeometry(0.108, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), matT(0, 1.69, 0.008, 0, 0, 0, 1, 1.0, 1.1), B.head);
  }
  // glasses
  if (look.glasses && look.glasses !== 'none') {
    const g = look.glasses;
    for (const s of [-1, 1]) {
      const lens = g === 'round' ? new THREE.CircleGeometry(0.02, 18) : new THREE.CircleGeometry(0.022, 4);
      const m = matT(s * 0.032, EYE_Y + 0.0, 0.109, 0, 0, g === 'round' ? 0 : Math.PI / 4, g === 'round' ? 1 : 1.15, g === 'aviator' ? 1.15 : 0.8, 1);
      mb.rigid('glass', lens, m, B.head);
      mb.rigid('glass', lens, matT(s * 0.032, EYE_Y, 0.1091, 0, Math.PI, g === 'round' ? 0 : Math.PI / 4, g === 'round' ? 1 : 1.15, g === 'aviator' ? 1.15 : 0.8, 1), B.head);
      mb.rigid('metal', new THREE.TorusGeometry(g === 'round' ? 0.02 : 0.0205, 0.0014, 6, g === 'round' ? 20 : 4), matT(s * 0.032, EYE_Y, 0.109, 0, 0, g === 'round' ? 0 : Math.PI / 4, g === 'round' ? 1 : 1.15, g === 'aviator' ? 1.15 : 0.8, 1), B.head);
      mb.box('metal', 0.0025, 0.0025, 0.09, s * 0.0745, EYE_Y + 0.004, 0.062, B.head);
    }
    mb.box('metal', 0.014, 0.003, 0.003, 0, EYE_Y + 0.004, 0.109, B.head);
  }
}

// ---------------------------------------------------------------- the animated character
export type WeaponClass = 'none' | 'pistol' | 'twohand' | 'melee';
export interface HumanState {
  vf: number; // forward speed (m/s, signed, relative to facing)
  vs: number; // sideways speed (+ = left)
  aim: boolean;
  aimPitch: number; // radians, + = looking down
  stance: 'stand' | 'crouch' | 'sit' | 'drive';
  air: boolean;
  steer: number; // -1..1 steering wheel
  weapon: WeaponClass;
  talk: boolean;
  panic: boolean;
  phone?: boolean;
  lookX?: number; lookY?: number; // head turn (yaw, pitch) radians
  dead?: boolean;
}
export const defaultState = (): HumanState => ({ vf: 0, vs: 0, aim: false, aimPitch: 0, stance: 'stand', air: false, steer: 0, weapon: 'none', talk: false, panic: false });

type V3a = [number, number, number];

export class Human {
  root = new THREE.Group();
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[] = [];
  skeleton: THREE.Skeleton;
  height: number;
  onStep?: (side: number) => void;
  look: Look;
  holder = new THREE.Group();
  weaponObj: THREE.Object3D | null = null;
  phase = Math.random() * 6;
  private pose: V3a[] = BONE_NAMES.map(() => [0, 0, 0] as V3a);
  private tgt: V3a[] = BONE_NAMES.map(() => [0, 0, 0] as V3a);
  private hipsY = 0.97;
  private lastSin = 0;
  private attackT = 0;
  private attackKind = 0;
  private recoil = 0;
  private flinchT = 0;
  private flinchDir = 1;
  private deadT = 0;
  private breath = Math.random() * 10;
  private blinkT = 2 + Math.random() * 3;
  private blink = 0;
  private talkT = Math.random() * 10;
  dead = false;
  lying = false;
  rootPitch = 0;
  rootDrop = 0;
  sitDrop = 0.43;

  constructor(look: Look) {
    this.look = look;
    const key = `${look.name}|${look.skin}|${look.hair}|${look.hairStyle}|${look.top.type}|${look.top.color}|${look.bottom.type}|${look.bottom.color}|${look.shoes.color}|${look.female}|${look.height}|${look.build}|${look.fat}|${look.glasses}|${look.beard}|${look.stubble}|${look.extras?.join(',')}|${look.eye}|${look.capColor}`;
    let built = geoCache.get(key);
    if (!built) {
      built = buildBody(look);
      geoCache.set(key, built);
    }
    for (let i = 0; i < BONE_NAMES.length; i++) {
      const b = new THREE.Bone();
      b.name = BONE_NAMES[i];
      const par = PARENT[i];
      const pr = par >= 0 ? REST[par] : [0, 0, 0];
      b.position.set(REST[i][0] - pr[0], REST[i][1] - pr[1], REST[i][2] - pr[2]);
      this.bones.push(b);
      if (par >= 0) this.bones[par].add(b);
    }
    const rootBone = this.bones[0];
    this.root.add(rootBone);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.mesh = new THREE.SkinnedMesh(built.geometry, built.materials);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.mesh.bind(this.skeleton);
    this.height = look.height ?? 1;
    this.root.scale.setScalar(this.height);
    // weapon holder
    this.holder.rotation.x = Math.PI / 2;
    this.holder.position.set(0, -0.05, 0.02);
    this.bones[B.handR].add(this.holder);
  }

  setWeapon(obj: THREE.Object3D | null) {
    if (this.weaponObj) this.holder.remove(this.weaponObj);
    this.weaponObj = obj;
    if (obj) this.holder.add(obj);
  }

  /** attach any object to a bone */
  attach(bone: number, obj: THREE.Object3D) {
    this.bones[bone].add(obj);
  }

  get headWorldY() {
    return this.root.position.y + 1.7 * this.height;
  }

  punch() {
    this.attackT = 0.001;
    this.attackKind = (this.attackKind + 1) % 3;
  }
  shoot() {
    this.recoil = 1;
  }
  flinch(dir = 1) {
    this.flinchT = 0.35;
    this.flinchDir = dir;
  }
  die() {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
  }
  revive() {
    this.dead = false;
    this.lying = false;
    this.rootPitch = 0;
    this.rootDrop = 0;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.deadT = 0;
  }
  get attacking() {
    return this.attackT > 0;
  }
  get attackProgress() {
    return this.attackT / 0.38;
  }

  private S(b: number, x: number, y = 0, z = 0) {
    const t = this.tgt[b];
    t[0] = x; t[1] = y; t[2] = z;
  }

  update(dt: number, st: HumanState) {
    dt = Math.min(dt, 0.05);
    for (const t of this.tgt) { t[0] = 0; t[1] = 0; t[2] = 0; }
    this.breath += dt;
    this.talkT += dt;
    this.recoil = Math.max(0, this.recoil - dt * 9);
    if (this.attackT > 0) {
      this.attackT += dt;
      if (this.attackT > 0.38) this.attackT = 0;
    }
    if (this.flinchT > 0) this.flinchT -= dt;

    const sp = Math.hypot(st.vf, st.vs);
    const run = clamp((sp - 2.2) / 3.5, 0, 1);
    const moving = clamp(sp / 1.2, 0, 1);
    let hipsY = 0.97, hipsZ = 0;
    this.hipsY = hipsY;

    // ---- locomotion
    if (st.stance === 'sit' || st.stance === 'drive') {
      this.poseSit(st);
      hipsY = 0.97 - this.sitDrop;
    } else if (this.dead || this.lying) {
      this.poseDead(dt);
    } else {
      const crouch = st.stance === 'crouch';
      const dirSign = st.vf < -0.2 ? -1 : 1;
      const stride = (1.75 + run * 1.2) * 0.75;
      this.phase += dt * (sp * stride / 0.9) * (st.air ? 0 : 1) * (dirSign < 0 && Math.abs(st.vf) > Math.abs(st.vs) ? -1 : 1);
      const ph = this.phase;
      const amp = (0.38 + run * 0.62) * moving * (crouch ? 0.6 : 1);
      const s1 = Math.sin(ph), s2 = Math.sin(ph + Math.PI);
      const k1 = Math.max(0, Math.cos(ph + 0.2)), k2 = Math.max(0, Math.cos(ph + Math.PI + 0.2));
      const fwdW = Math.abs(st.vf) >= Math.abs(st.vs) ? 1 : 0.3;
      const sideW = 1 - fwdW;
      this.S(B.thighL, -s1 * amp * fwdW * (st.vf < -0.2 ? -1 : 1) * 0.0 - s1 * amp * fwdW, 0, sideW * Math.abs(s1) * 0.25 * moving + 0.03);
      this.S(B.thighR, -s2 * amp * fwdW, 0, -sideW * Math.abs(s2) * 0.25 * moving - 0.03);
      this.S(B.shinL, (0.12 + k1 * (0.5 + run * 1.0)) * moving + (crouch ? 1.0 : 0));
      this.S(B.shinR, (0.12 + k2 * (0.5 + run * 1.0)) * moving + (crouch ? 1.0 : 0));
      this.S(B.footL, s1 * amp * 0.25 * moving - 0.0 + (crouch ? -0.3 : 0), 0, 0);
      this.S(B.footR, s2 * amp * 0.25 * moving + (crouch ? -0.3 : 0), 0, 0);
      if (crouch) {
        this.S(B.thighL, this.tgt[B.thighL][0] - 0.9, 0, 0.05);
        this.S(B.thighR, this.tgt[B.thighR][0] - 0.9, 0, -0.05);
        this.tgt[B.footL][0] += -0.1;
        hipsY = 0.78;
        hipsZ = -0.05;
      } else {
        hipsY = 0.97 - (0.02 + run * 0.02) * moving - Math.abs(Math.cos(ph)) * (0.02 + run * 0.03) * moving;
      }
      const lean = (run * 0.2 + moving * 0.04) * (dirSign > 0 ? 1 : -0.3) + (crouch ? 0.35 : 0);
      this.S(B.spine, lean * 0.5, -Math.sin(ph) * 0.1 * amp * fwdW, Math.sin(ph) * 0.03 * moving);
      this.S(B.chest, lean * 0.5, Math.sin(ph) * 0.14 * amp * fwdW, 0);
      // idle breathing + weight shift
      const br = Math.sin(this.breath * 1.8);
      this.tgt[B.chest][0] += br * 0.012;
      this.tgt[B.spine][2] += Math.sin(this.breath * 0.5) * 0.012 * (1 - moving);
      this.S(B.head, -lean * 0.8 + Math.sin(this.breath * 0.4) * 0.02 * (1 - moving));
      // arms swing
      if (st.panic) {
        this.S(B.uArmL, -2.3 + Math.sin(this.phase * 2) * 0.3, 0, 0.3);
        this.S(B.uArmR, -2.3 + Math.cos(this.phase * 2) * 0.3, 0, -0.3);
        this.S(B.fArmL, -1.0);
        this.S(B.fArmR, -1.0);
      } else {
        const aa = (0.28 + run * 0.9) * moving * fwdW;
        this.S(B.uArmL, s2 * aa + br * 0.01, 0, 0.1 + run * 0.1 + (1 - moving) * 0.02);
        this.S(B.uArmR, s1 * aa - br * 0.01, 0, -0.1 - run * 0.1 - (1 - moving) * 0.02);
        this.S(B.fArmL, -(0.15 + run * 1.1) * moving - 0.1 - Math.max(0, s2) * 0.25 * moving);
        this.S(B.fArmR, -(0.15 + run * 1.1) * moving - 0.1 - Math.max(0, s1) * 0.25 * moving);
      }
      // airborne
      if (st.air) {
        this.S(B.thighL, -0.7, 0, 0.1);
        this.S(B.thighR, -0.1, 0, -0.1);
        this.S(B.shinL, 1.1);
        this.S(B.shinR, 0.5);
        this.S(B.uArmL, -0.6, 0, 0.7);
        this.S(B.uArmR, -0.6, 0, -0.7);
      }
      // footsteps
      const sn = Math.sin(ph);
      if (!st.air && moving > 0.3 && Math.sign(sn) !== Math.sign(this.lastSin) && this.lastSin !== 0) this.onStep?.(sn > 0 ? 1 : -1);
      this.lastSin = sn;

      // talking gestures
      if (st.talk && !st.aim) {
        const t = this.talkT;
        this.S(B.uArmR, -0.55 + Math.sin(t * 2.2) * 0.2, 0, -0.35 + Math.sin(t * 1.7) * 0.12);
        this.S(B.fArmR, -1.1 + Math.sin(t * 3.1) * 0.35, 0.4, 0);
        this.S(B.uArmL, -0.35 + Math.sin(t * 1.9 + 1) * 0.15, 0, 0.25);
        this.S(B.fArmL, -0.7 + Math.sin(t * 2.7) * 0.25);
        this.tgt[B.head][0] += Math.sin(t * 3.3) * 0.05;
        this.tgt[B.head][1] += Math.sin(t * 1.1) * 0.12;
      }
      if (st.phone) {
        this.S(B.uArmR, -1.1, 0, -0.5);
        this.S(B.fArmR, -2.05, 0.4, 0.2);
        this.S(B.handR, 0, 0, -0.3);
        this.tgt[B.head][2] += 0.1;
      }
      // aiming overrides
      this.poseAim(st, dt);
      // melee swing
      this.poseAttack();
    }
    if (!(this.dead || this.lying) && this.flinchT > 0) {
      const k = this.flinchT / 0.35;
      this.tgt[B.spine][0] -= 0.3 * k;
      this.tgt[B.chest][2] += 0.2 * k * this.flinchDir;
      this.tgt[B.head][0] -= 0.25 * k;
    }
    // look at / head turn
    if (!this.dead) {
      this.tgt[B.head][1] += (st.lookX ?? 0) * 0.6;
      this.tgt[B.neck][1] += (st.lookX ?? 0) * 0.4;
      this.tgt[B.head][0] += (st.lookY ?? 0) * 0.6;
      this.tgt[B.neck][0] += (st.lookY ?? 0) * 0.3;
    }

    // ---- smooth pose and apply
    const k = 1 - Math.exp(-dt * (st.aim || this.attackT > 0 ? 22 : 14));
    for (let i = 0; i < this.pose.length; i++) {
      const p = this.pose[i], t = this.tgt[i];
      p[0] += (t[0] - p[0]) * k;
      p[1] += (t[1] - p[1]) * k;
      p[2] += (t[2] - p[2]) * k;
      this.bones[i].rotation.set(p[0], p[1], p[2]);
    }
    this.hipsY = damp(this.hipsY, hipsY, 14, dt);
    this.bones[0].position.set(0, this.hipsY - this.rootDrop, hipsZ);
    this.root.rotation.x = this.rootPitch;

    // blink
    this.blinkT -= dt;
    if (this.blinkT < 0) {
      this.blink = 0.14;
      this.blinkT = 2 + Math.random() * 4;
    }
    if (this.blink > 0) this.blink -= dt;
  }

  private poseSit(st: HumanState) {
    this.S(B.thighL, -1.5, 0, 0.12);
    this.S(B.thighR, -1.5, 0, -0.12);
    this.S(B.shinL, 1.45);
    this.S(B.shinR, 1.35);
    this.S(B.footL, 0.1);
    this.S(B.footR, 0.1);
    this.S(B.spine, -0.1);
    this.S(B.chest, -0.05);
    if (st.stance === 'drive') {
      const sw = st.steer * 0.9;
      this.S(B.uArmL, -1.15, 0.1 + sw * 0.1, 0.12 + Math.max(0, -sw) * 0.2);
      this.S(B.uArmR, -1.15, -0.1 + sw * 0.1, -0.12 - Math.max(0, sw) * 0.2);
      this.S(B.fArmL, -0.7 + sw * 0.4);
      this.S(B.fArmR, -0.7 - sw * 0.4);
      this.S(B.handL, 0, 0, 0.2);
      this.S(B.handR, 0, 0, -0.2);
      this.tgt[B.spine][1] = sw * 0.08;
      this.tgt[B.head][1] = -sw * 0.25;
    } else {
      this.S(B.uArmL, -0.3, 0, 0.1);
      this.S(B.uArmR, -0.3, 0, -0.1);
      this.S(B.fArmL, -0.6);
      this.S(B.fArmR, -0.6);
    }
  }

  private poseDead(dt: number) {
    this.deadT += dt;
    const t = clamp(this.deadT / 0.7, 0, 1);
    const e = t * t * (3 - 2 * t);
    this.rootPitch = -e * (Math.PI / 2 - 0.05);
    this.rootDrop = 0;
    this.S(B.thighL, -0.3 * e, 0, 0.2 * e);
    this.S(B.thighR, 0.1 * e, 0, -0.35 * e);
    this.S(B.shinL, 0.5 * e);
    this.S(B.shinR, 0.2 * e);
    this.S(B.uArmL, -0.2 * e, 0, 0.9 * e);
    this.S(B.uArmR, 0.2 * e, 0, -0.7 * e);
    this.S(B.fArmL, -0.4 * e);
    this.S(B.fArmR, -0.2 * e);
    this.S(B.head, 0.1 * e, 0.4 * e, 0.2 * e);
    if (t >= 1) this.lying = true;
  }

  private poseAim(st: HumanState, dt: number) {
    void dt;
    if (st.weapon === 'none' || st.weapon === 'melee') {
      if (!st.aim) return;
    }
    const aimOn = st.aim && (st.weapon === 'pistol' || st.weapon === 'twohand');
    const carry = !st.aim && (st.weapon === 'pistol' || st.weapon === 'twohand');
    const pitch = st.aimPitch;
    const rc = this.recoil;
    if (aimOn) {
      this.tgt[B.spine][0] += pitch * 0.35;
      this.tgt[B.chest][0] += pitch * 0.35;
      this.tgt[B.spine][1] += -0.35; // body angled
      this.tgt[B.chest][1] += 0.15;
      this.tgt[B.head][0] += pitch * 0.25 - 0.1;
      this.tgt[B.head][1] += 0.2;
      if (st.weapon === 'pistol') {
        this.S(B.uArmR, -1.52 - rc * 0.12, 0.28, -0.05);
        this.S(B.fArmR, -0.06 - rc * 0.1);
        this.S(B.handR, 0, 0, 0);
        this.S(B.uArmL, -1.35, -0.3, 0.55);
        this.S(B.fArmL, -0.9);
      } else {
        this.S(B.uArmR, -1.32 - rc * 0.1, 0.3, 0.0);
        this.S(B.fArmR, -0.85);
        this.S(B.uArmL, -1.4, -0.55, 0.45);
        this.S(B.fArmL, -0.55);
      }
    } else if (carry) {
      if (st.weapon === 'pistol') {
        this.S(B.uArmR, -0.55, 0.1, -0.1);
        this.S(B.fArmR, -0.95);
      } else {
        this.S(B.uArmR, -0.6, 0.2, -0.05);
        this.S(B.fArmR, -1.0);
        this.S(B.uArmL, -0.7, -0.5, 0.35);
        this.S(B.fArmL, -1.0);
      }
    }
  }

  private poseAttack() {
    if (this.attackT <= 0) return;
    const t = clamp(this.attackT / 0.38, 0, 1);
    const w = Math.sin(t * Math.PI);
    const left = this.attackKind % 2 === 1;
    const ua = left ? B.uArmL : B.uArmR, fa = left ? B.fArmL : B.fArmR;
    this.tgt[B.chest][1] += (left ? 1 : -1) * w * 0.6;
    this.tgt[B.spine][1] += (left ? 1 : -1) * w * 0.3;
    this.tgt[B.spine][0] += 0.12 * w;
    this.S(ua, -1.45 * w - 0.2, left ? -0.2 : 0.2, 0);
    this.S(fa, -0.2 - (1 - w) * 1.5);
    this.S(left ? B.uArmR : B.uArmL, -0.8, 0, 0.1);
    this.S(left ? B.fArmR : B.fArmL, -1.5);
    if (this.attackKind === 2) {
      this.tgt[B.thighL][0] -= w * 1.3;
      this.tgt[B.shinL][0] += w * 0.3;
      this.tgt[B.spine][0] -= 0.2 * w;
    }
  }

  dispose() {
    // geometry/materials are shared & cached
  }
}
