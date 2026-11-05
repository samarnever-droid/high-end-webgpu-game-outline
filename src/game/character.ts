import * as THREE from 'three/webgpu';

export interface HumanoidOptions {
  skin: number;
  hair: number;
  jacket: number;
  accent: number;
  shirt: number;
  pants: number;
  shoes: number;
  hairStyle: 'short' | 'long' | 'cap';
  beard?: boolean;
  glasses?: boolean;
  female?: boolean;
  scale?: number;
  watch?: boolean;
}

export const VEER: HumanoidOptions = {
  skin: 0xc58b63,
  hair: 0x120d0a,
  jacket: 0x1b2a41,
  accent: 0xe8a33d,
  shirt: 0xf1efe9,
  pants: 0x2a3547,
  shoes: 0xe9e9e9,
  hairStyle: 'short',
  beard: true,
  glasses: true,
  watch: true,
};
export const DEV: HumanoidOptions = {
  skin: 0xa86f48, hair: 0x1a1210, jacket: 0xc98a1a, accent: 0x3a2412, shirt: 0x232323,
  pants: 0x3b4a5a, shoes: 0x4a3a2a, hairStyle: 'short', beard: true, scale: 1.04,
};
export const JIMMY: HumanoidOptions = {
  skin: 0xd09a74, hair: 0x2b1b12, jacket: 0x2d5fa8, accent: 0xf2c230, shirt: 0xd9d9d9,
  pants: 0x2d5fa8, shoes: 0x222222, hairStyle: 'cap', beard: false,
};
export const MEERA: HumanoidOptions = {
  skin: 0xd29a78, hair: 0x140b08, jacket: 0xa56ccf, accent: 0xffffff, shirt: 0xf6f0f8,
  pants: 0x39465e, shoes: 0xf2f2f2, hairStyle: 'long', female: true, scale: 0.94,
};

const mat = (color: number, rough = 0.7, metal = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, cast = true) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  parent.add(mesh);
  return mesh;
}

function limb(r: number, len: number) {
  const g = new THREE.CapsuleGeometry(r, len, 6, 16);
  g.translate(0, -(len / 2 + r), 0);
  return g;
}

export interface BodyState {
  speed: number;
  air: boolean;
  sit: boolean;
  steer: number;
  throttle?: number;
}

type Pose = Record<string, number>;

export class Humanoid {
  root = new THREE.Group();
  onStep?: (speed: number) => void;
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private elL = new THREE.Group();
  private elR = new THREE.Group();
  private thL = new THREE.Group();
  private thR = new THREE.Group();
  private knL = new THREE.Group();
  private knR = new THREE.Group();
  private anL = new THREE.Group();
  private anR = new THREE.Group();
  private phase = 0;
  private stepCount = 0;
  private time = Math.random() * 10;
  private cur: Pose = {};

  constructor(o: HumanoidOptions) {
    const sw = o.female ? 0.86 : 1;
    const skin = mat(o.skin, 0.55);
    const hair = mat(o.hair, 0.4);
    const jacket = mat(o.jacket, 0.62);
    const accent = mat(o.accent, 0.55);
    const shirt = mat(o.shirt, 0.85);
    const pants = mat(o.pants, 0.85);
    const shoe = mat(o.shoes, 0.55);
    const sole = mat(0xf2f2f2, 0.5);
    const gold = mat(0xd9b24a, 0.22, 1);
    const dark = mat(0x0d0d0f, 0.4);
    const lens = mat(0x0a0d18, 0.04, 0.95);

    this.hips.position.y = 1.0;
    this.root.add(this.hips);

    // pelvis
    const pg = new THREE.CapsuleGeometry(0.115, 0.12, 6, 18);
    pg.rotateZ(Math.PI / 2);
    const pelvis = add(this.hips, pg, pants, 0, 0, 0);
    pelvis.scale.set(sw, 1, 0.78);
    // belt
    const belt = add(this.hips, new THREE.TorusGeometry(0.15, 0.012, 8, 28), dark, 0, 0.065, 0);
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1.12 * sw, 0.84, 1);
    add(this.hips, new THREE.BoxGeometry(0.03, 0.025, 0.012), gold, 0, 0.065, 0.126);

