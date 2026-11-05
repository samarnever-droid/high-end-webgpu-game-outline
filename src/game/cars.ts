import * as THREE from 'three/webgpu';
import { Merger, M4, makeCanvas } from './geo';

export interface CarSpec {
  L: number; W: number; wr: number; bodyH: number; cabH: number;
  cabBack: number; cabFront: number; hood: number; spoiler?: boolean; ride: number;
}

export const SPECS: Record<string, CarSpec> = {
  sport: { L: 4.5, W: 1.94, wr: 0.36, bodyH: 0.52, cabH: 0.46, cabBack: 0.3, cabFront: 0.06, hood: 0.2, spoiler: true, ride: 0.9 },
  sedan: { L: 4.7, W: 1.86, wr: 0.34, bodyH: 0.6, cabH: 0.56, cabBack: 0.3, cabFront: 0.1, hood: 0.12, ride: 1.0 },
  suv: { L: 4.8, W: 2.0, wr: 0.42, bodyH: 0.78, cabH: 0.62, cabBack: 0.38, cabFront: 0.08, hood: 0.1, ride: 1.2 },
  hatch: { L: 3.9, W: 1.76, wr: 0.32, bodyH: 0.6, cabH: 0.6, cabBack: 0.36, cabFront: 0.04, hood: 0.14, ride: 1.0 },
};

export interface CarModel {
  group: THREE.Group;
  body: THREE.Group;
  pivots: THREE.Group[];   // all 4 wheel pivots [fl, fr, rl, rr]
  spinners: THREE.Group[];
  brake: THREE.MeshBasicMaterial;
  flames: THREE.Mesh[];
  glow?: THREE.Mesh;
  spec: CarSpec;
  paint: THREE.MeshPhysicalMaterial;
}

const paintCache = new Map<number, THREE.MeshPhysicalMaterial>();
function paintMat(color: number, own = false) {
  if (!own && paintCache.has(color)) return paintCache.get(color)!;
  const m = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06,
  });
  if (!own) paintCache.set(color, m);
  return m;
}

let shared: {
  glass: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  head: THREE.MeshBasicMaterial;
  tail: THREE.MeshBasicMaterial;
  wheel: THREE.MeshStandardMaterial;
  flame: THREE.MeshBasicMaterial;
} | null = null;

function sharedMats() {
  if (!shared) {
    shared = {
      glass: new THREE.MeshStandardMaterial({ color: 0x0a1119, metalness: 0.9, roughness: 0.06 }),
      trim: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.2, roughness: 0.6 }),
      head: new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(3.2, 3.0, 2.6) }),
      tail: new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.1, 0.04, 0.03) }),
      wheel: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.45, roughness: 0.38 }),
      flame: new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(0.5, 1.2, 3.5), transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    };
  }
  return shared;
}

const geoCache = new Map<string, {
  body: THREE.BufferGeometry; glass: THREE.BufferGeometry; trim: THREE.BufferGeometry;
  head: THREE.BufferGeometry; tailG: THREE.BufferGeometry; wheelR: THREE.BufferGeometry; wheelL: THREE.BufferGeometry;
  paintParts: THREE.BufferGeometry;
}>();

function wheelGeo(wr: number, side: 1 | -1) {
  const m = new Merger();
  const wd = 0.27;
  const tire = new THREE.CylinderGeometry(wr, wr, wd, 28, 1);
  tire.rotateZ(Math.PI / 2);
  m.add(tire, 0x121214);
  const rim = new THREE.CylinderGeometry(wr * 0.7, wr * 0.7, wd + 0.012, 24);
  rim.rotateZ(Math.PI / 2);
  m.add(rim, 0xc4c8d0);
  const hub = new THREE.CylinderGeometry(wr * 0.16, wr * 0.16, wd + 0.04, 12);
  hub.rotateZ(Math.PI / 2);
  m.add(hub, 0x2a2a2e);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    m.add(new THREE.BoxGeometry(0.02, wr * 0.62, 0.075), 0x3a3d44, M4(wd / 2 + 0.002, Math.cos(a) * wr * 0.34, Math.sin(a) * wr * 0.34, a, 0, 0));
  }
  // brake disc peek
  const disc = new THREE.CylinderGeometry(wr * 0.5, wr * 0.5, 0.05, 20);
  disc.rotateZ(Math.PI / 2);
  m.add(disc, 0x70747c, M4(-0.06, 0, 0));
  const g = m.build()!;
  if (side === -1) g.rotateY(Math.PI);
  return g;
}

