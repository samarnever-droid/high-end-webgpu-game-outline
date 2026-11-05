// Fully procedural audio: original "Aphar Dekjo" mission theme (D minor), city ambience,
// engine, tyres, footsteps, horn, UI + dialogue blips. No external assets.

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const CHORDS: number[][] = [
  [50, 57, 62, 65], // Dm
  [46, 53, 58, 62], // Bb
  [53, 57, 60, 65], // F
  [48, 55, 60, 64], // C
  [50, 57, 62, 65], // Dm
  [46, 53, 58, 62], // Bb
  [50, 55, 58, 62], // Gm
  [45, 52, 57, 61], // A (harmonic tension)
];
const ROOTS = [38, 34, 41, 36, 38, 34, 31, 33];
const ARP = [0, 2, 1, 3, 2, 3, 1, 2, 0, 2, 1, 3, 2, 3, 3, 1];
const BASS = [1, 0, 0, 1, 0, 0, 2, 0, 1, 0, 1, 0, 2, 0, 3, 0]; // 1 root, 2 octave, 3 fifth
const LEAD: number[][] = [
  [74, 0, 77, 0, 81, 0, 79, 77],
  [77, 0, 74, 0, 70, 0, 72, 74],
  [72, 0, 77, 0, 81, 0, 84, 81],
  [79, 0, 76, 0, 72, 0, 76, 79],
  [74, 0, 77, 0, 81, 0, 79, 77],
  [77, 0, 74, 0, 82, 0, 81, 77],
  [79, 0, 77, 0, 74, 0, 70, 74],
  [76, 0, 0, 73, 76, 0, 81, 0],
];

