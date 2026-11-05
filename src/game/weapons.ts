import * as THREE from 'three';
import type { WeaponClass } from './humanoid';

export type WeaponId = 'fists' | 'bat' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'rpg';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  cls: WeaponClass;
  dmg: number;
  rate: number; // shots per second
  mag: number;
  range: number;
  spread: number; // radians
  auto: boolean;
  pellets: number;
  price: number;
  ammoPrice: number; // per magazine
  reload: number;
  kick: number;
  loud: number;
  explosive?: boolean;
  icon: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { id: 'fists', name: 'Fists', cls: 'none', dmg: 12, rate: 2.6, mag: 0, range: 1.7, spread: 0, auto: false, pellets: 1, price: 0, ammoPrice: 0, reload: 0, kick: 0, loud: 0, icon: '✊' },
  bat: { id: 'bat', name: 'Baseball Bat', cls: 'melee', dmg: 38, rate: 1.4, mag: 0, range: 2.2, spread: 0, auto: false, pellets: 1, price: 150, ammoPrice: 0, reload: 0, kick: 0, loud: 0, icon: '🏏' },
  pistol: { id: 'pistol', name: 'M1911 Pistol', cls: 'pistol', dmg: 26, rate: 4.2, mag: 12, range: 90, spread: 0.012, auto: false, pellets: 1, price: 400, ammoPrice: 60, reload: 1.3, kick: 0.9, loud: 1, icon: '🔫' },
  smg: { id: 'smg', name: 'Micro SMG', cls: 'twohand', dmg: 15, rate: 14, mag: 30, range: 70, spread: 0.035, auto: true, pellets: 1, price: 1500, ammoPrice: 120, reload: 1.6, kick: 0.5, loud: 1, icon: '⚙' },
  shotgun: { id: 'shotgun', name: 'Pump Shotgun', cls: 'twohand', dmg: 11, rate: 1.15, mag: 6, range: 40, spread: 0.085, auto: false, pellets: 9, price: 2200, ammoPrice: 150, reload: 2.2, kick: 2.2, loud: 1.4, icon: '💥' },
  rifle: { id: 'rifle', name: 'Assault Rifle', cls: 'twohand', dmg: 24, rate: 9, mag: 30, range: 160, spread: 0.018, auto: true, pellets: 1, price: 4200, ammoPrice: 220, reload: 2.0, kick: 0.9, loud: 1.3, icon: '🎯' },
  rpg: { id: 'rpg', name: 'RPG Launcher', cls: 'twohand', dmg: 300, rate: 0.5, mag: 1, range: 200, spread: 0.0, auto: false, pellets: 1, price: 9000, ammoPrice: 600, reload: 3.0, kick: 3, loud: 2, explosive: true, icon: '🚀' },
};
export const WEAPON_ORDER: WeaponId[] = ['fists', 'bat', 'pistol', 'smg', 'shotgun', 'rifle', 'rpg'];

const gun = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.32, metalness: 0.92 });
const steel = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.25, metalness: 1 });
const poly = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.55, metalness: 0.1 });
const wood = new THREE.MeshStandardMaterial({ color: 0x6a4224, roughness: 0.5, metalness: 0 });
const olive = new THREE.MeshStandardMaterial({ color: 0x3e4636, roughness: 0.6, metalness: 0.2 });

function bx(g: THREE.Group, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y, z);
  me.rotation.x = rx;
  me.castShadow = true;
  g.add(me);
  return me;
}
function cy(g: THREE.Group, m: THREE.Material, r: number, len: number, x: number, y: number, z: number, r2 = r) {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, 14), m);
  me.rotation.x = Math.PI / 2;
  me.position.set(x, y, z);
  me.castShadow = true;
  g.add(me);
  return me;
}

export interface WeaponModel { group: THREE.Group; muzzle: THREE.Object3D; flash: THREE.Mesh }

