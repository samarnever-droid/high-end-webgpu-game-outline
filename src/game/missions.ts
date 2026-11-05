import { blockCorner, nodePos } from './city';
import type { Game } from './game';

export interface Line { who: string; text: string }
export interface Step {
  enter?(g: Game): void;
  update(g: Game, dt: number): 'done' | void;
  exit?(g: Game): void;
}
export interface Respawn {
  px: number; pz: number; ph: number;
  inCar: boolean;
  car?: { x: number; z: number; h: number };
}
export interface Mission {
  id: number;
  title: string;
  tag: string;
  blurb: string;
  reward: number;
  intensity: number;
  respawn: Respawn;
  steps: Step[];
}

type P = { x: number; z: number };

// ---------------------------------------------------------------- places
export const SPAWN = blockCorner(1, 3, -1, 1); // (-218,-10)
export const DEV_POS = blockCorner(3, 3, -1, 1); // (-66,-10)
export const CAR_START = { x: -30, z: -2, h: Math.PI / 2 };
export const GARAGE = blockCorner(5, 5, -1, -1); // (86,86)
export const JIMMY_POS = { x: GARAGE.x + 1, z: GARAGE.z + 1 };
export const PICKUP = nodePos(7, 2);
export const DROP = nodePos(1, 7);
export const SUV_START = nodePos(2, 7);
export const SUV_PATH: [number, number][] = [[2, 7], [2, 5], [4, 5], [4, 2], [2, 2], [2, 1], [1, 1]];
export const RACE_POINTS: P[] = [
  nodePos(3, 1), nodePos(3, 3), nodePos(5, 3), nodePos(5, 4), nodePos(7, 4), nodePos(8, 4), { x: 392, z: 0 },
];
export const MEERA_POS = { x: 462, z: -3 };

// ---------------------------------------------------------------- step builders
const talk = (lines: Line[]): Step => ({
  enter: (g) => g.say(lines),
  update: (g) => (g.sayDone() ? 'done' : undefined),
});

const act = (fn: (g: Game) => void): Step => ({
  enter: fn,
  update: () => 'done',
});

interface ReachOpts {
  pos: () => P;
  r: number;
  mode?: 'foot' | 'car' | 'any';
  text: string;
  say?: Line[];
  color?: string;
  onEnter?: (g: Game) => void;
}
const reach = (o: ReachOpts): Step => ({
  enter: (g) => {
    if (o.say) g.say(o.say);
    o.onEnter?.(g);
  },
  update: (g) => {
    const p = o.pos();
    const mode = o.mode ?? 'any';
    if (mode === 'car' && !g.inCar) {
      g.setObjective('Apni gaadi me baitho  [F]');
      g.setMarkers([{ x: g.car.x, z: g.car.z, r: 3.2, color: '#38d6ff' }]);
      return;
    }
    if (mode === 'foot' && g.inCar) g.setObjective('Gaadi se utro  [F]  aur paidal jao');
    else g.setObjective(o.text);
    g.setMarkers([{ x: p.x, z: p.z, r: o.r, color: o.color ?? '#ffd23a' }]);
    if (g.distTo(p.x, p.z) < o.r && (mode !== 'foot' || !g.inCar)) return 'done';
  },
});

const enterCar = (text: string): Step => ({
  update: (g) => {
    g.setObjective(text);
    g.setMarkers([{ x: g.car.x, z: g.car.z, r: 3.2, color: '#38d6ff' }]);
    if (g.inCar) return 'done';
  },
});

const follow = (): Step => {
  let lost = 0;
  return {
    enter: (g) => {
      lost = 0;
      g.targetGo = true;
      g.setIntensity(2);
      g.say([{ who: 'Veer', text: 'Kaalu... seedha mujhe Raghav tak le chal.' }]);
    },
    update: (g, dt) => {
      const t = g.target;
      if (!t) return;
      const d = Math.hypot(t.x - g.car.x, t.z - g.car.z);
      g.setMarkers([{ x: t.x, z: t.z, r: 3.4, color: '#ff4d4d' }]);
      g.setObjective(g.inCar ? 'Kaalu ki kaali SUV ka peecha karo (zyada door mat jao)' : 'Gaadi me baitho! Kaalu nikal raha hai  [F]');
      if (d > 120) lost += dt / 7;
      else lost = Math.max(0, lost - dt / 3);
      g.setLost(lost);
      if (lost >= 1) {
        g.fail('Kaalu ki SUV haath se nikal gayi!');
        return;
      }
      if (g.targetArrived && d < 45) return 'done';
    },
    exit: (g) => g.setLost(null),
  };
};