    // spine / torso
    this.spine.position.y = 0.06;
    this.hips.add(this.spine);
    const chest = add(this.spine, new THREE.CapsuleGeometry(0.15, 0.26, 8, 22), jacket, 0, 0.3, 0);
    chest.scale.set(1.3 * sw, 1, 0.78);
    const hem = add(this.spine, new THREE.TorusGeometry(0.138, 0.02, 8, 28), accent, 0, 0.1, 0);
    hem.rotation.x = Math.PI / 2;
    hem.scale.set(1.3 * sw, 0.78, 1);
    // tee under open jacket + lapels
    add(this.spine, new THREE.BoxGeometry(0.14 * sw, 0.34, 0.02), shirt, 0, 0.33, 0.112);
    for (const sx of [-1, 1]) {
      const lap = add(this.spine, new THREE.BoxGeometry(0.028, 0.4, 0.02), accent, sx * 0.082 * sw, 0.33, 0.118);
      lap.rotation.z = -sx * 0.06;
    }
    const collar = add(this.spine, new THREE.TorusGeometry(0.088, 0.03, 8, 22), accent, 0, 0.565, -0.005);
    collar.rotation.x = Math.PI / 2 - 0.25;
    collar.scale.set(1.05 * sw, 1, 0.9);
    // chain
    const chain = add(this.spine, new THREE.TorusGeometry(0.075, 0.005, 6, 24), gold, 0, 0.5, 0.075);
    chain.rotation.x = Math.PI / 2 - 0.6;
    add(this.spine, new THREE.SphereGeometry(0.014, 12, 10), gold, 0, 0.43, 0.125);

    // neck + head
    add(this.spine, new THREE.CylinderGeometry(0.046, 0.052, 0.12, 14), skin, 0, 0.64, 0);
    this.head.position.set(0, 0.73, 0.005);
    this.spine.add(this.head);
    const cran = add(this.head, new THREE.SphereGeometry(0.105, 36, 28), skin, 0, 0.02, 0);
    cran.scale.set(0.92, 1.08, 1.0);
    const jaw = add(this.head, new THREE.SphereGeometry(0.086, 28, 20), skin, 0, -0.05, 0.018);
    jaw.scale.set(0.96, 1.0, 0.95);
    // ears
    for (const sx of [-1, 1]) {
      const ear = add(this.head, new THREE.SphereGeometry(0.022, 12, 10), skin, sx * 0.098, -0.002, -0.004);
      ear.scale.set(0.45, 1.05, 0.75);
    }
    // nose
    const nose = add(this.head, new THREE.SphereGeometry(0.02, 14, 12), skin, 0, -0.008, 0.106);
    nose.scale.set(0.8, 1.25, 1.0);
    add(this.head, new THREE.SphereGeometry(0.012, 10, 8), skin, 0, -0.026, 0.117);
    // eyes
    const white = mat(0xf3f1ee, 0.3);
    const iris = mat(0x1b0f08, 0.2);
    for (const sx of [-1, 1]) {
      add(this.head, new THREE.SphereGeometry(0.0165, 14, 12), white, sx * 0.036, 0.024, 0.093, false);
      add(this.head, new THREE.SphereGeometry(0.0095, 12, 10), iris, sx * 0.036, 0.024, 0.101, false);
      const brow = add(this.head, new THREE.BoxGeometry(0.044, 0.008, 0.012), hair, sx * 0.037, 0.05, 0.097, false);
      brow.rotation.z = sx * 0.16;
    }
    // mouth
    add(this.head, new THREE.BoxGeometry(0.04, 0.0065, 0.008), mat(0x6e2f2a, 0.5), 0, -0.064, 0.094, false);
    add(this.head, new THREE.BoxGeometry(0.03, 0.007, 0.008), mat(0x8a4038, 0.5), 0, -0.071, 0.092, false);
    // beard
    if (o.beard) {
      const bg = new THREE.SphereGeometry(0.0895, 28, 14, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.4);
      const beard = add(this.head, bg, hair, 0, -0.05, 0.018);
      beard.scale.set(0.97, 1.0, 0.96);
      add(this.head, new THREE.BoxGeometry(0.045, 0.01, 0.008), hair, 0, -0.054, 0.096, false);
    }
    // hair
    const cap = new THREE.SphereGeometry(0.113, 36, 22, 0, Math.PI * 2, 0, Math.PI * 0.5);
    if (o.hairStyle === 'cap') {
      const capMat = mat(o.accent, 0.6);
      const c = add(this.head, cap, capMat, 0, 0.036, -0.002);
      c.rotation.x = -0.12;
      add(this.head, new THREE.CylinderGeometry(0.1, 0.1, 0.012, 20, 1, false, -Math.PI / 2, Math.PI), capMat, 0, 0.052, 0.1).rotation.x = 0.05;
    } else {
      const c = add(this.head, cap, hair, 0, 0.042, -0.012);
      c.rotation.x = -0.32;
      c.scale.set(1.0, 1.0, 1.02);
      if (o.hairStyle === 'short') {
        const q = add(this.head, new THREE.CapsuleGeometry(0.035, 0.07, 6, 12), hair, 0, 0.128, 0.05);
        q.rotation.x = Math.PI / 2 - 0.35;
        q.scale.set(1.8, 1, 0.9);
        for (const sx of [-1, 1]) add(this.head, new THREE.SphereGeometry(0.028, 10, 8), hair, sx * 0.1, 0.03, -0.02).scale.set(0.5, 1.4, 1.0);
      } else {
        const back = add(this.head, new THREE.CapsuleGeometry(0.085, 0.34, 8, 16), hair, 0, -0.17, -0.06);
        back.scale.set(1.05, 1, 0.62);
        for (const sx of [-1, 1]) {
          const lock = add(this.head, new THREE.CapsuleGeometry(0.02, 0.2, 6, 10), hair, sx * 0.094, -0.07, 0.03);
          lock.rotation.z = sx * 0.04;
        }
      }
    }
    // sunglasses
    if (o.glasses) {
      for (const sx of [-1, 1]) {
        const l = add(this.head, new THREE.CylinderGeometry(0.031, 0.031, 0.008, 22), lens, sx * 0.037, 0.024, 0.104, false);
        l.rotation.x = Math.PI / 2;
        l.scale.set(1.2, 1, 0.82);
        const fr = add(this.head, new THREE.TorusGeometry(0.0335, 0.0042, 8, 22), dark, sx * 0.037, 0.024, 0.104, false);
        fr.scale.set(1.2, 0.82, 1);
        const tmp = add(this.head, new THREE.BoxGeometry(0.004, 0.004, 0.11), dark, sx * 0.0995, 0.032, 0.045, false);
        tmp.rotation.y = sx * 0.04;
      }
      add(this.head, new THREE.BoxGeometry(0.022, 0.006, 0.006), dark, 0, 0.03, 0.108, false);
    }

