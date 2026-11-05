import * as THREE from 'three';
import type { Game } from './game';
import { Human, LOOKS, defaultState, randomLook, type HumanState, type Look } from './humanoid';
import { Vehicle, noControl } from './vehicle';
import { buildWeaponModel, WEAPONS, type WeaponId, type WeaponModel } from './weapons';
import { LANE, N, P, PAD, ROAD_W, blockCenter, nodePos } from './world';
import { angDiff, clamp, damp, dampAngle, mulberry32, pick } from './util';

export type NpcRole = 'ped' | 'cop' | 'swat' | 'gang' | 'story' | 'driver';
export type NpcState = 'walk' | 'idle' | 'flee' | 'cross' | 'dead' | 'attack' | 'talk' | 'cower' | 'hands';

const LOOP = PAD / 2 - 2.6;
const SIDE = LOOP * 2;

let NID = 1;
export class Npc {
  id = NID++;
  human: Human;
  role: NpcRole;
  state: NpcState = 'walk';
  x = 0; y = 0; z = 0; heading = 0;
  hp = 40; maxHp = 40;
  speed = 1.4;
  loop = { bi: 0, bj: 0, s: 0, dir: 1, off: 0 };
  weapon: WeaponId = 'fists';
  wm: WeaponModel | null = null;
  ammo = 99;
  shootT = 0; burst = 0; burstT = 0;
  stateT = 0;
  deadT = 0;
  fleeFrom = { x: 0, z: 0 };
  target = { x: 0, z: 0 };
  invulnerable = false;
  key = '';
  name = '';
  hostile = false;
  strafe = 1; strafeT = 0;
  hs: HumanState = defaultState();
  removed = false;
  vx = 0; vz = 0;
  talking = false;
  arrestT = 0;
  inCar: Vehicle | null = null;
  seenPlayer = false;
  cash = 0;
  brawler = false;
  atkT = 0; atkCd = 0.6; atkHit = false; stunT = 0; alerted = false;
  private lookT = 0;

  constructor(look: Look, role: NpcRole = 'ped') {
    this.human = new Human(look);
    this.human.root.rotation.order = 'YXZ';
    this.role = role;
    const rng = Math.random;
    this.speed = 1.2 + rng() * 0.5;
    this.strafe = rng() < 0.5 ? 1 : -1;
    if (role === 'cop') { this.hp = this.maxHp = 90; this.setWeapon('pistol'); }
    if (role === 'swat') { this.hp = this.maxHp = 220; this.setWeapon('rifle'); }
    if (role === 'gang') { this.hp = this.maxHp = 80; this.setWeapon(pick(['pistol', 'smg', 'pistol', 'shotgun'] as WeaponId[])); this.hostile = true; }
    this.human.onStep = undefined;
  }

  setWeapon(id: WeaponId) {
    this.weapon = id;
    this.wm = buildWeaponModel(id);
    this.human.setWeapon(this.wm ? this.wm.group : null);
  }

  get alive() { return this.state !== 'dead'; }
  get isMelee() { return !this.wm || this.weapon === 'bat' || this.weapon === 'fists'; }
  stagger(t: number) { this.stunT = Math.max(this.stunT, t); this.atkT = 0; this.atkCd = Math.max(this.atkCd, 0.6); }

  place(x: number, z: number, h = 0) {
    this.x = x; this.z = z; this.heading = h;
    this.human.root.position.set(x, 0, z);
  }

  attachLoop(g: Game, dirPref = 0) {
    const bi = Math.round(this.x / P + (N - 1) / 2), bj = Math.round(this.z / P + (N - 1) / 2);
    this.loop.bi = clamp(bi, 0, N - 1); this.loop.bj = clamp(bj, 0, N - 1);
    const c = blockCenter(this.loop.bi, this.loop.bj);
    const lx = this.x - c.x, lz = this.z - c.z;
    // project to nearest perimeter point
    const m = Math.max(Math.abs(lx), Math.abs(lz));
    const k = LOOP / Math.max(m, 0.1);
    const px = clamp(lx * k, -LOOP, LOOP), pz = clamp(lz * k, -LOOP, LOOP);
    let s: number;
    if (Math.abs(pz + LOOP) < 0.01 || (Math.abs(pz) >= Math.abs(px) && pz < 0)) s = px + LOOP;
    else if (Math.abs(px - LOOP) < 0.01 || (Math.abs(px) >= Math.abs(pz) && px > 0)) s = SIDE + (pz + LOOP);
    else if (pz > 0 && Math.abs(pz) >= Math.abs(px)) s = SIDE * 2 + (LOOP - px);
    else s = SIDE * 3 + (LOOP - pz);
    this.loop.s = ((s % (SIDE * 4)) + SIDE * 4) % (SIDE * 4);
    this.loop.dir = dirPref || (Math.random() < 0.5 ? 1 : -1);
    this.loop.off = (Math.random() - 0.5) * 2.4;
    this.state = 'walk';
    void g;
  }

  private loopPos(): { x: number; z: number } {
    const c = blockCenter(this.loop.bi, this.loop.bj);
    const s = ((this.loop.s % (SIDE * 4)) + SIDE * 4) % (SIDE * 4);
    const e = Math.floor(s / SIDE), t = s - e * SIDE;
    const L = LOOP + this.loop.off * 0.5;
    if (e === 0) return { x: c.x - LOOP + t, z: c.z - L };
    if (e === 1) return { x: c.x + L, z: c.z - LOOP + t };
    if (e === 2) return { x: c.x + LOOP - t, z: c.z + L };
    return { x: c.x - L, z: c.z + LOOP - t };
  }

