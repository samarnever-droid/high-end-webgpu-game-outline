import { useEffect, useRef, useState } from 'react';
import { Game, type HudState } from './game/game';
import { MISSIONS } from './game/missions';

const WHO_COLOR: Record<string, string> = {
  Veer: '#ffd23a', Dev: '#ffa24a', Jimmy: '#58b0ff', Raghav: '#ff4d6d', Meera: '#ff8fd0', Kaalu: '#c0c0c0',
};

const INITIAL: HudState = {
  phase: 'loading', speed: 0, inCar: false, nitro: 1, mission: null, objective: null, distance: null,
  timer: null, timerLabel: '', cash: 0, subtitle: null, prompt: null, toast: null, lost: null, cp: null,
  muted: false, musicOn: true, fade: false, ended: false, fps: 60, res: 1, locked: false,
};

type Phase = 'loading' | 'menu' | 'playing' | 'nogpu' | 'error';

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [hud, setHud] = useState<HudState>(INITIAL);
  const [progress, setProgress] = useState('Shuru ho raha hai...');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!('gpu' in navigator)) {
      setPhase('nogpu');
      return;
    }
    let cancelled = false;
    const game = new Game(mountRef.current!, miniRef.current!, {
      onHud: (h) => {
        if (!cancelled) setHud(h);
      },
      onProgress: (t) => {
        if (!cancelled) setProgress(t);
      },
    });
    gameRef.current = game;
    game
      .init()
      .then(() => {
        if (!cancelled) setPhase('menu');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'NO_WEBGPU') setPhase('nogpu');
        else {
          setErr(msg);
          setPhase('error');
        }
      });
    return () => {
      cancelled = true;
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const start = () => {
    gameRef.current?.start();
    setPhase('playing');
  };

  const playing = phase === 'playing';

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white select-none" style={{ fontFamily: "'Rajdhani', 'Segoe UI', sans-serif" }}>
      <div ref={mountRef} className="absolute inset-0" />

      {/* ---------------- HUD ---------------- */}
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${playing ? 'opacity-100' : 'opacity-0'}`}>
        {/* minimap */}
        <div className="absolute bottom-5 left-5">
          <div className="relative h-[200px] w-[200px] rounded-full shadow-[0_0_30px_rgba(0,0,0,0.6)]">
            <canvas ref={miniRef} width={400} height={400} className="h-full w-full rounded-full" />
          </div>
          <div className="mt-2 flex items-center gap-3 pl-2 text-[11px] uppercase tracking-widest text-white/60">
            <span>{hud.muted ? 'M: sound off' : 'M: mute'}</span>
            <span>N: music {hud.musicOn ? 'on' : 'off'}</span>
          </div>
        </div>

        {/* cash */}
        <div className="absolute right-6 top-5 text-right">
          <div className="text-4xl font-bold tracking-wider text-[#8dff8a] drop-shadow-[0_2px_0_rgba(0,0,0,0.8)]" style={{ fontFamily: "'Bebas Neue', Impact, sans-serif" }}>
            ${hud.cash.toLocaleString('en-US')}
          </div>
          <div className="text-[11px] uppercase tracking-widest text-white/40">
            {hud.fps} fps · {Math.round(hud.res * 100)}% res · WebGPU
          </div>
        </div>

        {/* mission card */}
        {hud.mission && (
          <div className="absolute left-6 top-5 w-[360px] max-w-[42vw]">
            <div className="rounded-lg border-l-4 border-[#ffd23a] bg-black/55 px-4 py-3 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.25em] text-[#ffd23a]">
                {hud.mission.tag} · {hud.mission.n}/{hud.mission.total}
              </div>
              <div className="text-3xl leading-none" style={{ fontFamily: "'Bebas Neue', Impact, sans-serif" }}>
                {hud.mission.title}
              </div>
              {hud.objective && (
                <div className="mt-2 text-[15px] leading-snug text-white/90">
                  <span className="mr-1 text-[#ffd23a]">▶</span>
                  {hud.objective}
                </div>
              )}
              {hud.distance !== null && hud.objective && (
                <div className="mt-1 text-xs uppercase tracking-widest text-white/50">{hud.distance} m</div>
              )}
            </div>
          </div>
        )}

        {/* timer / checkpoints / lost meter */}
        <div className="absolute left-1/2 top-5 flex -translate-x-1/2 flex-col items-center gap-2">
          {hud.timer !== null && (
            <div className={`rounded-md bg-black/60 px-6 py-1 text-center backdrop-blur-sm ${hud.timer < 15 ? 'animate-pulse' : ''}`}>
              <div className="text-[10px] uppercase tracking-[0.3em] text-white/50">{hud.timerLabel}</div>
              <div className={`text-5xl leading-none ${hud.timer < 15 ? 'text-[#ff5050]' : 'text-white'}`} style={{ fontFamily: "'Bebas Neue', Impact, sans-serif" }}>
                {Math.floor(hud.timer / 60)}:{String(Math.floor(hud.timer % 60)).padStart(2, '0')}
              </div>
            </div>
          )}
          {hud.cp && (
            <div className="flex gap-1">
              {Array.from({ length: hud.cp.n }).map((_, i) => (
                <div key={i} className={`h-2 w-7 rounded-sm ${i < hud.cp!.i ? 'bg-[#ffd23a]' : 'bg-white/25'}`} />
              ))}
            </div>
          )}
          {hud.lost !== null && (
            <div className="w-72">
              <div className="mb-1 text-center text-[11px] uppercase tracking-[0.25em] text-white/70">
                {hud.lost > 0.05 ? 'Kaalu door ho raha hai!' : 'Kaalu ko dekhte raho'}
              </div>
              <div className="h-2 overflow-hidden rounded bg-white/20">
                <div className="h-full bg-gradient-to-r from-[#ffd23a] to-[#ff3b3b]" style={{ width: `${Math.min(100, hud.lost * 100)}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* speedo */}
        {hud.inCar && (
          <div className="absolute bottom-6 right-8 text-right">
            <div className="text-7xl leading-none drop-shadow-[0_3px_0_rgba(0,0,0,0.7)]" style={{ fontFamily: "'Bebas Neue', Impact, sans-serif" }}>
              {hud.speed}
              <span className="ml-1 text-xl text-white/60">km/h</span>
            </div>
            <div className="ml-auto mt-2 h-2 w-52 overflow-hidden rounded bg-white/20">
              <div className="h-full bg-gradient-to-r from-[#19e3ff] to-[#ff2e93]" style={{ width: `${hud.nitro * 100}%` }} />
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-white/50">Nitro · Shift</div>
          </div>
        )}

        {/* controls hint */}
        {!hud.inCar && (
          <div className="absolute bottom-6 right-8 text-right text-[11px] uppercase leading-5 tracking-widest text-white/45">
            WASD chalo · Shift daudo · Space kudo<br />Mouse camera · F gaadi · Enter skip
          </div>
        )}

        {/* prompt */}
        {hud.prompt && (
          <div className="absolute bottom-40 left-1/2 -translate-x-1/2 rounded-md bg-black/65 px-5 py-2 text-lg tracking-wider">
            <span className="mr-2 rounded bg-white px-2 py-0.5 text-sm font-bold text-black">F</span>
            {hud.prompt.replace('F — ', '')}
          </div>
        )}

        {/* subtitles */}
        {hud.subtitle && (
          <div className="absolute bottom-10 left-1/2 w-[min(820px,90vw)] -translate-x-1/2 text-center">
            <div className="inline-block rounded-lg bg-black/65 px-6 py-3 backdrop-blur-sm">
              <span className="mr-2 text-lg font-bold uppercase tracking-widest" style={{ color: WHO_COLOR[hud.subtitle.who] ?? '#fff' }}>
                {hud.subtitle.who}
              </span>
              <span className="text-xl text-white">{hud.subtitle.text}</span>
            </div>
          </div>
        )}

        {/* toast */}
        {hud.toast && hud.toast.kind !== 'flash' && (
          <div className="absolute left-1/2 top-[22%] -translate-x-1/2 text-center" key={hud.toast.title}>
            <div
              className={`text-7xl tracking-widest drop-shadow-[0_4px_0_rgba(0,0,0,0.75)] ${
                hud.toast.kind === 'pass' ? 'text-[#ffd23a]' : hud.toast.kind === 'fail' ? 'text-[#ff4d4d]' : 'text-white'
              }`}
              style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", animation: 'pop 0.5s ease-out' }}
            >
              {hud.toast.title}
            </div>
            <div className="mx-auto mt-2 max-w-xl rounded bg-black/55 px-4 py-1 text-lg text-white/90">{hud.toast.sub}</div>
          </div>
        )}
        {hud.toast && hud.toast.kind === 'flash' && (
          <div className="absolute left-1/2 top-[34%] -translate-x-1/2 rounded bg-black/60 px-5 py-1 text-2xl tracking-widest text-[#ffd23a]">
            {hud.toast.title}
          </div>
        )}

        {/* mouse hint */}
        {!hud.locked && playing && !hud.ended && (
          <div className="absolute left-1/2 top-3 -translate-x-1/2 text-[11px] uppercase tracking-[0.25em] text-white/40">
            Mouse look ke liye screen par click karo (ya Q / E)
          </div>
        )}

        {/* fail fade */}
        <div className={`absolute inset-0 bg-black transition-opacity duration-700 ${hud.fade ? 'opacity-70' : 'opacity-0'}`} />
      </div>

      {/* ---------------- ENDING ---------------- */}
      {hud.ended && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="max-w-2xl px-6 text-center">
            <div className="text-sm uppercase tracking-[0.5em] text-[#ffd23a]">Epilogue</div>
            <h2 className="mt-2 text-7xl" style={{ fontFamily: "'Bebas Neue', Impact, sans-serif" }}>
              Meera Safe Hai
            </h2>
            <p className="mt-4 text-xl leading-relaxed text-white/85">
              Veer ne behen ko Raghav ke chungal se chhuda liya. Speedboat samandar me gum ho gayi, par Neon Nagri ki
              roshni ab pehle se zyada saaf lag rahi hai. Raghav Sethi wapas aayega — lekin tab tak ye shehar Veer ka hai.
            </p>
            <div className="mt-4 text-2xl text-[#8dff8a]">Total kamai: ${hud.cash.toLocaleString('en-US')}</div>
            <button
              onClick={() => {
                gameRef.current?.continueFree();
              }}
              className="pointer-events-auto mt-8 rounded-full bg-gradient-to-r from-[#ff2e93] to-[#ffa31a] px-10 py-3 text-xl font-bold uppercase tracking-widest text-black transition hover:scale-105"
            >
              Free Roam
            </button>
          </div>
        </div>
      )}

      {/* ---------------- LOADING ---------------- */}
      {phase === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#07040c]">
          <div className="text-6xl tracking-[0.15em]" style={{ fontFamily: "'Bebas Neue', Impact, sans-serif" }}>
            <span className="bg-gradient-to-r from-[#ff2e93] to-[#ffa31a] bg-clip-text text-transparent">APHAR DEKJO</span>
          </div>
          <div className="mt-6 h-1 w-64 overflow-hidden rounded bg-white/10">
            <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] bg-gradient-to-r from-[#ff2e93] to-[#ffa31a]" />
          </div>
          <div className="mt-4 text-sm uppercase tracking-[0.3em] text-white/60">{progress}</div>
        </div>
      )}

      {/* ---------------- WEBGPU ONLY ---------------- */}
      {(phase === 'nogpu' || phase === 'error') && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#07040c] px-6 text-center">
          <div className="max-w-xl">
            <div className="text-6xl" style={{ fontFamily: "'Bebas Neue', Impact, sans-serif" }}>
              <span className="bg-gradient-to-r from-[#ff2e93] to-[#ffa31a] bg-clip-text text-transparent">APHAR DEKJO</span>
            </div>
            <h2 className="mt-6 text-2xl font-bold text-[#ff6b6b]">
              {phase === 'nogpu' ? 'WebGPU available nahi hai' : 'Game start nahi ho paya'}
            </h2>
            <p className="mt-3 text-lg text-white/75">
              {phase === 'nogpu'
                ? 'Ye game sirf WebGPU par chalta hai (high-end graphics ke liye). Chrome / Edge 113+ ya Safari 18+ latest version use karo, aur hardware acceleration ON rakho.'
                : err}
            </p>
            <button onClick={() => window.location.reload()} className="mt-8 rounded-full border border-white/30 px-8 py-2 uppercase tracking-widest hover:bg-white/10">
              Dobara try karo
            </button>
          </div>
        </div>
      )}

      {/* ---------------- MENU ---------------- */}
      {phase === 'menu' && (
        <div className="absolute inset-0 overflow-y-auto bg-gradient-to-r from-black/85 via-black/55 to-transparent">
          <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center gap-8 px-8 py-10 lg:flex-row lg:items-center">
            <div className="flex-1">
              <div className="text-xs uppercase tracking-[0.5em] text-[#ffa31a]">Ek shehar · Ek bhai · Ek behen ki talaash</div>
              <h1 className="mt-2 text-[clamp(64px,11vw,150px)] leading-[0.9]" style={{ fontFamily: "'Bebas Neue', Impact, sans-serif" }}>
                <span className="bg-gradient-to-br from-[#ff5fb0] via-[#ff2e93] to-[#ffa31a] bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(255,46,147,0.45)]">
                  APHAR<br />DEKJO
                </span>
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/85">
                <b className="text-[#ffd23a]">Prologue —</b> Veer Rathore teen saal baad Neon Nagri lautta hai. Subah uski choti behen
                Meera gayab ho gayi. Ek anjaan call: <i>"Aphar ho chuka hai. Dekhte hain tu kya karta hai."</i> — Raghav Sethi.
                Ab Veer ke paas ek gaadi, ek dost aur ek shehar hai.
              </p>
              <button
                onClick={start}
                className="mt-8 rounded-full bg-gradient-to-r from-[#ff2e93] to-[#ffa31a] px-12 py-4 text-2xl font-bold uppercase tracking-[0.2em] text-black shadow-[0_0_40px_rgba(255,46,147,0.5)] transition hover:scale-105"
              >
                Khel Shuru Karo
              </button>
              <div className="mt-4 text-xs uppercase tracking-[0.25em] text-white/45">Headphones lagao · Fullscreen (F11) best hai</div>
            </div>

            <div className="w-full max-w-md space-y-4 lg:w-[420px]">
              <div className="rounded-xl border border-white/10 bg-black/55 p-5 backdrop-blur-md">
                <div className="mb-3 text-xs uppercase tracking-[0.35em] text-[#ffd23a]">Story · 5 missions</div>
                <ol className="space-y-3">
                  {MISSIONS.map((m) => (
                    <li key={m.id} className="flex gap-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-[#ffd23a]">
                        {m.id}
                      </div>
                      <div>
                        <div className="text-lg leading-tight" style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", letterSpacing: '0.06em' }}>
                          {m.title}
                        </div>
                        <div className="text-sm leading-snug text-white/65">{m.blurb}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/55 p-5 backdrop-blur-md">
                <div className="mb-3 text-xs uppercase tracking-[0.35em] text-[#ffd23a]">Controls</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  {[
                    ['W A S D / Arrows', 'Chalo · Gaadi chalao'],
                    ['Shift', 'Daudo · Nitro'],
                    ['Space', 'Kudo · Handbrake'],
                    ['F', 'Gaadi me baitho / utro'],
                    ['Mouse / Q E', 'Camera'],
                    ['H', 'Horn'],
                    ['R', 'Gaadi reset'],
                    ['M / N', 'Mute / Music'],
                  ].map(([k, v]) => (
                    <div key={k} className="contents">
                      <div className="font-bold text-white">{k}</div>
                      <div className="text-white/60">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