    // arms
    for (const side of [-1, 1]) {
      const sh = side === -1 ? this.armL : this.armR;
      const el = side === -1 ? this.elL : this.elR;
      sh.position.set(side * 0.205 * sw * 1.12, 0.5, 0);
      this.spine.add(sh);
      add(sh, new THREE.SphereGeometry(0.066, 18, 14), jacket, 0, 0, 0);
      add(sh, limb(0.055, 0.19), jacket);
      el.position.y = -0.3;
      sh.add(el);
      add(el, new THREE.SphereGeometry(0.052, 14, 12), jacket, 0, 0, 0);
      add(el, limb(0.046, 0.18), jacket);
      const cuff = add(el, new THREE.TorusGeometry(0.046, 0.011, 8, 18), accent, 0, -0.262, 0);
      cuff.rotation.x = Math.PI / 2;
      const hand = new THREE.Group();
      hand.position.y = -0.285;
      el.add(hand);
      const palm = add(hand, new THREE.SphereGeometry(0.038, 14, 12), skin, 0, -0.04, 0);
      palm.scale.set(1.0, 1.15, 0.62);
      for (let f = 0; f < 4; f++) {
        const fg = add(hand, new THREE.CapsuleGeometry(0.0085, 0.04, 4, 8), skin, (f - 1.5) * 0.0165, -0.092, 0.006);
        fg.rotation.x = -0.28;
      }
      const th = add(hand, new THREE.CapsuleGeometry(0.0105, 0.035, 4, 8), skin, side * 0.036, -0.04, 0.012);
      th.rotation.z = side * 0.5;
      th.rotation.x = -0.4;
      if (o.watch && side === -1) {
        const w = add(el, new THREE.CylinderGeometry(0.05, 0.05, 0.026, 20), dark, 0, -0.23, 0);
        w.scale.set(1, 1, 1);
        add(el, new THREE.CylinderGeometry(0.02, 0.02, 0.006, 16), gold, -0.0, -0.23, 0.052).rotation.x = Math.PI / 2;
      }
    }

