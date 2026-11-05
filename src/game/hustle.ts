import * as THREE from 'three';
import type { Game, Marker } from './game';
import type { Npc } from './ai';
import { LOOKS } from './humanoid';
import { nodePos, N } from './world';
import { hud, emitHud } from './store';
import { clamp, fmtMoney } from './util';

/**
 * THE HOOK.
 *  - Style meter: chain punches, headshots, dodges, parries, drifts. The meter banks cash when the chain ends — get hit and you lose half.
 *  - Street Rep: XP, levels and real perks (damage resist, faster reload, melee power, heal-on-kill ...).
 *  - Rotating challenges so there is always a "just one more" goal.
 *  - Live street events: ambushes, stash houses and street races pop up on your map every minute or so.
 */

type ChalType = 'kills' | 'headshots' | 'melee' | 'finishers' | 'dodges' | 'parries' | 'drift' | 'events' | 'cash' | 'rankS';
interface Chal { id: number; type: ChalType; text: string; goal: number; prog: number; cash: number; xp: number; done: boolean }

const POOL: { type: ChalType; text: (n: number) => string; goals: number[]; cash: number }[] = [
  { type: 'kills', text: (n) => `Take down ${n} gang members`, goals: [6, 10, 15], cash: 90 },
  { type: 'headshots', text: (n) => `Land ${n} headshots`, goals: [3, 5, 8], cash: 140 },
  { type: 'melee', text: (n) => `Knock out ${n} thugs in melee`, goals: [3, 5, 7], cash: 160 },
  { type: 'finishers', text: (n) => `Land ${n} combo finishers`, goals: [3, 5, 8], cash: 110 },
  { type: 'dodges', text: (n) => `Perfect-dodge ${n} attacks [Q]`, goals: [3, 5], cash: 200 },
  { type: 'parries', text: (n) => `Parry ${n} melee attacks (block just in time)`, goals: [2, 4], cash: 240 },
  { type: 'drift', text: (n) => `Drift ${n} metres in a car`, goals: [300, 600, 900], cash: 1.2 },
  { type: 'events', text: (n) => `Complete ${n} street event${n > 1 ? 's' : ''}`, goals: [1, 2], cash: 700 },
  { type: 'cash', text: (n) => `Earn ${fmtMoney(n)}`, goals: [1500, 3000], cash: 0.25 },
  { type: 'rankS', text: () => 'Reach S-rank style', goals: [1], cash: 900 },
];

const PERKS: Record<number, string> = {
  2: 'THICK SKIN — take 10% less damage',
  3: 'QUICK HANDS — reload 30% faster',
  4: 'BRAWLER — melee hits 35% harder',
  5: 'ADRENALINE — every kill heals 8 HP',
  6: 'GUNSLINGER — guns hit 15% harder',
  7: 'IRON WILL — take 20% less damage',
  8: 'STREET LEGEND — style banks 50% more cash',
};

const RANKS = ['D', 'C', 'B', 'A', 'S'];
const MULTS = [1, 1.25, 1.5, 2, 3];

interface EventState {
  kind: 'ambush' | 'stash' | 'race';
  title: string; text: string;
  t: number; // seconds left (0 = untimed)
  npcs: Npc[]; x: number; z: number;
  cps?: { x: number; z: number }[]; cpIdx?: number;
  caseMesh?: THREE.Mesh; caseAmt?: number; took?: boolean;
  total: number;
}

