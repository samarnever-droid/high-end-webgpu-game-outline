import * as THREE from 'three';
import type { Game, Marker } from './game';
import type { Npc } from './ai';
import { driveToward } from './ai';
import { LOOKS } from './humanoid';
import type { Vehicle } from './vehicle';
import { HALF, N, P, PAD, blockCenter, nodePos } from './world';
import { clamp, fmtMoney } from './util';

export class MissionFail extends Error {}

export interface MissionDef { id: number; title: string; desc: string; reward: number; run(g: Game): Promise<void> }

type V2 = { x: number; z: number };
const LOOP = PAD / 2 - 2.6;
const SIDE = LOOP * 2;

function ringPos(c: V2, s: number): V2 {
  s = ((s % (SIDE * 4)) + SIDE * 4) % (SIDE * 4);
  const e = Math.floor(s / SIDE), t = s - e * SIDE;
  if (e === 0) return { x: c.x - LOOP + t, z: c.z - LOOP };
  if (e === 1) return { x: c.x + LOOP, z: c.z - LOOP + t };
  if (e === 2) return { x: c.x + LOOP - t, z: c.z + LOOP };
  return { x: c.x - LOOP, z: c.z + LOOP - t };
}

export function setupStory(g: Game) {
  const poi = (id: string) => g.world.pois.find((p) => p.id === id)!;
  const club = poi('club'), garage = poi('garage'), bank = poi('bank');
  const defs: Record<string, { name: string; look: keyof typeof LOOKS; x: number; z: number; h: number; lines: string[] }> = {
    dev: { name: 'Dev', look: 'dev', x: club.x + 3.5, z: club.z - 1.5, h: Math.PI, lines: ['Keep your head down and your phone on, Veer.', 'The city pays those who keep quiet.', "Don't scratch the carpet. It's Italian."] },
    jimmy: { name: 'Jimmy', look: 'jimmy', x: garage.x + 4, z: garage.z - 1, h: Math.PI, lines: ["Every car has a story. Most of mine are illegal.", 'Need a respray? Drive into the bay.', "Wrenches don't lie, people do."] },
    meera: { name: 'Meera', look: 'meera', x: blockCenter(7, 3).x - 6, z: blockCenter(7, 3).z + 6, h: Math.PI, lines: ["I'm just a journalist. For now."] },
    raghav: { name: 'Raghav', look: 'raghav', x: blockCenter(7, 3).x + 108, z: blockCenter(7, 3).z, h: -Math.PI / 2, lines: ['...'] },
  };
  const npcs: Record<string, Npc> = {};
  for (const k of Object.keys(defs)) {
    const d = defs[k];
    const n = g.spawnNpc(LOOKS[d.look], 'story', d.x, d.z, d.h);
    n.key = k; n.name = d.name; n.invulnerable = true; n.state = 'idle';
    npcs[k] = n;
  }
  npcs.meera.human.root.visible = false; npcs.raghav.human.root.visible = false;
  const present = new Set(['dev', 'jimmy']);
  const handlers = new Map<string, () => Promise<void>>();
  let chatIdx = 0;

  const api = {
    npcs,
    present,
    canTalk(key: string) { return present.has(key) && !g.hud.dialogue && !g.hud.subtitle; },
    async talk(key: string) {
      const n = npcs[key];
      const h = handlers.get(key);
      g.dialogNpc = n; n.talking = true;
      try {
        if (h) { handlers.delete(key); await h(); }
        else {
          const d = defs[key];
          if (key === 'dev') {
            const c = await g.ask('Dev', 'Veer. Need something?', ['Any work?', 'Just checking in.']);
            if (c === 0) await g.say('Dev', g.completed.size >= 7 ? 'You already did the impossible. Go enjoy the city.' : 'Check your phone — [T]. The next job is waiting. I never repeat myself.');
            else await g.say('Dev', d.lines[chatIdx++ % d.lines.length]);
          } else await g.say(d.name, d.lines[chatIdx++ % d.lines.length]);
        }
      } catch { /* aborted */ }
      n.talking = false; g.dialogNpc = null;
    },
    cleanup() {
      handlers.clear();
      for (const k of Object.keys(npcs)) npcs[k].talking = false;
      g.flags.noWanted = false;
      show('meera', false); show('raghav', false);
    },
    handlers,
  };

  function show(k: string, on: boolean) {
    const n = npcs[k];
    n.human.root.visible = on;
    if (on) present.add(k); else present.delete(k);
    n.removed = false;
    if (!g.crowd.list.includes(n)) g.crowd.list.push(n);
  }
  (api as { show?: typeof show }).show = show;
  return api;
}

