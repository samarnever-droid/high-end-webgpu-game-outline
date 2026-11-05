import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBuilder, matT, type Ring } from './loft';
import { carbonTex, flakeNormal, grilleTex, plateTex, signTex, treadNormal } from './textures';

export type CarKind = 'sports' | 'sedan' | 'suv' | 'muscle' | 'pickup' | 'van' | 'police' | 'taxi' | 'swat';

type Row = [number, number, number, number]; // z, bottom, top, halfWidth

export interface CarSpec {
  kind: CarKind;
  name: string;
  L: number; W: number; H: number;
  zf: number; zr: number; // axle z positions
  track: number; // half track
  wr: number; tw: number; // wheel radius & tyre width
  body: Row[];
  cabin: Row[];
  seat: { x: number; z: number; top: number };
  // physics
  mass: number; power: number; top: number; grip: number; steer: number; brake: number; price: number;
  cabinGlass?: number;
}

export const CAR_SPECS: Record<CarKind, CarSpec> = {
  sports: {
    kind: 'sports', name: 'Vortex GT', L: 4.55, W: 1.95, H: 1.28, zf: 1.43, zr: -1.38, track: 0.83, wr: 0.345, tw: 0.3,
    body: [[-2.27, .45, .7, .6], [-2.17, .32, .9, .82], [-1.8, .27, 1.0, .93], [-0.9, .24, .93, .96], [0.3, .22, .84, .96], [1.2, .22, .76, .94], [1.9, .24, .67, .9], [2.2, .3, .58, .76], [2.28, .38, .5, .5]],
    cabin: [[-1.3, .9, .95, .55], [-1.0, .9, 1.2, .76], [-0.5, .9, 1.28, .8], [0.2, .9, 1.28, .8], [0.7, .86, 1.1, .86], [1.05, .8, .84, .9]],
    seat: { x: 0.36, z: -0.15, top: 0.4 },
    mass: 1350, power: 1.25, top: 62, grip: 1.25, steer: 1.0, brake: 1.2, price: 62000,
  },
  sedan: {
    kind: 'sedan', name: 'Marquis LX', L: 4.8, W: 1.85, H: 1.46, zf: 1.5, zr: -1.4, track: 0.78, wr: 0.34, tw: 0.225,
    body: [[-2.4, .5, .78, .6], [-2.32, .34, .98, .8], [-2.0, .28, 1.02, .9], [-1.0, .26, .95, .92], [0.4, .25, .9, .92], [1.3, .25, .82, .9], [2.0, .27, .74, .86], [2.35, .33, .62, .72], [2.4, .42, .55, .5]],
    cabin: [[-1.55, .96, 1.0, .62], [-1.2, .96, 1.38, .76], [-0.6, .96, 1.46, .8], [0.4, .96, 1.46, .8], [0.85, .93, 1.3, .84], [1.25, .88, .92, .88]],
    seat: { x: 0.4, z: -0.2, top: 0.5 },
    mass: 1500, power: 0.82, top: 48, grip: 1.0, steer: 1.0, brake: 1.0, price: 24000,
  },
  suv: {
    kind: 'suv', name: 'Titan XL', L: 4.95, W: 2.0, H: 1.85, zf: 1.55, zr: -1.45, track: 0.85, wr: 0.39, tw: 0.27,
    body: [[-2.47, .55, 1.0, .7], [-2.4, .4, 1.28, .92], [-2.1, .34, 1.32, .98], [-0.8, .32, 1.2, .99], [0.6, .3, 1.14, .99], [1.5, .3, 1.1, .97], [2.2, .32, 1.0, .92], [2.44, .4, .82, .72]],
    cabin: [[-2.25, 1.2, 1.3, .8], [-1.95, 1.2, 1.8, .9], [-0.3, 1.2, 1.85, .9], [0.8, 1.2, 1.72, .92], [1.3, 1.1, 1.2, .96]],
    seat: { x: 0.43, z: -0.25, top: 0.62 },
    mass: 2400, power: 0.7, top: 44, grip: 0.92, steer: 0.9, brake: 0.9, price: 38000,
  },
  muscle: {
    kind: 'muscle', name: 'Brawler SS', L: 4.95, W: 1.95, H: 1.42, zf: 1.5, zr: -1.45, track: 0.82, wr: 0.36, tw: 0.29,
    body: [[-2.47, .5, .8, .6], [-2.4, .34, 1.0, .85], [-2.0, .28, 1.05, .94], [-0.8, .26, .98, .96], [0.6, .26, .96, .96], [1.6, .28, .98, .94], [2.2, .3, .9, .9], [2.44, .38, .74, .7]],
    cabin: [[-1.1, .98, 1.02, .6], [-0.75, .98, 1.36, .78], [-0.2, .98, 1.42, .8], [0.5, .98, 1.38, .82], [0.95, .95, 1.0, .88]],
    seat: { x: 0.4, z: -0.15, top: 0.45 },
    mass: 1750, power: 1.1, top: 56, grip: 1.05, steer: 0.95, brake: 1.0, price: 41000,
  },
  pickup: {
    kind: 'pickup', name: 'Hauler 250', L: 5.4, W: 2.0, H: 1.78, zf: 1.75, zr: -1.6, track: 0.86, wr: 0.4, tw: 0.27,
    body: [[-0.3, .4, 1.1, .97], [0.6, .32, 1.12, .98], [1.7, .32, 1.1, .96], [2.4, .34, 1.0, .92], [2.68, .42, .84, .72]],
    cabin: [[-0.45, 1.05, 1.15, .84], [-0.15, 1.05, 1.74, .88], [0.8, 1.05, 1.78, .9], [1.35, 1.0, 1.3, .94]],
    seat: { x: 0.43, z: 0.2, top: 0.68 },
    mass: 2200, power: 0.72, top: 45, grip: 0.9, steer: 0.9, brake: 0.9, price: 32000,
  },
  van: {
    kind: 'van', name: 'Rumbler V', L: 5.3, W: 2.0, H: 2.45, zf: 1.8, zr: -1.6, track: 0.86, wr: 0.36, tw: 0.24,
    body: [[-2.65, .45, 1.9, .85], [-2.55, .35, 2.4, .97], [-2.2, .32, 2.45, 1.0], [1.0, .3, 2.45, 1.0], [1.9, .3, 1.5, .97], [2.45, .34, 1.1, .9], [2.65, .42, .9, .7]],
    cabin: [[0.8, 1.55, 2.3, .92], [1.5, 1.3, 1.78, .95], [2.0, 1.1, 1.2, .95]],
    seat: { x: 0.42, z: 1.15, top: 0.75 },
    mass: 2600, power: 0.55, top: 38, grip: 0.85, steer: 0.85, brake: 0.85, price: 22000,
  },
  police: {
    kind: 'police', name: 'Patrol Interceptor', L: 4.9, W: 1.9, H: 1.5, zf: 1.52, zr: -1.42, track: 0.8, wr: 0.35, tw: 0.24,
    body: [[-2.45, .5, .8, .6], [-2.37, .34, 1.0, .82], [-2.0, .28, 1.04, .92], [-1.0, .26, .97, .94], [0.4, .25, .92, .94], [1.3, .25, .84, .92], [2.0, .27, .76, .88], [2.4, .33, .64, .74], [2.45, .42, .57, .5]],
    cabin: [[-1.55, .98, 1.02, .62], [-1.2, .98, 1.4, .77], [-0.6, .98, 1.48, .82], [0.4, .98, 1.48, .82], [0.85, .95, 1.32, .86], [1.25, .9, .94, .9]],
    seat: { x: 0.4, z: -0.2, top: 0.5 },
    mass: 1700, power: 1.0, top: 56, grip: 1.1, steer: 1.0, brake: 1.1, price: 0,
  },
  taxi: {
    kind: 'taxi', name: 'Yellow Cab', L: 4.8, W: 1.85, H: 1.52, zf: 1.5, zr: -1.4, track: 0.78, wr: 0.34, tw: 0.225,
    body: [[-2.4, .5, .78, .6], [-2.32, .34, .98, .8], [-2.0, .28, 1.02, .9], [-1.0, .26, .95, .92], [0.4, .25, .9, .92], [1.3, .25, .82, .9], [2.0, .27, .74, .86], [2.35, .33, .62, .72], [2.4, .42, .55, .5]],
    cabin: [[-1.55, .96, 1.0, .62], [-1.2, .96, 1.38, .76], [-0.6, .96, 1.46, .8], [0.4, .96, 1.46, .8], [0.85, .93, 1.3, .84], [1.25, .88, .92, .88]],
    seat: { x: 0.4, z: -0.2, top: 0.5 },
    mass: 1550, power: 0.85, top: 46, grip: 1.0, steer: 1.0, brake: 1.0, price: 0,
  },
  swat: {
    kind: 'swat', name: 'SWAT Enforcer', L: 5.1, W: 2.1, H: 2.05, zf: 1.65, zr: -1.5, track: 0.9, wr: 0.42, tw: 0.3,
    body: [[-2.55, .6, 1.2, .8], [-2.48, .45, 1.55, .96], [-2.2, .4, 1.6, 1.03], [-0.6, .38, 1.5, 1.04], [0.8, .36, 1.3, 1.03], [1.8, .36, 1.18, 1.0], [2.4, .38, 1.0, .9], [2.54, .46, .85, .7]],
    cabin: [[-2.35, 1.4, 1.5, .85], [-2.0, 1.4, 2.0, .94], [-0.4, 1.4, 2.04, .96], [0.9, 1.4, 1.9, .96], [1.4, 1.25, 1.35, .99]],
    seat: { x: 0.45, z: -0.1, top: 0.75 },
    mass: 4200, power: 0.55, top: 40, grip: 0.9, steer: 0.8, brake: 1.0, price: 0,
  },
};

