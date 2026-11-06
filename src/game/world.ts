import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  FACADE_H, FACADE_W, asphaltTex, concreteTex, crosswalkTex, facadeTex, grassTex, roadTex, roofTex, sandTex, sidewalkTex, signTex, waterNormal, type FacadeKind,
} from './textures';
import { mulberry32, pick, range, type RNG } from './util';
import { patchWet } from './wet';
import { dressBuilding } from './arch';
import { buildStreetDressing } from './street';
import { createWater, updateWater } from './water';
import { frondTexture, makeCrownGeometry, makeGlow, makeMountainGeometry, makePalmGeometries, makeTankGeometry, makeTrunkGeometry, patchFoliage, windUniform } from './props';
import type { Sky } from './sky';

export const N = 8; // blocks per side
export const P = 120; // pitch (block + road)
export const ROAD_W = 16;
export const PAD = P - ROAD_W; // block pad size 104
export const HALF = (N * P) / 2; // 480
export const FLOOR_H = FACADE_H / 4; // 3.6
export const LANE = [2.1, 5.7];

export interface Box { x0: number; x1: number; z0: number; z1: number; h: number; id: number }
export interface Circle { x: number; z: number; r: number; h: number }
export interface POI { id: string; name: string; x: number; z: number; r: number; icon: string; color: string; kind: 'shop' | 'mission' | 'service' | 'story' | 'home' }
export interface Ramp { x: number; z: number; w: number; l: number; h: number; dir: number }
export interface Hit { x: number; z: number; nx: number; nz: number; hit: boolean }

export const nodePos = (i: number, j: number) => ({ x: (i - N / 2) * P, z: (j - N / 2) * P });
export const blockCenter = (i: number, j: number) => ({ x: (i - (N - 1) / 2) * P, z: (j - (N - 1) / 2) * P });

class Acc {
  pos: number[] = []; nrm: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  vcol = false;
  quad(a: number[], b: number[], c: number[], d: number[], uvs?: number[][], color?: THREE.Color) {
    const base = this.pos.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
      if (color) this.col.push(color.r, color.g, color.b);
    }
    const u = uvs ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const t of u) this.uv.push(t[0], t[1]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(a: number[], b: number[], c: number[], color?: THREE.Color) {
    const base = this.pos.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
      this.uv.push(0, 0);
      if (color) this.col.push(color.r, color.g, color.b);
    }
    this.idx.push(base, base + 1, base + 2);
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.Color) {
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y0 = y, y1 = y + h;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], undefined, color);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], undefined, color);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], undefined, color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], undefined, color);
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], undefined, color);
  }
  build() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

type Zone = 'downtown' | 'commercial' | 'residential' | 'industrial' | 'park' | 'beach';
interface Special { name: string; kind: string; w: number; d: number; floors: number; color: number; facade: FacadeKind; icon: string; poiKind: POI['kind']; sign: string; signBg: string; signFg: string; id: string; roof?: boolean }

const C = (h: number) => new THREE.Color(h);

export class World {
  group = new THREE.Group();
  boxes: Box[] = [];
  circles: Circle[] = [];
  ramps: Ramp[] = [];
  pois: POI[] = [];
  hash = new Map<number, { b: Box[]; c: Circle[] }>();
  facadeMats: THREE.MeshStandardMaterial[] = [];
  lampPos: THREE.Vector3[] = [];
  lampLights: THREE.PointLight[] = [];
  neon: THREE.MeshBasicMaterial[] = [];
  signMats: THREE.MeshStandardMaterial[] = [];
  lampMat!: THREE.MeshStandardMaterial;
  water!: THREE.Mesh;
  sea!: THREE.Mesh;
  tlights: { i: number; j: number; mesh: THREE.InstancedMesh; axis: number[] }[] = [];
  tlMesh!: THREE.InstancedMesh;
  tlInfo: { i: number; j: number; axis: number; slot: number }[] = [];
  rng: RNG;
  private bid = 0;
  zones: Zone[][] = [];
  specialAt = new Map<string, Special>();
  spawnPoints: { x: number; z: number; h: number }[] = [];
  sidewalkPts: { x: number; z: number }[] = [];
  private tlDummy = new THREE.Object3D();
  private nightF = 0;
  glow!: THREE.Points;
  aviation!: THREE.Points;
  private aviationPts: THREE.Vector3[] = [];
  private tankPts: { x: number; y: number; z: number; r: number }[] = [];
  private detailRng = mulberry32(777);

  constructor(seed = 20260517) {
    this.rng = mulberry32(seed);
    this.layoutZones();
    this.buildGround();
    this.buildRoads();
    this.buildBlocks();
    this.buildProps();
    buildStreetDressing(this);
    this.buildSea();
    this.buildSurroundings();
    this.buildRamps();
    this.buildLampLights();
  }

  // ---------------------------------------------------------------- zoning
  private layoutZones() {
    const c = (N - 1) / 2;
    for (let i = 0; i < N; i++) {
      this.zones[i] = [];
      for (let j = 0; j < N; j++) {
        const d = Math.max(Math.abs(i - c), Math.abs(j - c));
        let z: Zone = d <= 1 ? 'downtown' : d <= 2 ? 'commercial' : 'residential';
        if (j >= N - 2 && i >= 1 && i <= 4) z = 'industrial';
        if (i === N - 1) z = 'beach';
        if ((i === 2 && j === 1) || (i === 5 && j === 5)) z = 'park';
        this.zones[i][j] = z;
      }
    }
    const S = (i: number, j: number, s: Special) => {
      this.specialAt.set(`${i},${j}`, s);
      this.zones[i][j] = this.zones[i][j] === 'beach' ? 'beach' : this.zones[i][j];
    };
    S(3, 3, { id: 'club', name: 'Neon Lotus', kind: 'club', w: 56, d: 46, floors: 5, color: 0x2a1030, facade: 'concrete', icon: '♛', poiKind: 'story', sign: 'NEON LOTUS', signBg: '#14061c', signFg: '#ff3fd0', roof: true });
    S(5, 4, { id: 'garage', name: "Jimmy's Auto", kind: 'garage', w: 50, d: 40, floors: 2, color: 0x2d5fa8, facade: 'concrete', icon: '🔧', poiKind: 'service', sign: "JIMMY'S AUTO", signBg: '#0e1a2c', signFg: '#ffd23a' });
    S(2, 3, { id: 'ammu', name: 'Gun Club', kind: 'shop', w: 38, d: 30, floors: 2, color: 0x6a4a2a, facade: 'brick', icon: '🔫', poiKind: 'shop', sign: 'GUN CLUB', signBg: '#1a1208', signFg: '#ff6a2a' });
    S(4, 2, { id: 'burger', name: 'Burger Shot', kind: 'shop', w: 36, d: 28, floors: 2, color: 0xb02a20, facade: 'shop', icon: '🍔', poiKind: 'shop', sign: 'BURGER SHOT', signBg: '#a01810', signFg: '#ffe040' });
    S(4, 4, { id: 'police', name: 'Police HQ', kind: 'police', w: 64, d: 44, floors: 4, color: 0x5a6a8a, facade: 'office', icon: '★', poiKind: 'service', sign: 'POLICE', signBg: '#0b1630', signFg: '#8ab4ff' });
    S(1, 4, { id: 'hospital', name: 'St. Mary Hospital', kind: 'hospital', w: 70, d: 50, floors: 6, color: 0xdddddd, facade: 'office', icon: '✚', poiKind: 'service', sign: 'HOSPITAL', signBg: '#f4f4f4', signFg: '#d01818' });
    S(6, 2, { id: 'spray', name: "Pay'n'Spray", kind: 'garage', w: 42, d: 32, floors: 2, color: 0xe0a010, facade: 'concrete', icon: '🎨', poiKind: 'service', sign: "PAY'N'SPRAY", signBg: '#f0c010', signFg: '#101010' });
    S(2, 5, { id: 'home', name: 'Safehouse', kind: 'home', w: 36, d: 28, floors: 4, color: 0xd8c9a8, facade: 'apartment', icon: '⌂', poiKind: 'home', sign: 'SAFEHOUSE', signBg: '#101820', signFg: '#4ad0ff' });
    S(3, 5, { id: 'dealer', name: 'Premium Motors', kind: 'dealer', w: 54, d: 34, floors: 2, color: 0xbfc4cc, facade: 'glass', icon: '🚗', poiKind: 'shop', sign: 'PREMIUM MOTORS', signBg: '#0c0c10', signFg: '#e8e8f0' });
    S(5, 3, { id: 'bank', name: 'Union Bank', kind: 'bank', w: 46, d: 40, floors: 6, color: 0xc8c2b0, facade: 'concrete', icon: '$', poiKind: 'mission', sign: 'UNION BANK', signBg: '#101c14', signFg: '#6aff9a' });
  }

