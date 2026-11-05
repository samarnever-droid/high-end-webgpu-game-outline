import * as THREE from 'three/webgpu';
import { buildCar, type CarModel } from './cars';
import type { City, Hit } from './city';
import { clamp } from './geo';

export interface CarControl { throttle: number; steer: number; hand: boolean; boost: boolean }

const BRAKE_ON = new THREE.Color().setRGB(4, 0.1, 0.08);
const BRAKE_OFF = new THREE.Color().setRGB(0.9, 0.03, 0.02);

export class CarEntity {
  model: CarModel;
  x = 0; y = 0; z = 0;
  heading = 0;
  vx = 0; vz = 0;
  steerAngle = 0;
  nitro = 1;
  boosting = false;
  speed = 0; // signed forward speed
  slip = 0;
  throttle = 0;
  onCrash?: (impact: number, x: number, z: number) => void;
  private roll = 0;
  private pitch = 0;
  private hit: Hit = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
  private lastCrash = 0;

  constructor(public kind: string, color: number, opts: { own?: boolean; glow?: number } = {}) {
    this.model = buildCar(kind, color, { own: true, ...opts });
  }

  get group() {
    return this.model.group;
  }

  place(x: number, z: number, heading: number) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = this.vz = 0;
    this.speed = 0;
    this.steerAngle = 0;
    this.sync(0, 0);
  }

  fwd() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  update(dt: number, ctl: CarControl, city: City) {
    const sp = this.model.spec;
    let fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let rx = -fz, rz = fx;
    let vF = this.vx * fx + this.vz * fz;
    let vL = this.vx * rx + this.vz * rz;

    const wantBoost = ctl.boost && this.nitro > 0.03 && ctl.throttle > 0;
    this.boosting = wantBoost;
    if (wantBoost) this.nitro = Math.max(0, this.nitro - dt * 0.28);
    else this.nitro = Math.min(1, this.nitro + dt * 0.1);
    const maxF = wantBoost ? 54 : 38;
    const maxR = 10;

    let a = 0;
    if (ctl.throttle > 0) {
      a = ctl.throttle * 17 * (1 - Math.max(vF, 0) / maxF);
      if (vF < -0.5) a += 30 * ctl.throttle;
      if (wantBoost) a += 16;
    } else if (ctl.throttle < 0) {
      if (vF > 0.5) a = 34 * ctl.throttle;
      else a = ctl.throttle * 9 * (1 - Math.max(-vF, 0) / maxR);
    }
    a -= vF * 0.16;
    if (ctl.throttle === 0) a -= clamp(vF, -1, 1) * 2.4;
    if (ctl.hand) a -= clamp(vF, -1, 1) * 26;
    vF += a * dt;

    const grip = ctl.hand ? 1.3 : 8.5;
    vL *= Math.exp(-grip * dt);

    const maxSteer = 0.62 / (1 + Math.abs(vF) / 13);
    const target = ctl.steer * maxSteer;
    this.steerAngle += (target - this.steerAngle) * (1 - Math.exp(-dt * 9));
    let yaw = (vF / 2.8) * Math.tan(this.steerAngle);
    if (ctl.hand) yaw *= 1.6;
    this.heading -= yaw * dt;

    fx = Math.sin(this.heading);
    fz = Math.cos(this.heading);
    rx = -fz;
    rz = fx;
    this.vx = fx * vF + rx * vL;
    this.vz = fz * vF + rz * vL;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // collisions: three circles along the body
    const half = sp.L / 2 - 0.85;
    const rad = sp.W / 2 + 0.05;
    for (const off of [half, 0, -half]) {
      const cx = this.x + fx * off, cz = this.z + fz * off;
      if (city.resolve(cx, cz, rad, this.hit) && this.hit.hit) {
        this.x += this.hit.x - cx;
        this.z += this.hit.z - cz;
        const vn = this.vx * this.hit.nx + this.vz * this.hit.nz;
        if (vn < 0) {
          const impact = -vn;
          this.vx -= 1.25 * vn * this.hit.nx;
          this.vz -= 1.25 * vn * this.hit.nz;
          this.vx *= 0.93;
          this.vz *= 0.93;
          const now = performance.now();
          if (impact > 3 && now - this.lastCrash > 250) {
            this.lastCrash = now;
            this.onCrash?.(impact, cx + this.hit.nx * -rad, cz + this.hit.nz * -rad);
          }
        }
      }
    }

    this.speed = this.vx * fx + this.vz * fz;
    this.slip = Math.abs(this.vx * rx + this.vz * rz);
    this.throttle = ctl.throttle;
    this.sync(dt, a, ctl);
  }

  /** push the car out of another circle (traffic); returns impact speed */
  bump(nx: number, nz: number, depth: number) {
    this.x += nx * depth;
    this.z += nz * depth;
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      this.vx -= 1.4 * vn * nx;
      this.vz -= 1.4 * vn * nz;
      this.vx *= 0.9;
      this.vz *= 0.9;
      return -vn;
    }
    return 0;
  }

  private sync(dt: number, accel: number, ctl?: CarControl) {
    const g = this.model.group;
    const gy = this.model_groundY;
    const ty = gy(this.x, this.z);
    this.y += (ty - this.y) * (dt > 0 ? 1 - Math.exp(-dt * 14) : 1);
    g.position.set(this.x, this.y, this.z);
    g.rotation.y = this.heading;
    const rt = clamp(-this.steerAngle * this.speed * 0.0065, -0.07, 0.07) + clamp(this.slip * 0.004, 0, 0.05) * Math.sign(this.steerAngle || 1) * -0.5;
    const pt = clamp(-accel * 0.0045, -0.06, 0.06);
    const k = dt > 0 ? 1 - Math.exp(-dt * 8) : 1;
    this.roll += (rt - this.roll) * k;
    this.pitch += (pt - this.pitch) * k;
    this.model.body.rotation.z = this.roll;
    this.model.body.rotation.x = this.pitch;
    const m = this.model;
    const spin = (this.speed * dt) / m.spec.wr;
    for (let i = 0; i < 4; i++) m.spinners[i].rotation.x += spin;
    m.pivots[0].rotation.y = -this.steerAngle;
    m.pivots[1].rotation.y = -this.steerAngle;
    if (ctl) {
      const braking = (ctl.throttle < 0 && this.speed > 0.5) || ctl.hand;
      m.brake.color.copy(braking ? BRAKE_ON : BRAKE_OFF);
      m.flames.forEach((f, i) => {
        f.visible = this.boosting;
        if (this.boosting) f.scale.set(1, 1, 0.7 + Math.random() * 0.8 + i * 0.05);
      });
    }
  }

  groundFn: (x: number, z: number) => number = () => 0;
  private get model_groundY() {
    return this.groundFn;
  }
}