export interface CarModel {
  group: THREE.Group;
  body: THREE.Group;
  wheels: { pivot: THREE.Group; spin: THREE.Group; sign: number; front: boolean }[];
  steerWheel: THREE.Object3D;
  headMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshStandardMaterial;
  paint: THREE.MeshPhysicalMaterial;
  spec: CarSpec;
  driver: { x: number; y: number; z: number };
  beams: THREE.Group;
  siren?: { red: THREE.MeshStandardMaterial; blue: THREE.MeshStandardMaterial; group: THREE.Group };
  smokeAt: THREE.Vector3;
  exhaust: THREE.Vector3[];
  tail: THREE.Vector3[];
  head: THREE.Vector3[];
  setColor(c: number): void;
}

const blackMat = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.55, metalness: 0.3 });
const chrome = new THREE.MeshStandardMaterial({ color: 0xdadde2, roughness: 0.08, metalness: 1 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.85 });
const interiorMat = new THREE.MeshStandardMaterial({ color: 0x1b1a1a, roughness: 0.8 });
const seatMat = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.6 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0a1118, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.62, envMapIntensity: 2.2, side: THREE.DoubleSide, depthWrite: false });
const alloy = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.22, metalness: 1 });
const darkAlloy = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.3, metalness: 1 });
const discMat = new THREE.MeshStandardMaterial({ color: 0x555559, roughness: 0.4, metalness: 1 });
const caliperMat = new THREE.MeshStandardMaterial({ color: 0xc41a1a, roughness: 0.4, metalness: 0.5 });
let tyreMat: THREE.MeshStandardMaterial | null = null;
const beamTex = (() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,245,220,0.9)');
  gr.addColorStop(1, 'rgba(255,245,220,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
})();

