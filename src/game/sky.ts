import * as THREE from 'three/webgpu';
import { makeCanvas, mulberry32 } from './geo';

export const SUN_DIR = new THREE.Vector3(-0.82, 0.3, 0.36).normalize();

/** Golden-hour equirectangular sky used for both background and image based lighting. */
export function makeSky(): THREE.CanvasTexture {
  const W = 2048, H = 1024;
  const { c, g } = makeCanvas(W, H);
  const rng = mulberry32(77);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.0, '#101b47');
  grad.addColorStop(0.2, '#2a3d85');
  grad.addColorStop(0.36, '#7b6a9e');
  grad.addColorStop(0.44, '#e79a7c');
  grad.addColorStop(0.49, '#ffc48e');
  grad.addColorStop(0.5, '#ffd0a0');
  grad.addColorStop(0.52, '#c58a74');
  grad.addColorStop(0.6, '#5a4651');
  grad.addColorStop(1.0, '#241e29');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  const pos = (dir: THREE.Vector3) => {
    const u = Math.atan2(dir.z, dir.x) / (Math.PI * 2) + 0.5;
    const v = Math.asin(Math.max(-1, Math.min(1, dir.y))) / Math.PI + 0.5;
    return { x: u * W, y: (1 - v) * H };
  };
  const sp = pos(SUN_DIR);

  // clouds
  g.save();
  g.filter = 'blur(7px)';
  for (let i = 0; i < 90; i++) {
    const x = rng() * W;
    const y = H * (0.31 + rng() * 0.15);
    const w = 60 + rng() * 240;
    const h = 5 + rng() * 14;
    const dx = Math.min(Math.abs(x - sp.x), W - Math.abs(x - sp.x));
    const near = Math.max(0, 1 - dx / 700);
    const r = Math.round(150 + near * 105);
    const gg = Math.round(100 + near * 70);
    const b = Math.round(130 - near * 20);
    g.fillStyle = `rgba(${r},${gg},${b},${0.1 + rng() * 0.2})`;
    g.beginPath();
    g.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();

  // sun glow
  g.save();
  g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(sp.x, sp.y, 4, sp.x, sp.y, 420);
  halo.addColorStop(0, 'rgba(255,190,110,0.85)');
  halo.addColorStop(0.15, 'rgba(255,150,80,0.45)');
  halo.addColorStop(1, 'rgba(255,120,60,0)');
  g.fillStyle = halo;
  g.fillRect(sp.x - 440, sp.y - 440, 880, 880);
  const core = g.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 36);
  core.addColorStop(0, 'rgba(255,252,235,1)');
  core.addColorStop(0.6, 'rgba(255,230,180,0.9)');
  core.addColorStop(1, 'rgba(255,200,140,0)');
  g.fillStyle = core;
  g.fillRect(sp.x - 40, sp.y - 40, 80, 80);
  g.restore();

  // a few early stars at the top
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + rng() * 0.6})`;
    g.fillRect(rng() * W, rng() * H * 0.22, 1.4, 1.4);
  }

  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
