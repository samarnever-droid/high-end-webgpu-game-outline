import * as THREE from 'three';
import type { Sky } from './sky';

const vert = /* glsl */ `
varying vec3 vWP;
#include <fog_pars_vertex>
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const frag = /* glsl */ `
varying vec3 vWP;
uniform sampler2D tN;
uniform float uTime;
uniform float uShoreX;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uMoonDir;
uniform vec3 uZen;
uniform vec3 uHor;
uniform float uDay;
uniform float uNight;
uniform float uRain;
#include <fog_pars_fragment>
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
vec3 skyCol(vec3 r){
  float t = pow(clamp(r.y, 0.0, 1.0), 0.45);
  vec3 c = mix(uHor, uZen, t);
  float sd = max(dot(r, uSunDir), 0.0);
  c += uSunCol * (pow(sd, 6.0) * 0.22 + pow(sd, 120.0) * 0.45) * uDay;
  return c;
}
void main(){
  vec3 V = cameraPosition - vWP;
  float dist = length(V);
  V /= dist;
  float k = 1.0 / (1.0 + dist * 0.0035);
  vec2 q = vWP.xz;
  vec3 n1 = texture2D(tN, q * 0.021 + vec2(uTime * 0.011, uTime * 0.006)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tN, q * 0.067 + vec2(-uTime * 0.016, uTime * 0.01)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(tN, q * 0.21 + vec2(uTime * 0.03, -uTime * 0.02)).xyz * 2.0 - 1.0;
  float amp = (0.85 + uRain * 0.8) * k;
  vec3 N = normalize(vec3((n1.x + n2.x * 0.7 + n3.x * 0.35) * amp, 1.0, (n1.y + n2.y * 0.7 + n3.y * 0.35) * amp));
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyCol(R);
  // sun / moon glitter
  float sg = pow(max(dot(R, uSunDir), 0.0), 700.0) * 9.0 + pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.45;
  refl += uSunCol * sg * uDay * (1.0 - uRain * 0.8);
  float mg = pow(max(dot(R, uMoonDir), 0.0), 900.0) * 5.0 + pow(max(dot(R, uMoonDir), 0.0), 80.0) * 0.12;
  refl += vec3(0.7, 0.8, 1.0) * mg * uNight;

  // body colour: deep teal -> turquoise in the shallows, lit by the sky
  float sh = vWP.x - uShoreX;
  float shallow = exp(-max(sh, 0.0) * 0.045);
  vec3 deep = vec3(0.012, 0.075, 0.11);
  vec3 turq = vec3(0.04, 0.32, 0.34);
  vec3 body = mix(deep, turq, shallow * 0.9);
  float skyL = 0.25 + 0.75 * uDay;
  body *= (0.35 + 0.65 * skyL) * (0.7 + 0.3 * ndv);
  // sub-surface glow through wave crests
  float sss = pow(max(dot(normalize(vec3(uSunDir.x, 0.0, uSunDir.z)), -V), 0.0), 3.0) * max(n1.x + n2.x, 0.0) * 0.5;
  body += vec3(0.05, 0.3, 0.25) * sss * uDay;
  vec3 col = mix(body, refl, clamp(fres + 0.04, 0.0, 1.0));

  // shoreline foam
  float wob = noise(q * 0.35 + uTime * 0.2) * 2.4 + sin(uTime * 0.9 - sh * 0.55) * 1.1;
  float foam = smoothstep(5.5, 0.4, sh + wob) * step(-2.0, sh);
  float lace = noise(q * 1.4 + vec2(uTime * 0.3, 0.0));
  foam *= smoothstep(0.25, 0.8, lace + foam * 0.5);
  col = mix(col, vec3(0.9, 0.95, 1.0) * (0.35 + 0.65 * skyL), clamp(foam, 0.0, 1.0) * 0.85);

  float alpha = clamp(0.8 + fres * 0.2 - shallow * 0.35, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

export function createWater(normal: THREE.Texture, shoreX: number, size: number, cx: number): THREE.Mesh {
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.repeat.set(1, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        tN: { value: normal }, uTime: { value: 0 }, uShoreX: { value: shoreX },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uZen: { value: new THREE.Color(0.2, 0.4, 0.8) }, uHor: { value: new THREE.Color(0.7, 0.8, 0.9) },
        uDay: { value: 1 }, uNight: { value: 0 }, uRain: { value: 0 },
      },
    ]),
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(cx, -0.6, 0);
  return m;
}

export function updateWater(mesh: THREE.Mesh, sky: Sky, time: number) {
  const u = (mesh.material as THREE.ShaderMaterial).uniforms;
  const su = sky.mat.uniforms;
  u.uTime.value = time;
  u.uSunDir.value.copy(sky.sunDir);
  u.uSunCol.value.copy(sky.sun.color);
  u.uMoonDir.value.copy(su.uMoon.value);
  u.uZen.value.copy(su.uZenith.value);
  u.uHor.value.copy(su.uHorizon.value);
  u.uDay.value = su.uDay.value;
  u.uNight.value = sky.night;
  u.uRain.value = sky.rain;
}
