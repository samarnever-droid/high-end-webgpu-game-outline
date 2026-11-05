import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { PUDDLE_GLSL } from './wet';

/**
 * "Uber" depth-aware post pass. Runs in linear HDR right after the scene render and before bloom/tonemapping.
 *   - GTAO-style horizon-less SSAO (half res, 4x4 dithered + depth aware blur)
 *   - Screen-space reflections on wet ground
 *   - Height fog with analytic integration + sun in-scattering
 *   - Screen-space sun shafts (god rays)
 *   - Procedural lens flare with depth-tested sun occlusion
 */

const DEPTH_COMMON = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uTan;
uniform float uNear;
uniform float uFar;
float linZ(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
vec3 viewPos(vec2 uv, float d){ float z = linZ(d); return vec3((uv * 2.0 - 1.0) * uTan * z, -z); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 viewNormal(vec2 uv, vec2 px, vec3 P){
  vec2 ur = uv + vec2(px.x, 0.0), ul = uv - vec2(px.x, 0.0), uu = uv + vec2(0.0, px.y), ud = uv - vec2(0.0, px.y);
  vec3 Pr = viewPos(ur, texture2D(tDepth, ur).x);
  vec3 Pl = viewPos(ul, texture2D(tDepth, ul).x);
  vec3 Pu = viewPos(uu, texture2D(tDepth, uu).x);
  vec3 Pd = viewPos(ud, texture2D(tDepth, ud).x);
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  return normalize(cross(dx, dy));
}
`;

const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const AO_FRAG = /* glsl */ `
varying vec2 vUv;
${DEPTH_COMMON}
uniform mat4 uProj;
uniform vec2 uAoRes;
uniform float uRadius;
uniform float uPower;
void main(){
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(vUv, d);
  vec3 N = viewNormal(vUv, 1.0 / uAoRes, P);
  float n1 = ign(gl_FragCoord.xy);
  float n2 = ign(gl_FragCoord.xy + 17.31);
  vec3 rv = normalize(vec3(n1 - 0.5, n2 - 0.5, 0.37 + n1 * 0.2));
  vec3 T = normalize(rv - N * dot(rv, N));
  vec3 B = cross(N, T);
  float dist = -P.z;
  float rad = uRadius * clamp(0.6 + dist * 0.015, 0.6, 3.0);
  float bias = 0.02 + 0.002 * dist;
  float occ = 0.0;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float a = n1 * 6.2831853 + fi * 2.399963;
    float r = (fi + 0.5) / 14.0;
    float sr = sqrt(r);
    vec3 h = vec3(cos(a) * sr, sin(a) * sr, sqrt(max(1.0 - r, 0.02)));
    vec3 dir = T * h.x + B * h.y + N * h.z;
    float sc = mix(0.12, 1.0, (fi + 1.0) / 14.0 * ((fi + 1.0) / 14.0));
    vec3 sp = P + dir * rad * sc;
    vec4 cp = uProj * vec4(sp, 1.0);
    vec2 suv = cp.xy / cp.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sz = linZ(texture2D(tDepth, suv).x);
    float diff = (-sp.z) - sz;
    float rc = smoothstep(0.0, 1.0, rad / max(abs(dist - sz), 0.0001));
    occ += (diff > bias ? 1.0 : 0.0) * rc;
  }
  float ao = 1.0 - occ / 14.0;
  ao = pow(clamp(ao, 0.0, 1.0), uPower);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform vec2 uAoRes;
uniform float uNear;
uniform float uFar;
float linZ(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main(){
  float zc = linZ(texture2D(tDepth, vUv).x);
  vec2 px = 1.0 / uAoRes;
  float sum = 0.0, wsum = 0.0;
  for (int x = -2; x < 2; x++) {
    for (int y = -2; y < 2; y++) {
      vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * px;
      float z = linZ(texture2D(tDepth, uv).x);
      float w = exp(-abs(z - zc) / (0.04 * zc + 0.05));
      sum += texture2D(tAO, uv).r * w;
      wsum += w;
    }
  }
  float v = sum / max(wsum, 0.0001);
  gl_FragColor = vec4(v, v, v, 1.0);
}`;

const MAIN_VERT = /* glsl */ `
varying vec2 vUv;
varying float vOcc;
uniform sampler2D tDepth;
uniform vec2 uSunUv;
void main(){
  vUv = uv;
  float o = 0.0;
  for (int i = 0; i < 9; i++) {
    vec2 off = vec2(float(i - (i / 3) * 3 - 1), float(i / 3 - 1)) * 0.014;
    vec2 s = uSunUv + off;
    float inside = (s.x > 0.0 && s.x < 1.0 && s.y > 0.0 && s.y < 1.0) ? 1.0 : 0.0;
    o += inside * (texture2D(tDepth, clamp(s, 0.0, 1.0)).x >= 0.99999 ? 1.0 : 0.0);
  }
  vOcc = o / 9.0;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const MAIN_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vOcc;
${DEPTH_COMMON}
${PUDDLE_GLSL}
uniform sampler2D tDiffuse;
uniform sampler2D tAO;
uniform mat4 uProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec2 uRes;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec2 uSunUv;
uniform float uSunFront;
uniform vec3 uFogCol;
uniform float uFogDens;
uniform float uFogH;
uniform float uAO;
uniform float uWet;
uniform float uSSR;
uniform float uRays;
uniform float uFlare;
uniform float uIndoor;
uniform float uTime;

void main(){
  vec4 base = texture2D(tDiffuse, vUv);
  vec3 col = base.rgb;
  float d = texture2D(tDepth, vUv).x;
  bool sky = d >= 0.99999;
  vec3 P = viewPos(vUv, d);
  float dist = length(P);
  vec3 rdV = normalize(viewPos(vUv, 1.0));
  vec3 rdW = normalize((uCamWorld * vec4(rdV, 0.0)).xyz);
  vec2 px = 1.0 / uRes;

  if (!sky) {
    // ---------------------------------------------------------------- ambient occlusion
    if (uAO > 0.001) {
      float ao = texture2D(tAO, vUv).r;
      col *= mix(1.0, ao, uAO);
    }

    // ---------------------------------------------------------------- wet ground reflections
    if (uSSR > 0.5 && uWet > 0.02) {
      vec3 Nv = viewNormal(vUv, px, P);
      vec3 Nw = normalize((uCamWorld * vec4(Nv, 0.0)).xyz);
      vec3 wp = uCamPos + rdW * dist;
      if (Nw.y > 0.8 && wp.y < 0.5) {
        float pud = wPuddle(wp.xz);
        float amt = uWet * (0.3 + 0.7 * pud);
        vec3 V = -normalize(P);
        float F = 0.06 + 0.94 * pow(1.0 - max(dot(Nv, V), 0.0), 4.0);
        amt *= mix(0.35, 1.0, F);
        vec3 R = reflect(-V, Nv);
        vec3 pos = P + Nv * 0.04;
        float stepL = 0.45 + dist * 0.012;
        float j = ign(gl_FragCoord.xy);
        pos += R * stepL * j;
        float hit = 0.0;
        vec3 hc = vec3(0.0);
        for (int i = 0; i < 30; i++) {
          pos += R * stepL;
          stepL *= 1.1;
          vec4 cp = uProj * vec4(pos, 1.0);
          if (cp.w <= 0.0) break;
          vec2 suv = cp.xy / cp.w * 0.5 + 0.5;
          if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
          float sd = texture2D(tDepth, suv).x;
          float sz = linZ(sd);
          float diff = (-pos.z) - sz;
          if (diff > 0.0 && diff < stepL * 1.6 + 0.25 && sd < 0.99999) {
            vec2 e = abs(suv - 0.5) * 2.0;
            float edge = 1.0 - smoothstep(0.7, 1.0, max(e.x, e.y));
            hc = texture2D(tDiffuse, suv).rgb;
            hit = edge;
            break;
          }
        }
        col = mix(col, hc * 0.95, clamp(amt * hit, 0.0, 0.92));
      }
    }

    // ---------------------------------------------------------------- height fog + sun in-scattering
    if (uFogDens > 0.00001) {
      float camH = max(uCamPos.y, 0.0);
      float k = rdW.y * uFogH;
      float t = dist;
      float integ = abs(k * t) < 1e-3 ? t : (1.0 - exp(-k * t)) / k;
      float amount = uFogDens * exp(-camH * uFogH) * integ;
      float f = (1.0 - exp(-amount)) * (1.0 - uIndoor);
      float sa = pow(max(dot(rdW, uSunDir), 0.0), 5.0);
      vec3 fc = mix(uFogCol, uSunCol * 1.15, sa * 0.55);
      col = mix(col, fc, clamp(f, 0.0, 0.85));
    }
  }

  // ------------------------------------------------------------------ sun shafts
  if (uRays > 0.001 && uSunFront > 0.0 && uIndoor < 0.5) {
    vec2 dir = uSunUv - vUv;
    float L = length(dir);
    const int NS = 22;
    vec2 stp = dir / float(NS) * 0.95;
    vec2 uv = vUv + stp * ign(gl_FragCoord.xy + uTime);
    float acc = 0.0;
    float decay = 1.0;
    for (int i = 0; i < NS; i++) {
      uv += stp;
      float vis = texture2D(tDepth, clamp(uv, 0.0, 1.0)).x >= 0.99999 ? 1.0 : 0.0;
      float w = exp(-length(uv - uSunUv) * 2.6);
      acc += vis * w * decay;
      decay *= 0.955;
    }
    acc /= float(NS);
    float vis0 = sky ? 0.35 : 1.0;
    col += uSunCol * acc * uRays * uSunFront * vis0 * 0.9 * (1.0 - smoothstep(0.0, 1.6, L) * 0.5);
  }

  // ------------------------------------------------------------------ lens flare
  if (uFlare > 0.001 && uSunFront > 0.0 && vOcc > 0.01 && uIndoor < 0.5) {
    vec2 asp = vec2(uRes.x / uRes.y, 1.0);
    vec2 sc = (vUv - 0.5) * asp;
    vec2 ss = (uSunUv - 0.5) * asp;
    float fade = smoothstep(1.6, 0.2, length(ss)) * vOcc * uFlare * uSunFront;
    vec3 fl = vec3(0.0);
    // ghosts mirrored through the centre
    fl += vec3(1.0, 0.75, 0.5) * smoothstep(0.075, 0.0, length(sc + ss * 0.45)) * 0.32;
    fl += vec3(0.5, 0.8, 1.0) * smoothstep(0.045, 0.0, length(sc + ss * 0.9)) * 0.38;
    fl += vec3(0.7, 1.0, 0.6) * smoothstep(0.13, 0.0, length(sc + ss * 1.45)) * 0.14;
    fl += vec3(1.0, 0.5, 0.8) * smoothstep(0.03, 0.0, length(sc - ss * 0.55)) * 0.3;
    // ring halo
    float ring = smoothstep(0.035, 0.0, abs(length(sc - ss) - 0.38));
    fl += vec3(0.9, 0.85, 0.7) * ring * 0.12;
    // anamorphic streak
    float streak = exp(-abs(sc.y - ss.y) * 70.0) * exp(-abs(sc.x - ss.x) * 1.8);
    fl += vec3(0.55, 0.7, 1.0) * streak * 0.2;
    // core bloom
    fl += uSunCol * exp(-length(sc - ss) * 5.5) * 0.35;
    col += fl * fade;
  }

  gl_FragColor = vec4(col, base.a);
}`;

export interface UberSettings {
  ao: boolean;
  ssr: boolean;
  rays: boolean;
  flare: boolean;
  fog: boolean;
}

export class UberPass extends Pass {
  settings: UberSettings = { ao: true, ssr: true, rays: true, flare: true, fog: true };
  aoRT: THREE.WebGLRenderTarget;
  blurRT: THREE.WebGLRenderTarget;
  private aoMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private mainMat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private fallbackDepth: THREE.DataTexture;
  private tmp = new THREE.Vector3();
  private fwd = new THREE.Vector3();

  // driven from game
  sunDir = new THREE.Vector3(0, 1, 0);
  sunCol = new THREE.Color(1, 1, 1);
  fogCol = new THREE.Color(0.7, 0.8, 0.9);
  fogDensity = 0.004;
  fogHeight = 0.03;
  raysAmount = 0;
  flareAmount = 0;
  wet = 0;
  indoor = 0;
  time = 0;

  constructor(private camera: THREE.PerspectiveCamera, w: number, h: number) {
    super();
    const mk = () => new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.aoRT = mk();
    this.blurRT = mk();
    this.fallbackDepth = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.fallbackDepth.needsUpdate = true;

    const shared = {
      tDepth: { value: this.fallbackDepth as THREE.Texture },
      uTan: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uProj: { value: new THREE.Matrix4() },
    };
    this.aoMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: AO_FRAG, depthTest: false, depthWrite: false,
      uniforms: { ...shared, uAoRes: { value: new THREE.Vector2(w / 2, h / 2) }, uRadius: { value: 1.1 }, uPower: { value: 1.35 } },
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tAO: { value: this.aoRT.texture }, tDepth: shared.tDepth, uAoRes: { value: new THREE.Vector2(w / 2, h / 2) }, uNear: shared.uNear, uFar: shared.uFar },
    });
    this.mainMat = new THREE.ShaderMaterial({
      vertexShader: MAIN_VERT, fragmentShader: MAIN_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        ...shared,
        tDiffuse: { value: null }, tAO: { value: this.blurRT.texture },
        uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
        uRes: { value: new THREE.Vector2(w, h) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
        uSunUv: { value: new THREE.Vector2(0.5, 0.5) }, uSunFront: { value: 0 },
        uFogCol: { value: new THREE.Color() }, uFogDens: { value: 0 }, uFogH: { value: 0.03 },
        uAO: { value: 0.85 }, uWet: { value: 0 }, uSSR: { value: 1 }, uRays: { value: 0 }, uFlare: { value: 0 },
        uIndoor: { value: 0 }, uTime: { value: 0 },
      },
    });
  }

  setSize(w: number, h: number) {
    const hw = Math.max(2, Math.floor(w / 2)), hh = Math.max(2, Math.floor(h / 2));
    this.aoRT.setSize(hw, hh);
    this.blurRT.setSize(hw, hh);
    this.aoMat.uniforms.uAoRes.value.set(hw, hh);
    this.blurMat.uniforms.uAoRes.value.set(hw, hh);
    this.mainMat.uniforms.uRes.value.set(w, h);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const cam = this.camera;
    const depth = readBuffer.depthTexture;
    const s = this.settings;
    const mu = this.mainMat.uniforms;
    const hasDepth = !!depth;
    mu.tDepth.value = depth ?? this.fallbackDepth;
    this.aoMat.uniforms.tDepth.value = mu.tDepth.value;
    this.blurMat.uniforms.tDepth.value = mu.tDepth.value;

    mu.uTan.value.set(1 / cam.projectionMatrix.elements[0], 1 / cam.projectionMatrix.elements[5]);
    mu.uNear.value = cam.near;
    mu.uFar.value = cam.far;
    mu.uProj.value.copy(cam.projectionMatrix);
    mu.uCamWorld.value.copy(cam.matrixWorld);
    mu.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);

    // sun on screen
    this.tmp.copy(mu.uCamPos.value).addScaledVector(this.sunDir, 1000).project(cam);
    cam.getWorldDirection(this.fwd);
    const front = this.fwd.dot(this.sunDir);
    mu.uSunUv.value.set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5);
    mu.uSunFront.value = THREE.MathUtils.smoothstep(front, 0.0, 0.25);
    mu.uSunDir.value.copy(this.sunDir);
    mu.uSunCol.value.copy(this.sunCol);
    mu.uFogCol.value.copy(this.fogCol);
    mu.uFogDens.value = hasDepth && s.fog ? this.fogDensity : 0;
    mu.uFogH.value = this.fogHeight;
    mu.uWet.value = this.wet;
    mu.uSSR.value = hasDepth && s.ssr ? 1 : 0;
    mu.uRays.value = hasDepth && s.rays ? this.raysAmount : 0;
    mu.uFlare.value = hasDepth && s.flare ? this.flareAmount : 0;
    mu.uIndoor.value = this.indoor;
    mu.uTime.value = this.time % 100;

    const aoOn = hasDepth && s.ao;
    mu.uAO.value = aoOn ? 0.9 * (1 - this.indoor * 0.2) : 0;
    if (aoOn) {
      const a = this.aoMat.uniforms;
      a.uTan.value.copy(mu.uTan.value); a.uNear.value = cam.near; a.uFar.value = cam.far; a.uProj.value.copy(cam.projectionMatrix);
      this.quad.material = this.aoMat;
      renderer.setRenderTarget(this.aoRT);
      this.quad.render(renderer);
      this.blurMat.uniforms.uNear.value = cam.near;
      this.blurMat.uniforms.uFar.value = cam.far;
      this.quad.material = this.blurMat;
      renderer.setRenderTarget(this.blurRT);
      this.quad.render(renderer);
    }

    mu.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.mainMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.aoRT.dispose();
    this.blurRT.dispose();
    this.aoMat.dispose();
    this.blurMat.dispose();
    this.mainMat.dispose();
    this.fallbackDepth.dispose();
    this.quad.dispose();
  }
}
