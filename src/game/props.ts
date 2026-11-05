import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm, type RNG } from './util';
import { mkCanvas, softSprite } from './textures';
import { PUDDLE_GLSL } from './wet';

/** shared wind clock (seconds) */
export const windUniform = { value: 0 };

/** Adds vertex wind sway + procedural leaf speckle to a standard material. */
export function patchFoliage<T extends THREE.MeshStandardMaterial>(mat: T, sway = 1, speckle = true): T {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;\nvarying vec3 vFolP;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wq = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wq = instanceMatrix * wq;
          #endif
          vec3 wpos = (modelMatrix * wq).xyz;
          float hgt = max(position.y - 1.5, 0.0);
          float ph = uWind + wpos.x * 0.31 + wpos.z * 0.23;
          transformed.x += (sin(ph * 1.7 + position.y * 0.8) * 0.05 + sin(ph * 4.1 + position.x * 3.0) * 0.012) * hgt * ${sway.toFixed(2)};
          transformed.z += (cos(ph * 1.3 + position.x * 0.8) * 0.05 + cos(ph * 3.7 + position.z * 3.0) * 0.012) * hgt * ${sway.toFixed(2)};
          vFolP = wpos;
        }`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFolP;\n${PUDDLE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${speckle ? 'diffuseColor.rgb *= 0.62 + 0.7 * wNoise(vFolP.xz * 2.4 + vFolP.y * 1.9) * (0.6 + 0.8 * wNoise(vFolP.xz * 7.0 + vFolP.y * 5.0));' : ''}`
      );
  };
  mat.customProgramCacheKey = () => 'fol' + sway + speckle;
  return mat;
}


/** Layered, smooth-shaded tree crown with baked ambient occlusion in vertex colours. */
export function makeCrownGeometry(rng: RNG): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blobs: [number, number, number, number][] = [
    [0, 0.3, 0, 1.9], [1.2, -0.5, 0.4, 1.3], [-1.1, -0.4, 0.7, 1.35], [0.2, -0.3, -1.3, 1.35], [0.1, 1.2, 0.1, 1.25], [-0.7, 0.5, -0.9, 1.1], [0.9, 0.5, -0.8, 1.05],
  ];
  const ss = rng() * 100;
  for (const [x, y, z, r] of blobs) {
    let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(r, 2);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g = mergeVertices(g);
    const p = g.attributes.position;
    const col: number[] = [];
    for (let i = 0; i < p.count; i++) {
      let px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      const n = 0.82 + fbm(px * 1.7 + ss + x, py * 1.7 + pz * 1.3 + y, 3) * 0.5;
      px *= n; py *= n * 0.86; pz *= n;
      p.setXYZ(i, px + x, py + y + 5.0, pz + z);
      // baked AO: darker toward the trunk / bottom / interior, lighter on the sunny crown
      const wx = px + x, wy = py + y, wz = pz + z;
      const dc = Math.hypot(wx, wy - 0.4, wz);
      const ao = Math.min(1, Math.max(0.28, 0.35 + (wy + 1.6) * 0.2 + dc * 0.12));
      const hue = 0.9 + fbm(wx * 1.1 + ss, wz * 1.1, 2) * 0.35;
      col.push(ao * hue, ao * (0.95 + hue * 0.1), ao * hue * 0.85);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    parts.push(g);
  }
  const m = mergeGeometries(parts)!;
  m.computeVertexNormals();
  return m;
}

export function makeTrunkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const t = new THREE.CylinderGeometry(0.16, 0.3, 4.0, 8, 3); t.translate(0, 2, 0); parts.push(t);
  const flare = new THREE.CylinderGeometry(0.3, 0.52, 0.5, 8, 1); flare.translate(0, 0.25, 0); parts.push(flare);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.05, 0.12, 2.0, 5); b.translate(0, 1.0, 0);
    b.rotateZ(0.7 + (i % 2) * 0.25); b.rotateY(i * 1.7 + 0.4); b.translate(0, 3.0 + i * 0.28, 0);
    parts.push(b);
  }
  for (const g of parts) { g.deleteAttribute('uv'); }
  return mergeGeometries(parts)!;
}

/** Curved palm trunk with ring bands + ~11 drooping fronds. */
export function makePalmGeometries(): { trunk: THREE.BufferGeometry; fronds: THREE.BufferGeometry } {
  const segs: THREE.BufferGeometry[] = [];
  const H = 8.2, lean = 1.4, N = 14;
  const at = (t: number) => new THREE.Vector3(lean * t * t, H * t, 0);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const a = at(t0), b = at(t1);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const r0 = 0.27 - 0.1 * t0, r1 = 0.27 - 0.1 * t1;
    const g = new THREE.CylinderGeometry(r1 * (i % 2 ? 1.0 : 1.12), r0 * (i % 2 ? 1.12 : 1.0), len * 1.02, 8, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());
    g.applyQuaternion(q);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    g.translate(mid.x, mid.y, mid.z);
    g.deleteAttribute('uv');
    segs.push(g);
  }
  const trunk = mergeGeometries(segs)!;
  const top = at(1);
  const fr: THREE.BufferGeometry[] = [];
  const L = 4.6, W = 1.5, S = 9;
  for (let k = 0; k < 11; k++) {
    const yaw = (k / 11) * Math.PI * 2 + (k % 2) * 0.2;
    const rise = 0.9 + (k % 3) * 0.55, droop = 2.0 + (k % 2) * 0.7;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let s = 0; s <= S; s++) {
      const u = s / S;
      const x = u * L;
      const y = rise * Math.sin(u * 2.2) * 1.2 - droop * u * u * 0.85;
      const w = W * (0.55 + 0.45 * Math.sin(Math.min(1, u * 1.4 + 0.12) * Math.PI * 0.9)) * 0.5;
      const tw = u * 0.5;
      for (const side of [-1, 1]) {
        pos.push(x, y + 0.0 - Math.abs(side) * tw * 0.1, side * w);
        uv.push(u, side < 0 ? 0 : 1);
      }
      if (s < S) { const i0 = s * 2; idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.rotateY(yaw);
    g.translate(top.x, top.y, top.z);
    fr.push(g);
  }
  const fronds = mergeGeometries(fr)!;
  fronds.computeVertexNormals();
  return { trunk, fronds };
}

