import * as THREE from 'three/webgpu';
import { makeCanvas } from './geo';

export class Sparks {
  mesh: THREE.InstancedMesh;
  private n = 700;
  private px = new Float32Array(this.n * 3);
  private vel = new Float32Array(this.n * 3);
  private life = new Float32Array(this.n);
  private max = new Float32Array(this.n);
  private size = new Float32Array(this.n);
  private grav = new Float32Array(this.n);
  private idx = 0;
  private active = 0;
  private o = new THREE.Object3D();

  constructor() {
    const geo = new THREE.SphereGeometry(0.1, 6, 4);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const c = new THREE.Color(1, 1, 1);
    this.o.scale.setScalar(0);
    this.o.updateMatrix();
    for (let i = 0; i < this.n; i++) {
      this.mesh.setColorAt(i, c);
      this.mesh.setMatrixAt(i, this.o.matrix);
    }
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color, size: number, grav = 9) {
    const i = this.idx;
    this.idx = (this.idx + 1) % this.n;
    this.px[i * 3] = x;
    this.px[i * 3 + 1] = y;
    this.px[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = this.max[i] = life;
    this.size[i] = size;
    this.grav[i] = grav;
    this.mesh.setColorAt(i, color);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.active = this.n;
  }

  burst(x: number, y: number, z: number, color: THREE.Color, count = 70, speed = 22) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const b = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.55 + Math.random() * 0.5);
      this.emit(x, y, z, Math.sin(b) * Math.cos(a) * s, Math.cos(b) * s, Math.sin(b) * Math.sin(a) * s, 1.4 + Math.random() * 1.0, color, 0.5, 7);
    }
  }

  update(dt: number) {
    if (!this.active) return;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= this.grav[i] * dt;
      this.vel[k] *= 1 - dt * 0.6;
      this.vel[k + 2] *= 1 - dt * 0.6;
      this.px[k] += this.vel[k] * dt;
      this.px[k + 1] += this.vel[k + 1] * dt;
      this.px[k + 2] += this.vel[k + 2] * dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.o.position.set(this.px[k], Math.max(0.05, this.px[k + 1]), this.px[k + 2]);
      this.o.scale.setScalar(f > 0 ? this.size[i] * Math.min(1, f * 2.5) : 0);
      this.o.updateMatrix();
      this.mesh.setMatrixAt(i, this.o.matrix);
      if (this.life[i] <= 0) {
        this.o.scale.setScalar(0);
        this.o.updateMatrix();
        this.mesh.setMatrixAt(i, this.o.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!any) this.active = 0;
  }
}

let beamTex: THREE.CanvasTexture | null = null;
function getBeamTex() {
  if (!beamTex) {
    const { c, g } = makeCanvas(8, 256);
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#000');
    gr.addColorStop(0.55, '#333');
    gr.addColorStop(1, '#fff');
    g.fillStyle = gr;
    g.fillRect(0, 0, 8, 256);
    beamTex = new THREE.CanvasTexture(c);
  }
  return beamTex;
}

export class Marker {
  group = new THREE.Group();
  private beam: THREE.Mesh;
  private ring: THREE.Mesh;
  private disc: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private discMat: THREE.MeshBasicMaterial;
  private r = 0;
  constructor() {
    this.mat = new THREE.MeshBasicMaterial({
      map: getBeamTex(), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    this.discMat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const bg = new THREE.CylinderGeometry(1, 1, 320, 24, 1, true);
    bg.translate(0, 160, 0);
    this.beam = new THREE.Mesh(bg, this.mat);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.2, 8, 48).rotateX(Math.PI / 2), this.mat);
    this.ring.position.y = 0.35;
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(3, 40).rotateX(-Math.PI / 2), this.discMat);
    this.disc.position.y = 0.3;
    this.beam.frustumCulled = false;
    this.group.add(this.beam, this.ring, this.disc);
    this.group.visible = false;
  }
  set(x: number, z: number, r: number, color: string, scale = 1) {
    this.group.visible = true;
    this.group.position.set(x, 0, z);
    const col = new THREE.Color(color);
    this.mat.color.copy(col).multiplyScalar(2.4);
    this.discMat.color.copy(col).multiplyScalar(1.5);
    if (Math.abs(r - this.r) > 0.01) {
      this.r = r;
      this.ring.geometry.dispose();
      this.disc.geometry.dispose();
      this.ring.geometry = new THREE.TorusGeometry(r, 0.22, 8, 56).rotateX(Math.PI / 2);
      this.disc.geometry = new THREE.CircleGeometry(r, 48).rotateX(-Math.PI / 2);
    }
    this.beam.scale.set(Math.min(1.6, r * 0.22) * scale, 1, Math.min(1.6, r * 0.22) * scale);
  }
  hide() {
    this.group.visible = false;
  }
  update(t: number) {
    if (!this.group.visible) return;
    const p = 1 + Math.sin(t * 3) * 0.04;
    this.ring.scale.set(p, 1, p);
  }
}
