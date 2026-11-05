import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Merger, M4, makeCanvas, mulberry32, speckle, texFrom } from './geo';

// ---------------------------------------------------------------- layout constants
export const N = 8; // blocks per side
export const P = 76; // road-to-road pitch
export const B = 60; // block size
export const R = 16; // road width
export const SIDEWALK_H = 0.15;
export const c = (i: number) => (i - N / 2) * P; // road line coordinate
export const bc = (i: number) => (i + 0.5 - N / 2) * P; // block centre
export const WORLD = { minX: -372, maxX: 474, minZ: -372, maxZ: 372 };
export const nodePos = (i: number, j: number) => ({ x: c(i), z: c(j) });
export const blockCorner = (i: number, j: number, sx: number, sz: number) => ({ x: bc(i) + sx * 28, z: bc(j) + sz * 28 });

export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number; h: number }
export interface Hit { x: number; z: number; nx: number; nz: number; hit: boolean }

/** 0 green, 1 yellow, 2 red for traffic travelling along `axis`. */
export function signal(axis: 'x' | 'z', t: number): 0 | 1 | 2 {
  const k = ((t % 20) + 20) % 20;
  if (axis === 'x') return k < 8 ? 0 : k < 10 ? 1 : 2;
  return k < 10 ? 2 : k < 18 ? 0 : 1;
}

export interface City {
  group: THREE.Group;
  resolve(x: number, z: number, r: number, out: Hit): boolean;
  blockedAt(x: number, y: number, z: number): boolean;
  groundY(x: number, z: number): number;
  drawMap(ctx: CanvasRenderingContext2D): void;
  update(t: number, dt: number): void;
  towerTop: { x: number; y: number; z: number };
}

const blockIndex = (v: number) => Math.floor((v + 296) / P);
const inBlock = (v: number) => ((((v + 296) % P) + P) % P) < B;

// ---------------------------------------------------------------- textures
function makeFacade(rng: () => number) {
  const S = 1024, cells = 8, cs = S / cells;
  const A = makeCanvas(S, S), E = makeCanvas(S, S), Rr = makeCanvas(S, S);
  E.g.fillStyle = '#000';
  E.g.fillRect(0, 0, S, S);
  Rr.g.fillStyle = '#dcdcdc';
  Rr.g.fillRect(0, 0, S, S);
  const warm = ['#ffd08a', '#ffc070', '#ffe3b0', '#ffb860'];
  const cool = ['#cfe6ff', '#a8d4ff', '#8fc0ff'];
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const x = cx * cs, y = cy * cs;
      const tone = 196 + Math.floor(rng() * 22);
      A.g.fillStyle = `rgb(${tone},${tone - 4},${tone - 11})`;
      A.g.fillRect(x, y, cs, cs);
      A.g.fillStyle = 'rgba(0,0,0,0.2)';
      A.g.fillRect(x, y + cs - 14, cs, 14);
      A.g.fillStyle = 'rgba(255,255,255,0.14)';
      A.g.fillRect(x, y, 7, cs);
      const wx = x + 16, wy = y + 16, ww = cs - 32, wh = cs - 46;
      const gr = A.g.createLinearGradient(0, wy, 0, wy + wh);
      gr.addColorStop(0, '#34506b');
      gr.addColorStop(1, '#0f1a27');
      A.g.fillStyle = gr;
      A.g.fillRect(wx, wy, ww, wh);
      A.g.fillStyle = 'rgba(255,196,150,0.17)';
      A.g.beginPath();
      A.g.moveTo(wx, wy + wh * 0.55);
      A.g.lineTo(wx + ww * 0.55, wy);
      A.g.lineTo(wx + ww * 0.85, wy);
      A.g.lineTo(wx, wy + wh * 0.9);
      A.g.fill();
      A.g.strokeStyle = '#a7a196';
      A.g.lineWidth = 5;
      A.g.strokeRect(wx, wy, ww, wh);
      A.g.lineWidth = 3;
      A.g.beginPath();
      A.g.moveTo(wx + ww / 2, wy);
      A.g.lineTo(wx + ww / 2, wy + wh);
      A.g.stroke();
      Rr.g.fillStyle = '#2b2b2b';
      Rr.g.fillRect(wx, wy, ww, wh);
      if (rng() < 0.4) {
        const g2 = E.g.createLinearGradient(0, wy, 0, wy + wh);
        const col = rng() < 0.8 ? warm[Math.floor(rng() * warm.length)] : cool[Math.floor(rng() * cool.length)];
        g2.addColorStop(0, col);
        g2.addColorStop(1, '#7a4a20');
        E.g.fillStyle = g2;
        E.g.fillRect(wx + 3, wy + 3, ww - 6, wh - 6);
        if (rng() < 0.45) {
          E.g.fillStyle = 'rgba(0,0,0,0.38)';
          E.g.fillRect(wx + 3, wy + 3, (ww - 6) * (0.2 + rng() * 0.35), wh - 6);
        }
        E.g.fillStyle = '#000';
        E.g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
      }
    }
  }
  speckle(A.g, S, S, 9000, rng, 0.05);
  return {
    map: texFrom(A.c, { aniso: 8 }),
    emi: texFrom(E.c, { aniso: 4 }),
    rough: texFrom(Rr.c, { srgb: false, aniso: 4 }),
  };
}