const race = (pts: P[], bonus: number): Step => {
  let k = 0;
  return {
    enter: (g) => {
      k = 0;
      g.timerStart(125, 'RACE');
      g.setIntensity(2);
      g.setCheckpoints(0, pts.length);
    },
    update: (g) => {
      if (!g.inCar) {
        g.setObjective('Gaadi me baitho! Waqt chal raha hai  [F]');
        g.setMarkers([{ x: g.car.x, z: g.car.z, r: 3.2, color: '#38d6ff' }]);
        return;
      }
      g.setObjective(`Checkpoint ${k + 1}/${pts.length} — harbour tak race!`);
      const m = [{ x: pts[k].x, z: pts[k].z, r: 11, color: '#ffd23a' }];
      if (pts[k + 1]) m.push({ x: pts[k + 1].x, z: pts[k + 1].z, r: 7, color: '#ffffff' });
      g.setMarkers(m);
      if (g.distTo(pts[k].x, pts[k].z) < 12) {
        k++;
        g.audio.checkpoint();
        if (k >= pts.length) return 'done';
        g.timerAdd(bonus);
        g.setCheckpoints(k, pts.length);
        g.flash(`+${bonus}s`);
      }
    },
    exit: (g) => {
      g.timerStop();
      g.setCheckpoints(null, 0);
    },
  };
};

