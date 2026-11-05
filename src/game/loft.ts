import * as THREE from 'three';

/**
 * Loft builder: sweeps elliptical / super-elliptical cross-sections along a path to create smooth,
 * organic meshes. Used for the human anatomy (skinned) and car body shells (plain).
 */
export interface Ring {
  p: [number, number, number];
  rx: number; // half extent along local X
  rz: number; // half extent along local Y(axis z) or Z(axis y)  (top half if rzb is set)
  rzb?: number; // bottom half extent (axis 'z' only)
  n?: number; // super-ellipse exponent (2 = ellipse, 4 = rounded box)
  ox?: number; // lateral offset of the section centre
  bones?: [number, number][]; // [boneIndex, weight] pairs (max 4)
  shape?: (a: number) => number; // radius multiplier by angle
}

export interface LoftOpts {
  segs?: number;
  axis?: 'y' | 'z';
  capStart?: boolean;
  capEnd?: boolean;
  uv?: 'cyl' | 'planar';
  uvScale?: [number, number];
  planar?: (x: number, y: number, z: number) => [number, number];
  displace?: (x: number, y: number, z: number) => [number, number, number];
  flip?: boolean;
  bone?: number; // default bone if ring has none
}

interface Group {
  pos: number[]; nrm: number[]; uv: number[]; si: number[]; sw: number[]; idx: number[];
}

const _v = new THREE.Vector3();

export class MeshBuilder {
  groups = new Map<string, Group>();

  private g(name: string): Group {
    let g = this.groups.get(name);
    if (!g) {
      g = { pos: [], nrm: [], uv: [], si: [], sw: [], idx: [] };
      this.groups.set(name, g);
    }
    return g;
  }

  private pushVert(g: Group, p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, bones: [number, number][]) {
    g.pos.push(p.x, p.y, p.z);
    g.nrm.push(n.x, n.y, n.z);
    g.uv.push(u, v);
    let tot = 0;
    for (let i = 0; i < 4; i++) tot += bones[i] ? bones[i][1] : 0;
    for (let i = 0; i < 4; i++) {
      g.si.push(bones[i] ? bones[i][0] : 0);
      g.sw.push(bones[i] && tot > 0 ? bones[i][1] / tot : i === 0 ? 1 : 0);
    }
  }

  loft(group: string, rings: Ring[], o: LoftOpts = {}) {
    const g = this.g(group);
    const segs = o.segs ?? 20;
    const axis = o.axis ?? 'y';
    const R = rings.length;
    const grid: THREE.Vector3[][] = [];
    const def: [number, number][] = [[o.bone ?? 0, 1]];

    for (let i = 0; i < R; i++) {
      const r = rings[i];
      const row: THREE.Vector3[] = [];
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        let c = Math.cos(a), s = Math.sin(a);
        if (r.n && r.n !== 2) {
          c = Math.sign(c) * Math.pow(Math.abs(c), 2 / r.n);
          s = Math.sign(s) * Math.pow(Math.abs(s), 2 / r.n);
        }
        const m = r.shape ? r.shape(a) : 1;
        let x: number, y: number, z: number;
        if (axis === 'y') {
          x = r.p[0] + (r.ox ?? 0) + r.rx * c * m;
          y = r.p[1];
          z = r.p[2] + r.rz * s * m;
        } else {
          const rzz = s < 0 && r.rzb !== undefined ? r.rzb : r.rz;
          x = r.p[0] + (r.ox ?? 0) + r.rx * c * m;
          y = r.p[1] + rzz * s * m;
          z = r.p[2];
        }
        if (o.displace) {
          const d = o.displace(x, y, z);
          x += d[0]; y += d[1]; z += d[2];
        }
        row.push(new THREE.Vector3(x, y, z));
      }
      grid.push(row);
    }

    // orientation sign: normal from grid should point away from the section centre
    const sample = (i: number, j: number) => {
      const i0 = Math.max(0, i - 1), i1 = Math.min(R - 1, i + 1);
      const j0 = (j - 1 + segs) % segs, j1 = (j + 1) % segs;
      const a = _v.copy(grid[i][j1]).sub(grid[i][j0]);
      const b = new THREE.Vector3().copy(grid[i1][j]).sub(grid[i0][j]);
      return new THREE.Vector3().crossVectors(a, b).normalize();
    };
    let sign = 1;
    {
      const mi = Math.floor(R / 2);
      const n = sample(mi, 0);
      const r = rings[mi];
      const out = new THREE.Vector3().copy(grid[mi][0]).sub(new THREE.Vector3(r.p[0] + (r.ox ?? 0), r.p[1], r.p[2]));
      if (n.dot(out) < 0) sign = -1;
      if (o.flip) sign = -sign;
    }

