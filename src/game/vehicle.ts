import * as THREE from 'three';
import { buildCar, type CarKind, type CarModel } from './carmodels';
import type { World, Hit } from './world';
import { clamp, damp } from './util';
import type { Human } from './humanoid';

export interface CarControl { throttle: number; steer: number; hand: boolean; boost: boolean }
export const noControl = (): CarControl => ({ throttle: 0, steer: 0, hand: false, boost: false });

let VID = 1;
const BRAKE_ON = 4, BRAKE_OFF = 0.35;

export class Vehicle {
  id = VID++;
  model: CarModel;
  kind: CarKind;
  x = 0; y = 0; z = 0;
  heading = 0;
  vx = 0; vz = 0; vy = 0;
  speed = 0; slip = 0; steerAngle = 0; yawRate = 0;
  health = 1000;
  maxHealth = 1000;
  nitro = 1;
  boosting = false;
  burning = 0;
  wrecked = false;
  exploded = false;
  ctl: CarControl = noControl();
  driver: Human | null = null;
  isPlayer = false;
  role: 'traffic' | 'police' | 'player' | 'parked' | 'mission' | 'swat' = 'traffic';
  airborne = false;
  headlights = false;
  horn = false;
  radius: number;
  mass: number;
  color: number;
  onCrash?: (v: Vehicle, impact: number, x: number, z: number) => void;
  onExplode?: (v: Vehicle) => void;
  private roll = 0; private pitch = 0; private gpitch = 0;
  private hit: Hit = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
  private lastCrash = 0;
  sirenOn = false;
  private sirenT = 0;
  skid = false;
  ai: unknown = null;
  tag = '';

  constructor(kind: CarKind, color: number, opts: { plate?: string } = {}) {
    this.kind = kind;
    this.color = color;
    this.model = buildCar(kind, color, opts);
    this.radius = this.model.spec.W / 2 + 0.05;
    this.mass = this.model.spec.mass;
    this.model.group.rotation.order = 'YXZ';
  }
  get group() { return this.model.group; }
  get spec() { return this.model.spec; }
  get alive() { return !this.wrecked; }

  place(x: number, z: number, heading: number, world: World) {
    this.x = x; this.z = z; this.heading = heading;
    this.vx = this.vz = this.vy = 0; this.speed = 0; this.steerAngle = 0;
    this.y = world.groundY(x, z);
    this.sync(0, 0, world);
  }