function makeRoadTextures(rng: () => number) {
  const asphalt = '#2b2c30';
  const seg = makeCanvas(960, 256);
  const g = seg.g;
  g.fillStyle = asphalt;
  g.fillRect(0, 0, 960, 256);
  g.fillStyle = 'rgba(0,0,0,0.13)';
  for (const y of [32, 96, 160, 224]) {
    g.fillRect(0, y - 14, 960, 9);
    g.fillRect(0, y + 5, 960, 9);
  }
  speckle(g, 960, 256, 14000, rng, 0.09);
  g.fillStyle = '#d8b43a';
  g.fillRect(0, 122, 960, 4);
  g.fillRect(0, 130, 960, 4);
  g.fillStyle = 'rgba(240,240,240,0.9)';
  for (const y of [64, 192]) for (let x = 70; x < 880; x += 112) g.fillRect(x, y - 2, 56, 4);
  g.fillRect(0, 5, 960, 4);
  g.fillRect(0, 247, 960, 4);
  for (const x0 of [8, 904]) for (let y = 12; y < 244; y += 21) g.fillRect(x0, y, 48, 11);
  g.fillRect(884, 10, 10, 116);
  g.fillRect(66, 136, 10, 112);

  const inter = makeCanvas(256, 256);
  inter.g.fillStyle = asphalt;
  inter.g.fillRect(0, 0, 256, 256);
  speckle(inter.g, 256, 256, 3500, rng, 0.09);

  const walk = makeCanvas(256, 256);
  walk.g.fillStyle = '#9d9ea2';
  walk.g.fillRect(0, 0, 256, 256);
  speckle(walk.g, 256, 256, 3000, rng, 0.1);
  walk.g.strokeStyle = 'rgba(40,40,46,0.55)';
  walk.g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    walk.g.beginPath();
    walk.g.moveTo(i, 0);
    walk.g.lineTo(i, 256);
    walk.g.moveTo(0, i);
    walk.g.lineTo(256, i);
    walk.g.stroke();
  }

  const grass = makeCanvas(256, 256);
  grass.g.fillStyle = '#3d6a35';
  grass.g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7000; i++) {
    const l = 28 + rng() * 22;
    grass.g.fillStyle = `hsla(${88 + rng() * 30},${40 + rng() * 25}%,${l}%,${0.2 + rng() * 0.4})`;
    grass.g.fillRect(rng() * 256, rng() * 256, 2, 2 + rng() * 3);
  }

  const conc = makeCanvas(256, 256);
  conc.g.fillStyle = '#5a5b60';
  conc.g.fillRect(0, 0, 256, 256);
  speckle(conc.g, 256, 256, 5000, rng, 0.12);
  conc.g.strokeStyle = 'rgba(20,20,24,0.5)';
  conc.g.lineWidth = 2;
  conc.g.strokeRect(1, 1, 254, 254);

  return {
    seg: texFrom(seg.c, { aniso: 16 }),
    inter: texFrom(inter.c),
    walk: texFrom(walk.c),
    grass: texFrom(grass.c),
    conc: texFrom(conc.c),
  };
}

