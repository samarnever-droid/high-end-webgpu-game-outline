import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/game';
import { useHud, emitHud, hud } from '../game/store';
import { STATIONS } from '../game/audio';
import { fmtMoney } from '../game/util';
import { HookHud } from './hook';

const font = { fontFamily: '"Arial Black", Impact, "Segoe UI", sans-serif' };
const shadow = { textShadow: '0 2px 0 rgba(0,0,0,.9), 0 0 12px rgba(0,0,0,.6)' };

const PORTRAIT: Record<string, string> = {
  Dev: '#b88a2a', Jimmy: '#2d5fa8', Meera: '#7b4aa6', Raghav: '#c9c4bb', Kaalu: '#444', Veer: '#e8a33d', Kaalu_: '#333',
};

export function Loading({ msg, pct }: { msg: string; pct: number }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black text-white">
      <div className="absolute inset-0 opacity-40" style={{ background: 'radial-gradient(circle at 50% 60%, #ff2fa0 0%, transparent 45%), radial-gradient(circle at 20% 20%, #2fd6ff 0%, transparent 40%)' }} />
      <div className="relative text-center">
        <div className="text-6xl tracking-tight" style={{ ...font, ...shadow, letterSpacing: '-2px' }}>NEON <span className="text-fuchsia-400">NAGRI</span></div>
        <div className="mt-1 text-sm tracking-[0.5em] text-cyan-300">RELOADED</div>
        <div className="mx-auto mt-10 h-1.5 w-96 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-400 transition-all duration-300" style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
        <div className="mt-3 text-xs uppercase tracking-widest text-white/60">{msg}</div>
      </div>
    </div>
  );
}

export function MainMenu({ game }: { game: Game }) {
  const h = useHud();
  const hasSave = typeof localStorage !== 'undefined' && !!localStorage.getItem('neon-nagri-v2');
  return (
    <div className="absolute inset-0 z-40 flex items-stretch text-white" style={{ background: 'linear-gradient(90deg, rgba(5,5,14,.92) 0%, rgba(5,5,14,.55) 45%, rgba(5,5,14,0) 75%)' }}>
      <div className="flex w-[520px] flex-col justify-center px-16">
        <div className="text-7xl leading-none" style={{ ...font, ...shadow, letterSpacing: '-3px' }}>NEON<br /><span className="bg-gradient-to-r from-fuchsia-400 to-cyan-300 bg-clip-text text-transparent">NAGRI</span></div>
        <div className="mt-2 text-sm tracking-[0.55em] text-cyan-300">RELOADED</div>
        <p className="mt-6 max-w-sm text-sm leading-relaxed text-white/70">Chain combos, dodge and parry to build your Style meter and bank cash. Live street events, rotating challenges and Street Rep perks — there is always one more thing. Walk into shops, work for Dev, take down Raghav&apos;s empire.</p>
        <button
          className="mt-8 w-64 rounded-md bg-gradient-to-r from-fuchsia-500 to-cyan-500 px-6 py-3 text-left text-lg tracking-wide shadow-lg shadow-fuchsia-900/40 transition hover:scale-[1.03]"
          style={font}
          onClick={() => game.startGame()}
        >
          {hasSave ? 'CONTINUE' : 'START STORY'} ▸
        </button>
        {hasSave && <button className="mt-3 w-64 rounded-md border border-white/20 px-6 py-2 text-left text-sm text-white/70 hover:bg-white/10" onClick={() => game.resetSave()}>New game (erase save)</button>}
        <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-white/60">
          <Key k="WASD" t="Move / Drive" /><Key k="Shift" t="Sprint / Nitro" /><Key k="Mouse" t="Look" /><Key k="RMB / LMB" t="Aim / Shoot" />
          <Key k="E / F" t="Interact / Enter car" /><Key k="Space" t="Jump / Handbrake" /><Key k="1-7" t="Weapons" /><Key k="R" t="Reload / Radio" />
          <Key k="C" t="Crouch / Look back" /><Key k="H" t="Horn" /><Key k="M" t="Map" /><Key k="T" t="Phone" />
          <Key k="LMB ×3" t="Combo + finisher" /><Key k="RMB (melee)" t="Block · parry" /><Key k="Q" t="Dodge roll (i-frames)" /><Key k="Doors" t="Walk into shops [E]" />
        </div>
        <div className="mt-6 text-[11px] text-white/40">{h.fps} fps · click the game to capture the mouse · best on desktop with a GPU</div>
      </div>
    </div>
  );
}
const Key = ({ k, t }: { k: string; t: string }) => (
  <div className="flex items-center gap-2"><span className="min-w-[70px] rounded bg-white/10 px-2 py-0.5 text-center text-[10px] font-bold text-white">{k}</span><span>{t}</span></div>
);