  private moveToward(tx: number, tz: number, sp: number, dt: number, turn = 8) {
    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) this.heading = dampAngle(this.heading, Math.atan2(dx, dz), turn, dt);
    const k = d > 0.2 ? 1 : d / 0.2;
    this.vx = damp(this.vx, (dx / (d || 1)) * sp * k, 10, dt);
    this.vz = damp(this.vz, (dz / (d || 1)) * sp * k, 10, dt);
    this.x += this.vx * dt; this.z += this.vz * dt;
    return d;
  }

  scare(x: number, z: number, g: Game) {
    if (this.role !== 'ped' || this.state === 'dead') return;
    if (this.state === 'flee') return;
    this.state = Math.random() < 0.25 ? 'cower' : 'flee';
    this.stateT = 5 + Math.random() * 5;
    this.fleeFrom = { x, z };
    void g;
  }

  hurt(dmg: number, g: Game, sx: number, sz: number, head = false, byPlayer = false, impulse = 0) {
    if (this.state === 'dead' || this.invulnerable) return false;
    this.hp -= dmg * (head ? 2.6 : 1);
    this.human.flinch(Math.random() < 0.5 ? 1 : -1);
    this.fleeFrom = { x: sx, z: sz };
    if (impulse) { const d = Math.hypot(this.x - sx, this.z - sz) || 1; this.vx += ((this.x - sx) / d) * impulse; this.vz += ((this.z - sz) / d) * impulse; }
    if (this.hp <= 0) {
      this.state = 'dead';
      this.human.die();
      this.deadT = 0;
      this.human.setWeapon(null);
      g.onNpcKilled(this, byPlayer);
      return true;
    }
    if (this.role === 'ped') { this.state = 'flee'; this.stateT = 7; }
    if (this.role === 'gang' || this.role === 'cop' || this.role === 'swat') { this.state = 'attack'; this.hostile = true; }
    if (byPlayer) g.onNpcHurtByPlayer(this);
    return false;
  }

  update(dt: number, g: Game) {
    const p = g.player;
    const dx = p.x - this.x, dz = p.z - this.z;
    const dist = Math.hypot(dx, dz);
    const hs = this.hs;
    hs.vf = 0; hs.vs = 0; hs.aim = false; hs.panic = false; hs.talk = false; hs.weapon = this.wm ? WEAPONS[this.weapon].cls : 'none';
    this.stateT -= dt;
    const mv = Math.hypot(this.vx, this.vz);

    if (this.state === 'dead') {
      this.deadT += dt;
      this.vx = damp(this.vx, 0, 3, dt); this.vz = damp(this.vz, 0, 3, dt);
      this.x += this.vx * dt; this.z += this.vz * dt;
      if (this.deadT > 30) this.human.root.position.y -= dt * 0.1;
      if (this.deadT > 40) this.removed = true;
    } else if (this.state === 'hands') {
      hs.panic = true;
    } else if (this.state === 'cower') {
      hs.stance = 'crouch' as never;
      hs.stance = 'crouch';
      hs.panic = true;
      if (this.stateT < 0) { this.state = 'walk'; hs.stance = 'stand'; }
    } else if (this.state === 'flee') {
      hs.stance = 'stand';
      const ax = this.x - this.fleeFrom.x, az = this.z - this.fleeFrom.z;
      const l = Math.hypot(ax, az) || 1;
      this.moveToward(this.x + (ax / l) * 10, this.z + (az / l) * 10, 5.2, dt, 10);
      hs.vf = 5.2; hs.panic = true;
      if (this.stateT < 0) this.attachLoop(g);
    } else if (this.role === 'ped' || this.role === 'story' || this.role === 'driver') {
      hs.stance = 'stand';
      if (this.role === 'story' || this.state === 'idle') {
        if (this.talking) {
          const want = Math.atan2(dx, dz);
          this.heading = dampAngle(this.heading, want, 5, dt);
          hs.talk = true;
        } else if (this.role === 'story' && dist < 14) {
          this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 2, dt);
        }
        this.vx = damp(this.vx, 0, 6, dt); this.vz = damp(this.vz, 0, 6, dt);
      } else if (this.state === 'cross') {
        const d = this.moveToward(this.target.x, this.target.z, this.speed * 1.25, dt);
        hs.vf = this.speed * 1.25;
        if (d < 0.8) this.attachLoop(g);
      } else {
        // walk the sidewalk loop
        const lp = this.loopPos();
        const ahead = this.loop.s + this.loop.dir * 1.5;
        void ahead;
        this.loop.s += this.loop.dir * this.speed * dt;
        const np = this.loopPos();
        void lp;
        const d = this.moveToward(np.x, np.z, this.speed * 1.0, dt, 6);
        void d;
        hs.vf = Math.hypot(this.vx, this.vz);
        // occasionally cross the street at a corner
        const t = ((this.loop.s % SIDE) + SIDE) % SIDE;
        if ((t < 0.8 || t > SIDE - 0.8) && Math.random() < dt * 0.5 && this.role === 'ped') {
          const e = Math.floor((((this.loop.s % (SIDE * 4)) + SIDE * 4) % (SIDE * 4)) / SIDE);
          const out = [[0, -1], [1, 0], [0, 1], [-1, 0]][e];
          this.target = { x: this.x + out[0] * (ROAD_W + 5.2), z: this.z + out[1] * (ROAD_W + 5.2) };
          this.state = 'cross';
        }
        if (Math.random() < dt * 0.01) { this.state = 'idle'; this.stateT = 4 + Math.random() * 6; }
      }
      if (this.state === 'idle' && this.role === 'ped' && this.stateT < 0) this.attachLoop(g);
    } else {
      this.combat(dt, g, dist, dx, dz);
    }

    // props / walls
    if (this.state !== 'dead') {
      const h = g.tmpHit;
      if (g.world.resolve(this.x, this.z, 0.32, h, this.y) && h.hit) { this.x = h.x; this.z = h.z; }
    } else {
      const h = g.tmpHit;
      if (g.world.resolve(this.x, this.z, 0.3, h, 0) && h.hit) { this.x = h.x; this.z = h.z; }
    }
    const gy = g.world.groundY(this.x, this.z);
    this.y = damp(this.y, gy, 16, dt);
    // look at player when near
    this.lookT -= dt;
    if (dist < 8 && this.state !== 'dead') {
      const rel = angDiff(this.heading, Math.atan2(dx, dz));
      hs.lookX = clamp(rel, -0.9, 0.9);
      hs.lookY = 0;
    } else { hs.lookX = 0; }
    const root = this.human.root;
    root.position.set(this.x, this.y, this.z);
    root.rotation.y = this.heading;
    void mv;
    this.human.update(dt, hs);
    if (this.wm) this.wm.flash.material instanceof THREE.MeshBasicMaterial && (this.wm.flash.material.opacity = Math.max(0, this.wm.flash.material.opacity - dt * 20));
  }

  private combat(dt: number, g: Game, dist: number, dx: number, dz: number) {
    const hs = this.hs;
    hs.stance = 'stand';
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.vx = damp(this.vx, 0, 4, dt); this.vz = damp(this.vz, 0, 4, dt);
      this.x += this.vx * dt; this.z += this.vz * dt;
      hs.vf = 0; hs.aim = false;
      return;
    }
    const w = WEAPONS[this.weapon];
    const wantedCop = (this.role === 'cop' || this.role === 'swat') && g.wanted > 0;
    const engage = (this.role === 'gang' && this.hostile) || wantedCop || this.state === 'attack';
    const eyeY = this.y + 1.5;
    if (!engage) {
      // patrol like a ped
      this.role === 'cop' && this.moveToward(this.x, this.z, 0, dt);
      this.loop.s += this.loop.dir * 1.2 * dt;
      const np = this.loopPos();
      if (this.role === 'cop' && g.wanted === 0) { this.moveToward(np.x, np.z, 1.2, dt, 6); hs.vf = 1.2; }
      return;
    }
    // perceive
    let sees = false;
    if (dist < 90) {
      const d = Math.hypot(dx, dz) || 1;
      const t = g.world.rayBoxes(this.x, eyeY, this.z, dx / d, (g.player.y + 1.4 - eyeY) / d, dz / d, d);
      sees = t >= d - 0.5;
    }
    this.seenPlayer = sees;
    const want = Math.atan2(dx, dz);
    if (this.isMelee && this.role === 'gang') { this.meleeAI(dt, g, dist, dx, dz, sees); return; }
    const pref = this.role === 'cop' ? 13 : this.role === 'swat' ? 16 : 17;
    const run = 4.6;
    if (dist > 110 && this.role === 'gang') { hs.vf = 0; return; }
    this.strafeT -= dt;
    if (this.strafeT < 0) { this.strafe = -this.strafe; this.strafeT = 1 + Math.random() * 2.5; }
    if (!sees || dist > pref + 6) {
      // advance (via road/sidewalk, buildings block so jitter a bit)
      this.heading = dampAngle(this.heading, want + (sees ? 0 : this.strafe * 0.7), 6, dt);
      this.vx = damp(this.vx, Math.sin(this.heading) * run, 6, dt);
      this.vz = damp(this.vz, Math.cos(this.heading) * run, 6, dt);
      this.x += this.vx * dt; this.z += this.vz * dt;
      hs.vf = run;
    } else if (dist < pref - 4) {
      this.heading = dampAngle(this.heading, want, 8, dt);
      this.vx = damp(this.vx, -Math.sin(want) * 2.2, 6, dt);
      this.vz = damp(this.vz, -Math.cos(want) * 2.2, 6, dt);
      this.x += this.vx * dt; this.z += this.vz * dt;
      hs.vf = -2.2;
    } else {
      this.heading = dampAngle(this.heading, want, 10, dt);
      const sx = Math.cos(want) * this.strafe * 1.6, sz = -Math.sin(want) * this.strafe * 1.6;
      this.vx = damp(this.vx, sx, 6, dt); this.vz = damp(this.vz, sz, 6, dt);
      this.x += this.vx * dt; this.z += this.vz * dt;
      hs.vs = this.strafe * 1.6 * -1;
    }
    if (this.wm && sees && dist < w.range * 0.8) {
      hs.aim = true;
      hs.aimPitch = clamp(Math.atan2(eyeY - (g.player.y + 1.2), dist), -0.4, 0.4);
      this.shootT -= dt;
      this.burstT -= dt;
      if (this.shootT <= 0 && this.burstT <= 0) {
        if (this.burst <= 0) this.burst = this.weapon === 'smg' || this.weapon === 'rifle' ? 3 + Math.floor(Math.random() * 4) : 1;
        this.shootT = 1 / Math.min(w.rate, 6);
        this.burst--;
        if (this.burst <= 0) this.burstT = 0.7 + Math.random() * 1.3;
        g.npcShoot(this, w);
      }
    }
  }

  /** brawler AI: rush the player, telegraph, then swing. Dodge (Q) or block (RMB) the swing! */
  private meleeAI(dt: number, g: Game, dist: number, dx: number, dz: number, sees: boolean) {
    const hs = this.hs;
    const want = Math.atan2(dx, dz);
    this.atkCd -= dt;
    if (this.atkT > 0) {
      this.atkT += dt;
      this.heading = dampAngle(this.heading, want, 4, dt);
      this.vx = damp(this.vx, 0, 10, dt); this.vz = damp(this.vz, 0, 10, dt);
      if (this.atkT > 0.28 && !this.alerted) { this.alerted = true; this.human.punch(); }
      if (this.atkT > 0.46 && !this.atkHit) {
        this.atkHit = true;
        const reach = this.weapon === 'bat' ? 2.5 : 2.1;
        if (dist < reach) g.npcMeleeHit(this, this.weapon === 'bat' ? 15 : 9);
      }
      if (this.atkT > 0.85) { this.atkT = 0; this.atkCd = 0.6 + Math.random() * 1.1; }
      return;
    }
    const run = 4.9;
    if (dist > 1.8 || (!sees && dist > 2.2)) {
      this.heading = dampAngle(this.heading, want + (sees ? 0 : this.strafe * 0.6), 8, dt);
      this.vx = damp(this.vx, Math.sin(this.heading) * run, 7, dt);
      this.vz = damp(this.vz, Math.cos(this.heading) * run, 7, dt);
      this.x += this.vx * dt; this.z += this.vz * dt;
      hs.vf = run;
    } else {
      this.heading = dampAngle(this.heading, want, 10, dt);
      const sx = Math.cos(want) * this.strafe * 1.1, sz = -Math.sin(want) * this.strafe * 1.1;
      this.vx = damp(this.vx, sx, 6, dt); this.vz = damp(this.vz, sz, 6, dt);
      this.x += this.vx * dt; this.z += this.vz * dt;
      hs.vs = -this.strafe * 1.1;
      if (this.atkCd <= 0) {
        this.atkT = 0.001; this.atkHit = false; this.alerted = false;
        g.floaterAt(this.x, this.y + 2.1 * this.human.height, this.z, '!', 'warn');
      }
    }
  }

  dispose(scene: THREE.Scene) { scene.remove(this.human.root); }
}