function buildGeos(kind: string) {
  const s = SPECS[kind];
  const { L, W, wr, bodyH, cabH } = s;
  const hl = L / 2;
  const y0 = wr * 0.72;
  const bev = 0.09;
  const depth = W - bev * 2;

  const shape = new THREE.Shape();
  shape.moveTo(-hl + bev, y0 + 0.08);
  shape.lineTo(-hl + bev, y0 + bodyH * 0.72);
  shape.quadraticCurveTo(-hl + bev, y0 + bodyH - bev, -hl + 0.4, y0 + bodyH - bev);
  shape.lineTo(hl * 0.3, y0 + bodyH - bev);
  shape.lineTo(hl - 0.3, y0 + bodyH - s.hood - bev);
  shape.quadraticCurveTo(hl - bev, y0 + bodyH - s.hood - 0.05 - bev, hl - bev, y0 + bodyH - s.hood - 0.24);
  shape.lineTo(hl - bev, y0 + 0.08);
  shape.closePath();
  const bodyG = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 10,
  });
  bodyG.translate(0, 0, -depth / 2);
  bodyG.rotateY(-Math.PI / 2);
  bodyG.deleteAttribute('uv');

  // cabin (glass)
  const yb = y0 + bodyH - bev * 0.5;
  const cx0 = -L * s.cabBack, cx1 = L * s.cabFront;
  const cs = new THREE.Shape();
  cs.moveTo(cx0 - 0.15, yb);
  cs.lineTo(cx0 + 0.65, yb + cabH);
  cs.lineTo(cx1 - 0.85, yb + cabH);
  cs.quadraticCurveTo(cx1 - 0.6, yb + cabH, cx1 - 0.1, yb + cabH * 0.35);
  cs.lineTo(cx1 + 0.55, yb);
  cs.closePath();
  const cw = W * 0.86;
  const cabG = new THREE.ExtrudeGeometry(cs, { depth: cw - 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 2, curveSegments: 8 });
  cabG.translate(0, 0, -(cw - 0.1) / 2);
  cabG.rotateY(-Math.PI / 2);
  cabG.deleteAttribute('uv');

  // painted extras: roof panel, mirrors, spoiler
  const paintM = new Merger();
  const roofLen = cx1 - 0.85 - (cx0 + 0.65) + 0.15;
  paintM.add(new THREE.BoxGeometry(cw - 0.06, 0.045, roofLen), 0xffffff, M4(0, yb + cabH + 0.04, (cx1 - 0.85 + cx0 + 0.65) / 2));
  for (const sx of [-1, 1]) {
    paintM.add(new THREE.BoxGeometry(0.14, 0.09, 0.22), 0xffffff, M4(sx * (W / 2 + 0.02), yb + 0.08, cx1 - 0.35));
  }
  if (s.spoiler) {
    paintM.add(new THREE.BoxGeometry(W * 0.92, 0.04, 0.34), 0xffffff, M4(0, y0 + bodyH + 0.3, -hl + 0.2, 0.06, 0, 0));
  }
  const paintParts = paintM.build()!;

  // trim (dark / plates / arches etc)
  const trim = new Merger();
  const wz = L * 0.31;
  for (const sx of [-1, 1]) {
    for (const zz of [wz, -wz]) {
      const arch = new THREE.CylinderGeometry(wr * 1.2, wr * 1.2, 0.02, 24);
      arch.rotateZ(Math.PI / 2);
      trim.add(arch, 0x050506, M4(sx * (W / 2 + 0.004), wr, zz + (zz > 0 ? 0.0 : 0)));
    }
  }
  trim.box(W * 0.55, 0.13, 0.04, 0, y0 + 0.2, hl + 0.085, 0x08080a);
  trim.box(W * 0.9, 0.06, 0.2, 0, y0 + 0.07, hl - 0.05, 0x0c0c0e);
  trim.box(W * 0.9, 0.07, 0.15, 0, y0 + 0.07, -hl + 0.05, 0x0c0c0e);
  trim.box(0.52, 0.12, 0.02, 0, y0 + 0.27, hl + 0.11, 0xeeeeee);
  trim.box(0.52, 0.12, 0.02, 0, y0 + 0.36, -hl - 0.1, 0xeeeeee);
  trim.box(W * 0.9, 0.025, 0.02, 0, y0 + 0.05, 0, 0x08080a);
  for (const sx of [-1, 1]) {
    const ex = new THREE.CylinderGeometry(0.055, 0.05, 0.14, 12);
    ex.rotateX(Math.PI / 2);
    trim.add(ex, 0x888d95, M4(sx * 0.55, y0 + 0.09, -hl - 0.05));
    // door handle + side skirt
    trim.box(0.02, 0.025, 0.16, sx * (W / 2 + 0.095), y0 + bodyH * 0.72, -0.05, 0x111113);
    trim.box(0.03, 0.06, L * 0.5, sx * (W / 2 + 0.07), y0 + 0.1, 0, 0x0a0a0c);
  }
  if (s.spoiler) {
    for (const sx of [-1, 1]) trim.box(0.04, 0.3, 0.12, sx * W * 0.3, y0 + bodyH + 0.14, -hl + 0.22, 0x0a0a0c);
  }
  const trimG = trim.build()!;

  // lights
  const head = new Merger();
  const tail = new Merger();
  const fy = y0 + bodyH - s.hood - 0.14;
  for (const sx of [-1, 1]) {
    head.box(0.42, 0.075, 0.05, sx * (W / 2 - 0.36), fy, hl + 0.095, 0xffffff);
    head.box(0.5, 0.018, 0.04, sx * (W / 2 - 0.4), fy - 0.07, hl + 0.098, 0xffffff);
    tail.box(0.38, 0.085, 0.05, sx * (W / 2 - 0.3), y0 + bodyH * 0.8, -hl - 0.095, 0xffffff);
  }
  tail.box(W * 0.6, 0.03, 0.04, 0, y0 + bodyH * 0.8, -hl - 0.1, 0xffffff);

  return {
    body: bodyG, glass: cabG, trim: trimG, head: head.build()!, tailG: tail.build()!,
    wheelR: wheelGeo(wr, 1), wheelL: wheelGeo(wr, -1), paintParts,
  };
}