export const frondTexture = (() => {
  let t: THREE.CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const { c, g } = mkCanvas(256, 128);
    g.clearRect(0, 0, 256, 128);
    g.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const x = 6 + i * 5.2;
      for (const side of [-1, 1]) {
        const len = 54 * Math.sin(Math.min(1, 0.25 + (i / 46) * 0.9) * Math.PI * 0.85) + 10;
        g.strokeStyle = `rgb(${34 + (i % 3) * 8},${96 + (i % 5) * 9},${38})`;
        g.lineWidth = 3.4 - (i / 46) * 1.6;
        g.beginPath(); g.moveTo(x, 64);
        g.quadraticCurveTo(x + 10, 64 + side * len * 0.55, x + 22, 64 + side * len);
        g.stroke();
      }
    }
    g.strokeStyle = '#4a6a2a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, 64); g.lineTo(256, 64); g.stroke();
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
})();

/** Water-tank on stilts for rooftops */
export function makeTankGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.CylinderGeometry(1.25, 1.25, 2.4, 16); body.translate(0, 2.6, 0); parts.push(body);
  const cap = new THREE.ConeGeometry(1.3, 0.7, 16); cap.translate(0, 4.15, 0); parts.push(cap);
  const band = new THREE.CylinderGeometry(1.29, 1.29, 0.12, 16); band.translate(0, 2.6, 0); parts.push(band);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.BoxGeometry(0.12, 1.5, 0.12); leg.translate(Math.cos(a) * 0.95, 0.75, Math.sin(a) * 0.95); parts.push(leg);
  }
  for (const g of parts) g.deleteAttribute('uv');
  return mergeGeometries(parts)!;
}

/** Hand-sculpted-looking mountain: displaced cone with vertex-coloured strata, forests and bare rock. */
export function makeMountainGeometry(rng: RNG, radius: number, height: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, height, 36, 16, true);
  g.deleteAttribute('uv');
  const merged = mergeVertices(g);
  const p = merged.attributes.position;
  const seed = rng() * 500;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (y + height / 2) / height; // 0 bottom .. 1 top
    const ang = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const ridge = 1 + (fbm(Math.cos(ang) * 2.2 + seed, Math.sin(ang) * 2.2, 3) - 0.5) * 0.7;
    const bumps = (fbm(x * 0.012 + seed, z * 0.012, 4) - 0.5) * height * 0.28 * (1 - k * 0.4);
    const nr = r * ridge;
    const s = r > 0.001 ? nr / r : 1;
    p.setXYZ(i, x * s, y + bumps + (k > 0.98 ? (rng() - 0.5) * 6 : 0), z * s);
  }
  merged.computeVertexNormals();
  const col: number[] = [];
  const n = merged.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const k = Math.max(0, Math.min(1, (p.getY(i) + height / 2) / height));
    const slope = 1 - Math.abs(n.getY(i));
    const nz = fbm(p.getX(i) * 0.05, p.getZ(i) * 0.05, 3);
    const forest: [number, number, number] = [0.07 + nz * 0.05, 0.16 + nz * 0.1, 0.07];
    const rock: [number, number, number] = [0.3 + nz * 0.1, 0.27 + nz * 0.08, 0.24 + nz * 0.07];
    const peak: [number, number, number] = [0.5, 0.5, 0.52];
    const fk = Math.max(0, Math.min(1, (k - 0.35) * 2.2 + slope * 1.6));
    let c = forest.map((v, j) => v + (rock[j] - v) * fk);
    const pk = Math.max(0, Math.min(1, (k - 0.82) * 5));
    c = c.map((v, j) => v + (peak[j] - v) * pk * 0.6);
    col.push(c[0], c[1], c[2]);
  }
  merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return merged;
}

/** Additive glow sprites (street lamps, aviation lights). Size is clamped on-screen so close ones don't blow up. */
export function makeGlow(positions: THREE.Vector3[], size: number, color: number, opacity = 0): THREE.Points {
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(positions.length * 3);
  positions.forEach((v, i) => arr.set([v.x, v.y, v.z], i * 3));
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const mat = new THREE.PointsMaterial({ map: softSprite(), color, size, sizeAttenuation: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <logdepthbuf_vertex>', '#ifdef USE_SIZEATTENUATION\n gl_PointSize = min(gl_PointSize, scale * 0.22);\n#endif\n#include <logdepthbuf_vertex>');
  };
  const p = new THREE.Points(g, mat);
  p.frustumCulled = false;
  p.renderOrder = 5;
  return p;
}
