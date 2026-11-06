import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mkCanvas, toTex } from './textures';
import { mulberry32 } from './util';
import { patchWet } from './wet';
import { N, P, PAD, ROAD_W, blockCenter, type World } from './world';

/**
 * Real-street dressing: repaired asphalt patches, hairline cracks, oil stains, manhole covers,
 * parking meters, bollards and glass bus shelters.
 */

function decalTexture(kind: 'patch' | 'crack' | 'oil', seed: number) {
  const { c, g } = mkCanvas(256);
  const r = mulberry32(seed);
  g.clearRect(0, 0, 256, 256);
  if (kind === 'patch') {
    // rectangular trench repair: darker, slightly smoother, ragged edge + sealant line
    g.beginPath();
    const x0 = 24, x1 = 232, y0 = 40, y1 = 216;
    const pts: [number, number][] = [];
    for (let x = x0; x <= x1; x += 8) pts.push([x, y0 + (r() - 0.5) * 5]);
    for (let y = y0; y <= y1; y += 8) pts.push([x1 + (r() - 0.5) * 5, y]);
    for (let x = x1; x >= x0; x -= 8) pts.push([x, y1 + (r() - 0.5) * 5]);
    for (let y = y1; y >= y0; y -= 8) pts.push([x0 + (r() - 0.5) * 5, y]);
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = 'rgba(16,16,18,0.62)';
    g.fill();
    g.strokeStyle = 'rgba(6,6,6,0.75)';
    g.lineWidth = 3;
    g.stroke();
    for (let i = 0; i < 1400; i++) {
      const v = 20 + r() * 50;
      g.fillStyle = `rgba(${v},${v},${v},0.25)`;
      g.fillRect(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), 1 + r() * 2, 1 + r() * 2);
    }
  } else if (kind === 'crack') {
    g.strokeStyle = 'rgba(6,6,6,0.85)';
    g.lineCap = 'round';
    const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      g.lineWidth = w;
      g.beginPath(); g.moveTo(x, y);
      let cx = x, cy = y;
      const n = Math.floor(len / 9);
      for (let i = 0; i < n; i++) {
        a += (r() - 0.5) * 0.9;
        cx += Math.cos(a) * 9; cy += Math.sin(a) * 9;
        g.lineTo(cx, cy);
        if (depth > 0 && r() < 0.16) branch(cx, cy, a + (r() < 0.5 ? 0.9 : -0.9), len * 0.45, w * 0.65, depth - 1);
      }
      g.stroke();
    };
    branch(20 + r() * 40, 100 + r() * 60, (r() - 0.5) * 0.6, 220, 2.6, 2);
    if (r() < 0.6) branch(30, 150, 0.1, 150, 1.6, 1);
  } else {
    for (let i = 0; i < 6; i++) {
      const x = 128 + (r() - 0.5) * 80, y = 128 + (r() - 0.5) * 80, rad = 22 + r() * 45;
      const gr = g.createRadialGradient(x, y, 2, x, y, rad);
      gr.addColorStop(0, 'rgba(4,4,8,0.55)');
      gr.addColorStop(0.7, 'rgba(8,8,12,0.25)');
      gr.addColorStop(1, 'rgba(8,8,12,0)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(x, y, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, 7); g.fill();
    }
  }
  return toTex(c, { repeat: false });
}