  fwd() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }

  repair() {
    this.health = this.maxHealth;
    this.burning = 0; this.wrecked = false; this.exploded = false;
    this.model.paint.color.setHex(this.color);
  }

  setColor(c: number) {
    this.color = c;
    this.model.paint.color.setHex(c);
  }

  damage(n: number) {
    if (this.wrecked) return;
    this.health -= n;
    if (this.health <= 0) {
      this.health = 0;
      this.explode();
    }
  }

  explode() {
    if (this.exploded) return;
    this.exploded = true;
    this.wrecked = true;
    this.ctl = noControl();
    this.model.paint.color.setHex(0x0e0d0c);
    this.model.paint.metalness = 0.2;
    this.model.paint.roughness = 0.9;
    this.vy = 6 + Math.random() * 3;
    this.onExplode?.(this);
  }

  update(dt: number, world: World, night: number) {
    const sp = this.spec;
    const ctl = this.wrecked ? noControl() : this.ctl;
    let fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let rx = -fz, rz = fx;
    let vF = this.vx * fx + this.vz * fz;
    let vL = this.vx * rx + this.vz * rz;
    const ground = world.groundY(this.x, this.z);
    this.airborne = this.y > ground + 0.35;

    const wantBoost = ctl.boost && this.nitro > 0.03 && ctl.throttle > 0 && this.isPlayer;
    this.boosting = wantBoost;
    if (wantBoost) this.nitro = Math.max(0, this.nitro - dt * 0.25);
    else this.nitro = Math.min(1, this.nitro + dt * 0.08);

    const top = sp.top * (wantBoost ? 1.28 : 1) * (this.health < 250 ? 0.7 : 1);
    const maxR = 11;
    let a = 0;
    if (!this.airborne) {
      if (ctl.throttle > 0) {
        a = ctl.throttle * 17 * sp.power * (1 - Math.max(vF, 0) / top);
        if (vF < -0.5) a += 32 * ctl.throttle * sp.brake;
        if (wantBoost) a += 14;
      } else if (ctl.throttle < 0) {
        if (vF > 0.5) a = 34 * ctl.throttle * sp.brake;
        else a = ctl.throttle * 10 * (1 - Math.max(-vF, 0) / maxR);
      }
      a -= vF * 0.12 + vF * Math.abs(vF) * 0.0016;
      if (ctl.throttle === 0) a -= clamp(vF, -1, 1) * 2.4;
      if (ctl.hand) a -= clamp(vF, -1, 1) * 18;
      vF += a * dt;
      const grip = (ctl.hand ? 1.0 : 8.5) * sp.grip * (1 - this.burning * 0.0);
      vL *= Math.exp(-grip * dt);
    }

    const maxSteer = (0.6 * sp.steer) / (1 + Math.abs(vF) / 12);
    const target = ctl.steer * maxSteer;
    this.steerAngle += (target - this.steerAngle) * (1 - Math.exp(-dt * 9));
    const wb = sp.zf - sp.zr;
    let yaw = this.airborne ? this.yawRate * 0.9 : (vF / wb) * Math.tan(this.steerAngle);
    if (ctl.hand && !this.airborne) yaw *= 1.55;
    // slight oversteer when sliding
    yaw += clamp(vL * 0.02, -0.4, 0.4) * (this.airborne ? 0 : 1) * 0;
    this.yawRate = yaw;
    this.heading -= yaw * dt;

    fx = Math.sin(this.heading); fz = Math.cos(this.heading);
    rx = -fz; rz = fx;
    this.vx = fx * vF + rx * vL;
    this.vz = fz * vF + rz * vL;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // vertical
    const g2 = world.groundY(this.x, this.z);
    if (this.y > g2 + 0.02 || this.vy > 0.1) {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      if (this.y <= g2) {
        const impact = -this.vy;
        this.y = g2;
        this.vy = impact > 8 ? impact * 0.18 : 0;
        if (impact > 6) this.onCrash?.(this, impact * 0.5, this.x, this.z);
      }
    } else {
      // follow ground (smooth, handles curbs & ramps)
      const diff = g2 - this.y;
      if (diff > 0.2) this.y = g2; // ramp start: snap
      else this.y += diff * (1 - Math.exp(-dt * 18));
      // launch off ramp lips
      const ahead = world.groundY(this.x + this.vx * dt * 2, this.z + this.vz * dt * 2);
      if (ahead < this.y - 0.35 && Math.hypot(this.vx, this.vz) > 8 && g2 > 0.5) this.vy = (g2 - ahead) * Math.hypot(this.vx, this.vz) * 0.1 + 1;
    }

    // collisions: three circles along the body
    const half = sp.L / 2 - 0.85;
    const rad = sp.W / 2 + 0.05;
    for (const off of [half, 0, -half]) {
      const cx = this.x + fx * off, cz = this.z + fz * off;
      if (world.resolve(cx, cz, rad, this.hit, this.y + 0.2) && this.hit.hit) {
        this.x += this.hit.x - cx;
        this.z += this.hit.z - cz;
        const vn = this.vx * this.hit.nx + this.vz * this.hit.nz;
        if (vn < 0) {
          const impact = -vn;
          this.vx -= 1.3 * vn * this.hit.nx;
          this.vz -= 1.3 * vn * this.hit.nz;
          this.vx *= 0.92; this.vz *= 0.92;
          const now = performance.now();
          if (impact > 2.5 && now - this.lastCrash > 250) {
            this.lastCrash = now;
            this.damage(Math.max(0, impact - 3) * 9);
            this.onCrash?.(this, impact, cx - this.hit.nx * rad, cz - this.hit.nz * rad);
          }
        }
      }
    }

    this.speed = this.vx * fx + this.vz * fz;
    this.slip = Math.abs(this.vx * rx + this.vz * rz);
    this.skid = !this.airborne && ((this.slip > 3.2 && Math.abs(this.speed) > 6) || (ctl.hand && Math.abs(this.speed) > 8) || (ctl.throttle < 0 && this.speed > 12));

    // burning
    if (this.health < 300 && !this.wrecked) this.burning = clamp((300 - this.health) / 300, 0, 1);
    if (this.burning > 0.5 && !this.wrecked) this.damage(dt * 24 * this.burning);

    this.headlights = night > 0.25;
    this.sync(dt, a, world, ctl);
    this.sirenT += dt;
  }

  /** push out of a circle (other vehicle). returns impact speed */
  bump(nx: number, nz: number, depth: number, otherVx: number, otherVz: number, ratio: number) {
    this.x += nx * depth * ratio;
    this.z += nz * depth * ratio;
    const rvx = this.vx - otherVx, rvz = this.vz - otherVz;
    const vn = rvx * nx + rvz * nz;
    if (vn < 0) {
      this.vx -= (1.35 * vn * nx) * ratio;
      this.vz -= (1.35 * vn * nz) * ratio;
      return -vn;
    }
    return 0;
  }

  private sync(dt: number, accel: number, world: World, ctl?: CarControl) {
    const g = this.model.group;
    g.position.set(this.x, this.y, this.z);
    g.rotation.y = this.heading;
    const sp = this.spec;
    // ground pitch
    const fxv = Math.sin(this.heading), fzv = Math.cos(this.heading);
    const gF = world.groundY(this.x + fxv * sp.zf, this.z + fzv * sp.zf), gR = world.groundY(this.x + fxv * sp.zr, this.z + fzv * sp.zr);
    const gp = this.airborne ? clamp(-this.vy * 0.03, -0.4, 0.4) : -Math.atan2(gF - gR, sp.zf - sp.zr);
    const k = dt > 0 ? 1 - Math.exp(-dt * 10) : 1;
    this.gpitch += (gp - this.gpitch) * k;
    g.rotation.x = this.gpitch;
    const rt = clamp(-this.steerAngle * this.speed * 0.0055, -0.08, 0.08) + clamp(this.slip * 0.004, 0, 0.05) * Math.sign(this.steerAngle || 1) * -0.5;
    const pt = clamp(-accel * 0.004, -0.06, 0.06);
    this.roll += (rt - this.roll) * (dt > 0 ? 1 - Math.exp(-dt * 8) : 1);
    this.pitch += (pt - this.pitch) * (dt > 0 ? 1 - Math.exp(-dt * 8) : 1);
    this.model.body.rotation.z = this.roll;
    this.model.body.rotation.x = this.pitch;
    const m = this.model;
    const spin = (this.speed * dt) / sp.wr;
    for (const w of m.wheels) {
      w.spin.rotation.x += spin * w.sign;
      if (w.front) w.pivot.rotation.y = -this.steerAngle;
    }
    m.steerWheel.rotation.z = this.steerAngle * 2.2;
    if (ctl) {
      const braking = (ctl.throttle < 0 && this.speed > 0.5) || ctl.hand || (ctl.throttle > 0 && this.speed < -0.5);
      m.tailMat.emissiveIntensity = damp(m.tailMat.emissiveIntensity, braking ? BRAKE_ON : this.headlights ? 1.2 : BRAKE_OFF, 30, dt);
      m.headMat.emissiveIntensity = this.headlights && !this.wrecked ? 3 : 0.15;
      m.beams.visible = this.headlights && !this.wrecked;
      if (m.siren) {
        const on = this.sirenOn && !this.wrecked;
        const ph = Math.floor(this.sirenT * 6) % 2;
        m.siren.red.emissiveIntensity = on ? (ph ? 6 : 0.3) : 0.2;
        m.siren.blue.emissiveIntensity = on ? (ph ? 0.3 : 6) : 0.2;
      }
    }
  }
}