    // legs
    for (const side of [-1, 1]) {
      const th = side === -1 ? this.thL : this.thR;
      const kn = side === -1 ? this.knL : this.knR;
      const an = side === -1 ? this.anL : this.anR;
      th.position.set(side * 0.092 * sw, -0.03, 0);
      this.hips.add(th);
      add(th, limb(0.088, 0.3), pants);
      kn.position.y = -0.47;
      th.add(kn);
      add(kn, new THREE.SphereGeometry(0.069, 14, 12), pants, 0, 0, 0);
      add(kn, limb(0.063, 0.32), pants);
      // jeans cuff
      const jc = add(kn, new THREE.TorusGeometry(0.066, 0.012, 8, 18), mat(0x1c2535, 0.9), 0, -0.4, 0);
      jc.rotation.x = Math.PI / 2;
      an.position.y = -0.44;
      kn.add(an);
      const sg = new THREE.CapsuleGeometry(0.052, 0.12, 8, 14);
      sg.rotateX(Math.PI / 2);
      const upper = add(an, sg, shoe, 0, -0.02, 0.05);
      upper.scale.set(1.05, 0.9, 1);
      add(an, new THREE.BoxGeometry(0.108, 0.03, 0.285), sole, 0, -0.058, 0.055);
      add(an, new THREE.BoxGeometry(0.06, 0.012, 0.08), accent, 0, 0.035, 0.03);
    }

    this.root.scale.setScalar(o.scale ?? 0.95);
    this.root.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).receiveShadow = false;
    });
  }

  update(dt: number, st: BodyState) {
    this.time += dt;
    const t = this.time;
    const p: Pose = {
      thL: 0, thR: 0, knL: 0.04, knR: 0.04, anL: 0, anR: 0,
      shL: 0.02, shR: 0.02, elL: -0.12, elR: -0.12,
      spX: 0, spZ: 0, hdX: 0, hipY: 0, hipZ: 0, hipRY: 0, shZL: 0.06, shZR: -0.06,
    };
    if (st.sit) {
      p.hipY = -0.43;
      p.hipZ = -0.06;
      p.thL = p.thR = -1.48;
      p.knL = p.knR = 1.5;
      p.anL = p.anR = -0.1;
      p.thR -= (st.throttle ?? 0) * 0.08;
      p.shL = -1.0 + st.steer * 0.35;
      p.shR = -1.0 - st.steer * 0.35;
      p.elL = p.elR = -0.65;
      p.spX = -0.08;
      p.hipRY = 0;
      p.hdX = 0.04;
      p.shZL = -0.15;
      p.shZR = 0.15;
    } else if (st.air) {
      p.thL = -0.75;
      p.thR = 0.25;
      p.knL = 1.0;
      p.knR = 0.7;
      p.anL = 0.2;
      p.shL = -1.9;
      p.shR = -1.6;
      p.elL = p.elR = -0.5;
      p.spX = 0.08;
      p.shZL = 0.35;
      p.shZR = -0.35;
    } else if (st.speed > 0.35) {
      const run = Math.min(1, Math.max(0, (st.speed - 2.4) / 4.6));
      this.phase += dt * ((Math.PI * 2 * st.speed) / (1.7 + 1.5 * run));
      const ph = this.phase;
      const A = 0.46 + 0.5 * run;
      const K = 0.8 + 0.85 * run;
      const AA = 0.5 + 0.55 * run;
      p.thL = Math.sin(ph) * A;
      p.thR = -Math.sin(ph) * A;
      p.knL = 0.1 + K * Math.max(0, -Math.cos(ph));
      p.knR = 0.1 + K * Math.max(0, Math.cos(ph));
      p.shL = -Math.sin(ph) * AA;
      p.shR = Math.sin(ph) * AA;
      p.elL = -(0.25 + run * 1.0) - Math.max(0, Math.sin(ph)) * 0.3 * run;
      p.elR = -(0.25 + run * 1.0) - Math.max(0, -Math.sin(ph)) * 0.3 * run;
      p.hipY = -Math.abs(Math.sin(ph)) * (0.045 + 0.05 * run);
      p.spX = 0.04 + run * 0.2;
      p.spZ = Math.sin(ph) * 0.03;
      p.hipRY = Math.sin(ph) * 0.12;
      p.hdX = -run * 0.12;
      p.anL = -(p.thL + p.knL) * 0.7;
      p.anR = -(p.thR + p.knR) * 0.7;
      const sc = Math.floor(ph / Math.PI);
      if (sc !== this.stepCount) {
        this.stepCount = sc;
        this.onStep?.(st.speed);
      }
    } else {
      // idle: breathing + weight shift
      const b = Math.sin(t * 1.9);
      p.spX = 0.012 + b * 0.012;
      p.hdX = Math.sin(t * 0.7) * 0.03;
      p.spZ = Math.sin(t * 0.5) * 0.018;
      p.shL = 0.04 + b * 0.01;
      p.shR = 0.04 - b * 0.01;
      p.elL = -0.18;
      p.elR = -0.2;
      p.thL = 0.02 + Math.sin(t * 0.5) * 0.015;
      p.thR = -0.02;
      p.hipY = -0.004;
    }
    const k = 1 - Math.exp(-dt * (st.sit ? 10 : 16));
    for (const key in p) {
      const c = this.cur[key] ?? p[key];
      this.cur[key] = c + (p[key] - c) * k;
    }
    const c = this.cur;
    this.thL.rotation.x = c.thL;
    this.thR.rotation.x = c.thR;
    this.knL.rotation.x = c.knL;
    this.knR.rotation.x = c.knR;
    this.anL.rotation.x = c.anL;
    this.anR.rotation.x = c.anR;
    this.armL.rotation.x = c.shL;
    this.armR.rotation.x = c.shR;
    this.armL.rotation.z = c.shZL;
    this.armR.rotation.z = c.shZR;
    this.elL.rotation.x = c.elL;
    this.elR.rotation.x = c.elR;
    this.spine.rotation.x = c.spX;
    this.spine.rotation.z = c.spZ;
    this.spine.rotation.y = -c.hipRY * 0.8;
    this.hips.rotation.y = c.hipRY;
    this.head.rotation.x = c.hdX;
    this.hips.position.y = 1.0 + c.hipY;
    this.hips.position.z = c.hipZ;
  }
}