export function buildStreetDressing(w: World) {
  const rng = mulberry32(90210);
  const grp = new THREE.Group();
  const d = new THREE.Object3D();

  // -------------------------------------------------------------- road decals
  const mkDecal = (kind: 'patch' | 'crack' | 'oil', count: number, size: [number, number], seed: number) => {
    const mat = patchWet(new THREE.MeshStandardMaterial({
      map: decalTexture(kind, seed), transparent: true, roughness: kind === 'oil' ? 0.25 : 0.7, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    }), 0.5);
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    let n = 0;
    while (n < count) {
      const along = rng() < 0.5;
      const k = Math.floor(rng() * (N + 1));
      const lane = (k - N / 2) * P;
      const seg = Math.floor(rng() * N);
      const a = (seg - N / 2) * P + ROAD_W / 2 + 4 + rng() * (P - ROAD_W - 8);
      const off = (rng() - 0.5) * (ROAD_W - 3);
      const s = size[0] + rng() * (size[1] - size[0]);
      const x = along ? lane + off : a, z = along ? a : lane + off;
      d.position.set(x, 0.021 + n * 0.00001, z);
      const yaw = (along ? 0 : Math.PI / 2) + (kind === 'oil' ? rng() * 6 : (rng() - 0.5) * 0.3);
      d.rotation.set(-Math.PI / 2, 0, yaw);
      d.scale.set(s * (kind === 'patch' ? 0.6 + rng() * 0.9 : 1), s * (kind === 'patch' ? 1.3 + rng() * 2.2 : 1), 1);
      d.updateMatrix();
      mesh.setMatrixAt(n++, d.matrix);
    }
    grp.add(mesh);
  };
  mkDecal('patch', 240, [2.4, 4], 11);
  mkDecal('crack', 420, [4, 8], 23);
  mkDecal('oil', 160, [1.6, 3.6], 37);

  // -------------------------------------------------------------- manholes
  const mh = mergeGeometries([
    new THREE.CylinderGeometry(0.5, 0.5, 0.02, 24).translate(0, 0.012, 0),
    new THREE.CylinderGeometry(0.44, 0.44, 0.032, 24).translate(0, 0.016, 0),
  ])!;
  const mhMat = patchWet(new THREE.MeshStandardMaterial({ color: 0x35373a, roughness: 0.5, metalness: 0.6 }), 0.5);
  const MH = 150;
  const mhMesh = new THREE.InstancedMesh(mh, mhMat, MH);
  for (let n = 0; n < MH; n++) {
    const along = rng() < 0.5;
    const lane = (Math.floor(rng() * (N + 1)) - N / 2) * P;
    const a = (Math.floor(rng() * N) - N / 2) * P + ROAD_W / 2 + 6 + rng() * (P - ROAD_W - 12);
    const off = (rng() < 0.5 ? -1 : 1) * (1.6 + rng() * 5);
    d.position.set(along ? lane + off : a, 0.005, along ? a : lane + off);
    d.rotation.set(0, rng() * 3, 0); d.scale.setScalar(1); d.updateMatrix();
    mhMesh.setMatrixAt(n, d.matrix);
  }
  mhMesh.receiveShadow = true;
  grp.add(mhMesh);

  // -------------------------------------------------------------- per-block furniture
  const meters: { x: number; z: number }[] = [];
  const bollards: { x: number; z: number }[] = [];
  const shelters: { x: number; z: number; r: number; side: number }[] = [];
  const e = PAD / 2;
  let shelterBudget = 18;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const zone = w.zones[i][j];
    if (zone === 'beach' || zone === 'park') continue;
    const { x: cx, z: cz } = blockCenter(i, j);
    const busy = zone === 'downtown' || zone === 'commercial';
    for (let side = 0; side < 4; side++) {
      const sx = side === 2 ? -1 : side === 3 ? 1 : 0, sz = side === 0 ? -1 : side === 1 ? 1 : 0;
      const along = (t: number, o: number) => ({
        x: sz !== 0 ? cx + t : cx + sx * (e - o),
        z: sz !== 0 ? cz + sz * (e - o) : cz + t,
      });
      for (let k = -2; k <= 2; k++) {
        if (busy && rng() < 0.7) { const p = along(k * 20 + 7, 0.45); meters.push(p); }
      }
      if (shelterBudget > 0 && busy && rng() < 0.3) {
        const p = along((rng() - 0.5) * 50, 1.3);
        shelters.push({ ...p, r: sz === -1 ? Math.PI : sz === 1 ? 0 : sx === -1 ? -Math.PI / 2 : Math.PI / 2, side });
        shelterBudget--;
      }
    }
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bollards.push({ x: cx + ox * (e - 0.9), z: cz + oz * (e - 0.9) });
  }

  // parking meters
  const meterG = mergeGeometries([
    new THREE.CylinderGeometry(0.035, 0.04, 1.15, 6).translate(0, 0.575, 0),
    new THREE.BoxGeometry(0.17, 0.3, 0.12).translate(0, 1.28, 0),
    new THREE.BoxGeometry(0.12, 0.1, 0.02).translate(0, 1.32, 0.065),
  ])!;
  const meterM = new THREE.InstancedMesh(meterG, new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 0.4, metalness: 0.8 }), meters.length);
  meters.forEach((m, n) => { d.position.set(m.x, 0.16, m.z); d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.updateMatrix(); meterM.setMatrixAt(n, d.matrix); w.addCircle(m.x, m.z, 0.12, 1.5); });
  meterM.castShadow = true;
  grp.add(meterM);

  // bollards
  const bolG = mergeGeometries([
    new THREE.CylinderGeometry(0.11, 0.13, 0.95, 10).translate(0, 0.475, 0),
    new THREE.CylinderGeometry(0.115, 0.115, 0.06, 10).translate(0, 0.74, 0),
  ])!;
  const bolM = new THREE.InstancedMesh(bolG, new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.7 }), bollards.length);
  bollards.forEach((m, n) => { d.position.set(m.x, 0.16, m.z); d.updateMatrix(); bolM.setMatrixAt(n, d.matrix); w.addCircle(m.x, m.z, 0.14, 1); });
  bolM.castShadow = true;
  grp.add(bolM);

  // bus shelters (frame + translucent glass)
  if (shelters.length) {
    const frameG = mergeGeometries([
      new THREE.BoxGeometry(3.4, 0.1, 1.5).translate(0, 2.55, 0),
      new THREE.BoxGeometry(0.08, 2.5, 0.08).translate(-1.6, 1.25, 0.65),
      new THREE.BoxGeometry(0.08, 2.5, 0.08).translate(1.6, 1.25, 0.65),
      new THREE.BoxGeometry(0.08, 2.5, 0.08).translate(-1.6, 1.25, -0.65),
      new THREE.BoxGeometry(0.08, 2.5, 0.08).translate(1.6, 1.25, -0.65),
      new THREE.BoxGeometry(2.4, 0.06, 0.5).translate(0, 0.5, -0.4),
      new THREE.BoxGeometry(2.5, 0.5, 0.06).translate(0, 0.25, -0.62),
    ])!;
    const glassG = mergeGeometries([
      new THREE.BoxGeometry(3.1, 1.9, 0.03).translate(0, 1.35, -0.68),
      new THREE.BoxGeometry(0.03, 1.9, 1.2).translate(-1.55, 1.35, 0),
      new THREE.BoxGeometry(0.03, 1.9, 1.2).translate(1.55, 1.35, 0),
    ])!;
    const fm = new THREE.InstancedMesh(frameG, new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.4, metalness: 0.8 }), shelters.length);
    const gm = new THREE.InstancedMesh(glassG, new THREE.MeshStandardMaterial({ color: 0x9cc4d6, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false }), shelters.length);
    shelters.forEach((s, n) => {
      d.position.set(s.x, 0.16, s.z); d.rotation.set(0, s.r, 0); d.updateMatrix();
      fm.setMatrixAt(n, d.matrix); gm.setMatrixAt(n, d.matrix);
      const horizontal = Math.abs(Math.sin(s.r)) < 0.5; // runs along x
      if (horizontal) w.addBox(s.x - 1.7, s.x + 1.7, s.z - 0.8, s.z + 0.8, 2.6);
      else w.addBox(s.x - 0.8, s.x + 0.8, s.z - 1.7, s.z + 1.7, 2.6);
    });
    fm.castShadow = true;
    grp.add(fm, gm);
  }

  w.group.add(grp);
}
