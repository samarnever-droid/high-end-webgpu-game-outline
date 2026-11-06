import * as THREE from 'three';
import type { RNG } from './util';
import type { FacadeKind } from './textures';

/**
 * Architectural dressing: turns flat textured boxes into buildings with real depth —
 * projecting floor slabs, window sills + lintels, pilasters / curtain-wall mullions,
 * fire escapes, porches, shutters, chimneys, stepped crowns and spires.
 * Everything is axis-aligned geometry written into the same merged "plain" vertex-colour mesh.
 */
export interface Paint {
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.Color): void;
}

export interface Bld {
  x0: number; z0: number; w: number; d: number;
  floors: number; kind: FacadeKind; gable: boolean; special: boolean;
}

const FH = 3.6;
const BAY = 3;
const col = (h: number) => new THREE.Color(h);
const hsl = (h: number, s: number, l: number) => new THREE.Color().setHSL(h, s, l);

interface Pal { fin: THREE.Color; band: THREE.Color; sill: THREE.Color; dark: THREE.Color }
function palette(kind: FacadeKind, rng: RNG): Pal {
  const j = (rng() - 0.5) * 0.06;
  switch (kind) {
    case 'glass': return { fin: col(0x10161b), band: col(0x1a242c), sill: col(0x222c33), dark: col(0x0c1014) };
    case 'office': return { fin: hsl(0.1, 0.05, 0.62 + j), band: hsl(0.1, 0.04, 0.5 + j), sill: hsl(0.1, 0.04, 0.72), dark: col(0x2a2c2e) };
    case 'brick': return { fin: hsl(0.08, 0.28, 0.62 + j), band: hsl(0.09, 0.2, 0.7 + j), sill: hsl(0.1, 0.12, 0.82), dark: col(0x2a2018) };
    case 'apartment': return { fin: hsl(0.1, 0.22, 0.86 + j), band: hsl(0.1, 0.2, 0.74 + j), sill: hsl(0.11, 0.1, 0.92), dark: col(0x3a3630) };
    case 'concrete': return { fin: hsl(0.1, 0.02, 0.42 + j), band: hsl(0.1, 0.02, 0.36 + j), sill: hsl(0.1, 0.02, 0.55), dark: col(0x222426) };
    default: return { fin: hsl(0.08, 0.1, 0.3), band: hsl(0.08, 0.1, 0.24), sill: hsl(0.08, 0.1, 0.5), dark: col(0x15110e) };
  }
}

