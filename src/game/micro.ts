import * as THREE from 'three';
import type { Game } from './game';
import type { Room } from './interiors';
import { hud } from './store';
import { STATIONS } from './audio';

/**
 * Micro-interactions for walkable interiors. Every room gets a light switch; each shop gets its
 * own little toy (service bell, spray can, TV, fridge, turntable, dry-fire...). Each prop shows a
 * bobbing diamond that grows as you approach, a prompt, a sound and a visible reaction.
 */
export interface Prop {
  x: number; z: number; y: number; r: number;
  label: string;
  use: (g: Game, r: Room) => void;
  hint?: THREE.Mesh;
  cd?: number;
  press?: number; // 0..1 squash animation
  target?: THREE.Object3D;
}

const std = (c: number, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
let hintGeo: THREE.BufferGeometry | null = null;

function addProp(r: Room, p: Prop) {
  hintGeo ??= new THREE.OctahedronGeometry(0.1, 0);
  const m = new THREE.Mesh(hintGeo, new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.9, depthWrite: false }));
  m.position.set(p.x, p.y, p.z);
  r.group.add(m);
  p.hint = m;
  r.props.push(p);
}

export function buildRoomProps(r: Room, id: string, _g?: Game) {
  void _g;
  const { W, D } = r;
  const grp = r.group;

  // ------------------------------------------------ universal: light switch by the door
  {
    const sx = 3.7, sz = -D / 2;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.24, 0.04), std(0xf0ede4, 0.5));
    plate.position.set(sx, 1.3, sz + 0.02);
    const nub = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.1, 0.03), std(0x2a2a2e, 0.4));
    nub.position.set(sx, 1.3, sz + 0.05);
    nub.rotation.x = -0.35;
    grp.add(plate, nub);
    addProp(r, {
      x: sx, z: sz + 0.9, y: 1.75, r: 1.35, label: 'Flip the lights', target: nub,
      use: (gm, rm) => {
        const on = !rm.lightsOn;
        gm.interiors.setLights(rm, on);
        nub.rotation.x = on ? -0.35 : 0.35;
        gm.audio.switchClick(on);
        gm.toast(on ? 'Lights on' : 'Lights off', on ? 'Room is bright again.' : 'Moody. Watch your step.', 'info');
      },
    });
  }

  // ------------------------------------------------ per-room toys
  if (id === 'home') {
    // stereo on a wall shelf
    const sx = -W / 2 + 0.5, sz = 2.4;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.5), std(0x15161a, 0.5));
    shelf.position.set(sx, 1.1, sz);
    const stereo = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.9), std(0x2a2c32, 0.4, 0.5));
    stereo.position.set(sx, 1.23, sz);
    const dial = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.4), new THREE.MeshBasicMaterial({ color: 0x40ff90 }));
    dial.position.set(sx + 0.175, 1.25, sz);
    grp.add(shelf, stereo, dial);
    addProp(r, {
      x: sx + 1.4, z: sz, y: 1.7, r: 1.7, label: 'Change radio station',
      use: (gm) => { gm.nextStation(); gm.audio.switchClick(true); gm.toast('Radio', STATIONS[gm.audio.station], 'info'); dial.scale.z = 0.5 + Math.random() * 1.2; },
    });
    // TV
    addProp(r, {
      x: -5, z: 3.9, y: 1.95, r: 2.2, label: 'Toggle TV',
      use: (gm, rm) => { rm.tvOn = !rm.tvOn; gm.audio.switchClick(rm.tvOn); if (rm.tvOn) gm.audio.tvOn(); },
    });
    // fridge
    addProp(r, {
      x: W / 2 - 2.5, z: 1, y: 1.9, r: 2.0, label: 'Grab a cold drink', cd: 0,
      use: (gm) => {
        const p = gm.player;
        gm.audio.fridge();
        const prop = r.props.find((q) => q.label === 'Grab a cold drink')!;
        if ((prop.cd ?? 0) > gm.time) { gm.toast('Fridge', 'Plenty of drinks. Maybe slow down.', 'info'); return; }
        if (p.hp < 100) { p.hp = Math.min(100, p.hp + 10); gm.toast('Cold drink', '+10 health', 'good'); } else gm.toast('Fridge', 'You are not thirsty.', 'info');
        prop.cd = gm.time + 12;
      },
    });
  }

  if (id === 'burger') {
    const bx = 3.8, bz = D / 2 - 3.9;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.04, 20), std(0x2a2a2e, 0.3, 0.8));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), std(0xd8b04a, 0.2, 1));
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8), std(0xd8b04a, 0.2, 1));
    base.position.set(bx, 1.14, bz); dome.position.set(bx, 1.16, bz); knob.position.set(bx, 1.32, bz);
    grp.add(base, dome, knob);
    addProp(r, {
      x: bx, z: bz - 1.35, y: 1.75, r: 1.5, label: 'Ring the service bell', target: knob,
      use: (gm, rm) => {
        gm.audio.ding();
        rm.greetT = 2.4;
        const prop = rm.props.find((q) => q.target === knob)!;
        prop.press = 1;
        gm.toast(rm.keeper?.name ?? 'Cashier', 'Coming, coming! Welcome to Burger Shot.', 'info');
      },
    });
  }

  if (id === 'spray') {
    const cx = -2.1, cz = D / 2 - 3.9;
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 14), std(0xff2fa0, 0.3, 0.5));
    can.position.set(cx, 1.2, cz);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.05, 14), std(0x111111, 0.4));
    cap.position.set(cx, 1.34, cz);
    grp.add(can, cap);
    addProp(r, {
      x: cx - 1.6, z: cz - 1.35, y: 1.8, r: 1.5, label: 'Shake a spray can', target: can,
      use: (gm, rm) => {
        gm.audio.rattle();
        const col = [0xff2fa0, 0x30d050, 0x1368ff, 0xffd23a, 0xff6a10][Math.floor(Math.random() * 5)];
        (can.material as THREE.MeshStandardMaterial).color.setHex(col);
        const c = new THREE.Color(col);
        setTimeout(() => { for (let i = 0; i < 6; i++) gm.fx.dust(rm.ox + cx, 1.35, rm.oz + cz, 0, 0, 1, [c.r, c.g, c.b]); }, 380);
        const prop = rm.props.find((q) => q.target === can)!;
        prop.press = 1;
      },
    });
  }

  if (id === 'ammu') {
    addProp(r, {
      x: 0, z: -4.6, y: 1.8, r: 1.9, label: 'Dry-fire the display piece',
      use: (gm) => { gm.audio.empty(); setTimeout(() => gm.audio.reload(), 220); gm.toast('Dealer', 'Hey — no touching unless you are buying.', 'info'); },
    });
  }

  if (id === 'dealer') {
    addProp(r, {
      x: 0, z: -2.5, y: 1.9, r: 2.2, label: 'Pause / resume the turntables',
      use: (gm, rm) => { rm.spinPaused = !rm.spinPaused; gm.audio.switchClick(!rm.spinPaused); gm.toast('Showroom', rm.spinPaused ? 'Turntables paused — take a good look.' : 'Turntables rolling.', 'info'); },
    });
  }

  if (id === 'garage') {
    addProp(r, {
      x: -W / 2 + 3.2, z: -4, y: 1.8, r: 1.9, label: 'Spin the impact wrench',
      use: (gm) => { gm.audio.rattle(); setTimeout(() => gm.audio.rattle(), 380); gm.toast('Jimmy', 'Careful! That one is calibrated.', 'info'); },
    });
  }

  if (id === 'hospital') {
    const hx = -W / 2 + 1.2, hz = -D / 2 + 3.4;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.1), std(0xf4f6f8, 0.4));
    box.position.set(hx, 1.25, hz);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), std(0x3a8ad0, 0.4));
    pump.position.set(hx + 0.02, 1.12, hz + 0.08);
    grp.add(box, pump);
    addProp(r, {
      x: hx + 1.4, z: hz, y: 1.8, r: 1.6, label: 'Use hand sanitizer', target: pump,
      use: (gm, rm) => {
        gm.audio.click();
        const p = gm.player;
        if (p.hp < 100) p.hp = Math.min(100, p.hp + 3);
        gm.toast('Squeak squeak', 'Hands spotless. Nurse approves.', 'good');
        rm.props.find((q) => q.target === pump)!.press = 1;
      },
    });
  }
}

/** per-frame: hint bobbing, press animations, reaction scale when the player is close */
export function updateProps(r: Room, t: number, px: number, pz: number, dt: number) {
  r.props.forEach((p, i) => {
    const h = p.hint;
    if (!h) return;
    const d = Math.hypot(px - (r.ox + p.x), pz - (r.oz + p.z));
    const near = d < p.r * 1.8;
    const s = THREE.MathUtils.damp(h.scale.x, near ? 1.5 : 0.8, 8, dt);
    h.scale.setScalar(s);
    h.position.y = p.y + Math.sin(t * 2.2 + i) * 0.05;
    h.rotation.y += dt * (near ? 3.2 : 1.2);
    const mat = h.material as THREE.MeshBasicMaterial;
    mat.opacity = near ? 1 : 0.55;
    mat.color.setHex(d < p.r ? 0xffe066 : 0x66e0ff);
    if (p.press && p.press > 0) {
      p.press = Math.max(0, p.press - dt * 4);
      if (p.target) p.target.scale.y = 1 - Math.sin(p.press * Math.PI) * 0.4;
    }
  });
  void hud;
}