// ================================================================= mission helpers
const marker = (x: number, z: number, color = '#ffd23a', label?: string): Marker => ({ x, z, color, r: 3, label });

async function call(g: Game, who: string, lines: string[]) {
  g.audio.phone();
  g.toast('Incoming call', who, 'info');
  await g.sleep(1.2);
  for (const l of lines) await g.say(who, l, { auto: true });
}

async function goTo(g: Game, p: V2, r: number, text: string, mode: 'any' | 'car' | 'foot' = 'any', color = '#ffd23a') {
  g.setObjective(text, [marker(p.x, p.z, color)]);
  await g.waitFor(() => {
    const inCar = !!g.player.vehicle;
    if (mode === 'car' && !inCar) { g.hud.objective = 'Get in a car  [E]'; return false; }
    if (mode === 'foot' && inCar) { g.hud.objective = 'Get out of the car  [E]'; return false; }
    g.hud.objective = text;
    return g.distTo(p.x, p.z) < r;
  });
}

function talkWith(g: Game, key: string, text: string, fn: () => Promise<void>) {
  const st = g.story!;
  const n = st.npcs[key];
  g.setObjective(text, [marker(n.x, n.z, '#ff4fd8')]);
  let done = false;
  st.handlers.set(key, async () => { await fn(); done = true; });
  return g.waitFor(() => done);
}

function ring(g: Game, i: number, j: number, n: number, role: 'gang', s0 = 0): Npc[] {
  const c = blockCenter(i, j);
  const out: Npc[] = [];
  for (let k = 0; k < n; k++) {
    const p = ringPos(c, s0 + (k / n) * SIDE * 4);
    const look = k % 3 === 0 ? LOOKS.gang1 : k % 3 === 1 ? LOOKS.gang2 : LOOKS.kaalu;
    const e = g.spawnNpc(look, role, p.x, p.z, 0);
    e.hostile = true; e.state = 'attack'; e.name = 'Thug';
    e.hp = e.maxHp = 70;
    out.push(e);
  }
  return out;
}

async function killAll(g: Game, list: Npc[], text: string, color = '#ff4040') {
  await g.waitFor(() => {
    const alive = list.filter((n) => n.alive && !n.removed);
    g.setObjective(`${text} (${alive.length} left)`, alive.map((n) => ({ x: n.x, z: n.z, color, r: 1.4, gps: false })));
    return alive.length === 0;
  });
}

function fail(reason: string): never { throw new MissionFail(reason); }

function lanePath(nodes: { i: number; j: number }[]): V2[] {
  const pts: V2[] = [];
  for (let k = 0; k < nodes.length; k++) {
    const a = nodePos(nodes[k].i, nodes[k].j);
    const b = nodePos(nodes[Math.min(k + 1, nodes.length - 1)].i, nodes[Math.min(k + 1, nodes.length - 1)].j);
    const prev = nodePos(nodes[Math.max(k - 1, 0)].i, nodes[Math.max(k - 1, 0)].j);
    const d = k + 1 < nodes.length ? { x: b.x - a.x, z: b.z - a.z } : { x: a.x - prev.x, z: a.z - prev.z };
    const l = Math.hypot(d.x, d.z) || 1;
    pts.push({ x: a.x + (-d.z / l) * 2.2, z: a.z + (d.x / l) * 2.2 });
  }
  return pts;
}