function rowsToRings(rows: Row[], n: number, scaleW = 1): Ring[] {
  return rows.map(([z, b, t, hw]) => ({ p: [0, (b + t) / 2, z] as [number, number, number], rx: hw * scaleW, rz: (t - b) / 2, rzb: (t - b) / 2, n }));
}

function buildWheel(spec: CarSpec, style: number) {
  const g = new THREE.Group();
  const r = spec.wr, w = spec.tw;
  const rimR = r * 0.66;
  tyreMat ??= new THREE.MeshStandardMaterial({ color: 0x151516, roughness: 0.9, normalMap: treadNormal(), normalScale: new THREE.Vector2(1.2, 1.2) });
  const pts: THREE.Vector2[] = [];
  const hw = w / 2;
  pts.push(new THREE.Vector2(rimR - 0.01, -hw * 0.9));
  pts.push(new THREE.Vector2(rimR + (r - rimR) * 0.55, -hw * 1.0));
  pts.push(new THREE.Vector2(r - 0.025, -hw * 0.82));
  pts.push(new THREE.Vector2(r - 0.004, -hw * 0.5));
  pts.push(new THREE.Vector2(r, 0));
  pts.push(new THREE.Vector2(r - 0.004, hw * 0.5));
  pts.push(new THREE.Vector2(r - 0.025, hw * 0.82));
  pts.push(new THREE.Vector2(rimR + (r - rimR) * 0.55, hw * 1.0));
  pts.push(new THREE.Vector2(rimR - 0.01, hw * 0.9));
  const tg = new THREE.LatheGeometry(pts, 36);
  tg.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tg, tyreMat);
  tire.castShadow = true;
  g.add(tire);
  // rim barrel + face
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR * 0.96, w * 0.8, 24, 1, true), darkAlloy);
  barrel.rotation.z = Math.PI / 2;
  g.add(barrel);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.012, 8, 28), alloy);
  lip.rotation.y = Math.PI / 2;
  lip.position.x = hw * 0.78;
  g.add(lip);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.28, rimR * 0.4, 0.03, 18), alloy);
  face.rotation.z = Math.PI / 2;
  face.position.x = hw * 0.55;
  g.add(face);
  const spokes = style === 0 ? 5 : style === 1 ? 10 : 6;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const sw = style === 1 ? 0.018 : 0.045;
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.022, rimR * 0.82, sw), alloy);
    sp.position.set(hw * 0.5, Math.cos(a) * rimR * 0.52, Math.sin(a) * rimR * 0.52);
    sp.rotation.x = -a;
    g.add(sp);
  }
  // brake disc + caliper behind the spokes
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.02, 24), discMat);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = hw * 0.15;
  g.add(disc);
  const cal = new THREE.Mesh(new THREE.BoxGeometry(0.05, rimR * 0.36, rimR * 0.5), caliperMat);
  cal.position.set(hw * 0.3, rimR * 0.55, -rimR * 0.1);
  g.add(cal);
  return g;
}

