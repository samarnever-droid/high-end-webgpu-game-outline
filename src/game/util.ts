import * as THREE from 'three';

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type RNG = () => number;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
export function angDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function dampAngle(a: number, b: number, k: number, dt: number) {
  return a + angDiff(a, b) * (1 - Math.exp(-k * dt));
}
export const pick = <T,>(arr: T[], rng: RNG = Math.random): T => arr[Math.floor(rng() * arr.length) % arr.length];
export const range = (rng: RNG, a: number, b: number) => a + (b - a) * rng();
export const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** deterministic hash-based value noise */
function hash2(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x: number, y: number, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    f *= 2;
    a *= 0.5;
  }
  return s;
}

export function fmtMoney(n: number) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

/** heading -> forward vector (x,z) */
export const fwdOf = (h: number) => ({ x: Math.sin(h), z: Math.cos(h) });

export class Timer {
  t = 0;
  constructor(public dur: number) {}
  tick(dt: number) {
    this.t += dt;
    if (this.t >= this.dur) {
      this.t = 0;
      return true;
    }
    return false;
  }
}

/** simple event emitter */
export class Emitter<E extends Record<string, unknown>> {
  private h: { [K in keyof E]?: ((v: E[K]) => void)[] } = {};
  on<K extends keyof E>(k: K, f: (v: E[K]) => void) {
    (this.h[k] ??= []).push(f);
    return () => {
      this.h[k] = this.h[k]!.filter((x) => x !== f);
    };
  }
  emit<K extends keyof E>(k: K, v: E[K]) {
    this.h[k]?.forEach((f) => f(v));
  }
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** circle vs. oriented-box helpers used by physics */
export interface OBB {
  x: number; z: number; hx: number; hz: number; rot: number; h: number; // h = height top
  cos: number; sin: number;
  kind: number; // 0=building 1=prop 2=vehicle-static
  id: number;
}
