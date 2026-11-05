import * as THREE from 'three';
import { bulletHoleTex, flareSprite, skidTex, smokeSprite, softSprite } from './textures';

const pvert = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
}`;
const pfrag = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
void main(){
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.003) discard;
}`;

class Pool {
  n: number;
  pos: Float32Array; col: Float32Array; size: Float32Array;
  vel: Float32Array; life: Float32Array; maxLife: Float32Array; s0: Float32Array; s1: Float32Array; a0: Float32Array; base: Float32Array; grav: Float32Array; drag: Float32Array;
  head = 0;
  points: THREE.Points;
  constructor(n: number, map: THREE.Texture, additive: boolean, scale: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.maxLife = new Float32Array(n).fill(1);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n); this.base = new Float32Array(n * 3);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const m = new THREE.ShaderMaterial({
      vertexShader: pvert, fragmentShader: pfrag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: map }, uScale: { value: scale } },
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, r: number, g: number, b: number, a: number, grav = 0, drag = 1) {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a;
    this.base[i * 3] = r; this.base[i * 3 + 1] = g; this.base[i * 3 + 2] = b;
    this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt: number, scale: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = scale;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const d = Math.pow(this.drag[i], dt * 60);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4] = this.base[i * 3]; this.col[i * 4 + 1] = this.base[i * 3 + 1]; this.col[i * 4 + 2] = this.base[i * 3 + 2];
      this.col[i * 4 + 3] = this.a0[i] * (t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
  }
}

