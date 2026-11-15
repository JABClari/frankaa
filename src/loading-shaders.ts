// The lightbox's loading materials (WebGL). While a photo loads, its frame shows a material drawn over a blurred
// preview of it (its placeholder or thumbnail), or over a neutral base when there is none. A material is a GLSL
// fragment shader, the same contract for the built-ins and for yours (so the built-ins below double as examples):
//
//   precision mediump float;
//   varying vec2 vUv;              // 0 to 1 across the photo's box, (0, 0) at its top left
//   uniform sampler2D uPreview;    // the preview, already blurred and in the frame's shape
//   uniform float uHasPreview;     // 1 with a preview, 0 without (then draw a neutral base)
//   uniform float uTime;           // seconds since the photo started loading (still with reduced motion)
//   uniform vec2 uResolution;      // the box in device pixels
//   uniform float uFailed;         // 1 once the photo has failed to load (dim the material)
//   ...plus any uniforms you pass in `uniforms`.
//   void main() { gl_FragColor = vec4(colour, 1.0); }
//
// The coverUv and mirrorUv macros of effects are defined before your code too. The lightbox clips the result to
// the rounded box and dissolves the photo in over it when it arrives, so a material only draws the waiting.
// No DOM here.

/** The built-ins' shared part. uNoise is a 64 px tile of random bytes (value noise from a texture keeps the
 *  materials smooth and cheap at mediump, where sine hashes break down; it repeats every 64, so fbm wraps there to
 *  keep its numbers small). */
const HEAD = `precision mediump float;
varying vec2 vUv;
uniform sampler2D uPreview;
uniform sampler2D uNoise;
uniform float uHasPreview;
uniform float uTime;
uniform vec2 uResolution;
uniform float uFailed;
float n(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  return texture2D(uNoise, (i + f * f * (3.0 - 2.0 * f) + 0.5) / 64.0).r;
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * n(p); p = mod(p * 2.03 + 0.37, 64.0); a *= 0.5; }
  return v;
}
float grain() {
  vec2 o = mod(floor(uTime * 24.0), 64.0) * vec2(13.0, 7.0);
  return texture2D(uNoise, mod(gl_FragCoord.xy + o, 64.0) / 64.0).g - 0.5;
}
vec3 blurPrev(vec2 uv, float r) {
  vec3 c = vec3(0.0);
  float w = 0.0;
  for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
    float k = 1.0 - length(vec2(float(x), float(y))) / 3.2;
    c += texture2D(uPreview, clamp(uv + vec2(float(x), float(y)) * r, 0.0, 1.0)).rgb * k;
    w += k;
  }
  return c / w;
}
vec3 neutral(vec2 uv) { return mix(vec3(0.11, 0.12, 0.13), vec3(0.17, 0.18, 0.2), fbm(uv * 2.0 + uTime * 0.05)); }
vec3 dim(vec3 c) { return uFailed > 0.5 ? mix(c, vec3(0.1, 0.11, 0.12), 0.55) : c; }
`;

const materials = {
  // An iridescent thin film drifting over the frosted preview, strongest at glancing angles, like a soap bubble.
  film: HEAD + `
vec3 thinFilm(float t) { return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67))); }
void main() {
  vec2 uv = vUv;
  float t = uTime;
  vec3 base = uHasPreview > 0.5 ? blurPrev(uv, 0.005) : neutral(uv);
  float th = fbm(uv * 2.2 + vec2(t * 0.06, -t * 0.04)) * 1.6 + uv.y * 0.4;
  vec3 film = thinFilm(th);
  float fres = 0.35 + 0.45 * smoothstep(0.25, 0.85, fbm(uv * 1.4 - t * 0.05));
  vec3 col = mix(base, base * 0.68 + film * 0.42, fres * 0.8);
  col += grain() * 0.025;
  gl_FragColor = vec4(dim(col), 1.0);
}`,
  // Etched glass over the preview, and a slow band of light refracting through it.
  frost: HEAD + `
void main() {
  vec2 uv = vUv;
  float t = uTime;
  vec2 g = vec2(fbm(uv * 38.0 + 3.0), fbm(uv * 38.0 + 9.0)) - 0.5;
  float bandPos = fract((uv.x + uv.y * 0.55) * 0.62 - t * 0.16);
  float band = smoothstep(0.16, 0.0, abs(bandPos - 0.5));
  vec2 bend = g * (0.028 + band * 0.05);
  vec3 base = uHasPreview > 0.5 ? blurPrev(uv + bend, 0.006) : neutral(uv + bend);
  float etch = fbm(uv * 90.0) - 0.5;
  vec3 col = base * (0.8 + etch * 0.18) + band * vec3(0.3, 0.31, 0.33) + grain() * 0.05;
  col += smoothstep(0.02, 0.0, abs(bandPos - 0.5)) * 0.12;
  gl_FragColor = vec4(dim(col), 1.0);
}`,
  // The preview flowing under a slow liquid surface: a domain-warped flow, with highlights from its slope.
  liquid: HEAD + `
void main() {
  vec2 uv = vUv;
  float t = uTime;
  vec2 q = vec2(fbm(uv * 3.0 + t * 0.08), fbm(uv * 3.0 + vec2(5.2, 1.3) - t * 0.07));
  vec2 r = vec2(fbm(uv * 3.0 + 4.0 * q + vec2(1.7, 9.2) + t * 0.05), fbm(uv * 3.0 + 4.0 * q + vec2(8.3, 2.8)));
  vec2 w = (r - 0.5) * 0.16;
  vec3 base = uHasPreview > 0.5 ? blurPrev(uv + w, 0.004) : neutral(uv + w * 2.0);
  float e = 0.01;
  float f0 = fbm(uv * 3.0 + 4.0 * q);
  vec2 grad = vec2(fbm(uv * 3.0 + 4.0 * q + vec2(e, 0.0)) - f0, fbm(uv * 3.0 + 4.0 * q + vec2(0.0, e)) - f0) / e;
  vec3 nrm = normalize(vec3(-grad * 0.22, 1.0));
  float spec = pow(max(0.0, dot(reflect(-normalize(vec3(0.35, 0.55, 1.0)), nrm), vec3(0.0, 0.0, 1.0))), 60.0);
  float rim = pow(1.0 - nrm.z, 2.0) * 0.9;
  vec3 col = base * (0.85 + rim * 0.2) + spec * 0.75 + rim * 0.12;
  gl_FragColor = vec4(dim(col), 1.0);
}`,
  // Just the blurred preview (or the neutral base), still.
  none: HEAD + `
void main() {
  vec3 col = uHasPreview > 0.5 ? blurPrev(vUv, 0.005) : mix(vec3(0.11, 0.12, 0.13), vec3(0.17, 0.18, 0.2), 0.5 - vUv.y * 0.3);
  gl_FragColor = vec4(dim(col), 1.0);
}`,
};

export type MaterialName = keyof typeof materials;
/** A built-in material's fragment shader. */
export const materialShader = (name: MaterialName): string => materials[name] ?? materials.film;
