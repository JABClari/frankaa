// The lightbox's photo-to-photo effects. An effect is a GLSL fragment shader, the same contract for the built-ins
// and for yours (so the built-ins below double as examples):
//
//   precision mediump float;
//   varying vec2 vUv;            // 0 to 1 across the photo's box, (0, 0) at its top left
//   uniform sampler2D uFrom;     // the photo leaving
//   uniform sampler2D uTo;       // the photo arriving
//   uniform float uProgress;     // 0 to 1, already eased
//   uniform vec2 uResolution;    // the box in device pixels
//   uniform vec2 uFromSize;      // natural size of each photo in pixels
//   uniform vec2 uToSize;
//   uniform float uTime;         // seconds since the lightbox opened
//   uniform float uDirection;    // +1 next, -1 previous
//   ...plus any uniforms you pass in `uniforms`.
//   void main() { gl_FragColor = ...; }
//
// Two helper macros are defined before your code: coverUv(uv, texSize, resolution) maps a box coordinate to a
// cover-fitted texture coordinate, and mirrorUv(uv) mirrors a coordinate back into 0 to 1 (so a shifted sample
// never smears the edge pixels). The lightbox clips the result to the rounded box, so you need not.
// No DOM here, so the registry runs under node --test.

/** What the CSS renderer does for an effect: a crossfade, a crossfade with a short slide or a zoom, or a cut. */
export type CssTransition = "fade" | "slide" | "zoom" | "none";
export type UniformValue = number | [number, number] | [number, number, number] | [number, number, number, number];
export type Easing = "linear" | "ease-in-out" | ((t: number) => number);

export type Effect = {
  /** The fragment shader (see the contract above). */
  fragment: string;
  /** Your own uniforms: a number is a float, an array of 2 to 4 numbers a vec2 to vec4. */
  uniforms?: Record<string, UniformValue>;
  /** How long a change takes, in ms. Default 520. */
  duration?: number;
  /** The curve for uProgress. Default "ease-in-out". */
  easing?: Easing;
  /** What the CSS renderer does instead. Default "fade". */
  css?: CssTransition;
};

const HEAD = `precision mediump float;
varying vec2 vUv;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uProgress;
uniform vec2 uResolution;
uniform vec2 uFromSize;
uniform vec2 uToSize;
uniform float uDirection;
vec4 getFromColor(vec2 uv) { return texture2D(uFrom, mirrorUv(coverUv(uv, uFromSize, uResolution))); }
vec4 getToColor(vec2 uv) { return texture2D(uTo, mirrorUv(coverUv(uv, uToSize, uResolution))); }
`;

/** The macros put before every effect's code. */
export const PRELUDE = `#define coverUv(uv, ts, rs) (((uv) - 0.5) * vec2(min(1.0, ((rs).x / (rs).y) / ((ts).x / (ts).y)), min(1.0, ((ts).x / (ts).y) / ((rs).x / (rs).y))) + 0.5)
#define mirrorUv(t) (1.0 - abs(1.0 - mod(abs(t), 2.0)))
`;

const effects: Record<string, Effect> = {
  displacement: {
    duration: 520,
    css: "slide",
    fragment: HEAD + `
float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float m = uProgress;
  float n = (noise(vUv * 4.0 + uDirection * 1.7) - 0.5) * 0.06;
  vec2 sa = vec2(uDirection * m * 0.18 + n * m, n * m * 0.5);
  vec2 sb = vec2(-uDirection * (1.0 - m) * 0.18 + n * (1.0 - m), n * (1.0 - m) * 0.5);
  gl_FragColor = mix(getFromColor(vUv + sa), getToColor(vUv + sb), m);
}`,
  },
  ripple: {
    duration: 640,
    css: "zoom",
    fragment: HEAD + `
void main() {
  float m = uProgress;
  vec2 c = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float d = length(c);
  float wave = sin(d * 34.0 - m * 22.0) * 0.014 * sin(m * 3.14159);
  vec2 off = c / max(d, 0.0001) * wave;
  float reveal = smoothstep(d - 0.18, d + 0.18, m * 1.35);
  gl_FragColor = mix(getFromColor(vUv + off), getToColor(vUv + off), reveal);
}`,
  },
  fade: {
    duration: 320,
    css: "fade",
    fragment: HEAD + `
void main() { gl_FragColor = mix(getFromColor(vUv), getToColor(vUv), uProgress); }`,
  },
  zoom: {
    duration: 460,
    css: "zoom",
    fragment: HEAD + `
void main() {
  vec2 c = vUv - 0.5;
  float m = uProgress;
  gl_FragColor = mix(getFromColor(0.5 + c / (1.0 + 0.12 * m)), getToColor(0.5 + c / (1.0 + 0.12 * (1.0 - m))), m);
}`,
  },
  none: {
    duration: 0,
    css: "none",
    fragment: HEAD + `
void main() { gl_FragColor = uProgress < 0.5 ? getFromColor(vUv) : getToColor(vUv); }`,
  },
};

export type EffectName = "displacement" | "ripple" | "fade" | "zoom" | "none";

/** Add or replace an effect by name. */
export function registerEffect(name: string, effect: Effect): void {
  if (!effect || typeof effect.fragment !== "string") throw new TypeError("frankaa: an effect needs a fragment shader");
  effects[name] = effect;
}

/** An effect by name, the effect object itself, or displacement when nothing matches. */
export function getEffect(e: string | Effect | undefined): Effect {
  if (e && typeof e === "object") return e;
  return (e && effects[e]) || effects.displacement;
}

/** The names registered so far. */
export const effectNames = (): string[] => Object.keys(effects);

/** The easing as a function. */
export function easingFn(e: Easing | undefined): (t: number) => number {
  if (typeof e === "function") return e;
  if (e === "linear") return (t) => Math.min(1, Math.max(0, t));
  return (t) => {
    const u = Math.min(1, Math.max(0, t));
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  };
}

/** GL uniform setter name for a value: uniform1f for a number, uniform2fv to uniform4fv for arrays. */
export function uniformKind(v: UniformValue): "1f" | "2fv" | "3fv" | "4fv" | null {
  if (typeof v === "number") return Number.isFinite(v) ? "1f" : null;
  if (Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every((x) => typeof x === "number")) return `${v.length}fv` as "2fv" | "3fv" | "4fv";
  return null;
}