// ---------------------------------------------------------------- pedestrians
export class Crowd {
  list: Npc[] = [];
  looks: Look[] = [];
  max = 34;
  private rng = mulberry32(777);
  private t = 0;
  constructor(private g: Game) {
    for (let i = 0; i < 12; i++) this.looks.push(randomLook(this.rng, i % 2 === 0));
  }
  spawnOne() {
    const g = this.g;
    const a = Math.random() * Math.PI * 2, r = 45 + Math.random() * 95;
    const x = g.player.x + Math.cos(a) * r, z = g.player.z + Math.sin(a) * r;
    const bi = Math.round(x / P + (N - 1) / 2), bj = Math.round(z / P + (N - 1) / 2);
    if (bi < 0 || bj < 0 || bi >= N - 1 || bj >= N) return;
    const zone = g.world.zones[bi][bj];
    if (zone === 'industrial') return;
    const npc = new Npc(pick(this.looks), 'ped');
    const c = blockCenter(bi, bj);
    npc.place(c.x, c.z, 0);
    npc.loop.bi = bi; npc.loop.bj = bj; npc.loop.s = Math.random() * SIDE * 4; npc.loop.dir = Math.random() < 0.5 ? 1 : -1; npc.loop.off = (Math.random() - 0.5) * 2.4;
    // position from loop
    npc.attachLoop(g);
    npc.loop.bi = bi; npc.loop.bj = bj; npc.loop.s = Math.random() * SIDE * 4;
    const lp = (npc as unknown as { loopPos(): { x: number; z: number } }).loopPos();
    npc.place(lp.x, lp.z, Math.random() * 6);
    npc.y = 0.16;
    npc.cash = Math.random() < 0.5 ? Math.floor(5 + Math.random() * 60) : 0;
    g.scene.add(npc.human.root);
    this.list.push(npc);
  }
  update(dt: number) {
    const g = this.g;
    this.t += dt;
    if (this.t > 0.4 && this.list.filter((n) => n.alive).length < this.max) { this.t = 0; this.spawnOne(); }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const n = this.list[i];
      const d = Math.hypot(n.x - g.player.x, n.z - g.player.z);
      if (n.role === 'story' && !n.removed) { if (n.human.root.visible && d < 150) n.update(dt, g); continue; }
      if (n.removed || (d > 190 && n.state !== 'dead')) { g.scene.remove(n.human.root); this.list.splice(i, 1); continue; }
      if (d > 140) { n.human.root.visible = false; if (n.state === 'walk') { n.loop.s += n.loop.dir * n.speed * dt; } continue; }
      n.human.root.visible = true;
      n.update(dt, g);
    }
  }
  scareAround(x: number, z: number, r: number) {
    for (const n of this.list) if (n.alive && Math.hypot(n.x - x, n.z - z) < r) n.scare(x, z, this.g);
  }
}