  // ---------------------------------------------------------------- ground
  private buildGround() {
    const grass = grassTex();
    const tex = grass.map;
    const GW = HALF + 30 + 2000;
    tex.repeat.set(220 * GW / 4000, 220);
    grass.normal!.repeat.set(220 * GW / 4000, 220);
    const gmat = new THREE.MeshStandardMaterial({ map: tex, normalMap: grass.normal, roughness: 1, color: 0xb8c8a0 });
    const g = new THREE.Mesh(new THREE.PlaneGeometry(GW, 4000), gmat);
    g.rotation.x = -Math.PI / 2;
    g.position.set((-2000 + HALF + 30) / 2, -0.05, 0);
    g.receiveShadow = true;
    this.group.add(g);
  }

  private buildRoads() {
    const r = roadTex();
    const rm = r.map.clone(); rm.repeat.set(1, (N * P + 40) / 12); rm.needsUpdate = true;
    const rn = r.normal!.clone(); rn.repeat.set(2, (N * P) / 12 * 1.0); rn.needsUpdate = true;
    const mat = patchWet(new THREE.MeshStandardMaterial({ map: rm, normalMap: rn, roughness: 0.82, metalness: 0.0, normalScale: new THREE.Vector2(0.8, 0.8) }));
    const len = N * P + ROAD_W;
    // v-direction texture is along road length; same texture clones for the perpendicular roads (rotated geometry)
    for (let k = 0; k <= N; k++) {
      const pos = (k - N / 2) * P;
      const a = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, len), mat);
      a.rotation.x = -Math.PI / 2;
      a.position.set(pos, 0.005, 0);
      a.receiveShadow = true;
      this.group.add(a);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, len), mat);
      b.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      b.position.set(0, 0.0045, pos);
      b.receiveShadow = true;
      this.group.add(b);
    }
    // intersections: plain asphalt squares + crosswalks
    const at = asphaltTex();
    const am = at.map.clone(); am.repeat.set(4, 4); am.needsUpdate = true;
    const an = at.normal!.clone(); an.repeat.set(8, 8); an.needsUpdate = true;
    const imat = patchWet(new THREE.MeshStandardMaterial({ map: am, normalMap: an, roughness: 0.82 }));
    const inter = new THREE.InstancedMesh(new THREE.PlaneGeometry(ROAD_W, ROAD_W), imat, (N + 1) * (N + 1));
    const cwTex = crosswalkTex();
    const cwMat = patchWet(new THREE.MeshStandardMaterial({ map: cwTex, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 0.6);
    const cw = new THREE.InstancedMesh(new THREE.PlaneGeometry(ROAD_W - 1, 3.2), cwMat, (N + 1) * (N + 1) * 4);
    const d = new THREE.Object3D();
    let n = 0, m = 0;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const p = nodePos(i, j);
      d.position.set(p.x, 0.012, p.z);
      d.rotation.set(-Math.PI / 2, 0, 0);
      d.updateMatrix();
      inter.setMatrixAt(n++, d.matrix);
      for (let s = 0; s < 4; s++) {
        const a = (s * Math.PI) / 2;
        const off = ROAD_W / 2 + 2.4;
        d.position.set(p.x + Math.sin(a) * off, 0.016, p.z + Math.cos(a) * off);
        d.rotation.set(-Math.PI / 2, 0, a);
        d.updateMatrix();
        cw.setMatrixAt(m++, d.matrix);
      }
    }
    inter.receiveShadow = true;
    this.group.add(inter, cw);
  }

  // ---------------------------------------------------------------- buildings
  private facades = new Map<string, THREE.MeshStandardMaterial>();
  private facadeMat(kind: FacadeKind, variant: number) {
    const key = `${kind}${variant}`;
    let m = this.facades.get(key);
    if (!m) {
      const t = facadeTex(kind, variant);
      m = new THREE.MeshStandardMaterial({
        map: t.map, normalMap: t.normal, roughnessMap: t.rough, metalnessMap: t.rough, roughness: 1, metalness: kind === 'glass' ? 0.9 : 0.5,
        emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 0, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: kind === 'glass' ? 1.8 : 1,
      });
      this.facades.set(key, m);
      this.facadeMats.push(m);
    }
    return m;
  }

  private buildBlocks() {
    const accs = new Map<string, Acc>(); // key: chunk|mat
    const get = (cx: number, cz: number, mat: string) => {
      const k = `${cx}|${cz}|${mat}`;
      let a = accs.get(k);
      if (!a) { a = new Acc(); accs.set(k, a); }
      return a;
    };
    const pad = new Acc(), padG = new Acc(), padP = new Acc(), padS = new Acc();
    const rng = this.rng;

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const { x: cx, z: cz } = blockCenter(i, j);
        const zone = this.zones[i][j];
        const chunkX = Math.floor(i / 3), chunkZ = Math.floor(j / 3);
        const sp = this.specialAt.get(`${i},${j}`);
        // sidewalk pad
        const h = 0.16, s = PAD / 2;
        pad.box(cx, 0, cz, PAD, h, PAD, C(0xffffff));
        // lot surface (inner)
        const lot = PAD - 8;
        const lotAcc = zone === 'park' || zone === 'residential' ? padG : zone === 'beach' ? padS : zone === 'industrial' ? padP : padP;
        const lh = 0.17;
        lotAcc.quad([cx - lot / 2, lh, cz + lot / 2], [cx + lot / 2, lh, cz + lot / 2], [cx + lot / 2, lh, cz - lot / 2], [cx - lot / 2, lh, cz - lot / 2], [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => [u * lot / 8, v * lot / 8]));
        // pad uv fix handled in material repeat; boxes use uv 0..1 so scale later
        void s;
        const lx0 = cx - lot / 2, lx1 = cx + lot / 2, lz0 = cz - lot / 2, lz1 = cz + lot / 2;

        if (zone === 'park') { this.buildPark(i, j, cx, cz, lot); continue; }
        if (zone === 'beach') { this.buildBeach(i, j, cx, cz, lot); continue; }

        const addBuilding = (x0: number, z0: number, w: number, d: number, floors: number, kind: FacadeKind, variant: number, sp2?: Special, gable = false) => {
          const bx = x0 + w / 2, bz = z0 + d / 2;
          const hh = floors * FLOOR_H;
          const mat = `f-${kind}-${variant}`;
          const acc = get(chunkX, chunkZ, mat);
          const uo = Math.floor(rng() * 4);
          // walls
          const wall = (ax: number, az: number, bx2: number, bz2: number, len: number) => {
            acc.quad([ax, 0, az], [bx2, 0, bz2], [bx2, hh, bz2], [ax, hh, az], [[uo, 0], [uo + len / FACADE_W, 0], [uo + len / FACADE_W, hh / FACADE_H], [uo, hh / FACADE_H]]);
          };
          wall(x0, z0 + d, x0 + w, z0 + d, w);
          wall(x0 + w, z0, x0, z0, w);
          wall(x0 + w, z0 + d, x0 + w, z0, d);
          wall(x0, z0, x0, z0 + d, d);
          // roof
          const roof = get(chunkX, chunkZ, 'roof');
          if (gable) {
            const rc = C(pick([0x7a3a2a, 0x5a3a30, 0x4a4a52, 0x6a4a3a], rng));
            const ph = Math.min(w, d) * 0.28;
            const pl = get(chunkX, chunkZ, 'plain');
            const ov = 0.5;
            if (w >= d) {
              pl.quad([x0 - ov, hh, z0 - ov], [x0 + w + ov, hh, z0 - ov], [x0 + w + ov, hh + ph, bz], [x0 - ov, hh + ph, bz], undefined, rc);
              pl.quad([x0 - ov, hh + ph, bz], [x0 + w + ov, hh + ph, bz], [x0 + w + ov, hh, z0 + d + ov], [x0 - ov, hh, z0 + d + ov], undefined, rc);
              pl.tri([x0, hh, z0 + d], [x0, hh + ph, bz], [x0, hh, z0], C(0xd8c9a8));
              pl.tri([x0 + w, hh, z0], [x0 + w, hh + ph, bz], [x0 + w, hh, z0 + d], C(0xd8c9a8));
            } else {
              pl.quad([x0 + w + ov, hh, z0 - ov], [x0 + w + ov, hh, z0 + d + ov], [bx, hh + ph, z0 + d + ov], [bx, hh + ph, z0 - ov], undefined, rc);
              pl.quad([bx, hh + ph, z0 - ov], [bx, hh + ph, z0 + d + ov], [x0 - ov, hh, z0 + d + ov], [x0 - ov, hh, z0 - ov], undefined, rc);
              pl.tri([x0 + w, hh, z0 + d], [bx, hh + ph, z0 + d], [x0, hh, z0 + d], C(0xd8c9a8));
              pl.tri([x0, hh, z0], [bx, hh + ph, z0], [x0 + w, hh, z0], C(0xd8c9a8));
            }
          } else {
            roof.quad([x0, hh, z0], [x0, hh, z0 + d], [x0 + w, hh, z0 + d], [x0 + w, hh, z0], [[0, 0], [0, d / 8], [w / 8, d / 8], [w / 8, 0]]);
            const pl = get(chunkX, chunkZ, 'plain');
            const pc = C(0x6a6a68);
            // parapet
            pl.box(bx, hh, z0 + 0.25, w, 0.9, 0.5, pc);
            pl.box(bx, hh, z0 + d - 0.25, w, 0.9, 0.5, pc);
            pl.box(x0 + 0.25, hh, bz, 0.5, 0.9, d - 1, pc);
            pl.box(x0 + w - 0.25, hh, bz, 0.5, 0.9, d - 1, pc);
            // roof clutter
            const nAC = Math.floor(rng() * 4) + (floors > 6 ? 2 : 0);
            for (let k = 0; k < nAC; k++) {
              const ax = x0 + 3 + rng() * (w - 6), az = z0 + 3 + rng() * (d - 6);
              if (rng() < 0.5) pl.box(ax, hh, az, 2 + rng() * 2, 1.2 + rng(), 2 + rng() * 2, C(0x9a9ea2));
              else pl.box(ax, hh, az, 2.4, 3 + rng() * 1.5, 2.4, C(0x6a5040));
            }
            if (floors > 8 && rng() < 0.7) {
              const ax = bx + (rng() - 0.5) * w * 0.3;
              pl.box(ax, hh, bz, 0.4, 10 + rng() * 14, 0.4, C(0x333336));
              pl.box(ax, hh + 14, bz, 2.4, 0.2, 0.2, C(0x333336));
            }
          }
          // ground-floor details
          const pl = get(chunkX, chunkZ, 'plain');
          if (kind === 'shop' || (sp2 && sp2.kind === 'shop')) {
            const ac = C(pick([0xb02a20, 0x2060a0, 0x208040, 0xd09020, 0x703080], rng));
            pl.box(bx, 3.0, z0 + d + 0.9, w - 2, 0.12, 1.8, ac);
            pl.box(bx, 2.8, z0 + d + 1.78, w - 2, 0.35, 0.05, ac);
          } else if (floors > 2) {
            pl.box(bx, 3.3, z0 + d + 1.0, 8, 0.2, 2.0, C(0x303034));
            pl.box(bx, 0, z0 + d + 0.05, 5, 3.0, 0.1, C(0x15161a));
          }
          // ---- architectural detail (own RNG so the city layout is untouched)
          {
            const dr = this.detailRng;
            const tone = (k: number) => new THREE.Color().setHSL(0.09, 0.06, k);
            if (floors > 1 && kind !== 'glass') pl.box(bx, 0, bz, w + 0.3, 0.9, d + 0.3, C(0x4a4743));
            if (!gable) {
              pl.box(bx, hh - 0.6, bz, w + 0.7, 0.6, d + 0.7, tone(0.5));
              pl.box(bx, hh - 0.08, bz, w + 1.0, 0.16, d + 1.0, tone(0.34));
            }
            if (floors >= 5) {
              for (let fl = kind === 'glass' ? 6 : 4; fl < floors; fl += kind === 'glass' ? 6 : 4) {
                pl.box(bx, fl * FLOOR_H - 0.2, bz, w + 0.4, 0.4, d + 0.4, kind === 'glass' ? C(0x182027) : tone(0.46));
              }
            }
            if (!gable && (kind === 'brick' || kind === 'concrete' || kind === 'apartment' || kind === 'office')) {
              for (const [px, pz] of [[x0, z0], [x0 + w, z0], [x0, z0 + d], [x0 + w, z0 + d]]) pl.box(px, 0, pz, 0.8, hh, 0.8, tone(0.5));
            }
            if (kind === 'apartment' && floors >= 3 && !sp2) {
              const bays = Math.floor(w / 3);
              for (const face of [1, -1]) {
                for (let fl = 1; fl < floors; fl++) {
                  for (let b = 0; b < bays; b += 2) {
                    if (dr() < 0.3) continue;
                    const cxb = face > 0 ? x0 + 1.5 + 3 * b : x0 + w - 1.5 - 3 * b;
                    const zf = face > 0 ? z0 + d + 0.6 : z0 - 0.6;
                    const y0b = fl * FLOOR_H;
                    pl.box(cxb, y0b + 0.02, zf, 2.3, 0.16, 1.3, tone(0.52));
                    pl.box(cxb, y0b + 0.18, zf + face * 0.62, 2.3, 0.62, 0.07, tone(0.6));
                    pl.box(cxb - 1.12, y0b + 0.18, zf, 0.07, 0.62, 1.2, tone(0.6));
                    pl.box(cxb + 1.12, y0b + 0.18, zf, 0.07, 0.62, 1.2, tone(0.6));
                    if (dr() < 0.28) pl.box(cxb + 0.3, y0b + 0.18, zf + face * 0.2, 0.8, 0.62, 0.55, C(0xb4b8bc)); // split AC unit
                    else if (dr() < 0.3) pl.box(cxb, y0b + 0.18, zf, 0.9, 0.3, 0.5, C(dr() < 0.5 ? 0xa04030 : 0x3a6a8a)); // flower box / laundry
                  }
                }
              }
            }
            if (!gable) {
              if (floors >= 3 && w > 14 && dr() < 0.4) this.tankPts.push({ x: x0 + 3 + dr() * (w - 6), y: hh, z: z0 + 3 + dr() * (d - 6), r: dr() * 6 });
              if (floors >= 14) this.aviationPts.push(new THREE.Vector3(bx, hh + 1.3, bz));
              if (floors >= 8) {
                // mechanical penthouse + louvres
                pl.box(bx + (dr() - 0.5) * w * 0.3, hh, bz + (dr() - 0.5) * d * 0.3, Math.min(8, w * 0.3), 3.2, Math.min(8, d * 0.3), tone(0.42));
              }
            }
          }
          // real depth: slabs, sills, fins, fire escapes, porches, crowns
          dressBuilding(pl, { x0, z0, w, d, floors, kind, gable, special: !!sp2 }, this.detailRng);
          // colliders
          this.addBox(x0, x0 + w, z0, z0 + d, hh);
          return { bx, bz, hh };
        };

        if (sp) {
          // special building positioned near the south (−z) edge of the lot, facing the road at -z
          const w = sp.w, d = sp.d;
          const x0 = cx - w / 2, z0 = lz0 + 3;
          const col = C(sp.color);
          void col;
          const variant = 0;
          const { bx, hh } = addBuilding(x0, z0, w, d, sp.floors, sp.facade, variant, sp.kind === 'shop' ? { ...sp, kind: 'shop' } : sp, false)!;
          // sign on the −z face
          const sg = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w - 4, 22), 4.4), new THREE.MeshStandardMaterial({ map: signTex(sp.sign, sp.signBg, sp.signFg, 512, 100), emissiveMap: signTex(sp.sign, sp.signBg, sp.signFg, 512, 100), emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.4 }));
          sg.position.set(bx, Math.min(hh - 2, 7.2), z0 - 0.3);
          sg.rotation.y = Math.PI;
          this.group.add(sg);
          this.signMats.push(sg.material as THREE.MeshStandardMaterial);
          if (sp.id === 'club') {
            // vertical neon blade sign
            const bl = new THREE.Mesh(new THREE.PlaneGeometry(3, 12), new THREE.MeshBasicMaterial({ map: signTex('NEON LOTUS', '#14061c', '#ff3fd0', 128, 512, 'bold 52px Arial Black'), transparent: false }));
            bl.position.set(x0 - 0.5, 14, z0 - 0.2);
            bl.rotation.y = Math.PI;
            this.group.add(bl);
            const pl = get(chunkX, chunkZ, 'plain');
            pl.box(bx, hh, z0 + d / 2, w + 1, 1.2, d + 1, C(0xff3fd0));
          }
          if (sp.id === 'hospital') {
            const pl = get(chunkX, chunkZ, 'plain');
            pl.box(bx, hh + 0.05, z0 + d / 2, 14, 0.15, 14, C(0xe8e8e8));
            pl.box(bx, hh + 0.2, z0 + d / 2, 10, 0.1, 2.4, C(0xd01818));
            pl.box(bx, hh + 0.2, z0 + d / 2, 2.4, 0.1, 10, C(0xd01818));
          }
          this.pois.push({ id: sp.id, name: sp.name, x: bx, z: z0 - 3.2, r: 4.5, icon: sp.icon, color: sp.signFg, kind: sp.poiKind });
          // parking / yard in rest of the lot
          this.spawnPoints.push({ x: bx + w / 2 + 6, z: z0 + 10, h: 0 });
          // neighbours: small buildings filling the back of the lot
          const backZ = z0 + d + 4;
          if (lz1 - backZ > 14) {
            addBuilding(lx0 + 2, backZ, lot - 4, lz1 - backZ - 1, zone === 'downtown' ? 8 : 3, pick(['office', 'concrete', 'brick'] as FacadeKind[], rng), 1);
          }
          // side buildings
          const leftW = x0 - lx0 - 3;
          if (leftW > 12) addBuilding(lx0 + 1, z0, leftW - 1, d, Math.floor(range(rng, 2, 6)), pick(['apartment', 'brick', 'office'] as FacadeKind[], rng), 1);
          const rightW = lx1 - (x0 + w) - 3;
          if (rightW > 12) addBuilding(x0 + w + 3, z0, rightW - 1, d, Math.floor(range(rng, 2, 6)), pick(['apartment', 'brick', 'office'] as FacadeKind[], rng), 0);
          this.sidewalkPts.push({ x: cx, z: cz - s - 2 });
          continue;
        }

        // generic subdivision
        if (zone === 'downtown') {
          const split = rng() < 0.45;
          const tw = split ? lot / 2 - 3 : lot - 14;
          const tiers = (x0: number, z0: number, w: number, d: number, floors: number, kind: FacadeKind, v: number) => {
            let cw = w, cd = d, cx0 = x0, cz0 = z0, fl = floors, base = 0;
            const t = Math.floor(range(rng, 1, 4));
            for (let k = 0; k < t; k++) {
              const f = k === t - 1 ? fl : Math.floor(fl * (0.55 + rng() * 0.2));
              const acc = get(chunkX, chunkZ, `f-${kind}-${v}`);
              void acc;
              // each tier is a full-height box from ground (simplest, cheap): use floors f
              addBuilding(cx0, cz0, cw, cd, f, kind, v);
              base = f;
              const sh = 0.78 + rng() * 0.1;
              const nw = cw * sh, nd = cd * sh;
              cx0 += (cw - nw) / 2; cz0 += (cd - nd) / 2; cw = nw; cd = nd;
              fl = Math.floor(fl * (1.15 + rng() * 0.45));
            }
            void base;
          };
          const kinds: FacadeKind[] = ['glass', 'office', 'glass', 'concrete'];
          if (split) {
            tiers(lx0 + 2, lz0 + 2, tw, tw, Math.floor(range(rng, 14, 36)), pick(kinds, rng), Math.floor(rng() * 2));
            tiers(lx0 + lot / 2 + 1, lz0 + lot / 2 + 1, tw, tw, Math.floor(range(rng, 14, 36)), pick(kinds, rng), Math.floor(rng() * 2));
            addBuilding(lx0 + lot / 2 + 1, lz0 + 2, tw, lot / 2 - 8, Math.floor(range(rng, 5, 10)), 'office', 1);
            addBuilding(lx0 + 2, lz0 + lot / 2 + 1, tw, lot / 2 - 8, Math.floor(range(rng, 5, 10)), 'concrete', 0);
          } else {
            tiers(lx0 + 7, lz0 + 7, tw, tw, Math.floor(range(rng, 22, 48)), pick(kinds, rng), Math.floor(rng() * 2));
          }
        } else if (zone === 'commercial') {
          const cols = 2, rows = 2;
          const bw = (lot - 4) / cols - 3, bd = (lot - 4) / rows - 3;
          for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
            const kind = pick(['office', 'brick', 'apartment', 'shop', 'shop', 'concrete'] as FacadeKind[], rng);
            const fl = kind === 'shop' ? Math.floor(range(rng, 2, 4)) : Math.floor(range(rng, 4, 12));
            addBuilding(lx0 + 2 + a * (bw + 3) + (rng() - 0.5) * 2, lz0 + 2 + b * (bd + 3), bw, bd, fl, kind, Math.floor(rng() * 2));
          }
        } else if (zone === 'residential') {
          const cols = 3, rows = 2;
          const bw = (lot - 4) / cols - 6, bd = (lot - 4) / rows - 8;
          for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
            const apt = rng() < 0.3;
            const kind: FacadeKind = apt ? 'apartment' : pick(['apartment', 'brick'] as FacadeKind[], rng);
            const fl = apt ? Math.floor(range(rng, 4, 7)) : Math.floor(range(rng, 2, 4));
            const w = apt ? bw + 3 : bw - rng() * 3, d = apt ? bd + 2 : bd - rng() * 4;
            const x0 = lx0 + 3 + a * (bw + 6) + 1, z0 = lz0 + 3 + b * (bd + 8) + 2;
            addBuilding(x0, z0, w, d, fl, kind, Math.floor(rng() * 2), undefined, !apt);
            if (!apt && rng() < 0.6) this.addTree(x0 + w / 2 + (rng() - 0.5) * 6, z0 - 3.5);
          }
        } else if (zone === 'industrial') {
          const cols = 2;
          const bw = (lot - 6) / cols - 4;
          for (let a = 0; a < cols; a++) {
            const bd = range(rng, 34, 50);
            addBuilding(lx0 + 3 + a * (bw + 4), lz0 + 4, bw, bd, Math.floor(range(rng, 2, 4)), 'concrete', 1);
            // container yard
            const yz = lz0 + 4 + bd + 4;
            for (let k = 0; k < 6; k++) {
              const cxm = lx0 + 5 + a * (bw + 4) + (k % 3) * 8;
              const czm = yz + Math.floor(k / 3) * 3.4;
              if (czm > lz1 - 3) continue;
              const st = 1 + Math.floor(rng() * 3);
              const cc = C(pick([0xb03030, 0x2a5aa0, 0x2a7a4a, 0xc08020, 0x707070], rng));
              for (let y = 0; y < st; y++) get(chunkX, chunkZ, 'plain').box(cxm, 0.17 + y * 2.6, czm, 6.1, 2.6, 2.44, cc);
              this.addBox(cxm - 3, cxm + 3, czm - 1.2, czm + 1.2, st * 2.6);
            }
          }
        }
        this.sidewalkPts.push({ x: cx, z: cz - s - 2 }, { x: cx, z: cz + s + 2 }, { x: cx - s - 2, z: cz }, { x: cx + s + 2, z: cz });
      }
    }

    // materials for merged geometry
    const sw = sidewalkTex();
    const swm = sw.map.clone(); swm.repeat.set(PAD / 8, PAD / 8); swm.needsUpdate = true;
    const swn = sw.normal!.clone(); swn.repeat.set(PAD / 8, PAD / 8); swn.needsUpdate = true;
    // pad box uv is 0..1 per face; remap by multiplying uv via texture repeat in material
    const padMat = patchWet(new THREE.MeshStandardMaterial({ map: swm, normalMap: swn, roughness: 0.9, color: 0xffffff }), 0.7);
    const mk = (a: Acc, mat: THREE.Material, shadow = true) => {
      const g = a.build();
      if (!g) return;
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.castShadow = shadow;
      this.group.add(m);
    };
    mk(pad, padMat, false);
    const gt = grassTex();
    const gm2 = gt.map.clone(); gm2.repeat.set(1, 1); gm2.needsUpdate = true;
    mk(padG, new THREE.MeshStandardMaterial({ map: gm2, normalMap: gt.normal, roughness: 1, color: 0xc8d8b0 }), false);
    const ct = concreteTex();
    const cm2 = ct.map.clone(); cm2.repeat.set(1, 1); cm2.needsUpdate = true;
    mk(padP, patchWet(new THREE.MeshStandardMaterial({ map: cm2, roughness: 0.95 }), 0.8), false);
    const st = sandTex();
    const sm2 = st.map.clone(); sm2.repeat.set(1, 1); sm2.needsUpdate = true;
    mk(padS, new THREE.MeshStandardMaterial({ map: sm2, roughness: 1 }), false);

    const rt = roofTex();
    const roofMat = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.95 });
    const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 });
    for (const [k, a] of accs) {
      const [cxk, czk, mat] = k.split('|');
      void cxk; void czk;
      const g = a.build();
      if (!g) continue;
      let material: THREE.Material;
      if (mat === 'roof') material = roofMat;
      else if (mat === 'plain') material = plainMat;
      else {
        const [, kind, v] = mat.split('-');
        material = this.facadeMat(kind as FacadeKind, +v);
      }
      const m = new THREE.Mesh(g, material);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    // rooftop water tanks
    if (this.tankPts.length) {
      const tk = new THREE.InstancedMesh(makeTankGeometry(), new THREE.MeshStandardMaterial({ color: 0x8c8f92, roughness: 0.55, metalness: 0.55 }), this.tankPts.length);
      const dd = new THREE.Object3D();
      this.tankPts.forEach((t, i) => { dd.position.set(t.x, t.y, t.z); dd.rotation.set(0, t.r, 0); dd.updateMatrix(); tk.setMatrixAt(i, dd.matrix); });
      tk.castShadow = true; tk.receiveShadow = true;
      this.group.add(tk);
    }
    // aviation obstruction lights on the tall towers
    if (this.aviationPts.length) {
      this.aviation = makeGlow(this.aviationPts, 4.5, 0xff2a18, 0);
      this.group.add(this.aviation);
    }
  }

  private buildPark(i: number, j: number, cx: number, cz: number, lot: number) {
    const rng = this.rng;
    // paths
    const pm = new THREE.MeshStandardMaterial({ map: concreteTex().map, roughness: 0.9 });
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(5, lot), pm);
    p1.rotation.x = -Math.PI / 2; p1.position.set(cx, 0.19, cz);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(lot, 5), pm);
    p2.rotation.x = -Math.PI / 2; p2.position.set(cx, 0.19, cz);
    this.group.add(p1, p2);
    // fountain
    const base = new THREE.Mesh(new THREE.CylinderGeometry(8, 8.6, 1, 28), new THREE.MeshStandardMaterial({ map: concreteTex().map, roughness: 0.8 }));
    base.position.set(cx, 0.6, cz);
    base.castShadow = true;
    const wat = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.4, 0.2, 28), new THREE.MeshStandardMaterial({ color: 0x2a6a8a, roughness: 0.05, metalness: 0.8, transparent: true, opacity: 0.9 }));
    wat.position.set(cx, 1.08, cz);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 4, 12), base.material);
    col.position.set(cx, 3, cz);
    this.group.add(base, wat, col);
    this.circles.push({ x: cx, z: cz, r: 8.6, h: 2 });
    for (let k = 0; k < 46; k++) {
      const x = cx + (rng() - 0.5) * (lot - 6), z = cz + (rng() - 0.5) * (lot - 6);
      if (Math.abs(x - cx) < 4 || Math.abs(z - cz) < 4 || Math.hypot(x - cx, z - cz) < 12) continue;
      this.addTree(x, z, 1 + rng() * 0.6);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      this.addBench(cx + Math.cos(a) * 12, cz + Math.sin(a) * 12, -a + Math.PI / 2);
    }
    this.pois.push({ id: `park${i}${j}`, name: 'City Park', x: cx, z: cz + 20, r: 1, icon: '', color: '#4a8', kind: 'service' });
    this.sidewalkPts.push({ x: cx + 2.5, z: cz + 20 }, { x: cx - 20, z: cz + 2.5 }, { x: cx, z: cz - 30 });
  }

  private buildBeach(i: number, j: number, cx: number, cz: number, lot: number) {
    const rng = this.rng;
    // boardwalk + palms + umbrellas
    for (let k = 0; k < 8; k++) this.addPalm(cx - lot / 2 + 6, cz - lot / 2 + 8 + k * 12);
    const umb = new THREE.InstancedMesh(new THREE.ConeGeometry(2, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), 6);
    const d = new THREE.Object3D();
    const cols = [0xff4040, 0x40a0ff, 0xffd040, 0x40d080, 0xff80c0, 0xffffff];
    for (let k = 0; k < 6; k++) {
      d.position.set(cx + 8 + rng() * 30, 2.4, cz + (rng() - 0.5) * 80);
      d.updateMatrix();
      umb.setMatrixAt(k, d.matrix);
      umb.setColorAt(k, new THREE.Color(cols[k]));
    }
    this.group.add(umb);
    if (j === 3 || j === 4) {
      // pier
      const pier = new THREE.Mesh(new THREE.BoxGeometry(110, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9, map: concreteTex().map }));
      pier.position.set(cx + 60, 0.7, cz);
      pier.receiveShadow = true;
      this.group.add(pier);
      this.ramps.push({ x: cx + 100, z: cz, w: 6, l: 14, h: 0, dir: 0 });
    }
    this.sidewalkPts.push({ x: cx - lot / 2 + 3, z: cz });
  }

  addBox(x0: number, x1: number, z0: number, z1: number, h: number) {
    const b: Box = { x0, x1, z0, z1, h, id: this.bid++ };
    this.boxes.push(b);
    const cs = 24;
    for (let cx = Math.floor(x0 / cs); cx <= Math.floor(x1 / cs); cx++) {
      for (let cz = Math.floor(z0 / cs); cz <= Math.floor(z1 / cs); cz++) {
        const k = cx * 10007 + cz;
        let e = this.hash.get(k);
        if (!e) { e = { b: [], c: [] }; this.hash.set(k, e); }
        e.b.push(b);
      }
    }
  }
  addCircle(x: number, z: number, r: number, h: number) {
    const c = { x, z, r, h };
    this.circles.push(c);
    const k = Math.floor(x / 24) * 10007 + Math.floor(z / 24);
    let e = this.hash.get(k);
    if (!e) { e = { b: [], c: [] }; this.hash.set(k, e); }
    e.c.push(c);
  }

  // ---------------------------------------------------------------- props
  private treeTrunk!: THREE.InstancedMesh;
  private treeLeaf!: THREE.InstancedMesh;
  private trees: { x: number; z: number; s: number }[] = [];
  private palms: { x: number; z: number }[] = [];
  private benches: { x: number; z: number; r: number }[] = [];
  addTree(x: number, z: number, s = 1) { this.trees.push({ x, z, s }); this.addCircle(x, z, 0.5 * s, 6); }
  addPalm(x: number, z: number) { this.palms.push({ x, z }); this.addCircle(x, z, 0.4, 8); }
  addBench(x: number, z: number, r: number) { this.benches.push({ x, z, r }); }

  private buildProps() {
    const rng = this.rng;
    // lamps along roads; trees along sidewalks; hydrants; bins
    const lampPoles: { x: number; z: number; r: number }[] = [];
    const bins: { x: number; z: number }[] = [];
    const hyd: { x: number; z: number }[] = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const { x: cx, z: cz } = blockCenter(i, j);
        const zone = this.zones[i][j];
        const e = PAD / 2 - 1.2;
        if (zone === 'beach') continue;
        for (let k = -2; k <= 2; k++) {
          const t = k * 20;
          lampPoles.push({ x: cx + t, z: cz - e, r: 0 }, { x: cx + t, z: cz + e, r: Math.PI });
          lampPoles.push({ x: cx - e, z: cz + t, r: -Math.PI / 2 }, { x: cx + e, z: cz + t, r: Math.PI / 2 });
          if (zone !== 'industrial' && Math.abs(k) !== 2) {
            const te = PAD / 2 - 2.6;
            if (rng() < 0.7) this.addTree(cx + t + 10, cz - te);
            if (rng() < 0.7) this.addTree(cx + t + 10, cz + te);
            if (rng() < 0.5) this.addTree(cx - te, cz + t + 10);
            if (rng() < 0.5) this.addTree(cx + te, cz + t + 10);
          }
        }
        for (let k = 0; k < 5; k++) {
          const side = Math.floor(rng() * 4);
          const t = (rng() - 0.5) * (PAD - 20);
          const px = side === 0 ? cx + t : side === 1 ? cx + t : side === 2 ? cx - e + 0.6 : cx + e - 0.6;
          const pz = side === 0 ? cz - e + 0.6 : side === 1 ? cz + e - 0.6 : cz + t;
          (k % 2 ? bins : hyd).push({ x: px, z: pz });
          this.addCircle(px, pz, 0.35, 1);
        }
        for (const o of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const tx = cx + o[0] * (PAD / 2 - 1.2), tz = cz + o[1] * (PAD / 2 - 1.2);
          void tx; void tz;
        }
      }
    }
    // lamp instanced meshes
    const poleG = new THREE.CylinderGeometry(0.1, 0.16, 8.5, 8); poleG.translate(0, 4.25, 0);
    const armG = new THREE.BoxGeometry(0.12, 0.12, 2.4); armG.translate(0, 8.5, 1.1);
    const headG = new THREE.BoxGeometry(0.4, 0.03, 0.9); headG.translate(0, 8.43, 2.05);
    const housingG = new THREE.BoxGeometry(0.52, 0.16, 1.15); housingG.translate(0, 8.54, 2.05);
    const baseG = new THREE.CylinderGeometry(0.2, 0.26, 0.5, 8); baseG.translate(0, 0.25, 0);
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.7 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.3 });
    const merged = mergeGeometries([poleG, armG, housingG, baseG]);
    const lp = new THREE.InstancedMesh(merged, metal, lampPoles.length);
    const lh = new THREE.InstancedMesh(headG, this.lampMat, lampPoles.length);
    lp.castShadow = true;
    const d = new THREE.Object3D();
    lampPoles.forEach((p, idx) => {
      d.position.set(p.x, 0.16, p.z);
      d.rotation.set(0, p.r, 0);
      d.updateMatrix();
      lp.setMatrixAt(idx, d.matrix);
      lh.setMatrixAt(idx, d.matrix);
      this.addCircle(p.x, p.z, 0.2, 9);
      const fx = Math.sin(p.r) * 2.1, fz = Math.cos(p.r) * 2.1;
      this.lampPos.push(new THREE.Vector3(p.x + fx, 8.2, p.z + fz));
    });
    this.group.add(lp, lh);
    this.glow = makeGlow(this.lampPos, 5.5, 0xffc67a, 0);
    this.group.add(this.glow);
    // trees: layered smooth crowns with baked AO, wind sway and procedural leaf speckle
    const crownG = makeCrownGeometry(rng);
    const barkMat = patchFoliage(new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 1 }), 0.15, false);
    const leafMat = patchFoliage(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.78 }), 1.0, true);
    this.treeTrunk = new THREE.InstancedMesh(makeTrunkGeometry(), barkMat, this.trees.length);
    this.treeLeaf = new THREE.InstancedMesh(crownG, leafMat, this.trees.length);
    this.treeTrunk.castShadow = this.treeLeaf.castShadow = true;
    this.treeLeaf.receiveShadow = true;
    this.trees.forEach((t, idx) => {
      d.position.set(t.x, 0.16, t.z);
      d.rotation.set(0, rng() * 6, 0);
      d.scale.set(t.s * (0.9 + rng() * 0.25), t.s * (0.85 + rng() * 0.4), t.s * (0.9 + rng() * 0.25));
      d.updateMatrix();
      this.treeTrunk.setMatrixAt(idx, d.matrix);
      this.treeLeaf.setMatrixAt(idx, d.matrix);
      this.treeLeaf.setColorAt(idx, new THREE.Color().setHSL(0.22 + rng() * 0.1, 0.5, 0.3 + rng() * 0.12));
    });
    d.scale.setScalar(1);
    this.group.add(this.treeTrunk, this.treeLeaf);
    // palms
    if (this.palms.length) {
      const pg = makePalmGeometries();
      const pm = new THREE.InstancedMesh(pg.trunk, patchFoliage(new THREE.MeshStandardMaterial({ color: 0x9a7a58, roughness: 0.95 }), 0.35, false), this.palms.length);
      const fm = new THREE.InstancedMesh(pg.fronds, patchFoliage(new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: 0xffffff }), 1.8, false), this.palms.length);
      this.palms.forEach((p, idx) => { d.position.set(p.x, 0.1, p.z); d.rotation.set(0, idx * 1.9, 0); d.scale.setScalar(0.9 + (idx % 4) * 0.1); d.updateMatrix(); pm.setMatrixAt(idx, d.matrix); fm.setMatrixAt(idx, d.matrix); });
      d.scale.setScalar(1);
      pm.castShadow = fm.castShadow = true;
      fm.receiveShadow = true;
      this.group.add(pm, fm);
    }
    // benches
    if (this.benches.length) {
      const bg = new THREE.BoxGeometry(2, 0.5, 0.6); bg.translate(0, 0.45, 0);
      const bm = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.8 }), this.benches.length);
      this.benches.forEach((b, idx) => { d.position.set(b.x, 0.16, b.z); d.rotation.set(0, b.r, 0); d.updateMatrix(); bm.setMatrixAt(idx, d.matrix); });
      this.group.add(bm);
    }
    // bins + hydrants
    const binM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.3, 0.9, 10).translate(0, 0.45, 0), new THREE.MeshStandardMaterial({ color: 0x2a4a3a, roughness: 0.6, metalness: 0.4 }), bins.length);
    bins.forEach((b, idx) => { d.position.set(b.x, 0.16, b.z); d.rotation.set(0, 0, 0); d.updateMatrix(); binM.setMatrixAt(idx, d.matrix); });
    const hydM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 0.75, 8).translate(0, 0.38, 0), new THREE.MeshStandardMaterial({ color: 0xc02020, roughness: 0.5, metalness: 0.4 }), hyd.length);
    hyd.forEach((b, idx) => { d.position.set(b.x, 0.16, b.z); d.updateMatrix(); hydM.setMatrixAt(idx, d.matrix); });
    this.group.add(binM, hydM);

    // traffic lights: pole at each corner of each intersection, with 3 lamps
    const corners: { i: number; j: number; x: number; z: number; axis: number; rot: number }[] = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const p = nodePos(i, j);
      const o = ROAD_W / 2 + 1.0;
      corners.push({ i, j, x: p.x + o, z: p.z + o, axis: 0, rot: Math.PI }, { i, j, x: p.x - o, z: p.z - o, axis: 0, rot: 0 });
      corners.push({ i, j, x: p.x - o, z: p.z + o, axis: 1, rot: Math.PI / 2 * 3 }, { i, j, x: p.x + o, z: p.z - o, axis: 1, rot: Math.PI / 2 });
    }
    const tpG = mergeGeometries([new THREE.CylinderGeometry(0.1, 0.12, 5.2, 8).translate(0, 2.6, 0), new THREE.BoxGeometry(0.1, 0.1, 4).translate(0, 5.1, 2.0), new THREE.BoxGeometry(0.35, 1.0, 0.3).translate(0, 4.65, 3.8)])!;
    const tp = new THREE.InstancedMesh(tpG, metal, corners.length);
    const lampG = new THREE.SphereGeometry(0.11, 8, 6);
    this.tlMesh = new THREE.InstancedMesh(lampG, new THREE.MeshBasicMaterial({ color: 0xffffff }), corners.length * 3);
    this.tlMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(corners.length * 9), 3);
    corners.forEach((c, idx) => {
      d.position.set(c.x, 0.16, c.z);
      d.rotation.set(0, c.rot, 0);
      d.updateMatrix();
      tp.setMatrixAt(idx, d.matrix);
      this.addCircle(c.x, c.z, 0.2, 5);
      const m = d.matrix.clone();
      for (let s = 0; s < 3; s++) {
        const lm = new THREE.Matrix4().makeTranslation(0, 4.95 - s * 0.3, 3.96).premultiply(m);
        this.tlMesh.setMatrixAt(idx * 3 + s, lm);
      }
      this.tlInfo.push({ i: c.i, j: c.j, axis: c.axis, slot: idx });
    });
    this.group.add(tp, this.tlMesh);
    void this.tlDummy;
    this.updateSignals(0);

    // billboards on a few downtown sidewalks
    const ads = [['COLA-X', '#b0101a', '#fff'], ['GLITCH', '#101030', '#40e0ff'], ['SPRUNK', '#0a5a2a', '#d0ff60'], ['VAPID', '#222', '#ff9030'], ['LIFEINVADER', '#1030a0', '#fff']];
    for (let k = 0; k < 12; k++) {
      const i = 2 + (k % 4), j = 2 + Math.floor(k / 4);
      const { x: cx, z: cz } = blockCenter(i, j);
      const ad = ads[k % ads.length];
      const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 4), new THREE.MeshStandardMaterial({ map: signTex(ad[0], ad[1], ad[2], 512, 170), emissiveMap: signTex(ad[0], ad[1], ad[2], 512, 170), emissive: 0xffffff, emissiveIntensity: 0.3 }));
      void board;
    }
  }

  updateSignals(t: number) {
    const col = this.tlMesh.instanceColor!;
    const R = new THREE.Color(0xff2010), Gr = new THREE.Color(0x20ff40), Y = new THREE.Color(0xffc010), off = new THREE.Color(0x120808);
    for (const c of this.tlInfo) {
      const st = this.signalState(c.i, c.j, c.axis, t);
      const cols = [st === 2 ? R : off, st === 1 ? Y : off, st === 0 ? Gr : off];
      for (let s = 0; s < 3; s++) col.setXYZ(c.slot * 3 + s, cols[s].r, cols[s].g, cols[s].b);
    }
    col.needsUpdate = true;
  }
  /** 0 green, 1 yellow, 2 red for traffic travelling on axis (0 = along z, 1 = along x) */
  signalState(i: number, j: number, axis: number, t: number) {
    const cyc = 24;
    const ph = (t + (i * 7 + j * 3) % cyc) % cyc;
    const mine = axis === 0 ? ph < 12 : ph >= 12;
    const local = ph % 12;
    if (mine) return local > 10 ? 1 : 0;
    return 2;
  }

  // ---------------------------------------------------------------- sea / surroundings
  private buildSea() {
    const sea = createWater(waterNormal(), HALF + 63, 3000, HALF + 30 + 1500);
    sea.position.y = -0.45;
    this.group.add(sea);
    this.sea = sea;
    // sand slope between road and sea
    const sand = sandTex().map.clone();
    sand.repeat.set(30, 200);
    sand.needsUpdate = true;
    const beach = new THREE.Mesh(new THREE.PlaneGeometry(70, 1200), new THREE.MeshStandardMaterial({ map: sand, roughness: 1 }));
    beach.rotation.x = -Math.PI / 2;
    beach.position.set(HALF + 28, -0.2, 0);
    this.group.add(beach);
  }

  private buildSurroundings() {
    const rng = this.rng;
    // distant mountains: displaced, strata-coloured ridges that fade into the haze
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2;
      if (Math.cos(a) > 0.55) continue;
      const r = 1100 + rng() * 300;
      const g = makeMountainGeometry(rng, 170 + rng() * 230, 130 + rng() * 280);
      const m = new THREE.Mesh(g, mat);
      m.position.set(Math.cos(a) * r, 40, Math.sin(a) * r);
      m.rotation.y = rng() * 3;
      this.group.add(m);
    }
    // outer forest ring (cheap instanced trees)
    const cnt = 1400;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.4, 5, 5).translate(0, 2.5, 0), new THREE.MeshStandardMaterial({ color: 0x4a3626 }), cnt);
    const leaf = new THREE.InstancedMesh(new THREE.ConeGeometry(3.2, 11, 6).translate(0, 9, 0), new THREE.MeshStandardMaterial({ color: 0x2c5a30, roughness: 1 }), cnt);
    const d = new THREE.Object3D();
    for (let k = 0; k < cnt; k++) {
      let x = 0, z = 0;
      for (let t = 0; t < 10; t++) {
        x = (rng() - 0.5) * 1700;
        z = (rng() - 0.5) * 1700;
        if (Math.abs(x) > HALF + 50 || Math.abs(z) > HALF + 50) break;
      }
      if (x > HALF) x = -x;
      d.position.set(x, 0, z);
      d.rotation.set(0, rng() * 6, 0);
      d.scale.setScalar(0.8 + rng() * 1.2);
      d.updateMatrix();
      trunk.setMatrixAt(k, d.matrix);
      leaf.setMatrixAt(k, d.matrix);
    }
    this.group.add(trunk, leaf);
  }

  private buildRamps() {
    const rm = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.7, map: concreteTex().map });
    const place = (x: number, z: number, dir: number) => {
      const w = 8, l = 16, h = 3;
      this.ramps.push({ x, z, w, l, h, dir });
      const g = new THREE.BufferGeometry();
      const v = [-w / 2, 0, -l / 2, w / 2, 0, -l / 2, w / 2, h, l / 2, -w / 2, h, l / 2, -w / 2, 0, l / 2, w / 2, 0, l / 2];
      const idx = [0, 3, 2, 0, 2, 1, 1, 2, 5, 0, 4, 3, 3, 4, 5, 3, 5, 2, 0, 1, 5, 0, 5, 4];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, rm);
      m.position.set(x, 0.01, z);
      m.rotation.y = dir;
      m.castShadow = true;
      this.group.add(m);
    };
    // jump ramps on the harbour road
    place(HALF - 3 - 4, nodePos(0, 5).z + 40, Math.PI / 2 * 0);
    const p = nodePos(2, 0);
    place(p.x + 40, p.z + 20, Math.PI / 2);
    this.ramps = this.ramps.filter((r) => r.h > 0);
  }

  private buildLampLights() {
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffd7a0, 0, 28, 1.6);
      this.lampLights.push(l);
      this.group.add(l);
    }
  }

  // ---------------------------------------------------------------- queries
  groundY(x: number, z: number) {
    for (const r of this.ramps) {
      const dx = x - r.x, dz = z - r.z;
      const c = Math.cos(r.dir), s = Math.sin(r.dir);
      const lx = dx * c - dz * s, lz = dx * s + dz * c; // rotate into ramp space (rotation.y = dir)
      if (Math.abs(lx) < r.w / 2 && Math.abs(lz) < r.l / 2) return 0.01 + ((lz + r.l / 2) / r.l) * r.h;
    }
    const gx = ((x + HALF + P / 2) % P + P) % P, gz = ((z + HALF + P / 2) % P + P) % P;
    const inX = x > -HALF + ROAD_W / 2 && x < HALF - ROAD_W / 2 && Math.abs(gx - P / 2) < PAD / 2;
    const inZ = z > -HALF + ROAD_W / 2 && z < HALF - ROAD_W / 2 && Math.abs(gz - P / 2) < PAD / 2;
    if (inX && inZ) return 0.16;
    if (x > HALF + 8) return Math.max(-0.2, -((x - HALF - 8) / 60) * 0.8);
    if (Math.abs(x) > HALF + 8 || Math.abs(z) > HALF + 8) return -0.05;
    return 0;
  }
  onRoad(x: number, z: number) {
    const gx = ((x + HALF) % P + P) % P, gz = ((z + HALF) % P + P) % P;
    return Math.min(gx, P - gx) < ROAD_W / 2 || Math.min(gz, P - gz) < ROAD_W / 2;
  }
  isWater(x: number) {
    return x > HALF + 62;
  }

  /** push a circle out of nearby obstacles; fills `out` with the corrected pos and the contact normal */
  resolve(x: number, z: number, r: number, out: Hit, y = 0, maxH = 1e9): boolean {
    out.hit = false;
    let px = x, pz = z;
    const cs = 24;
    const cx0 = Math.floor((x - r) / cs), cx1 = Math.floor((x + r) / cs), cz0 = Math.floor((z - r) / cs), cz1 = Math.floor((z + r) / cs);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const e = this.hash.get(cx * 10007 + cz);
      if (!e) continue;
      for (const b of e.b) {
        if (y > b.h || b.h > maxH) continue;
        const qx = Math.max(b.x0, Math.min(px, b.x1)), qz = Math.max(b.z0, Math.min(pz, b.z1));
        let dx = px - qx, dz = pz - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let nx: number, nz: number, push: number;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; push = r - d;
        } else {
          const l = px - b.x0, rr = b.x1 - px, t = pz - b.z0, bt = b.z1 - pz;
          const m = Math.min(l, rr, t, bt);
          nx = m === l ? -1 : m === rr ? 1 : 0;
          nz = m === t ? -1 : m === bt ? 1 : 0;
          if (nx === 0 && nz === 0) nx = 1;
          push = m + r;
        }
        void dx; void dz;
        px += nx * push; pz += nz * push;
        out.nx = nx; out.nz = nz; out.hit = true;
      }
      for (const c of e.c) {
        if (y > c.h) continue;
        const dx = px - c.x, dz = pz - c.z;
        const rr = r + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        px += (dx / d) * (rr - d); pz += (dz / d) * (rr - d);
        out.nx = dx / d; out.nz = dz / d; out.hit = true;
      }
    }
    // world bounds
    const B = HALF + 90;
    if (px < -B) { px = -B; out.nx = 1; out.nz = 0; out.hit = true; }
    if (px > HALF + 62 - r * 0) { px = HALF + 62; out.nx = -1; out.nz = 0; out.hit = true; }
    if (pz < -B) { pz = -B; out.nx = 0; out.nz = 1; out.hit = true; }
    if (pz > B) { pz = B; out.nx = 0; out.nz = -1; out.hit = true; }
    out.x = px; out.z = pz;
    return out.hit;
  }

  /** ray vs. building boxes; returns distance or Infinity */
  rayBoxes(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) {
    let best = Infinity;
    const seen = new Set<number>();
    const steps = Math.ceil(max / 12);
    for (let s = 0; s <= steps; s++) {
      const t = Math.min(max, s * 12);
      const x = ox + dx * t, z = oz + dz * t;
      const cx = Math.floor(x / 24), cz = Math.floor(z / 24);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const e = this.hash.get((cx + a) * 10007 + (cz + b));
        if (!e) continue;
        for (const bx of e.b) {
          if (seen.has(bx.id)) continue;
          seen.add(bx.id);
          let t0 = 0, t1 = best < max ? best : max;
          const slab = (o: number, d: number, mn: number, mx: number) => {
            if (Math.abs(d) < 1e-8) return o >= mn && o <= mx;
            let a1 = (mn - o) / d, a2 = (mx - o) / d;
            if (a1 > a2) [a1, a2] = [a2, a1];
            t0 = Math.max(t0, a1); t1 = Math.min(t1, a2);
            return t0 <= t1;
          };
          if (slab(ox, dx, bx.x0, bx.x1) && slab(oy, dy, 0, bx.h) && slab(oz, dz, bx.z0, bx.z1) && t0 < best) best = t0;
        }
        for (const c of e.c) {
          // treat as vertical cylinder
          const fx = ox - c.x, fz = oz - c.z;
          const A = dx * dx + dz * dz, Bq = 2 * (fx * dx + fz * dz), Cq = fx * fx + fz * fz - c.r * c.r;
          const disc = Bq * Bq - 4 * A * Cq;
          if (disc < 0 || A < 1e-8) continue;
          const t = (-Bq - Math.sqrt(disc)) / (2 * A);
          const y = oy + dy * t;
          if (t > 0 && t < best && y > 0 && y < c.h) best = t;
        }
      }
    }
    return best;
  }

  nearestNode(x: number, z: number) {
    const i = Math.max(0, Math.min(N, Math.round(x / P + N / 2)));
    const j = Math.max(0, Math.min(N, Math.round(z / P + N / 2)));
    return { i, j };
  }

  /** A* over the intersection grid; returns node list */
  route(ax: number, az: number, bx: number, bz: number): { i: number; j: number }[] {
    const s = this.nearestNode(ax, az), g = this.nearestNode(bx, bz);
    const W = N + 1;
    const key = (i: number, j: number) => j * W + i;
    const open: { i: number; j: number; f: number }[] = [{ ...s, f: 0 }];
    const came = new Map<number, number>();
    const gs = new Map<number, number>([[key(s.i, s.j), 0]]);
    const closed = new Set<number>();
    while (open.length) {
      open.sort((a, b) => a.f - b.f);
      const cur = open.shift()!;
      const ck = key(cur.i, cur.j);
      if (cur.i === g.i && cur.j === g.j) {
        const path = [{ i: cur.i, j: cur.j }];
        let k = ck;
        while (came.has(k)) { k = came.get(k)!; path.push({ i: k % W, j: Math.floor(k / W) }); }
        return path.reverse();
      }
      if (closed.has(ck)) continue;
      closed.add(ck);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = cur.i + di, nj = cur.j + dj;
        if (ni < 0 || nj < 0 || ni > N || nj > N) continue;
        const nk = key(ni, nj);
        const ng = gs.get(ck)! + 1;
        if (ng < (gs.get(nk) ?? 1e9)) {
          gs.set(nk, ng);
          came.set(nk, ck);
          open.push({ i: ni, j: nj, f: ng + Math.abs(ni - g.i) + Math.abs(nj - g.j) });
        }
      }
    }
    return [s];
  }

  randomRoadSpawn(rng: RNG = this.rng) {
    const horizontal = rng() < 0.5;
    const k = Math.floor(rng() * (N + 1));
    const t = (rng() - 0.5) * (N * P - 40);
    const off = pick(LANE, rng);
    const pos = (k - N / 2) * P;
    if (horizontal) {
      // road along x at z=pos; heading +x uses lane on the right (−z side when facing +x)
      const dirPos = rng() < 0.5;
      return { x: t, z: pos + (dirPos ? -off : off), h: dirPos ? Math.PI / 2 : -Math.PI / 2 };
    }
    const dirPos = rng() < 0.5;
    return { x: pos + (dirPos ? off : -off), z: t, h: dirPos ? 0 : Math.PI };
  }

  updateSea(sky: Sky, t: number) { updateWater(this.sea, sky, t); }

  // ---------------------------------------------------------------- per-frame
  update(dt: number, t: number, focus: THREE.Vector3, night: number) {
    this.nightF = night;
    windUniform.value = t;
    for (const m of this.facadeMats) m.emissiveIntensity = night * 0.85;
    this.lampMat.emissiveIntensity = night * 2.2;
    (this.glow.material as THREE.PointsMaterial).opacity = Math.min(1, night * 1.1) * 0.55;
    if (this.aviation) (this.aviation.material as THREE.PointsMaterial).opacity = Math.min(1, night * 1.6 + 0.1) * (Math.sin(t * 2.6) > 0.15 ? 0.95 : 0.12);
    for (const m of this.signMats) m.emissiveIntensity = 0.35 + night * 0.9;
    if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) this.updateSignals(t);
    // assign pooled lights to nearest lamps
    if (night > 0.15) {
      const near = this.lampPos
        .map((p) => ({ p, d: p.distanceToSquared(focus) }))
        .filter((o) => o.d < 70 * 70)
        .sort((a, b) => a.d - b.d)
        .slice(0, this.lampLights.length);
      this.lampLights.forEach((l, i) => {
        const o = near[i];
        if (o) { l.position.copy(o.p); l.intensity = night * 140; } else l.intensity = 0;
      });
    } else this.lampLights.forEach((l) => (l.intensity = 0));
  }
}
