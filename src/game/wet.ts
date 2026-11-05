import * as THREE from 'three';

/** Shared uniform: 0 = bone dry, 1 = soaked. Driven by the weather system. */
export const wetUniform = { value: 0 };

/** GLSL puddle mask - identical function is used by the material patch and by the screen-space reflection pass. */
export const PUDDLE_GLSL = /* glsl */ `
float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float wNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(wHash(i), wHash(i+vec2(1.0,0.0)), f.x), mix(wHash(i+vec2(0.0,1.0)), wHash(i+vec2(1.0,1.0)), f.x), f.y);
}
float wPuddle(vec2 p){
  float n = wNoise(p*0.16)*0.6 + wNoise(p*0.43)*0.3 + wNoise(p*1.3)*0.1;
  return smoothstep(0.5, 0.64, n);
}
`;

/**
 * Makes a standard material react to rain: surfaces darken, get glossier and collect
 * mirror-like puddles whose shape is driven by world-space noise.
 */
export function patchWet<T extends THREE.MeshStandardMaterial>(mat: T, puddles = 1): T {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = wetUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWetP;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        { vec4 wq = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wq = instanceMatrix * wq;
        #endif
          vWetP = (modelMatrix * wq).xyz; }`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWetP;\nuniform float uWet;\n${PUDDLE_GLSL}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float pudM = wPuddle(vWetP.xz) * uWet * ${puddles.toFixed(2)};
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.5, uWet * 0.8);
        roughnessFactor = mix(roughnessFactor, 0.03, pudM);
        diffuseColor.rgb *= 1.0 - 0.22 * uWet - 0.12 * pudM;`
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = normalize(mix(normal, nonPerturbedNormal, pudM * 0.85));');
  };
  mat.customProgramCacheKey = () => 'wet' + puddles;
  return mat;
}
