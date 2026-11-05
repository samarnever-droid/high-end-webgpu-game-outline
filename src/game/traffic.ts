import * as THREE from 'three/webgpu';
import { buildCar, type CarModel } from './cars';
import { N, R, c, bc, signal, SIDEWALK_H } from './city';
import { Pedestrian } from './character';

const LW = 648;
const HALF = 324;
const COLORS = [0xe8e8e8, 0x1a1a1c, 0xa31f1f, 0x1d4e89, 0xd9d9d9, 0xc9a227, 0x2f5d3a, 0x6b6e75, 0xf2f2f2, 0xe86a1c];
const KINDS = ['sedan', 'sedan', 'hatch', 'hatch', 'suv', 'sport'];

interface TCar {
  model: CarModel;
  axis: 'x' | 'z';
  line: number;
  dir: 1 | -1;
  off: number;
  s: number;
  v: number;
  vmax: number;
  x: number;
  z: number;
  heading: number;
}

export class Traffic {
  cars: TCar[] = [];
  group = new THREE.Group();

  constructor(count: number, rng: () => number) {
    let guard = 0;
    while (this.cars.length < count && guard++ < 1000) {
      const axis: 'x' | 'z' = rng() < 0.5 ? 'x' : 'z';
      const line = Math.floor(rng() * (N + 1));
      const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
      const off = rng() < 0.5 ? 2 : 6;
      const s = rng() * LW;
      const clash = this.cars.some(
        (o) => o.axis === axis && o.line === line && o.dir === dir && o.off === off &&
          Math.min(Math.abs(o.s - s), LW - Math.abs(o.s - s)) < 40
      );
      if (clash) continue;
      const kind = KINDS[Math.floor(rng() * KINDS.length)];
      const model = buildCar(kind, COLORS[Math.floor(rng() * COLORS.length)]);
      model.group.visible = true;
      this.group.add(model.group);
      const vmax = 8 + rng() * 6;
      const car: TCar = { model, axis, line, dir, off, s, v: vmax * 0.8, vmax, x: 0, z: 0, heading: 0 };
      this.place(car);
      this.cars.push(car);
    }
  }

  private place(car: TCar) {
    const coord = car.dir * (car.s - HALF);
    if (car.axis === 'x') {
      car.x = coord;
      car.z = c(car.line) - car.dir * car.off;
      car.heading = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.x = c(car.line) + car.dir * car.off;
      car.z = coord;
      car.heading = car.dir > 0 ? 0 : Math.PI;
    }
  }

  update(dt: number, t: number, obstacles: { x: number; z: number }[], cam: THREE.Vector3) {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      let vdes = a.vmax;

      // traffic light
      const sig = signal(a.axis, t);
      if (sig !== 0) {
        let bestD = 1e9;
        for (let m = 0; m <= N; m++) {
          const stopS = a.dir * c(m) + HALF - R / 2 - 6.8;
          const d = stopS - a.s;
          if (d >= -0.6 && d < bestD) bestD = d;
        }
        if (bestD < 30 && !(sig === 1 && bestD < 7)) vdes = Math.min(vdes, Math.max(0, bestD) * 0.9);
      }

      // car ahead in lane
      let bestGap = 1e9;
      for (let j = 0; j < cars.length; j++) {
        if (i === j) continue;
        const b = cars[j];
        if (b.axis !== a.axis || b.line !== a.line || b.dir !== a.dir || b.off !== a.off) continue;
        const g = (b.s - a.s + LW) % LW;
        if (g < bestGap) bestGap = g;
      }
      if (bestGap < 60) vdes = Math.min(vdes, Math.max(0, bestGap - 4.9 - 3) * 0.8);

      // player / mission car in the way
      const hx = a.axis === 'x' ? a.dir : 0, hz = a.axis === 'z' ? a.dir : 0;
      for (const o of obstacles) {
        const rx = o.x - a.x, rz = o.z - a.z;
        const along = rx * hx + rz * hz;
        const lat = Math.abs(rx * hz - rz * hx);
        if (along > 0 && along < 16 && lat < 2.8) vdes = Math.min(vdes, Math.max(0, along - 6) * 0.8);
      }

      a.v += Math.max(-16 * dt, Math.min(3.2 * dt, vdes - a.v));
      if (a.v < 0) a.v = 0;
      a.s += a.v * dt;
      if (a.s >= LW) a.s -= LW;
      this.place(a);

      const g = a.model.group;
      const dx = a.x - cam.x, dz = a.z - cam.z;
      const vis = dx * dx + dz * dz < 320 * 320;
      g.visible = vis;
      if (vis) {
        g.position.set(a.x, 0, a.z);
        g.rotation.y = a.heading;
        const spin = (a.v * dt) / a.model.spec.wr;
        for (let k = 0; k < 4; k++) a.model.spinners[k].rotation.x += spin;
      }
    }
  }
}

interface PedInst { p: Pedestrian; bi: number; bj: number; u: number; speed: number; dir: 1 | -1 }

export class Peds {
  group = new THREE.Group();
  list: PedInst[] = [];
  constructor(count: number, rng: () => number) {
    for (let k = 0; k < count; k++) {
      const p = new Pedestrian(rng);
      p.root.visible = false;
      this.group.add(p.root);
      this.list.push({
        p, bi: Math.floor(rng() * N), bj: Math.floor(rng() * N), u: rng() * 224,
        speed: rng() < 0.12 ? 2.8 : 1.1 + rng() * 0.7, dir: rng() < 0.5 ? 1 : -1,
      });
    }
  }

  update(dt: number, px: number, pz: number) {
    const H = 28;
    for (const q of this.list) {
      q.u = (q.u + q.dir * q.speed * dt + 224) % 224;
      const side = Math.floor(q.u / 56);
      const w = q.u - side * 56;
      let x = 0, z = 0, hx = 0, hz = 0;
      if (side === 0) { x = -H + w; z = -H; hx = 1; }
      else if (side === 1) { x = H; z = -H + w; hz = 1; }
      else if (side === 2) { x = H - w; z = H; hx = -1; }
      else { x = -H; z = H - w; hz = -1; }
      const wx = bc(q.bi) + x, wz = bc(q.bj) + z;
      const dx = wx - px, dz = wz - pz;
      const near = dx * dx + dz * dz < 150 * 150;
      q.p.root.visible = near;
      if (!near) continue;
      q.p.root.position.set(wx, SIDEWALK_H, wz);
      q.p.root.rotation.y = Math.atan2(hx * q.dir, hz * q.dir);
      q.p.update(dt, q.speed);
    }
  }
}