export function dressBuilding(p: Paint, b: Bld, rng: RNG) {
  const { x0, z0, w, d, floors, kind, gable } = b;
  const hh = floors * FH;
  const bx = x0 + w / 2, bz = z0 + d / 2;
  const pal = palette(kind, rng);

  // ---- wall frame: side s runs along t = 0..L, outward normal (nx, nz)
  const sides = [
    { L: w, px: (t: number) => x0 + t, pz: () => z0 + d, nx: 0, nz: 1 },
    { L: w, px: (t: number) => x0 + w - t, pz: () => z0, nx: 0, nz: -1 },
    { L: d, px: () => x0 + w, pz: (t: number) => z0 + d - t, nx: 1, nz: 0 },
    { L: d, px: () => x0, pz: (t: number) => z0 + t, nx: -1, nz: 0 },
  ];
  /** strip across a wall: t0..t1 along the wall, y..y+h, projecting `off` */
  const strip = (s: number, t0: number, t1: number, y: number, h: number, off: number, c: THREE.Color) => {
    const S = sides[s];
    const tc = (t0 + t1) / 2, len = t1 - t0;
    const cx = S.px(tc), cz = S.pz(tc);
    if (S.nz !== 0) p.box(cx, y, cz + S.nz * off / 2, len, h, off, c);
    else p.box(cx + S.nx * off / 2, y, cz, off, h, len, c);
  };
  const ring = (y: number, h: number, off: number, c: THREE.Color) => {
    strip(0, -off, w + off, y, h, off, c);
    strip(1, -off, w + off, y, h, off, c);
    strip(2, 0, d, y, h, off, c);
    strip(3, 0, d, y, h, off, c);
  };

  if (gable) {
    dressHouse(p, b, rng, strip, pal);
    return;
  }

  const flat = kind === 'glass' || kind === 'office';
  const lowDetail = floors > 14;

  // ---- floor slabs (projecting spandrels) every floor
  if (floors > 1) {
    const stepF = floors > 22 ? 2 : 1; // very tall towers: every second floor keeps vertex count sane
    for (let f = 1; f < floors; f += stepF) {
      ring(f * FH - 0.13, stepF > 1 ? 0.34 : 0.26, flat ? 0.22 : 0.16, pal.band);
    }
  }

  // ---- window sills + lintels (masonry types, lower storeys only for performance)
  if (!flat && floors > 1) {
    const maxF = Math.min(floors, 9);
    for (let f = 0; f < maxF; f++) {
      const y = f * FH;
      const sillY = y + 0.7, lintY = y + 3.02;
      ring(sillY, 0.09, 0.14, pal.sill);
      if (f > 0 || kind !== 'shop') ring(lintY, 0.1, 0.1, pal.sill);
    }
  }

  // ---- vertical fins: pilasters / mullions at bay boundaries
  const finW = kind === 'glass' ? 0.16 : flat ? 0.26 : 0.5;
  const finOff = kind === 'glass' ? 0.14 : flat ? 0.2 : 0.28;
  const finStep = kind === 'glass' || flat ? 1 : (kind === 'concrete' ? 2 : 1);
  for (let s = 0; s < 4; s++) {
    const L = sides[s].L;
    const nb = Math.floor(L / BAY);
    for (let k = 1; k <= nb; k += finStep) {
      const t = k * BAY;
      if (t > L - 0.9) continue;
      const y0 = kind === 'glass' ? 0.9 : 0.9;
      strip(s, t - finW / 2, t + finW / 2, y0, hh - y0 - 0.6, finOff, pal.fin);
    }
  }

  // ---- corner piers for glass/office (stone corners frame the curtain wall)
  if (flat) {
    for (const [px, pz] of [[x0, z0], [x0 + w, z0], [x0, z0 + d], [x0 + w, z0 + d]]) {
      p.box(px, 0.9, pz, 0.7, hh - 1.5, 0.7, pal.fin);
    }
  }

  // ---- drain pipes on masonry
  if (!flat && floors > 2) {
    for (const [px, pz] of [[x0 + 0.5, z0 - 0.08], [x0 + w - 0.5, z0 + d + 0.08]]) p.box(px, 0.2, pz, 0.14, hh - 0.6, 0.14, col(0x3b3d40));
  }

  // ---- fire escape (brick / apartment walk-ups): zig-zag stairs between alternating landings
  if ((kind === 'brick' || kind === 'apartment') && !b.special && floors >= 4 && floors <= 12 && w > 12 && rng() < 0.55) {
    const side = rng() < 0.5 ? 1 : 0;
    const S = sides[side];
    const maxK = Math.max(0, Math.floor((S.L - 9) / BAY));
    const tc = 2.2 + BAY * Math.floor(rng() * (maxK + 1));
    const metal = col(0x1c1e20);
    const at = (t: number, off: number) => ({ x: S.px(t) + S.nx * off, z: S.pz(t) + S.nz * off });
    const top = Math.min(floors, 10);
    for (let f = 1; f < top; f++) {
      const y = f * FH + 0.3;
      const tf = tc + (f % 2) * 4.2;
      const lc = at(tf, 0.62);
      if (S.nz !== 0) {
        p.box(lc.x, y, lc.z, 2.0, 0.07, 1.2, metal);
        p.box(lc.x, y + 0.5, lc.z + S.nz * 0.58, 2.0, 0.05, 0.05, metal);
        p.box(lc.x, y + 0.95, lc.z + S.nz * 0.58, 2.0, 0.06, 0.06, metal);
        for (const e of [-0.98, 0.98]) p.box(lc.x + e, y, lc.z, 0.05, 0.95, 1.2, metal);
      } else {
        p.box(lc.x, y, lc.z, 1.2, 0.07, 2.0, metal);
        p.box(lc.x + S.nx * 0.58, y + 0.5, lc.z, 0.05, 0.05, 2.0, metal);
        p.box(lc.x + S.nx * 0.58, y + 0.95, lc.z, 0.06, 0.06, 2.0, metal);
        for (const e of [-0.98, 0.98]) p.box(lc.x, y, lc.z + e, 1.2, 0.95, 0.05, metal);
      }
      // flight down to the landing below (or the street from floor 1)
      for (let k = 0; k < 8; k++) {
        const u = (k + 0.5) / 8;
        const tt = f % 2 === 1 ? tc + 1.0 + u * 2.2 : tc + 3.2 - u * 2.2;
        const sc = at(tt, 0.62);
        const yy = y - u * FH;
        if (S.nz !== 0) p.box(sc.x, yy, sc.z, 0.3, 0.05, 0.8, metal);
        else p.box(sc.x, yy, sc.z, 0.8, 0.05, 0.3, metal);
      }
    }
  }

  // ---- storefront bulkhead + door frames for shops / ground floors
  if (kind === 'shop' || kind === 'office' || kind === 'glass') {
    strip(0, 0, w, 0, 0.55, 0.18, pal.dark);
    strip(1, 0, w, 0, 0.55, 0.18, pal.dark);
  }

  // ---- crown: stepped setbacks + spire + parapet lighting trim
  if (floors >= 10 && (kind === 'glass' || kind === 'office' || kind === 'concrete')) {
    const cw1 = w * 0.7, cd1 = d * 0.7;
    p.box(bx, hh, bz, cw1, 1.6, cd1, pal.band);
    // corner finials
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) p.box(bx + sx * (w / 2 - 0.4), hh, bz + sz * (d / 2 - 0.4), 0.8, 2.4, 0.8, pal.fin);
    if (floors >= 18) {
      const cw2 = cw1 * 0.55, cd2 = cd1 * 0.55;
      p.box(bx, hh + 1.6, bz, cw2, 2.4, cd2, pal.dark);
      p.box(bx, hh + 4.0, bz, cw2 * 0.6, 1.4, cd2 * 0.6, pal.band);
      const sp = 8 + rng() * 12;
      p.box(bx, hh + 5.4, bz, 0.35, sp, 0.35, col(0x2a2d30));
      p.box(bx, hh + 5.4 + sp * 0.55, bz, 2.6, 0.12, 0.12, col(0x2a2d30));
    }
  }

  // ---- rooftop screen walls around mechanical (adds silhouette)
  if (floors >= 6 && floors < 18 && !flat && rng() < 0.5) {
    p.box(bx + (rng() - 0.5) * w * 0.3, hh, bz + (rng() - 0.5) * d * 0.3, Math.min(6, w * 0.25), 2.2, 0.4, pal.band);
  }

  void lowDetail;
}

