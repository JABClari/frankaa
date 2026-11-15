// Pure helpers for the lightbox's loading state: which preview stands in for a photo, what shape its frame takes,
// when the ring and the screen-reader label come in, and which move is the latest. No DOM here, so they run under
// node --test.

import type { UniformValue } from "./effects";

/** A loading look you write as a shader (WebGL only; the CSS renderer shows its film instead). */
export type LoadingShader = {
  /** A GLSL ES 1.0 fragment shader: see the contract in loading-shaders.ts. */
  fragment: string;
  /** Your own uniforms: a number is a float, an array of 2 to 4 numbers a vec2 to vec4. */
  uniforms?: Record<string, number | number[]>;
};
/** What a custom loading view gets: the photo, whether it failed, and a way to ask for it again. */
export type LoadingState = { index: number; failed: boolean; retry: () => void };
/** Your own loading view, drawn in a host laid over the photo's box (any renderer). Return a function to tidy up. */
export type LoadingRender = (host: HTMLElement, state: LoadingState) => (() => void) | void;
export type LoadingMaterial = "film" | "frost" | "liquid" | "none";
export type LoadingOption = LoadingMaterial | LoadingShader | LoadingRender;

/** The loading option read into what each part needs: the built-in material, your shader, or your view. */
export function loadingKind(o: LoadingOption | undefined): { material: LoadingMaterial; shader?: LoadingShader; render?: LoadingRender } {
  if (typeof o === "function") return { material: "none", render: o };
  if (o && typeof o === "object" && typeof o.fragment === "string") return { material: "film", shader: o };
  if (o === "frost" || o === "liquid" || o === "none" || o === "film") return { material: o };
  return { material: "film" };
}

/** The wait before the ring and the screen-reader label, in ms: a number of at least 0, else 250. */
export function loadingDelay(ms: number | undefined): number {
  return typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? ms : 250;
}

/** How long a move waits for the next photo before showing its preview instead: one or two frames, so a photo in
 *  the browser's cache never flashes its loading look. */
export const LOAD_GRACE_MS = 48;
/** The reveal: the photo opens up over its loading look, in place. */
export const REVEAL_MS = 700;
export const REVEAL_STILL_MS = 160;

/** The reveal's progress, 0 to 1, eased out (cubic) like the mockup; reduced motion runs a short linear fade. */
export function revealProgress(elapsed: number, still: boolean): number {
  const k = Math.min(1, Math.max(0, elapsed / (still ? REVEAL_STILL_MS : REVEAL_MS)));
  return still ? k : 1 - Math.pow(1 - k, 3);
}

/** The frame's shape (w / h) while the photo loads: its own size once known, then width and height when given,
 *  then the preview's, then the box before it, then 3:2. */
export function frameAspect(o: { natural?: number | null; given?: number | null; preview?: number | null; previous?: number | null }): number {
  for (const a of [o.natural, o.given, o.preview, o.previous]) if (typeof a === "number" && Number.isFinite(a) && a > 0) return a;
  return 1.5;
}

/** width / height when both are usable numbers. */
export const givenAspect = (w?: number, h?: number): number | undefined => (w && h && w > 0 && h > 0 ? w / h : undefined);

export type LoadPhase = "idle" | "loading" | "ready" | "failed";
/**
 * What the loading view shows, from its phase and how long it has been loading: the ring spins only after the
 * delay (so fast loads never show it) and completes when the photo is ready; aria-busy and the "Loading photo"
 * label follow the ring; a failure shows the message.
 */
export function loadingView(phase: LoadPhase, elapsed: number, delay: number): { ring: "off" | "spin" | "done"; busy: boolean; message: boolean; announce: "loading" | "failed" | null } {
  if (phase === "failed") return { ring: "off", busy: false, message: true, announce: "failed" };
  if (phase === "loading") {
    const late = elapsed >= delay;
    return { ring: late ? "spin" : "off", busy: late, message: false, announce: late ? "loading" : null };
  }
  return { ring: phase === "ready" ? "done" : "off", busy: false, message: false, announce: null };
}

/** Latest move wins: take() a ticket per move; a ticket that is no longer the latest must not change the screen. */
export function latest() {
  let n = 0;
  return { take: () => ++n, is: (t: number) => t === n };
}

/** A tile of random bytes (seeded, so every run looks the same) for the shaders' value noise. */
export function noiseBytes(size: number, seed = 7): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  let s = seed >>> 0;
  for (let k = 0; k < out.length; k++) {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[k] = ((t ^ (t >>> 14)) >>> 0) & 255;
  }
  return out;
}

/** A shader's own uniforms, typed for the setter (which skips anything that is not a float or a vec2 to vec4). */
export const asUniforms = (u: Record<string, number | number[]> | undefined): Record<string, UniformValue> => (u ?? {}) as Record<string, UniformValue>;
