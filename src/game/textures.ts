import * as THREE from 'three';
import { fbm, mulberry32, vnoise, type RNG } from './util';

export function mkCanvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d', { willReadFrequently: true })! };
}

export function toTex(c: HTMLCanvasElement, o: { repeat?: boolean; srgb?: boolean; aniso?: number } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (o.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = o.aniso ?? 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** convert a greyscale height canvas into a tangent-space normal map */
export function heightToNormal(src: HTMLCanvasElement, strength = 2) {
  const w = src.width, h = src.height;
  const sd = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const { c, g } = mkCanvas(w, h);
  const out = g.createImageData(w, h);
  const H = (x: number, y: number) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

function noiseFill(g: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, scale: number, seed = 1, grain = 14) {
  const img = g.createImageData(w, h);
  const rng = mulberry32(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = (fbm(x / scale + seed * 13, y / scale + seed * 7, 4) - 0.5) * amp + (rng() - 0.5) * grain;
      const i = (y * w + x) * 4;
      img.data[i] = base[0] + n;
      img.data[i + 1] = base[1] + n;
      img.data[i + 2] = base[2] + n;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

export interface PBRTex { map: THREE.Texture; normal?: THREE.Texture; rough?: THREE.Texture; emissive?: THREE.Texture }

const cache = new Map<string, unknown>();
function memo<T>(k: string, f: () => T): T {
  if (!cache.has(k)) cache.set(k, f());
  return cache.get(k) as T;
}

// ------------------------------------------------------------------ ground
export const asphaltTex = () => memo('asphalt', () => {
  const { c, g } = mkCanvas(512);
  noiseFill(g, 512, 512, [58, 59, 62], 34, 40, 3, 22);
  const rng = mulberry32(5);
  g.globalAlpha = 0.35;
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = '#101113';
    g.lineWidth = 0.6 + rng() * 1.2;
    g.beginPath();
    let x = rng() * 512, y = rng() * 512;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rng() - 0.5) * 60; y += (rng() - 0.5) * 60; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  // tar patches
  for (let i = 0; i < 9; i++) {
    g.fillStyle = `rgba(20,20,22,${0.15 + rng() * 0.2})`;
    g.beginPath();
    g.ellipse(rng() * 512, rng() * 512, 20 + rng() * 40, 8 + rng() * 20, rng() * 3, 0, 7);
    g.fill();
  }
  const hc = mkCanvas(512);
  noiseFill(hc.g, 512, 512, [128, 128, 128], 120, 6, 8, 110);
  return { map: toTex(c), normal: toTex(heightToNormal(hc.c, 1.4), { srgb: false }) } as PBRTex;
});

/** road markings texture: 16m wide x 12m long tile (u across, v along) */
export const roadTex = () => memo('road', () => {
  const W = 512, H = 384;
  const { c, g } = mkCanvas(W, H);
  const base = asphaltTex().map.image as HTMLCanvasElement;
  g.drawImage(base, 0, 0, W, H);
  const mx = W / 16; // px per meter
  g.fillStyle = 'rgba(0,0,0,0.12)';
  // tyre wear bands in lanes
  for (const cx of [-5.2, -2.6, 2.6, 5.2]) g.fillRect((8 + cx - 0.9) * mx, 0, 0.5 * mx, H), g.fillRect((8 + cx + 0.4) * mx, 0, 0.5 * mx, H);
  // edge lines
  g.fillStyle = '#d9d9d4';
  g.fillRect((0.35) * mx, 0, 0.15 * mx, H);
  g.fillRect((15.5) * mx, 0, 0.15 * mx, H);
  // double yellow centre
  g.fillStyle = '#e3b323';
  g.fillRect((8 - 0.28) * mx, 0, 0.12 * mx, H);
  g.fillRect((8 + 0.16) * mx, 0, 0.12 * mx, H);
  // dashed lane lines
  g.fillStyle = '#d9d9d4';
  for (const cx of [-4.0, 4.0]) g.fillRect((8 + cx - 0.07) * mx, 0, 0.14 * mx, H * 0.28);
  // wear speckle
  const rng = mulberry32(2);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(30,30,32,${rng() * 0.5})`;
    g.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
  }
  const t = toTex(c);
  const n = asphaltTex().normal!.clone();
  n.needsUpdate = true;
  return { map: t, normal: n } as PBRTex;
});

export const crosswalkTex = () => memo('cw', () => {
  const { c, g } = mkCanvas(512, 128);
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, 512, 128);
  const rng = mulberry32(4);
  for (let i = 0; i < 12; i++) {
    g.fillStyle = 'rgba(232,232,226,0.93)';
    g.fillRect(i * 43 + 6, 0, 26, 128);
  }
  for (let i = 0; i < 1500; i++) {
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = `rgba(0,0,0,${rng() * 0.5})`;
    g.fillRect(rng() * 512, rng() * 128, 2, 2);
  }
  g.globalCompositeOperation = 'source-over';
  return toTex(c);
});

export const sidewalkTex = () => memo('sidewalk', () => {
  const { c, g } = mkCanvas(512);
  noiseFill(g, 512, 512, [150, 148, 142], 28, 24, 11, 16);
  g.strokeStyle = 'rgba(40,40,40,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke();
  }
  const hc = mkCanvas(512);
  hc.g.fillStyle = '#888';
  hc.g.fillRect(0, 0, 512, 512);
  hc.g.strokeStyle = '#000';
  hc.g.lineWidth = 5;
  for (let i = 0; i <= 4; i++) {
    hc.g.beginPath(); hc.g.moveTo(i * 128, 0); hc.g.lineTo(i * 128, 512); hc.g.stroke();
    hc.g.beginPath(); hc.g.moveTo(0, i * 128); hc.g.lineTo(512, i * 128); hc.g.stroke();
  }
  return { map: toTex(c), normal: toTex(heightToNormal(hc.c, 2), { srgb: false }) } as PBRTex;
});

export const grassTex = () => memo('grass', () => {
  const { c, g } = mkCanvas(512);
  noiseFill(g, 512, 512, [62, 96, 44], 50, 14, 21, 30);
  const rng = mulberry32(9);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${40 + rng() * 60},${90 + rng() * 70},${30 + rng() * 30},0.5)`;
    g.fillRect(rng() * 512, rng() * 512, 1, 2 + rng() * 3);
  }
  const hc = mkCanvas(256);
  noiseFill(hc.g, 256, 256, [128, 128, 128], 100, 4, 3, 90);
  return { map: toTex(c), normal: toTex(heightToNormal(hc.c, 1.2), { srgb: false }) } as PBRTex;
});

export const sandTex = () => memo('sand', () => {
  const { c, g } = mkCanvas(256);
  noiseFill(g, 256, 256, [214, 190, 140], 26, 10, 31, 20);
  return { map: toTex(c) } as PBRTex;
});

export const concreteTex = () => memo('concrete', () => {
  const { c, g } = mkCanvas(512);
  noiseFill(g, 512, 512, [138, 138, 136], 36, 30, 41, 14);
  const rng = mulberry32(7);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(30,30,30,${rng() * 0.18})`;
    g.fillRect(rng() * 512, rng() * 512, 1 + rng() * 5, 20 + rng() * 90);
  }
  const hc = mkCanvas(256);
  noiseFill(hc.g, 256, 256, [128, 128, 128], 80, 5, 4, 80);
  return { map: toTex(c), normal: toTex(heightToNormal(hc.c, 1), { srgb: false }) } as PBRTex;
});

export const waterNormal = () => memo('waternormal', () => {
  const hc = mkCanvas(512);
  const img = hc.g.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    // tileable by sampling noise on a torus
    const a = (x / 512) * Math.PI * 2, b = (y / 512) * Math.PI * 2;
    const v = Math.sin(a * 3 + Math.sin(b * 2) * 1.4) * 0.5 + Math.sin(b * 4 + Math.cos(a * 3)) * 0.4 + Math.sin((a + b) * 6) * 0.25 + Math.sin(a * 9 - b * 5) * 0.12;
    const i = (y * 512 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 128 + v * 60;
    img.data[i + 3] = 255;
  }
  hc.g.putImageData(img, 0, 0);
  return toTex(heightToNormal(hc.c, 3.5), { srgb: false });
});

// ------------------------------------------------------------------ buildings
export type FacadeKind = 'glass' | 'office' | 'brick' | 'apartment' | 'concrete' | 'shop';
export const FACADE_W = 12; // metres per tile (4 bays x 3m)
export const FACADE_H = 14.4; // metres per tile (4 floors x 3.6m)

export function facadeTex(kind: FacadeKind, variant = 0): PBRTex {
  return memo(`facade-${kind}-${variant}`, () => {
    const S = 512;
    const { c, g } = mkCanvas(S);
    const em = mkCanvas(S);
    const rg = mkCanvas(S); // roughness (G) / metalness (B) packed
    const rng = mulberry32(100 + variant * 17 + kind.length * 31);
    const bayW = S / 4, floorH = S / 4;
    const palettes: Record<FacadeKind, string[]> = {
      glass: ['#2b4a5f', '#31576e', '#27434f', '#35525f'],
      office: ['#b9b5aa', '#9fa3a6', '#c8c2b3', '#8c9298'],
      brick: ['#7d3f31', '#8a4a38', '#6f3a2e', '#98563f'],
      apartment: ['#d8c9a8', '#c5b999', '#d9d2c5', '#bda88a'],
      concrete: ['#8d8d8a', '#7d7e80', '#9a978f', '#74777b'],
      shop: ['#59514a', '#6b5d52', '#4d5058', '#645a50'],
    };
    const wall = palettes[kind][variant % 4];
    noiseFill(g, S, S, hexRGB(wall), kind === 'brick' ? 24 : 16, 18, 50 + variant, 10);
    rg.g.fillStyle = 'rgb(0,200,0)';
    rg.g.fillRect(0, 0, S, S);
    em.g.fillStyle = '#000';
    em.g.fillRect(0, 0, S, S);
    const hc = mkCanvas(S);
    hc.g.fillStyle = '#808080';
    hc.g.fillRect(0, 0, S, S);

    if (kind === 'brick') {
      for (let y = 0; y < S; y += 8) {
        for (let x = (y / 8) % 2 ? 0 : 8; x < S; x += 16) {
          g.fillStyle = `rgba(${rng() > 0.5 ? 0 : 255},${rng() > 0.5 ? 0 : 255},0,${rng() * 0.07})`;
          g.fillRect(x, y, 15, 7);
          hc.g.fillStyle = '#9a9a9a';
          hc.g.fillRect(x, y, 15, 7);
        }
      }
      hc.g.fillStyle = 'rgba(0,0,0,0)';
    }
    if (kind === 'concrete') {
      g.strokeStyle = 'rgba(20,20,20,0.3)';
      g.lineWidth = 2;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0, i * floorH + floorH - 4); g.lineTo(S, i * floorH + floorH - 4); g.stroke(); }
    }

    for (let f = 0; f < 4; f++) {
      for (let b = 0; b < 4; b++) {
        const x0 = b * bayW, y0 = f * floorH;
        let wx = x0 + bayW * 0.14, wy = y0 + floorH * 0.17, ww = bayW * 0.72, wh = floorH * 0.62;
        if (kind === 'glass') { wx = x0 + 2; wy = y0 + 4; ww = bayW - 4; wh = floorH - 8; }
        if (kind === 'office') { wx = x0 + 6; wy = y0 + floorH * 0.12; ww = bayW - 12; wh = floorH * 0.7; }
        if (kind === 'shop' && f === 0) { wx = x0 + 6; wy = y0 + 20; ww = bayW - 12; wh = floorH - 28; }
        const lit = rng() < 0.42;
        const warm = rng() < 0.7;
        // window glass
        const gr = g.createLinearGradient(wx, wy, wx + ww * 0.5, wy + wh);
        const tint = kind === 'glass' ? ['#6d95ad', '#1d3646'] : ['#4a6578', '#16222c'];
        gr.addColorStop(0, tint[0]);
        gr.addColorStop(1, tint[1]);
        g.fillStyle = gr;
        g.fillRect(wx, wy, ww, wh);
        // reflection streak
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.beginPath();
        g.moveTo(wx + ww * 0.1, wy + wh);
        g.lineTo(wx + ww * 0.45, wy);
        g.lineTo(wx + ww * 0.6, wy);
        g.lineTo(wx + ww * 0.25, wy + wh);
        g.fill();
        rg.g.fillStyle = 'rgb(0,40,200)';
        rg.g.fillRect(wx, wy, ww, wh);
        if (lit) {
          const e = em.g.createLinearGradient(wx, wy, wx, wy + wh);
          e.addColorStop(0, warm ? '#ffcf8a' : '#bcd8ff');
          e.addColorStop(1, warm ? '#ff9a4a' : '#7fa8e8');
          em.g.fillStyle = e;
          em.g.globalAlpha = 0.5 + rng() * 0.5;
          em.g.fillRect(wx, wy, ww, wh);
          em.g.globalAlpha = 1;
          // curtains / furniture silhouettes
          if (kind !== 'glass' && rng() < 0.6) {
            em.g.fillStyle = 'rgba(0,0,0,0.5)';
            em.g.fillRect(wx + ww * rng() * 0.5, wy + wh * 0.5, ww * 0.35, wh * 0.5);
          }
        }
        if (kind === 'glass') {
          g.fillStyle = 'rgba(8,16,22,0.9)';
          g.fillRect(wx, wy + wh - 6, ww, 6);
        } else {
          // frame + sill
          g.strokeStyle = 'rgba(15,15,15,0.85)';
          g.lineWidth = 3;
          g.strokeRect(wx, wy, ww, wh);
          g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); g.stroke();
          g.fillStyle = 'rgba(230,230,225,0.75)';
          g.fillRect(wx - 3, wy + wh, ww + 6, 4);
          hc.g.fillStyle = '#d0d0d0';
          hc.g.fillRect(wx - 3, wy + wh, ww + 6, 5);
          hc.g.fillStyle = '#303030';
          hc.g.fillRect(wx, wy, ww, wh);
          if (kind === 'apartment' && rng() < 0.4 && f > 0) {
            // balcony
            g.fillStyle = 'rgba(60,60,60,0.9)';
            g.fillRect(wx - 6, wy + wh + 4, ww + 12, 7);
            g.strokeStyle = 'rgba(30,30,30,0.9)';
            g.lineWidth = 1.5;
            for (let k = 0; k <= 8; k++) { g.beginPath(); g.moveTo(wx - 6 + k * (ww + 12) / 8, wy + wh + 11); g.lineTo(wx - 6 + k * (ww + 12) / 8, wy + wh + 28); g.stroke(); }
          }
        }
        if (kind === 'shop' && f === 0) {
          g.fillStyle = 'rgba(255,255,255,0.08)';
          g.fillRect(wx, wy, ww, wh);
        }
      }
    }
    // dirt streaks
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(10,10,10,${rng() * 0.12})`;
      g.fillRect(rng() * S, rng() * S, 2 + rng() * 6, 30 + rng() * 140);
    }
    return {
      map: toTex(c),
      emissive: toTex(em.c),
      rough: toTex(rg.c, { srgb: false }),
      normal: toTex(heightToNormal(hc.c, 2.2), { srgb: false }),
    } as PBRTex;
  });
}

export function hexRGB(h: string | number): [number, number, number] {
  const c = new THREE.Color(h as THREE.ColorRepresentation);
  return [c.r * 255, c.g * 255, c.b * 255];
}

/** rooftop texture: tar + gravel */
export const roofTex = () => memo('roof', () => {
  const { c, g } = mkCanvas(256);
  noiseFill(g, 256, 256, [70, 70, 72], 30, 10, 61, 24);
  return toTex(c);
});

// ------------------------------------------------------------------ signs, plates
export function plateTex(text: string, state = 'LOS SANTOS') {
  return memo(`plate-${text}-${state}`, () => {
    const { c, g } = mkCanvas(256, 128);
    g.fillStyle = '#e9e6dc';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#1f3d8a';
    g.fillRect(0, 0, 256, 26);
    g.fillStyle = '#fff';
    g.font = 'bold 18px Arial';
    g.textAlign = 'center';
    g.fillText(state, 128, 20);
    g.fillStyle = '#16181c';
    g.font = 'bold 66px "Courier New", monospace';
    g.fillText(text, 128, 98);
    g.strokeStyle = '#222';
    g.lineWidth = 6;
    g.strokeRect(3, 3, 250, 122);
    return toTex(c, { repeat: false });
  });
}

export function signTex(text: string, bg: string, fg: string, w = 512, h = 128, font = 'bold 72px Arial Black, Impact, sans-serif') {
  return memo(`sign-${text}-${bg}-${fg}-${w}`, () => {
    const { c, g } = mkCanvas(w, h);
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = fg;
    g.shadowBlur = 12;
    g.fillText(text, w / 2, h / 2 + 4);
    return toTex(c, { repeat: false });
  });
}

// ------------------------------------------------------------------ particles
export const softSprite = () => memo('soft', () => {
  const { c, g } = mkCanvas(128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return toTex(c, { repeat: false });
});
export const smokeSprite = () => memo('smoke', () => {
  const { c, g } = mkCanvas(128);
  const img = g.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const dx = (x - 64) / 64, dy = (y - 64) / 64;
    const d = Math.sqrt(dx * dx + dy * dy);
    const n = fbm(x / 16, y / 16, 4);
    const a = Math.max(0, 1 - d) * (0.4 + n * 0.9);
    const i = (y * 128 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.min(255, a * a * 300);
  }
  g.putImageData(img, 0, 0);
  return toTex(c, { repeat: false });
});
export const flareSprite = () => memo('flare', () => {
  const { c, g } = mkCanvas(128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.12, 'rgba(255,255,255,0.8)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(0, 62, 128, 4);
  g.fillRect(62, 0, 4, 128);
  return toTex(c, { repeat: false });
});
export const bulletHoleTex = () => memo('hole', () => {
  const { c, g } = mkCanvas(64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.95)');
  gr.addColorStop(0.22, 'rgba(0,0,0,0.9)');
  gr.addColorStop(0.5, 'rgba(20,18,16,0.35)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return toTex(c, { repeat: false });
});
export const skidTex = () => memo('skid', () => {
  const { c, g } = mkCanvas(64, 64);
  const gr = g.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(0.2, 'rgba(0,0,0,0.9)');
  gr.addColorStop(0.8, 'rgba(0,0,0,0.9)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return toTex(c, { repeat: false });
});
export const rainTex = () => memo('rain', () => {
  const { c, g } = mkCanvas(16, 128);
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(1, 'rgba(255,255,255,0.8)');
  g.fillStyle = gr;
  g.fillRect(6, 0, 4, 128);
  return toTex(c, { repeat: false });
});

// ------------------------------------------------------------------ cars
export const treadNormal = () => memo('tread', () => {
  const { c, g } = mkCanvas(128, 256);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#d8d8d8';
  for (let y = 0; y < 256; y += 16) {
    g.save();
    g.beginPath();
    g.moveTo(8, y); g.lineTo(60, y + 8); g.lineTo(60, y + 13); g.lineTo(8, y + 5);
    g.moveTo(120, y); g.lineTo(68, y + 8); g.lineTo(68, y + 13); g.lineTo(120, y + 5);
    g.fill();
    g.restore();
  }
  g.fillStyle = '#202020';
  g.fillRect(62, 0, 4, 256);
  const t = toTex(heightToNormal(c, 3), { srgb: false });
  return t;
});
export const carbonTex = () => memo('carbon', () => {
  const { c, g } = mkCanvas(128);
  for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 8) {
    const alt = ((x + y) / 8) % 2 === 0;
    const gr = g.createLinearGradient(x, y, alt ? x + 8 : x, alt ? y : y + 8);
    gr.addColorStop(0, '#2b2b2e');
    gr.addColorStop(1, '#0c0c0d');
    g.fillStyle = gr;
    g.fillRect(x, y, 8, 8);
  }
  return toTex(c);
});
export const grilleTex = () => memo('grille', () => {
  const { c, g } = mkCanvas(128, 64);
  g.fillStyle = '#08090a';
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#2a2d31';
  g.lineWidth = 2;
  for (let x = -64; x < 192; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 64, 64); g.stroke(); }
  for (let x = 192; x > -64; x -= 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x - 64, 64); g.stroke(); }
  return toTex(c);
});

/** car-paint flake normal: subtle micro-noise */
export const flakeNormal = () => memo('flake', () => {
  const hc = mkCanvas(256);
  noiseFill(hc.g, 256, 256, [128, 128, 128], 30, 3, 77, 110);
  return toTex(heightToNormal(hc.c, 0.6), { srgb: false });
});

// ------------------------------------------------------------------ humans
export interface FaceOpts {
  skin: number; lip: number; brow: number; stubble: number; // stubble 0..1
  beard?: boolean; female?: boolean; age?: number; makeup?: number; browThick?: number; eyeShadow?: number;
}
export const FACE = { W: 0.2, H: 0.3 };

export function faceTex(o: FaceOpts, key: string) {
  return memo(`face-${key}`, () => {
    const S = 512;
    const { c, g } = mkCanvas(S);
    const [sr, sg, sb] = hexRGB(o.skin);
    // base: skin w/ subsurface blotching
    const img = g.createImageData(S, S);
    const rng = mulberry32(key.length * 97 + (o.skin & 255));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const n = (fbm(x / 40 + 3, y / 40, 3) - 0.5) * 20 + (rng() - 0.5) * 9;
      const red = Math.max(0, fbm(x / 70 + 9, y / 70 + 2, 3) - 0.45) * 40; // blood flush
      const i = (y * S + x) * 4;
      img.data[i] = sr + n + red;
      img.data[i + 1] = sg + n - red * 0.4;
      img.data[i + 2] = sb + n - red * 0.5;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const px = (x: number) => (0.5 + x / FACE.W) * S;
    const py = (dy: number) => (0.5 - dy / FACE.H) * S;
    const sc = S / FACE.W;
    const skinDark = `rgb(${sr * 0.55 | 0},${sg * 0.42 | 0},${sb * 0.38 | 0})`;
    // under-eye + socket shading
    for (const sx of [-1, 1]) {
      const gr = g.createRadialGradient(px(sx * 0.034), py(-0.002), 2, px(sx * 0.034), py(-0.002), 0.034 * sc);
      gr.addColorStop(0, 'rgba(60,20,18,0.34)');
      gr.addColorStop(1, 'rgba(60,20,18,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
    }
    // eyeshadow / makeup
    if (o.eyeShadow) {
      for (const sx of [-1, 1]) {
        const gr = g.createRadialGradient(px(sx * 0.034), py(0.012), 1, px(sx * 0.034), py(0.012), 0.028 * sc);
        gr.addColorStop(0, `rgba(120,60,110,${o.eyeShadow})`);
        gr.addColorStop(1, 'rgba(120,60,110,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, S, S);
      }
    }
    // blush
    if (o.makeup) {
      for (const sx of [-1, 1]) {
        const gr = g.createRadialGradient(px(sx * 0.05), py(-0.04), 1, px(sx * 0.05), py(-0.04), 0.035 * sc);
        gr.addColorStop(0, `rgba(210,90,90,${o.makeup * 0.5})`);
        gr.addColorStop(1, 'rgba(210,90,90,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, S, S);
      }
    }
    // nose shadow + nostrils
    g.fillStyle = 'rgba(80,30,25,0.25)';
    g.beginPath();
    g.ellipse(px(0), py(-0.052), 0.016 * sc, 0.007 * sc, 0, 0, 7);
    g.fill();
    g.fillStyle = 'rgba(30,10,8,0.7)';
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.ellipse(px(sx * 0.0085), py(-0.049), 0.0045 * sc, 0.0028 * sc, sx * 0.3, 0, 7);
      g.fill();
    }
    // nasolabial folds
    g.strokeStyle = 'rgba(90,40,30,0.18)';
    g.lineWidth = 3;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(px(sx * 0.02), py(-0.052));
      g.quadraticCurveTo(px(sx * 0.034), py(-0.07), px(sx * 0.03), py(-0.09));
      g.stroke();
    }
    // beard / stubble
    if (o.stubble > 0 || o.beard) {
      const beardAmt = o.beard ? 0.82 : o.stubble;
      const br = mulberry32(55 + key.length);
      const [hr, hg, hb] = hexRGB(o.brow);
      // region: jaw & upper lip, below cheekbone line
      for (let i = 0; i < 26000 * (0.4 + beardAmt); i++) {
        const x = (br() - 0.5) * 0.14;
        const y = -0.03 - br() * 0.1;
        // jaw mask: ellipse-ish shape
        const jaw = Math.abs(x) / 0.062;
        const limit = -0.045 - (1 - Math.min(1, jaw * jaw)) * 0.07;
        if (y > -0.04 - Math.max(0, jaw - 0.3) * 0.04 && !(Math.abs(x) < 0.034 && y > -0.064)) continue;
        if (y < limit - 0.012) continue;
        // keep clean mouth area a bit lighter
        const mouth = Math.hypot(x / 0.024, (y + 0.077) / 0.01) < 1 ? 0.25 : 1;
        g.fillStyle = `rgba(${hr | 0},${hg | 0},${hb | 0},${(0.1 + br() * 0.3) * beardAmt * mouth})`;
        g.fillRect(px(x), py(y), 1.6, 1.6);
      }
      if (o.beard) {
        const gr = g.createRadialGradient(px(0), py(-0.085), 5, px(0), py(-0.085), 0.075 * sc);
        gr.addColorStop(0, `rgba(${hr | 0},${hg | 0},${hb | 0},0.0)`);
        gr.addColorStop(1, `rgba(${hr | 0},${hg | 0},${hb | 0},0.0)`);
      }
    }
    // lips
    const [lr, lg, lb] = hexRGB(o.lip);
    const lipW = o.female ? 0.027 : 0.025;
    g.fillStyle = `rgb(${lr | 0},${lg | 0},${lb | 0})`;
    g.beginPath();
    g.moveTo(px(-lipW), py(-0.077));
    g.bezierCurveTo(px(-lipW * 0.5), py(-0.066), px(-lipW * 0.2), py(-0.0675), px(0), py(-0.069));
    g.bezierCurveTo(px(lipW * 0.2), py(-0.0675), px(lipW * 0.5), py(-0.066), px(lipW), py(-0.077));
    g.bezierCurveTo(px(lipW * 0.5), py(-0.0915), px(-lipW * 0.5), py(-0.0915), px(-lipW), py(-0.077));
    g.fill();
    g.strokeStyle = 'rgba(40,12,10,0.8)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px(-lipW), py(-0.077));
    g.quadraticCurveTo(px(0), py(-0.0805), px(lipW), py(-0.077));
    g.stroke();
    // lower lip highlight
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.ellipse(px(0), py(-0.0845), 0.009 * sc, 0.0025 * sc, 0, 0, 7);
    g.fill();
    // brows
    const [br_, bg_, bb_] = hexRGB(o.brow);
    const thick = (o.browThick ?? 1) * (o.female ? 0.75 : 1);
    const bro = mulberry32(31 + key.length);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 260; i++) {
        const t = bro();
        const x = sx * (0.016 + t * 0.04);
        const arch = Math.sin(t * Math.PI) * 0.007 + (o.female ? t * 0.004 : 0) - t * 0.002;
        const y = 0.031 + arch + (bro() - 0.5) * 0.009 * thick * (1 - t * 0.4);
        g.strokeStyle = `rgba(${br_ | 0},${bg_ | 0},${bb_ | 0},${0.35 + bro() * 0.5})`;
        g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(px(x), py(y));
        g.lineTo(px(x + sx * 0.004), py(y + 0.0018 - t * 0.003));
        g.stroke();
      }
    }
    // eye lids and lashes (drawn around the sculpted eye)
    g.strokeStyle = skinDark;
    g.lineWidth = o.female ? 3.5 : 2.5;
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.moveTo(px(sx * 0.0175), py(-0.001));
      g.quadraticCurveTo(px(sx * 0.034), py(0.0165), px(sx * 0.05), py(0.0005));
      g.stroke();
    }
    // wrinkles for age
    if ((o.age ?? 0) > 0) {
      g.strokeStyle = `rgba(70,30,25,${0.2 * (o.age ?? 0)})`;
      g.lineWidth = 1.5;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(px(-0.04), py(0.062 + k * 0.007));
        g.lineTo(px(0.04), py(0.062 + k * 0.007));
        g.stroke();
      }
    }
    // pores
    const pr = mulberry32(5);
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = `rgba(60,25,20,${pr() * 0.07})`;
      g.fillRect(pr() * S, pr() * S, 1, 1);
    }
    return toTex(c, { repeat: false });
  });
}