function makeWaterNormal() {
  const S = 256;
  const { c: cv, g } = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  const h = (x: number, y: number) => {
    const u = (x / S) * Math.PI * 2, v = (y / S) * Math.PI * 2;
    return Math.sin(u * 3 + Math.sin(v * 2) * 1.5) * 0.5 + Math.sin(v * 5 + u * 2) * 0.3 + Math.sin(u * 9 - v * 7) * 0.12;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const nx = -dx * 2.2, ny = -dy * 2.2, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * S + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = texFrom(cv, { srgb: false, aniso: 4 });
  t.repeat.set(500, 500);
  return t;
}

function makeSignTexture(text: string, color: string, glow: string) {
  const { c: cv, g } = makeCanvas(1024, 256);
  g.fillStyle = '#07040c';
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = glow;
  g.lineWidth = 8;
  g.strokeRect(12, 12, 1000, 232);
  g.font = '900 150px Impact, "Bebas Neue", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = glow;
  g.shadowBlur = 36;
  g.fillStyle = color;
  g.fillText(text, 512, 134);
  g.fillText(text, 512, 134);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- helpers
function withColor(g: THREE.BufferGeometry, r: number, gr: number, b: number) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = r;
    a[i * 3 + 1] = gr;
    a[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function leafy(radius: number, detail: number, amp: number) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (hash3(Math.round(x * 20), Math.round(y * 20), Math.round(z * 20)) - 0.5) * amp;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

function inst(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], colors?: THREE.Color[], cast = true) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  if (colors) colors.forEach((cl, i) => im.setColorAt(i, cl));
  im.count = mats.length;
  im.castShadow = cast;
  im.receiveShadow = true;
  im.frustumCulled = false;
  im.instanceMatrix.needsUpdate = true;
  return im;
}

// ---------------------------------------------------------------- city
export function buildCity(): City {
  const rng = mulberry32(20240607);
  const group = new THREE.Group();
  const grid = new Map<number, AABB[]>();
  const extras: AABB[] = [];
  const PARKS = new Set(['3,4', '1,6', '6,1', '6,5']);
  const addCollider = (a: AABB, bi: number, bj: number) => {
    const k = bi * 16 + bj;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(a);
  };

  const fac = makeFacade(rng);
  const rt = makeRoadTextures(rng);

  const wallMat = new THREE.MeshStandardMaterial({
    map: fac.map, emissiveMap: fac.emi, emissive: 0xffffff, emissiveIntensity: 2.4,
    roughnessMap: fac.rough, roughness: 1, metalness: 0.12, vertexColors: true,
  });
  const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.1 });
  const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  const walls: THREE.BufferGeometry[] = [];
  const roof = new Merger();
  const neon = new Merger();
  const props = new Merger();

  function wallBox(cx: number, cz: number, w: number, d: number, y0: number, h: number, col: THREE.Color) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(cx, y0 + h / 2, cz);
    const p = g.attributes.position, nr = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(nr.getY(i)) > 0.5) uv.setXY(i, 0.004, 0.004);
      else {
        const alongX = Math.abs(nr.getX(i)) < 0.5;
        const u = (alongX ? p.getX(i) - (cx - w / 2) : p.getZ(i) - (cz - d / 2)) / 25.6;
        uv.setXY(i, u, p.getY(i) / 32);
      }
    }
    withColor(g, col.r, col.g, col.b);
    walls.push(g);
  }

  // ---- palettes
  const glass = [0xb4c6d6, 0x9db5c8, 0xc6d0da, 0xa5b2c4, 0x8fa6b8].map((x) => new THREE.Color(x));
  const warm = [0xe0cdae, 0xcdb99d, 0xe6dccc, 0xc2a28f, 0xafc0a6, 0xd7b9a0, 0xe9e3d8].map((x) => new THREE.Color(x));
  const neonCols = [0xff2e93, 0x19e3ff, 0xffa31a, 0x9bff3a, 0xb04dff, 0xff4a3d];
  const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)];

  let tallest = { h: 0, x: 0, z: 0, w: 0, d: 0 };

  function building(cx: number, cz: number, w0: number, d0: number, zone: number, dd: number, bi: number, bj: number) {
    const w = Math.max(9.6, Math.round(w0 / 3.2) * 3.2);
    const d = Math.max(9.6, Math.round(d0 / 3.2) * 3.2);
    let h: number;
    if (zone === 2) h = 56 + rng() * Math.max(30, 160 - dd * 38);
    else if (zone === 1) h = 24 + rng() * 44;
    else h = 10 + rng() * 20;
    h = Math.round(h / 4) * 4;
    const col = (zone === 2 ? pick(glass) : rng() < 0.3 ? pick(glass) : pick(warm)).clone();
    col.multiplyScalar(0.85 + rng() * 0.25);
    addCollider({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h }, bi, bj);

    const tiers: { w: number; d: number; y0: number; h: number }[] = [];
    if (h > 44) {
      const h1 = Math.round((h * 0.58) / 4) * 4;
      const h2 = Math.round((h * 0.3) / 4) * 4;
      const h3 = h - h1 - h2;
      tiers.push({ w, d, y0: SIDEWALK_H, h: h1 });
      tiers.push({ w: Math.max(9.6, Math.round((w * 0.72) / 3.2) * 3.2), d: Math.max(9.6, Math.round((d * 0.72) / 3.2) * 3.2), y0: SIDEWALK_H + h1, h: h2 });
      if (h3 >= 8) tiers.push({ w: Math.max(6.4, Math.round((w * 0.45) / 3.2) * 3.2), d: Math.max(6.4, Math.round((d * 0.45) / 3.2) * 3.2), y0: SIDEWALK_H + h1 + h2, h: h3 });
    } else tiers.push({ w, d, y0: SIDEWALK_H, h });

    tiers.forEach((t, k) => {
      wallBox(cx, cz, t.w, t.d, t.y0, t.h, col);
      // cornice
      roof.box(t.w + 0.7, 0.7, t.d + 0.7, cx, t.y0 + t.h + 0.2, cz, 0x5a5a60);
      roof.box(t.w - 0.6, 0.35, t.d - 0.6, cx, t.y0 + t.h + 0.62, cz, 0x303034);
      if (k === tiers.length - 1) {
        const top = t.y0 + t.h + 0.8;
        const n = 1 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const ux = cx + (rng() - 0.5) * (t.w - 4), uz = cz + (rng() - 0.5) * (t.d - 4);
          roof.box(2.4, 1.3, 1.8, ux, top + 0.65, uz, 0x8a8d92);
          roof.box(1.6, 0.2, 1.2, ux, top + 1.4, uz, 0x55585d);
        }
        if (h < 50 && rng() < 0.5) {
          roof.add(new THREE.CylinderGeometry(1.5, 1.5, 3, 12), 0x6d4a35, M4(cx + (rng() - 0.5) * (t.w - 5), top + 2.8, cz + (rng() - 0.5) * (t.d - 5)));
        }
        if (h > 60) {
          roof.add(new THREE.CylinderGeometry(0.12, 0.2, 16, 6), 0xbbbbbb, M4(cx, top + 8, cz));
          neon.add(new THREE.SphereGeometry(0.55, 10, 8), 0xff2010, M4(cx, top + 16.3, cz), 5);
        }
      }
    });

    if (h > tallest.h && zone === 2) tallest = { h, x: cx, z: cz, w, d };

    // neon & signage on faces that look at roads
    if (zone >= 1 || rng() < 0.45) {
      const faces: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const nf = 1 + (rng() < 0.5 ? 1 : 0);
      for (let k = 0; k < nf; k++) {
        const [fx, fz] = pick(faces);
        const col2 = pick(neonCols);
        const faceLen = fx !== 0 ? d : w;
        const px = cx + fx * (w / 2 + 0.12), pz = cz + fz * (d / 2 + 0.12);
        // storefront strip
        if (rng() < 0.75) {
          if (fx !== 0) neon.box(0.14, 0.2, faceLen * 0.9, px, 4.3, pz, col2, 3.2);
          else neon.box(faceLen * 0.9, 0.2, 0.14, px, 4.3, pz, col2, 3.2);
        }
        // blade sign
        if (zone >= 1 && rng() < 0.6) {
          const off = (rng() - 0.5) * faceLen * 0.6;
          const bx = fx !== 0 ? px + fx * 0.7 : cx + off;
          const bz = fx !== 0 ? cz + off : pz + fz * 0.7;
          const bh = 3 + rng() * 5;
          const by = 6 + rng() * 6;
          if (fx !== 0) {
            props.box(1.3, bh + 0.4, 0.3, bx, by, bz, 0x111114);
            neon.box(1.1, bh, 0.34, bx, by, bz, col2, 3);
          } else {
            props.box(0.3, bh + 0.4, 1.3, bx, by, bz, 0x111114);
            neon.box(0.34, bh, 1.1, bx, by, bz, col2, 3);
          }
        }
      }
    }
  }

  // ---- sidewalks, lots, parks
  const slabsWalk: THREE.BufferGeometry[] = [];
  const slabsGrass: THREE.BufferGeometry[] = [];
  const slab = (cx: number, cz: number, list: THREE.BufferGeometry[], tint: THREE.Color, rep: number) => {
    const g = new THREE.BoxGeometry(B, SIDEWALK_H, B);
    g.translate(cx, SIDEWALK_H / 2, cz);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rep, uv.getY(i) * rep);
    withColor(g, tint.r, tint.g, tint.b);
    list.push(g);
  };

  const lampX: THREE.Matrix4[] = [];
  const treeX: THREE.Matrix4[] = [];
  const treeC: THREE.Color[] = [];
  const palmX: THREE.Matrix4[] = [];
  const palmC: THREE.Color[] = [];
  const white = new THREE.Color(1, 1, 1);
  const edgeDirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const cx = bc(i), cz = bc(j);
      const isPark = PARKS.has(`${i},${j}`);
      slab(cx, cz, isPark ? slabsGrass : slabsWalk, isPark ? white : white, isPark ? 12 : 16);

      // street furniture along block edges
      for (const [dx, dz] of edgeDirs) {
        const tx = Math.abs(dz), tz = Math.abs(dx);
        for (const s of [-15, 15]) {
          const x = cx + dx * 28.6 + tx * s, z = cz + dz * 28.6 + tz * s;
          lampX.push(M4(x, SIDEWALK_H, z, 0, Math.atan2(-dz, dx), 0));
        }
        for (const s of [-21, 0, 21]) {
          if (rng() < (isPark ? 0.9 : 0.55)) {
            const x = cx + dx * 27 + tx * s, z = cz + dz * 27 + tz * s;
            const sc = 0.8 + rng() * 0.5;
            treeX.push(M4(x, SIDEWALK_H, z, 0, rng() * 6.28, 0, sc, sc * (0.9 + rng() * 0.3), sc));
            treeC.push(new THREE.Color().setHSL(0.27 + rng() * 0.06, 0.45, 0.42 + rng() * 0.12).multiplyScalar(1.1));
          }
        }
      }

      if (isPark) {
        props.box(5, 0.05, 52, cx, SIDEWALK_H + 0.03, cz, 0xb4a58a);
        props.box(52, 0.05, 5, cx, SIDEWALK_H + 0.03, cz, 0xb4a58a);
        props.add(new THREE.CylinderGeometry(10, 10, 0.1, 40), 0x9a9a9a, M4(cx, SIDEWALK_H + 0.05, cz));
        props.add(new THREE.CylinderGeometry(8.4, 8.4, 0.12, 40), 0x1b5a78, M4(cx, SIDEWALK_H + 0.07, cz));
        props.add(new THREE.CylinderGeometry(1.2, 1.5, 1.4, 16), 0xaaaaaa, M4(cx, SIDEWALK_H + 0.8, cz));
        for (let k = 0; k < 26; k++) {
          const a = rng() * Math.PI * 2, r = 13 + rng() * 14;
          const x = cx + Math.cos(a) * r * 0.95, z = cz + Math.sin(a) * r * 0.95;
          if (Math.abs(x - cx) < 4 || Math.abs(z - cz) < 4 || Math.abs(x - cx) > 26 || Math.abs(z - cz) > 26) continue;
          const sc = 0.9 + rng() * 0.7;
          if (rng() < 0.35) {
            palmX.push(M4(x, SIDEWALK_H, z, 0, rng() * 6.28, 0, sc, sc, sc));
            palmC.push(white);
          } else {
            treeX.push(M4(x, SIDEWALK_H, z, 0, rng() * 6.28, 0, sc * 1.1, sc * 1.1, sc * 1.1));
            treeC.push(new THREE.Color().setHSL(0.25 + rng() * 0.08, 0.5, 0.4 + rng() * 0.12));
          }
        }
        for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          props.box(2.4, 0.5, 0.7, cx + dx * 4.5, SIDEWALK_H + 0.3, cz + dz * 12, 0x7a5a3a, 1, 0);
        }
        continue;
      }

      const dd = Math.hypot(i - 3.5, j - 3.5);
      const zone = dd < 2.1 ? 2 : dd < 3.7 ? 1 : 0;
      const r = rng();
      const layout = zone === 2 ? (r < 0.4 ? 'mono' : r < 0.75 ? 'dual' : 'quad') : zone === 1 ? (r < 0.15 ? 'mono' : r < 0.5 ? 'dual' : 'quad') : r < 0.25 ? 'dual' : 'quad';
      const U = 52;
      if (layout === 'mono') {
        building(cx, cz, 40 + rng() * 10, 40 + rng() * 10, zone, dd, i, j);
      } else if (layout === 'dual') {
        const alongX = rng() < 0.5;
        for (const s of [-1, 1]) {
          const ox = alongX ? s * 13.8 : 0, oz = alongX ? 0 : s * 13.8;
          building(cx + ox, cz + oz, alongX ? 24 + rng() * 2 : U - 5 - rng() * 4, alongX ? U - 5 - rng() * 4 : 24 + rng() * 2, zone, dd, i, j);
        }
      } else {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          building(cx + sx * 13.8, cz + sz * 13.8, 20 + rng() * 5, 20 + rng() * 5, zone, dd, i, j);
        }
      }
    }
  }

  // palms along the outskirts / coast
  for (let k = -11; k <= 11; k++) {
    const s = k * 30;
    const sc = 1 + rng() * 0.3;
    palmX.push(M4(s, 0, -362, 0, rng() * 6, 0, sc, sc, sc), M4(s, 0, 362, 0, rng() * 6, 0, sc, sc, sc));
    if (Math.abs(s) < 340) palmX.push(M4(-362, 0, s, 0, rng() * 6, 0, sc, sc, sc));
    palmC.push(white, white);
    if (Math.abs(s) < 340) palmC.push(white);
  }

  // walls + city meshes
  const wallGeo = mergeGeometries(walls, false)!;
  const wallMesh = new THREE.Mesh(wallGeo, wallMat);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  group.add(wallMesh);

  const mkMesh = (geo: THREE.BufferGeometry | null, mat: THREE.Material, cast: boolean, recv = true) => {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = recv;
    group.add(m);
    return m;
  };
  mkMesh(roof.build(), trimMat, true);
  mkMesh(neon.build(), neonMat, false, false);

  const walkMat = new THREE.MeshStandardMaterial({ map: rt.walk, vertexColors: true, roughness: 0.85, metalness: 0 });
  const grassMat = new THREE.MeshStandardMaterial({ map: rt.grass, vertexColors: true, roughness: 0.95 });
  mkMesh(mergeGeometries(slabsWalk, false), walkMat, false);
  mkMesh(mergeGeometries(slabsGrass, false), grassMat, false);

  // ---- roads
  const roadSeg: THREE.BufferGeometry[] = [];
  const roadInt: THREE.BufferGeometry[] = [];
  const segGeo = (x: number, z: number, alongX: boolean, len = B) => {
    const g = new THREE.PlaneGeometry(len, R);
    g.rotateX(-Math.PI / 2);
    if (!alongX) g.rotateY(Math.PI / 2);
    g.translate(x, 0.04, z);
    return g;
  };
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j < N; j++) {
      const mid = (c(j) + c(j + 1)) / 2;
      roadSeg.push(segGeo(mid, c(i), true)); // E-W road on z=c(i)
      roadSeg.push(segGeo(c(i), mid, false)); // N-S road on x=c(i)
    }
    for (let j = 0; j <= N; j++) {
      const g = new THREE.PlaneGeometry(R, R);
      g.rotateX(-Math.PI / 2);
      g.translate(c(i), 0.041, c(j));
      roadInt.push(g);
    }
  }
  // harbour road extension on z=0
  for (let k = 0; k < 2; k++) roadSeg.push(segGeo(c(N) + R / 2 + B / 2 + k * B, 0, true));
  const roadMat = new THREE.MeshStandardMaterial({ map: rt.seg, roughness: 0.5, metalness: 0.1 });
  const intMat = new THREE.MeshStandardMaterial({ map: rt.inter, roughness: 0.5, metalness: 0.1 });
  for (const m of [roadMat, intMat]) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
  }
  mkMesh(mergeGeometries(roadSeg, false), roadMat, false);
  mkMesh(mergeGeometries(roadInt, false), intMat, false);

  // ---- land & sea
  const landGeo = new THREE.BoxGeometry(860, 3, 752);
  landGeo.translate(50, -1.5, 0);
  rt.conc.repeat.set(143, 125);
  const land = new THREE.Mesh(landGeo, new THREE.MeshStandardMaterial({ map: rt.conc, roughness: 0.95 }));
  land.receiveShadow = true;
  group.add(land);

  const waterN = makeWaterNormal();
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0b3047, roughness: 0.06, metalness: 0.25, normalMap: waterN, normalScale: new THREE.Vector2(0.6, 0.6) })
  );
  sea.position.y = -1.4;
  group.add(sea);

  // ---- harbour
  const yardTex = rt.walk.clone();
  yardTex.repeat.set(28, 50);
  yardTex.needsUpdate = true;
  const yard = new THREE.Mesh(
    new THREE.PlaneGeometry(168, 300).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8a8b90, map: yardTex, roughness: 0.9 })
  );
  yard.position.set(396, 0.03, 0);
  yard.receiveShadow = true;
  group.add(yard);
  props.box(1.2, 0.05, 300, 478, 0.08, 0, 0xf2c230);
  props.box(168, 0.05, 1, 396, 0.08, 150, 0xf2c230);
  props.box(168, 0.05, 1, 396, 0.08, -150, 0xf2c230);

  const contX: THREE.Matrix4[] = [];
  const contC: THREE.Color[] = [];
  const contCols = [0xb5382e, 0x2e5fa5, 0xd4a017, 0x2f7d57, 0xe0e0e0, 0x7a3b8c, 0xd2691e, 0x1f8aa0];
  for (const xc of [340, 355, 372, 400, 415, 430]) {
    for (const sgn of [-1, 1]) {
      for (let zz = 24; zz < 140; zz += 3.2) {
        if (rng() < 0.18) continue;
        const lv = 1 + Math.floor(rng() * 3);
        for (let l = 0; l < lv; l++) {
          contX.push(M4(xc, 1.3 + l * 2.6, sgn * zz, 0, 0, 0));
          contC.push(new THREE.Color(pick(contCols)).multiplyScalar(0.9 + rng() * 0.2));
        }
        extras.push({ minX: xc - 6.2, maxX: xc + 6.2, minZ: sgn * zz - 1.35, maxZ: sgn * zz + 1.35, h: lv * 2.6 });
      }
    }
  }
  const contGeo = new THREE.BoxGeometry(12.2, 2.5, 2.4);
  const contMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.35 });
  group.add(inst(contGeo, contMat, contX, contC));

  // cranes
  const crane = new Merger();
  for (const z0 of [-95, -55, 60, 100]) {
    for (const lx of [451, 470]) for (const lz of [-8, 8]) {
      crane.box(2, 42, 2, lx, 21, z0 + lz, 0xd9421e);
      extras.push({ minX: lx - 1, maxX: lx + 1, minZ: z0 + lz - 1, maxZ: z0 + lz + 1, h: 42 });
    }
    crane.box(22, 2.4, 20, 460.5, 42, z0, 0xe8e8e8);
    crane.box(90, 2.6, 2.6, 490, 46, z0, 0xd9421e);
    crane.box(8, 5, 6, 462, 45, z0, 0xf2f2f2);
    crane.box(1, 1, 22, 451, 33, z0, 0x444444);
    for (let k = 0; k < 6; k++) crane.box(0.6, 12, 0.6, 450 + k * 8, 40, z0 + 1.5, 0x777777, 1, 0);
    neon.add(new THREE.SphereGeometry(0.6, 8, 6), 0xff2010, M4(536, 47.8, z0), 5);
  }
  mkMesh(crane.build(), trimMat, true);

  // ship
  const ship = new Merger();
  ship.box(30, 10, 200, 496, 2, -20, 0x1c2733);
  ship.box(30.4, 2.2, 200.4, 496, 0.6, -20, 0x9c1f1f);
  ship.box(26, 0.6, 190, 496, 7.3, -20, 0x5c5e63);
  for (let k = 0; k < 16; k++) for (let r = 0; r < 4; r++) {
    const lv = 1 + Math.floor(rng() * 3);
    for (let l = 0; l < lv; l++) {
      ship.box(2.4, 2.5, 12.2, 488.5 + r * 5.0, 8.8 + l * 2.6, -105 + k * 12.8, pick(contCols), 1, 0);
    }
  }
  ship.box(14, 16, 18, 496, 16, 70, 0xf0f0f0);
  ship.box(15, 3, 19, 496, 25, 70, 0xd0d0d0);
  ship.box(5, 8, 5, 496, 29, 78, 0xb5382e);
  const shipM = mkMesh(ship.build(), trimMat, true);
  if (shipM) shipM.frustumCulled = false;
  neon.add(new THREE.BoxGeometry(14.2, 1.6, 18.2), 0x9fd8ff, M4(496, 18, 70), 1.3);

  // perimeter barriers
  const barrier = new Merger();
  barrier.box(850, 0.9, 1, 50, 0.45, -374, 0x888890);
  barrier.box(850, 0.9, 1, 50, 0.45, 374, 0x888890);
  barrier.box(1, 0.9, 750, -374, 0.45, 0, 0x888890);
  mkMesh(barrier.build(), trimMat, false);

  // ---- props merged
  mkMesh(props.build(), trimMat, true);

  // ---- instanced furniture
  const lampPole = new Merger();
  lampPole.add(new THREE.CylinderGeometry(0.1, 0.16, 9, 8), 0x3a3d42, M4(0, 4.5, 0));
  lampPole.box(2.3, 0.12, 0.12, 1.1, 9, 0, 0x3a3d42);
  lampPole.box(0.5, 0.5, 0.5, 0, 0.25, 0, 0x2a2c30);
  group.add(inst(lampPole.build()!, trimMat, lampX));
  const lampHead = new THREE.BoxGeometry(0.95, 0.14, 0.42);
  lampHead.translate(2.15, 8.92, 0);
  const lampHeadMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(4.5, 3.0, 1.6) });
  group.add(inst(lampHead, lampHeadMat, lampX, undefined, false));

  const treeM = new Merger();
  treeM.add(new THREE.CylinderGeometry(0.16, 0.26, 3.2, 8), 0x5a3f2a, M4(0, 1.6, 0));
  treeM.add(leafy(2.3, 2, 0.28), 0x4c8a3a, M4(0, 4.7, 0, 0, 0, 0, 1, 0.9, 1));
  treeM.add(leafy(1.6, 2, 0.3), 0x5a9a44, M4(1.2, 4.0, 0.5));
  treeM.add(leafy(1.5, 2, 0.3), 0x3e7a32, M4(-1.1, 4.3, -0.7));
  treeM.add(leafy(1.3, 2, 0.3), 0x66a84c, M4(0.2, 6.0, -0.2));
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  group.add(inst(treeM.build()!, treeMat, treeX, treeC));

  // palms
  const palm = new Merger();
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.25, 3, 0), new THREE.Vector3(0.8, 6, 0), new THREE.Vector3(1.5, 8.6, 0)]);
  palm.add(new THREE.TubeGeometry(curve, 10, 0.22, 8), 0x8a6a4a);
  for (let f = 0; f < 9; f++) {
    const fg = new THREE.PlaneGeometry(1.1, 4.4, 1, 6);
    const p = fg.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k);
      const t = (y + 2.2) / 4.4;
      const wdt = Math.sin(Math.PI * (t * 0.88 + 0.06)) * 0.9;
      p.setXYZ(k, t * 4.1, 1.1 * t - 2.1 * t * t, x * wdt);
    }
    fg.computeVertexNormals();
    palm.add(fg, f % 2 ? 0x3f8a3a : 0x2f7a30, M4(1.5, 8.6, 0, 0, (f / 9) * Math.PI * 2, 0.0));
  }
  const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  group.add(inst(palm.build()!, palmMat, palmX, palmC));

  // ---- traffic signals
  const sigPole = new Merger();
  const sigXm: THREE.Matrix4[] = [];
  const sigZm: THREE.Matrix4[] = [];
  const sigPos: { x: number; z: number }[] = [];
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = c(i) + sx * 9.6, pz = c(j) + sz * 9.6;
        sigPole.box(0.24, 6.2, 0.24, px, 3.1, pz, 0x2e3035);
        sigPole.box(0.5, 1.5, 0.5, px - sx * 0.35, 5.5, pz - sz * 0.35, 0x151517);
        sigXm.push(M4(px - sx * 0.35, 5.95, pz - sz * 0.35));
        sigZm.push(M4(px - sx * 0.35, 5.2, pz - sz * 0.35));
        sigPos.push({ x: px, z: pz });
      }
    }
  }
  mkMesh(sigPole.build(), trimMat, false);
  const sigMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const sigGeo = new THREE.SphereGeometry(0.27, 10, 8);
  const sigX = inst(sigGeo, sigMat, sigXm, sigXm.map(() => white), false);
  const sigZ = inst(sigGeo, sigMat, sigZm, sigZm.map(() => white), false);
  group.add(sigX, sigZ);
  const sigCols = [new THREE.Color().setRGB(0.3, 3.2, 0.9), new THREE.Color().setRGB(3.4, 2.4, 0.2), new THREE.Color().setRGB(3.6, 0.2, 0.15)];
  let lastPhase = '';
  const setSignals = (t: number) => {
    const sx = signal('x', t), sz = signal('z', t);
    const key = `${sx}${sz}`;
    if (key === lastPhase) return;
    lastPhase = key;
    for (let i = 0; i < sigXm.length; i++) {
      sigX.setColorAt(i, sigCols[sx]);
      sigZ.setColorAt(i, sigCols[sz]);
    }
    if (sigX.instanceColor) sigX.instanceColor.needsUpdate = true;
    if (sigZ.instanceColor) sigZ.instanceColor.needsUpdate = true;
  };
  setSignals(0);

  // ---- hero billboard on the tallest tower
  {
    const tex = makeSignTexture('APHAR DEKJO', '#ff5fb0', '#ff2e93');
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color().setRGB(1.9, 1.9, 1.9) });
    const sw = 40, sh = 10;
    const ty = tallest.h + SIDEWALK_H + 11;
    for (const side of [0, 1]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mat);
      pl.position.set(tallest.x, ty, tallest.z + (side ? -0.6 : 0.6));
      pl.rotation.y = side ? Math.PI : 0;
      group.add(pl);
    }
    const fr = new Merger();
    fr.box(sw + 1.4, sh + 1.4, 1, tallest.x, ty, tallest.z, 0x15101a);
    for (const sx of [-1, 1]) fr.box(1, 7, 1, tallest.x + sx * 14, ty - 8, tallest.z, 0x333338);
    mkMesh(fr.build(), trimMat, true);
  }

  // ---------------------------------------------------------------- queries
  const near = (x: number, z: number): AABB[] => {
    if (x > 300) return extras.concat(grid.get(7 * 16 + Math.min(7, Math.max(0, blockIndex(z)))) ?? []);
    const bi = blockIndex(x), bj = blockIndex(z);
    if (bi < 0 || bi >= N || bj < 0 || bj >= N) return [];
    return grid.get(bi * 16 + bj) ?? [];
  };

  const resolve = (x: number, z: number, r: number, out: Hit) => {
    out.x = x;
    out.z = z;
    out.hit = false;
    out.nx = 0;
    out.nz = 0;
    let hit = false;
    const list = near(x, z);
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      if (x < a.minX - r || x > a.maxX + r || z < a.minZ - r || z > a.maxZ + r) continue;
      const cx = Math.min(a.maxX, Math.max(a.minX, x));
      const cz = Math.min(a.maxZ, Math.max(a.minZ, z));
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx: number, nz: number, push: number;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
        push = r - d;
      } else {
        const l = x - a.minX, rr = a.maxX - x, t = z - a.minZ, b = a.maxZ - z;
        const m = Math.min(l, rr, t, b);
        nx = m === l ? -1 : m === rr ? 1 : 0;
        nz = m === t ? -1 : m === b ? 1 : 0;
        if (nx !== 0) nz = 0;
        push = m + r;
      }
      x += nx * push;
      z += nz * push;
      out.x = x;
      out.z = z;
      out.nx = nx;
      out.nz = nz;
      hit = true;
    }
    // world bounds
    const m = r;
    if (x < WORLD.minX + m) { x = WORLD.minX + m; out.nx = 1; out.nz = 0; hit = true; }
    if (x > WORLD.maxX - m) { x = WORLD.maxX - m; out.nx = -1; out.nz = 0; hit = true; }
    if (z < WORLD.minZ + m) { z = WORLD.minZ + m; out.nx = 0; out.nz = 1; hit = true; }
    if (z > WORLD.maxZ - m) { z = WORLD.maxZ - m; out.nx = 0; out.nz = -1; hit = true; }
    out.x = x;
    out.z = z;
    out.hit = hit;
    return hit;
  };

  const blockedAt = (x: number, y: number, z: number) => {
    if (y < 0.2) return true;
    const list = near(x, z);
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      if (x > a.minX && x < a.maxX && z > a.minZ && z < a.maxZ && y < a.h + 0.5) return true;
    }
    return false;
  };

  const groundY = (x: number, z: number) => {
    const bi = blockIndex(x), bj = blockIndex(z);
    if (bi >= 0 && bi < N && bj >= 0 && bj < N && inBlock(x) && inBlock(z)) return SIDEWALK_H;
    return 0;
  };

  const drawMap = (ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = '#0c2433';
    ctx.fillRect(WORLD.minX - 80, WORLD.minZ - 80, 1100, 900);
    ctx.fillStyle = '#17181c';
    ctx.fillRect(-380, -380, 860, 760);
    ctx.fillStyle = '#25272c';
    ctx.fillRect(312, -150, 168, 300);
    ctx.fillStyle = '#17181c';
    ctx.fillRect(312, -8, 130, 16);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      ctx.fillStyle = PARKS.has(`${i},${j}`) ? '#2b5a36' : '#2e3138';
      ctx.fillRect(bc(i) - B / 2, bc(j) - B / 2, B, B);
    }
    ctx.fillStyle = '#515764';
    grid.forEach((l) => l.forEach((a) => ctx.fillRect(a.minX, a.minZ, a.maxX - a.minX, a.maxZ - a.minZ)));
    ctx.fillStyle = '#8a6a44';
    extras.forEach((a) => ctx.fillRect(a.minX, a.minZ, a.maxX - a.minX, a.maxZ - a.minZ));
  };

  const update = (t: number, dt: number) => {
    waterN.offset.x += dt * 0.004;
    waterN.offset.y += dt * 0.0025;
    setSignals(t);
  };

  return {
    group, resolve, blockedAt, groundY, drawMap, update,
    towerTop: { x: tallest.x, y: tallest.h, z: tallest.z },
  };
}