function Stars({ n, evading }: { n: number; evading: boolean }) {
  return (
    <div className="flex gap-1" style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.9))' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`text-3xl ${i < n ? (evading ? 'animate-pulse text-white/80' : 'text-yellow-300') : 'text-white/15'}`}>★</span>
      ))}
    </div>
  );
}

function Minimap({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { game.miniCanvas = ref.current; return () => { game.miniCanvas = null; }; }, [game]);
  return <canvas ref={ref} width={240} height={240} className="h-[190px] w-[190px] rounded-full border-4 border-black/70 bg-black/50 shadow-xl" style={{ boxShadow: '0 0 0 2px rgba(255,255,255,.25), 0 8px 24px rgba(0,0,0,.6)' }} />;
}

function Bar({ v, color, w = 190 }: { v: number; color: string; w?: number }) {
  return <div className="h-2.5 overflow-hidden rounded-sm border border-black/70 bg-black/60" style={{ width: w }}><div className="h-full transition-all" style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: color }} /></div>;
}

export function Hud({ game }: { game: Game }) {
  const h = useHud();
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 500); return () => clearInterval(t); }, []);
  const w = h.weapon;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none text-white" style={font}>
      {/* damage vignette */}
      <div className="absolute inset-0 transition-opacity" style={{ opacity: Math.min(1, h.damage * 0.9 + (h.hp < 30 ? 0.35 : 0)), background: 'radial-gradient(ellipse at center, transparent 40%, rgba(180,0,0,.7) 100%)' }} />
      {/* letterbox */}
      <div className={`absolute left-0 right-0 top-0 bg-black transition-all duration-700 ${h.cinematic ? 'h-24' : 'h-0'}`} />
      <div className={`absolute bottom-0 left-0 right-0 bg-black transition-all duration-700 ${h.cinematic ? 'h-24' : 'h-0'}`} />

      {/* bottom-left: minimap + bars */}
      <div className="absolute bottom-6 left-6 flex items-end gap-3">
        <Minimap game={game} />
        <div className="mb-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs"><span className="w-4 text-red-400">♥</span><Bar v={h.hp} color="linear-gradient(90deg,#d02020,#ff5a4a)" /></div>
          <div className="flex items-center gap-2 text-xs"><span className="w-4 text-sky-300">◈</span><Bar v={h.armor} color="linear-gradient(90deg,#2a7ad0,#6ac8ff)" /></div>
          {h.inCar && <div className="flex items-center gap-2 text-xs"><span className="w-4 text-orange-300">⚙</span><Bar v={h.carHealth * 100} color="linear-gradient(90deg,#d08a20,#ffd060)" /></div>}
          {h.inCar && <div className="flex items-center gap-2 text-xs"><span className="w-4 text-cyan-300">⚡</span><Bar v={h.nitro * 100} color="linear-gradient(90deg,#20b0d0,#a0f0ff)" /></div>}
        </div>
      </div>

      {/* top-right: money, wanted, time */}
      <div className="absolute right-6 top-5 flex flex-col items-end gap-1">
        <div className="text-4xl text-emerald-300" style={shadow}>{fmtMoney(h.cash)}</div>
        <Stars n={h.wanted} evading={h.evading} />
        {h.wanted > 0 && h.evading && <div className="text-[11px] tracking-widest text-yellow-200">EVADING…</div>}
        <div className="text-xs tracking-widest text-white/80" style={shadow}>{h.clock} · {h.weather === 'rain' ? '🌧' : '☀'} </div>
        {h.arrest > 0.02 && <div className="mt-1 w-40"><div className="text-[10px] tracking-widest text-sky-300">BEING ARRESTED</div><Bar v={h.arrest * 100} color="#4a8aff" w={160} /></div>}
      </div>

      {/* weapon / speed */}
      <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2">
        {h.inCar ? (
          <div className="rounded-lg bg-black/55 px-5 py-3 text-right backdrop-blur-sm">
            <div className="text-[10px] tracking-widest text-white/60">{h.carName.toUpperCase()}</div>
            <div className="flex items-end justify-end gap-2"><span className="text-6xl leading-none" style={shadow}>{h.speed}</span><span className="pb-1 text-sm text-white/70">km/h</span></div>
            <div className="mt-1 flex items-center justify-end gap-3 text-xs text-white/70"><span>GEAR {h.gear}</span><span>📻 {h.radio}</span></div>
          </div>
        ) : (
          <div className="rounded-lg bg-black/55 px-5 py-3 text-right backdrop-blur-sm">
            <div className="text-xs tracking-widest text-white/70">{w.icon} {w.name.toUpperCase()}</div>
            {!w.infinite && <div className="text-3xl" style={shadow}>{w.reloading ? 'RELOADING' : `${w.mag}`}<span className="text-lg text-white/50"> / {w.reserve}</span></div>}
          </div>
        )}
      </div>

      {/* objective */}
      {h.objective && (
        <div className="absolute left-1/2 top-5 max-w-xl -translate-x-1/2 text-center">
          {h.missionTitle && <div className="text-[11px] tracking-[0.4em] text-fuchsia-300">{h.missionTitle.toUpperCase()}</div>}
          <div className="mt-1 rounded bg-black/55 px-4 py-1.5 text-base text-yellow-200 backdrop-blur-sm" style={shadow}>{h.objective}{h.objDist !== null && <span className="ml-2 text-sm text-white/70">{h.objDist} m</span>}</div>
          {h.timer && <div className={`mt-1 text-2xl ${h.timer.t < 15 ? 'animate-pulse text-red-400' : 'text-white'}`} style={shadow}>{h.timer.label}: {Math.max(0, Math.ceil(h.timer.t))}s</div>}
          {h.lost !== null && <div className="mx-auto mt-1 w-56"><div className="text-[10px] tracking-widest text-red-300">LOSING TARGET</div><Bar v={h.lost * 100} color="#ff4040" w={224} /></div>}
        </div>
      )}
      {h.hint && !h.objective && <div className="absolute left-1/2 top-5 -translate-x-1/2 rounded bg-black/55 px-4 py-1.5 text-sm text-white/90">{h.hint}</div>}

      <HookHud />

      {/* crosshair */}
      {h.aiming && !h.inCar && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ transform: `translate(calc(-50% + 0px), -50%)` }}>
          <div className="relative h-8 w-8">
            <div className="absolute left-1/2 top-0 h-2.5 w-0.5 -translate-x-1/2 bg-white shadow" /><div className="absolute bottom-0 left-1/2 h-2.5 w-0.5 -translate-x-1/2 bg-white shadow" />
            <div className="absolute left-0 top-1/2 h-0.5 w-2.5 -translate-y-1/2 bg-white shadow" /><div className="absolute right-0 top-1/2 h-0.5 w-2.5 -translate-y-1/2 bg-white shadow" />
            <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" />
            {h.hitMarker > 0.05 && <div className="absolute inset-0 rotate-45 border-2 border-red-500" style={{ opacity: h.hitMarker }} />}
          </div>
        </div>
      )}
      {!h.aiming && !h.inCar && h.weapon.cls !== 'none' && h.weapon.cls !== 'melee' && <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />}

      {/* prompt */}
      {h.prompt && !h.dialogue && !h.shop && (
        <div className="absolute bottom-[26%] left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-4 py-2 text-base backdrop-blur-sm">
          <span className="mr-2 rounded bg-white px-2 py-0.5 text-black">E</span>{h.prompt}
        </div>
      )}

      {/* subtitle */}
      {h.subtitle && (
        <div className="absolute bottom-20 left-1/2 max-w-3xl -translate-x-1/2 text-center text-xl leading-snug" style={shadow}>
          <span style={{ color: PORTRAIT[h.subtitle.who] ?? '#fff' }}>{h.subtitle.who}: </span>{h.subtitle.text}
        </div>
      )}

      {/* dialogue */}
      {h.dialogue && <Dialogue game={game} />}

      {/* toasts */}
      <div className="absolute right-6 top-40 flex w-72 flex-col items-end gap-2">
        {h.toasts.map((t) => (
          <div key={t.id} className={`rounded-md border-l-4 bg-black/65 px-3 py-2 text-right backdrop-blur-sm ${t.kind === 'bad' ? 'border-red-500' : t.kind === 'good' ? 'border-emerald-400' : t.kind === 'cash' ? 'border-emerald-300' : t.kind === 'mission' ? 'border-fuchsia-400' : 'border-cyan-400'}`}>
            <div className={`text-sm ${t.kind === 'cash' ? 'text-emerald-300' : ''}`}>{t.title}</div>
            {t.text && <div className="text-[11px] text-white/70" style={{ fontFamily: 'system-ui' }}>{t.text}</div>}
          </div>
        ))}
      </div>

      {/* fade */}
      <div className={`absolute inset-0 bg-black transition-opacity duration-700 ${h.fade ? 'opacity-100' : 'opacity-0'}`} />

      {/* overlays */}
      {h.overlay === 'wasted' && <Banner text="WASTED" color="#c01818" sub="" />}
      {h.overlay === 'busted' && <Banner text="BUSTED" color="#3a6ad0" sub="" />}
      {h.overlay === 'passed' && <Banner text="MISSION PASSED" color="#f0c040" sub={h.overlayText} />}
      {h.overlay === 'failed' && <Banner text="MISSION FAILED" color="#d03030" sub={h.overlayText} />}
      {h.overlay === 'ending' && <Banner text="NEON NAGRI IS YOURS" color="#ff4fd8" sub="Story complete — free roam is open. Thanks for playing." />}

      {!h.locked && h.phase === 'playing' && !h.fullMap && !h.phone && !h.shop && !h.overlay && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <div className="rounded-lg bg-black/70 px-6 py-3 text-lg">Click to capture the mouse</div>
        </div>
      )}
      <div className="absolute left-2 top-2 text-[10px] text-white/30">{h.fps} fps</div>
    </div>
  );
}