/** merge all static meshes in a group by material to cut draw calls */
export function mergeByMaterial(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const rm: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o === root || skip(o)) return;
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let p: THREE.Object3D | null = o;
    while (p && p !== root) { if (skip(p)) return; p = p.parent; }
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const mat = m.material as THREE.Material;
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat)!.push(g);
    rm.push(o);
  });
  for (const o of rm) o.parent?.remove(o);
  for (const [mat, gs] of buckets) {
    const g = mergeGeometries(gs, false);
    if (!g) continue;
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = !(mat as THREE.MeshStandardMaterial).transparent;
    if (mat === glassMat || (mat as THREE.MeshPhysicalMaterial).transparent) mesh.renderOrder = 2;
    root.add(mesh);
    gs.forEach((x) => x.dispose());
  }
}

export interface CarOpts { glow?: number; plate?: string; style?: number; tint?: number }

export function buildCar(kind: CarKind, color: number, opts: CarOpts = {}): CarModel {
  const spec = CAR_SPECS[kind];
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const paint = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.65, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, normalMap: flakeNormal(), normalScale: new THREE.Vector2(0.15, 0.15), envMapIntensity: 1.3,
  });
  if (kind === 'swat') { paint.metalness = 0.3; paint.roughness = 0.5; }
  const headMat = new THREE.MeshStandardMaterial({ color: 0xeef4ff, emissive: 0xfff2d0, emissiveIntensity: 0.15, roughness: 0.08, metalness: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x6a0608, emissive: 0xff1010, emissiveIntensity: 0.35, roughness: 0.2 });
  const gm = glassMat.clone();
  gm.opacity = kind === 'taxi' || kind === 'sports' ? 0.55 : 0.72;

  const mb = new MeshBuilder();
  const n = kind === 'van' || kind === 'swat' || kind === 'suv' ? 4.4 : kind === 'pickup' ? 4 : 3.4;
  const bodyRings = rowsToRings(spec.body, n);
  mb.loft('paint', bodyRings, { axis: 'z', segs: 40, capStart: true, capEnd: true, uv: 'cyl', uvScale: [6, 6] });
  const gGeo = new MeshBuilder();
  gGeo.loft('glass', rowsToRings(spec.cabin, 3.2), { axis: 'z', segs: 28, capStart: true, capEnd: true });
  const cab = spec.cabin;
  // roof plate
  const roofRows: Row[] = cab.slice(1, cab.length - 1).map(([z, , t, hw]) => [z, t - 0.035, t + 0.008, hw * 0.88] as Row);
  if (kind !== 'van') mb.loft('paint', rowsToRings(roofRows, 5), { axis: 'z', segs: 24, capStart: true, capEnd: true });
  const paintGeo = mb.build('paint', false)!;
  const bodyMesh = new THREE.Mesh(paintGeo, paint);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  body.add(bodyMesh);
  const glassMesh = new THREE.Mesh(gGeo.build('glass', false)!, gm);
  glassMesh.renderOrder = 2;
  body.add(glassMesh);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  // pillars (A and C)
  const a0 = cab[cab.length - 1], a1 = cab[cab.length - 2];
  const c0 = cab[0], c1 = cab[1];
  for (const s of [-1, 1]) {
    const dz = a0[0] - a1[0], dy = a0[2] - a1[2];
    const len = Math.hypot(dz, dy);
    add(new THREE.BoxGeometry(0.055, len, 0.06), paint, s * a1[3] * 0.86, (a0[2] + a1[2]) / 2 - 0.03, (a0[0] + a1[0]) / 2 + 0.0, Math.atan2(dz, dy), 0, 0);
    const cz = c1[0] - c0[0], cy = c1[2] - c0[2];
    const clen = Math.hypot(cz, cy);
    add(new THREE.BoxGeometry(0.08, clen, kind === 'van' ? 0.01 : 0.12), paint, s * c1[3] * 0.84, (c0[2] + c1[2]) / 2 - 0.02, (c0[0] + c1[0]) / 2, Math.atan2(cz, cy), 0, 0);
    // B pillar (black)
    const bz = (cab[Math.min(2, cab.length - 1)][0] + cab[Math.min(3, cab.length - 1)][0]) / 2 - 0.1;
    add(new THREE.BoxGeometry(0.03, cab[Math.min(2, cab.length - 1)][2] - cab[Math.min(2, cab.length - 1)][1] - 0.02, 0.07), blackMat, s * (cab[Math.min(2, cab.length - 1)][3] * 0.97), (cab[Math.min(2, cab.length - 1)][1] + cab[Math.min(2, cab.length - 1)][2]) / 2, bz + 0.1);
    // door handles + mirrors
    add(new THREE.BoxGeometry(0.012, 0.025, 0.14), chrome, s * (spec.body[3][3] + 0.002), spec.body[3][2] - 0.1, bz - 0.35);
    add(new THREE.BoxGeometry(0.012, 0.025, 0.14), chrome, s * (spec.body[3][3] + 0.002), spec.body[3][2] - 0.1, bz + 0.65);
    const mirror = new THREE.Group();
    mirror.position.set(s * (a1[3] + 0.09), a0[2] + 0.12, a1[0] + 0.1);
    add(new THREE.BoxGeometry(0.05, 0.007, 0.03), blackMat, s * -0.05, -0.04, 0, 0, 0, 0, mirror);
    add(new THREE.BoxGeometry(0.06, 0.1, 0.17), paint, 0, 0, 0, 0, s * 0.25, 0, mirror);
    add(new THREE.BoxGeometry(0.008, 0.085, 0.145), chrome, -s * 0.0, 0, -0.01, 0, s * 0.25, 0, mirror).position.x = -s * 0.002;
    body.add(mirror);
  }
  const frontZ = spec.body[spec.body.length - 1][0];
  const rearZ = spec.body[0][0];
  const fr = spec.body[spec.body.length - 2], rr = spec.body[1];
  // grille & lights
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(spec.W * 0.46, 0.14), new THREE.MeshStandardMaterial({ map: grilleTex(), roughness: 0.4, metalness: 0.8 }));
  gr.position.set(0, fr[2] - 0.2, fr[0] + 0.035);
  gr.rotation.x = -0.3;
  body.add(gr);
  const head: THREE.Vector3[] = [], tail: THREE.Vector3[] = [], exhaust: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    const hl = add(new THREE.SphereGeometry(1, 18, 10), headMat, s * fr[3] * 0.68, fr[2] - 0.1, fr[0] + 0.07, -0.3, s * 0.3, 0);
    hl.scale.set(0.2, 0.07, 0.16);
    add(new THREE.TorusGeometry(1, 0.06, 6, 20), chrome, s * fr[3] * 0.68, fr[2] - 0.1, fr[0] + 0.07, 0.2, 0, 0).scale.set(0.2, 0.075, 0.1);
    // DRL strip
    add(new THREE.BoxGeometry(0.28, 0.018, 0.02), headMat, s * fr[3] * 0.68, fr[2] - 0.2, fr[0] + 0.1, -0.25, s * 0.2, 0);
    head.push(new THREE.Vector3(s * fr[3] * 0.68, fr[2] - 0.1, fr[0] + 0.15));
    const tl = add(new THREE.BoxGeometry(0.36, 0.1, 0.05), tailMat, s * rr[3] * 0.7, rr[2] - 0.12, rr[0] - 0.015, 0.25, s * -0.25, 0);
    void tl;
    tail.push(new THREE.Vector3(s * rr[3] * 0.7, rr[2] - 0.12, rr[0] - 0.12));
    // exhaust
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 12), chrome);
    ex.rotation.x = Math.PI / 2;
    ex.position.set(s * (kind === 'sports' || kind === 'muscle' ? 0.5 : 0.7), 0.3, rearZ + 0.04);
    body.add(ex);
    exhaust.push(new THREE.Vector3(ex.position.x, 0.3, rearZ - 0.05));
  }
  add(new THREE.BoxGeometry(spec.W * 0.7, 0.025, 0.04), tailMat, 0, rr[2] - 0.08, rr[0] - 0.02, 0.25);
  // bumper intake & splitter
  add(new THREE.BoxGeometry(spec.W * 0.82, 0.04, 0.16), blackMat, 0, spec.body[spec.body.length - 2][1] + 0.02, fr[0] + 0.03);
  add(new THREE.BoxGeometry(spec.W * 0.5, 0.1, 0.03), blackMat, 0, fr[1] + 0.18, fr[0] + 0.07);
  // plates
  const pm = (t: string) => new THREE.MeshStandardMaterial({ map: plateTex(t), roughness: 0.4 });
  const plate = opts.plate ?? String(Math.floor(100 + Math.random() * 899)) + 'NEO';
  const pf = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), pm(plate));
  pf.position.set(0, fr[1] + 0.2, fr[0] + 0.082 + 0.01);
  pf.rotation.x = -0.12;
  body.add(pf);
  const pr = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), pm(plate));
  pr.position.set(0, rr[2] - 0.34, rr[0] - 0.04);
  pr.rotation.y = Math.PI;
  body.add(pr);
  // under-body shadow
  add(new THREE.BoxGeometry(spec.W * 0.9, 0.1, spec.L * 0.92), blackMat, 0, 0.2, 0);

  // ---- type specific
  if (kind === 'sports') {
    // rear wing + diffuser + hood vents
    const wing = add(new THREE.BoxGeometry(spec.W * 0.9, 0.025, 0.3), new THREE.MeshStandardMaterial({ map: carbonTex(), roughness: 0.3, metalness: 0.5 }), 0, 1.12, rearZ + 0.2, 0.08);
    void wing;
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.03, 0.2, 0.28), blackMat, s * 0.55, 1.0, rearZ + 0.3);
      add(new THREE.BoxGeometry(0.03, 0.14, 0.3), blackMat, s * (spec.W / 2 - 0.02), 1.12, rearZ + 0.2);
    }
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.34, 0.01, 0.03), blackMat, 0, 0.79 - (i * 0.0), 0.95 + i * 0.1, -0.08);
    add(new THREE.BoxGeometry(1.1, 0.07, 0.25), new THREE.MeshStandardMaterial({ map: carbonTex(), roughness: 0.3 }), 0, 0.3, rearZ + 0.05);
  }
  if (kind === 'muscle') {
    add(new THREE.BoxGeometry(0.55, 0.07, 0.8), blackMat, 0, 1.0, 1.35, -0.06); // hood scoop
    add(new THREE.BoxGeometry(0.02, 0.01, spec.L * 0.8), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3 }), 0.12, 1.012, 0.2);
    add(new THREE.BoxGeometry(0.02, 0.01, spec.L * 0.8), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3 }), -0.12, 1.012, 0.2);
  }
  if (kind === 'suv' || kind === 'swat') {
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.04, 2.0), blackMat, s * 0.8, spec.H + 0.02, -0.7);
    add(new THREE.BoxGeometry(spec.W * 0.8, 0.12, 0.05), blackMat, 0, fr[2] - 0.4, fr[0] + 0.06);
  }
  if (kind === 'pickup') {
    const bed0 = -0.3, bed1 = rearZ;
    const bl = bed0 - bed1;
    add(new THREE.BoxGeometry(spec.W * 0.93, 0.08, bl), interiorMat, 0, 0.92, (bed0 + bed1) / 2);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.1, 0.5, bl), paint, s * (spec.W * 0.46), 1.15, (bed0 + bed1) / 2);
    add(new THREE.BoxGeometry(spec.W * 0.93, 0.5, 0.1), paint, 0, 1.15, bed1 + 0.05);
    add(new THREE.BoxGeometry(spec.W * 0.93, 0.5, 0.1), paint, 0, 1.15, bed0 - 0.05);
    add(new THREE.BoxGeometry(spec.W * 0.9, 0.1, bl), blackMat, 0, 0.82, (bed0 + bed1) / 2);
    add(new THREE.BoxGeometry(spec.W * 0.93, 0.5, 0.1), paint, 0, 1.15, bed1 + 0.05);
  }
  if (kind === 'van') {
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.01, 0.6, 1.4), gm, s * 1.005, 1.55, -0.2);
    add(new THREE.BoxGeometry(0.01, 0.01, spec.L), blackMat, 1.006, 1.0, 0);
  }
  let siren: CarModel['siren'];
  if (kind === 'police') {
    // livery: white door panels + text
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3, metalness: 0.2 });
    const tex = signTex('POLICE', '#f2f2f2', '#14203a', 512, 128);
    const lm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 });
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.016, 0.34, 1.7), white, s * (spec.body[3][3] - 0.002), 0.58, -0.2);
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), lm);
      t.position.set(s * (spec.body[3][3] + 0.01), 0.58, -0.2);
      t.rotation.y = s * Math.PI / 2;
      body.add(t);
    }
    // light bar
    const lb = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0x500000, emissive: 0xff0000, emissiveIntensity: 0.2 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x000050, emissive: 0x0030ff, emissiveIntensity: 0.2 });
    add(new THREE.BoxGeometry(1.25, 0.06, 0.3), blackMat, 0, 0, 0, 0, 0, 0, lb);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.55, 0.09, 0.26), s < 0 ? red : blue, s * 0.3, 0.05, 0, 0, 0, 0, lb);
    }
    lb.position.set(0, spec.H + 0.04, -0.2);
    body.add(lb);
    siren = { red, blue, group: lb };
    add(new THREE.BoxGeometry(0.014, 0.12, 0.3), white, 0, spec.body[1][2] + 0.0, rearZ + 0.15, -0.5);
  }
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.22), new THREE.MeshStandardMaterial({ map: signTex('TAXI', '#f4d21c', '#111', 256, 80, 'bold 54px Arial'), emissive: 0xffd040, emissiveIntensity: 0.25, emissiveMap: signTex('TAXI', '#f4d21c', '#111', 256, 80, 'bold 54px Arial') }));
    sign.position.set(0, spec.H + 0.1, -0.2);
    body.add(sign);
    add(new THREE.BoxGeometry(0.016, 0.1, 1.8), blackMat, spec.body[3][3] - 0.002, 0.62, -0.2);
    add(new THREE.BoxGeometry(0.016, 0.1, 1.8), blackMat, -spec.body[3][3] + 0.002, 0.62, -0.2);
  }
  if (kind === 'swat') {
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.35, 1.9), new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.6 }), s * (spec.body[3][3] + 0.006), 0.9, -0.5);
    const t = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.34), new THREE.MeshStandardMaterial({ map: signTex('SWAT', '#0b0b0b', '#e8e8e8', 512, 128) }));
    t.position.set(spec.body[3][3] + 0.012, 1.0, -0.5);
    t.rotation.y = Math.PI / 2;
    body.add(t);
    const t2 = t.clone();
    t2.position.x *= -1;
    t2.rotation.y = -Math.PI / 2;
    body.add(t2);
  }

  // ---- interior
  const sx = spec.seat.x, sz = spec.seat.z, stp = spec.seat.top;
  add(new THREE.BoxGeometry(spec.W * 0.8, 0.05, 1.6), interiorMat, 0, spec.cabin[0][1] - 0.15 + (stp - 0.4) * 0.3, sz + 0.1);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.5, 0.12, 0.5), seatMat, s * sx, stp - 0.06, sz);
    add(new THREE.BoxGeometry(0.48, 0.55, 0.1), seatMat, s * sx, stp + 0.24, sz - 0.28, -0.18);
    add(new THREE.BoxGeometry(0.26, 0.14, 0.08), seatMat, s * sx, stp + 0.58, sz - 0.34, -0.18);
  }
  if (kind !== 'sports' && kind !== 'van') add(new THREE.BoxGeometry(spec.W * 0.8, 0.14, 0.5), seatMat, 0, stp - 0.06, sz - 0.95);
  if (kind !== 'sports' && kind !== 'van') add(new THREE.BoxGeometry(spec.W * 0.8, 0.5, 0.1), seatMat, 0, stp + 0.2, sz - 1.22, -0.18);
  const dashZ = cab[cab.length - 1][0] - 0.3;
  add(new THREE.BoxGeometry(spec.W * 0.82, 0.2, 0.45), interiorMat, 0, cab[cab.length - 1][2] - 0.12, dashZ);
  const swhl = new THREE.Group();
  swhl.position.set(sx, stp + 0.42, sz + 0.52);
  swhl.rotation.x = -0.9;
  add(new THREE.TorusGeometry(0.16, 0.018, 8, 22), blackMat, 0, 0, 0, 0, 0, 0, swhl);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10), blackMat, 0, 0, 0, Math.PI / 2, 0, 0, swhl);
  body.add(swhl);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), blackMat, sx, stp + 0.3, sz + 0.58, -0.9);

  // ---- wheels
  const wheels: CarModel['wheels'] = [];
  const style = opts.style ?? (kind === 'sports' ? 1 : kind === 'muscle' ? 2 : 0);
  for (const [z, front] of [[spec.zf, true], [spec.zr, false]] as const) {
    for (const s of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * (spec.W / 2 - spec.tw / 2 + 0.005), spec.wr, z);
      const flip = new THREE.Group();
      if (s < 0) flip.rotation.y = Math.PI;
      const spin = new THREE.Group();
      spin.add(buildWheel(spec, style));
      flip.add(spin);
      pivot.add(flip);
      group.add(pivot);
      wheels.push({ pivot, spin, sign: s < 0 ? -1 : 1, front });
      // wheel arch lip
      const arch = new THREE.Mesh(new THREE.RingGeometry(spec.wr + 0.012, spec.wr + 0.075, 28, 1, 0, Math.PI * 2), blackMat);
      arch.position.set(s * (spec.W / 2 + 0.0), spec.wr, z);
      arch.rotation.y = s * Math.PI / 2;
      group.add(arch);
      // inner arch (dark cylinder behind tire)
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(spec.wr + 0.06, spec.wr + 0.06, spec.tw * 0.9, 20, 1, true), blackMat);
      inner.rotation.z = Math.PI / 2;
      inner.position.set(s * (spec.W / 2 - spec.tw / 2 - 0.02), spec.wr, z);
      (inner.material as THREE.Material).side = THREE.BackSide;
      group.add(inner);
    }
  }
  void rubber; void frontZ;

  // headlight beams (fake volumetric cones)
  const beams = new THREE.Group();
  for (const h of head) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.9, 14, 16, 1, true),
      new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    cone.geometry.translate(0, -7, 0);
    cone.rotation.x = -Math.PI / 2 + 0.07;
    cone.position.copy(h);
    beams.add(cone);
  }
  beams.visible = false;
  body.add(beams);

  const driver = { x: sx, y: stp - 0.46, z: sz };
  const model: CarModel = {
    group, body, wheels, steerWheel: swhl, headMat, tailMat, paint, spec, driver, beams, siren,
    smokeAt: new THREE.Vector3(0, 0.9, spec.zf + 0.6), exhaust, tail, head,
    setColor(c: number) { paint.color.setHex(c); },
  };
  void opts.glow; void matT;
  mergeByMaterial(body, (o) => o === swhl || o === beams || o === siren?.group);
  for (const w of wheels) mergeByMaterial(w.spin, () => false);
  return model;
}