export class Hustle {
  xp = 0; level = 1;
  meter = 0; bank = 0; chainT = 0; mult = 1; rank = 0; bestRank = 0;
  lastLabel = ''; labelId = 0;
  chals: Chal[] = [];
  event: EventState | null = null;
  markers: Marker[] = [];
  beams: THREE.Mesh[] = [];
  private nextEvent = 22;
  private cid = 1;
  private beamMat = new THREE.MeshBasicMaterial({ color: 0xff3a5a, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private noticeT = 0;

  constructor(private g: Game) {
    while (this.chals.length < 3) this.newChallenge();
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 70, 24, 1, true), this.beamMat.clone());
      m.geometry.translate(0, 35, 0);
      m.visible = false; g.scene.add(m); this.beams.push(m);
    }
  }

  // ------------------------------------------------------------------ perks
  get dmgTaken() { return (this.level >= 7 ? 0.8 : this.level >= 2 ? 0.9 : 1); }
  get reloadMul() { return this.level >= 3 ? 0.7 : 1; }
  get meleeMul() { return this.level >= 4 ? 1.35 : 1; }
  get gunMul() { return this.level >= 6 ? 1.15 : 1; }
  get healOnKill() { return this.level >= 5 ? 8 : 0; }
  get bankMul() { return this.level >= 8 ? 1.5 : 1; }
  get xpNeed() { return 140 + this.level * 110; }

  // ------------------------------------------------------------------ xp
  gainXp(n: number) {
    this.xp += Math.round(n);
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      const bonus = 400 * this.level;
      this.g.addCashQuiet(bonus);
      this.g.audio.wanted();
      this.g.toast(`STREET REP ${this.level}`, (PERKS[this.level] ? PERKS[this.level] + ' · ' : '') + `+${fmtMoney(bonus)}`, 'mission');
    }
  }

  // ------------------------------------------------------------------ style
  addStyle(points: number, label: string) {
    this.meter = clamp(this.meter + points * 0.8, 0, 100);
    this.bank += points * this.mult * this.bankMul;
    this.chainT = 3.4;
    this.lastLabel = `${label}  +${Math.round(points * this.mult)}`;
    this.labelId++;
    this.updateRank();
  }
  private updateRank() {
    const r = this.meter < 18 ? 0 : this.meter < 38 ? 1 : this.meter < 60 ? 2 : this.meter < 82 ? 3 : 4;
    if (r > this.rank && r >= 2) this.g.audio.click();
    this.rank = r;
    this.mult = MULTS[r];
    if (r > this.bestRank) this.bestRank = r;
    if (r === 4) this.progress('rankS', 1);
  }
  private cashOut() {
    const amt = Math.round(this.bank * 0.45);
    if (amt >= 15) {
      this.g.addCashQuiet(amt);
      this.gainXp(this.bank * 0.4);
      this.g.toast('STYLE BANKED', `+${fmtMoney(amt)}`, 'cash');
      this.g.audio.cash();
    }
    this.bank = 0; this.meter = 0; this.rank = 0; this.mult = 1;
  }
  onDamaged(n: number) {
    if (this.bank > 40 && n > 2) {
      this.bank *= 0.5; this.meter *= 0.5;
      this.lastLabel = 'COMBO HIT — HALF LOST'; this.labelId++;
      this.updateRank();
    }
  }
  perfectDodge() { this.addStyle(40, 'PERFECT DODGE'); this.progress('dodges'); this.gainXp(15); }
  parry() { this.addStyle(45, 'PARRY'); this.progress('parries'); this.gainXp(20); }
  drift(metres: number) {
    this.driftAcc += metres;
    this.progress('drift', metres);
    if (this.driftAcc > 4) { this.addStyle(Math.min(12, this.driftAcc * 0.8), 'DRIFT'); this.driftAcc = 0; }
  }
  private driftAcc = 0;

  onKill(n: Npc, head: boolean, melee: boolean) {
    const gang = n.role === 'gang';
    let pts = 20;
    if (head) { pts += 25; this.progress('headshots'); }
    if (melee) { pts += 15; if (gang) this.progress('melee'); }
    this.addStyle(pts, head ? 'HEADSHOT KILL' : melee ? 'KO' : 'KILL');
    if (gang) this.progress('kills');
    this.gainXp(gang ? 28 : n.role === 'ped' ? 4 : 10);
    if (this.healOnKill && gang) this.g.player.hp = Math.min(100, this.g.player.hp + this.healOnKill);
  }

  // ------------------------------------------------------------------ challenges
  private newChallenge() {
    const used = new Set(this.chals.map((c) => c.type));
    const options = POOL.filter((p) => !used.has(p.type));
    const p = options[Math.floor(Math.random() * options.length)];
    const goal = p.goals[Math.min(p.goals.length - 1, Math.floor(Math.random() * (p.goals.length + (this.level > 3 ? 1 : 0))))];
    const cash = p.cash < 5 ? Math.round(goal * p.cash) : Math.round(p.cash * (goal > 20 ? 1 : goal));
    this.chals.push({ id: this.cid++, type: p.type, text: p.text(goal), goal, prog: 0, cash: Math.max(150, cash), xp: 60 + Math.round(cash * 0.15), done: false });
  }
  progress(type: ChalType, amt = 1) {
    for (const c of this.chals) {
      if (c.done || c.type !== type) continue;
      c.prog = Math.min(c.goal, c.prog + amt);
      if (c.prog >= c.goal) {
        c.done = true;
        this.g.addCashQuiet(c.cash);
        this.gainXp(c.xp);
        this.g.audio.cash();
        this.g.toast('CHALLENGE COMPLETE', `${c.text} · +${fmtMoney(c.cash)}`, 'good');
        setTimeout(() => { this.chals = this.chals.filter((q) => q.id !== c.id); this.newChallenge(); this.sync(); }, 3500);
      }
    }
  }

  // ------------------------------------------------------------------ events
  private canSpawnEvent() {
    const g = this.g;
    return g.state === 'play' && !g.missionRunning && !this.event && g.wanted === 0 && !g.interiors.current && !hud.dialogue && !hud.shop && !hud.phone && !hud.fullMap;
  }

  private spot(minD: number, maxD: number, needLos: boolean): { x: number; z: number } | null {
    const g = this.g, p = g.player;
    let best: { x: number; z: number } | null = null;
    for (let i = 0; i < 40; i++) {
      const s = g.world.sidewalkPts[Math.floor(Math.random() * g.world.sidewalkPts.length)];
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < minD || d > maxD) continue;
      best = s;
      if (!needLos) return s;
      const dx = (s.x - p.x) / d, dz = (s.z - p.z) / d;
      if (g.world.rayBoxes(p.x, 1.5, p.z, dx, 0, dz, d) >= d - 1) return s;
    }
    return best;
  }

  private spawnThugs(x: number, z: number, count: number, brawlerShare = 0.45) {
    const g = this.g;
    const list: Npc[] = [];
    const looks = [LOOKS.gang1, LOOKS.gang2, LOOKS.kaalu];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const e = g.spawnNpc(looks[i % 3], 'gang', x + Math.cos(a) * 3, z + Math.sin(a) * 3, 0);
      e.hostile = true; e.state = 'attack'; e.name = 'Thug';
      const brawler = Math.random() < brawlerShare;
      if (brawler) { e.setWeapon(Math.random() < 0.6 ? 'bat' : 'fists'); e.hp = e.maxHp = 70 + this.level * 6; e.brawler = true; }
      else { e.hp = e.maxHp = 60 + this.level * 5; }
      e.cash = 40 + Math.floor(Math.random() * 90);
      list.push(e);
    }
    return list;
  }

  private startEvent() {
    const g = this.g, p = g.player;
    const inCar = !!p.vehicle;
    const roll = Math.random();
    let ev: EventState | null = null;
    if (inCar && roll < 0.55) {
      // street race through the grid
      const s = g.world.nearestNode(p.x, p.z);
      let i = s.i, j = s.j;
      const cps: { x: number; z: number }[] = [];
      let dir = Math.random() < 0.5 ? 0 : 1, sign = Math.random() < 0.5 ? 1 : -1;
      for (let k = 0; k < 7; k++) {
        const len = 1 + Math.floor(Math.random() * 2);
        if (dir === 0) i = clamp(i + sign * len, 0, N); else j = clamp(j + sign * len, 0, N);
        if (k % 2 === 1 || (dir === 0 ? i : j) <= 0 || (dir === 0 ? i : j) >= N) { sign = Math.random() < 0.5 ? 1 : -1; dir = 1 - dir; }
        const q = nodePos(i, j);
        const last = cps[cps.length - 1];
        if (last && Math.hypot(last.x - q.x, last.z - q.z) < 30) continue;
        cps.push(q);
        if (cps.length >= 6) break;
      }
      if (cps.length < 4) return;
      const d0 = Math.hypot(cps[0].x - p.x, cps[0].z - p.z);
      ev = { kind: 'race', title: 'STREET RACE', text: `Hit all ${cps.length} checkpoints before time runs out`, t: 12 + d0 / 20, npcs: [], x: cps[0].x, z: cps[0].z, cps, cpIdx: 0, total: cps.length };
      this.g.audio.wanted();
    } else if (roll < 0.5 + (inCar ? 0 : 0.15) || this.level < 2) {
      const sp = this.spot(55, 95, true);
      if (!sp) return;
      const count = Math.min(8, 3 + this.level);
      const npcs = this.spawnThugs(sp.x, sp.z, count);
      ev = { kind: 'ambush', title: 'GANG AMBUSH', text: `${count} thugs are coming for you. Fight or run!`, t: 0, npcs, x: sp.x, z: sp.z, total: count };
      g.audio.wanted();
    } else {
      const sp = this.spot(70, 140, false);
      if (!sp) return;
      const guards = Math.min(5, 1 + this.level);
      const npcs = this.spawnThugs(sp.x, sp.z, guards, 0.3);
      const amt = Math.round((600 + Math.random() * 700) * (1 + this.level * 0.18));
      const cs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.34), new THREE.MeshStandardMaterial({ color: 0x1a8a3a, emissive: 0x20ff60, emissiveIntensity: 1.2, roughness: 0.4 }));
      cs.position.set(sp.x, 0.7, sp.z); g.scene.add(cs);
      ev = { kind: 'stash', title: 'STASH HOUSE', text: `Grab the briefcase (${fmtMoney(amt)}) — guards will fight you`, t: 110, npcs, x: sp.x, z: sp.z, caseMesh: cs, caseAmt: amt, total: guards };
    }
    if (!ev) return;
    this.event = ev;
    g.toast(ev.title, ev.text, 'mission');
    this.refreshMarkers();
    this.sync();
  }

  private refreshMarkers() {
    const ev = this.event;
    this.markers = [];
    this.beams.forEach((b) => (b.visible = false));
    if (!ev) return;
    if (ev.kind === 'race' && ev.cps) {
      const a = ev.cps[ev.cpIdx!], b = ev.cps[ev.cpIdx! + 1];
      this.markers.push({ x: a.x, z: a.z, color: '#ffd23a', label: 'CHECKPOINT', gps: true });
      if (b) this.markers.push({ x: b.x, z: b.z, color: '#9a8a3a' });
      this.placeBeam(0, a.x, a.z, 0xffd23a);
      if (b) this.placeBeam(1, b.x, b.z, 0x8a7a2a);
    } else if (ev.kind === 'stash' && !ev.took) {
      this.markers.push({ x: ev.x, z: ev.z, color: '#40ff80', label: 'STASH' });
      this.placeBeam(0, ev.x, ev.z, 0x30ff70);
    } else if (ev.kind === 'ambush') {
      this.markers.push({ x: ev.x, z: ev.z, color: '#ff3a5a', label: 'AMBUSH' });
    }
  }
  private placeBeam(i: number, x: number, z: number, color: number) {
    const b = this.beams[i];
    b.position.set(x, 0, z);
    (b.material as THREE.MeshBasicMaterial).color.setHex(color);
    b.visible = true;
  }

  private endEvent(success: boolean, msg?: string) {
    const g = this.g, ev = this.event;
    if (!ev) return;
    if (success) {
      const reward = ev.kind === 'race' ? 900 + this.level * 150 : ev.kind === 'ambush' ? 350 + ev.total * 90 : 250;
      g.addCashQuiet(reward);
      this.gainXp(ev.kind === 'race' ? 220 : 160);
      this.addStyle(60, 'EVENT CLEARED');
      this.progress('events');
      g.audio.cash();
      g.toast(`${ev.title} CLEARED`, `+${fmtMoney(reward)} · +XP`, 'good');
    } else {
      g.toast(`${ev.title} OVER`, msg ?? 'You missed it.', 'bad');
      for (const n of ev.npcs) if (n.alive) { n.hostile = false; if (Math.hypot(n.x - g.player.x, n.z - g.player.z) > 90) g.removeNpc(n); }
    }
    if (ev.caseMesh) g.scene.remove(ev.caseMesh);
    this.event = null;
    this.markers = [];
    this.beams.forEach((b) => (b.visible = false));
    this.nextEvent = 40 + Math.random() * 40;
    this.sync();
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number) {
    const g = this.g, p = g.player;
    if (g.state !== 'play') return;
    // style decay / cash-out
    if (this.bank > 0 || this.meter > 0) {
      this.chainT -= dt;
      if (this.chainT <= 0) {
        this.meter -= dt * (10 + this.rank * 4);
        if (this.meter <= 0) this.cashOut(); else this.updateRank();
      }
    }
    // mission takes priority
    if (g.missionRunning && this.event) this.endEvent(false, 'A job came in.');
    // spawn
    this.nextEvent -= dt;
    if (this.nextEvent <= 0) { if (this.canSpawnEvent()) { this.startEvent(); this.nextEvent = this.event ? 60 : 4; } else this.nextEvent = 6; }
    const ev = this.event;
    if (ev) {
      const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
      const d = Math.hypot(ev.x - px, ev.z - pz);
      if (ev.t > 0) { ev.t -= dt; if (ev.t <= 0) { this.endEvent(false, ev.kind === 'race' ? 'Out of time.' : 'The stash got moved.'); return; } }
      if (ev.kind === 'ambush') {
        const alive = ev.npcs.filter((n) => n.alive && !n.removed).length;
        ev.text = `${alive} thug${alive === 1 ? '' : 's'} left`;
        if (alive === 0) this.endEvent(true);
        else if (d > 230 && ev.npcs.every((n) => Math.hypot(n.x - px, n.z - pz) > 200)) this.endEvent(false, 'You ran away.');
      } else if (ev.kind === 'stash') {
        const alive = ev.npcs.filter((n) => n.alive && !n.removed).length;
        if (ev.caseMesh) { ev.caseMesh.rotation.y += dt * 2; ev.caseMesh.position.y = 0.7 + Math.sin(g.time * 3) * 0.12; }
        ev.text = ev.took ? 'Get out!' : `${alive} guards · grab the case`;
        if (!ev.took && d < 2) {
          ev.took = true;
          g.addCashQuiet(ev.caseAmt!); g.audio.cash();
          g.toast('STASH TAKEN', `+${fmtMoney(ev.caseAmt!)}`, 'cash');
          if (ev.caseMesh) g.scene.remove(ev.caseMesh);
          this.addStyle(35, 'STASH GRAB'); this.gainXp(120); this.progress('events');
          this.progress('cash', 0);
          g.crowd.scareAround(ev.x, ev.z, 50);
          this.event = null; this.markers = []; this.beams.forEach((b) => (b.visible = false)); this.nextEvent = 40 + Math.random() * 40;
          this.sync();
        }
      } else if (ev.kind === 'race' && ev.cps) {
        const cp = ev.cps[ev.cpIdx!];
        ev.text = `Checkpoint ${ev.cpIdx! + 1}/${ev.cps.length}`;
        if (p.vehicle && Math.hypot(cp.x - px, cp.z - pz) < 15) {
          ev.cpIdx!++;
          g.audio.click();
          this.addStyle(15, 'CHECKPOINT');
          if (ev.cpIdx! >= ev.cps.length) { this.endEvent(true); return; }
          const nx = ev.cps[ev.cpIdx!];
          ev.t += 9 + Math.hypot(nx.x - cp.x, nx.z - cp.z) / 24;
          ev.x = nx.x; ev.z = nx.z;
          this.refreshMarkers();
        }
      }
    }
    for (const b of this.beams) if (b.visible) (b.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(g.time * 4) * 0.06;
    // hud sync (throttled by caller's emit)
    this.noticeT -= dt;
    this.sync(false);
  }

  /** push state to the HUD store */
  sync(emit = true) {
    hud.style = { rank: RANKS[this.rank], mult: this.mult, pct: this.meter, bank: Math.round(this.bank), label: this.lastLabel, labelId: this.labelId, active: this.bank > 0 || this.meter > 1, chainT: this.chainT };
    hud.rep = { level: this.level, xp: this.xp, need: this.xpNeed };
    hud.challenges = this.chals.map((c) => ({ id: c.id, text: c.text, prog: Math.round(c.prog), goal: c.goal, done: c.done, cash: c.cash }));
    const ev = this.event;
    hud.event = ev ? { title: ev.title, text: ev.text, t: ev.t > 0 ? ev.t : null } : null;
    if (emit) emitHud();
  }

  serialize() { return { xp: this.xp, level: this.level, chals: this.chals.map((c) => ({ ...c })) }; }
  restore(s: { xp?: number; level?: number; chals?: Chal[] }) {
    this.xp = s.xp ?? 0; this.level = Math.max(1, s.level ?? 1);
    if (s.chals?.length) { this.chals = s.chals.slice(0, 3); this.cid = Math.max(...this.chals.map((c) => c.id)) + 1; while (this.chals.length < 3) this.newChallenge(); }
    this.sync();
  }
}
