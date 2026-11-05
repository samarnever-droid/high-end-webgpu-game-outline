import { useHud } from '../game/store';
import { fmtMoney } from '../game/util';

const font = { fontFamily: '"Arial Black", Impact, "Segoe UI", sans-serif' };
const shadow = { textShadow: '0 2px 0 rgba(0,0,0,.9), 0 0 12px rgba(0,0,0,.6)' };
const RANK_COL: Record<string, string> = { D: '#9aa4b2', C: '#7ad0ff', B: '#6affb0', A: '#ffd23a', S: '#ff4fd8' };
const KIND_COL: Record<string, string> = { dmg: '#ffffff', crit: '#ffd23a', info: '#9ad8ff', warn: '#ff4a4a', good: '#6affb0' };

/** style meter, rep/level, challenges, street event banner, floating combat text */
export function HookHud() {
  const h = useHud();
  const s = h.style;
  const col = RANK_COL[s.rank] ?? '#fff';
  return (
    <>
      {/* floating damage / feedback */}
      {h.floaters.map((f) => (
        <div key={f.id} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${f.x}%`, top: `${f.y}%`, color: KIND_COL[f.kind], fontSize: f.kind === 'crit' || f.kind === 'good' ? 24 : f.kind === 'warn' ? 34 : 18, animation: 'floatUp .95s ease-out forwards', ...shadow }}>
          {f.text}
        </div>
      ))}

      {/* on-target ring */}
      {h.onTarget && !h.inCar && <div className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-500" style={{ boxShadow: '0 0 10px rgba(255,40,40,.7)' }} />}

      {/* top-left: rep + challenges */}
      <div className="absolute left-6 top-5 w-64">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-fuchsia-600 text-lg" style={shadow}>{h.rep.level}</div>
          <div className="flex-1">
            <div className="text-[10px] tracking-[0.3em] text-fuchsia-200">STREET REP</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/60"><div className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-300 transition-all" style={{ width: `${Math.min(100, (h.rep.xp / h.rep.need) * 100)}%` }} /></div>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          {h.challenges.map((c) => (
            <div key={c.id} className={`rounded bg-black/45 px-2 py-1 backdrop-blur-sm ${c.done ? 'opacity-70' : ''}`} style={{ fontFamily: 'system-ui', borderLeft: `3px solid ${c.done ? '#6affb0' : '#e879f9'}` }}>
              <div className="flex justify-between text-[11px] leading-tight text-white/90"><span>{c.done ? '✔ ' : ''}{c.text}</span><span className="ml-2 text-emerald-300">{fmtMoney(c.cash)}</span></div>
              <div className="mt-1 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-fuchsia-400" style={{ width: `${(c.prog / c.goal) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>

      {/* style meter (left-middle) */}
      {s.active && (
        <div className="absolute left-6 top-[42%] w-56" style={{ animation: 'fadeIn .2s ease-out' }}>
          <div className="flex items-end gap-3">
            <div className="text-7xl leading-none" style={{ color: col, textShadow: `0 0 24px ${col}99, 0 3px 0 rgba(0,0,0,.9)` }}>{s.rank}</div>
            <div className="pb-1">
              <div className="text-2xl" style={{ ...shadow, color: col }}>x{s.mult}</div>
              <div className="text-xs text-emerald-300" style={shadow}>BANK {fmtMoney(Math.round(s.bank * 0.45))}</div>
            </div>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-sm border border-black/70 bg-black/60"><div className="h-full transition-all" style={{ width: `${s.pct}%`, background: `linear-gradient(90deg, ${col}, #fff)`, opacity: s.chainT > 0 ? 1 : 0.6 }} /></div>
          <div className="mt-0.5 text-[10px] tracking-widest text-white/50">{s.chainT > 0 ? 'KEEP IT GOING — DON\'T GET HIT' : 'COOLING DOWN…'}</div>
          {s.label && <div key={s.labelId} className="mt-1 text-lg" style={{ color: '#fff', animation: 'pop .35s ease-out', ...shadow }}>{s.label}</div>}
        </div>
      )}

      {/* street event banner */}
      {h.event && (
        <div className="absolute left-1/2 top-[118px] -translate-x-1/2 text-center" style={{ animation: 'fadeIn .3s ease-out' }}>
          <div className="inline-block rounded-md border border-red-500/60 bg-black/70 px-5 py-2 backdrop-blur-sm">
            <div className="text-[11px] tracking-[0.4em] text-red-400">● LIVE EVENT</div>
            <div className="text-xl text-white" style={shadow}>{h.event.title}</div>
            <div className="text-xs text-white/75" style={{ fontFamily: 'system-ui' }}>{h.event.text}</div>
            {h.event.t !== null && <div className={`mt-0.5 text-2xl ${h.event.t < 10 ? 'animate-pulse text-red-400' : 'text-yellow-200'}`}>{Math.ceil(h.event.t)}s</div>}
          </div>
        </div>
      )}

      {/* combat strip: combo, block, dodge */}
      {!h.inCar && (
        <div className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-4 text-xs">
          {h.combo > 1 && <div className="text-2xl text-yellow-300" key={h.combo} style={{ animation: 'pop .25s ease-out', ...shadow }}>COMBO ×{h.combo}</div>}
          {h.blocking && <div className="rounded bg-sky-500/80 px-3 py-1 tracking-widest text-white">BLOCK — PARRY ON IMPACT</div>}
          <div className="flex items-center gap-1.5 text-white/70"><span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] text-white">Q</span>DODGE
            <div className="h-1.5 w-14 overflow-hidden rounded bg-white/15"><div className="h-full bg-cyan-300" style={{ width: `${(1 - Math.min(1, h.dodgeCd / 0.9)) * 100}%` }} /></div>
          </div>
        </div>
      )}
    </>
  );
}
