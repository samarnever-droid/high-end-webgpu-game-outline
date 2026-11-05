import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function M4(
  x = 0, y = 0, z = 0,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy = 1, sz = 1
) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** Collects many small geometries into one vertex-coloured geometry. */
export class Merger {
  list: THREE.BufferGeometry[] = [];
  private tmp = new THREE.Color();

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix?: THREE.Matrix4, mul = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) {
      if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    }
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    this.tmp.set(color);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = this.tmp.r * mul;
      arr[i * 3 + 1] = this.tmp.g * mul;
      arr[i * 3 + 2] = this.tmp.b * mul;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.list.push(g);
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, mul = 1, ry = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, M4(x, y, z, 0, ry, 0), mul);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list, false);
    this.list.forEach((l) => l.dispose());
    this.list = [];
    if (g) {
      g.computeBoundingSphere();
      g.computeBoundingBox();
    }
    return g;
  }
}

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

export function speckle(g: CanvasRenderingContext2D, w: number, h: number, count: number, rng: () => number, alpha = 0.08) {
  for (let i = 0; i < count; i++) {
    const v = rng() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${rng() * alpha})`;
    g.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
  }
}

export function texFrom(
  c: HTMLCanvasElement,
  opts: { repeat?: boolean; srgb?: boolean; aniso?: number } = {}
) {
  const t = new THREE.CanvasTexture(c);
  if (opts.repeat !== false) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function angDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