// ---------------------------------------------------------------- missions
export const MISSIONS: Mission[] = [
  {
    id: 1,
    title: 'Naya Shehar',
    tag: 'Chapter 1',
    blurb: 'Teen saal baad Neon Nagri. Paidal chalkar purane dost Dev se milo.',
    reward: 500,
    intensity: 0,
    respawn: { px: SPAWN.x, pz: SPAWN.z, ph: Math.PI / 2, inCar: false },
    steps: [
      reach({
        pos: () => DEV_POS,
        r: 3.6,
        mode: 'foot',
        text: 'Dev se milo — chai ke thele ke paas (Shift = daudo, Space = kudo)',
        onEnter: (g) => {
          g.setNPC('dev', DEV_POS);
          g.say([
            { who: 'Veer', text: 'Neon Nagri... teen saal baad bhi wahi shor, wahi roshni.' },
            { who: 'Veer', text: 'Meera ka phone band hai. Sirf ek insaan hai jo madad karega — Dev.' },
          ]);
        },
      }),
      talk([
        { who: 'Dev', text: 'Veer?! Oye tu zinda hai! Teen saal me ek call bhi nahi kiya, kameene.' },
        { who: 'Veer', text: 'Dev, baat sunn. Meera ka aphar ho gaya hai. Raghav Sethi ne kiya hai.' },
        { who: 'Dev', text: 'Raghav... Isse seedha mat ulajh. Pehle uske chhote mohre dhundhne honge.' },
        { who: 'Dev', text: 'Ye le meri gaadi ki chaabi — "Aphar GT". Jimmy ke garage jao, south-east me. Wo sab jaanta hai.' },
      ]),
    ],
  },
  {
    id: 2,
    title: 'Pehli Gaadi',
    tag: 'Chapter 2',
    blurb: 'Aphar GT lo aur Jimmy ke garage tak pahucho.',
    reward: 1000,
    intensity: 1,
    respawn: { px: -60, pz: -5, ph: Math.PI / 2, inCar: false, car: CAR_START },
    steps: [
      act((g) => {
        g.placeCar(CAR_START.x, CAR_START.z, CAR_START.h);
        g.setNPC('dev', DEV_POS);
        g.say([{ who: 'Dev', text: 'Gaadi wahin khadi hai. Tez chalana, par shehar ko mat tod dena!' }]);
      }),
      enterCar('Aphar GT me baitho  [F]'),
      reach({
        pos: () => GARAGE,
        r: 11,
        mode: 'car',
        text: "Jimmy's Garage tak pahucho (WASD, Space = handbrake, Shift = nitro)",
        onEnter: (g) =>
          g.say([
            { who: 'Veer', text: 'Aphar GT... kya awaaz hai. Chal Jimmy ke garage.' },
            { who: 'Veer', text: 'Hold H for horn. Traffic signal ka dhyan rakhna — shehar me sab kuch hota hai.' },
          ]),
      }),
      act((g) => g.setNPC('jimmy', JIMMY_POS)),
      talk([
        { who: 'Jimmy', text: 'Veer Rathore! Raghav ke baare me puchne aaya hai? Free me kuch nahi milta.' },
        { who: 'Jimmy', text: 'Ek parcel uthana hai Harbour ke paas se. Seedha south-west ke mere aadmi ko dena. 110 second.' },
        { who: 'Veer', text: 'Deal. Agar Meera ka pata na mila, to teri garage ki chhat pe party hogi.' },
      ]),
    ],
  },
  {
    id: 3,
    title: 'Delivery Dhamaka',
    tag: 'Chapter 3',
    blurb: 'Parcel uthao, 110 second me south-west pahucha do.',
    reward: 2500,
    intensity: 1,
    respawn: { px: 74, pz: 86, ph: Math.PI, inCar: true, car: { x: 74, z: 86, h: Math.PI } },
    steps: [
      reach({
        pos: () => PICKUP,
        r: 10,
        mode: 'car',
        text: 'Parcel uthao — peele marker tak jao',
        onEnter: (g) => {
          g.setNPC('jimmy', JIMMY_POS);
          g.say([{ who: 'Jimmy', text: 'Pickup north-east me hai. Parcel milte hi timer shuru!' }]);
        },
      }),
      act((g) => {
        g.timerStart(110, 'DELIVERY');
        g.setIntensity(2);
        g.audio.phone();
        g.say([
          { who: 'Jimmy', text: 'Parcel mil gaya? Ab 110 second. Signal todna mat... ya todna, par pakde mat jana!' },
        ]);
      }),
      reach({
        pos: () => DROP,
        r: 10,
        mode: 'car',
        text: 'Parcel south-west me pahucha do — time kam hai!',
      }),
      act((g) => {
        g.timerStop();
        g.audio.chime();
      }),
      talk([
        { who: 'Jimmy', text: 'Wah! Tu to purana Veer hi nikla. Ab suno — Raghav ka khaas aadmi Kaalu kaali SUV me nikal raha hai.' },
        { who: 'Jimmy', text: 'Wo seedha Raghav ke ghar jaata hai. Peecha kar, par zyada paas mat jaana.' },
      ]),
    ],
  },
  {
    id: 4,
    title: 'Peecha Karo',
    tag: 'Chapter 4',
    blurb: "Kaalu ki kaali SUV ka peecha karo, bina use khoye.",
    reward: 4000,
    intensity: 1,
    respawn: { px: DROP.x, pz: DROP.z, ph: Math.PI / 2, inCar: true, car: { x: DROP.x, z: DROP.z, h: Math.PI / 2 } },
    steps: [
      act((g) => {
        g.spawnTarget(SUV_PATH);
        g.say([{ who: 'Veer', text: 'Wahan hai wo kaali SUV. Paas jaa.' }]);
      }),
      {
        update: (g) => {
          const t = g.target;
          if (!t) return;
          g.setObjective(g.inCar ? 'Kaali SUV ke paas jao' : 'Gaadi me baitho  [F]');
          g.setMarkers([{ x: t.x, z: t.z, r: 4, color: '#ff4d4d' }]);
          if (g.inCar && Math.hypot(t.x - g.car.x, t.z - g.car.z) < 38) return 'done';
        },
      },
      follow(),
      act((g) => {
        g.audio.phone();
        g.setIntensity(1);
      }),
      talk([
        { who: 'Kaalu', text: 'Boss ko bol do, parcel pahuch gaya... Arre, ye gaadi kiski hai peeche?!' },
        { who: 'Raghav', text: 'Veer Rathore. Mujhe pata tha tu aayega. Meera safe hai... abhi tak.' },
        { who: 'Raghav', text: 'Harbour pe aa. 125 second. Late hua to Meera ko ship pe chadha dunga. Aphar dekjo!' },
      ]),
    ],
  },
  {
    id: 5,
    title: 'Aphar Dekjo',
    tag: 'Final Chapter',
    blurb: 'Checkpoint race, harbour tak. Meera ko bachao.',
    reward: 10000,
    intensity: 2,
    respawn: { px: nodePos(1, 1).x, pz: nodePos(1, 1).z, ph: Math.PI / 2, inCar: true, car: { x: nodePos(1, 1).x, z: nodePos(1, 1).z, h: Math.PI / 2 } },
    steps: [
      act((g) => {
        g.removeTarget();
        g.say([{ who: 'Veer', text: 'Har checkpoint pe waqt milega. Ek bhi galti nahi.' }]);
      }),
      race(RACE_POINTS, 9),
      reach({
        pos: () => MEERA_POS,
        r: 3.4,
        mode: 'foot',
        text: 'Gaadi se utro [F] aur Meera tak daudo!',
        color: '#ff5fb0',
        onEnter: (g) => {
          g.setNPC('meera', MEERA_POS);
          g.setIntensity(2);
          g.say([{ who: 'Meera', text: 'Bhaiya!! Yahan hu main!' }]);
        },
      }),
      talk([
        { who: 'Meera', text: 'Bhaiya! Mujhe pata tha tum aaoge!' },
        { who: 'Veer', text: 'Ab koi tujhe haath nahi lagayega, Meera. Chal ghar chalte hain.' },
        { who: 'Raghav', text: 'Ye abhi khatam nahi hua, Rathore... Neon Nagri ke har kone me meri nazar hai.' },
        { who: 'Veer', text: 'Aaja phir. Is baar main tera aphar karunga.' },
      ]),
      act((g) => g.finale()),
    ],
  },
];