// ------------------------------------------------------------------ pitched-roof houses
function dressHouse(
  p: Paint, b: Bld, rng: RNG,
  strip: (s: number, t0: number, t1: number, y: number, h: number, off: number, c: THREE.Color) => void,
  pal: Pal,
) {
  const { x0, z0, w, d, floors } = b;
  const hh = floors * FH;
  const bz = z0 + d / 2;
  const ph = Math.min(w, d) * 0.28;

  // stone foundation
  strip(0, -0.1, w + 0.1, 0, 0.55, 0.14, col(0x6a655e));
  strip(1, -0.1, w + 0.1, 0, 0.55, 0.14, col(0x6a655e));
  strip(2, 0, d, 0, 0.55, 0.14, col(0x6a655e));
  strip(3, 0, d, 0, 0.55, 0.14, col(0x6a655e));

  // sills + header trim per floor, corner boards
  for (let f = 0; f < floors; f++) {
    for (let s = 0; s < 4; s++) {
      strip(s, 0, s < 2 ? w : d, f * FH + 0.7, 0.08, 0.14, pal.sill);
    }
  }
  for (const [px, pz] of [[x0, z0], [x0 + w, z0], [x0, z0 + d], [x0 + w, z0 + d]]) p.box(px, 0, pz, 0.34, hh, 0.34, pal.sill);
  if (floors > 1) for (let s = 0; s < 4; s++) strip(s, 0, s < 2 ? w : d, FH - 0.1, 0.2, 0.12, pal.band);

  // shutters on the front/back
  if (floors <= 3 && rng() < 0.85) {
    const sc = [0x2f5a3a, 0x7a2a22, 0x23405e, 0x3a3a3e, 0x5a4630][Math.floor(rng() * 5)];
    const shut = col(sc);
    for (const s of [0, 1]) {
      const nb = Math.floor((s < 2 ? w : d) / BAY);
      for (let f = 0; f < floors; f++) {
        if (f === 0 && s === 0 && floors <= 2) continue; // door side ground floor stays clear for the porch
        for (let k = 0; k < nb; k++) {
          strip(s, k * BAY + 0.03, k * BAY + 0.4, f * FH + 0.78, 2.15, 0.07, shut);
          strip(s, k * BAY + 2.6, k * BAY + 2.97, f * FH + 0.78, 2.15, 0.07, shut);
        }
      }
    }
  }

  // chimney through the ridge
  const cx = rng() < 0.5 ? x0 + w * 0.28 : x0 + w * 0.72;
  p.box(cx, hh, bz, 0.95, ph + 1.8, 0.95, col(0x7a4636));
  p.box(cx, hh + ph + 1.8, bz, 1.2, 0.18, 1.2, col(0x55524e));

  // front porch with steps, posts and roof (low houses only)
  if (floors <= 2 && w > 8) {
    const px = x0 + w / 2, pz = z0 + d;
    const pw = 5.2, pd = 2.3;
    p.box(px, 0.17, pz + pd / 2, pw, 0.3, pd, col(0x8a857c));
    for (let k = 0; k < 2; k++) p.box(px, 0.17 + k * 0.0, pz + pd + 0.2 + (1 - k) * 0.25, pw * 0.5, 0.15 * (k + 1), 0.4, col(0x9a958c));
    for (const sx of [-1, 1]) p.box(px + sx * (pw / 2 - 0.15), 0.47, pz + pd - 0.15, 0.22, 2.7, 0.22, col(0xece6da));
    p.box(px, 3.15, pz + pd / 2 + 0.2, pw + 0.5, 0.18, pd + 0.6, col(0x5a4a40));
    p.box(px, 1.0, pz + pd - 0.12, pw - 0.6, 0.07, 0.07, col(0xece6da));
    // door
    p.box(px, 0.47, pz + 0.05, 1.3, 2.4, 0.12, col([0x6a2a22, 0x23405e, 0x2f5a3a, 0x40382e][Math.floor(rng() * 4)]));
  }

  // garden fence
  if (rng() < 0.55) {
    const fc = col(0xe9e4d8);
    const fz = z0 + d + 3.4;
    const n = Math.floor(w / 0.9);
    for (let k = 0; k <= n; k++) p.box(x0 + k * (w / n), 0.17, fz, 0.1, 0.95, 0.1, fc);
    p.box(x0 + w / 2, 0.17 + 0.62, fz, w, 0.08, 0.06, fc);
    p.box(x0 + w / 2, 0.17 + 0.25, fz, w, 0.08, 0.06, fc);
  }
}