function Banner({ text, color, sub }: { text: string; color: string; sub: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,.35), rgba(0,0,0,.7))' }}>
      <div className="animate-pulse text-8xl tracking-tight" style={{ ...font, color, textShadow: '0 4px 0 rgba(0,0,0,.8), 0 0 40px ' + color }}>{text}</div>
      {sub && <div className="mt-3 max-w-xl text-center text-xl text-white" style={shadow}>{sub}</div>}
    </div>
  );
}

function Dialogue({ game }: { game: Game }) {
  const h = useHud();
  const d = h.dialogue!;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const t = setInterval(() => setShown((s) => s + 2), 22);
    return () => clearInterval(t);
  }, [d.id]);
  const col = PORTRAIT[d.who] ?? '#888';
  return (
    <div className="pointer-events-auto absolute bottom-10 left-1/2 w-[760px] -translate-x-1/2" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div className="flex items-stretch gap-4 rounded-xl border border-white/15 bg-black/75 p-4 backdrop-blur-md">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-2 text-3xl font-black" style={{ borderColor: col, background: `radial-gradient(circle at 30% 30%, ${col}, #111)`, color: '#fff', ...font }}>{d.who[0]}</div>
        <div className="flex-1">
          <div className="text-sm font-black tracking-widest" style={{ color: col, ...font }}>{d.who.toUpperCase()}</div>
          <div className="mt-1 min-h-[3rem] text-lg leading-snug text-white">{d.text.slice(0, shown)}</div>
          {d.choices ? (
            <div className="mt-3 flex flex-col gap-1.5">
              {d.choices.map((c) => (
                <button key={c.id} onClick={() => game.chooseDialogue(c.id)} className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-left text-sm text-white hover:bg-fuchsia-500/30"><span className="mr-2 text-fuchsia-300">{c.id + 1}</span>{c.label}</button>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-right text-[11px] text-white/50">[E] / click to continue</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PauseMenu({ game }: { game: Game }) {
  const h = useHud();
  const s = h.settings;
  const set = (p: Partial<typeof s>) => { Object.assign(hud.settings, p); game.audio.setVolume(hud.settings.volume, hud.settings.music); game.renderer.shadowMap.enabled = hud.settings.shadows; game.sky.sun.castShadow = hud.settings.shadows; emitHud(); };
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 text-white backdrop-blur-sm" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div className="w-[480px] rounded-2xl border border-white/10 bg-zinc-950/90 p-8">
        <div className="text-3xl" style={font}>PAUSED</div>
        <div className="mt-6 max-h-[60vh] space-y-3 overflow-y-auto pr-2 text-sm">
          <Slider label="Master volume" v={s.volume} on={(v) => set({ volume: v })} />
          <Slider label="Radio volume" v={s.music} on={(v) => set({ music: v })} />
          <Slider label="Mouse sensitivity" v={s.sens / 2} on={(v) => set({ sens: v * 2 })} />
          <Slider label="Time speed" v={s.timeScale / 4} on={(v) => set({ timeScale: Math.max(0.1, v * 4) })} />
          <Toggle label="Shadows" v={s.shadows} on={(v) => set({ shadows: v })} />
          <Toggle label="Bloom & post-processing" v={s.bloom} on={(v) => set({ bloom: v })} />
          <Toggle label="Ambient occlusion (SSAO)" v={s.ao} on={(v) => set({ ao: v })} />
          <Toggle label="Wet-road reflections (SSR)" v={s.reflections} on={(v) => set({ reflections: v })} />
          <Toggle label="God rays & lens flare" v={s.rays} on={(v) => set({ rays: v })} />
          <Toggle label="Volumetric fog" v={s.volumetrics} on={(v) => set({ volumetrics: v })} />
          <Toggle label="Dynamic weather" v={s.autoWeather} on={(v) => set({ autoWeather: v })} />
          <Toggle label="Ultra quality (AO + SSR)" v={s.quality === 'high'} on={(v) => set({ quality: v ? 'high' : 'low' })} />
        </div>
        <div className="mt-8 flex gap-3">
          <button className="flex-1 rounded-md bg-gradient-to-r from-fuchsia-500 to-cyan-500 py-2.5 font-bold" onClick={() => game.togglePause()}>Resume</button>
          <button className="rounded-md border border-white/20 px-4 py-2.5" onClick={() => { game.saveGame(); game.toast('Saved', 'Progress saved', 'good'); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
const Slider = ({ label, v, on }: { label: string; v: number; on: (v: number) => void }) => (
  <label className="flex items-center justify-between gap-4"><span className="text-white/80">{label}</span><input type="range" min={0} max={1} step={0.01} value={v} onChange={(e) => on(+e.target.value)} className="w-56 accent-fuchsia-500" /></label>
);
const Toggle = ({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) => (
  <label className="flex items-center justify-between"><span className="text-white/80">{label}</span><button onClick={() => on(!v)} className={`h-6 w-12 rounded-full transition ${v ? 'bg-fuchsia-500' : 'bg-white/20'}`}><span className={`block h-5 w-5 rounded-full bg-white transition ${v ? 'translate-x-6' : 'translate-x-0.5'}`} /></button></label>
);

export function ShopMenu({ game }: { game: Game }) {
  const h = useHud();
  const s = h.shop!;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 text-white backdrop-blur-sm" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div className="max-h-[80vh] w-[560px] overflow-auto rounded-2xl border border-white/10 bg-zinc-950/95 p-6">
        <div className="flex items-end justify-between"><div><div className="text-2xl" style={font}>{s.title.toUpperCase()}</div><div className="text-xs text-white/50">{s.sub}</div></div><div className="text-2xl text-emerald-300" style={font}>{fmtMoney(h.cash)}</div></div>
        <div className="mt-4 space-y-2">
          {s.items.map((it) => (
            <button key={it.id} onClick={() => game.buy(it.id)} className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-left transition hover:border-fuchsia-400/60 hover:bg-fuchsia-500/10">
              <div className="flex items-center gap-3">
                {it.tag?.startsWith('#') && <span className="h-5 w-5 rounded-full border border-white/40" style={{ background: it.tag }} />}
                <div><div className="text-sm font-semibold">{it.label}{it.tag && !it.tag.startsWith('#') && <span className="ml-2 rounded bg-fuchsia-500/30 px-1.5 text-[10px] text-fuchsia-200">{it.tag}</span>}</div><div className="text-xs text-white/50">{it.desc}</div></div>
              </div>
              <div className="text-sm text-emerald-300">{it.price ? fmtMoney(it.price) : 'FREE'}</div>
            </button>
          ))}
        </div>
        <button className="mt-4 w-full rounded-md border border-white/20 py-2" onClick={() => game.closeShop()}>Leave</button>
      </div>
    </div>
  );
}

export function FullMap({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { game.bigCanvas = ref.current; return () => { game.bigCanvas = null; }; }, [game]);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 text-white" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div className="relative">
        <canvas ref={ref} width={820} height={820} className="rounded-xl border border-white/20 bg-black" />
        <div className="absolute right-3 top-3 space-y-1 rounded bg-black/70 p-3 text-xs">
          <div><span className="mr-2 text-[#ffb02a]">●</span>Shops</div><div><span className="mr-2 text-[#ff4fd8]">●</span>Story</div><div><span className="mr-2 text-[#4ad0ff]">●</span>Safehouse</div><div><span className="mr-2 text-[#6aff9a]">●</span>Heist</div><div><span className="mr-2 text-[#ffd23a]">●</span>Objective</div><div><span className="mr-2 text-[#38d6ff]">▬</span>GPS route</div>
        </div>
        <div className="absolute bottom-3 left-3 rounded bg-black/70 px-3 py-1 text-xs">Press M to close</div>
      </div>
    </div>
  );
}

export function Phone({ game }: { game: Game }) {
  const h = useHud();
  const [tab, setTab] = useState(0);
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 text-white" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div className="h-[600px] w-[320px] overflow-hidden rounded-[36px] border-[6px] border-zinc-800 bg-gradient-to-b from-zinc-900 to-black shadow-2xl">
        <div className="flex justify-between px-6 pt-3 text-[11px] text-white/70"><span>{h.clock}</span><span>Neon Net ▮▮▮</span></div>
        <div className="mt-2 flex gap-1 px-3 text-xs">
          {['Missions', 'Weather', 'Radio'].map((t, i) => <button key={t} onClick={() => setTab(i)} className={`flex-1 rounded-full py-1.5 ${tab === i ? 'bg-fuchsia-500' : 'bg-white/10'}`}>{t}</button>)}
        </div>
        <div className="mt-3 max-h-[480px] space-y-2 overflow-auto px-3 pb-4">
          {tab === 0 && h.missions.map((m) => (
            <div key={m.id} className={`rounded-xl border px-3 py-2 ${m.active ? 'border-yellow-300/60 bg-yellow-300/10' : 'border-white/10 bg-white/5'}`}>
              <div className="flex items-center justify-between text-sm font-semibold"><span>{m.id + 1}. {m.title}</span><span>{m.done ? '✔' : m.active ? '▶' : ''}</span></div>
            </div>
          ))}
          {tab === 0 && <div className="pt-2 text-center text-[11px] text-white/40">Jobs start automatically — follow the objective.</div>}
          {tab === 1 && (
            <div className="space-y-3 text-sm">
              <div className="flex gap-2"><button className="flex-1 rounded-lg bg-white/10 py-3" onClick={() => { game.sky.setRain(0); emitHud(); }}>☀ Clear</button><button className="flex-1 rounded-lg bg-white/10 py-3" onClick={() => { game.sky.setRain(1); emitHud(); }}>🌧 Rain</button></div>
              <div className="grid grid-cols-4 gap-2">{[['Dawn', 6], ['Noon', 12], ['Dusk', 18.2], ['Night', 23]].map(([n, t]) => <button key={n as string} className="rounded-lg bg-white/10 py-2 text-xs" onClick={() => { game.sky.hour = t as number; emitHud(); }}>{n}</button>)}</div>
            </div>
          )}
          {tab === 2 && STATIONS.map((s, i) => <button key={s} onClick={() => { game.audio.init(); game.audio.setStation(i); hud.radio = STATIONS[i]; emitHud(); }} className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${h.radio === s ? 'border-fuchsia-400 bg-fuchsia-500/20' : 'border-white/10 bg-white/5'}`}>📻 {s}</button>)}
        </div>
        <div className="py-1 text-center text-[11px] text-white/40">Press T to close</div>
      </div>
    </div>
  );
}