export function buildWeaponModel(id: WeaponId): WeaponModel | null {
  if (id === 'fists') return null;
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  g.add(muzzle);
  switch (id) {
    case 'bat': {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.012, 0.85, 12), wood);
      m.rotation.x = Math.PI / 2;
      m.position.set(0, 0, 0.35);
      m.castShadow = true;
      g.add(m);
      muzzle.position.set(0, 0, 0.7);
      break;
    }
    case 'pistol': {
      bx(g, gun, 0.026, 0.034, 0.2, 0, 0.02, 0.07); // slide
      bx(g, steel, 0.02, 0.01, 0.2, 0, 0.042, 0.07);
      bx(g, poly, 0.028, 0.02, 0.12, 0, -0.006, 0.04); // frame
      bx(g, poly, 0.03, 0.095, 0.045, 0, -0.055, -0.005, 0.18); // grip
      bx(g, gun, 0.006, 0.03, 0.03, 0, -0.01, 0.075); // trigger guard
      cy(g, steel, 0.007, 0.03, 0, 0.022, 0.185);
      bx(g, steel, 0.01, 0.008, 0.01, 0, 0.044, 0.16);
      muzzle.position.set(0, 0.022, 0.2);
      break;
    }
    case 'smg': {
      bx(g, gun, 0.04, 0.06, 0.26, 0, 0.02, 0.1);
      bx(g, poly, 0.036, 0.1, 0.045, 0, -0.06, 0.0, 0.2);
      bx(g, poly, 0.03, 0.15, 0.03, 0, -0.1, 0.12, 0.05); // mag
      cy(g, gun, 0.01, 0.12, 0, 0.03, 0.29);
      cy(g, steel, 0.014, 0.07, 0, 0.03, 0.34);
      bx(g, poly, 0.03, 0.025, 0.14, 0, 0.0, -0.1); // stock wire
      bx(g, steel, 0.008, 0.02, 0.012, 0, 0.06, 0.2);
      muzzle.position.set(0, 0.03, 0.38);
      break;
    }
    case 'shotgun': {
      bx(g, wood, 0.04, 0.07, 0.3, 0, -0.01, -0.18, -0.12);
      bx(g, gun, 0.042, 0.065, 0.2, 0, 0.02, 0.05);
      cy(g, gun, 0.015, 0.62, 0, 0.032, 0.42);
      cy(g, gun, 0.017, 0.2, 0, 0.0, 0.38);
      bx(g, wood, 0.045, 0.045, 0.16, 0, -0.005, 0.36);
      bx(g, poly, 0.03, 0.08, 0.04, 0, -0.06, -0.01, 0.2);
      muzzle.position.set(0, 0.032, 0.74);
      break;
    }
    case 'rifle': {
      bx(g, gun, 0.045, 0.07, 0.34, 0, 0.02, 0.08);
      bx(g, poly, 0.044, 0.05, 0.22, 0, 0.0, 0.34);
      cy(g, gun, 0.01, 0.3, 0, 0.03, 0.6);
      cy(g, steel, 0.016, 0.06, 0, 0.03, 0.75);
      bx(g, poly, 0.04, 0.07, 0.3, 0, -0.01, -0.25, -0.1);
      bx(g, poly, 0.034, 0.1, 0.045, 0, -0.07, 0.0, 0.2);
      bx(g, poly, 0.034, 0.16, 0.05, 0, -0.12, 0.14, 0.25);
      bx(g, gun, 0.02, 0.03, 0.12, 0, 0.075, 0.08); // sight rail
      bx(g, poly, 0.036, 0.04, 0.1, 0, 0.1, 0.12); // optic
      muzzle.position.set(0, 0.03, 0.78);
      break;
    }
    case 'rpg': {
      cy(g, olive, 0.04, 0.9, 0, 0.04, 0.2);
      cy(g, olive, 0.07, 0.2, 0, 0.04, 0.72, 0.045);
      cy(g, gun, 0.05, 0.08, 0, 0.04, -0.3, 0.07);
      bx(g, poly, 0.03, 0.1, 0.04, 0, -0.06, 0.1, 0.2);
      bx(g, poly, 0.03, 0.1, 0.04, 0, -0.06, 0.35, 0.1);
      muzzle.position.set(0, 0.04, 0.85);
      break;
    }
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.28),
    new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  );
  flash.position.copy(muzzle.position);
  flash.position.z += 0.1;
  flash.rotation.y = Math.PI / 2;
  g.add(flash);
  return { group: g, muzzle, flash };
}