export class FX {
  group = new THREE.Group();
  smoke = new Pool(1800, smokeSprite(), false, 900);
  glow = new Pool(1600, softSprite(), true, 900);
  flare = new Pool(80, flareSprite(), true, 900);
  private tracers: { m: THREE.Mesh; t: number }[] = [];
  private tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  private holes: THREE.InstancedMesh;
  private holeI = 0;
  private skids: THREE.InstancedMesh;
  private skidI = 0;
  private debris: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; t: number }[] = [];
  private shock: { m: THREE.Mesh; t: number }[] = [];
  light: THREE.PointLight;
  lightT = 0;
  shake = 0;
  private dummy = new THREE.Object3D();

  constructor() {
    this.group.add(this.smoke.points, this.glow.points, this.flare.points);
    const tm = new THREE.MeshBasicMaterial({ color: 0xffd890, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(this.tracerGeo, tm);
      m.visible = false;
      this.group.add(m);
      this.tracers.push({ m, t: 0 });
    }
    const hm = new THREE.MeshBasicMaterial({ map: bulletHoleTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.holes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.16), hm, 120);
    this.holes.frustumCulled = false;
    this.holes.count = 0;
    const sm = new THREE.MeshBasicMaterial({ map: skidTex(), transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    this.skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 0.9), sm, 700);
    this.skids.frustumCulled = false;
    this.skids.count = 0;
    this.group.add(this.holes, this.skids);
    const dm = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.6 });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.7), dm.clone());
      m.visible = false;
      m.castShadow = true;
      this.group.add(m);
      this.debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(), t: 0 });
    }
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.group.add(m);
      this.shock.push({ m, t: 0 });
    }
    this.light = new THREE.PointLight(0xffa050, 0, 60, 1.6);
    this.group.add(this.light);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const tr = this.tracers.find((t) => !t.m.visible) ?? this.tracers[0];
    const d = from.distanceTo(to);
    tr.m.position.copy(from).lerp(to, 0.5);
    tr.m.lookAt(to);
    tr.m.scale.set(1, 1, Math.min(d, 14));
    tr.m.position.copy(from).lerp(to, Math.min(0.5, 7 / d));
    tr.m.visible = true;
    tr.t = 0.06;
  }
  hole(p: THREE.Vector3, n: THREE.Vector3) {
    const d = this.dummy;
    d.position.copy(p).addScaledVector(n, 0.01);
    d.lookAt(p.clone().add(n));
    d.rotation.z = Math.random() * 6;
    d.updateMatrix();
    this.holes.setMatrixAt(this.holeI % 120, d.matrix);
    this.holeI++;
    this.holes.count = Math.min(120, this.holeI);
    this.holes.instanceMatrix.needsUpdate = true;
  }
  skid(x: number, y: number, z: number, heading: number) {
    const d = this.dummy;
    d.position.set(x, y + 0.025, z);
    d.rotation.set(-Math.PI / 2, 0, -heading + Math.PI, 'YXZ');
    d.rotation.set(-Math.PI / 2, 0, 0);
    d.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), heading);
    d.updateMatrix();
    this.skids.setMatrixAt(this.skidI % 700, d.matrix);
    this.skidI++;
    this.skids.count = Math.min(700, this.skidI);
    this.skids.instanceMatrix.needsUpdate = true;
  }
  spark(p: THREE.Vector3, n: THREE.Vector3, count = 6, color: [number, number, number] = [1, 0.7, 0.3]) {
    for (let i = 0; i < count; i++) {
      this.glow.emit(p.x, p.y, p.z, n.x * 3 + (Math.random() - 0.5) * 5, n.y * 3 + Math.random() * 3, n.z * 3 + (Math.random() - 0.5) * 5, 0.25 + Math.random() * 0.25, 0.12, 0.02, color[0], color[1], color[2], 1, 12, 0.98);
    }
    this.smoke.emit(p.x, p.y, p.z, n.x, n.y + 0.5, n.z, 0.7, 0.2, 0.9, 0.6, 0.6, 0.6, 0.3, -0.3, 0.96);
  }
  muzzle(p: THREE.Vector3, dir: THREE.Vector3) {
    this.glow.emit(p.x, p.y, p.z, dir.x, dir.y, dir.z, 0.06, 0.5, 0.2, 1, 0.8, 0.4, 1);
    this.smoke.emit(p.x, p.y, p.z, dir.x * 2, dir.y * 2 + 0.3, dir.z * 2, 0.8, 0.12, 0.7, 0.8, 0.8, 0.8, 0.2, -0.2, 0.95);
    this.light.position.copy(p);
    this.light.intensity = 40;
    this.lightT = 0.05;
  }
  dust(x: number, y: number, z: number, vx: number, vz: number, amt = 1, tint: [number, number, number] = [0.7, 0.68, 0.62]) {
    for (let i = 0; i < amt; i++) this.smoke.emit(x + (Math.random() - 0.5) * 0.5, y + 0.1, z + (Math.random() - 0.5) * 0.5, vx * 0.2 + (Math.random() - 0.5), 0.5 + Math.random(), vz * 0.2 + (Math.random() - 0.5), 1 + Math.random() * 0.8, 0.6, 2.8, tint[0], tint[1], tint[2], 0.35, -0.1, 0.97);
  }
  tyreSmoke(x: number, y: number, z: number, vx: number, vz: number) {
    this.smoke.emit(x, y + 0.15, z, vx * 0.1 + (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.5, vz * 0.1 + (Math.random() - 0.5) * 0.6, 1.1 + Math.random() * 0.5, 0.5, 2.4, 0.85, 0.85, 0.88, 0.28, -0.15, 0.97);
  }
  carSmoke(x: number, y: number, z: number, heat: number) {
    const dark = Math.max(0.05, 0.5 - heat * 0.45);
    this.smoke.emit(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.8, 2 + Math.random() * 2, (Math.random() - 0.5) * 0.8, 1.8 + Math.random(), 0.6, 3.5, dark, dark, dark, 0.5, -0.4, 0.985);
    if (heat > 0.5) this.glow.emit(x + (Math.random() - 0.5) * 0.7, y - 0.1, z + (Math.random() - 0.5) * 0.7, (Math.random() - 0.5), 1.5 + Math.random() * 2, (Math.random() - 0.5), 0.5 + Math.random() * 0.3, 0.9, 0.2, 1, 0.5 + Math.random() * 0.2, 0.1, 0.9, 0, 0.98);
  }
  explosion(x: number, y: number, z: number, power = 1) {
    for (let i = 0; i < 70 * power; i++) {
      const a = Math.random() * 6.28, e = Math.random() * 1.5, s = (3 + Math.random() * 9) * power;
      this.glow.emit(x, y + 0.5, z, Math.cos(a) * s * Math.cos(e), Math.sin(e) * s * 1.2 + 2, Math.sin(a) * s * Math.cos(e), 0.35 + Math.random() * 0.5, 2.4 * power, 6.5 * power, 1, 0.55 + Math.random() * 0.3, 0.15, 1, 0, 0.93);
    }
    for (let i = 0; i < 60 * power; i++) {
      const a = Math.random() * 6.28, s = (1 + Math.random() * 6) * power;
      this.smoke.emit(x, y + 0.5, z, Math.cos(a) * s, 2 + Math.random() * 7, Math.sin(a) * s, 2.6 + Math.random() * 2.5, 2 * power, 9 * power, 0.12, 0.11, 0.1, 0.8, -0.6, 0.96);
    }
    for (let i = 0; i < 50 * power; i++) {
      const a = Math.random() * 6.28, s = 6 + Math.random() * 16;
      this.glow.emit(x, y + 0.5, z, Math.cos(a) * s, 4 + Math.random() * 14, Math.sin(a) * s, 0.8 + Math.random() * 0.8, 0.28, 0.05, 1, 0.8, 0.3, 1, 18, 0.99);
    }
    this.flare.emit(x, y + 1, z, 0, 0, 0, 0.35, 8 * power, 30 * power, 1, 0.85, 0.5, 1);
    this.light.position.set(x, y + 3, z);
    this.light.intensity = 900 * power;
    this.lightT = 0.45;
    const sh = this.shock.find((s) => !s.m.visible) ?? this.shock[0];
    sh.m.position.set(x, y + 0.3, z);
    sh.m.visible = true; sh.t = 0.5;
    this.shake = Math.min(1.4, this.shake + 0.8 * power);
  }
  debrisBurst(x: number, y: number, z: number, color: number, n = 8) {
    for (let k = 0; k < n; k++) {
      const d = this.debris.find((q) => !q.m.visible);
      if (!d) return;
      d.m.visible = true;
      (d.m.material as THREE.MeshStandardMaterial).color.setHex(Math.random() < 0.6 ? color : 0x222222);
      d.m.position.set(x, y + 0.5, z);
      d.v.set((Math.random() - 0.5) * 14, 5 + Math.random() * 8, (Math.random() - 0.5) * 14);
      d.w.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      d.m.scale.setScalar(0.6 + Math.random());
      d.t = 3 + Math.random() * 2;
    }
  }

  update(dt: number, scale: number) {
    this.smoke.update(dt, scale);
    this.glow.update(dt, scale);
    this.flare.update(dt, scale);
    for (const t of this.tracers) if (t.m.visible) { t.t -= dt; if (t.t <= 0) t.m.visible = false; }
    if (this.lightT > 0) {
      this.lightT -= dt;
      this.light.intensity *= Math.exp(-dt * 8);
      if (this.lightT <= 0) this.light.intensity = 0;
    }
    for (const d of this.debris) {
      if (!d.m.visible) continue;
      d.t -= dt;
      d.v.y -= 22 * dt;
      d.m.position.addScaledVector(d.v, dt);
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      if (d.m.position.y < 0.1) { d.m.position.y = 0.1; d.v.multiplyScalar(0.3); d.v.y = Math.abs(d.v.y) * 0.3; d.w.multiplyScalar(0.6); }
      if (d.t <= 0) d.m.visible = false;
    }
    for (const s of this.shock) {
      if (!s.m.visible) continue;
      s.t -= dt;
      const k = 1 - s.t / 0.5;
      s.m.scale.setScalar(2 + k * 28);
      (s.m.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - k);
      if (s.t <= 0) s.m.visible = false;
    }
    this.shake = Math.max(0, this.shake - dt * 1.8);
  }
}