export const skinBump = () => memo('skinbump', () => {
  const hc = mkCanvas(256);
  noiseFill(hc.g, 256, 256, [128, 128, 128], 40, 2.5, 12, 120);
  return toTex(heightToNormal(hc.c, 0.9), { srgb: false });
});

export function skinTex(hex: number, key: string) {
  return memo(`skin-${key}`, () => {
    const S = 256;
    const { c, g } = mkCanvas(S);
    const [sr, sg, sb] = hexRGB(hex);
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const n = (fbm(x / 20, y / 20, 3) - 0.5) * 16;
      const hair = vnoise(x * 0.9, y * 0.9) > 0.86 ? -10 : 0;
      const i = (y * S + x) * 4;
      img.data[i] = sr + n + hair;
      img.data[i + 1] = sg + n * 0.9 + hair;
      img.data[i + 2] = sb + n * 0.85 + hair;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return toTex(c);
  });
}

export type FabricKind = 'denim' | 'leather' | 'cotton' | 'knit' | 'suit' | 'rubber' | 'cargo';
export function fabricTex(hex: number, kind: FabricKind): PBRTex {
  return memo(`fabric-${hex}-${kind}`, () => {
    const S = 256;
    const { c, g } = mkCanvas(S);
    const hc = mkCanvas(S);
    const [r, gg, b] = hexRGB(hex);
    g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
    g.fillRect(0, 0, S, S);
    hc.g.fillStyle = '#808080';
    hc.g.fillRect(0, 0, S, S);
    const rng = mulberry32(hex + kind.length);
    if (kind === 'denim') {
      for (let y = 0; y < S; y += 2) {
        for (let x = 0; x < S; x++) {
          const v = ((x + y) % 4 < 2 ? 1 : -1) * 9 + (rng() - 0.5) * 22;
          g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 120})`;
          g.fillRect(x, y, 1, 2);
          hc.g.fillStyle = v > 0 ? '#a0a0a0' : '#606060';
          hc.g.fillRect(x, y, 1, 2);
        }
      }
    } else if (kind === 'leather') {
      for (let i = 0; i < 1800; i++) {
        const x = rng() * S, y = rng() * S;
        hc.g.fillStyle = `rgba(${rng() > 0.5 ? 40 : 200},${rng() > 0.5 ? 40 : 200},0,0.5)`;
        hc.g.beginPath();
        hc.g.arc(x, y, 1.5 + rng() * 2.5, 0, 7);
        hc.g.fill();
      }
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let i = 0; i < 20; i++) g.fillRect(rng() * S, rng() * S, 60, 1.5);
    } else if (kind === 'knit') {
      for (let y = 0; y < S; y += 6) for (let x = 0; x < S; x += 6) {
        hc.g.fillStyle = '#b8b8b8';
        hc.g.beginPath();
        hc.g.ellipse(x + 3, y + 3, 2, 3.2, 0, 0, 7);
        hc.g.fill();
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.fillRect(x + 1, y, 3, 6);
      }
    } else if (kind === 'suit') {
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      for (let x = 0; x < S; x += 7) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
    } else {
      for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
        const v = (rng() - 0.5) * 24;
        g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 110})`;
        g.fillRect(x, y, 2, 2);
        hc.g.fillStyle = v > 0 ? '#909090' : '#707070';
        hc.g.fillRect(x, y, 2, 2);
      }
    }
    return { map: toTex(c), normal: toTex(heightToNormal(hc.c, kind === 'leather' ? 1.4 : 1.8), { srgb: false }) } as PBRTex;
  });
}