// ---------------------------------------------------------------- vehicle AI
interface DriveAI {
  pi: number; pj: number; ni: number; nj: number; lane: number; vmax: number;
  stuck: number; reverse: number; honkT: number; pursuit: boolean; panic: number; route: { i: number; j: number }[]; routeT: number; rIdx: number;
  exitT: number; waitT: number; mission?: boolean;
}

export function dirOfEdge(a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

export function driveToward(v: Vehicle, tx: number, tz: number, vt: number, dt: number) {
  const dx = tx - v.x, dz = tz - v.z;
  const want = Math.atan2(dx, dz);
  const d = angDiff(v.heading, want);
  const c = v.ctl;
  c.steer = clamp(-d * 1.9, -1, 1);
  const err = vt - v.speed;
  if (vt < 0.3 && v.speed > 0.5) c.throttle = -clamp(v.speed * 0.4, 0.2, 1);
  else c.throttle = clamp(err * 0.45, -1, 1);
  if (Math.abs(d) > 1.1 && v.speed > 9) c.throttle = Math.min(c.throttle, -0.2);
  c.hand = false;
  void dt;
}

export class Traffic {
  list: Vehicle[] = [];
  max = 22;
  private t = 0;
  private colors = [0xcfcfd2, 0x1c1d20, 0x8a1c1c, 0x1a3a6a, 0xd8d0c0, 0x2a5a3a, 0x6a6a70, 0xb8741c, 0x4a1a5a, 0xe8e8e8];
  constructor(private g: Game) {}

  make(pos?: { x: number; z: number; h: number }, kind?: string, pursuit = false) {
    const g = this.g;
    const s = pos ?? g.world.randomRoadSpawn();
    const kinds = ['sedan', 'sedan', 'sedan', 'suv', 'pickup', 'van', 'taxi', 'muscle', 'sports', 'sedan', 'suv'] as const;
    let k = (kind ?? pick([...kinds])) as Vehicle['kind'];
    if (!kind && Math.random() < 0.05) k = 'police';
    const v = new Vehicle(k, k === 'police' ? 0x0b0c10 : k === 'taxi' ? 0xf4c820 : pick(this.colors));
    v.role = k === 'police' ? 'police' : 'traffic';
    v.place(s.x, s.z, s.h, g.world);
    // lane bookkeeping
    const horiz = Math.abs(Math.sin(s.h)) > 0.5;
    const ni = horiz ? Math.round(s.x / P + N / 2 + Math.sign(Math.sin(s.h)) * 0.5) : Math.round(s.x / P + N / 2);
    const nj = horiz ? Math.round(s.z / P + N / 2) : Math.round(s.z / P + N / 2 + Math.sign(Math.cos(s.h)) * 0.5);
    const f = { x: Math.sin(s.h), z: Math.cos(s.h) };
    const ai: DriveAI = {
      pi: ni - Math.round(f.x), pj: nj - Math.round(f.z), ni: clamp(ni, 0, N), nj: clamp(nj, 0, N), lane: Math.random() < 0.6 ? 0 : 1,
      vmax: 9 + Math.random() * 6, stuck: 0, reverse: 0, honkT: 0, pursuit, panic: 0, route: [], routeT: 0, rIdx: 0, exitT: 0, waitT: 0,
    };
    v.ai = ai;
    v.onCrash = (veh, imp, x, z) => g.onVehicleCrash(veh, imp, x, z);
    v.onExplode = (veh) => g.onVehicleExplode(veh);
    g.scene.add(v.group);
    g.vehicles.push(v);
    this.list.push(v);
    return v;
  }

  update(dt: number) {
    const g = this.g;
    this.t += dt;
    const active = this.list.filter((v) => !v.wrecked && v.role !== 'player').length;
    if (this.t > 0.6 && active < this.max) {
      this.t = 0;
      for (let tries = 0; tries < 6; tries++) {
        const s = g.world.randomRoadSpawn();
        const d = Math.hypot(s.x - g.player.x, s.z - g.player.z);
        if (d < 80 || d > 220) continue;
        if (g.vehicles.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 14)) continue;
        this.make(s);
        break;
      }
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i];
      const d = Math.hypot(v.x - g.player.x, v.z - g.player.z);
      if (v.driver === g.playerHuman || v.isPlayer) { this.list.splice(i, 1); continue; }
      const far = d > 320 || (v.wrecked && v.burning > 0 && d > 90 && Math.random() < 0.002);
      if (far && !(v.ai as DriveAI)?.mission) { this.remove(v); continue; }
      if (v.wrecked) { v.update(dt, g.world, g.sky.night); continue; }
      if (d < 260) this.think(v, dt);
      v.update(dt, g.world, g.sky.night);
      v.group.visible = d < 280;
    }
  }

  remove(v: Vehicle) {
    this.g.scene.remove(v.group);
    const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1);
    const j = this.g.vehicles.indexOf(v); if (j >= 0) this.g.vehicles.splice(j, 1);
  }

  private think(v: Vehicle, dt: number) {
    const g = this.g;
    const ai = v.ai as DriveAI;
    if (!ai) return;
    if (ai.pursuit && v.role === 'police' && g.wanted > 0) return this.pursue(v, ai, dt);
    v.sirenOn = false;
    ai.panic = Math.max(0, ai.panic - dt);
    const a = nodePos(ai.pi, ai.pj), b = nodePos(ai.ni, ai.nj);
    const f = dirOfEdge(a, b);
    if (a.x === b.x && a.z === b.z) { this.nextEdge(ai); return; }
    const right = { x: -f.z, z: f.x };
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const s = (v.x - a.x) * f.x + (v.z - a.z) * f.z;
    // check alignment: if car drifted far from its edge, snap onto nearest edge heading
    if (s > len - 11) {
      this.nextEdge(ai);
      return;
    }
    const off = LANE[ai.lane];
    const look = 9 + Math.abs(v.speed) * 0.35;
    const tx = a.x + f.x * (s + look) + right.x * off, tz = a.z + f.z * (s + look) + right.z * off;
    let vt = ai.vmax * (ai.panic > 0 ? 1.8 : 1);
    // traffic light
    const axis = Math.abs(f.x) > 0.5 ? 1 : 0;
    const stopS = len - ROAD_W / 2 - 3;
    const sig = g.world.signalState(ai.ni, ai.nj, axis, g.time);
    if (sig !== 0 && s < stopS + 1 && s > stopS - 40 && ai.panic <= 0) vt = Math.min(vt, Math.max(0, (stopS - s) * 0.7));
    // obstacles ahead
    vt = Math.min(vt, this.obstacle(v, f.x, f.z));
    if (v.speed < 0.4 && vt > 1.5) ai.stuck += dt; else ai.stuck = 0;
    if (ai.stuck > 8) { ai.reverse = 1.2; ai.stuck = 0; }
    if (ai.reverse > 0) {
      ai.reverse -= dt;
      v.ctl.throttle = -0.8; v.ctl.steer = 0.5; v.ctl.hand = false;
      return;
    }
    driveToward(v, tx, tz, vt, dt);
    // lateral correction toward lane line
    ai.honkT -= dt;
    v.horn = ai.honkT > 0;
    if (vt < 1 && v.speed < 1 && g.playerNear(v, 9) && Math.random() < dt * 0.15) ai.honkT = 0.6;
  }

  private obstacle(v: Vehicle, fx: number, fz: number) {
    const g = this.g;
    let vt = 99;
    const check = (ox: number, oz: number, r: number, speed: number) => {
      const rx = ox - v.x, rz = oz - v.z;
      const fwd = rx * fx + rz * fz, lat = rx * -fz + rz * fx;
      if (fwd > 0 && fwd < 16 + v.speed * 0.6 && Math.abs(lat) < 2.2 + r) vt = Math.min(vt, Math.max(0, (fwd - 5.5 - r) * 0.9) + Math.max(0, speed) * 0.5);
    };
    for (const o of g.vehicles) {
      if (o === v || o.wrecked) continue;
      if (Math.abs(o.x - v.x) > 30 || Math.abs(o.z - v.z) > 30) continue;
      check(o.x, o.z, 1.0, o.speed);
    }
    if (!g.player.vehicle) check(g.player.x, g.player.z, 0.3, 0);
    for (const n of g.crowd.list) {
      if (!n.alive || Math.abs(n.x - v.x) > 22 || Math.abs(n.z - v.z) > 22) continue;
      check(n.x, n.z, 0.4, 0);
    }
    return vt;
  }

  private nextEdge(ai: DriveAI) {
    const opts: [number, number][] = [];
    const f = { x: Math.sign(ai.ni - ai.pi), z: Math.sign(ai.nj - ai.pj) };
    const cand: [number, number][] = [[f.x, f.z], [f.z, -f.x], [-f.z, f.x]]; // straight, right?, left?
    const weights = [0.55, 0.22, 0.23];
    for (const [dx, dz] of cand) {
      const ni = ai.ni + dx, nj = ai.nj + dz;
      if (ni < 0 || nj < 0 || ni > N || nj > N) continue;
      opts.push([ni, nj]);
    }
    let pickI = 0;
    if (opts.length > 1) {
      const r = Math.random();
      pickI = r < weights[0] ? 0 : r < weights[0] + weights[1] ? 1 : 2;
      pickI = Math.min(pickI, opts.length - 1);
    }
    let nx: [number, number];
    if (!opts.length) nx = [ai.pi, ai.pj];
    else nx = opts[pickI];
    ai.pi = ai.ni; ai.pj = ai.nj; ai.ni = nx[0]; ai.nj = nx[1];
    // lane choice: right turns from outer lane ok; just randomise
    if (Math.random() < 0.3) ai.lane = Math.random() < 0.5 ? 0 : 1;
  }

  private pursue(v: Vehicle, ai: DriveAI, dt: number) {
    const g = this.g;
    v.sirenOn = true;
    const px = g.player.vehicle ? g.player.vehicle.x : g.player.x, pz = g.player.vehicle ? g.player.vehicle.z : g.player.z;
    const pvx = g.player.vehicle ? g.player.vehicle.vx : 0, pvz = g.player.vehicle ? g.player.vehicle.vz : 0;
    const d = Math.hypot(px - v.x, pz - v.z);
    ai.routeT -= dt;
    let tx = px + pvx * 0.6, tz = pz + pvz * 0.6;
    const dirx = (px - v.x) / (d || 1), dirz = (pz - v.z) / (d || 1);
    const clear = g.world.rayBoxes(v.x, 1, v.z, dirx, 0, dirz, d) >= d - 1;
    if (!(d < 70 && clear)) {
      if (ai.routeT <= 0) {
        ai.route = g.world.route(v.x, v.z, px, pz);
        ai.rIdx = 0;
        ai.routeT = 1.4;
      }
      // advance along route
      while (ai.rIdx < ai.route.length - 1) {
        const np = nodePos(ai.route[ai.rIdx].i, ai.route[ai.rIdx].j);
        const dn = Math.hypot(np.x - v.x, np.z - v.z);
        const fwdDot = (np.x - v.x) * Math.sin(v.heading) + (np.z - v.z) * Math.cos(v.heading);
        if (dn < 20 || (fwdDot < 0 && dn < 40)) ai.rIdx++; else break;
      }
      const nn = ai.route[Math.min(ai.rIdx, ai.route.length - 1)];
      if (nn) { const np = nodePos(nn.i, nn.j); tx = np.x; tz = np.z; }
    }
    let vt = Math.min(v.spec.top * 0.88, 14 + d * 0.5);
    if (d < 25) vt = Math.max(vt, 18);
    // slow near corners
    const turn = Math.abs(angDiff(v.heading, Math.atan2(tx - v.x, tz - v.z)));
    if (turn > 0.7) vt = Math.min(vt, 12);
    vt = Math.min(vt, this.obstacle(v, Math.sin(v.heading), Math.cos(v.heading)) + 6);
    // on foot player nearby: stop and deploy officers
    if (!g.player.vehicle && d < 15 && v.speed < 12) {
      v.ctl.throttle = -1; v.ctl.steer = 0; v.ctl.hand = true;
      ai.exitT += dt;
      if (ai.exitT > 0.8 && v.speed < 2) { ai.exitT = -999; g.police.deployOfficers(v); }
      return;
    }
    if (v.speed < 0.8) ai.stuck += dt; else ai.stuck = 0;
    if (ai.stuck > 2.2) { ai.reverse = 1.1; ai.stuck = 0; }
    if (ai.reverse > 0) { ai.reverse -= dt; v.ctl.throttle = -0.9; v.ctl.steer = -Math.sign(angDiff(v.heading, Math.atan2(tx - v.x, tz - v.z))) * -0.8; return; }
    driveToward(v, tx, tz, vt, dt);
    v.ctl.hand = false;
  }
}

