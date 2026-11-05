import { clamp } from './util';

export const STATIONS = ['Radio Off', 'Neon FM 88.1', 'Hustle 93.7', 'Desi Groove 101'];

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  musicGain!: GainNode;
  reverb!: ConvolverNode;
  noiseBuf!: AudioBuffer;
  volume = 0.7;
  musicVol = 0.5;
  station = 0;
  // engine
  private eng?: { o1: OscillatorNode; o2: OscillatorNode; o3: OscillatorNode; f: BiquadFilterNode; g: GainNode };
  private squeal?: { g: GainNode; f: BiquadFilterNode };
  private wind?: { g: GainNode; f: BiquadFilterNode };
  private rain?: { g: GainNode };
  private ambient?: { g: GainNode };
  private siren?: { o: OscillatorNode; g: GainNode };
  private horn?: { g: GainNode };
  private nextBeat = 0;
  private beat = 0;
  private timer = 0;
  intensity = 0;
  gear = 1;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicVol * 0.5;
    this.musicGain.connect(this.master);
    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // reverb IR
    const il = ctx.sampleRate * 1.6;
    const ir = ctx.createBuffer(2, il, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < il; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / il, 3.2);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const rg = ctx.createGain();
    rg.gain.value = 0.22;
    this.reverb.connect(rg).connect(this.master);

    // engine
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'sawtooth';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = 0;
    const m1 = ctx.createGain(), m2 = ctx.createGain(), m3 = ctx.createGain();
    m1.gain.value = 0.5; m2.gain.value = 0.25; m3.gain.value = 0.3;
    o1.connect(m1).connect(f); o2.connect(m2).connect(f); o3.connect(m3).connect(f);
    f.connect(g).connect(this.sfx);
    o1.start(); o2.start(); o3.start();
    this.eng = { o1, o2, o3, f, g };
    const mk = (type: BiquadFilterType, freq: number, q = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
      const gg = ctx.createGain(); gg.gain.value = 0;
      s.connect(fl).connect(gg).connect(this.sfx);
      s.start();
      return { g: gg, f: fl };
    };
    this.squeal = mk('bandpass', 1500, 7);
    this.wind = mk('lowpass', 500, 0.5);
    const rn = mk('highpass', 2500, 0.3);
    this.rain = { g: rn.g };
    const am = mk('lowpass', 220, 0.4);
    this.ambient = { g: am.g };
    am.g.gain.value = 0.05;
    // siren
    const so = ctx.createOscillator(); so.type = 'sawtooth';
    const sg = ctx.createGain(); sg.gain.value = 0;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 1100; sf.Q.value = 1.2;
    so.connect(sf).connect(sg).connect(this.sfx);
    so.start();
    this.siren = { o: so, g: sg };
    // horn
    const h1 = ctx.createOscillator(), h2 = ctx.createOscillator();
    h1.type = 'square'; h2.type = 'square'; h1.frequency.value = 392; h2.frequency.value = 494;
    const hg = ctx.createGain(); hg.gain.value = 0;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1400;
    h1.connect(hf); h2.connect(hf); hf.connect(hg).connect(this.sfx);
    h1.start(); h2.start();
    this.horn = { g: hg };
    this.timer = window.setInterval(() => this.musicTick(), 50);
  }

  setVolume(v: number, m: number) {
    this.volume = v; this.musicVol = m;
    if (this.ctx) { this.master.gain.value = v; this.musicGain.gain.value = m * 0.5; }
  }

  // ---------------------------------------------------------------- continuous
  engine(on: boolean, speed: number, topSpeed: number, throttle: number, boost: boolean, kind = 'sedan') {
    if (!this.ctx || !this.eng) return;
    const t = this.ctx.currentTime;
    const e = this.eng;
    if (!on) { e.g.gain.setTargetAtTime(0, t, 0.08); return; }
    const sp = Math.abs(speed);
    const ratio = sp / topSpeed;
    const gears = 6;
    const gi = Math.min(gears - 1, Math.floor(ratio * gears * 1.05));
    this.gear = gi + 1;
    const within = clamp(ratio * gears * 1.05 - gi, 0, 1);
    const rpm = 0.14 + within * 0.75 + (throttle > 0 ? 0.06 : 0) * (1 - within);
    const base = kind === 'sports' ? 62 : kind === 'muscle' ? 40 : kind === 'suv' || kind === 'pickup' || kind === 'van' || kind === 'swat' ? 32 : 46;
    const fq = base * (1 + rpm * 4.3);
    e.o1.frequency.setTargetAtTime(fq, t, 0.04);
    e.o2.frequency.setTargetAtTime(fq * 0.5, t, 0.04);
    e.o3.frequency.setTargetAtTime(fq * 1.503, t, 0.04);
    e.f.frequency.setTargetAtTime(280 + rpm * 1800 + throttle * 600, t, 0.05);
    e.g.gain.setTargetAtTime(0.1 + Math.max(0, throttle) * 0.1 + rpm * 0.05 + (boost ? 0.04 : 0), t, 0.05);
    this.wind!.g.gain.setTargetAtTime(clamp(sp / 70, 0, 1) * 0.18, t, 0.1);
    this.wind!.f.frequency.setTargetAtTime(300 + sp * 14, t, 0.1);
  }
  noEngine() {
    if (!this.ctx || !this.eng) return;
    this.eng.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    this.wind!.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }
  skid(amount: number) {
    if (!this.ctx || !this.squeal) return;
    this.squeal.g.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.16, this.ctx.currentTime, 0.04);
    this.squeal.f.frequency.setTargetAtTime(1200 + amount * 700, this.ctx.currentTime, 0.1);
  }
  ambience(rain: number, night: number, citySound: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rain!.g.gain.setTargetAtTime(rain * 0.1, t, 0.4);
    this.ambient!.g.gain.setTargetAtTime((0.035 + citySound * 0.03) * (1 - night * 0.4), t, 0.5);
  }
  sirenOn(on: boolean, near = 1) {
    if (!this.ctx || !this.siren) return;
    const t = this.ctx.currentTime;
    this.siren.g.gain.setTargetAtTime(on ? 0.045 * near : 0, t, 0.15);
    if (on) {
      const ph = (t * 0.55) % 1;
      this.siren.o.frequency.setTargetAtTime(650 + Math.sin(ph * Math.PI * 2) * 360 + 360, t, 0.02);
    }
  }
  hornOn(on: boolean) {
    if (!this.ctx || !this.horn) return;
    this.horn.g.gain.setTargetAtTime(on ? 0.1 : 0, this.ctx.currentTime, 0.02);
  }

  // ---------------------------------------------------------------- one-shots
  private noise(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, q = 1, delay = 0, verb = 0.3) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g);
    g.connect(this.sfx);
    if (verb > 0) { const vg = ctx.createGain(); vg.gain.value = verb; g.connect(vg).connect(this.reverb); }
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  private tone(freq: number, freq2: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.02);
  }
  gunshot(kind: string, vol = 1) {
    if (!this.ctx) return;
    if (kind === 'pistol') { this.noise(0.22, 0.9 * vol, 'lowpass', 5000, 300, 0.7, 0, 0.5); this.tone(180, 50, 0.12, 0.5 * vol, 'sine'); }
    else if (kind === 'smg') { this.noise(0.12, 0.7 * vol, 'bandpass', 3500, 600, 0.9, 0, 0.35); this.tone(240, 70, 0.07, 0.35 * vol, 'square'); }
    else if (kind === 'shotgun') { this.noise(0.5, 1.2 * vol, 'lowpass', 4000, 150, 0.6, 0, 0.7); this.tone(110, 30, 0.3, 0.8 * vol, 'sine'); }
    else if (kind === 'rifle') { this.noise(0.2, 0.9 * vol, 'bandpass', 2500, 300, 0.7, 0, 0.6); this.tone(150, 40, 0.14, 0.5 * vol, 'sawtooth'); }
    else if (kind === 'rpg') { this.noise(0.8, 1 * vol, 'lowpass', 1800, 100, 0.5, 0, 0.6); }
  }
  explosion(dist = 0) {
    const v = clamp(1 - dist / 220, 0.1, 1);
    this.noise(2.2, 1.6 * v, 'lowpass', 1400, 40, 0.7, 0, 0.9);
    this.noise(0.5, 1.0 * v, 'bandpass', 2400, 200, 0.5, 0, 0.5);
    this.tone(90, 22, 1.4, 0.9 * v, 'sine');
  }
  crash(impact: number) {
    const v = clamp(impact / 16, 0.1, 1);
    this.noise(0.4 + v * 0.3, v * 0.8, 'bandpass', 1800, 220, 0.8, 0, 0.3);
    this.tone(120 + v * 40, 40, 0.25, v * 0.6, 'square');
    if (impact > 8) this.noise(0.5, v * 0.4, 'highpass', 5000, 2500, 1, 0.05, 0.3);
  }
  step(kind: 'pave' | 'grass' | 'asphalt', speed: number) {
    const v = clamp(speed / 6, 0.2, 0.7) * 0.5;
    this.noise(0.07, v, 'bandpass', kind === 'grass' ? 700 : 1200 + Math.random() * 300, 400, 1.2, 0, 0);
  }
  punch() { this.noise(0.1, 0.6, 'lowpass', 900, 120, 1, 0, 0.1); this.tone(110, 50, 0.1, 0.4); }
  swing() { this.noise(0.16, 0.2, 'bandpass', 1200, 3000, 1, 0, 0); }
  hit() { this.noise(0.12, 0.4, 'bandpass', 1500, 300, 2, 0, 0.1); }
  hurt() { this.tone(260, 160, 0.22, 0.25, 'sawtooth'); this.noise(0.1, 0.2, 'lowpass', 800, 200, 1, 0, 0); }
  reload() { this.noise(0.05, 0.4, 'highpass', 4000, 3000, 2, 0, 0); this.noise(0.05, 0.5, 'highpass', 3000, 2000, 2, 0.6, 0); this.tone(900, 700, 0.05, 0.2, 'square', 0.9); }
  empty() { this.noise(0.03, 0.3, 'highpass', 5000, 4000, 3, 0, 0); }
  cash() { this.tone(880, 880, 0.08, 0.2, 'triangle'); this.tone(1320, 1320, 0.2, 0.2, 'triangle', 0.07); }
  click() { this.tone(700, 500, 0.04, 0.15, 'square'); }
  door() { this.noise(0.12, 0.4, 'lowpass', 600, 150, 1, 0, 0.1); this.tone(100, 60, 0.08, 0.3); }
  wanted() { this.tone(440, 440, 0.12, 0.2, 'square'); this.tone(554, 554, 0.12, 0.2, 'square', 0.13); this.tone(659, 659, 0.2, 0.2, 'square', 0.26); }
  complete() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.35, 0.22, 'triangle', i * 0.12)); }
  fail() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.98, 0.4, 0.22, 'sawtooth', i * 0.15)); }
  dialogue() { this.tone(300 + Math.random() * 120, 280 + Math.random() * 120, 0.035, 0.05, 'triangle'); }
  phone() { for (let i = 0; i < 3; i++) { this.tone(1400, 1400, 0.1, 0.15, 'sine', i * 0.2); this.tone(1700, 1700, 0.1, 0.15, 'sine', i * 0.2 + 0.1); } }
  heli() { this.noise(0.12, 0.25, 'lowpass', 300, 120, 1, 0, 0); }

  // ---------------------------------------------------------------- radio
  setStation(i: number) {
    this.station = (i + STATIONS.length) % STATIONS.length;
    this.beat = 0;
    if (this.ctx) this.nextBeat = this.ctx.currentTime + 0.1;
    this.click();
  }
  private musicTick() {
    const ctx = this.ctx;
    if (!ctx || this.station === 0) return;
    if (this.nextBeat < ctx.currentTime) this.nextBeat = ctx.currentTime + 0.05;
    while (this.nextBeat < ctx.currentTime + 0.25) {
      this.playStep(this.beat, this.nextBeat);
      const bpm = this.station === 1 ? 108 : this.station === 2 ? 140 : 100;
      this.nextBeat += 60 / bpm / 4;
      this.beat++;
    }
  }
  private mtone(t: number, f: number, dur: number, vol: number, type: OscillatorType, cutoff = 4000, attack = 0.005) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(fl).connect(g).connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.05);
  }
  private mnoise(t: number, dur: number, vol: number, type: BiquadFilterType, f: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.musicGain);
    s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  private playStep(b: number, t: number) {
    const s = b % 16, bar = Math.floor(b / 16) % 8;
    const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    if (this.station === 1) {
      // synthwave
      const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
      const ch = chords[Math.floor(bar / 2) % 4];
      if (s % 4 === 0) { this.mtone(t, 55 * Math.pow(2, (ch[0] - 45) / 12) , 0.2, 0.5, 'sine', 300); this.mnoise(t, 0.08, 0.25, 'lowpass', 150); }
      if (s === 4 || s === 12) this.mnoise(t, 0.14, 0.2, 'bandpass', 1800);
      if (s % 2 === 0) this.mnoise(t, 0.03, 0.06, 'highpass', 8000);
      this.mtone(t, hz(ch[0] - 24), 0.2, 0.22, 'sawtooth', 500 + 600 * Math.sin(b * 0.03) ** 2);
      const arp = [0, 1, 2, 1, 0, 2, 1, 2];
      if (s % 2 === 0) this.mtone(t, hz(ch[arp[(s / 2) % 8]] + 12), 0.25, 0.1, 'square', 2500);
      if (s === 0) for (const n of ch) this.mtone(t, hz(n), 1.6, 0.06, 'sawtooth', 1200, 0.2);
    } else if (this.station === 2) {
      // trap
      const roots = [45, 45, 41, 43];
      const r = roots[Math.floor(bar / 2) % 4];
      if (s === 0 || s === 7 || s === 10) { this.mtone(t, hz(r - 12), 0.5, 0.6, 'sine', 200); this.tone(120, 40, 0.15, 0.1); }
      if (s === 8) { this.mnoise(t, 0.18, 0.3, 'bandpass', 1900); this.mtone(t, 200, 0.08, 0.15, 'triangle'); }
      if (s % 2 === 0 || (s % 4 === 3 && bar % 2)) this.mnoise(t, 0.025, 0.08, 'highpass', 9000);
      if (s === 14 || s === 15) this.mnoise(t, 0.02, 0.07, 'highpass', 9000);
      const mel = [0, 3, 7, 3, 10, 7, 3, 0];
      if (s % 4 === 2) this.mtone(t, hz(r + 24 + mel[(s / 2 + bar) % 8]), 0.18, 0.08, 'triangle', 3000);
    } else {
      // desi groove (harmonic minor / pentatonic with tabla-ish hits)
      const scale = [0, 1, 4, 5, 7, 8, 11];
      const tonic = 50;
      if (s % 4 === 0) { this.mtone(t, hz(tonic - 12), 0.3, 0.35, 'sine', 300); }
      if (s === 3 || s === 6 || s === 11 || s === 14) { this.mtone(t, 330 + (s % 3) * 50, 0.09, 0.15, 'triangle'); this.mnoise(t, 0.05, 0.1, 'bandpass', 900); }
      if (s === 8) this.mnoise(t, 0.1, 0.18, 'bandpass', 2200);
      if (s % 2 === 0) this.mnoise(t, 0.02, 0.05, 'highpass', 8500);
      const seq = [0, 2, 4, 3, 2, 1, 0, 2, 4, 6, 5, 4, 3, 2, 1, 0];
      if (s % 2 === 0 || s % 4 === 3) {
        const deg = seq[(s + bar * 3) % 16];
        this.mtone(t, hz(tonic + 12 + scale[deg % 7] + (deg > 6 ? 12 : 0)), 0.3, 0.1, 'sawtooth', 2200, 0.01);
      }
      if (s === 0) for (const n of [0, 7]) this.mtone(t, hz(tonic + n), 1.8, 0.05, 'sawtooth', 700, 0.3);
    }
  }
  setIntensityDrone(on: boolean) { void on; }
  dispose() { clearInterval(this.timer); void this.ctx?.close(); }
}