export function hairTex(hex: number, key = '') {
  return memo(`hair-${hex}-${key}`, () => {
    const S = 256;
    const { c, g } = mkCanvas(S);
    const [r, gg, b] = hexRGB(hex);
    const rng = mulberry32(hex);
    g.fillStyle = `rgb(${r * 0.7 | 0},${gg * 0.7 | 0},${b * 0.7 | 0})`;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const k = 0.5 + rng() * 1.1;
      g.strokeStyle = `rgba(${Math.min(255, r * k) | 0},${Math.min(255, gg * k) | 0},${Math.min(255, b * k) | 0},${0.35 + rng() * 0.5})`;
      g.lineWidth = 1 + rng() * 1.4;
      const x = rng() * S;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + (rng() - 0.5) * 12, S * 0.3, x + (rng() - 0.5) * 12, S * 0.6, x + (rng() - 0.5) * 8, S);
      g.stroke();
    }
    return toTex(c);
  });
}

export function irisTex(hex: number) {
  return memo(`iris-${hex}`, () => {
    const { c, g } = mkCanvas(512, 256);
    g.fillStyle = '#efeae4';
    g.fillRect(0, 0, 512, 256);
    // veins
    g.strokeStyle = 'rgba(190,80,80,0.18)';
    g.lineWidth = 1;
    const rng = mulberry32(3);
    for (let i = 0; i < 24; i++) {
      g.beginPath();
      const a = rng() * 6.28, sx = 128 + Math.cos(a) * 110, sy = 128 + Math.sin(a) * 90;
      g.moveTo(sx, sy);
      g.lineTo(sx - Math.cos(a) * 40, sy - Math.sin(a) * 40);
      g.stroke();
    }
    const [r, gg, b] = hexRGB(hex);
    const cx = 128, cy = 128;
    const gr = g.createRadialGradient(cx, cy, 6, cx, cy, 40);
    gr.addColorStop(0, `rgb(${r * 0.5 | 0},${gg * 0.5 | 0},${b * 0.5 | 0})`);
    gr.addColorStop(0.6, `rgb(${r | 0},${gg | 0},${b | 0})`);
    gr.addColorStop(1, `rgb(${r * 0.35 | 0},${gg * 0.35 | 0},${b * 0.35 | 0})`);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(cx, cy, 40, 0, 7);
    g.fill();
    g.strokeStyle = `rgba(${Math.min(255, r * 1.6) | 0},${Math.min(255, gg * 1.6) | 0},${Math.min(255, b * 1.6) | 0},0.5)`;
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * 6.28;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9);
      g.lineTo(cx + Math.cos(a) * 38, cy + Math.sin(a) * 38);
      g.stroke();
    }
    g.fillStyle = '#050404';
    g.beginPath();
    g.arc(cx, cy, 11, 0, 7);
    g.fill();
    return toTex(c, { repeat: false });
  });
}

export function makeRng(seed: number): RNG {
  return mulberry32(seed);
}
