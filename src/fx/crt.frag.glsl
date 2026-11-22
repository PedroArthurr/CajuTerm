precision mediump float;

varying vec2 v_uv;

uniform vec2 u_resolution;
uniform float u_time;

uniform float u_scanlines;
uniform float u_curvature;
uniform float u_bloom;
uniform float u_chromatic;
uniform float u_noise;
uniform float u_flicker;

uniform vec3 u_accent;
uniform vec3 u_accent2;
uniform vec3 u_cursor; // x, y normalizados e z = ativo (0 ou 1)

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 crtWarp(vec2 uv, float amount) {
  vec2 centered = uv * 2.0 - 1.0;
  vec2 offset = centered.yx / 3.4;
  centered += centered * offset * offset * amount * 1.15;
  return centered * 0.5 + 0.5;
}

void main() {
  vec2 uv = v_uv;
  if (u_curvature > 0.001) {
    uv = crtWarp(uv, u_curvature);
  }

  // Distância suavizada até a borda do tubo CRT para evitar serrilhado nos cantos
  float bezelDist = max(max(-uv.x, uv.x - 1.0), max(-uv.y, uv.y - 1.0));
  if (bezelDist > 0.006) {
    gl_FragColor = vec4(0.01, 0.01, 0.02, 0.92);
    return;
  }

  vec2 clampedUv = clamp(uv, 0.0, 1.0);
  vec2 dEdge = min(clampedUv, 1.0 - clampedUv);
  float vignette = smoothstep(0.0, 0.14, min(dEdge.x, dEdge.y));

  vec3 outColor = vec3(0.0);
  float outAlpha = 0.0;

  // 1. Scanlines CRT horizontais
  if (u_scanlines > 0.001) {
    float lineWave = sin(clampedUv.y * u_resolution.y * 1.05);
    float scanDark = (0.5 - 0.5 * lineWave) * u_scanlines * 0.55;
    outAlpha += scanDark;
  }

  // 2. Curvatura: vinheta suave e brilho de vidro
  if (u_curvature > 0.001) {
    float bezelShadow = (1.0 - vignette) * u_curvature * 0.65;
    outAlpha += bezelShadow;
    float glassLine = exp(-pow(abs(clampedUv.y - 0.04) * 32.0, 2.0)) * u_curvature * 0.16;
    outColor += mix(u_accent2, vec3(1.0), 0.5) * glassLine;
    outAlpha += glassLine * 0.22;
  }

  // 3. Glow / Bloom Neon ambiental + halo dinâmico no cursor
  if (u_bloom > 0.001) {
    float borderGlow = pow(1.0 - vignette, 2.0) * u_bloom * 0.42;
    vec3 neonMix = mix(u_accent, u_accent2, clampedUv.x * 0.7 + 0.3 * sin(u_time * 0.7));
    outColor += neonMix * borderGlow;
    outAlpha += borderGlow * 0.36;

    if (u_cursor.z > 0.5) {
      vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
      float dist = length((v_uv - u_cursor.xy) * aspect);
      float cursorHalo = exp(-dist * 11.0) * u_bloom * 0.55;
      outColor += mix(u_accent, u_accent2, 0.35) * cursorHalo;
      outAlpha += cursorHalo * 0.38;
    }
  }

  // 4. Aberração Cromática nas bordas e ao redor do cursor
  if (u_chromatic > 0.001) {
    float radial = length(clampedUv - 0.5);
    float fringe = smoothstep(0.24, 0.72, radial) * u_chromatic;
    float waveR = 0.5 + 0.5 * sin(clampedUv.y * u_resolution.y * 0.35 + u_time * 1.8);
    float waveB = 0.5 + 0.5 * cos(clampedUv.y * u_resolution.y * 0.35 - u_time * 1.8);
    outColor.r += fringe * 0.48 * waveR;
    outColor.b += fringe * 0.55 * waveB;
    outAlpha += fringe * 0.14;
  }

  // 5. Ruído / Grain analógico
  if (u_noise > 0.001) {
    float n = hash12(clampedUv * u_resolution + fract(u_time * 60.0) * 97.0);
    float grain = (n - 0.5) * u_noise * 0.55;
    outColor += vec3(max(grain, 0.0));
    outAlpha += abs(grain) * 0.42;
  }

  // 6. Flicker CRT sutil
  if (u_flicker > 0.001) {
    float flick = (0.5 + 0.5 * sin(u_time * 52.0 + sin(u_time * 17.0))) * u_flicker * 0.28;
    outAlpha += flick;
  }

  float finalAlpha = clamp(outAlpha, 0.0, 0.92);
  vec3 finalColor = clamp(outColor, 0.0, 1.0);

  if (u_curvature > 0.001) {
    float bezelAA = smoothstep(-0.004, 0.006, bezelDist);
    finalColor = mix(finalColor, vec3(0.01, 0.01, 0.02), bezelAA);
    finalAlpha = mix(finalAlpha, 0.92, bezelAA);
  }

  gl_FragColor = vec4(finalColor, finalAlpha);
}
