import { useEffect, useRef, useState } from 'react';
import { Game } from './game/game';
import { hud, emitHud, useHud } from './game/store';
import { FullMap, Hud, Loading, MainMenu, PauseMenu, Phone, ShopMenu } from './ui/ui';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const h = useHud();

  useEffect(() => {
    const canvas = canvasRef.current!;
    const g = new Game(canvas);
    let dead = false;
    g.init((msg, pct) => {
      hud.loadMsg = msg;
      hud.loadPct = pct;
      emitHud();
    })
      .then(() => { if (!dead) setGame(g); })
      .catch((e) => { console.error(e); setErr(String(e?.stack ?? e)); });
    (window as unknown as { __game: Game }).__game = g;
    return () => { dead = true; g.dispose(); };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <canvas ref={canvasRef} className="absolute inset-0 block" />
      {!game && !err && <Loading msg={h.loadMsg} pct={h.loadPct} />}
      {err && <pre className="absolute inset-0 z-50 overflow-auto bg-black p-6 text-xs text-red-300">{err}</pre>}
      {game && h.phase === 'menu' && <MainMenu game={game} />}
      {game && (h.phase === 'playing' || h.phase === 'paused') && <Hud game={game} />}
      {game && h.phase === 'paused' && <PauseMenu game={game} />}
      {game && h.shop && <ShopMenu game={game} />}
      {game && h.fullMap && <FullMap game={game} />}
      {game && h.phone && <Phone game={game} />}
    </div>
  );
}
