import * as THREE from 'three';
import { clamp, lerp, smooth } from './util';

const vert = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // always at far plane
}`;

const frag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSun;
uniform vec3 uMoon;
uniform float uDay;
uniform float uNight;
uniform float uTime;
uniform float uCloud;
uniform float uRain;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunCol;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<5;i++){ s += a*noise(p); p *= 2.02; a *= 0.5; }
  return s;
}
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  float t = pow(clamp(h, 0.0, 1.0), 0.45);
  vec3 col = mix(uHorizon, uZenith, t);
  // sun glow & disc
  float sd = max(dot(d, uSun), 0.0);
  col += uSunCol * (pow(sd, 6.0) * 0.35 + pow(sd, 120.0) * 1.2) * uDay;
  col += uSunCol * pow(sd, 1500.0) * 40.0 * uDay;
  // horizon haze band
  col = mix(col, uHorizon * 1.05, pow(1.0 - clamp(abs(d.y)*2.2,0.0,1.0), 3.0) * 0.5);
  // moon
  float md = max(dot(d, uMoon), 0.0);
  col += vec3(0.75,0.82,1.0) * (pow(md, 900.0) * 6.0 + pow(md, 12.0) * 0.12) * uNight;
  // stars
  if (d.y > 0.0 && uNight > 0.01) {
    vec3 sp = d * 220.0;
    vec3 ip = floor(sp);
    float r = hash3(ip);
    vec3 fp = fract(sp) - 0.5;
    float star = step(0.9925, r) * smoothstep(0.35, 0.0, length(fp));
    float tw = 0.6 + 0.4*sin(uTime*2.0 + r*60.0);
    col += vec3(0.9,0.95,1.0) * star * tw * uNight * (1.0 - uCloud*0.8);
    // milky way
    float mw = fbm(d.xz*6.0 + d.y*3.0) * smoothstep(0.7, 0.0, abs(d.x*0.6 + d.z*0.3 - d.y*0.2));
    col += vec3(0.25,0.3,0.45) * mw * 0.25 * uNight;
  }
  // clouds
  if (d.y > 0.02) {
    vec2 uv = d.xz / (d.y + 0.15) * 1.4 + vec2(uTime*0.004, uTime*0.0015);
    float c = fbm(uv * 1.3);
    float cov = mix(0.52, 0.28, uCloud);
    float m = smoothstep(cov, cov + 0.22, c) * smoothstep(0.02, 0.25, d.y);
    float shade = fbm(uv * 1.3 + uSun.xz * 0.15);
    vec3 cc = mix(vec3(0.55,0.58,0.65), vec3(1.0,0.98,0.95), clamp(1.2 - shade, 0.0, 1.0));
    cc *= mix(vec3(0.07,0.09,0.15) * 1.2, mix(vec3(1.0), uSunCol, 0.35), uDay);
    cc = mix(cc, cc * 0.45, uRain);
    col = mix(col, cc, m * (0.9 + uRain * 0.1));
  }
  // below horizon: ground fog colour
  if (d.y < 0.0) col = mix(uHorizon, uHorizon*0.6, clamp(-d.y*4.0,0.0,1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Sky {
  scene: THREE.Scene;
  dome: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  sun: THREE.DirectionalLight;
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.FogExp2;
  hour = 17.2;
  rain = 0;
  rainTarget = 0;
  cloud = 0.3;
  night = 0;
  day = 1;
  sunDir = new THREE.Vector3();
  private envScene = new THREE.Scene();
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvHour = -99;
  private rainLines: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainVel: Float32Array;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.scene = scene;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: {
        uSun: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, -1, 0) }, uDay: { value: 1 }, uNight: { value: 0 }, uTime: { value: 0 },
        uCloud: { value: 0.3 }, uRain: { value: 0 }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
      },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), this.mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), this.mat));

    this.sun = new THREE.DirectionalLight(0xfff0dd, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 1; sc.far = 500;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.06;
    scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x6a88d0, 0);
    scene.add(this.moon);
    this.hemi = new THREE.HemisphereLight(0x9ec4ff, 0x4a4a40, 0.6);
    scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xaec4dc, 0.0009);
    scene.fog = this.fog;
    this.pmrem = new THREE.PMREMGenerator(renderer);

    // rain
    const n = 2400;
    this.rainPos = new Float32Array(n * 6);
    this.rainVel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 60, y = Math.random() * 30, z = (Math.random() - 0.5) * 60;
      this.rainPos.set([x, y, z, x, y - 0.8, z], i * 6);
      this.rainVel[i] = 24 + Math.random() * 10;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab8cc, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    scene.add(this.rainLines);
    this.apply(true);
  }

  setRain(v: number) {
    this.rainTarget = v;
  }

  private colors() {
    const e = this.sunDir.y;
    const dayK = smooth(-0.08, 0.3, e);
    const dusk = 1 - smooth(0.0, 0.4, Math.abs(e - 0.03) * 2) ;
    const zen = new THREE.Color().setRGB(0.012, 0.02, 0.06)
      .lerp(new THREE.Color(0.18, 0.4, 0.82), dayK)
      .lerp(new THREE.Color(0.18, 0.2, 0.5), dusk * 0.55);
    const hor = new THREE.Color().setRGB(0.03, 0.04, 0.09)
      .lerp(new THREE.Color(0.72, 0.82, 0.93), dayK)
      .lerp(new THREE.Color(1.0, 0.5, 0.25), dusk * 0.8);
    const sunCol = new THREE.Color(1, 0.45, 0.2).lerp(new THREE.Color(1, 0.96, 0.88), smooth(0.0, 0.5, e));
    const grey = new THREE.Color(0.38, 0.4, 0.44).multiplyScalar(0.25 + 0.75 * dayK);
    zen.lerp(grey, this.rain * 0.85);
    hor.lerp(grey.clone().multiplyScalar(1.2), this.rain * 0.85);
    return { zen, hor, sunCol, dayK };
  }

  private apply(force = false) {
    const a = ((this.hour - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(a), Math.sin(a) * 0.92, 0.38).normalize();
    const e = this.sunDir.y;
    const { zen, hor, sunCol, dayK } = this.colors();
    this.day = dayK;
    this.night = 1 - smooth(-0.14, 0.06, e);
    const u = this.mat.uniforms;
    u.uSun.value.copy(this.sunDir);
    u.uMoon.value.set(-this.sunDir.x, -this.sunDir.y, -this.sunDir.z * 0.5 + 0.2).normalize();
    u.uDay.value = dayK * (1 - this.rain * 0.7);
    u.uNight.value = this.night;
    u.uCloud.value = clamp(this.cloud + this.rain, 0, 1);
    u.uRain.value = this.rain;
    u.uZenith.value.copy(zen);
    u.uHorizon.value.copy(hor);
    u.uSunCol.value.copy(sunCol);
    const sunI = 3.4 * smooth(-0.02, 0.22, e) * (1 - this.rain * 0.7);
    this.sun.color.copy(sunCol);
    this.sun.intensity = sunI;
    this.sun.visible = sunI > 0.02;
    this.moon.intensity = this.night * 0.55 * (1 - this.rain * 0.5);
    this.moon.position.set(-this.sunDir.x * 200, Math.max(30, -this.sunDir.y * 200), 80);
    this.hemi.intensity = 0.2 + dayK * 0.55;
    this.hemi.color.copy(zen).lerp(new THREE.Color(1, 1, 1), 0.35);
    this.hemi.groundColor.set(0x3a362f).multiplyScalar(0.3 + dayK * 0.8);
    this.fog.color.copy(hor);
    this.fog.density = lerp(0.0007, 0.0024, this.rain) + (1 - dayK) * 0.0004;
    this.renderer.toneMappingExposure = lerp(1.25, 0.95, dayK) * (1 - this.rain * 0.1);
    if (force || Math.abs(this.hour - this.lastEnvHour) > 0.35) {
      this.lastEnvHour = this.hour;
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.35 + dayK * 0.85;
    } else {
      this.scene.environmentIntensity = 0.3 + dayK * 0.9;
    }
  }

  update(dt: number, timeScale: number, focus: THREE.Vector3, cam: THREE.Camera) {
    this.hour = (this.hour + (dt * timeScale) / 60) % 24;
    this.rain += (this.rainTarget - this.rain) * (1 - Math.exp(-dt * 0.25));
    this.mat.uniforms.uTime.value += dt;
    this.apply();
    this.dome.position.copy(cam.position);
    // sun shadow follows the focus, snapped to texels
    const snap = 180 / 2048;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 220, this.sunDir.y * 220 + 10, fz + this.sunDir.z * 220);
    this.sun.target.updateMatrixWorld();
    // rain
    const active = this.rain > 0.04;
    this.rainLines.visible = active;
    if (active) {
      (this.rainLines.material as THREE.LineBasicMaterial).opacity = 0.1 + this.rain * 0.35;
      const p = this.rainPos;
      const n = this.rainVel.length;
      const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
      const count = Math.floor(n * this.rain);
      for (let i = 0; i < n; i++) {
        const v = this.rainVel[i] * dt;
        let y = p[i * 6 + 1] - v;
        let x = p[i * 6], z = p[i * 6 + 2];
        if (i >= count) { y = -999; }
        if (y < cy - 12 || Math.abs(x - cx) > 30 || Math.abs(z - cz) > 30) {
          x = cx + (Math.random() - 0.5) * 60;
          z = cz + (Math.random() - 0.5) * 60;
          y = cy + 18 + Math.random() * 12;
        }
        p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
        p[i * 6 + 3] = x - 0.15; p[i * 6 + 4] = y - 0.9; p[i * 6 + 5] = z;
      }
      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }
  }

  get clock() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