interface ToneOpts {
  f: number;
  t: number;
  d: number;
  type?: OscillatorType;
  v: number;
  a?: number;
  r?: number;
  lp?: number;
  det?: number;
  rev?: number;
  dly?: number;
  dest?: AudioNode;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  intensity = 0;
  muted = false;
  musicOn = true;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private reverbIn!: GainNode;
  private delayIn!: GainNode;
  private noiseBuf!: AudioBuffer;
  private sd = 60 / 104 / 4;
  private nextTime = 0;
  private step = 0;
  private timer: number | undefined;
  private eng?: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode };
  private skid?: { g: GainNode; f: BiquadFilterNode };
  private wind?: { g: GainNode; f: BiquadFilterNode };
  private horn?: GainNode;
  private amb?: GainNode;
  private lastFoot = 0;

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    void ctx.resume();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(comp).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.62;
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    // noise
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // reverb
    const conv = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.6);
    }
    conv.buffer = ir;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    const revOut = ctx.createGain();
    revOut.gain.value = 0.5;
    this.reverbIn.connect(conv).connect(revOut).connect(this.musicBus);

    // delay
    const dl = ctx.createDelay(1);
    dl.delayTime.value = this.sd * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2400;
    this.delayIn = ctx.createGain();
    this.delayIn.connect(dl);
    dl.connect(dlp).connect(fb).connect(dl);
    const dOut = ctx.createGain();
    dOut.gain.value = 0.5;
    dlp.connect(dOut).connect(this.musicBus);

    this.buildContinuous();

    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.tick(), 40);
  }

  dispose() {
    if (this.timer) window.clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }
  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.62 : 0, this.ctx.currentTime, 0.1);
    return this.musicOn;
  }

  // ---------------------------------------------------------------- continuous
  private noiseSrc() {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start();
    return s;
  }

  private buildContinuous() {
    const ctx = this.ctx!;
    // city ambience (distant traffic rumble + air)
    const n1 = this.noiseSrc();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.07;
    n1.connect(lp).connect(this.amb).connect(this.sfxBus);

    // engine
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = 0;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    o1.connect(f);
    o2.connect(g2).connect(f);
    f.connect(g).connect(this.sfxBus);
    o1.start();
    o2.start();
    this.eng = { o1, o2, f, g };

    // tyre skid
    const n2 = this.noiseSrc();
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 1500;
    sf.Q.value = 1.2;
    const sg = ctx.createGain();
    sg.gain.value = 0;
    n2.connect(sf).connect(sg).connect(this.sfxBus);
    this.skid = { g: sg, f: sf };

    // wind
    const n3 = this.noiseSrc();
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 700;
    wf.Q.value = 0.5;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    n3.connect(wf).connect(wg).connect(this.sfxBus);
    this.wind = { g: wg, f: wf };

    // horn
    const hg = ctx.createGain();
    hg.gain.value = 0;
    const h1 = ctx.createOscillator();
    h1.type = 'square';
    h1.frequency.value = 415;
    const h2 = ctx.createOscillator();
    h2.type = 'square';
    h2.frequency.value = 523;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 1800;
    h1.connect(hf);
    h2.connect(hf);
    hf.connect(hg).connect(this.sfxBus);
    h1.start();
    h2.start();
    this.horn = hg;
  }

  updateDrive(speed: number, throttle: number, inCar: boolean, boost: boolean, slip: number) {
    if (!this.ctx || !this.eng) return;
    const now = this.ctx.currentTime;
    const th = [0, 9, 17, 26, 35, 80];
    let gi = 0;
    while (gi < 4 && speed > th[gi + 1]) gi++;
    const ratio = Math.min(1, (speed - th[gi]) / (th[gi + 1] - th[gi]));
    const rpm = Math.max(0.1, 0.18 + ratio * 0.82 - (gi === 0 ? 0.05 : 0));
    const freq = 36 + rpm * 125 * (boost ? 1.12 : 1);
    this.eng.o1.frequency.setTargetAtTime(freq, now, 0.04);
    this.eng.o2.frequency.setTargetAtTime(freq * 0.5, now, 0.04);
    this.eng.f.frequency.setTargetAtTime(260 + rpm * 900 + throttle * 700, now, 0.06);
    this.eng.g.gain.setTargetAtTime(inCar ? 0.045 + 0.075 * Math.abs(throttle) + (boost ? 0.03 : 0) : 0, now, 0.08);
    if (this.skid) {
      const s = inCar && speed > 7 ? Math.min(1, Math.max(0, slip - 2.2) / 5) : 0;
      this.skid.g.gain.setTargetAtTime(s * 0.16, now, 0.05);
      this.skid.f.frequency.setTargetAtTime(1100 + speed * 20, now, 0.1);
    }
    if (this.wind) {
      this.wind.g.gain.setTargetAtTime(Math.min(0.12, (speed / 60) * 0.12), now, 0.2);
      this.wind.f.frequency.setTargetAtTime(500 + speed * 18, now, 0.2);
    }
    if (this.amb) this.amb.gain.setTargetAtTime(inCar ? 0.035 : 0.07, now, 0.4);
  }

  setHorn(on: boolean) {
    if (!this.ctx || !this.horn) return;
    this.horn.gain.setTargetAtTime(on ? 0.11 : 0, this.ctx.currentTime, 0.015);
  }

  // ---------------------------------------------------------------- one shots
  private noiseHit(t: number, dur: number, type: BiquadFilterType, freq: number, vol: number, q = 1) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  footstep(speed: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastFoot < 0.12) return;
    this.lastFoot = now;
    this.noiseHit(now, 0.07, 'bandpass', 220 + Math.random() * 160, 0.1 + Math.min(0.12, speed * 0.012), 0.8);
  }

  door() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, 0.12, 'lowpass', 500, 0.35);
    this.tone({ f: 90, t, d: 0.1, type: 'sine', v: 0.25, dest: this.sfxBus });
    this.tone({ f: 1800, t: t + 0.09, d: 0.02, type: 'square', v: 0.04, dest: this.sfxBus });
  }

  crash(impact: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, impact / 20);
    this.noiseHit(t, 0.35, 'lowpass', 900, 0.25 + v * 0.5);
    this.noiseHit(t, 0.12, 'highpass', 2500, 0.08 + v * 0.15);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    g.gain.setValueAtTime(0.4 * v + 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.35);
  }

  ui() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone({ f: 880, t, d: 0.05, type: 'triangle', v: 0.12, dest: this.sfxBus });
    this.tone({ f: 1320, t: t + 0.05, d: 0.08, type: 'triangle', v: 0.1, dest: this.sfxBus, rev: 0.3 });
  }

  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [76, 81, 88].forEach((m, i) =>
      this.tone({ f: mtof(m), t: t + i * 0.07, d: 0.12, r: 0.3, type: 'sine', v: 0.14, dest: this.sfxBus, rev: 0.5 })
    );
  }

  checkpoint() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [79, 83, 86, 91].forEach((m, i) =>
      this.tone({ f: mtof(m), t: t + i * 0.05, d: 0.08, r: 0.25, type: 'triangle', v: 0.13, dest: this.sfxBus, rev: 0.4 })
    );
  }

  complete() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [62, 66, 69, 74, 78, 81, 86];
    notes.forEach((m, i) => {
      this.tone({ f: mtof(m), t: t + i * 0.11, d: 0.3, r: 0.8, type: 'sawtooth', v: 0.07, lp: 2800, dest: this.sfxBus, rev: 0.7 });
      this.tone({ f: mtof(m + 12), t: t + i * 0.11, d: 0.2, r: 0.6, type: 'sine', v: 0.06, dest: this.sfxBus, rev: 0.7 });
    });
    [50, 57, 62, 66].forEach((m) =>
      this.tone({ f: mtof(m), t: t + 0.8, d: 1.2, r: 1.5, a: 0.05, type: 'sawtooth', v: 0.05, lp: 1500, dest: this.sfxBus, rev: 0.8 })
    );
  }

  fail() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [69, 65, 62, 57, 50].forEach((m, i) =>
      this.tone({ f: mtof(m), t: t + i * 0.18, d: 0.25, r: 0.5, type: 'square', v: 0.07, lp: 1200, dest: this.sfxBus, rev: 0.5 })
    );
  }

  phone() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      this.tone({ f: 1480, t: t + i * 0.18, d: 0.06, type: 'sine', v: 0.1, dest: this.sfxBus });
      this.tone({ f: 1760, t: t + i * 0.18 + 0.06, d: 0.06, type: 'sine', v: 0.1, dest: this.sfxBus });
    }
  }

  talk(who: string) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = ({ Veer: 150, Dev: 120, Jimmy: 135, Raghav: 90, Meera: 260, Kaalu: 105 } as Record<string, number>)[who] ?? 140;
    const n = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      this.tone({
        f: base * (1 + Math.random() * 0.7),
        t: t + i * 0.075,
        d: 0.04,
        r: 0.03,
        type: 'square',
        v: 0.035,
        lp: 1100,
        dest: this.sfxBus,
      });
    }
  }

  // ---------------------------------------------------------------- music
  private tone(o: ToneOpts) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.value = o.f;
    if (o.det) osc.detune.value = o.det;
    const g = ctx.createGain();
    const a = o.a ?? 0.005;
    const r = o.r ?? 0.05;
    g.gain.setValueAtTime(0, o.t);
    g.gain.linearRampToValueAtTime(o.v, o.t + a);
    g.gain.setValueAtTime(o.v, o.t + Math.max(a, o.d));
    g.gain.linearRampToValueAtTime(0, o.t + o.d + r);
    let node: AudioNode = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp * 2.5, o.t);
      f.frequency.exponentialRampToValueAtTime(o.lp, o.t + Math.max(0.05, o.d * 0.8));
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(o.dest ?? this.musicBus);
    if (o.rev) {
      const s = ctx.createGain();
      s.gain.value = o.rev;
      g.connect(s).connect(this.reverbIn);
    }
    if (o.dly) {
      const s = ctx.createGain();
      s.gain.value = o.dly;
      g.connect(s).connect(this.delayIn);
    }
    osc.start(o.t);
    osc.stop(o.t + o.d + r + 0.05);
  }

  private kick(t: number, v: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.3);
  }

  private mnoise(t: number, dur: number, type: BiquadFilterType, freq: number, vol: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.musicBus);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private snare(t: number, v: number) {
    this.mnoise(t, 0.17, 'highpass', 1600, v);
    this.tone({ f: 190, t, d: 0.05, r: 0.08, type: 'triangle', v: v * 0.6 });
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextTime < ctx.currentTime + 0.18) {
      this.sched(this.step, this.nextTime);
      this.nextTime += this.sd;
      this.step++;
    }
  }

  private sched(step: number, t: number) {
    const I = this.intensity;
    const sd = this.sd;
    const bar = Math.floor(step / 16) % 8;
    const s = step % 16;
    const ch = CHORDS[bar];

    // pad (always)
    if (s === 0) {
      ch.forEach((m, i) => {
        this.tone({ f: mtof(m), t, d: sd * 15, a: 0.5, r: 0.9, type: 'sawtooth', v: I >= 1 ? 0.028 : 0.04, lp: 700 + I * 250, det: (i - 1.5) * 6, rev: 0.8 });
      });
      if (I < 1) this.tone({ f: mtof(ROOTS[bar] + 12), t, d: sd * 15, a: 0.6, r: 1, type: 'sine', v: 0.06, rev: 0.4 });
    }

    // arp / pluck
    const arpDiv = I >= 1 ? 1 : 4;
    if (s % arpDiv === 0) {
      const note = ch[ARP[s]] + 12;
      const accent = s % 4 === 0 ? 1 : 0.65;
      const v = I >= 1 ? 0.05 * accent : 0.035;
      this.tone({ f: mtof(note), t, d: sd * 0.7, r: 0.12, type: 'triangle', v, lp: I >= 2 ? 3200 : 2200, rev: 0.35, dly: 0.35 });
    }

    // bass + drums (mission)
    if (I >= 1) {
      const b = BASS[s];
      if (b) {
        const m = ROOTS[bar] + (b === 2 ? 12 : b === 3 ? 7 : 0);
        this.tone({ f: mtof(m), t, d: sd * 1.6, r: 0.06, type: 'sawtooth', v: 0.15, lp: 420 });
        this.tone({ f: mtof(m - 12 < 24 ? m : m - 12), t, d: sd * 1.8, r: 0.06, type: 'sine', v: 0.2 });
      }
      if (s === 0 || s === 8 || s === 6 || (s === 14 && bar % 2 === 1)) this.kick(t, s === 0 || s === 8 ? 0.55 : 0.32);
      if (s === 4 || s === 12) this.snare(t, 0.2);
      if (I >= 2) {
        this.mnoise(t, 0.035, 'highpass', 7500, s % 4 === 2 ? 0.07 : 0.035);
        if (bar === 7 && s >= 12) this.snare(t, 0.1 + (s - 12) * 0.03);
        if (s === 14) this.mnoise(t, 0.2, 'highpass', 6500, 0.05);
      } else if (s % 2 === 0) {
        this.mnoise(t, 0.03, 'highpass', 7500, s % 4 === 2 ? 0.05 : 0.025);
      }
      // lead motif
      if (s % 2 === 0) {
        const n = LEAD[bar][s / 2];
        if (n) {
          const lv = I >= 2 ? 0.07 : 0.04;
          this.tone({ f: mtof(n), t, d: sd * 1.6, r: 0.15, type: 'sawtooth', v: lv, lp: 3000, det: -7, rev: 0.4, dly: 0.5 });
          this.tone({ f: mtof(n), t, d: sd * 1.6, r: 0.15, type: 'square', v: lv * 0.5, lp: 2400, det: 7, rev: 0.4, dly: 0.5 });
        }
      }
    } else {
      // free-roam: gentle hat and sub pulse
      if (s % 4 === 2) this.mnoise(t, 0.03, 'highpass', 8000, 0.018);
      if (s === 0 && bar % 2 === 0) this.kick(t, 0.2);
    }
  }
}