// ---------------------------------------------------------------- helicopter
export class Heli {
  group = new THREE.Group();
  rotor: THREE.Mesh;
  tail: THREE.Mesh;
  beam: THREE.Mesh;
  x = 0; y = 60; z = 0; vx = 0; vz = 0; ang = Math.random() * 6;
  active = false;
  constructor() {
    const body = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.35, metalness: 0.7 });
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), body);
    hull.scale.set(1, 0.9, 1.9);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.7 }));
    glass.position.set(0, 0.2, 0.9);
    glass.scale.set(1, 0.8, 1.2);
    this.tail = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 4.8, 8), body);
    this.tail.rotation.x = Math.PI / 2;
    this.tail.position.set(0, 0.3, -4.2);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.8), body);
    fin.position.set(0, 0.9, -6.4);
    this.rotor = new THREE.Mesh(new THREE.BoxGeometry(11, 0.04, 0.3), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.5 }));
    this.rotor.position.set(0, 1.7, 0);
    const rotor2 = this.rotor.clone();
    rotor2.rotation.y = Math.PI / 2;
    this.rotor.add(rotor2);
    const skid = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.08), body);
    skid.position.set(0, -1.4, 0.3);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(7, 1, 20, 1, true), lightMat);
    this.beam.geometry.translate(0, -0.5, 0);
    this.group.add(hull, glass, this.tail, fin, this.rotor, skid, this.beam);
    this.group.visible = false;
  }
  update(dt: number, g: Game) {
    this.group.visible = this.active;
    if (!this.active) return;
    const p = g.player;
    const tx = p.vehicle ? p.vehicle.x + p.vehicle.vx * 1.5 : p.x, tz = p.vehicle ? p.vehicle.z + p.vehicle.vz * 1.5 : p.z;
    this.ang += dt * 0.35;
    const gx = tx + Math.cos(this.ang) * 26, gz = tz + Math.sin(this.ang) * 26;
    this.vx = damp(this.vx, (gx - this.x) * 0.7, 1.4, dt);
    this.vz = damp(this.vz, (gz - this.z) * 0.7, 1.4, dt);
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.y = damp(this.y, 48, 1, dt);
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = Math.atan2(this.vx, this.vz);
    this.group.rotation.z = clamp(-this.vx * 0.01, -0.2, 0.2);
    this.rotor.rotation.y += dt * 40;
    const dx = tx - this.x, dy = 0.5 - this.y, dz = tz - this.z;
    const l = Math.hypot(dx, dy, dz);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    this.beam.position.set(0, -1, 0.5);
    this.beam.scale.set(1, l, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    this.beam.quaternion.copy(this.group.quaternion).invert().multiply(q);
    this.beam.visible = g.sky.night > 0.1 || true;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.05 + g.sky.night * 0.16;
  }
}