let glowTex: THREE.CanvasTexture | null = null;
function getGlowTex() {
  if (!glowTex) {
    const { c, g } = makeCanvas(128, 128);
    const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(c);
  }
  return glowTex;
}

export function buildCar(kind: string, color: number, opts: { own?: boolean; glow?: number } = {}): CarModel {
  const spec = SPECS[kind];
  let geos = geoCache.get(kind);
  if (!geos) {
    geos = buildGeos(kind);
    geoCache.set(kind, geos);
  }
  const sm = sharedMats();
  const paint = paintMat(color, opts.own);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const mk = (g: THREE.BufferGeometry, m: THREE.Material, cast = false) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    body.add(mesh);
    return mesh;
  };
  mk(geos.body, paint, true);
  mk(geos.paintParts, paint, true);
  mk(geos.glass, sm.glass, true);
  mk(geos.trim, sm.trim);
  mk(geos.head, sm.head);
  const brake = opts.own
    ? new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.1, 0.04, 0.03) })
    : sm.tail;
  mk(geos.tailG, brake);

  // wheels
  const wx = spec.W / 2 - 0.105;
  const wz = spec.L * 0.31;
  const pivots: THREE.Group[] = [];
  const spinners: THREE.Group[] = [];
  const defs: [number, number][] = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [sx, sz] of defs) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * wx, spec.wr, sz * wz);
    const spinner = new THREE.Group();
    const m = new THREE.Mesh(sx > 0 ? geos.wheelR : geos.wheelL, sm.wheel);
    m.castShadow = false;
    spinner.add(m);
    pivot.add(spinner);
    group.add(pivot);
    pivots.push(pivot);
    spinners.push(spinner);
  }

  // nitro flames
  const flames: THREE.Mesh[] = [];
  if (opts.own) {
    const cg = new THREE.ConeGeometry(0.11, 1.3, 10);
    cg.translate(0, 0.65, 0);
    cg.rotateX(-Math.PI / 2);
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(cg, sm.flame);
      f.position.set(sx * 0.55, wr(spec) * 0.72 + 0.09, -spec.L / 2 - 0.1);
      f.visible = false;
      body.add(f);
      flames.push(f);
    }
  }

  let glow: THREE.Mesh | undefined;
  if (opts.glow !== undefined) {
    const gm = new THREE.MeshBasicMaterial({
      map: getGlowTex(),
      color: new THREE.Color(opts.glow).multiplyScalar(2.2),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const pg = new THREE.PlaneGeometry(spec.W * 1.9, spec.L * 1.35);
    pg.rotateX(-Math.PI / 2);
    glow = new THREE.Mesh(pg, gm);
    glow.position.y = 0.04;
    glow.renderOrder = 2;
    group.add(glow);
  }

  return { group, body, pivots, spinners, brake, flames, glow, spec, paint };
}

function wr(s: CarSpec) {
  return s.wr;
}