    // cumulative length for UV v
    const lens: number[] = [0];
    for (let i = 1; i < R; i++) {
      lens.push(lens[i - 1] + new THREE.Vector3(...rings[i].p).distanceTo(new THREE.Vector3(...rings[i - 1].p)));
    }
    const uvs = o.uvScale ?? [1, 1];
    const base = g.pos.length / 3;
    for (let i = 0; i < R; i++) {
      const bones = rings[i].bones ?? def;
      for (let j = 0; j <= segs; j++) {
        const jj = j % segs;
        const p = grid[i][jj];
        const n = sample(i, jj).multiplyScalar(sign);
        let u: number, v: number;
        if (o.uv === 'planar' && o.planar) [u, v] = o.planar(p.x, p.y, p.z);
        else {
          u = (j / segs) * uvs[0];
          v = lens[i] * uvs[1];
        }
        this.pushVert(g, p, n, u, v, bones);
      }
    }
    const row = segs + 1;
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = base + i * row + j, b = a + 1, c = a + row, d = c + 1;
        if (sign > 0) g.idx.push(a, b, d, a, d, c);
        else g.idx.push(a, d, b, a, c, d);
      }
    }

    const cap = (ri: number, dir: number) => {
      const r = rings[ri];
      const bones = r.bones ?? def;
      const cen = new THREE.Vector3(r.p[0] + (r.ox ?? 0), r.p[1], r.p[2]);
      const n = axis === 'y' ? new THREE.Vector3(0, dir, 0) : new THREE.Vector3(0, 0, dir);
      const cb = g.pos.length / 3;
      this.pushVert(g, cen, n, 0.5, 0.5, bones);
      for (let j = 0; j < segs; j++) {
        const p = grid[ri][j];
        this.pushVert(g, p, n, 0.5 + (p.x - cen.x) * 2, 0.5 + (axis === 'y' ? p.z - cen.z : p.y - cen.y) * 2, bones);
      }
      for (let j = 0; j < segs; j++) {
        const a = cb + 1 + j, b = cb + 1 + ((j + 1) % segs);
        // choose winding so geometric normal matches dir
        const pa = grid[ri][j], pb = grid[ri][(j + 1) % segs];
        const gn = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(pa, cen), new THREE.Vector3().subVectors(pb, cen));
        const dot = axis === 'y' ? gn.y * dir : gn.z * dir;
        if (dot > 0) g.idx.push(cb, a, b);
        else g.idx.push(cb, b, a);
      }
    };
    if (o.capStart) cap(0, -1);
    if (o.capEnd) cap(R - 1, 1);
  }

  /** add an existing geometry, transformed into bind space, rigidly bound to a bone */
  rigid(group: string, geo: THREE.BufferGeometry, m: THREE.Matrix4 | null, bone = 0) {
    const g = this.g(group);
    const src = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m) src.applyMatrix4(m);
    src.computeVertexNormals === undefined || (src.attributes.normal ?? src.computeVertexNormals());
    const pa = src.attributes.position, na = src.attributes.normal, ua = src.attributes.uv;
    const base = g.pos.length / 3;
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      p.fromBufferAttribute(pa, i);
      n.fromBufferAttribute(na, i);
      this.pushVert(g, p, n, ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0, [[bone, 1]]);
      g.idx.push(base + i);
    }
    src.dispose();
  }

  /** flat-shaded / custom vertex hook for box-like pieces */
  box(group: string, w: number, h: number, d: number, x: number, y: number, z: number, bone = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    this.rigid(group, new THREE.BoxGeometry(w, h, d), m, bone);
  }

  has(group: string) {
    return this.groups.has(group);
  }

  build(group: string, skinned: boolean): THREE.BufferGeometry | null {
    const g = this.groups.get(group);
    if (!g || !g.pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
    if (skinned) {
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(g.si, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(g.sw, 4));
    }
    geo.setIndex(g.idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

export function matT(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
}