// ---------------------------------------------------------------- police
export class Police {
  cars: Vehicle[] = [];
  foot: Npc[] = [];
  heli = new Heli();
  private spawnT = 0;
  private seenT = 0;
  private busted = 0;
  private swatT = 0;
  private losT = 0;
  constructor(private g: Game) {
    g.scene.add(this.heli.group);
  }
  get unseenFor() { return this.seenT; }
  get arrestProgress() { return this.busted; }

  update(dt: number) {
    const g = this.g;
    const L = g.wanted;
    this.cars = this.cars.filter((c) => !c.wrecked && g.vehicles.includes(c));
    this.foot = this.foot.filter((n) => !n.removed);
    // line of sight check (throttled)
    this.losT -= dt;
    if (L > 0 && this.losT <= 0) {
      this.losT = 0.4;
      let seen = false;
      const px = g.player.x, pz = g.player.z, py = g.player.y + 1.4;
      const test = (x: number, y: number, z: number, maxD: number) => {
        const dx = px - x, dy = py - y, dz = pz - z;
        const d = Math.hypot(dx, dy, dz);
        if (d > maxD) return false;
        return g.world.rayBoxes(x, y, z, dx / d, dy / d, dz / d, d) >= d - 0.5;
      };
      for (const c of this.cars) if (test(c.x, 1.4, c.z, 130)) { seen = true; break; }
      if (!seen) for (const n of this.foot) if (n.alive && test(n.x, n.y + 1.5, n.z, 100)) { seen = true; break; }
      if (!seen && this.heli.active && test(this.heli.x, this.heli.y, this.heli.z, 120)) seen = true;
      if (!seen) for (const n of g.crowd.list) if ((n.role === 'cop') && n.alive && test(n.x, n.y + 1.5, n.z, 80)) { seen = true; break; }
      if (seen) this.seenT = 0; else this.seenT += 0.4;
    }
    if (L === 0) { this.seenT = 0; this.cleanup(dt); this.heli.active = false; this.heli.update(dt, g); return; }
    // evasion
    const need = 14 + L * 2;
    if (this.seenT > need) {
      g.setWanted(L - 1, true);
      this.seenT = 0;
    }
    g.hud.evading = this.seenT > 3;
    // spawn pursuit cars
    const target = [0, 2, 3, 5, 6, 8][L];
    this.spawnT -= dt;
    if (this.cars.length < target && this.spawnT <= 0) {
      this.spawnT = 2.2;
      for (let tries = 0; tries < 8; tries++) {
        const s = g.world.randomRoadSpawn();
        const d = Math.hypot(s.x - g.player.x, s.z - g.player.z);
        if (d < 110 || d > 230) continue;
        if (g.vehicles.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 12)) continue;
        const swat = L >= 4 && Math.random() < 0.3 && !this.cars.some((c) => c.kind === 'swat');
        const v = g.traffic.make(s, swat ? 'swat' : 'police', true);
        v.sirenOn = true; v.role = swat ? 'swat' : 'police';
        if (swat) v.setColor(0x15171a);
        this.cars.push(v);
        break;
      }
    }
    // cars too far get teleported ahead
    for (const c of this.cars) {
      const d = Math.hypot(c.x - g.player.x, c.z - g.player.z);
      if (d > 360) { g.traffic.remove(c); }
    }
    this.heli.active = L >= 3;
    this.heli.update(dt, g);
    // arrest logic
    const p = g.player;
    let near = false;
    for (const n of this.foot) if (n.alive && Math.hypot(n.x - p.x, n.z - p.z) < 1.9) near = true;
    if (near && L <= 2 && !p.vehicle) this.busted += dt; else this.busted = Math.max(0, this.busted - dt * 0.6);
    if (this.busted > 1.6) { this.busted = 0; g.busted(); }
    // cops near stopped player in vehicle
    if (p.vehicle && Math.abs(p.vehicle.speed) < 2) {
      for (const n of this.foot) if (n.alive && Math.hypot(n.x - p.x, n.z - p.z) < 3.2) near = true;
      if (near && L <= 2) { this.busted += dt * 0.8; if (this.busted > 2.2) { this.busted = 0; g.busted(); } }
    }
  }

  cleanup(dt: number) {
    const g = this.g;
    for (const c of this.cars) {
      const ai = c.ai as DriveAI;
      c.sirenOn = false;
      if (ai) ai.pursuit = false;
      c.role = 'police';
    }
    this.cars = [];
    for (const n of this.foot) {
      if (n.role === 'cop' || n.role === 'swat') {
        n.hostile = false; n.state = 'walk';
        const d = Math.hypot(n.x - g.player.x, n.z - g.player.z);
        if (d > 90) n.removed = true;
      }
    }
    void dt;
  }

  deployOfficers(car: Vehicle) {
    const g = this.g;
    const swat = car.kind === 'swat';
    const count = swat ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const n = new Npc(swat ? LOOKS.swat : LOOKS.cop, swat ? 'swat' : 'cop');
      n.hostile = true; n.state = 'attack';
      const side = i % 2 ? 1 : -1;
      const f = car.fwd();
      n.place(car.x + (-f.z) * side * 2.4 - f.x * i * 0.6, car.z + f.x * side * 2.4 - f.z * i * 0.6, car.heading);
      n.y = car.y;
      g.scene.add(n.human.root);
      g.crowd.list.push(n);
      this.foot.push(n);
    }
    car.sirenOn = true;
    const ai = car.ai as DriveAI;
    if (ai) ai.pursuit = false;
    car.ctl = noControl();
    g.audio.door();
  }
}