// ------------------------------------------------------------------ light-weight pedestrians
const PED_SKIN = [0xc58b63, 0xa86f48, 0xd9a47e, 0x8d5a3c, 0xe0b090];
const PED_TOP = [0xd94f4f, 0x3f7fd9, 0xf2f2f2, 0x2f2f33, 0x58a864, 0xe0a030, 0x8a5cc4, 0x1e8a8a, 0xc4c4c4];
const PED_BOT = [0x25272c, 0x3b4a5a, 0x5a4a3a, 0x1d2a44, 0x6b6b70];
const PED_HAIR = [0x0e0a08, 0x2a1a10, 0x4a3020, 0x161616];

let pedGeo: Record<string, THREE.BufferGeometry> | null = null;
const pedMats = new Map<number, THREE.MeshStandardMaterial>();
function pm(c: number, r = 0.8) {
  const k = c * 7 + Math.round(r * 10);
  let m = pedMats.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, roughness: r });
    pedMats.set(k, m);
  }
  return m;
}

export class Pedestrian {
  root = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  phase = Math.random() * 6;
  constructor(rng: () => number) {
    if (!pedGeo) {
      const torso = new THREE.CapsuleGeometry(0.15, 0.34, 4, 12);
      const head = new THREE.SphereGeometry(0.105, 14, 12);
      const hairG = new THREE.SphereGeometry(0.112, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const leg = limb(0.07, 0.66);
      const arm = limb(0.048, 0.44);
      pedGeo = { torso, head, hairG, leg, arm };
    }
    const pick = <T,>(a: T[]) => a[Math.floor(rng() * a.length)];
    const skin = pm(pick(PED_SKIN), 0.6);
    const top = pm(pick(PED_TOP));
    const bot = pm(pick(PED_BOT));
    const hair = pm(pick(PED_HAIR), 0.5);
    const g = pedGeo;
    const s = 0.92 + rng() * 0.16;
    const body = new THREE.Mesh(g.torso, top);
    body.position.y = 1.15;
    body.scale.set(1.2, 1, 0.72);
    const head = new THREE.Mesh(g.head, skin);
    head.position.y = 1.62;
    const hr = new THREE.Mesh(g.hairG, hair);
    hr.position.y = 1.64;
    this.root.add(body, head, hr);
    this.legL.position.set(-0.09, 0.78, 0);
    this.legR.position.set(0.09, 0.78, 0);
    this.legL.add(new THREE.Mesh(g.leg, bot));
    this.legR.add(new THREE.Mesh(g.leg, bot));
    this.armL.position.set(-0.22, 1.4, 0);
    this.armR.position.set(0.22, 1.4, 0);
    this.armL.add(new THREE.Mesh(g.arm, top));
    this.armR.add(new THREE.Mesh(g.arm, top));
    this.root.add(this.legL, this.legR, this.armL, this.armR);
    this.root.scale.setScalar(s);
    body.castShadow = true;
  }
  update(dt: number, speed: number) {
    this.phase += dt * speed * 4.6;
    const a = Math.min(0.9, 0.3 + speed * 0.17);
    const s = Math.sin(this.phase);
    this.legL.rotation.x = s * a;
    this.legR.rotation.x = -s * a;
    this.armL.rotation.x = -s * a * 0.9;
    this.armR.rotation.x = s * a * 0.9;
  }
}