// ================================================================= the missions
export const MISSIONS: MissionDef[] = [
  {
    id: 0, title: 'Welcome to the Lotus', desc: 'Dev wants to see you at his club.', reward: 1000,
    async run(g) {
      const club = g.world.pois.find((p) => p.id === 'club')!;
      g.setObjective('Answer the phone', []);
      await g.sleep(2.5);
      await call(g, 'Dev', ['Veer! You alive?', 'Get over to the Neon Lotus. The boss — me — has a proposition.', 'And bring your car. Parking in this city is murder.']);
      await goTo(g, { x: club.x, z: club.z - 3 }, 40, 'Go to the Neon Lotus nightclub');
      await talkWith(g, 'dev', 'Talk to Dev', async () => {
        await g.say('Dev', 'Veer, my boy. Sit, sit. Neon Nagri is changing — and not in my favour.');
        await g.say('Dev', "Raghav's crew is taking over the docks. Taxes, protection, the whole circus. I need someone with steady hands.");
        const c = await g.ask('Veer', 'What do you want from me?', ["I'm in. What's the job?", "What's in it for me?", "I'm not a hired gun, Dev."]);
        if (c === 0) await g.say('Dev', "That's the spirit. I knew you'd say yes.");
        else if (c === 1) { await g.say('Dev', 'Fifty thousand when it is done. And here — an advance, for your trouble.'); g.addCash(500); }
        else await g.say('Dev', "Everyone is a hired gun when the rent is due. Think of it as... consulting.");
        await g.say('Dev', "First you need proper wheels. Go see Jimmy at his garage. Tell him I sent you — he'll pretend not to like it.");
      });
    },
  },
  {
    id: 1, title: 'Wheels', desc: 'Jimmy has something for you.', reward: 1500,
    async run(g) {
      const gp = g.world.pois.find((p) => p.id === 'garage')!;
      await goTo(g, { x: gp.x, z: gp.z - 2 }, 12, "Go to Jimmy's Auto");
      let car: Vehicle | null = null;
      await talkWith(g, 'jimmy', 'Talk to Jimmy', async () => {
        await g.say('Jimmy', "Veer! Dev called ahead. He said you'd need something with teeth.");
        const c = await g.ask('Jimmy', 'Brawler SS. 6.2 litres, nitrous, and not technically mine. Want it?', ["Hand over the keys.", "Does it have a radio?", 'Is it clean?']);
        if (c === 1) await g.say('Jimmy', 'Three stations. Press R in the car. Neon FM is my favourite — fight me.');
        if (c === 2) await g.say('Jimmy', "Clean-ish. The plates are real. The previous owner is... on holiday.");
        await g.say('Jimmy', 'Hold Shift for nitro, Space for the handbrake. Take her round the block — three checkpoints, sixty seconds. Show me what you got.');
        car = g.spawnCar('muscle', 0x0d0d10, gp.x + 16, gp.z - 4, Math.PI / 2, 'player');
      });
      g.setObjective('Get in the Brawler', [marker(car!.x, car!.z, '#38d6ff')]);
      await g.waitFor(() => g.player.vehicle === car);
      const cps = [nodePos(4, 3), nodePos(4, 5), nodePos(6, 5), nodePos(6, 4)].map((p) => ({ x: p.x + 2, z: p.z }));
      g.startTimer(75, 'Time left', () => g.abortMission('Too slow, hotshot'));
      for (let k = 0; k < cps.length; k++) {
        const cp = cps[k];
        g.setObjective(`Checkpoint ${k + 1}/${cps.length} — floor it!`, [marker(cp.x, cp.z, '#ffd23a')]);
        await g.waitFor(() => g.distTo(cp.x, cp.z) < 12);
        g.audio.cash();
        g.startTimer((g.missionTimer?.t ?? 20) + 8, 'Time left', () => g.abortMission('Too slow, hotshot'));
      }
      g.stopTimer();
      await goTo(g, { x: gp.x, z: gp.z - 2 }, 14, 'Return to the garage', 'car');
      await call(g, 'Jimmy', ["Not bad. Not bad at all. The Brawler's yours.", 'Dev will call you about a package. Drive safe!']);
    },
  },
  {
    id: 2, title: 'Package Run', desc: 'Pick up a package at the bank and deliver it to the docks.', reward: 3000,
    async run(g) {
      const bank = g.world.pois.find((p) => p.id === 'bank')!;
      await call(g, 'Dev', ['Veer, a courier is waiting in the alley by Union Bank.', 'Pick up the briefcase. Nobody opens it. Nobody.', "Raghav's guys might have heard. Be quick."]);
      const pick = { x: bank.x + 10, z: bank.z - 3 };
      await goTo(g, pick, 5, 'Pick up the package at Union Bank');
      g.toast('Package', 'Briefcase secured', 'good');
      const dock = blockCenter(1, 6);
      const drop = { x: dock.x, z: dock.z - 51 };
      g.setObjective('Deliver the package to the warehouse district', [marker(drop.x, drop.z, '#ffd23a')]);
      // rival cars
      const cars: Vehicle[] = [];
      for (let k = 0; k < 2; k++) {
        const s = g.world.randomRoadSpawn();
        const v = g.spawnCar('sedan', 0x11111a, s.x + (k ? 40 : -40), s.z, s.h, 'mission');
        v.maxHealth = 700; v.health = 700;
        cars.push(v);
      }
      await g.say('Dev', 'Veer — two black sedans just pulled out behind you. Lose them or deal with them.', { auto: true });
      g.startTimer(190, 'Deliver in', () => g.abortMission('The package was late'));
      let dt = 0;
      await g.waitFor(() => {
        dt = 1 / 60;
        for (const v of cars) {
          if (v.wrecked) continue;
          const d = g.distTo(v.x, v.z);
          if (d > 220) { const s = g.world.randomRoadSpawn(); v.place(s.x, s.z, s.h, g.world); }
          driveToward(v, g.player.vehicle?.x ?? g.player.x, g.player.vehicle?.z ?? g.player.z, d < 50 ? 24 : 30, dt);
          v.sirenOn = false;
        }
        g.hud.objective = g.player.vehicle ? 'Deliver the package to the warehouse district' : 'Get back in a car!';
        return g.distTo(drop.x, drop.z) < 14 && !!g.player.vehicle;
      });
      g.stopTimer();
      cars.forEach((v) => { v.role = 'traffic'; g.removeVehicle(v); });
      await call(g, 'Dev', ['Package received. Great driving.', "Now I need to know who's leaking. Kaalu — fat guy, black SUV. Tail him."]);
    },
  },
  {
    id: 3, title: 'Tail the Rat', desc: "Follow Kaalu's SUV without being spotted.", reward: 4000,
    async run(g) {
      const start = nodePos(2, 5);
      const wh = blockCenter(3, 6);
      const dest = { x: wh.x, z: wh.z - 52 };
      const nodes = g.world.route(start.x, start.z, dest.x, dest.z);
      const pts = lanePath(nodes);
      await goTo(g, { x: start.x, z: start.z }, 40, "Get near Kaalu's black SUV", 'car');
      const suv = g.spawnCar('suv', 0x0b0c0e, pts[0].x, pts[0].z, 0, 'mission');
      const kaalu = g.spawnNpc(LOOKS.kaalu, 'story', 0, 0, 0);
      kaalu.human.root.visible = false; kaalu.invulnerable = true;
      suv.maxHealth = suv.health = 3000;
      await g.say('Dev', "That's him. Stay back — but don't lose him.", { auto: true });
      let idx = 1, lost = 0, arrived = false;
      await g.waitFor(() => {
        const t = pts[Math.min(idx, pts.length - 1)];
        if (Math.hypot(t.x - suv.x, t.z - suv.z) < 14 && idx < pts.length - 1) idx++;
        const last = idx >= pts.length - 1 && Math.hypot(pts[pts.length - 1].x - suv.x, pts[pts.length - 1].z - suv.z) < 12;
        const d = g.distTo(suv.x, suv.z);
        const sp = last ? 0 : d < 25 ? 6 : d > 90 ? 9 : 13;
        driveToward(suv, t.x, t.z, sp, 1 / 60);
        if (last) { suv.ctl.hand = true; arrived = true; }
        if (d > 110) lost += 1 / 60 / 7; else lost = Math.max(0, lost - 1 / 60 / 3);
        g.hud.lost = lost;
        g.setObjective(g.player.vehicle ? "Follow Kaalu's SUV — don't get too close or too far" : 'Get back in your car!', [{ x: suv.x, z: suv.z, color: '#ff4040', r: 2, gps: true }]);
        if (lost >= 1) fail('Kaalu got away');
        if (d < 8 && Math.abs(g.player.vehicle?.speed ?? 0) > 18) { /* too aggressive */ lost = Math.min(1, lost + 0.002); }
        return arrived && d < 40;
      });
      g.hud.lost = null;
      kaalu.human.root.visible = true;
      kaalu.place(suv.x + 2.4, suv.z, 0);
      kaalu.state = 'idle';
      await g.say('Kaalu', "Who's there?! ...Oh no.", { auto: true });
      kaalu.state = 'flee'; kaalu.invulnerable = false; kaalu.fleeFrom = { x: g.player.x, z: g.player.z }; kaalu.stateT = 4;
      g.flags.kaalu = kaalu;
      await g.sleep(2);
      await call(g, 'Dev', ['So he IS meeting Raghav’s people. Warehouse is hot, Veer.', 'Pick up some firepower at the Gun Club if you can — then go in.']);
    },
  },
  {
    id: 4, title: 'Warehouse Showdown', desc: "Clear Raghav's goons out of the warehouse yard.", reward: 6000,
    async run(g) {
      const gc = g.world.pois.find((p) => p.id === 'ammu')!;
      g.setObjective('Optional: buy weapons at the Gun Club — or go straight to the warehouse', [marker(gc.x, gc.z, '#ffb02a')]);
      const wh = blockCenter(3, 6);
      const enemies = ring(g, 3, 6, 5, 'gang', 6);
      enemies.forEach((e) => (e.hostile = false, e.state = 'idle'));
      await g.waitFor(() => g.distTo(wh.x, wh.z) < 85);
      g.toast('Warehouse district', 'Armed men ahead. Press 1-7 for weapons, RMB to aim.', 'mission');
      enemies.forEach((e) => (e.hostile = true, e.state = 'attack'));
      g.audio.wanted();
      await killAll(g, enemies, 'Eliminate the thugs');
      const wave2 = ring(g, 3, 6, 5, 'gang', 40);
      await g.say('Veer', 'More coming!', { auto: true });
      await killAll(g, wave2, 'Eliminate reinforcements');
      const kaalu = g.flags.kaalu as Npc | undefined;
      if (kaalu && kaalu.alive) {
        kaalu.state = 'hands';
        await talkWithNpc(g, kaalu, 'Talk to Kaalu', async () => {
          await g.say('Kaalu', "Don't shoot! I just drive! Raghav's behind everything — the docks, the cops he pays...");
          const c = await g.ask('Veer', 'Where is Raghav?', ['Talk. Now.', 'You have five seconds.']);
          void c;
          await g.say('Kaalu', "The harbour pier. He leaves tonight by speedboat. There's a journalist — Meera — she has proof. She's waiting near the beach.");
        });
        kaalu.state = 'flee'; kaalu.stateT = 6; kaalu.fleeFrom = { x: g.player.x, z: g.player.z };
      }
      await call(g, 'Dev', ['Kaalu talked? Good. Races are how the harbour crews settle debt.', "Win the street race tonight and they'll hand you Raghav's schedule."]);
    },
  },
  {
    id: 5, title: 'Street Race', desc: 'Beat two racers around the city.', reward: 8000,
    async run(g) {
      const nodes: [number, number][] = [[4, 4], [6, 4], [6, 2], [4, 2], [2, 2], [2, 4], [2, 6], [4, 6], [4, 4]];
      const cps = nodes.map(([i, j]) => nodePos(i, j));
      const start = { x: cps[0].x + 2.2, z: cps[0].z - 30 };
      await goTo(g, start, 12, 'Go to the starting line with a car', 'car');
      const rivals: { v: Vehicle; idx: number; name: string }[] = [];
      const h0 = Math.atan2(cps[0].x - start.x, cps[0].z - start.z);
      rivals.push({ v: g.spawnCar('sports', 0xd01818, start.x - 5, start.z + 8, h0, 'mission'), idx: 0, name: 'Razor' });
      rivals.push({ v: g.spawnCar('muscle', 0xe0a010, start.x + 5, start.z + 8, h0, 'mission'), idx: 0, name: 'Gunner' });
      for (const r of rivals) r.v.maxHealth = r.v.health = 4000;
      await call(g, 'Jimmy', ["Race night! Eight checkpoints, two rivals, no rules.", 'Cops will look the other way. Mostly.']);
      for (const n of ['3', '2', '1', 'GO!']) { g.toast(n, '', 'mission'); g.audio.click(); await g.sleep(0.9); }
      let myIdx = 0, finished = false, place = 0;
      const winner: string[] = [];
      await g.waitFor(() => {
        const t = cps[myIdx];
        g.setObjective(`Checkpoint ${Math.min(myIdx + 1, cps.length)}/${cps.length} — position ${1 + rivals.filter((r) => r.idx > myIdx).length}/3`, [marker(t.x, t.z, '#ffd23a'), ...(cps[myIdx + 1] ? [{ ...marker(cps[myIdx + 1].x, cps[myIdx + 1].z, '#ffffff'), gps: false }] : [])]);
        if (g.distTo(t.x, t.z) < 14) { myIdx++; g.audio.cash(); if (myIdx >= cps.length) { finished = true; place = 1 + winner.length; } }
        for (const r of rivals) {
          if (r.idx >= cps.length) continue;
          const tp = cps[r.idx], nx = cps[Math.min(r.idx + 1, cps.length - 1)];
          const d = Math.hypot(tp.x - r.v.x, tp.z - r.v.z);
          if (d < 20) { r.idx++; if (r.idx >= cps.length) winner.push(r.name); }
          driveToward(r.v, tp.x * 0.7 + nx.x * 0.3, tp.z * 0.7 + nx.z * 0.3, r.v.spec.top * (r.name === 'Razor' ? 0.78 : 0.72), 1 / 60);
          r.v.sirenOn = false;
          if (r.v.wrecked) r.idx = 99;
        }
        if (!g.player.vehicle && !finished) g.hud.objective = 'Get back in your car!';
        if (winner.length >= 2 && !finished) fail('You lost the race');
        return finished;
      });
      rivals.forEach((r) => { r.v.role = 'traffic'; });
      if (place > 1) fail(`You finished ${place === 2 ? '2nd' : '3rd'} — you need to win`);
      g.toast('1st place!', 'The harbour crews respect you now.', 'good');
      rivals.forEach((r) => g.removeVehicle(r.v));
      await call(g, 'Dev', ["Beautiful. Now — the money. Union Bank holds Raghav's laundering vault.", 'You, a van, and a very bad idea.']);
    },
  },
  {
    id: 6, title: 'The Union Job', desc: "Rob Raghav's vault — then lose the heat.", reward: 20000,
    async run(g) {
      const bank = g.world.pois.find((p) => p.id === 'bank')!;
      g.setObjective('Go to Union Bank', [marker(bank.x, bank.z, '#6aff9a')]);
      await goTo(g, { x: bank.x, z: bank.z - 4 }, 30, 'Go to Union Bank', 'any', '#6aff9a');
      g.flags.noWanted = true;
      g.toast('Rule one', 'Leave no witnesses. Guards are armed.', 'mission');
      const guards: Npc[] = [];
      const fronts: V2[] = [{ x: bank.x - 6, z: bank.z - 6 }, { x: bank.x + 6, z: bank.z - 8 }, { x: bank.x, z: bank.z - 14 }, { x: bank.x + 14, z: bank.z - 5 }];
      for (const p of fronts) {
        const e = g.spawnNpc(LOOKS.swat, 'gang', p.x, p.z, 0);
        e.name = 'Guard'; e.hostile = true; e.state = 'attack'; e.hp = e.maxHp = 110; e.setWeapon('smg');
        guards.push(e);
      }
      await killAll(g, guards, 'Neutralise the bank guards');
      const van = g.spawnCar('van', 0x1a1c20, bank.x + 14, bank.z - 3, Math.PI / 2, 'parked');
      g.setObjective('Grab the cash from the armored van', [marker(van.x, van.z - 3, '#6aff9a')]);
      await g.waitFor(() => g.distTo(van.x, van.z - 3) < 4.5);
      for (let k = 0; k < 6; k++) g.dropCash(van.x - 2 + k * 0.8, van.z - 3.5, 800);
      g.flags.noWanted = false;
      g.setWanted(4);
      g.audio.wanted();
      g.toast('HEIST', 'Cash bags secured — cops are on the way!', 'bad');
      g.setObjective('Lose the cops! Hide, or use the Pay\'n\'Spray', []);
      await g.waitFor(() => g.wanted === 0);
      await call(g, 'Dev', ["Beautiful chaos. The vault's emptied — Raghav is bleeding.", "He's running. Meera is at the harbour — go. This ends tonight."]);
    },
  },
  {
    id: 7, title: "Raghav's End", desc: 'Face Raghav at the harbour.', reward: 50000,
    async run(g) {
      const st = g.story! as ReturnType<typeof setupStory> & { show: (k: string, on: boolean) => void };
      const bc = blockCenter(7, 3);
      const meeraPos = { x: bc.x - 6, z: bc.z + 6 };
      st.show('meera', true);
      await goTo(g, meeraPos, 40, 'Meet Meera at the harbour');
      await talkWith(g, 'meera', 'Talk to Meera', async () => {
        await g.say('Meera', "Veer. I've been following Raghav for two years. Every dock tax, every cop on his payroll — it's all here.");
        const c = await g.ask('Meera', 'He is at the end of the pier with a full crew. What do we do?', ['We end him.', 'We take him alive. Your story needs a trial.', 'Just give me a weapon.']);
        if (c === 2) { g.giveWeapon('rifle', 120); g.toast('Meera', 'Assault rifle + 120 rounds', 'good'); }
        if (c === 1) await g.say('Meera', "That's the best answer. It's also the hardest one.");
        else await g.say('Meera', "Whatever you choose — I'll be filming.");
        g.giveWeapon('rpg', 3);
        g.player.armor = 100;
        await g.say('Meera', "Take this armour — and this. Jimmy said you'd need it. Don't ask where he got an RPG.");
      });
      st.show('meera', false);
      st.show('raghav', true);
      const gang = [...ring(g, 7, 3, 10, 'gang', 10)];
      gang.forEach((e) => { e.hostile = true; e.state = 'attack'; e.hp = e.maxHp = 85; });
      await goTo(g, { x: bc.x + 55, z: bc.z }, 60, 'Fight your way down the pier');
      g.audio.wanted();
      await killAll(g, gang, "Take down Raghav's crew");
      const raghav = st.npcs.raghav;
      const suv = g.spawnCar('suv', 0xeeeeee, raghav.x - 6, raghav.z + 5, -Math.PI / 2, 'mission');
      suv.maxHealth = suv.health = 2400;
      await g.say('Raghav', 'You shot my men. You wrecked my business. Fine. I will bury you with money.', { auto: true });
      raghav.human.root.visible = false;
      g.setObjective("Chase Raghav's white SUV", [{ x: suv.x, z: suv.z, color: '#ff4040', r: 2 }]);
      // flee along a long loop
      const loopNodes: [number, number][] = [[8, 3], [8, 5], [6, 5], [6, 7], [4, 7], [4, 3], [2, 3], [2, 1], [5, 1], [5, 3]];
      const pts = lanePath(loopNodes.map(([i, j]) => ({ i, j })));
      let idx = 0, lost = 0;
      g.startTimer(240, 'Raghav escapes in', () => g.abortMission('Raghav escaped'));
      await g.waitFor(() => {
        const t = pts[idx % pts.length];
        if (Math.hypot(t.x - suv.x, t.z - suv.z) < 16) idx++;
        const d = g.distTo(suv.x, suv.z);
        driveToward(suv, t.x, t.z, d > 70 ? 20 : 30, 1 / 60);
        suv.sirenOn = false;
        if (d > 160) lost += 1 / 60 / 8; else lost = Math.max(0, lost - 1 / 60 / 3);
        g.hud.lost = lost > 0.05 ? lost : null;
        if (lost >= 1) fail('Raghav got away');
        g.setObjective(`Wreck Raghav's SUV (${Math.round((suv.health / suv.maxHealth) * 100)}%)`, [{ x: suv.x, z: suv.z, color: '#ff4040', r: 2, gps: true }]);
        return suv.health < suv.maxHealth * 0.3 || suv.wrecked;
      });
      g.stopTimer(); g.hud.lost = null;
      suv.ctl.hand = true; suv.ctl.throttle = 0;
      g.setObjective('Raghav is cornered', [marker(suv.x, suv.z, '#ffd23a')]);
      await g.waitFor(() => g.distTo(suv.x, suv.z) < 12 && !g.player.vehicle || (g.distTo(suv.x, suv.z) < 12 && Math.abs(g.player.vehicle?.speed ?? 0) < 3));
      g.setCinematic(true);
      if (g.player.vehicle) g.exitVehicle();
      raghav.human.root.visible = true;
      raghav.place(suv.x + 3, suv.z, Math.PI / 2);
      raghav.talking = true; g.dialogNpc = raghav;
      await g.say('Raghav', "You're a clever boy, Veer. Clever enough to know this city runs on men like me.");
      const c = await g.ask('Raghav', 'Name your price. Everyone has one.', ['There is no price. Meera has the story.', 'You killed my friends. This ends here.', 'Walk away. Leave Neon Nagri.']);
      raghav.talking = false; g.dialogNpc = null;
      g.setCinematic(false);
      if (c === 1) {
        await g.say('Veer', 'Neon Nagri deserves better.', { auto: true });
        raghav.invulnerable = false; raghav.hp = 1;
        raghav.hurt(999, g, g.player.x, g.player.z, false, true);
      } else await g.say('Raghav', 'You will regret this...', { auto: true });
      g.setWanted(0, true);
      await g.sleep(2);
      await call(g, 'Dev', ['It is over. The docks are quiet. The city is yours, Veer.', `Your cut: ${fmtMoney(50000)}. Spend it wisely. Or don't.`]);
    },
  },
];

async function talkWithNpc(g: Game, n: Npc, text: string, fn: () => Promise<void>) {
  g.setObjective(text, [marker(n.x, n.z, '#ff4fd8')]);
  await g.waitFor(() => g.distTo(n.x, n.z) < 4);
  g.dialogNpc = n;
  n.talking = true;
  await fn();
  n.talking = false;
  g.dialogNpc = null;
}

void THREE; void HALF; void N; void P; void clamp;
