import { useSyncExternalStore } from 'react';

export interface Choice { id: number; label: string }
export interface ShopItem { id: string; label: string; desc: string; price: number; disabled?: boolean; tag?: string }
export interface Toast { id: number; title: string; text: string; kind: 'info' | 'good' | 'bad' | 'mission' | 'cash'; t: number }

export interface HudState {
  phase: 'loading' | 'menu' | 'playing' | 'paused';
  loadMsg: string; loadPct: number;
  hp: number; armor: number; cash: number; wanted: number; evading: boolean; arrest: number;
  weapon: { id: string; name: string; icon: string; mag: number; reserve: number; cls: string; reloading: boolean; infinite: boolean };
  speed: number; gear: number; inCar: boolean; carName: string; carHealth: number; nitro: number; boosting: boolean;
  objective: string | null; objDist: number | null; missionTitle: string | null; timer: { t: number; label: string } | null; lost: number | null;
  subtitle: { who: string; text: string } | null;
  dialogue: { who: string; text: string; choices: Choice[] | null; role: string; id: number } | null;
  prompt: string | null;
  toasts: Toast[];
  clock: string; radio: string; weather: 'clear' | 'rain';
  fullMap: boolean; phone: boolean; shop: { id: string; title: string; sub: string; items: ShopItem[] } | null;
  overlay: null | 'wasted' | 'busted' | 'passed' | 'failed' | 'ending'; overlayText: string;
  fade: boolean; cinematic: boolean; aiming: boolean; hitMarker: number; damage: number; locked: boolean;
  settings: { volume: number; music: number; shadows: boolean; bloom: boolean; ao: boolean; reflections: boolean; rays: boolean; volumetrics: boolean; autoWeather: boolean; sens: number; timeScale: number; quality: 'low' | 'high' };
  missions: { id: number; title: string; done: boolean; active: boolean }[];
  hint: string | null;
  fps: number;
  style: { rank: string; mult: number; pct: number; bank: number; label: string; labelId: number; active: boolean; chainT: number };
  rep: { level: number; xp: number; need: number };
  challenges: { id: number; text: string; prog: number; goal: number; done: boolean; cash: number }[];
  event: { title: string; text: string; t: number | null } | null;
  floaters: { id: number; x: number; y: number; text: string; kind: 'dmg' | 'crit' | 'info' | 'warn' | 'good' }[];
  onTarget: boolean; blocking: boolean; dodgeCd: number; combo: number;
  stats: { kills: number; distance: number; missions: number };
}

export const hud: HudState = {
  phase: 'loading', loadMsg: 'Booting engine…', loadPct: 0,
  hp: 100, armor: 0, cash: 0, wanted: 0, evading: false, arrest: 0,
  weapon: { id: 'fists', name: 'Fists', icon: '✊', mag: 0, reserve: 0, cls: 'none', reloading: false, infinite: true },
  speed: 0, gear: 1, inCar: false, carName: '', carHealth: 1, nitro: 1, boosting: false,
  objective: null, objDist: null, missionTitle: null, timer: null, lost: null,
  subtitle: null, dialogue: null, prompt: null, toasts: [],
  clock: '12:00', radio: 'Radio Off', weather: 'clear',
  fullMap: false, phone: false, shop: null,
  overlay: null, overlayText: '', fade: false, cinematic: false, aiming: false, hitMarker: 0, damage: 0, locked: false,
  settings: { volume: 0.7, music: 0.6, shadows: true, bloom: true, ao: true, reflections: true, rays: true, volumetrics: true, autoWeather: true, sens: 1, timeScale: 1, quality: 'high' },
  missions: [], hint: null, fps: 60,
  style: { rank: 'D', mult: 1, pct: 0, bank: 0, label: '', labelId: 0, active: false, chainT: 0 },
  rep: { level: 1, xp: 0, need: 250 },
  challenges: [], event: null, floaters: [],
  onTarget: false, blocking: false, dodgeCd: 0, combo: 0,
  stats: { kills: 0, distance: 0, missions: 0 },
};

let snapshot: HudState = { ...hud };
const subs = new Set<() => void>();
export function emitHud() {
  snapshot = { ...hud };
  subs.forEach((f) => f());
}
export function useHud(): HudState {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => snapshot
  );
}
